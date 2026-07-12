/**
 * Composition-root review-fix proofs (Tier 1): the wiring the shape-level tests only CLAIMED.
 *
 * Each test drives the fully-composed loopback service (or its exposed deps) to PROVE a review
 * finding is closed at the composed layer — not just in an isolated unit:
 *  1. FIX-1 (arch HIGH-1): default-model + credential-ref have ONE source of truth across the
 *     persistent store (`GET /v1/settings`), the runtime resolver (`activeModelFor()`), and the
 *     Tier 2 launch reads — a runtime change takes effect with no restart.
 *  2. FIX-5.2 (sec MEDIUM): permission fail-closed TIMEOUT auto-deny blocks the mutation + audits.
 *  3. FIX-3 (sec LOW): a Deny with the DEFAULT not-attached (REJECTING) reply port never surfaces
 *     as an unhandled rejection / 500 — the mutation is still blocked and the deny audited.
 *  4. FIX-5.4: a persisted `base_url` is NOT auto-loaded into the SSRF-guarded port at boot.
 *  5. FIX-5.5: value-based redaction is wired into the LIVE session-stream path.
 *
 * No live OpenCode, no network egress, no real secrets: every fs/DNS touch is injected and the
 * runtime seams use their honest not-attached defaults. Every network await is bounded; the
 * server is always stopped in `finally`.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import os from "node:os";
import { existsSync, mkdtempSync, realpathSync, rmSync } from "node:fs";
import { startCoworkService, type CoworkServiceOptions } from "../src/index.js";
import { createMemoryStore } from "../src/credential/index.js";
import {
  openSettingsStore,
  type SettingsFs,
} from "../src/diagnostics/index.js";
import {
  CUSTOM_OPENAI_COMPAT_ID,
  type DnsResolver,
  type ResolvedAddress,
} from "../src/provider/index.js";
import { createWorkspaceGuard, grantWorkspace, type WorkspaceFsProbe } from "../src/workspace/index.js";
import type {
  CreateSessionInput,
  SessionStore,
  StoredSession,
} from "../src/session/index.js";
import type { EvEvent, ModelRef } from "@cowork-ghc/contracts";

const GOOD_WS = path.resolve("C:/Users/test/SSOT Workspace");
const TIMEOUT_MS = 5_000;

/** In-memory SettingsFs that persists across store instances (SD1 through the seam). */
function memorySettingsFs(): SettingsFs {
  let data: string | undefined;
  return {
    read: () => Promise.resolve(data),
    write: (d) => {
      data = d;
      return Promise.resolve();
    },
  };
}

/** Deterministic DNS resolver so the SSRF policy never touches the real network. */
function fakeResolver(map: Readonly<Record<string, ResolvedAddress>>): DnsResolver {
  return (hostname) => Promise.resolve(map[hostname] ? [map[hostname] as ResolvedAddress] : []);
}

function workspaceProbe(): WorkspaceFsProbe {
  return {
    stat: async (p) => (p === GOOD_WS ? { isDirectory: true } : undefined),
    isWritable: async (p) => p === GOOD_WS,
  };
}

function baseOptions(extra: CoworkServiceOptions = {}): CoworkServiceOptions {
  return {
    credentialStore: createMemoryStore(),
    settingsFs: memorySettingsFs(),
    workspaceFsProbe: workspaceProbe(),
    workspaceExistsProbe: async (p) => p === GOOD_WS,
    dnsResolver: fakeResolver({ "public.example.test": { address: "203.0.113.10", family: 4 } }),
    ...extra,
  };
}

async function boundedFetch(url: string, init: RequestInit = {}): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

function authHeaders(token: string): Record<string, string> {
  return { authorization: `Bearer ${token}`, "content-type": "application/json" };
}

interface Envelope<T> {
  readonly ok: boolean;
  readonly data?: T;
  readonly error?: { readonly code: string; readonly message: string };
}

/** Bounded poll — no unbounded wait; returns false if the predicate never holds. */
async function waitUntil(predicate: () => boolean, timeoutMs = 3_000, stepMs = 20): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (predicate()) return true;
    await new Promise((resolve) => setTimeout(resolve, stepMs));
  }
  return predicate();
}

/** A minimal in-memory OpenCode-store seam that supports `create` (for the live-stream test). */
function seamSessionStore(): SessionStore {
  let counter = 0;
  const sessions = new Map<string, StoredSession>();
  return {
    create: (input: CreateSessionInput): Promise<StoredSession> => {
      const id = `sess-${++counter}`;
      const stored: StoredSession = {
        id,
        title: input.title ?? "Untitled",
        workspaceId: input.workspaceId,
        createdAt: "2026-07-11T00:00:00.000Z",
        updatedAt: "2026-07-11T00:00:00.000Z",
        ...(input.model ? { model: input.model } : {}),
      };
      sessions.set(id, stored);
      return Promise.resolve(stored);
    },
    list: () => Promise.resolve([...sessions.values()]),
    get: (id) => Promise.resolve(sessions.get(id)),
    rename: (id, title) => {
      const existing = sessions.get(id);
      if (!existing) throw new Error(`seamSessionStore: no session ${id}`);
      const updated: StoredSession = { ...existing, title };
      sessions.set(id, updated);
      return Promise.resolve(updated);
    },
    replay: () => Promise.resolve([]),
  };
}

const OPENAI_MODEL: ModelRef = { providerID: "openai", modelID: "gpt-4o" };
const ANTHROPIC_MODEL: ModelRef = { providerID: "anthropic", modelID: "claude-3-5-sonnet-latest" };

/** Read the HTTP-observable effective default model via the session-model-clear response. */
async function observedDefaultModel(baseUrl: string, token: string): Promise<ModelRef | null> {
  const res = await boundedFetch(`${baseUrl}/v1/settings/model/session`, {
    method: "DELETE",
    headers: authHeaders(token),
    body: JSON.stringify({ sessionId: "observer-session" }),
  });
  const body = (await res.json()) as Envelope<{ cleared: boolean; defaultModel: ModelRef | null }>;
  return body.data?.defaultModel ?? null;
}

test("FIX-1 SSOT: a default-model PUT reaches the store, the resolver, AND Tier 2 reads (no restart)", async () => {
  const { running, deps } = await startCoworkService(baseOptions());
  const token = running.clientToken;
  try {
    // PUT a default model through the composed HTTP boundary.
    const put = await boundedFetch(`${running.baseUrl}/v1/settings/model/default`, {
      method: "PUT",
      headers: authHeaders(token),
      body: JSON.stringify({ model: OPENAI_MODEL }),
    });
    assert.equal(put.status, 200);

    // (a) The persistent store view agrees (GET /v1/settings).
    const view = await boundedFetch(`${running.baseUrl}/v1/settings`, { headers: authHeaders(token) });
    const viewBody = (await view.json()) as Envelope<{ settings: { defaultModel: ModelRef | null } }>;
    assert.deepEqual(viewBody.data?.settings.defaultModel, OPENAI_MODEL, "store default agrees");

    // (b) The in-memory runtime resolver agrees — the SAME value activeModelFor()/Tier 2 launch read.
    assert.deepEqual(deps.modelConfig.activeModelFor(), OPENAI_MODEL, "resolver default agrees (no drift)");
    assert.deepEqual(deps.providerPort.modelSelection("default"), OPENAI_MODEL, "port selection agrees");

    // (c) HTTP-observable resolver read (session-model-clear response) agrees too.
    assert.deepEqual(await observedDefaultModel(running.baseUrl, token), OPENAI_MODEL);

    // A RUNTIME change takes effect with NO restart: switch the default and re-check all reads.
    const put2 = await boundedFetch(`${running.baseUrl}/v1/settings/model/default`, {
      method: "PUT",
      headers: authHeaders(token),
      body: JSON.stringify({ model: ANTHROPIC_MODEL }),
    });
    assert.equal(put2.status, 200);
    assert.deepEqual(deps.modelConfig.activeModelFor(), ANTHROPIC_MODEL, "resolver reflects the switch, no restart");
    assert.deepEqual(await observedDefaultModel(running.baseUrl, token), ANTHROPIC_MODEL);

    // Clearing the default (model:null) reverts BOTH the store and the resolver.
    const clr = await boundedFetch(`${running.baseUrl}/v1/settings/model/default`, {
      method: "PUT",
      headers: authHeaders(token),
      body: JSON.stringify({ model: null }),
    });
    assert.equal(clr.status, 200);
    assert.equal(deps.modelConfig.activeModelFor(), undefined, "resolver default cleared with the store");
    assert.equal(await observedDefaultModel(running.baseUrl, token), null);

    // A credential-ref PUT reaches the runtime port (not only the persistent store).
    const cred = await boundedFetch(`${running.baseUrl}/v1/settings/providers/credential`, {
      method: "PUT",
      headers: authHeaders(token),
      body: JSON.stringify({ providerId: "openai", ref: { store: "os", account: "provider:openai" } }),
    });
    assert.equal(cred.status, 200);
    assert.deepEqual(
      deps.providerPort.credentialRefFor("openai"),
      { store: "os", account: "provider:openai" },
      "credential ref reached the runtime port, not only the store",
    );

    // Removing it clears the port binding too (still one source of truth).
    const del = await boundedFetch(`${running.baseUrl}/v1/settings/providers/credential`, {
      method: "DELETE",
      headers: authHeaders(token),
      body: JSON.stringify({ providerId: "openai" }),
    });
    assert.equal(del.status, 200);
    assert.equal(deps.providerPort.credentialRefFor("openai"), undefined, "credential ref cleared on the port");
  } finally {
    await running.service.stop();
  }
});

test("FIX-5.2: permission fail-closed TIMEOUT auto-denies — the mutation is blocked and a deny is audited", async () => {
  const { running, deps } = await startCoworkService(baseOptions({ permissionTimeoutMs: 40 }));
  const dir = realpathSync(mkdtempSync(path.join(os.tmpdir(), "cghc-ssot-")));
  try {
    const proxy = deps.buildToolPermissionProxy(createWorkspaceGuard(grantWorkspace({ rootPath: dir })));
    const target = path.join(dir, "note.txt");

    const out = await proxy.handle({ requestId: "req-timeout", sessionId: "sess-t", tool: "write", path: "note.txt" });
    assert.equal(out.outcome, "submitted");

    // Never answer: the fail-closed timer must auto-deny within a bounded wait.
    const audited = await waitUntil(() =>
      deps.permissionAudit
        .events()
        .some((e) => e.requestId === "req-timeout" && e.decision === "deny" && e.reason === "fail_closed_timeout"),
    );
    assert.equal(audited, true, "fail-closed timeout auto-denied and audited");

    // The execution boundary blocks the mutation; the file is never created on disk.
    let wrote = false;
    const performed = deps.permissionGate.proceed("req-timeout", () => (wrote = true)).performed;
    assert.equal(performed, false, "auto-denied request cannot proceed");
    assert.equal(wrote, false);
    assert.equal(existsSync(target), false, "fail-closed timeout must actually prevent the write");
  } finally {
    rmSync(dir, { recursive: true, force: true });
    await running.service.stop();
  }
});

test("FIX-3: a Deny over the DEFAULT rejecting reply port blocks the write without an unhandled rejection or 500", async () => {
  const rejections: unknown[] = [];
  const onRejection = (reason: unknown): void => {
    rejections.push(reason);
  };
  process.on("unhandledRejection", onRejection);
  // No `runtimeReply` injected → the honest not-attached port whose reply() REJECTS is used.
  const { running, deps } = await startCoworkService(baseOptions());
  const dir = realpathSync(mkdtempSync(path.join(os.tmpdir(), "cghc-ssot-deny-")));
  try {
    const proxy = deps.buildToolPermissionProxy(createWorkspaceGuard(grantWorkspace({ rootPath: dir })));
    const target = path.join(dir, "blocked.txt");
    const out = await proxy.handle({ requestId: "req-reject", sessionId: "sess-r", tool: "write", path: "blocked.txt" });
    assert.equal(out.outcome, "submitted");

    // The Deny resolves cleanly even though the outbound reply transport REJECTS (FIX-3).
    const res = await deps.permissionGate.resolve({ requestId: "req-reject", decision: "deny" });
    assert.equal(res.status, "resolved", "a successful Deny never surfaces the rejecting reply as an error/500");

    // The mutation is blocked and the deny audited.
    let wrote = false;
    assert.equal(deps.permissionGate.proceed("req-reject", () => (wrote = true)).performed, false);
    assert.equal(wrote, false);
    assert.equal(existsSync(target), false, "Deny actually prevents the write");
    assert.equal(
      deps.permissionAudit.events().some((e) => e.requestId === "req-reject" && e.decision === "deny"),
      true,
    );

    // Let any (swallowed) rejected reply promise settle, then assert it was NOT an unhandled rejection.
    await Promise.resolve();
    await Promise.resolve();
    assert.equal(rejections.length, 0, "the rejecting reply must be caught, not left unhandled");
  } finally {
    process.off("unhandledRejection", onRejection);
    rmSync(dir, { recursive: true, force: true });
    await running.service.stop();
  }
});

test("FIX-5.4: a persisted base_url is NOT auto-loaded into the SSRF-guarded port at boot", async () => {
  const settingsFs = memorySettingsFs();
  // Seed the persisted settings with a base_url (as an earlier run would have left it).
  const seed = await openSettingsStore({ fs: settingsFs });
  await seed.setProviderBaseUrl(CUSTOM_OPENAI_COMPAT_ID, "https://persisted.example.test/v1");

  const { running, deps } = await startCoworkService(baseOptions({ settingsFs }));
  const token = running.clientToken;
  try {
    // Boot must NOT trust a persisted base_url: the port has none until re-set via the SSRF guard.
    assert.equal(
      deps.providerPort.baseUrlFor(CUSTOM_OPENAI_COMPAT_ID),
      undefined,
      "a persisted base_url is not loaded/used until re-validated through the SSRF-guarded path",
    );
    // GET /v1/settings still reports the persisted value (the store keeps it) — but the PORT does not.
    const view = await boundedFetch(`${running.baseUrl}/v1/settings`, { headers: authHeaders(token) });
    const body = (await view.json()) as Envelope<{ settings: { providers: Array<{ providerId: string; baseUrl?: string }> } }>;
    const custom = body.data?.settings.providers.find((p) => p.providerId === CUSTOM_OPENAI_COMPAT_ID);
    assert.equal(custom?.baseUrl, "https://persisted.example.test/v1", "the store still holds the persisted value");

    // Re-set through the SSRF-guarded path (public literal IP → no DNS) makes the port hold it.
    const ok = await boundedFetch(`${running.baseUrl}/v1/settings/providers/base-url`, {
      method: "PUT",
      headers: authHeaders(token),
      body: JSON.stringify({ providerId: CUSTOM_OPENAI_COMPAT_ID, baseUrl: "https://8.8.8.8/v1" }),
    });
    assert.equal(ok.status, 200);
    assert.equal(deps.providerPort.baseUrlFor(CUSTOM_OPENAI_COMPAT_ID), "https://8.8.8.8/v1", "now validated + held on the port");
  } finally {
    await running.service.stop();
  }
});

test("FIX-5.5: value-based redaction is wired into the LIVE session-stream error path", async () => {
  // A fake key whose SHAPE the shape-sanitizer would NOT catch (no sk-/hex/40+ run) — so only a
  // VALUE-based scrub that LEARNED the literal can mask it. This proves the value path is live.
  const FAKE_KEY = "WoodenSpoon-Endpoint-Token-42";
  const { running, deps } = await startCoworkService(baseOptions({ sessionStore: seamSessionStore() }));
  const token = running.clientToken;
  try {
    // Store the fake key so the SHARED scrubber learns its value at the credential boundary.
    const stored = await boundedFetch(`${running.baseUrl}/v1/credentials`, {
      method: "POST",
      headers: authHeaders(token),
      body: JSON.stringify({ providerId: "openai", secret: FAKE_KEY }),
    });
    assert.equal(stored.status, 201);
    assert.equal((await stored.text()).includes(FAKE_KEY), false, "the credential response never echoes the value");

    // Register a live session task so the hub's authoritative-fold seam accepts frames.
    const meta = await deps.sessionService.create({ workspaceId: "ws-redact" });
    const events: EvEvent[] = [];
    const controller = deps.streamHub.open(meta.id);
    const sub = deps.streamHub.subscribe(meta.id, (e) => events.push(e));
    assert.ok(sub, "a live run is attached, so subscribe returns a handle");
    try {
      // Feed a real session.error frame carrying the literal key value in its message.
      controller.ingest({
        type: "session.error",
        properties: {
          sessionID: meta.id,
          error: { name: "APIError", data: { message: `auth failed using key ${FAKE_KEY} at endpoint` } },
        },
      });
      controller.flush();

      const errorEvent = events.find((e) => e.kind === "error");
      assert.ok(errorEvent, "the live path produced an EV error event");
      assert.equal(
        (errorEvent as { message: string }).message.includes(FAKE_KEY),
        false,
        "the composed value-scrub-then-shape-sanitize redactor masked the literal key on the LIVE path",
      );
      assert.equal(
        (errorEvent as { message: string }).message.includes("[REDACTED]"),
        true,
        "the value scrubber replaced the key with its placeholder",
      );
    } finally {
      sub?.close();
      controller.close();
    }
  } finally {
    await running.service.stop();
  }
});
