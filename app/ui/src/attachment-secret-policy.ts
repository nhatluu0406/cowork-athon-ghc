/**
 * Secret-like attachment filename/path policy (mirrors service; pre-read, deterministic).
 */

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

export const SECRET_ATTACHMENT_MESSAGE =
  "File này có thể chứa credential hoặc secret và không được phép đính kèm.";

function basename(path: string): string {
  const parts = path.replace(/\\/g, "/").split("/");
  return parts[parts.length - 1] ?? path;
}

/** True when a workspace-relative path matches the MVP secret-like deny policy. */
export function isSecretLikeAttachmentPath(relativePath: string): boolean {
  const normalized = relativePath.replace(/\\/g, "/").trim();
  if (normalized.length === 0) return false;

  const base = basename(normalized);
  const lowerBase = base.toLowerCase();

  if (lowerBase === ".env" || lowerBase.startsWith(".env.")) return true;
  if (SECRET_BASENAMES.has(lowerBase)) return true;

  const dot = lowerBase.lastIndexOf(".");
  const ext = dot >= 0 ? lowerBase.slice(dot) : "";
  if (SECRET_EXTENSIONS.has(ext)) return true;

  if (lowerBase === "credentials.json") return true;
  if (/^service-account.*\.json$/u.test(lowerBase)) return true;

  return false;
}
