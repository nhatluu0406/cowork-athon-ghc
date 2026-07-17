/**
 * Import-direction boundary lint (CGHC-003 acceptance #2).
 *
 * Enforces the shell-neutrality rule (ADR 0002:68-69, ADR 0008:41-42, invariant #12):
 * `app/ui` and any future web surface may import `@cowork-ghc/contracts` (and reach
 * business logic only through the loopback service), but MUST NEVER import the
 * Electron shell (`app/shell`) or `electron` directly.
 *
 * This is a text-level scan (no TypeScript program needed) so it can run cheaply in
 * `node --test` and works even before `app/` exists: it only flags files whose path
 * is governed by a rule, and yields nothing when no such files are present.
 */

import { readdir, readFile } from "node:fs/promises";
import { join, relative, sep } from "node:path";

/** A single import-direction rule. */
export interface BoundaryRule {
  readonly name: string;
  /** Matched against a file's POSIX path relative to the scan root. */
  readonly appliesTo: RegExp;
  /** Matched against each import specifier found in a governed file. */
  readonly forbiddenImport: RegExp;
  readonly reason: string;
}

/** A detected violation of a rule. */
export interface BoundaryViolation {
  readonly rule: string;
  /** POSIX path relative to the scan root. */
  readonly file: string;
  readonly specifier: string;
  readonly reason: string;
}

/** Options for a scan. */
export interface ScanOptions {
  readonly rules?: readonly BoundaryRule[];
  /** POSIX path fragments to skip entirely (matched as substrings). */
  readonly ignore?: readonly string[];
  /** File extensions to scan. */
  readonly extensions?: readonly string[];
}

/**
 * The default, load-bearing rule: `app/ui` and future web surfaces must not import
 * the Electron shell. `forbiddenImport` catches the shell package name, a relative/
 * absolute path into `app/shell`, and a direct `electron` import.
 */
export const UI_AND_WEB_MUST_NOT_IMPORT_SHELL: BoundaryRule = {
  name: "ui-and-web-must-not-import-shell",
  appliesTo: /(^|\/)(app\/ui|app\/web|apps\/web)\//,
  forbiddenImport: /(^electron(\/|$)|@cowork-ghc\/shell|(^|\/)app\/shell(\/|$))/,
  reason:
    "app/ui and future web are clients of @cowork-ghc/contracts + the loopback service; they must never import the Electron shell (app/shell). See ADR 0002:68-69 / ADR 0008:41-42.",
};

export const DEFAULT_RULES: readonly BoundaryRule[] = [UI_AND_WEB_MUST_NOT_IMPORT_SHELL];

const DEFAULT_EXTENSIONS = [".ts", ".tsx", ".mts", ".cts", ".js", ".jsx", ".mjs", ".cjs"];
const DEFAULT_IGNORE = ["/node_modules/", "/.git/", "/dist/", "/.runtime/"];

/**
 * Matches import/export-from, dynamic import(), require(), and bare side-effect
 * imports, capturing the specifier in one of four groups. The clause bridging the
 * `import`/`export` keyword and its `from` uses `[^;]*?` (NOT `[^;\n]`) so that
 * multi-line named imports (`import {\n a,\n b\n} from "x"`) are scanned too; it
 * stays non-greedy and is anchored by the required `from "..."`. The `\s*` in the
 * `import(...)`/`require(...)` arms already spans newlines.
 */
const IMPORT_RE =
  /(?:import|export)\b[^;]*?\bfrom\s*["']([^"']+)["']|import\s*\(\s*["']([^"']+)["']\s*\)|require\s*\(\s*["']([^"']+)["']\s*\)|import\s+["']([^"']+)["']/g;

function toPosix(p: string): string {
  return sep === "/" ? p : p.split(sep).join("/");
}

function extractSpecifiers(source: string): string[] {
  const specifiers: string[] = [];
  IMPORT_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = IMPORT_RE.exec(source)) !== null) {
    const spec = match[1] ?? match[2] ?? match[3] ?? match[4];
    if (spec !== undefined) {
      specifiers.push(spec);
    }
  }
  return specifiers;
}

async function collectFiles(
  root: string,
  extensions: readonly string[],
  ignore: readonly string[],
): Promise<string[]> {
  const files: string[] = [];
  async function walk(dir: string): Promise<void> {
    const entries = await readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const abs = join(dir, entry.name);
      const posixAbs = "/" + toPosix(relative(root, abs));
      if (ignore.some((frag) => posixAbs.includes(frag))) {
        continue;
      }
      if (entry.isDirectory()) {
        await walk(abs);
      } else if (extensions.some((ext) => entry.name.endsWith(ext))) {
        files.push(abs);
      }
    }
  }
  await walk(root);
  return files;
}

/**
 * Scans `root` and returns every import-direction violation. Empty array == clean.
 */
export async function scanImportDirection(
  root: string,
  options: ScanOptions = {},
): Promise<BoundaryViolation[]> {
  const rules = options.rules ?? DEFAULT_RULES;
  const extensions = options.extensions ?? DEFAULT_EXTENSIONS;
  const ignore = [...DEFAULT_IGNORE, ...(options.ignore ?? [])];

  const files = await collectFiles(root, extensions, ignore);
  const violations: BoundaryViolation[] = [];

  for (const abs of files) {
    const relPosix = toPosix(relative(root, abs));
    const governing = rules.filter((rule) => rule.appliesTo.test(relPosix));
    if (governing.length === 0) {
      continue;
    }
    const source = await readFile(abs, "utf8");
    const specifiers = extractSpecifiers(source);
    for (const rule of governing) {
      for (const specifier of specifiers) {
        if (rule.forbiddenImport.test(specifier)) {
          violations.push({
            rule: rule.name,
            file: relPosix,
            specifier,
            reason: rule.reason,
          });
        }
      }
    }
  }
  return violations;
}
