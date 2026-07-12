/**
 * Real `@napi-rs/keyring` round-trip test (CGHC-009 / ADR 0006 AC1) — GATED + graceful skip.
 *
 * This is the only test that touches the actual OS store. It SKIPS gracefully (documented)
 * when the native binding or Windows Credential Manager is unavailable in the sandbox — the
 * handle/ref/redaction/no-at-rest logic is fully covered by the in-memory fake regardless
 * (see credential-reference / credential-redaction). No key is ever logged.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { builtInProviderEnv } from "@cowork-ghc/runtime";
import {
  createCredentialService,
  createKeyringStore,
  keyringAvailable,
} from "../src/credential/index.js";

const REAL_KEY = "sk-keyring-roundtrip-DO-NOT-LEAK-777";
// A dedicated, throwaway provider id so this test never collides with a real credential.
const TEST_PROVIDER = "cghc009-keyring-selftest";

test("real Windows Credential Manager round-trip via @napi-rs/keyring", async (t) => {
  const available = await keyringAvailable();
  if (!available) {
    t.skip(
      "SKIPPED: @napi-rs/keyring native binding / Windows Credential Manager not available " +
        "in this environment. Handle/ref/redaction/no-at-rest logic is fully verified via the " +
        "in-memory fake (credential-reference / credential-redaction).",
    );
    return;
  }

  const store = await createKeyringStore();
  const service = createCredentialService({ store });

  const ref = await service.store({ providerId: TEST_PROVIDER, secret: REAL_KEY });
  try {
    assert.equal(ref.store, "os");

    // Resolve at the injection boundary from the REAL OS vault.
    const injection = await service.resolveInjection(ref, builtInProviderEnv("openai"));
    assert.equal(injection.value, REAL_KEY);
    assert.equal(injection.envVar, "OPENAI_API_KEY");
  } finally {
    // Always clean up the throwaway vault entry.
    const removed = await service.remove(ref);
    assert.equal(removed, true);
    assert.equal(await service.has(ref), false);
  }
});
