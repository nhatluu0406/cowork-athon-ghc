/**
 * Launch a live PINNED `opencode serve` for a capture run (CGHC-024, opt-in / post-token).
 *
 * Reuses the CGHC-001 launch/config seam (`buildLaunchSpec`) so:
 *  - the provider key is injected into the CHILD ENV ONLY (never argv, never auth.json/env.json),
 *  - per-run data isolation is enforced via XDG_DATA_HOME + OPENCODE_CONFIG_DIR,
 *  - the bind stays loopback-only.
 *
 * It refuses to proceed unless `/global/health` reports the pinned version (ADR 0001 gate),
 * so frames are never captured against an unexpected binary.
 */

import { spawn, type ChildProcess } from "node:child_process";
import { mkdtempSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  assertPinnedVersion,
  buildLaunchSpec,
  type ProviderKeyInjection,
} from "@cowork-ghc/runtime";

export interface LaunchOptions {
  readonly binPath: string;
  readonly cwd: string;
  readonly port: number;
  readonly providerKeys: readonly ProviderKeyInjection[];
  /** Curated base env for the child (defaults to a minimal PATH/SystemRoot slice). */
  readonly baseEnv?: Readonly<Record<string, string | undefined>>;
  /** Max ms to wait for the child to become healthy at the pinned version. */
  readonly healthTimeoutMs?: number;
}

export interface LaunchedRuntime {
  readonly baseUrl: string;
  readonly child: ChildProcess;
  stop(): void;
}

/** Poll `/global/health` until it reports the pinned version, or throw on timeout/mismatch. */
async function waitForPinnedHealth(baseUrl: string, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let lastErr: unknown;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(new URL("/global/health", baseUrl));
      if (res.ok) {
        const body = (await res.json()) as { version?: unknown };
        const version = typeof body.version === "string" ? body.version : "";
        assertPinnedVersion(version); // ADR 0001: reject an unexpected binary before capture.
        return;
      }
    } catch (err) {
      lastErr = err;
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`opencode serve did not become healthy at the pinned version in ${timeoutMs}ms`, {
    cause: lastErr,
  });
}

/** Spawn a pinned `opencode serve` with the key injected into its env, and await health. */
export async function launchPinnedOpencode(options: LaunchOptions): Promise<LaunchedRuntime> {
  const root = mkdtempSync(join(tmpdir(), "cghc-capture-"));
  const spec = buildLaunchSpec({
    binPath: options.binPath,
    cwd: options.cwd,
    port: options.port,
    dataHome: join(root, "xdg", "data"),
    configDir: join(root, "config", "opencode"),
    providerKeys: options.providerKeys,
    ...(options.baseEnv ? { baseEnv: options.baseEnv } : {}),
  });

  // OpenCode opens its SQLite store under XDG_DATA_HOME on the first session write; if the
  // directory does not exist the open fails with an opaque 500. buildLaunchSpec is pure (no
  // I/O by contract), so the supervisor owns creating the per-run data/config dirs here.
  mkdirSync(spec.dataHome, { recursive: true });
  mkdirSync(spec.configDir, { recursive: true });

  const child = spawn(spec.command, [...spec.args], {
    cwd: spec.cwd,
    env: spec.env, // PLAINTEXT key in child env only — never logged (see redactedEnvSnapshot).
    stdio: ["ignore", "inherit", "inherit"],
  });

  const baseUrl = `http://${spec.host}:${spec.port}`;
  await waitForPinnedHealth(baseUrl, options.healthTimeoutMs ?? 20_000);
  return {
    baseUrl,
    child,
    stop() {
      if (!child.killed) child.kill();
    },
  };
}
