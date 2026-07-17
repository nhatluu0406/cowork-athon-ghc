/**
 * Desktop-app detector for the app runner (Code surface — desktop app launch, Slice 2).
 *
 * Inspects the active workspace ROOT (already the confinement boundary) for a SAFE, unambiguous
 * desktop-app launch capability and reports it HONESTLY:
 *  - an `electron` dependency (in dependencies/devDependencies) AND at least one recognised run
 *    script → an `electron` app the runner can launch with `<pm> run <script>`;
 *  - anything else → `unsupported` (the runner refuses; the UI shows a clear empty state).
 *
 * A bare Node process or a loose packaged executable is intentionally NOT auto-claimed as a
 * desktop app — that guesswork would either overclaim capability or invite launching an
 * arbitrary executable. Reads are limited to `package.json` + lockfiles at the root; it never
 * walks the tree and never executes anything. Never throws.
 */

import { readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import type {
  RuntimeAppProjectInfo,
  RuntimePreviewPackageManager,
} from "@cowork-ghc/contracts";

/** Scripts that LAUNCH the app, in preference order. */
const RUN_SCRIPT_CANDIDATES: readonly string[] = ["start", "app", "electron", "dev", "serve"];
/** Optional BUILD scripts (a pre-run compile/bundle step), in preference order. */
const BUILD_SCRIPT_CANDIDATES: readonly string[] = ["build", "dist", "package", "compile", "make"];

/** Cap the package.json we will parse (a malformed/huge manifest must not stall detection). */
const MAX_PACKAGE_JSON_BYTES = 512 * 1024;

async function fileExists(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isFile();
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

interface ParsedManifest {
  readonly runScripts: readonly string[];
  readonly buildScripts: readonly string[];
  readonly hasElectron: boolean;
  readonly malformed: boolean;
}

function asStringKeySet(value: unknown): Set<string> {
  if (value === null || typeof value !== "object") return new Set();
  return new Set(Object.keys(value as Record<string, unknown>));
}

async function parseManifest(packageJsonPath: string): Promise<ParsedManifest> {
  const empty = { runScripts: [] as readonly string[], buildScripts: [] as readonly string[], hasElectron: false };
  let raw: string;
  try {
    const s = await stat(packageJsonPath);
    if (!s.isFile() || s.size > MAX_PACKAGE_JSON_BYTES) return { ...empty, malformed: false };
    raw = await readFile(packageJsonPath, "utf8");
  } catch {
    return { ...empty, malformed: false };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { ...empty, malformed: true };
  }
  if (parsed === null || typeof parsed !== "object") return { ...empty, malformed: true };

  const manifest = parsed as { scripts?: unknown; dependencies?: unknown; devDependencies?: unknown };
  const scripts = asStringKeySet(manifest.scripts);
  const deps = asStringKeySet(manifest.dependencies);
  const devDeps = asStringKeySet(manifest.devDependencies);

  return {
    runScripts: RUN_SCRIPT_CANDIDATES.filter((name) => scripts.has(name)),
    buildScripts: BUILD_SCRIPT_CANDIDATES.filter((name) => scripts.has(name)),
    hasElectron: deps.has("electron") || devDeps.has("electron"),
    malformed: false,
  };
}

/** Inspect a workspace root and report desktop-app launch capability. Never throws. */
export async function detectAppProject(root: string): Promise<RuntimeAppProjectInfo> {
  const packageJsonPath = join(root, "package.json");
  const hasPackageJson = await fileExists(packageJsonPath);

  const { runScripts, buildScripts, hasElectron, malformed } = hasPackageJson
    ? await parseManifest(packageJsonPath)
    : { runScripts: [] as readonly string[], buildScripts: [] as readonly string[], hasElectron: false, malformed: false };

  const detectedPm = hasPackageJson ? await detectPackageManager(root) : null;
  const packageManager: RuntimePreviewPackageManager | null =
    runScripts.length > 0 || buildScripts.length > 0 ? (detectedPm ?? "npm") : detectedPm;

  const supported = hasElectron && runScripts.length > 0;
  if (supported) {
    return {
      kind: "electron",
      hasPackageJson,
      packageJsonMalformed: malformed,
      hasElectronDependency: hasElectron,
      runScripts,
      buildScripts,
      packageManager,
    };
  }

  const reason = malformed
    ? "package.json không đọc được (malformed)."
    : !hasPackageJson
      ? "Không phải dự án ứng dụng: thiếu package.json."
      : !hasElectron
        ? "Không phát hiện Electron (thiếu dependency `electron`). Chỉ hỗ trợ chạy app Electron trong slice này."
        : "Không tìm thấy script chạy app (start/app/electron/dev/serve) trong package.json.";
  return {
    kind: "unsupported",
    hasPackageJson,
    packageJsonMalformed: malformed,
    hasElectronDependency: hasElectron,
    runScripts,
    buildScripts,
    packageManager,
    reason,
  };
}
