/**
 * Bounded limits for file review snapshots and diffs.
 */

/** Max bytes read for a before/after snapshot at mutation time. */
export const FILE_REVIEW_MAX_SNAPSHOT_BYTES = 64 * 1024;

/** Max bytes returned for a single-side preview in review UI. */
export const FILE_REVIEW_MAX_PREVIEW_BYTES = 64 * 1024;

/** Max characters in a generated unified diff artifact. */
export const FILE_REVIEW_MAX_DIFF_CHARS = 32 * 1024;

/** Max lines considered when building a diff (each side). */
export const FILE_REVIEW_MAX_DIFF_LINES = 500;
