/**
 * Shared classification for text/code files the Workspace Companion can preview and edit.
 *
 * This is the SINGLE source of truth for "which files are text" so the service (which reads
 * and returns the content) and the renderer (which picks an icon, gates auto-open, and chooses
 * a syntax-highlight language) can never drift apart — a drift that previously left every code
 * file classified as "unsupported". Pure data + pure functions: no Node, no DOM, so both the
 * service and the UI bundle import it directly.
 *
 * Secrets are intentionally NOT here: `.env`/`.env.*` (matched by basename elsewhere) and
 * `.pem`/`.key` are deliberately excluded so extending text support never turns a credential
 * file into a preview. Binary/office kinds (image/pdf/docx/xlsx) are handled on their own paths.
 */

/** Lower-cased extension (with leading dot) → canonical highlight language id (highlight.js). */
const EXTENSION_LANGUAGE: Readonly<Record<string, string>> = {
  // Plain prose / docs
  ".txt": "plaintext",
  ".text": "plaintext",
  ".log": "plaintext",
  ".md": "markdown",
  ".markdown": "markdown",
  ".mdx": "markdown",
  ".rst": "plaintext",
  ".adoc": "plaintext",
  ".tex": "latex",
  // JS / TS family
  ".js": "javascript",
  ".mjs": "javascript",
  ".cjs": "javascript",
  ".jsx": "javascript",
  ".ts": "typescript",
  ".mts": "typescript",
  ".cts": "typescript",
  ".tsx": "typescript",
  ".vue": "xml",
  ".svelte": "xml",
  ".astro": "xml",
  // Python
  ".py": "python",
  ".pyw": "python",
  ".pyi": "python",
  // C / C++ / C# / Objective-C
  ".c": "c",
  ".h": "cpp",
  ".cpp": "cpp",
  ".cc": "cpp",
  ".cxx": "cpp",
  ".hpp": "cpp",
  ".hh": "cpp",
  ".hxx": "cpp",
  ".ino": "cpp",
  ".cs": "csharp",
  ".m": "objectivec",
  ".mm": "objectivec",
  // Other mainstream languages
  ".java": "java",
  ".kt": "kotlin",
  ".kts": "kotlin",
  ".go": "go",
  ".rs": "rust",
  ".rb": "ruby",
  ".php": "php",
  ".swift": "swift",
  ".scala": "scala",
  ".dart": "dart",
  ".lua": "lua",
  ".pl": "perl",
  ".pm": "perl",
  ".r": "r",
  ".jl": "julia",
  ".hs": "haskell",
  ".ex": "elixir",
  ".exs": "elixir",
  ".erl": "erlang",
  ".clj": "clojure",
  ".groovy": "groovy",
  ".gradle": "groovy",
  // Shell / scripts
  ".sh": "bash",
  ".bash": "bash",
  ".zsh": "bash",
  ".fish": "bash",
  ".ps1": "powershell",
  ".bat": "dos",
  ".cmd": "dos",
  // Markup / style
  ".html": "xml",
  ".htm": "xml",
  ".xhtml": "xml",
  ".xml": "xml",
  ".svg": "xml",
  ".css": "css",
  ".scss": "scss",
  ".sass": "scss",
  ".less": "less",
  // Data / config
  ".json": "json",
  ".jsonc": "json",
  ".json5": "json",
  ".yaml": "yaml",
  ".yml": "yaml",
  ".toml": "ini",
  ".ini": "ini",
  ".cfg": "ini",
  ".conf": "ini",
  ".properties": "ini",
  ".editorconfig": "ini",
  ".env.example": "bash",
  ".csv": "plaintext",
  ".tsv": "plaintext",
  ".sql": "sql",
  ".graphql": "graphql",
  ".gql": "graphql",
  ".diff": "diff",
  ".patch": "diff",
};

/** Extension-less basenames (lower-cased) that are text/config. */
const EXTENSIONLESS_TEXT_BASENAMES: Readonly<Record<string, string>> = {
  dockerfile: "dockerfile",
  makefile: "makefile",
  ".gitignore": "plaintext",
  ".gitattributes": "plaintext",
  ".dockerignore": "plaintext",
  ".editorconfig": "ini",
  ".prettierrc": "json",
  ".babelrc": "json",
  ".eslintrc": "json",
};

/** The full set of previewable text/code extensions (with leading dot). */
export const TEXT_FILE_EXTENSIONS: ReadonlySet<string> = new Set(Object.keys(EXTENSION_LANGUAGE));

function basename(path: string): string {
  const normalized = path.replace(/\\/g, "/");
  return (normalized.split("/").pop() ?? "").toLowerCase();
}

/** Lower-cased extension including the dot (e.g. ".py"), or "" for an extension-less name. */
function extname(path: string): string {
  const base = basename(path);
  const dot = base.lastIndexOf(".");
  // A leading-dot dotfile (".gitignore") has no extension for our purposes.
  return dot > 0 ? base.slice(dot) : "";
}

/**
 * Whether a workspace-relative path is a previewable text/code file. Matches by extension first,
 * then by a small set of extension-less config basenames. Secrets are never text (see file note).
 */
export function isTextFilePath(path: string): boolean {
  const ext = extname(path);
  if (ext !== "" && Object.prototype.hasOwnProperty.call(EXTENSION_LANGUAGE, ext)) return true;
  return Object.prototype.hasOwnProperty.call(EXTENSIONLESS_TEXT_BASENAMES, basename(path));
}

/**
 * Canonical highlight-language id (highlight.js) for a text/code path, or `undefined` when the
 * content should render as plain text (unknown/plain kinds). Never throws.
 */
export function languageForPath(path: string): string | undefined {
  const ext = extname(path);
  const byExt = ext !== "" ? EXTENSION_LANGUAGE[ext] : undefined;
  const lang = byExt ?? EXTENSIONLESS_TEXT_BASENAMES[basename(path)];
  if (lang === undefined || lang === "plaintext") return undefined;
  return lang;
}
