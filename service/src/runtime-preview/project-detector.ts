/**
 * Project detector for the preview runner. Inspects the active workspace ROOT (already the
 * confinement boundary) for previewable capability and reports it HONESTLY:
 *  - a root-level `index.html` → static preview candidate;
 *  - a `package.json` with a recognised dev script → dev-server candidate;
 *  - neither → `unsupported` (the runner will refuse; the UI shows a clear empty state).
 *
 * Reads are limited to a handful of well-known files directly at the root; it never walks the
 * tree and never executes anything.
 */

import { readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import type {
  RuntimePreviewPackageManager,
  RuntimePreviewProjectInfo,
} from "@cowork-ghc/contracts";

/** Dev-server script names we recognise, in preference order. */
const DEV_SCRIPT_CANDIDATES: readonly string[] = ["dev", "start", "serve", "preview"];

/** Cap the package.json we will parse (a malformed/huge manifest must not stall detection). */
const MAX_PACKAGE_JSON_BYTES = 512 * 1024;

async function fileExists(path: string): Promise<boolean> {
  try {
    const s = await stat(path);
    return s.isFile();
  } catch {
    return false;
  }
}

async function detectPackageManager(root: string): Promise<RuntimePreviewPackageManager | null> {
  if (await fileExists(join(root, "pnpm-lock.yaml"))) return "pnpm";
  if (await fileExists(join(root, "yarn.lock"))) return "yarn";
  if (await fileExists(join(root, "package-lock.json"))) return "npm";
  return null;
}

interface ParsedScripts {
  readonly scripts: readonly string[];
  readonly malformed: boolean;
}

async function parseScripts(packageJsonPath: string): Promise<ParsedScripts> {
  let raw: string;
  try {
    const s = await stat(packageJsonPath);
    if (!s.isFile() || s.size > MAX_PACKAGE_JSON_BYTES) return { scripts: [], malformed: false };
    raw = await readFile(packageJsonPath, "utf8");
  } catch {
    return { scripts: [], malformed: false };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { scripts: [], malformed: true };
  }
  if (parsed === null || typeof parsed !== "object") return { scripts: [], malformed: true };
  const scriptsField = (parsed as { scripts?: unknown }).scripts;
  if (scriptsField === null || typeof scriptsField !== "object") return { scripts: [], malformed: false };
  const available = new Set(Object.keys(scriptsField as Record<string, unknown>));
  const scripts = DEV_SCRIPT_CANDIDATES.filter((name) => available.has(name));
  return { scripts, malformed: false };
}

/** Inspect a workspace root and report previewable capability. Never throws. */
export async function detectPreviewProject(root: string): Promise<RuntimePreviewProjectInfo> {
  const packageJsonPath = join(root, "package.json");
  const [hasStaticIndex, hasPackageJson] = await Promise.all([
    fileExists(join(root, "index.html")),
    fileExists(packageJsonPath),
  ]);

  const { scripts: devScripts, malformed } = hasPackageJson
    ? await parseScripts(packageJsonPath)
    : { scripts: [] as readonly string[], malformed: false };

  const detectedPm = hasPackageJson ? await detectPackageManager(root) : null;
  const packageManager: RuntimePreviewPackageManager | null =
    devScripts.length > 0 ? (detectedPm ?? "npm") : detectedPm;

  if (devScripts.length > 0) {
    return {
      kind: "dev-server",
      hasStaticIndex,
      hasPackageJson,
      packageJsonMalformed: malformed,
      devScripts,
      packageManager,
    };
  }
  if (hasStaticIndex) {
    return {
      kind: "static",
      hasStaticIndex,
      hasPackageJson,
      packageJsonMalformed: malformed,
      devScripts,
      packageManager,
    };
  }

  const reason = malformed
    ? "package.json không đọc được (malformed) và không có index.html để xem tĩnh."
    : hasPackageJson
      ? "Không tìm thấy script dev/start/serve/preview trong package.json và không có index.html."
      : "Không phải dự án web: thiếu index.html và package.json.";
  return {
    kind: "unsupported",
    hasStaticIndex,
    hasPackageJson,
    packageJsonMalformed: malformed,
    devScripts,
    packageManager,
    reason,
  };
}
