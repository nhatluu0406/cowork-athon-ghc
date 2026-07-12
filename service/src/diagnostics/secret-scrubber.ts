/**
 * Value-based, free-form secret scrubber (ADR 0006 SEC-2, PR8/SD3).
 *
 * The reference redacts secrets by the ENV-VAR NAME (`SECRET_ENV_PATTERN.test(name)`),
 * which leaks the value anywhere the same secret appears outside a recognized name — a
 * message body, a stack frame, a URL query, a serialized config, a command line. Cowork
 * GHC's scrubber therefore matches the secret VALUE itself, as a SUBSTRING of any
 * free-form string, and replaces it with a fixed placeholder everywhere it surfaces.
 *
 * Scope contrast: `runtime/src/redact.ts` does whole-value equality on ENV MAPS only
 * (each map value is a complete field). THIS module is the free-form substring scrubber
 * that env-map helper explicitly delegates to CGHC-021.
 *
 * The value-bearing secret type is deliberately kept SERVICE-PRIVATE here: the shared
 * `core/contracts` barrel never exports a plaintext-secret-carrying redaction type
 * (see `core/contracts/src/provider.ts` secret-discipline note). Secret VALUES are
 * registered at the boundary from the credential layer — never hard-coded.
 */

/** Fixed, non-reversible placeholder written in place of a matched secret value. */
export const REDACTION_PLACEHOLDER = "[REDACTED]";

/**
 * Secret values shorter than this are ignored. A 1–3 char "secret" would match huge
 * amounts of ordinary text and destroy the diagnostics it is meant to protect; a real
 * provider key is far longer. Matches the reference's `secret.length < 4` guard.
 */
export const MIN_SECRET_LENGTH = 4;

/**
 * A service-private, value-bearing secret registration. `value` is plaintext key
 * material and MUST NEVER be logged, serialized, or crossed to `core/contracts`; only
 * the optional non-secret `label` (e.g. the env-var name it came from) is safe to show.
 */
export interface RegisteredSecret {
  /** Plaintext secret value to scrub as a substring. Never log this. */
  readonly value: string;
  /** Optional non-secret provenance label (e.g. `OPENAI_API_KEY`). Safe to display. */
  readonly label?: string;
}

/** A secret registration accepted by {@link SecretScrubber.register}. */
export type SecretInput = string | RegisteredSecret;

/**
 * Value-based free-form scrubber. Register known secret VALUES, then scrub any string,
 * object graph, or JSON — the concrete value is replaced by {@link REDACTION_PLACEHOLDER}
 * wherever it appears as a substring.
 */
export interface SecretScrubber {
  /** Register secret VALUES (from the credential layer). Empty/too-short values are ignored. */
  register(...secrets: readonly SecretInput[]): void;
  /** Replace every registered secret value found as a substring of `text`. */
  scrub(text: string): string;
  /** Deep-copy `value`, scrubbing every string it contains (arrays + plain objects). */
  scrubDeep<T>(value: T): T;
  /** Serialize `value` to JSON and scrub the result (strongest, catches every string). */
  scrubJson(value: unknown, space?: number): string;
  /** True if any registered secret value appears as a substring of `text`. */
  containsSecret(text: string): boolean;
  /** Count of distinct registered (accepted) secret values. */
  readonly size: number;
}

class SecretScrubberImpl implements SecretScrubber {
  private readonly values = new Set<string>();
  /** Cache of secrets sorted longest-first so overlapping secrets scrub deterministically. */
  private sorted: string[] = [];

  get size(): number {
    return this.values.size;
  }

  register(...secrets: readonly SecretInput[]): void {
    let changed = false;
    for (const secret of secrets) {
      const value = typeof secret === "string" ? secret : secret.value;
      if (value.length < MIN_SECRET_LENGTH) continue; // ignore empty/too-short (safety)
      if (!this.values.has(value)) {
        this.values.add(value);
        changed = true;
      }
    }
    if (changed) {
      this.sorted = [...this.values].sort((a, b) => b.length - a.length);
    }
  }

  scrub(text: string): string {
    let output = text;
    for (const secret of this.sorted) {
      if (output.includes(secret)) {
        output = output.split(secret).join(REDACTION_PLACEHOLDER);
      }
    }
    return output;
  }

  containsSecret(text: string): boolean {
    return this.sorted.some((secret) => text.includes(secret));
  }

  scrubDeep<T>(value: T): T {
    return this.walk(value, new WeakSet<object>()) as T;
  }

  scrubJson(value: unknown, space = 2): string {
    // Sound serialization: `scrubDeep` first makes the graph cycle-safe, preserves Error
    // detail, and scrubs every RAW string BEFORE JSON escaping. The stringify replacer is
    // the belt-and-suspenders second scrub (catches strings produced by a `toJSON`), again
    // on the un-escaped value — so a secret containing `"`, `\`, newline, or a control char
    // is still matched. Any residual serialization failure degrades to a safe redacted
    // placeholder instead of throwing out of a security-critical path.
    try {
      const safe = this.walk(value, new WeakSet<object>());
      const json = JSON.stringify(
        safe,
        (_key: string, item: unknown) => (typeof item === "string" ? this.scrub(item) : item),
        space,
      );
      return json ?? "";
    } catch {
      return JSON.stringify({ diagnostics: "[unserializable value — redacted]" }, null, space) ?? "";
    }
  }

  /**
   * Deep-copy while scrubbing every string. `seen` breaks reference cycles (a revisited
   * node becomes a `[Circular]` sentinel — it was already scrubbed on first visit), so
   * neither this walk nor a later `JSON.stringify` can throw on a circular graph.
   */
  private walk(value: unknown, seen: WeakSet<object>): unknown {
    if (typeof value === "string") return this.scrub(value);
    if (value === null || typeof value !== "object") return value;
    if (seen.has(value)) return "[Circular]";
    seen.add(value);
    // Preserve Error detail: `message`/`stack` are non-enumerable, so `Object.entries`
    // would drop them (the diagnostic vanishes). Special-case + scrub them.
    if (value instanceof Error) return this.walkError(value);
    const toJson = (value as { toJSON?: unknown }).toJSON;
    if (typeof toJson === "function") {
      return this.walk((value as { toJSON: () => unknown }).toJSON(), seen);
    }
    if (Array.isArray(value)) return value.map((item) => this.walk(item, seen));
    const out: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      out[this.scrub(key)] = this.walk(item, seen); // scrub keys too (keyed coverage)
    }
    return out;
  }

  private walkError(err: Error): Record<string, unknown> {
    return {
      name: this.scrub(err.name),
      message: this.scrub(err.message),
      stack: this.scrub(err.stack ?? ""),
    };
  }
}

/** Create a fresh, empty scrubber. Register secret VALUES before scrubbing. */
export function createSecretScrubber(initial: readonly SecretInput[] = []): SecretScrubber {
  const scrubber = new SecretScrubberImpl();
  if (initial.length > 0) scrubber.register(...initial);
  return scrubber;
}
