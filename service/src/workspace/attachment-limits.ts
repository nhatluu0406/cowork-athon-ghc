/**
 * Bounded limits for workspace text-file attachments (Phase 1).
 *
 * All attachment budgeting flows through these constants — no magic numbers elsewhere.
 */

/** Maximum bytes read from a single attachment file. */
export const ATTACHMENT_MAX_FILE_BYTES = 32 * 1024;

/** Maximum total bytes of attachment content injected into one dispatch prompt. */
export const ATTACHMENT_MAX_TOTAL_BYTES = 64 * 1024;

/** Maximum characters for the full outbound dispatch (prior turns + attachments + user request).
 * App assembly budget only — not the cloud provider context window. Keep UI/service mirrors in sync. */
export const DISPATCH_MAX_CHARS = 48_000;

/** Text file extensions allowed for Phase 1 workspace attachments. */
export const ATTACHMENT_TEXT_EXTENSIONS = new Set([
  ".txt",
  ".md",
  ".json",
  ".yaml",
  ".yml",
  ".csv",
  ".log",
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
  ".py",
  ".rb",
  ".go",
  ".rs",
  ".java",
  ".kt",
  ".cs",
  ".cpp",
  ".c",
  ".h",
  ".hpp",
  ".sql",
  ".sh",
  ".bat",
  ".ps1",
  ".xml",
  ".html",
  ".htm",
  ".css",
  ".scss",
  ".toml",
  ".ini",
  ".env",
  ".gitignore",
  ".dockerfile",
]);
