/**
 * Coverage for the user-editable Gateway proxy port (Gateway tab → server address field).
 *
 * The proxy always binds a fixed loopback port so a persisted, gateway-swapped profile `baseUrl`
 * survives restarts (see `gateway-proxy-restart.test.ts`). This is that port's SETTING: saved to
 * `gateway.json`, read once by the shell (`readGatewayServerPort`) before the NEXT composition so
 * a value the user changed on a prior run actually takes effect — never applied to the currently
 * running proxy, which already bound its port at composition time.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import os from "node:os";
import { mkdtempSync } from "node:fs";
import { createCoworkService } from "../src/index.js";
import { createMemoryStore } from "../src/credential/index.js";
import { CUSTOM_OPENAI_COMPAT_ID, type DnsResolver } from "../src/provider/index.js";
import {
  createNodeGatewayStoreFs,
  readGatewayServerPort,
  DEFAULT_GATEWAY_PROXY_PORT,
} from "../src/gateway/index.js";

const nullResolver: DnsResolver = () => Promise.resolve([]);
// Resolves any hostname to a public-looking address — needed only where a test's real upstream
// (a fake `https://` domain, never actually contacted) must survive the SSRF policy's live DNS
// check to prove a DIFFERENT concern (no stale-port skip), not "does DNS resolution work."
const publicResolver: DnsResolver = () => Promise.resolve([{ address: "93.184.216.34", family: 4 }]);

function tmpStateDir(): string {
  return mkdtempSync(path.join(os.tmpdir(), "cowork-gateway-server-port-"));
}

test("readGatewayServerPort defaults to DEFAULT_GATEWAY_PROXY_PORT when nothing was ever saved", async () => {
  const stateDir = tmpStateDir();
  const fs = createNodeGatewayStoreFs(stateDir);
  assert.equal(await readGatewayServerPort(fs), DEFAULT_GATEWAY_PROXY_PORT);
});

test("setConfiguredPort persists and readGatewayServerPort (the shell's pre-composition peek) sees it", async () => {
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
    gatewayProxyPort: 0,
  });

  assert.equal(composed.deps.gatewayService.getConfiguredPort(), DEFAULT_GATEWAY_PROXY_PORT);
  await composed.deps.gatewayService.setConfiguredPort(58123);
  assert.equal(composed.deps.gatewayService.getConfiguredPort(), 58123);
  assert.equal(composed.deps.gatewayService.getStatus().configuredPort, 58123);

  // Simulate the shell's own pre-composition read from the SAME gateway.json.
  const fs = createNodeGatewayStoreFs(stateDir);
  assert.equal(await readGatewayServerPort(fs), 58123);
});

test("setConfiguredPort rejects an out-of-range port and never persists it", async () => {
  const stateDir = tmpStateDir();
  const composed = await createCoworkService({
    credentialStore: createMemoryStore(),
    settingsFilePath: path.join(stateDir, "settings.json"),
    dnsResolver: nullResolver,
    conversationsDir: path.join(stateDir, "conversations"),
    skillsStateFilePath: path.join(stateDir, "skills-enabled.json"),
    agentStoreFilePath: path.join(stateDir, "agents.json"),
    taskStoreFilePath: path.join(stateDir, "tasks.json"),
    gatewayProxyPort: 0,
  });

  await assert.rejects(composed.deps.gatewayService.setConfiguredPort(80));
  await assert.rejects(composed.deps.gatewayService.setConfiguredPort(70000));
  await assert.rejects(composed.deps.gatewayService.setConfiguredPort(1024.5));
  assert.equal(
    composed.deps.gatewayService.getConfiguredPort(),
    DEFAULT_GATEWAY_PROXY_PORT,
    "a rejected port must not overwrite the previously configured value",
  );

  const fs = createNodeGatewayStoreFs(stateDir);
  assert.equal(await readGatewayServerPort(fs), DEFAULT_GATEWAY_PROXY_PORT);
});

test("changing the port while a profile is swapped restores it and turns Gateway OFF (no stale port dangles)", async () => {
  // Real incident (2026-07-18): saving a NEW port while an account was already swapped left the
  // profile's baseUrl pointed at the OLD port. That old address stopped matching
  // `isGatewayProxyUrl`'s default the moment the NEW port took over at the next restart, so the
  // SSRF policy legitimately refused it and the whole live tier failed — exactly the class of
  // bug the fixed-port design exists to prevent, just re-introduced by the port SETTING itself.
  const stateDir = tmpStateDir();
  const settingsFilePath = path.join(stateDir, "settings.json");
  const fixedPort = 58125;
  const credentialStore = createMemoryStore();

  const composed = await createCoworkService({
    credentialStore,
    settingsFilePath,
    dnsResolver: nullResolver,
    conversationsDir: path.join(stateDir, "conversations"),
    skillsStateFilePath: path.join(stateDir, "skills-enabled.json"),
    agentStoreFilePath: path.join(stateDir, "agents.json"),
    taskStoreFilePath: path.join(stateDir, "tasks.json"),
    gatewayProxyPort: fixedPort,
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
    composed.deps.providerProfileStore.get(profile.id)?.baseUrl?.startsWith(`http://127.0.0.1:${fixedPort}`),
    "sanity: the profile must be swapped to the proxy before changing the port",
  );

  const newPort = 58126;
  await composed.deps.gatewayService.setConfiguredPort(newPort);

  assert.equal(
    composed.deps.providerProfileStore.get(profile.id)?.baseUrl,
    "https://real-upstream.example.com/v1",
    "the swap must be restored to the real upstream — never left dangling on the old port",
  );
  assert.equal(
    composed.deps.gatewayService.isEnabled(),
    false,
    "the master switch must turn OFF so the user consciously re-enables against the new port",
  );

  // Recompose as the NEXT restart would, on the NEW port — this must NOT hit the SSRF brick,
  // because the profile's baseUrl is the real upstream now, not a stale gateway address.
  const fs = createNodeGatewayStoreFs(stateDir);
  const nextGatewayProxyPort = await readGatewayServerPort(fs);
  assert.equal(nextGatewayProxyPort, newPort);
  const diagnostics: string[] = [];
  const second = await createCoworkService({
    credentialStore,
    settingsFilePath,
    dnsResolver: publicResolver,
    conversationsDir: path.join(stateDir, "conversations"),
    skillsStateFilePath: path.join(stateDir, "skills-enabled.json"),
    agentStoreFilePath: path.join(stateDir, "agents.json"),
    taskStoreFilePath: path.join(stateDir, "tasks.json"),
    gatewayProxyPort: nextGatewayProxyPort,
    onBootDiagnostic: (line) => diagnostics.push(line),
  });
  assert.ok(
    !diagnostics.some((line) => line.includes("scheme_not_https")),
    `recompose after a port change must not hit the SSRF-scheme brick (a stale gateway-port swap), diagnostics: ${JSON.stringify(diagnostics)}`,
  );
  assert.equal(second.deps.providerPort.baseUrlFor(CUSTOM_OPENAI_COMPAT_ID), "https://real-upstream.example.com/v1");
});

test("a saved port actually becomes the fixed bind on the NEXT composition (the real restart contract)", async () => {
  const stateDir = tmpStateDir();
  const settingsFilePath = path.join(stateDir, "settings.json");
  const savedPort = 58124;

  const first = await createCoworkService({
    credentialStore: createMemoryStore(),
    settingsFilePath,
    dnsResolver: nullResolver,
    conversationsDir: path.join(stateDir, "conversations"),
    skillsStateFilePath: path.join(stateDir, "skills-enabled.json"),
    agentStoreFilePath: path.join(stateDir, "agents.json"),
    taskStoreFilePath: path.join(stateDir, "tasks.json"),
    gatewayProxyPort: 0, // this session's OWN bind stays whatever the caller wants (ephemeral)
  });
  await first.deps.gatewayService.setConfiguredPort(savedPort);
  const runningFirst = await first.start();
  await runningFirst.service.stop();

  // The shell reads the persisted port BEFORE composing the next session and threads it in —
  // reproduced here directly rather than via main.ts (not importable from a service test).
  const fs = createNodeGatewayStoreFs(stateDir);
  const nextGatewayProxyPort = await readGatewayServerPort(fs);
  assert.equal(nextGatewayProxyPort, savedPort);

  const second = await createCoworkService({
    credentialStore: createMemoryStore(),
    settingsFilePath,
    dnsResolver: nullResolver,
    conversationsDir: path.join(stateDir, "conversations"),
    skillsStateFilePath: path.join(stateDir, "skills-enabled.json"),
    agentStoreFilePath: path.join(stateDir, "agents.json"),
    taskStoreFilePath: path.join(stateDir, "tasks.json"),
    gatewayProxyPort: nextGatewayProxyPort,
  });
  assert.equal(second.deps.gatewayService.getStatus().serverAddress, `http://127.0.0.1:${savedPort}/v1`);
  assert.equal(second.deps.gatewayService.getStatus().proxyAvailable, true);

  const runningSecond = await second.start();
  await runningSecond.service.stop();
});
