/**
 * Provider-key ingestion CLI tests (CGHC provider-key ingestion, SEC-1/SEC-2).
 *
 * All against an INJECTED in-memory store + a FAKE hidden prompt — never the real vault,
 * never a real TTY. Proves: (1) set -> status -> remove round-trip; (2) the secret NEVER
 * surfaces in any emitted line, even when scrubbed; (3) an empty secret is rejected and
 * stores nothing; (4) an aborted prompt (Ctrl+C) stores nothing; (5) the command signature
 * carries only a providerId, so no secret can ride on argv.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { createMemoryStore } from "../src/credential/memory-store.js";
import { credentialAccountFor, type CredentialStore } from "../src/credential/store.js";
import {
  EXIT,
  runRemove,
  runSet,
  runStatus,
  resolveProviderId,
  type CliDeps,
  type PromptSecret,
} from "../src/credential/cli-commands.js";
import { CUSTOM_OPENAI_COMPAT_ID } from "../src/provider/descriptors.js";
import { createSecretScrubber, REDACTION_PLACEHOLDER } from "../src/diagnostics/index.js";

const SECRET = "sk-deepseek-DO-NOT-LEAK-abcdef0123456789";

/** A recording harness: an in-memory store, captured emitted lines, and a scriptable prompt. */
function harness(prompt: PromptSecret, store: CredentialStore = createMemoryStore()): {
  deps: CliDeps;
  lines: string[];
  store: CredentialStore;
} {
  const lines: string[] = [];
  const deps: CliDeps = {
    store,
    promptSecret: prompt,
    emit: (line) => lines.push(line),
  };
  return { deps, lines, store };
}

const promptReturning =
  (value: string): PromptSecret =>
  () =>
    Promise.resolve(value);

const promptAborting =
  (err: Error): PromptSecret =>
  () =>
    Promise.reject(err);

test("set -> status -> remove round-trip (memory store + fake prompt, no TTY, no vault)", async () => {
  const { deps, lines, store } = harness(promptReturning(SECRET));

  // status before set: not stored
  assert.equal(await runStatus(deps, "custom"), EXIT.OK);
  assert.ok(lines.at(-1)?.includes("stored=no"));

  // set
  assert.equal(await runSet(deps, "custom"), EXIT.OK);
  const account = credentialAccountFor(CUSTOM_OPENAI_COMPAT_ID);
  assert.ok(lines.at(-1)?.startsWith("stored:"));
  assert.ok(lines.at(-1)?.includes(`account=${account}`));
  assert.ok(lines.at(-1)?.includes(`stored ${SECRET.length} chars`));
  // The value IS in the injected store (proves it was actually stored).
  assert.equal(await store.get(account), SECRET);

  // status after set: stored
  assert.equal(await runStatus(deps, "custom"), EXIT.OK);
  assert.ok(lines.at(-1)?.includes("stored=yes"));

  // remove
  assert.equal(await runRemove(deps, "custom"), EXIT.OK);
  assert.ok(lines.at(-1)?.includes("removed=true"));
  assert.equal(await store.get(account), null);

  // remove again: removed=false (nothing there)
  assert.equal(await runRemove(deps, "custom"), EXIT.OK);
  assert.ok(lines.at(-1)?.includes("removed=false"));
});

test("the secret NEVER appears in any emitted line (all subcommands)", async () => {
  const { deps, lines } = harness(promptReturning(SECRET));
  await runSet(deps, "custom");
  await runStatus(deps, "custom");
  await runRemove(deps, "custom");
  for (const line of lines) {
    assert.ok(!line.includes(SECRET), `emitted line leaked the secret: ${line}`);
  }
  // And the emitted confirmation is non-empty (we did print something).
  assert.ok(lines.some((l) => l.startsWith("stored:")));
});

test("emit sink is wrapped by the value-based scrubber (a leaked line would be masked)", async () => {
  // The command's emit sink is wrapped by the SAME scrubber the secret is registered into
  // on store(). We prove the mechanism directly: the scrubber the CLI uses (CGHC-021)
  // replaces the value by a placeholder wherever it appears as a substring.
  const scrubber = createSecretScrubber();
  scrubber.register(SECRET);
  const masked = scrubber.scrub(`accidental: value=${SECRET} in a log line`);
  assert.ok(!masked.includes(SECRET), "the scrubber must remove the raw value");
  assert.ok(masked.includes(REDACTION_PLACEHOLDER));

  // And end-to-end: no real emitted line ever carries the value regardless.
  const { deps, lines } = harness(promptReturning(SECRET));
  await runSet(deps, "custom");
  await runStatus(deps, "custom");
  assert.ok(lines.every((l) => !l.includes(SECRET)));
});

test("empty secret is rejected and stores NOTHING", async () => {
  const { deps, lines, store } = harness(promptReturning(""));
  const code = await runSet(deps, "custom");
  assert.equal(code, EXIT.EMPTY_SECRET);
  assert.ok(lines.at(-1)?.toLowerCase().includes("empty secret"));
  assert.equal(await store.get(credentialAccountFor(CUSTOM_OPENAI_COMPAT_ID)), null);
});

test("whitespace/newline-only secret is rejected and stores NOTHING", async () => {
  const { deps, store } = harness(promptReturning("\r\n"));
  const code = await runSet(deps, "custom");
  assert.equal(code, EXIT.EMPTY_SECRET);
  assert.equal(await store.get(credentialAccountFor(CUSTOM_OPENAI_COMPAT_ID)), null);
});

test("aborted prompt (Ctrl+C) stores NOTHING and exits non-zero", async () => {
  const abort = new Error("Secret entry aborted by the user.");
  abort.name = "SecretPromptAbortedError";
  const { deps, lines, store } = harness(promptAborting(abort));
  const code = await runSet(deps, "custom");
  assert.equal(code, EXIT.ABORTED);
  assert.notEqual(code, EXIT.OK);
  assert.ok(lines.at(-1)?.startsWith("aborted:"));
  assert.equal(await store.get(credentialAccountFor(CUSTOM_OPENAI_COMPAT_ID)), null);
});

test("a trailing CRLF from the prompt is trimmed before storing", async () => {
  const { deps, store } = harness(promptReturning(`${SECRET}\r\n`));
  assert.equal(await runSet(deps, "custom"), EXIT.OK);
  assert.equal(await store.get(credentialAccountFor(CUSTOM_OPENAI_COMPAT_ID)), SECRET);
});

test("provider id is an argument (default = custom), never a secret; DeepSeek is not hard-coded", () => {
  assert.equal(resolveProviderId(undefined), CUSTOM_OPENAI_COMPAT_ID);
  assert.equal(resolveProviderId("custom"), CUSTOM_OPENAI_COMPAT_ID);
  assert.equal(resolveProviderId("openai"), "openai");
  // The command functions accept ONLY a providerId string — never a secret parameter.
  assert.equal(runSet.length, 2); // (deps, providerIdArg)
  assert.equal(runStatus.length, 2);
  assert.equal(runRemove.length, 2);
});

test("argv can carry no secret: a provider-scoped id is stored under its account, value only in the store", async () => {
  // Emulate `set deepseek` where `deepseek` is a provider id (NOT a secret) on argv.
  const { deps, store, lines } = harness(promptReturning(SECRET));
  assert.equal(await runSet(deps, "deepseek"), EXIT.OK);
  const account = credentialAccountFor("deepseek");
  assert.equal(await store.get(account), SECRET);
  // The provider id (safe) may appear; the secret (unsafe) never does.
  assert.ok(lines.at(-1)?.includes("provider=deepseek"));
  assert.ok(lines.every((l) => !l.includes(SECRET)));
});
