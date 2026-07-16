/** Maps workspace-relative paths to companion preview roles. */

import { isTextFilePath } from "@cowork-ghc/contracts";

export type WorkspaceFileRole =
  | "text"
  | "image"
  | "pdf"
  | "docx"
  | "spreadsheet"
  | "unsupported";

export function detectWorkspaceFileRole(relativePath: string): WorkspaceFileRole {
  const ext = relativePath.includes(".")
    ? relativePath.slice(relativePath.lastIndexOf(".")).toLowerCase()
    : "";
  if (ext === ".png" || ext === ".jpg" || ext === ".jpeg" || ext === ".webp") return "image";
  if (ext === ".pdf") return "pdf";
  if (ext === ".docx") return "docx";
  if (ext === ".xlsx") return "spreadsheet";
  // Text/code (incl. .txt/.md and code files) — shared with the service via isTextFilePath.
  if (isTextFilePath(relativePath)) return "text";
  return "unsupported";
}

export function isWorkspaceFileEditable(role: WorkspaceFileRole): boolean {
  return role === "text" || role === "spreadsheet";
}

const SECRET_BASENAMES = new Set([
  "id_rsa",
  "id_ed25519",
  "id_ecdsa",
  "id_dsa",
  ".npmrc",
  ".pypirc",
  "credentials.json",
]);

const SECRET_EXTENSIONS = new Set([".pem", ".key"]);

/**
 * Renderer-side mirror of the service secret-path policy
 * (`service/src/workspace/attachment-secret-policy.ts`). Used only to gate AUTO-open of a
 * mutated file — the service remains the authority for any actual read. A secret-like file is
 * never auto-opened even though the user may still open it manually.
 */
export function isSecretLikeWorkspacePath(relativePath: string): boolean {
  const normalized = relativePath.replace(/\\/g, "/").trim();
  if (normalized.length === 0) return false;
  const base = (normalized.split("/").pop() ?? "").toLowerCase();
  if (base === ".env" || base.startsWith(".env.")) return true;
  if (SECRET_BASENAMES.has(base)) return true;
  const dot = base.lastIndexOf(".");
  const ext = dot >= 0 ? base.slice(dot) : "";
  if (SECRET_EXTENSIONS.has(ext)) return true;
  if (/^service-account.*\.json$/u.test(base)) return true;
  return false;
}

/**
 * Whether a mutated workspace file is safe to AUTO-open in the companion preview: it must be a
 * supported previewable kind and must not be a secret-like/credential path. Unsupported types
 * and secrets can still be opened manually; they are just never force-opened by the agent flow.
 * (Oversize files are additionally handled at load time — the service returns `unsupported`.)
 */
export function isAutoOpenSafe(relativePath: string): boolean {
  if (isSecretLikeWorkspacePath(relativePath)) return false;
  return detectWorkspaceFileRole(relativePath) !== "unsupported";
}
