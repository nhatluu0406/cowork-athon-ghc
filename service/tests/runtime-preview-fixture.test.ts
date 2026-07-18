/**
 * REAL-PROCESS acceptance for the COMMITTED Web Preview audit fixture (Windows only).
 *
 * The packaged UI audit relies on `tools/ui-audit/fixtures/web-preview` actually serving real
 * content and actually failing on demand. This test exercises that exact committed fixture through
 * the REAL preview service (real spawner + real WorkspaceGuard confinement + real permission gate),
 * proving end-to-end, without the packaged shell:
 *   1. `dev` (node server.mjs) reaches `running` and the detected loopback URL serves the fixture's
 *      unique marker over HTTP (so the embedded preview shows REAL content, not a placeholder);
 *   2. `serve` (node build-fail.mjs) ends in `failed` and its captured output carries the exact
 *      `tsc`-style diagnostic the Problems parser recognises (see the matching parse-problems test).
 *
 * Deterministic: no live LLM, no network beyond loopback, the fixture is copied to an OS temp dir
 * and removed afterwards. Skipped off-Windows (the product is Windows-only; `taskkill` is Windows).
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { cpSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createPreviewService, type PreviewService } from "../src/runtime-preview/preview-service.js";
import { nodePreviewSpawner } from "../src/runtime-preview/preview-spawner.js";
import { createPreviewGate } from "../src/runtime-preview/preview-gate.js";
import { createInMemoryAuditSink } from "../src/permission/audit.js";
import { createNodeScheduler } from "../src/permission/timer.js";
import { createSecretScrubber } from "../src/diagnostics/secret-scrubber.js";

const WINDOWS_ONLY = process.platform !== "win32";
const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURE_SRC = join(HERE, "..", "..", "tools", "ui-audit", "fixtures", "web-preview");
/** Kept in lock-step with build-fail.mjs; the parse-problems test asserts the same string parses. */
const EXPECTED_DIAGNOSTIC =
  "src/app.tsx(12,7): error TS2322: Type 'number' is not assignable to type 'string'.";

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
async function waitUntil(fn: () => boolean, ms: number): Promise<boolean> {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    if (fn()) return true;
    await sleep(150);
  }
  return fn();
}

function makeFixtureService(): { root: string; service: PreviewService; cleanup(): void } {
  const root = mkdtempSync(join(tmpdir(), "cghc-preview-fixture-"));
  cpSync(FIXTURE_SRC, root, { recursive: true });
  const gate = createPreviewGate({
    audit: createInMemoryAuditSink(),
    scheduler: createNodeScheduler(),
    now: () => new Date().toISOString(),
    timeoutMs: 60_000,
  });
  const service = createPreviewService({
    getActiveRoot: () => root,
    gate,
    scrubber: createSecretScrubber(),
    spawner: nodePreviewSpawner(),
    startupTimeoutMs: 30_000,
    gracefulStopMs: 3_000,
  });
  return {
    root,
    service,
    cleanup() {
      try {
        rmSync(root, { recursive: true, force: true });
      } catch {
        /* leave for the OS to reap; the assertion result is what matters */
      }
    },
  };
}

test(
  "committed fixture: `dev` serves the marker over loopback HTTP and reaches running",
  { skip: WINDOWS_ONLY },
  async () => {
    const fx = makeFixtureService();
    try {
      const info = await fx.service.detect();
      assert.equal(info.kind, "dev-server", "fixture detected as a dev-server project");
      assert.ok(info.devScripts.includes("dev"), "fixture exposes a `dev` script");
      assert.ok(info.devScripts.includes("serve"), "fixture exposes the `serve` error-mode script");

      const { requestId } = await fx.service.requestLaunch({ kind: "dev-server", script: "dev" });
      await fx.service.resolveLaunch(requestId, "allow");
      const running = await waitUntil(() => fx.service.state().status === "running", 30_000);
      assert.ok(running, `dev server should reach running (was ${fx.service.state().status})`);

      const url = fx.service.state().url ?? "";
      assert.match(url, /^http:\/\/127\.0\.0\.1:\d+$/, "detected a loopback URL to embed");

      // The crux the packaged audit relies on: the URL actually serves the fixture's marker.
      const res = await fetch(url);
      assert.equal(res.status, 200, "fixture responds 200");
      const html = await res.text();
      assert.match(html, /COWORK-GHC-PREVIEW-FIXTURE-LIVE/, "served page carries the marker");

      await fx.service.stop("user");
      assert.equal(fx.service.state().status, "stopped");
    } finally {
      await fx.service.dispose("shutdown").catch(() => undefined);
      fx.cleanup();
    }
  },
);

test(
  "committed fixture: `serve` fails and captures the exact tsc diagnostic for the Problems tab",
  { skip: WINDOWS_ONLY },
  async () => {
    const fx = makeFixtureService();
    try {
      const { requestId } = await fx.service.requestLaunch({ kind: "dev-server", script: "serve" });
      await fx.service.resolveLaunch(requestId, "allow");
      const failed = await waitUntil(() => fx.service.state().status === "failed", 30_000);
      assert.ok(failed, `error-mode script should end failed (was ${fx.service.state().status})`);
      assert.equal(fx.service.state().url, null, "no URL for a failed launch");

      const text = fx.service
        .output(0)
        .lines.map((l) => l.text)
        .join("\n");
      assert.ok(
        text.includes(EXPECTED_DIAGNOSTIC),
        `captured output must carry the diagnostic the Problems parser reads; got:\n${text}`,
      );
    } finally {
      await fx.service.dispose("shutdown").catch(() => undefined);
      fx.cleanup();
    }
  },
);
