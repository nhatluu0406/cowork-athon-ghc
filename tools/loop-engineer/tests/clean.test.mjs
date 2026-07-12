// CGHC-023 / LC4 — clean allowlist + safety-guard unit tests. Everything is dependency-
// injected: no real file is ever deleted and no PowerShell is invoked. `rm` is a spy that
// records its calls, and existence / running / realpath are pure stubs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolve, join, sep } from 'node:path';
import {
  EXIT, normRel, unsafeEntryReason, assessCleanTarget, validateManifest,
  resolveCleanTargets, isRootCertain, runClean, cleanCommand,
} from '../clean.mjs';

const ROOT = resolve('clean-fixture-root'); // absolute, but never touched on disk
const PRESERVE = ['.git', 'docs', '.agent-workflow', '.claude', 'CLAUDE.md', 'AGENTS.md',
  '.loop-engineer/state', '.loop-engineer/checkpoints', '.loop-engineer/source', 'scripts', 'tools'];

// A well-formed manifest whose cleanable entries are all safe relative paths.
function goodManifest() {
  return {
    version: 1,
    categories: {
      generated: ['node_modules', 'dist', '.git'], // .git overlaps preserve → skipped
      'runtime-temporary': ['.runtime/logs'],
      preserve: PRESERVE,
    },
    cleanable_categories: ['generated', 'runtime-temporary'],
  };
}

// Baseline deps that pass the root-certainty + running gates so a manifest can be exercised.
function baseDeps(overrides = {}) {
  const logs = [];
  const deps = {
    log: (m) => logs.push(m),
    existsAbs: () => true,          // all root markers present
    existsRel: () => true,          // all candidate paths exist
    isRunning: () => false,         // not running
    loadManifest: () => goodManifest(),
    realPath: (p) => p,             // identity → stays inside root
    ...overrides,
  };
  return { deps, logs };
}

// ---- manifest validation ----

test('validateManifest accepts a well-formed manifest', () => {
  assert.equal(validateManifest(goodManifest()).valid, true);
});

test('validateManifest rejects malformed manifests', () => {
  assert.equal(validateManifest(null).valid, false);
  assert.equal(validateManifest([]).valid, false);
  assert.equal(validateManifest({ cleanable_categories: ['x'] }).valid, false); // no categories
  assert.equal(validateManifest({ categories: {} }).valid, false);              // no cleanable_categories
  const badPreserve = { categories: { preserve: 'not-array', generated: [] }, cleanable_categories: ['generated'] };
  assert.equal(validateManifest(badPreserve).valid, false);
  const nonArrayCat = { categories: { generated: 'nope' }, cleanable_categories: ['generated'] };
  assert.equal(validateManifest(nonArrayCat).valid, false);
  const nonStringEntry = { categories: { generated: ['ok', 3] }, cleanable_categories: ['generated'] };
  assert.equal(validateManifest(nonStringEntry).valid, false);
});

// ---- allowlist assessment + non-allowlisted / preserve-overlap refusal ----

test('assessCleanTarget allows genuine generated paths, refuses preserved paths', () => {
  assert.equal(assessCleanTarget('node_modules', PRESERVE).allowed, true);
  assert.equal(assessCleanTarget('.runtime/logs', PRESERVE).allowed, true);
  // preserve overlap (self, descendant, ancestor) is refused:
  assert.equal(assessCleanTarget('.git', PRESERVE).kind, 'preserve');
  assert.equal(assessCleanTarget('docs/sub', PRESERVE).kind, 'preserve');
  assert.equal(assessCleanTarget('.loop-engineer', PRESERVE).kind, 'preserve'); // ancestor of preserved state
});

test('resolveCleanTargets excludes preserve-overlapping paths from delete list', () => {
  const existsRel = (p) => ['node_modules', '.git', '.runtime/logs'].includes(p);
  const { targets, skipped } = resolveCleanTargets(goodManifest(), existsRel);
  const paths = targets.map((t) => t.path);
  assert.ok(paths.includes('node_modules'));
  assert.ok(paths.includes('.runtime/logs'));
  assert.ok(!paths.includes('.git'));                     // protected → never a target
  assert.ok(skipped.some((s) => s.path === '.git'));
});

test('cleanCommand never deletes a path outside the cleanable allowlist', () => {
  // Only 'generated'/'runtime-temporary' are cleanable; a preserved dir like 'docs' is
  // present in categories.preserve but is NOT a cleanable category → never a target.
  const rmCalls = [];
  const { deps } = baseDeps({ rm: (abs) => rmCalls.push(abs) });
  const code = cleanCommand({ root: ROOT, confirmed: true, deps });
  assert.equal(code, EXIT.OK);
  assert.ok(rmCalls.every((abs) => !abs.includes(`${sep}docs`) && !abs.endsWith(`${sep}.git`)));
});

// ---- absolute / UNC / bare-drive-letter rejection ----

test('unsafeEntryReason flags absolute, UNC, and drive-letter entries', () => {
  assert.ok(unsafeEntryReason('/etc/passwd'));
  assert.ok(unsafeEntryReason('\\Windows'));
  assert.ok(unsafeEntryReason('C:'));
  assert.ok(unsafeEntryReason('C:\\Windows'));
  assert.ok(unsafeEntryReason('\\\\server\\share'));
  assert.ok(unsafeEntryReason('//server/share'));
  assert.ok(unsafeEntryReason(''));
  assert.equal(unsafeEntryReason('node_modules'), null);
  assert.equal(unsafeEntryReason('.runtime/logs'), null);
});

test('cleanCommand refuses the whole run when a manifest entry is absolute/UNC/drive', () => {
  for (const bad of ['/etc', 'C:\\Windows', 'C:', '\\\\srv\\s']) {
    const rmCalls = [];
    const manifest = { categories: { generated: ['node_modules', bad], preserve: PRESERVE }, cleanable_categories: ['generated'] };
    const { deps } = baseDeps({ loadManifest: () => manifest, rm: (abs) => rmCalls.push(abs) });
    const code = cleanCommand({ root: ROOT, confirmed: true, deps });
    assert.equal(code, EXIT.INVALID_MANIFEST, `entry ${bad} must be rejected`);
    assert.equal(rmCalls.length, 0, 'nothing deleted when manifest is unsafe');
  }
});

// ---- traversal rejection ----

test('assessCleanTarget flags a traversal entry', () => {
  assert.equal(assessCleanTarget('../secrets', PRESERVE).kind, 'traversal');
});

test('cleanCommand refuses the whole run on a traversal entry', () => {
  const rmCalls = [];
  const manifest = { categories: { generated: ['../outside'], preserve: PRESERVE }, cleanable_categories: ['generated'] };
  const { deps } = baseDeps({ loadManifest: () => manifest, rm: (abs) => rmCalls.push(abs) });
  const code = cleanCommand({ root: ROOT, confirmed: true, deps });
  assert.equal(code, EXIT.INVALID_MANIFEST);
  assert.equal(rmCalls.length, 0);
});

// ---- refuse while running (exit 4) ----

test('cleanCommand refuses with exit 4 while Cowork GHC is running', () => {
  const rmCalls = [];
  const { deps } = baseDeps({ isRunning: () => true, rm: (abs) => rmCalls.push(abs) });
  const code = cleanCommand({ root: ROOT, confirmed: true, deps });
  assert.equal(code, EXIT.RUNNING);
  assert.equal(code, 4);
  assert.equal(rmCalls.length, 0, 'nothing deleted while running');
});

// ---- project-root uncertainty ----

test('isRootCertain requires an absolute path with all markers present', () => {
  assert.equal(isRootCertain('relative/dir', () => true), false);   // not absolute
  assert.equal(isRootCertain(ROOT, () => false), false);            // markers missing
  assert.equal(isRootCertain(ROOT, () => true), true);              // absolute + markers
});

test('cleanCommand refuses when the project root is uncertain', () => {
  const rmCalls = [];
  const loadCalls = [];
  const { deps } = baseDeps({
    existsAbs: () => false, // no root markers → uncertain
    rm: (abs) => rmCalls.push(abs),
    loadManifest: () => { loadCalls.push(1); return goodManifest(); },
  });
  const code = cleanCommand({ root: ROOT, confirmed: true, deps });
  assert.equal(code, EXIT.ROOT_UNCERTAIN);
  assert.equal(rmCalls.length, 0);
  assert.equal(loadCalls.length, 0, 'manifest not even loaded when root is uncertain');
});

// ---- missing / broken manifest → honest nonzero ----

test('cleanCommand returns nonzero (not a crash) when the manifest cannot be loaded', () => {
  const { deps } = baseDeps({ loadManifest: () => { throw new Error('missing'); } });
  const code = cleanCommand({ root: ROOT, confirmed: true, deps });
  assert.equal(code, EXIT.INVALID_MANIFEST);
  assert.notEqual(code, 0);
});

// ---- dry-run is the default no-op ----

test('cleanCommand without confirmation previews and deletes nothing', () => {
  const rmCalls = [];
  const { deps, logs } = baseDeps({ rm: (abs) => rmCalls.push(abs) });
  const code = cleanCommand({ root: ROOT, confirmed: false, deps });
  assert.equal(code, EXIT.OK);
  assert.equal(rmCalls.length, 0);
  assert.ok(logs.some((l) => l.startsWith('DRY RUN')));
});

// ---- confirmed happy path deletes only allowed existing targets ----

test('confirmed clean deletes only allowlisted existing targets, never preserved ones', () => {
  const rmCalls = [];
  const { deps } = baseDeps({
    existsRel: (p) => ['node_modules', '.runtime/logs', '.git'].includes(p),
    rm: (abs) => rmCalls.push(abs),
  });
  const code = cleanCommand({ root: ROOT, confirmed: true, deps });
  assert.equal(code, EXIT.OK);
  assert.deepEqual(
    rmCalls.sort(),
    [resolve(ROOT, 'node_modules'), resolve(ROOT, '.runtime/logs')].sort(),
  );
  assert.ok(!rmCalls.some((a) => a.endsWith(`${sep}.git`)), '.git is never deleted');
});

// ---- symlink escape guard ----

test('runClean refuses to delete a target whose real path escapes the project root', () => {
  const rmCalls = [];
  const realRoot = resolve(ROOT);
  const realPath = (p) => (p === ROOT ? realRoot : resolve('/somewhere/else/evil')); // target escapes
  const { deleted, failed } = runClean(ROOT, [{ path: 'node_modules', category: 'generated' }], {
    rm: (abs) => rmCalls.push(abs), realPath, log: () => {},
  });
  assert.equal(rmCalls.length, 0, 'escaping target is never handed to rm');
  assert.equal(deleted.length, 0);
  assert.equal(failed.length, 1);
});

test('cleanCommand reports DELETE_FAILED when a symlink escape is detected', () => {
  const realPath = (p) => (p === ROOT ? resolve(ROOT) : resolve('/elsewhere/evil'));
  const { deps } = baseDeps({
    existsRel: (p) => p === 'node_modules',
    loadManifest: () => ({ categories: { generated: ['node_modules'], preserve: PRESERVE }, cleanable_categories: ['generated'] }),
    realPath,
    rm: () => { throw new Error('rm should not be called on an escaping target'); },
  });
  const code = cleanCommand({ root: ROOT, confirmed: true, deps });
  assert.equal(code, EXIT.DELETE_FAILED);
});

// ---- delete failure → honest nonzero ----

test('cleanCommand reports DELETE_FAILED when an rm throws', () => {
  const { deps } = baseDeps({
    existsRel: (p) => p === 'node_modules',
    loadManifest: () => ({ categories: { generated: ['node_modules'], preserve: PRESERVE }, cleanable_categories: ['generated'] }),
    rm: () => { throw new Error('EBUSY: locked'); },
  });
  const code = cleanCommand({ root: ROOT, confirmed: true, deps });
  assert.equal(code, EXIT.DELETE_FAILED);
  assert.notEqual(code, 0);
});

// ---- HIGH-1: case-insensitive preserve backstop on Windows ----

test('preserve overlap folds case on Windows so a case-variant of a protected path is refused', () => {
  if (process.platform === 'win32') {
    // On the case-INSENSITIVE target fs these name the SAME real dir/file as the protected set.
    for (const variant of ['Docs', '.GIT', 'CLAUDE.MD', '.Agent-Workflow', '.loop-engineer/Source', 'DOCS/sub']) {
      assert.equal(assessCleanTarget(variant, PRESERVE).kind, 'preserve', `${variant} must be preserved`);
    }
  } else {
    // On a case-SENSITIVE fs a differently-cased name is a genuinely distinct path.
    assert.equal(assessCleanTarget('Docs', PRESERVE).allowed, true);
  }
});

test('a case-variant manifest entry never reaches rm on Windows', () => {
  if (process.platform !== 'win32') return; // guarantee only applies on the case-insensitive target
  const rmCalls = [];
  const manifest = { categories: { generated: ['Docs', 'node_modules'], preserve: PRESERVE }, cleanable_categories: ['generated'] };
  const { deps } = baseDeps({ loadManifest: () => manifest, rm: (abs) => rmCalls.push(abs) });
  const code = cleanCommand({ root: ROOT, confirmed: true, deps });
  assert.equal(code, EXIT.OK);
  assert.ok(!rmCalls.some((a) => /docs$/i.test(a)), 'a case-variant of docs is never deleted');
});

// ---- MEDIUM-1: in-root junction onto a protected path is reconciled at realpath time ----

test('runClean refuses a target whose real path resolves onto a protected in-root path (junction)', () => {
  const rmCalls = [];
  const realRoot = resolve(ROOT);
  // '.runtime/logs' is a cleanable entry, but here it is a junction to <root>/docs (protected,
  // still INSIDE root, so the escape guard alone would pass). The realpath-vs-preserve check catches it.
  const realPath = (p) => (p === ROOT ? realRoot : resolve(ROOT, 'docs'));
  const { deleted, failed } = runClean(
    ROOT,
    [{ path: '.runtime/logs', category: 'runtime-temporary' }],
    { rm: (abs) => rmCalls.push(abs), realPath, log: () => {} },
    PRESERVE,
  );
  assert.equal(rmCalls.length, 0, 'a junction onto a protected path is never handed to rm');
  assert.equal(deleted.length, 0);
  assert.equal(failed.length, 1);
  assert.match(failed[0].reason, /protected/);
});

// ---- normRel parity with the historical helper ----

test('normRel normalizes separators and trims (parity check)', () => {
  assert.equal(normRel('.\\a\\b\\'), 'a/b');
  assert.equal(normRel('/x/y/'), 'x/y');
});
