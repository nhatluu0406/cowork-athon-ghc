/**
 * Regression coverage for the 2026-07-17 incident: turning Gateway ON swaps a provider profile's
 * persisted `baseUrl` to the local proxy's address; on the NEXT app launch (or a settings-only →
 * live tier transition, which recomposes the whole service) that persisted, gateway-swapped
 * `baseUrl` gets re-validated by the SSRF-gated provider port BEFORE the new composition's own
 * Gateway proxy has bound anything — an ephemeral bind meant the new address never matched the
 * old persisted one, so the SSRF policy legitimately refused it and the whole live tier died with
 * `Outbound target refused by SSRF policy (scheme_not_https): http:`.
 *
 * Contract proven here: with a FIXED `gatewayProxyPort`, a persisted gateway-swapped profile
 * `baseUrl` survives a full stop → recompose cycle — the new composition accepts it (no SSRF
 * skip) and the profile stays correctly routed through the proxy. Also covers the "server
 * unavailable" gate: `setEnabled(true)` refuses when the proxy never bound.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import os from "node:os";
import { mkdtempSync } from "node:fs";
import { createServer } from "node:http";
import { createCoworkService } from "../src/index.js";
import { createMemoryStore } from "../src/credential/index.js";
import { CUSTOM_OPENAI_COMPAT_ID, type DnsResolver } from "../src/provider/index.js";
import { GatewayProxyUnavailableError } from "../src/gateway/index.js";

const nullResolver: DnsResolver = () => Promise.resolve([]);

function tmpStateDir(): string {
  return mkdtempSync(path.join(os.tmpdir(), "cowork-gateway-restart-"));
}

/** `recordRequest` is fire-and-forget from the proxy's response cycle — poll rather than race it. */
async function waitForLogCount(
  gatewayService: { refreshFromDisk(): Promise<void>; listLogs(): readonly unknown[] },
  expected: number,
  timeoutMs = 2000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    await gatewayService.refreshFromDisk();
    if (gatewayService.listLogs().length === expected) return;
    if (Date.now() > deadline) {
      throw new Error(`expected ${expected} log entries, still ${gatewayService.listLogs().length} after ${timeoutMs}ms`);
    }
    await new Promise((r) => setTimeout(r, 25));
  }
}

test("a gateway-swapped profile baseUrl survives a stop + recompose cycle on a fixed port", async () => {
  const stateDir = tmpStateDir();
  const settingsFilePath = path.join(stateDir, "settings.json");
  const credentialStore = createMemoryStore();
  const fixedPort = 48173;
  const diagnostics: string[] = [];

  const first = await createCoworkService({
    credentialStore,
    settingsFilePath,
    dnsResolver: nullResolver,
    conversationsDir: path.join(stateDir, "conversations"),
    skillsStateFilePath: path.join(stateDir, "skills-enabled.json"),
    agentStoreFilePath: path.join(stateDir, "agents.json"),
    taskStoreFilePath: path.join(stateDir, "tasks.json"),
    gatewayProxyPort: fixedPort,
    onBootDiagnostic: (line) => diagnostics.push(line),
  });

  const profile = await first.deps.providerProfileStore.create({
    displayName: "Test upstream",
    providerType: CUSTOM_OPENAI_COMPAT_ID,
    baseUrl: "https://real-upstream.example.com/v1",
    modelId: "test-model",
  });
  await first.deps.providerProfileStore.setActive(profile.id);
  const credentialRef = await first.deps.credentialService.store({
    providerId: "gateway",
    account: `profile:${profile.id}`,
    secret: "sk-test-secret",
  });
  await first.deps.providerProfileStore.setCredentialRef(profile.id, credentialRef);

  await first.deps.gatewayService.linkAccount({
    providerId: profile.id,
    label: "Test upstream",
    credentialAccount: credentialRef.account!,
  });
  await first.deps.gatewayService.setEnabled(true);

  const swappedUrl = first.deps.providerProfileStore.get(profile.id)?.baseUrl;
  assert.ok(swappedUrl?.startsWith(`http://127.0.0.1:${fixedPort}`), `expected the profile baseUrl swapped to the fixed-port proxy, got: ${swappedUrl}`);

  const runningFirst = await first.start();
  await runningFirst.service.stop();

  // Recompose from scratch — simulating the NEXT app launch / a settings-only → live transition —
  // reading the SAME persisted settings (which still has the swapped baseUrl) on the SAME port.
  const second = await createCoworkService({
    credentialStore,
    settingsFilePath,
    dnsResolver: nullResolver,
    conversationsDir: path.join(stateDir, "conversations"),
    skillsStateFilePath: path.join(stateDir, "skills-enabled.json"),
    agentStoreFilePath: path.join(stateDir, "agents.json"),
    taskStoreFilePath: path.join(stateDir, "tasks.json"),
    gatewayProxyPort: fixedPort,
    onBootDiagnostic: (line) => diagnostics.push(line),
  });

  assert.ok(
    !diagnostics.some((line) => line.includes("endpoint_skipped")),
    `persisted gateway-swapped baseUrl must NOT be SSRF-skipped on recompose, diagnostics: ${JSON.stringify(diagnostics)}`,
  );
  assert.equal(
    second.deps.providerPort.baseUrlFor(CUSTOM_OPENAI_COMPAT_ID),
    swappedUrl,
    "the runtime provider port must actually be configured with the (recognized) swapped baseUrl",
  );

  const status = second.deps.gatewayService.getStatus();
  assert.equal(status.proxyAvailable, true);
  assert.equal(status.serverAddress, `http://127.0.0.1:${fixedPort}/v1`);

  const runningSecond = await second.start();
  await runningSecond.service.stop();
});

test("turning Gateway OFF still forwards stale, already-proxy-pointed traffic instead of blocking it", async () => {
  // Real incident (2026-07-18): OpenCode only reads `opencode.json` at spawn, so an
  // already-running child stays pointed at the proxy for a while after the switch flips OFF.
  // The proxy used to hard-refuse that traffic (`no_active_account`) until the next restart —
  // exactly backwards from the OFF contract ("hoạt động bình thường", no restart required).
  const stateDir = tmpStateDir();
  const settingsFilePath = path.join(stateDir, "settings.json");
  const composed = await createCoworkService({
    credentialStore: createMemoryStore(),
    settingsFilePath,
    dnsResolver: nullResolver,
    conversationsDir: path.join(stateDir, "conversations"),
    skillsStateFilePath: path.join(stateDir, "skills-enabled.json"),
    agentStoreFilePath: path.join(stateDir, "agents.json"),
    taskStoreFilePath: path.join(stateDir, "tasks.json"),
    gatewayProxyPort: 48175,
  });

  const profile = await composed.deps.providerProfileStore.create({
    displayName: "Test upstream",
    providerType: CUSTOM_OPENAI_COMPAT_ID,
    baseUrl: "https://real-upstream.example.com/v1",
    modelId: "test-model",
  });
  await composed.deps.providerProfileStore.setActive(profile.id);
  const credentialRef = await composed.deps.credentialService.store({
    providerId: "gateway",
    account: `profile:${profile.id}`,
    secret: "sk-test-secret",
  });
  await composed.deps.providerProfileStore.setCredentialRef(profile.id, credentialRef);
  await composed.deps.gatewayService.linkAccount({
    providerId: profile.id,
    label: "Test upstream",
    credentialAccount: credentialRef.account!,
  });

  await composed.deps.gatewayService.setEnabled(true);
  assert.ok(
    composed.deps.gatewayService.resolveProxyUpstream() !== undefined,
    "while ON, the proxy must resolve the real upstream",
  );

  await composed.deps.gatewayService.setEnabled(false);
  const upstream = composed.deps.gatewayService.resolveProxyUpstream();
  assert.equal(
    upstream?.baseUrl,
    "https://real-upstream.example.com/v1",
    "right after OFF (no restart yet), stale traffic still pointed at the proxy must be forwarded to the real upstream, not blocked",
  );
});

test("stale traffic forwarded while OFF is NOT written to the request log", async () => {
  // Companion to the "still forwards" test above: forwarding stale traffic after OFF must not
  // resurrect Gateway's bookkeeping — OFF means "not observing/logging," only "get out of the
  // way." A real HTTP round-trip through the actual proxy server (not just resolveProxyUpstream
  // in isolation), so the compose-service.ts `onRequestComplete` guard is exercised for real.
  const stateDir = tmpStateDir();
  const settingsFilePath = path.join(stateDir, "settings.json");

  // A real upstream so the proxied request completes with a genuine response (not a connect
  // error) — this test cares whether a log entry was written, not whether forwarding succeeded.
  const upstream = createServer((_req, res) => {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ ok: true }));
  });
  await new Promise<void>((resolve) => upstream.listen(0, "127.0.0.1", resolve));
  const upstreamAddress = upstream.address();
  const upstreamPort = typeof upstreamAddress === "object" && upstreamAddress !== null ? upstreamAddress.port : 0;

  const composed = await createCoworkService({
    credentialStore: createMemoryStore(),
    settingsFilePath,
    dnsResolver: nullResolver,
    conversationsDir: path.join(stateDir, "conversations"),
    skillsStateFilePath: path.join(stateDir, "skills-enabled.json"),
    agentStoreFilePath: path.join(stateDir, "agents.json"),
    taskStoreFilePath: path.join(stateDir, "tasks.json"),
    gatewayProxyPort: 48176,
  });

  try {
    const profile = await composed.deps.providerProfileStore.create({
      displayName: "Test upstream",
      providerType: CUSTOM_OPENAI_COMPAT_ID,
      baseUrl: `http://127.0.0.1:${upstreamPort}/v1`,
      modelId: "test-model",
    });
    await composed.deps.providerProfileStore.setActive(profile.id);
    const credentialRef = await composed.deps.credentialService.store({
      providerId: "gateway",
      account: `profile:${profile.id}`,
      secret: "sk-test-secret",
    });
    await composed.deps.providerProfileStore.setCredentialRef(profile.id, credentialRef);
    await composed.deps.gatewayService.linkAccount({
      providerId: profile.id,
      label: "Test upstream",
      credentialAccount: credentialRef.account!,
    });
    await composed.deps.gatewayService.setEnabled(true);

    const proxyBaseUrl = composed.deps.gatewayService.getStatus().serverAddress;
    const logsBeforeOn = composed.deps.gatewayService.listLogs().length;
    await fetch(`${proxyBaseUrl}/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ model: "test-model", messages: [{ role: "user", content: "hi" }] }),
    });
    await waitForLogCount(composed.deps.gatewayService, logsBeforeOn + 1);
    const [loggedEntry] = composed.deps.gatewayService.listLogs();
    assert.equal(loggedEntry?.httpStatus, 200, "the real proxy round-trip status must be persisted");
    assert.equal(typeof loggedEntry?.ttfbMs, "number", "the real TTFB measurement must be persisted");
    assert.equal(typeof loggedEntry?.totalMs, "number", "the real total-duration measurement must be persisted");

    await composed.deps.gatewayService.setEnabled(false);
    const logsBeforeOff = composed.deps.gatewayService.listLogs().length;
    const res = await fetch(`${proxyBaseUrl}/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ model: "test-model", messages: [{ role: "user", content: "hi again" }] }),
    });
    assert.equal(res.status, 200, "stale traffic must still be forwarded and succeed after OFF");
    // No `recordRequest` call is expected at all while OFF — wait out a grace period (long
    // enough for the fire-and-forget write to have landed if it were ever going to) rather than
    // asserting instantly, so a delayed/buggy write would still be caught.
    await new Promise((r) => setTimeout(r, 300));
    await composed.deps.gatewayService.refreshFromDisk();
    assert.equal(
      composed.deps.gatewayService.listLogs().length,
      logsBeforeOff,
      "a request forwarded while OFF must NOT add a new log entry",
    );
  } finally {
    await new Promise<void>((resolve) => upstream.close(() => resolve()));
  }
});

test("setEnabled(true) refuses when the Gateway proxy never bound (port already taken)", async () => {
  const stateDir = tmpStateDir();
  const busyPort = 48174;

  const blocker = await createCoworkService({
    credentialStore: createMemoryStore(),
    settingsFilePath: path.join(stateDir, "blocker-settings.json"),
    dnsResolver: nullResolver,
    conversationsDir: path.join(stateDir, "blocker-conversations"),
    skillsStateFilePath: path.join(stateDir, "blocker-skills-enabled.json"),
    agentStoreFilePath: path.join(stateDir, "blocker-agents.json"),
    taskStoreFilePath: path.join(stateDir, "blocker-tasks.json"),
    gatewayProxyPort: busyPort,
  });

  const contender = await createCoworkService({
    credentialStore: createMemoryStore(),
    settingsFilePath: path.join(stateDir, "contender-settings.json"),
    dnsResolver: nullResolver,
    conversationsDir: path.join(stateDir, "contender-conversations"),
    skillsStateFilePath: path.join(stateDir, "contender-skills-enabled.json"),
    agentStoreFilePath: path.join(stateDir, "contender-agents.json"),
    taskStoreFilePath: path.join(stateDir, "contender-tasks.json"),
    gatewayProxyPort: busyPort,
  });

  const status = contender.deps.gatewayService.getStatus();
  assert.equal(status.proxyAvailable, false, "the second bind to the same port must fail to become available");

  await assert.rejects(
    contender.deps.gatewayService.setEnabled(true),
    (err: unknown) => err instanceof GatewayProxyUnavailableError,
  );

  const runningBlocker = await blocker.start();
  await runningBlocker.service.stop();
});
