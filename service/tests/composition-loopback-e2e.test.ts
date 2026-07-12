/**
 * Composition-root loopback integration proof (Tier 1).
 *
 * The unit layers are already proven; THIS suite proves the WIRING. It brings up the fully
 * composed service on a real loopback port via the composition start seam and drives it over
 * HTTP with the issued per-launch token — exercising the token guard, the mounted routers, and
 * the cross-cutting seams end-to-end. No live OpenCode, no network egress, no secrets: the
 * runtime seams use their honest not-attached defaults and every fs/DNS touch is injected.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import os from "node:os";
import { existsSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import {
  createCoworkService,
  startCoworkService,
  createHealthRouter,
  EV_SNAPSHOT_PATH,
  type BoundaryAuditEvent,
  type CoworkServiceOptions,
} from "../src/index.js";
import { createMemoryStore } from "../src/credential/index.js";
import type { SettingsFs } from "../src/diagnostics/index.js";
import { CUSTOM_OPENAI_COMPAT_ID, type DnsResolver, type ResolvedAddress } from "../src/provider/index.js";
import { createWorkspaceGuard, grantWorkspace, type WorkspaceFsProbe } from "../src/workspace/index.js";
import type { PermissionReply } from "@cowork-ghc/contracts";

const GOOD_WS = path.resolve("C:/Users/test/Composed Workspace (日本語)");

/** An in-memory SettingsFs that persists across store instances (proves SD1 through the seam). */
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

/** A deterministic DNS resolver so the SSRF policy never touches the real network. */
function fakeResolver(map: Readonly<Record<string, ResolvedAddress>>): DnsResolver {
  return (hostname) => {
    const hit = map[hostname];
    return Promise.resolve(hit ? [hit] : []);
  };
}

function workspaceProbe(): WorkspaceFsProbe {
  return {
    stat: async (p) => (p === GOOD_WS ? { isDirectory: true } : undefined),
    isWritable: async (p) => p === GOOD_WS,
  };
}

/** Base options wiring hermetic seams (memory credential store, injected fs/DNS probes). */
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

const TIMEOUT_MS = 5_000;

/** A bounded fetch: every network await has a hard timeout so a hang fails fast. */
async function boundedFetch(url: string, init: RequestInit = {}): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

interface Envelope<T> {
  readonly ok: boolean;
  readonly data?: T;
  readonly error?: { readonly code: string; readonly message: string };
}

function authHeaders(token: string): Record<string, string> {
  return { authorization: `Bearer ${token}`, "content-type": "application/json" };
}

test("token guard end-to-end: health is 401 without a token, 200 with it", async () => {
  const audits: BoundaryAuditEvent[] = [];
  const { running } = await startCoworkService(baseOptions({ onAudit: (e) => audits.push(e) }));
  try {
    // No route is mounted unauthenticated — not even health (it is token-guarded by design).
    assert.equal(audits.length, 0, "no unauthenticated route may be mounted");

    const unauth = await boundedFetch(`${running.baseUrl}/v1/health`);
    assert.equal(unauth.status, 401);
    const unauthBody = (await unauth.json()) as Envelope<unknown>;
    assert.equal(unauthBody.ok, false);
    assert.equal(unauthBody.error?.code, "unauthorized");

    const authed = await boundedFetch(`${running.baseUrl}/v1/health`, {
      headers: { authorization: `Bearer ${running.clientToken}` },
    });
    assert.equal(authed.status, 200);
    const authedBody = (await authed.json()) as Envelope<{ status: string }>;
    assert.equal(authedBody.ok, true);
    assert.equal(authedBody.data?.status, "ok");
  } finally {
    await running.service.stop();
  }
});

test("the composed service refuses a duplicate route mount and never re-mounts health", async () => {
  const composed = await createCoworkService(baseOptions());
  const running = await composed.start();
  try {
    // Health is auto-mounted by the service; mounting it again must fail closed.
    assert.throws(
      () => running.service.mount(createHealthRouter(new Date())),
      /collides|duplicate/i,
    );
  } finally {
    await running.service.stop();
  }
});

test("workspace grant round-trip: valid pick recorded; malformed → 400; traversal → typed refusal", async () => {
  const { running } = await startCoworkService(baseOptions());
  const token = running.clientToken;
  try {
    // A valid folder is granted (201) and recorded server-side.
    const okRes = await boundedFetch(`${running.baseUrl}/v1/workspace/grant`, {
      method: "POST",
      headers: authHeaders(token),
      body: JSON.stringify({ rootPath: GOOD_WS }),
    });
    assert.equal(okRes.status, 201);
    const okBody = (await okRes.json()) as Envelope<{ granted: boolean; grant: { rootPath: string } }>;
    assert.equal(okBody.data?.granted, true);
    assert.equal(okBody.data?.grant.rootPath, GOOD_WS);

    // It is recorded — the recent route now returns it (server-side state, not client-held).
    const recent = await boundedFetch(`${running.baseUrl}/v1/workspace/recent`, {
      headers: authHeaders(token),
    });
    const recentBody = (await recent.json()) as Envelope<{ recent: Array<{ rootPath: string }> }>;
    assert.equal(recentBody.data?.recent.length, 1);
    assert.equal(recentBody.data?.recent[0]?.rootPath, GOOD_WS);

    // A malformed grant body → 400 bad_request (never a 500).
    const bad = await boundedFetch(`${running.baseUrl}/v1/workspace/grant`, {
      method: "POST",
      headers: authHeaders(token),
      body: "{}",
    });
    assert.equal(bad.status, 400);
    assert.equal(((await bad.json()) as Envelope<unknown>).error?.code, "bad_request");

    // A path-traversal / relative root → server-side typed refusal (granted:false), not a 500.
    const traversal = await boundedFetch(`${running.baseUrl}/v1/workspace/grant`, {
      method: "POST",
      headers: authHeaders(token),
      body: JSON.stringify({ rootPath: "../../etc/passwd" }),
    });
    assert.equal(traversal.status, 200);
    const trBody = (await traversal.json()) as Envelope<{ granted: boolean; reason: string }>;
    assert.equal(trBody.data?.granted, false);
    assert.equal(trBody.data?.reason, "not_absolute");
  } finally {
    await running.service.stop();
  }
});

test("settings persist round-trip (SD1) survives a fresh store; credential is a handle only", async () => {
  const settingsFs = memorySettingsFs();
  const first = await startCoworkService(baseOptions({ settingsFs }));
  try {
    const patch = await boundedFetch(`${first.running.baseUrl}/v1/settings/general`, {
      method: "PATCH",
      headers: authHeaders(first.running.clientToken),
      body: JSON.stringify({ theme: "dark", verboseLogging: true }),
    });
    assert.equal(patch.status, 200);

    // Bind a provider credential HANDLE (never a key) and confirm no raw secret is echoed.
    const cred = await boundedFetch(`${first.running.baseUrl}/v1/settings/providers/credential`, {
      method: "PUT",
      headers: authHeaders(first.running.clientToken),
      body: JSON.stringify({ providerId: "openai", ref: { store: "os", account: "provider:openai" } }),
    });
    assert.equal(cred.status, 200);
    const credText = await cred.text();
    assert.equal(credText.includes("sk-"), false, "no key-shaped material in the settings response");
    const credBody = JSON.parse(credText) as Envelope<{ settings: { providers: Array<{ providerId: string; hasCredential: boolean }> } }>;
    const openai = credBody.data?.settings.providers.find((p) => p.providerId === "openai");
    assert.equal(openai?.hasCredential, true);
  } finally {
    await first.running.service.stop();
  }

  // A brand-new composed service reading the SAME persisted fs must see the written values.
  const second = await startCoworkService(baseOptions({ settingsFs }));
  try {
    const view = await boundedFetch(`${second.running.baseUrl}/v1/settings`, {
      headers: authHeaders(second.running.clientToken),
    });
    const body = (await view.json()) as Envelope<{
      settings: { general: { theme: string; verboseLogging: boolean }; providers: Array<{ providerId: string; hasCredential: boolean }> };
    }>;
    assert.equal(body.data?.settings.general.theme, "dark");
    assert.equal(body.data?.settings.general.verboseLogging, true);
    const openai = body.data?.settings.providers.find((p) => p.providerId === "openai");
    assert.equal(openai?.hasCredential, true, "credential handle persisted across a fresh store");
  } finally {
    await second.running.service.stop();
  }
});

test("provider base_url: an SSRF-y endpoint is refused (nothing persisted); a public one is accepted", async () => {
  const { running, deps } = await startCoworkService(baseOptions());
  const token = running.clientToken;
  try {
    // A private/metadata target (literal IP → no DNS) is refused; the port stores nothing.
    const ssrf = await boundedFetch(`${running.baseUrl}/v1/providers/endpoint`, {
      method: "POST",
      headers: authHeaders(token),
      body: JSON.stringify({ id: CUSTOM_OPENAI_COMPAT_ID, baseUrl: "https://169.254.169.254/v1" }),
    });
    assert.equal(ssrf.ok, false, "an SSRF-y base_url must not return 2xx");
    assert.equal(((await ssrf.json()) as Envelope<unknown>).ok, false);
    assert.equal(deps.providerPort.baseUrlFor(CUSTOM_OPENAI_COMPAT_ID), undefined);

    // A public https target (literal public IP → no DNS) is accepted and stored on the port.
    const good = await boundedFetch(`${running.baseUrl}/v1/providers/endpoint`, {
      method: "POST",
      headers: authHeaders(token),
      body: JSON.stringify({ id: CUSTOM_OPENAI_COMPAT_ID, baseUrl: "https://8.8.8.8/v1" }),
    });
    assert.equal(good.status, 200);
    assert.equal(deps.providerPort.baseUrlFor(CUSTOM_OPENAI_COMPAT_ID), "https://8.8.8.8/v1");
  } finally {
    await running.service.stop();
  }
});

test("settings→provider base_url path enforces SSRF before persistence", async () => {
  const { running, deps } = await startCoworkService(baseOptions());
  const token = running.clientToken;
  try {
    // The settings base-url route routes through the provider port's SSRF guard: a blocked
    // target persists nothing (no unvalidated base_url on disk).
    const blocked = await boundedFetch(`${running.baseUrl}/v1/settings/providers/base-url`, {
      method: "PUT",
      headers: authHeaders(token),
      body: JSON.stringify({ providerId: CUSTOM_OPENAI_COMPAT_ID, baseUrl: "https://127.0.0.1/v1" }),
    });
    assert.equal(blocked.ok, false);
    assert.equal(deps.settingsStore.providerSettings(CUSTOM_OPENAI_COMPAT_ID)?.baseUrl, undefined);

    // A public target is validated, stored on the port, AND persisted to settings.
    const ok = await boundedFetch(`${running.baseUrl}/v1/settings/providers/base-url`, {
      method: "PUT",
      headers: authHeaders(token),
      body: JSON.stringify({ providerId: CUSTOM_OPENAI_COMPAT_ID, baseUrl: "https://8.8.8.8/v1" }),
    });
    assert.equal(ok.status, 200);
    const view = (await ok.json()) as Envelope<{ settings: { providers: Array<{ providerId: string; baseUrl?: string }> } }>;
    const custom = view.data?.settings.providers.find((p) => p.providerId === CUSTOM_OPENAI_COMPAT_ID);
    assert.equal(custom?.baseUrl, "https://8.8.8.8/v1");
    assert.equal(deps.providerPort.baseUrlFor(CUSTOM_OPENAI_COMPAT_ID), "https://8.8.8.8/v1");
  } finally {
    await running.service.stop();
  }
});

test("EV snapshot route is token-guarded and returns a typed not-found for an unknown session", async () => {
  const { running } = await startCoworkService(baseOptions());
  const token = running.clientToken;
  try {
    // Token-guarded like every sensitive route.
    const unauth = await boundedFetch(`${running.baseUrl}${EV_SNAPSHOT_PATH}?sessionId=nope`);
    assert.equal(unauth.status, 401);

    // Unknown session → 404 with a typed { found:false } payload (no fabricated view).
    const res = await boundedFetch(`${running.baseUrl}${EV_SNAPSHOT_PATH}?sessionId=does-not-exist`, {
      headers: authHeaders(token),
    });
    assert.equal(res.status, 404);
    const body = (await res.json()) as Envelope<{ found: boolean; sessionId: string }>;
    assert.equal(body.ok, true);
    assert.equal(body.data?.found, false);
    assert.equal(body.data?.sessionId, "does-not-exist");
  } finally {
    await running.service.stop();
  }
});

test("permission Deny actually blocks a real file mutation at the execution boundary (live reply is Tier 2)", async () => {
  const captured: PermissionReply[] = [];
  const runtimeReply = {
    reply: (r: PermissionReply): Promise<void> => {
      captured.push(r);
      return Promise.resolve();
    },
  };
  const { running, deps } = await startCoworkService(baseOptions({ runtimeReply }));
  const dir = realpathSync(mkdtempSync(path.join(os.tmpdir(), "cghc-ws-")));
  try {
    const guard = createWorkspaceGuard(grantWorkspace({ rootPath: dir }));
    const proxy = deps.buildToolPermissionProxy(guard);
    const target = path.join(dir, "agent-note.txt");

    // The runtime proxy confines the tool's (workspace-relative) real path and submits to the gate.
    const out = await proxy.handle({ requestId: "req-deny", sessionId: "sess-1", tool: "write", path: "agent-note.txt" });
    assert.equal(out.outcome, "submitted");

    // Fail-closed: before any decision, the boundary guard refuses to run the mutation.
    let wrote = false;
    const perform = (): boolean => {
      wrote = true;
      writeFileSync(target, "leak");
      return true;
    };
    assert.equal(deps.permissionGate.proceed("req-deny", perform).performed, false);

    // A Deny is recorded server-side and forwarded to the (injected) runtime-reply seam.
    const res = await deps.permissionGate.resolve({ requestId: "req-deny", decision: "deny" });
    assert.equal(res.status, "resolved");

    // The execution boundary now blocks the mutation — the file is never created on disk.
    assert.equal(deps.permissionGate.proceed("req-deny", perform).performed, false);
    assert.equal(wrote, false);
    assert.equal(existsSync(target), false, "Deny must actually prevent the file from being written");

    // P5 audit recorded the Deny (no secret) and the reply was forwarded exactly once.
    assert.equal(
      deps.permissionAudit.events().some((e) => e.requestId === "req-deny" && e.decision === "deny"),
      true,
    );
    assert.equal(captured.length, 1);
    assert.equal(captured[0]?.decision, "deny");
  } finally {
    rmSync(dir, { recursive: true, force: true });
    await running.service.stop();
  }
});

test("permission Deny over the COMPOSED HTTP boundary blocks the mutation at gate.proceed (CGHC-017)", async () => {
  const captured: PermissionReply[] = [];
  const runtimeReply = {
    reply: (r: PermissionReply): Promise<void> => {
      captured.push(r);
      return Promise.resolve();
    },
  };
  const { running, deps } = await startCoworkService(baseOptions({ runtimeReply }));
  const token = running.clientToken;
  const dir = realpathSync(mkdtempSync(path.join(os.tmpdir(), "cghc-ws-")));
  try {
    const guard = createWorkspaceGuard(grantWorkspace({ rootPath: dir }));
    const proxy = deps.buildToolPermissionProxy(guard);
    const target = path.join(dir, "http-note.txt");

    // The runtime proxy submits a REAL request into the single gate (the boundary origin, P1).
    const submitted = await proxy.handle({ requestId: "req-http-deny", sessionId: "sess-http", tool: "write", path: "http-note.txt" });
    assert.equal(submitted.outcome, "submitted");

    // The UI-facing pending route surfaces it (the Part-B modal reads exactly this projection).
    const pending = await boundedFetch(`${running.baseUrl}/v1/permission/pending`, { headers: authHeaders(token) });
    assert.equal(pending.status, 200);
    const pendingBody = (await pending.json()) as Envelope<{ pending: Array<{ requestId: string; action: { kind: string } }> }>;
    assert.equal(pendingBody.data?.pending.some((p) => p.requestId === "req-http-deny" && p.action.kind === "file_create"), true);

    // The DENY arrives over HTTP with the token — the router only RECORDS it on the gate.
    const denyRes = await boundedFetch(`${running.baseUrl}/v1/permission/decision`, {
      method: "POST",
      headers: authHeaders(token),
      body: JSON.stringify({ requestId: "req-http-deny", decision: "deny" }),
    });
    assert.equal(denyRes.status, 200);
    assert.equal(((await denyRes.json()) as Envelope<{ status: string }>).data?.status, "resolved");

    // Enforcement is at the execution boundary, NOT the route: gate.proceed refuses to run.
    let wrote = false;
    const perform = (): boolean => {
      wrote = true;
      writeFileSync(target, "leak");
      return true;
    };
    assert.equal(deps.permissionGate.proceed("req-http-deny", perform).performed, false);
    assert.equal(wrote, false);
    assert.equal(existsSync(target), false, "an HTTP Deny must actually prevent the file being written on disk");

    // P5: the Deny is audited (no secret) and forwarded exactly once through the runtime-reply seam.
    assert.equal(deps.permissionAudit.events().some((e) => e.requestId === "req-http-deny" && e.decision === "deny"), true);
    assert.equal(captured.filter((r) => r.requestId === "req-http-deny").length, 1);
    assert.equal(captured.at(-1)?.decision, "deny");

    // Positive proof: a separate request Allowed over HTTP lets proceed run EXACTLY once (once-consumed).
    const target2 = path.join(dir, "http-allow.txt");
    const submitted2 = await proxy.handle({ requestId: "req-http-allow", sessionId: "sess-http", tool: "write", path: "http-allow.txt" });
    assert.equal(submitted2.outcome, "submitted");
    const allowRes = await boundedFetch(`${running.baseUrl}/v1/permission/decision`, {
      method: "POST",
      headers: authHeaders(token),
      body: JSON.stringify({ requestId: "req-http-allow", decision: "allow", scope: "once" }),
    });
    assert.equal(allowRes.status, 200);
    let writes = 0;
    const performAllow = (): boolean => {
      writes += 1;
      writeFileSync(target2, "ok");
      return true;
    };
    assert.equal(deps.permissionGate.proceed("req-http-allow", performAllow).performed, true);
    // An `once` allow is consumed — a replayed proceed does NOT run the mutation again.
    assert.equal(deps.permissionGate.proceed("req-http-allow", performAllow).performed, false);
    assert.equal(writes, 1, "an once allow runs the mutation exactly once");
    assert.equal(existsSync(target2), true);
  } finally {
    rmSync(dir, { recursive: true, force: true });
    await running.service.stop();
  }
});
