/**
 * Provider-key ingestion CLI commands (CGHC provider-key ingestion, SEC-1/SEC-2).
 *
 * The ONE safe local action a product owner runs to put a provider API key into the OS
 * credential store. Pure command logic with injected seams (`store`, `promptSecret`,
 * `emit`) so tests exercise it against an in-memory store + a fake prompt — never the real
 * vault or a real TTY. The secret is read ONLY from the hidden prompt: it never comes from
 * argv, an env var, or a file, and it is NEVER printed. Every emitted line is passed
 * through the shared value-based scrubber (CGHC-021) as defense in depth.
 *
 * Provider-neutral: the provider id is an argument (default: the custom OpenAI-compatible
 * endpoint). No single vendor is hard-coded. This command only STORES a key; it performs
 * no network call and never writes OpenCode `auth.json`/`env.json` (that is CGHC-011/024).
 */

import {
  createCredentialService,
  type CredentialLog,
} from "./credential-service.js";
import {
  CredentialStoreError,
  credentialAccountFor,
  credentialRef,
  type CredentialStore,
} from "./store.js";
import { CUSTOM_OPENAI_COMPAT_ID } from "../provider/descriptors.js";

/** Reads a secret from a hidden source. Production = a no-echo TTY prompt; tests = a fake. */
export type PromptSecret = (promptText: string) => Promise<string>;

/** A non-secret output sink (stdout in production). Lines are scrubbed before they reach it. */
export type EmitLine = (line: string) => void;

/** Injected seams so command logic never touches the real vault or a real TTY in tests. */
export interface CliDeps {
  readonly store: CredentialStore;
  readonly promptSecret: PromptSecret;
  readonly emit: EmitLine;
}

/** Exit codes — honest and specific; success is 0 and every failure is non-zero. */
export const EXIT = {
  OK: 0,
  USAGE: 2,
  EMPTY_SECRET: 3,
  ABORTED: 4,
  STORE_ERROR: 5,
} as const;

/**
 * Normalize a provider-id argument. Omitted or the friendly alias `custom` resolves to the
 * user-defined OpenAI-compatible endpoint id; anything else is used verbatim (and validated
 * downstream by {@link credentialAccountFor}). DeepSeek etc. is just a provider id passed in.
 */
export function resolveProviderId(arg: string | undefined): string {
  const raw = (arg ?? "").trim();
  if (raw === "" || raw.toLowerCase() === "custom") return CUSTOM_OPENAI_COMPAT_ID;
  return raw;
}

/** Build a service over the injected store whose emit sink is scrubbed by the same scrubber. */
function serviceFor(deps: CliDeps): {
  readonly service: ReturnType<typeof createCredentialService>;
  readonly emitSafe: EmitLine;
} {
  const audit: CredentialLog = () => {
    /* audit lines stay internal; the CLI prints its own clean confirmation */
  };
  const service = createCredentialService({ store: deps.store, log: audit });
  // Defense in depth: scrub every user-facing line with the SAME scrubber the secret is
  // registered into on store(), so a secret can never survive into stdout even by mistake.
  const emitSafe: EmitLine = (line) => deps.emit(service.scrubber.scrub(line));
  return { service, emitSafe };
}

/**
 * `set <providerId>` — read the secret from the hidden prompt and store it in the OS vault.
 * The token is never taken from argv/env/file and never printed; only a masked confirmation
 * (provider id + account handle + character count) is emitted.
 */
export async function runSet(deps: CliDeps, providerIdArg?: string): Promise<number> {
  const providerId = resolveProviderId(providerIdArg);
  let account: string;
  try {
    account = credentialAccountFor(providerId);
  } catch (err) {
    deps.emit(`error: ${messageOf(err)}`);
    return EXIT.USAGE;
  }

  const { service, emitSafe } = serviceFor(deps);
  let secret: string;
  try {
    secret = await deps.promptSecret(`Enter API key for provider "${providerId}" (hidden): `);
  } catch (err) {
    // A thrown/aborted prompt (Ctrl+C, no TTY) stores NOTHING.
    emitSafe(`aborted: ${messageOf(err)}`);
    return EXIT.ABORTED;
  }

  const trimmed = stripSingleTrailingNewline(secret);
  if (trimmed.length === 0) {
    emitSafe("error: empty secret rejected — nothing was stored.");
    return EXIT.EMPTY_SECRET;
  }

  try {
    const ref = await service.store({ providerId, secret: trimmed });
    // NOTE: `trimmed` is now registered in the scrubber (service.store did so). We never
    // print it — only its length, as an explicitly-requested masked confirmation.
    emitSafe(
      `stored: provider=${providerId} account=${ref.account} (stored ${trimmed.length} chars)`,
    );
    return EXIT.OK;
  } catch (err) {
    emitSafe(`error: could not store credential (${errorKind(err)}).`);
    return EXIT.STORE_ERROR;
  }
}

/** `status <providerId>` — report whether a key is stored (yes/no). Never reveals the value. */
export async function runStatus(deps: CliDeps, providerIdArg?: string): Promise<number> {
  const providerId = resolveProviderId(providerIdArg);
  const { service, emitSafe } = serviceFor(deps);
  try {
    const account = credentialAccountFor(providerId);
    const stored = await service.has(credentialRef(account));
    emitSafe(`status: provider=${providerId} account=${account} stored=${stored ? "yes" : "no"}`);
    return EXIT.OK;
  } catch (err) {
    emitSafe(`error: ${errorKind(err)}`);
    return EXIT.USAGE;
  }
}

/** `remove <providerId>` — delete the stored key; confirm removed=true/false. */
export async function runRemove(deps: CliDeps, providerIdArg?: string): Promise<number> {
  const providerId = resolveProviderId(providerIdArg);
  const { service, emitSafe } = serviceFor(deps);
  try {
    const account = credentialAccountFor(providerId);
    const removed = await service.remove(credentialRef(account));
    emitSafe(`remove: provider=${providerId} account=${account} removed=${String(removed)}`);
    return EXIT.OK;
  } catch (err) {
    emitSafe(`error: ${errorKind(err)}`);
    return EXIT.USAGE;
  }
}

/** Trim exactly one trailing CR/LF (or CRLF) — a value pasted with a newline is common. */
function stripSingleTrailingNewline(value: string): string {
  if (value.endsWith("\r\n")) return value.slice(0, -2);
  if (value.endsWith("\n") || value.endsWith("\r")) return value.slice(0, -1);
  return value;
}

/** A safe, secret-free error label. Never includes a message that might embed input. */
function errorKind(err: unknown): string {
  if (err instanceof CredentialStoreError) return "store error";
  if (err instanceof Error) return err.name;
  return "error";
}

/** A safe message for prompt/usage errors (these carry no secret material). */
function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
