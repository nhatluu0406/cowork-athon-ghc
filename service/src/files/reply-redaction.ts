/**
 * Redaction for the live runtime-reply adapter's error path (CGHC-018, CGHC-016 review LOW-2).
 *
 * A raw transport (`fetch`) error commonly embeds the request URL — which for a permission reply
 * can carry the runtime base URL, the permission id, and (if ever placed there) query/token
 * material — plus header echoes. Before ANY such error reaches a reporter, a log, or a rethrow,
 * it is scrubbed here so no credential/URL/header/token substring escapes (security.md: secrets
 * never appear in logs or errors). The redactor is built from the adapter's OWN sensitive values
 * (base URL, bearer token, header values) AND applies generic URL/bearer patterns as a backstop.
 */

const REDACTED = "<redacted>";

/** Escape a string for safe use as a literal inside a RegExp. */
function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Extract a message from an unknown thrown value without surfacing a stack trace. */
function messageOf(err: unknown): string {
  if (typeof err === "string") return err;
  if (err instanceof Error && typeof err.message === "string") return err.message;
  if (err !== null && typeof err === "object" && "message" in err) {
    const value = (err as { message: unknown }).message;
    if (typeof value === "string") return value;
  }
  return "transport error";
}

export interface ReplyRedactorOptions {
  /** Exact sensitive strings to strip (base URL, bearer token, header values). */
  readonly secrets: readonly string[];
}

/**
 * A function that turns any thrown transport value into a secret-free, URL-free message. It first
 * removes every known sensitive substring, then applies generic patterns (a `Bearer <token>`
 * header echo, then any `scheme://…` URL) so an unforeseen URL/token shape is still masked.
 */
export type ReplyRedactor = (err: unknown) => string;

export function createReplyRedactor(options: ReplyRedactorOptions): ReplyRedactor {
  const secrets = options.secrets.filter((s) => s.length > 0).sort((a, b) => b.length - a.length);
  return (err: unknown): string => {
    let message = messageOf(err);
    // Generic patterns FIRST so a full URL (host + path, e.g. a permission id in the path) is
    // masked as one unit — before exact-secret substitution can break the URL apart and leave a
    // path remainder exposed. Mask a Bearer token echo before the bare-URL sweep.
    message = message.replace(/[Bb]earer\s+[A-Za-z0-9._~+/=-]+/g, `Bearer ${REDACTED}`);
    message = message.replace(/[a-zA-Z][a-zA-Z0-9+.-]*:\/\/\S+/g, REDACTED);
    // Exact known sensitive substrings (base URL, token, header value) as a final backstop.
    for (const secret of secrets) {
      message = message.replace(new RegExp(escapeRegExp(secret), "g"), REDACTED);
    }
    return message;
  };
}
