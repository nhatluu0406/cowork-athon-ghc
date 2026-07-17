/**
 * Shared attachment size limits (mirrored from service for UI budgeting).
 *
 * DISPATCH_MAX_CHARS is Cowork's outbound assembly ceiling (system + prior turns +
 * Skills + attachments + user request). It is intentionally below typical cloud
 * context windows (128k–1M+ tokens) so multi-turn packing stays predictable and
 * fail-fast, not a substitute for provider token limits.
 */

export const ATTACHMENT_MAX_FILE_BYTES = 32 * 1024;
export const ATTACHMENT_MAX_TOTAL_BYTES = 64 * 1024;
/** ~12k tokens worth of characters — still a small slice of modern API windows. */
export const DISPATCH_MAX_CHARS = 48_000;
