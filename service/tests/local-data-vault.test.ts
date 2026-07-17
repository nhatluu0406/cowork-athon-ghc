/**
 * Wave 0A — local SQLite vault, app lock, encrypted secrets (ADR 0007).
 */

import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { createMemoryStore, createSecretScrubber } from "../src/credential/index.js";
import {
  appliedMigrationIds,
  closeSqliteDatabase,
  collectCredentialAccounts,
  createAppMetaRepository,
  createLocalAuthService,
  createLocalUserRepository,
  createProviderProfileRepository,
  createProviderVerificationRepository,
  createSecretsRepository,
  createSettingsRepository,
  createSqliteSettingsFs,
  createVaultCredentialStore,
  createVaultKeyRepository,
  decryptSecret,
  encryptSecret,
  generateMasterKey,
  migrateJsonSettingsToSqlite,
  migrateKeyringSecretsToVault,
  openMemorySqliteDatabase,
  openSqliteDatabase,
  runMigrations,
  SETTINGS_DOCUMENT_KEY,
} from "../src/db/index.js";
import { createCoworkService } from "../src/composition/index.js";
import { defaultSettings } from "../src/diagnostics/settings-types.js";

test("migrations apply initial_local_vault idempotently", () => {
  const db = openMemorySqliteDatabase();
  const first = runMigrations(db);
  assert.deepEqual(first, [1, 2, 3]);
  assert.deepEqual(appliedMigrationIds(db), [1, 2, 3]);
  const second = runMigrations(db);
  assert.deepEqual(second, []);
  closeSqliteDatabase(db);
});

test("file SQLite opens under a temp path and enables foreign keys", () => {
  const dir = mkdtempSync(join(tmpdir(), "cghc-vault-"));
  const filePath = join(dir, "cowork-ghc.db");
  const db = openSqliteDatabase({ filePath });
  runMigrations(db);
  assert.ok(existsSync(filePath));
  const fk = db.pragma("foreign_keys", { simple: true });
  assert.equal(fk, 1);
  closeSqliteDatabase(db);
  rmSync(dir, { recursive: true, force: true });
});

test("setup / unlock / wrong password", async () => {
  const db = openMemorySqliteDatabase();
  runMigrations(db);
  const auth = createLocalAuthService({
    users: createLocalUserRepository(db),
    vaultKeys: createVaultKeyRepository(db),
    now: () => "2026-07-15T00:00:00.000Z",
    id: () => "user-1",
  });
  assert.equal(auth.status().state, "needs_setup");
  await auth.setup("alice", "password-ok");
  assert.equal(auth.status().state, "unlocked");
  assert.ok(auth.masterKey());
  auth.lock();
  assert.equal(auth.status().state, "locked");
  await assert.rejects(() => auth.unlock("alice", "wrong-password"), /Invalid username or password/);
  await auth.unlock("alice", "password-ok");
  assert.equal(auth.status().state, "unlocked");
  closeSqliteDatabase(db);
});

test("encryption round-trip and vault credential store", async () => {
  const master = generateMasterKey();
  const enc = encryptSecret(master, "sk-secret-roundtrip", "secret:provider:x");
  assert.equal(decryptSecret(master, enc, "secret:provider:x"), "sk-secret-roundtrip");
  assert.equal(decryptSecret(master, enc, "wrong-aad"), null);

  const db = openMemorySqliteDatabase();
  runMigrations(db);
  const auth = createLocalAuthService({
    users: createLocalUserRepository(db),
    vaultKeys: createVaultKeyRepository(db),
  });
  await auth.setup("bob", "password12");
  const vault = createVaultCredentialStore({
    auth,
    secrets: createSecretsRepository(db),
  });
  await vault.set("profile:demo", "sk-live-secret");
  assert.equal(await vault.get("profile:demo"), "sk-live-secret");
  auth.lock();
  await assert.rejects(() => vault.get("profile:demo"), /Vault is locked/);
  closeSqliteDatabase(db);
});

test("secrets table never stores plaintext", async () => {
  const db = openMemorySqliteDatabase();
  runMigrations(db);
  const auth = createLocalAuthService({
    users: createLocalUserRepository(db),
    vaultKeys: createVaultKeyRepository(db),
  });
  await auth.setup("carol", "password12");
  const vault = createVaultCredentialStore({
    auth,
    secrets: createSecretsRepository(db),
  });
  const plain = "sk-plain-MUST-NOT-APPEAR";
  await vault.set("provider:ms365", plain);
  const blob = db.prepare("SELECT ciphertext, nonce, tag FROM secrets").all() as Array<{
    ciphertext: Buffer;
  }>;
  assert.equal(blob.length, 1);
  const haystack = Buffer.concat(blob.map((r) => r.ciphertext)).toString("utf8");
  assert.equal(haystack.includes(plain), false);
  closeSqliteDatabase(db);
});

test("settings persist in SQLite and survive relaunch", async () => {
  const dir = mkdtempSync(join(tmpdir(), "cghc-settings-"));
  const dbPath = join(dir, "cowork-ghc.db");
  const first = await createCoworkService({
    dbPath,
    settingsFilePath: join(dir, "settings.json"),
  });
  assert.ok(first.deps.localAuth);
  await first.deps.localAuth!.setup("dave", "password12");
  await first.deps.settingsStore.updateGeneral({ theme: "dark", verboseLogging: true });
  // Close without start() — close DB via deps handle.
  closeSqliteDatabase(first.deps.sqliteDatabase!);

  const second = await createCoworkService({
    dbPath,
    settingsFilePath: join(dir, "settings.json"),
  });
  await second.deps.localAuth!.unlock("dave", "password12");
  assert.equal(second.deps.settingsStore.general().theme, "dark");
  assert.equal(second.deps.settingsStore.general().verboseLogging, true);
  closeSqliteDatabase(second.deps.sqliteDatabase!);
  rmSync(dir, { recursive: true, force: true });
});

test("JSON settings migrate into SQLite with backup rename", () => {
  const dir = mkdtempSync(join(tmpdir(), "cghc-json-mig-"));
  const settingsPath = join(dir, "settings.json");
  const doc = { ...defaultSettings(), general: { ...defaultSettings().general, theme: "light" as const } };
  writeFileSync(settingsPath, JSON.stringify(doc), "utf8");
  const db = openMemorySqliteDatabase();
  runMigrations(db);
  const result = migrateJsonSettingsToSqlite({
    settingsFilePath: settingsPath,
    settings: createSettingsRepository(db),
    appMeta: createAppMetaRepository(db),
  });
  assert.equal(result.imported, true);
  assert.equal(result.backedUp, true);
  assert.ok(existsSync(`${settingsPath}.migrated-backup`));
  assert.equal(existsSync(settingsPath), false);
  const stored = createSettingsRepository(db).getJson(SETTINGS_DOCUMENT_KEY);
  assert.ok(stored?.includes('"theme":"light"'));
  closeSqliteDatabase(db);
  rmSync(dir, { recursive: true, force: true });
});

test("provider + MS365 keyring secrets migrate after unlock; failed migration rolls back", async () => {
  const db = openMemorySqliteDatabase();
  runMigrations(db);
  const auth = createLocalAuthService({
    users: createLocalUserRepository(db),
    vaultKeys: createVaultKeyRepository(db),
  });
  await auth.setup("erin", "password12");
  const vault = createVaultCredentialStore({
    auth,
    secrets: createSecretsRepository(db),
  });
  const legacy = createMemoryStore();
  await legacy.set("profile:p1", "sk-provider-1");
  await legacy.set("provider:ms365", "ms365-token-xyz");

  const settings = {
    ...defaultSettings(),
    providers: [
      {
        providerId: "custom-openai-compat" as const,
        credentialRef: { store: "os" as const, account: "profile:p1" },
      },
    ],
    providerProfiles: [
      {
        id: "p1",
        displayName: "P1",
        providerType: "custom-openai-compat" as const,
        baseUrl: "https://api.example.test/v1",
        modelId: "m",
        envVar: "X",
        createdAt: "t",
        updatedAt: "t",
        credentialRef: { store: "os" as const, account: "profile:p1" },
      },
    ],
  };
  const accounts = collectCredentialAccounts(settings);
  assert.ok(accounts.includes("profile:p1"));
  assert.ok(accounts.includes("provider:ms365"));

  const appMeta = createAppMetaRepository(db);
  const migrated = await migrateKeyringSecretsToVault({
    auth,
    vault,
    legacy,
    appMeta,
    accounts,
  });
  assert.equal(migrated.migrated, true);
  assert.equal(await vault.get("profile:p1"), "sk-provider-1");
  assert.equal(await vault.get("provider:ms365"), "ms365-token-xyz");
  assert.equal(await legacy.get("profile:p1"), null);
  assert.equal(await legacy.get("provider:ms365"), null);

  // Second pass is a no-op.
  const again = await migrateKeyringSecretsToVault({
    auth,
    vault,
    legacy,
    appMeta,
    accounts,
  });
  assert.equal(again.reason, "already_migrated");

  // Failed verification rolls back vault writes and leaves legacy intact.
  const db2 = openMemorySqliteDatabase();
  runMigrations(db2);
  const auth2 = createLocalAuthService({
    users: createLocalUserRepository(db2),
    vaultKeys: createVaultKeyRepository(db2),
  });
  await auth2.setup("frank", "password12");
  const vault2 = createVaultCredentialStore({
    auth: auth2,
    secrets: createSecretsRepository(db2),
  });
  const legacy2 = createMemoryStore();
  await legacy2.set("profile:bad", "sk-original");
  let setCount = 0;
  const brokenVault: typeof vault2 = {
    kind: "vault",
    async set(account, secret) {
      setCount += 1;
      await vault2.set(account, secret);
    },
    async get(account) {
      if (account === "profile:bad") return "tampered";
      return vault2.get(account);
    },
    delete: (account) => vault2.delete(account),
  };
  await assert.rejects(
    () =>
      migrateKeyringSecretsToVault({
        auth: auth2,
        vault: brokenVault,
        legacy: legacy2,
        appMeta: createAppMetaRepository(db2),
        accounts: ["profile:bad"],
      }),
    /verification failed/i,
  );
  assert.equal(await legacy2.get("profile:bad"), "sk-original");
  assert.equal(await vault2.get("profile:bad"), null);
  assert.equal(createAppMetaRepository(db2).get("legacy.keyring_migrated"), null);
  assert.equal(setCount, 1);

  closeSqliteDatabase(db);
  closeSqliteDatabase(db2);
});

test("secret scrubber still redacts vault-stored values", async () => {
  const scrubber = createSecretScrubber();
  const db = openMemorySqliteDatabase();
  runMigrations(db);
  const auth = createLocalAuthService({
    users: createLocalUserRepository(db),
    vaultKeys: createVaultKeyRepository(db),
  });
  await auth.setup("gina", "password12");
  const vault = createVaultCredentialStore({
    auth,
    secrets: createSecretsRepository(db),
  });
  const secret = "sk-redact-me-999";
  await vault.set("profile:r", secret);
  scrubber.register(secret);
  assert.match(scrubber.scrub(`error ${secret} leaked`), /error \[REDACTED\] leaked/i);
  closeSqliteDatabase(db);
});

test("auth HTTP routes never return verifier or vault key", async () => {
  const db = openMemorySqliteDatabase();
  runMigrations(db);
  const { startCoworkService } = await import("../src/composition/index.js");
  const { running, deps } = await startCoworkService({ sqliteDatabase: db });
  assert.ok(deps.localAuth);
  const token = running.clientToken;
  const base = running.baseUrl;

  async function authCall(path: string, init?: RequestInit): Promise<{ ok: boolean; data?: unknown; error?: { message: string } }> {
    const headers: Record<string, string> = { authorization: `Bearer ${token}` };
    if (init?.body !== undefined) headers["content-type"] = "application/json";
    const res = await fetch(`${base}${path}`, { ...init, headers });
    return (await res.json()) as { ok: boolean; data?: unknown; error?: { message: string } };
  }

  const status = await authCall("/v1/auth/status");
  assert.equal(status.ok, true);
  const statusJson = JSON.stringify(status.data);
  assert.equal(statusJson.includes("passwordHash"), false);
  assert.equal(statusJson.includes("masterKey"), false);
  assert.equal(statusJson.includes("wrapped"), false);

  const setup = await authCall("/v1/auth/setup", {
    method: "POST",
    body: JSON.stringify({ username: "harry", password: "password12" }),
  });
  assert.equal(setup.ok, true);
  const unlocked = await authCall("/v1/auth/status");
  assert.equal(unlocked.ok, true);
  const unlockedJson = JSON.stringify(unlocked.data);
  assert.match(unlockedJson, /unlocked/);
  assert.equal(unlockedJson.includes("passwordHash"), false);
  assert.equal(unlockedJson.includes("wrapNonce"), false);

  await running.service.stop();
});

test("sqlite settings fs mirrors provider tables", async () => {
  const db = openMemorySqliteDatabase();
  runMigrations(db);
  const fs = createSqliteSettingsFs({
    settings: createSettingsRepository(db),
    profiles: createProviderProfileRepository(db),
    verifications: createProviderVerificationRepository(db),
  });
  const doc = {
    ...defaultSettings(),
    providerProfiles: [
      {
        id: "p1",
        displayName: "P1",
        providerType: "deepseek" as const,
        baseUrl: "https://api.deepseek.com/v1",
        modelId: "deepseek-chat",
        envVar: "DEEPSEEK_API_KEY",
        createdAt: "t",
        updatedAt: "t",
        lastVerifiedAt: "t",
        lastVerifiedOk: true,
        verifiedTargetFingerprint: "fp",
      },
    ],
  };
  await fs.write(JSON.stringify(doc));
  const profiles = db.prepare("SELECT id FROM provider_profiles").all();
  const verifications = db.prepare("SELECT profile_id FROM provider_verifications").all();
  assert.equal(profiles.length, 1);
  assert.equal(verifications.length, 1);
  closeSqliteDatabase(db);
});
