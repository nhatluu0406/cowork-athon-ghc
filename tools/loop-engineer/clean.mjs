// Safety-critical cleanup logic for clean.bat (CGHC-023, requirement LC4). Zero-dependency
// ESM (Node builtins only, same style as the rest of the controller). This is the SINGLE
// source of truth for `clean`: manifest validation, allowlist assessment (with absolute /
// UNC / drive-letter / traversal rejection), project-root certainty, the running-guard, and
// the actual deletion (guarded against symlink escape). lifecycle.mjs `clean` delegates here
// so there is exactly ONE clean implementation. It deletes ONLY manifest allowlist paths and
// NEVER a path overlapping a preserve entry, escaping the project root, or naming an
// absolute / UNC / drive location. Honest exit codes; never always-0.

import { existsSync, readFileSync, rmSync, realpathSync } from 'node:fs';
import { join, resolve, sep, relative } from 'node:path';

// Honest, distinct exit codes. 0 = success or valid no-op / dry-run preview.
export const EXIT = Object.freeze({
  OK: 0,
  INVALID_MANIFEST: 2, // manifest missing / malformed / contains an unsafe entry
  RUNNING: 4,          // refused: Cowork GHC appears to be running (mandated code)
  ROOT_UNCERTAIN: 6,   // refused: project root could not be proven with certainty
  DELETE_FAILED: 7,    // a target could not be deleted (or was a symlink escape)
});

// Markers that TOGETHER prove a directory is THE Cowork GHC project root. Requiring several
// distinct, project-specific markers makes an incorrect / attacker-supplied --root fail the
// certainty gate rather than allowing deletion in an unrelated directory.
const ROOT_MARKERS = ['CLAUDE.md', '.agent-workflow',
  join('scripts', 'cleanup-manifest.json'), join('tools', 'loop-engineer')];

// ---- path helpers ----

export function normRel(p) {
  return String(p).replace(/\\/g, '/').replace(/^\.\//, '').replace(/^\/+|\/+$/g, '');
}

// A cleanup manifest may only ever name in-repo RELATIVE paths. Reject, on the RAW string
// (before any normalization can hide it), an absolute POSIX path, a bare / rooted drive
// letter (`C:`, `C:\x`), or a UNC path (`\\srv`, `//srv`). Returns a reason or null.
export function unsafeEntryReason(raw) {
  const s = String(raw);
  if (s.trim() === '') return 'empty path entry';
  if (/^[\\/]{2}/.test(s)) return 'UNC path not allowed';
  if (/^[a-zA-Z]:/.test(s)) return 'drive-letter path not allowed';
  if (/^[\\/]/.test(s)) return 'absolute path not allowed';
  return null;
}

// The target platform (Windows) filesystem is case-INSENSITIVE, so a case-variant of a
// protected path (e.g. "Docs", ".GIT", "CLAUDE.MD") names the SAME real file. The preserve
// overlap is the last-line backstop that must survive a bad/edited manifest, so it must fold
// case on win32 — otherwise a case-variant entry is classified deletable and destroys a
// protected path (CGHC-023 security review HIGH-1). On case-sensitive platforms "Docs" is a
// genuinely distinct dir, so we do NOT fold there (that would wrongly refuse a legit target).
function foldCase(s) { return process.platform === 'win32' ? s.toLowerCase() : s; }
function overlap(a, b) {
  a = foldCase(a); b = foldCase(b);
  return a === b || b.startsWith(a + '/') || a.startsWith(b + '/');
}

function isAbsolutePath(p) { return /^[\\/]/.test(p) || /^[a-zA-Z]:[\\/]/.test(p); }

// Classify one manifest path against the preserve set. `kind`:
//   'unsafe'    absolute / UNC / drive / empty → manifest is malformed (hard refuse upstream)
//   'root'      resolves to the project root   → hard refuse
//   'traversal' contains a `..` segment        → hard refuse
//   'preserve'  overlaps a protected path      → skip this entry, keep the rest
//   'ok'        safe to delete
export function assessCleanTarget(raw, preserve = []) {
  const unsafe = unsafeEntryReason(raw);
  if (unsafe) return { allowed: false, kind: 'unsafe', reason: unsafe };
  const rel = normRel(raw);
  if (rel === '' || rel === '.') return { allowed: false, kind: 'root', reason: 'refuses to delete project root' };
  if (rel.split('/').includes('..')) return { allowed: false, kind: 'traversal', reason: 'path traversal' };
  for (const p of preserve) {
    if (overlap(rel, normRel(p))) return { allowed: false, kind: 'preserve', reason: `overlaps preserved path "${p}"` };
  }
  return { allowed: true, kind: 'ok', reason: 'in cleanable allowlist' };
}

// ---- manifest validation ----

export function validateManifest(m) {
  if (!m || typeof m !== 'object' || Array.isArray(m)) return { valid: false, errors: ['manifest is not an object'] };
  const errors = [];
  if (!m.categories || typeof m.categories !== 'object' || Array.isArray(m.categories)) errors.push('missing "categories" object');
  if (!Array.isArray(m.cleanable_categories)) errors.push('missing "cleanable_categories" array');
  const cats = m.categories && typeof m.categories === 'object' ? m.categories : {};
  if (cats.preserve != null && !Array.isArray(cats.preserve)) errors.push('"categories.preserve" must be an array');
  for (const cat of (Array.isArray(m.cleanable_categories) ? m.cleanable_categories : [])) {
    if (typeof cat !== 'string') { errors.push('cleanable category name is not a string'); continue; }
    if (!Array.isArray(cats[cat])) { errors.push(`cleanable category "${cat}" is not an array`); continue; }
    for (const p of cats[cat]) if (typeof p !== 'string') errors.push(`category "${cat}" has a non-string entry`);
  }
  return { valid: errors.length === 0, errors };
}

// ---- target resolution ----

// Build the concrete delete list from a manifest. `unsafe` collects any entry that makes the
// whole manifest untrustworthy (absolute / UNC / drive / traversal / root); the caller hard-
// refuses when it is non-empty. `skipped` collects protected (preserve-overlapping) entries.
export function resolveCleanTargets(manifest, existsRel = () => true) {
  const cats = (manifest && manifest.categories) || {};
  const preserve = cats.preserve || [];
  const cleanable = (manifest && manifest.cleanable_categories) || [];
  const targets = [], skipped = [], unsafe = [];
  for (const cat of cleanable) {
    for (const p of (cats[cat] || [])) {
      const a = assessCleanTarget(p, preserve);
      if (a.kind === 'unsafe' || a.kind === 'root' || a.kind === 'traversal') {
        unsafe.push({ path: p, category: cat, reason: a.reason });
        skipped.push({ path: p, category: cat, reason: a.reason });
        continue;
      }
      if (!a.allowed) { skipped.push({ path: p, category: cat, reason: a.reason }); continue; }
      if (existsRel(p)) targets.push({ path: p, category: cat });
    }
  }
  return { targets, skipped, unsafe };
}

// ---- project-root certainty ----

export function isRootCertain(root, existsAbs = existsSync) {
  if (!root || typeof root !== 'string' || !isAbsolutePath(root)) return false;
  return ROOT_MARKERS.every((m) => existsAbs(join(root, m)));
}

// ---- deletion (symlink-escape guarded) ----

function insideRoot(realRoot, realTarget) {
  return realTarget !== realRoot && realTarget.startsWith(realRoot.replace(/[\\/]+$/, '') + sep);
}

export function runClean(root, targets, deps = {}, preserve = []) {
  const rm = deps.rm ?? ((abs) => rmSync(abs, { recursive: true, force: true }));
  const realPath = deps.realPath ?? ((p) => { try { return realpathSync(p); } catch { return resolve(p); } });
  const log = deps.log ?? (() => {});
  const realRoot = realPath(root);
  const deleted = [], failed = [];
  for (const t of targets) {
    const abs = resolve(root, t.path);
    const real = realPath(abs);
    if (!insideRoot(realRoot, real)) {
      failed.push({ ...t, reason: 'resolves outside project root (symlink escape) — not deleted' });
      log(`REFUSED (escapes root): ${t.path}`);
      continue;
    }
    // CGHC-023 review MEDIUM-1: the string-level preserve check ran on the manifest entry, but
    // a cleanable entry could itself be a junction/symlink to a PROTECTED in-root path (stays
    // inside root, so the escape guard passes). Reconcile the REAL path against preserve too.
    const realRel = normRel(relative(realRoot, real));
    const protectedHit = preserve.find((p) => overlap(realRel, normRel(p)));
    if (protectedHit) {
      failed.push({ ...t, reason: `resolves onto protected path "${protectedHit}" (junction) — not deleted` });
      log(`REFUSED (resolves onto protected): ${t.path} -> ${realRel}`);
      continue;
    }
    try { rm(abs); deleted.push(t); log(`deleted: ${t.path} [${t.category}]`); }
    catch (err) { failed.push({ ...t, reason: err.message }); log(`ERROR deleting ${t.path}: ${err.message}`); }
  }
  return { deleted, failed };
}

// ---- manifest loading ----

function loadManifestFromDisk(root) {
  const p = join(root, 'scripts', 'cleanup-manifest.json');
  if (!existsSync(p)) throw new Error(`cleanup manifest missing at ${p}`);
  return JSON.parse(readFileSync(p, 'utf8'));
}

// ---- the orchestrator (pure decisions; all IO is injectable via deps) ----

export function cleanCommand({ root, confirmed = false, deps = {} } = {}) {
  const log = deps.log ?? (() => {});
  const existsAbs = deps.existsAbs ?? existsSync;
  const existsRel = deps.existsRel ?? ((p) => existsSync(join(root, p)));
  const isRunning = deps.isRunning ?? (() => false);

  // 1. Refuse unless the project root is proven with certainty (never delete in a guessed dir).
  if (!isRootCertain(root, existsAbs)) {
    log('REFUSED: project root could not be determined with certainty — nothing deleted');
    return EXIT.ROOT_UNCERTAIN;
  }
  // 2. Load + validate the manifest. A missing / malformed manifest is an honest nonzero,
  //    never a crash and never a silent success.
  let manifest;
  try { manifest = deps.loadManifest ? deps.loadManifest() : loadManifestFromDisk(root); }
  catch (err) { log(`REFUSED: cannot load cleanup manifest: ${err.message}`); return EXIT.INVALID_MANIFEST; }
  const v = validateManifest(manifest);
  if (!v.valid) { log('REFUSED: invalid cleanup manifest:'); v.errors.forEach((e) => log(`  - ${e}`)); return EXIT.INVALID_MANIFEST; }

  // 3. Reject the whole run if ANY manifest entry is unsafe (absolute / UNC / drive /
  //    traversal / root) BEFORE deleting anything.
  const { targets, skipped, unsafe } = resolveCleanTargets(manifest, existsRel);
  if (unsafe.length) {
    log('REFUSED: manifest contains unsafe path entries (absolute/UNC/drive/traversal) — nothing deleted:');
    unsafe.forEach((u) => log(`  - ${u.path} [${u.reason}]`));
    return EXIT.INVALID_MANIFEST;
  }
  // 4. Refuse (exit 4) while Cowork GHC is running — checked BEFORE any deletion / preview.
  if (isRunning()) { log('REFUSED: Cowork GHC appears to be running — run stop.bat first (nothing deleted)'); return EXIT.RUNNING; }

  for (const s of skipped) log(`skip (protected): ${s.path} [${s.reason}]`);
  if (targets.length === 0) { log('nothing to clean (no generated/downloaded data present)'); return EXIT.OK; }

  // 5. Default is a NO-OP preview; deletion requires explicit confirmation (--yes / answer Y).
  if (!confirmed) {
    log('DRY RUN — would delete (re-run with --yes, or answer Y in clean.bat):');
    targets.forEach((t) => log(`  - ${t.path} [${t.category}]`));
    return EXIT.OK;
  }
  const preserve = (manifest.categories && manifest.categories.preserve) || [];
  const { deleted, failed } = runClean(root, targets, deps, preserve);
  log(`clean: ${deleted.length} deleted, ${failed.length} failed`);
  return failed.length ? EXIT.DELETE_FAILED : EXIT.OK;
}

export default {
  EXIT, normRel, unsafeEntryReason, assessCleanTarget, validateManifest,
  resolveCleanTargets, isRootCertain, runClean, cleanCommand,
};
