/** Maps workspace-relative paths to companion preview roles. */

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
  if (ext === ".txt" || ext === ".md") return "text";
  if (ext === ".png" || ext === ".jpg" || ext === ".jpeg" || ext === ".webp") return "image";
  if (ext === ".pdf") return "pdf";
  if (ext === ".docx") return "docx";
  if (ext === ".xlsx") return "spreadsheet";
  return "unsupported";
}

export function isWorkspaceFileEditable(role: WorkspaceFileRole): boolean {
  return role === "text" || role === "spreadsheet";
}
