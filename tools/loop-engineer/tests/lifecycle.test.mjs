import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  normRel, assessCleanTarget, resolveCleanTargets, parsePidFile,
  cmdInit, cmdStart, cmdStop, DEFAULT_ROOT,
} from '../lifecycle.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const SCRIPTS_DIR = join(HERE, '..', '..', '..', 'scripts');

function freshRoot() {
  return mkdtempSync(join(tmpdir(), 'cghc-lifecycle-'));
}
// init needs a toolchain probe; inject a present npm so the exit-code contract does not
// depend on a real npm being installed. Also inject a no-op `install` so the guarantee that
// no test ever shells out to a real `npm install` is STRUCTURAL, not incidental on the temp
// root lacking a package.json (CGHC-006 review LOW-2).
const NPM_PRESENT = { toolPresent: () => true, install: () => {} };

const PRESERVE = ['.git', 'docs', '.agent-workflow', '.claude', 'CLAUDE.md', 'AGENTS.md',
  '.loop-engineer/state', '.loop-engineer/checkpoints', '.loop-engineer/source', 'scripts', 'tools'];

test('normRel normalizes separators and trims', () => {
  assert.equal(normRel('.\\a\\b\\'), 'a/b');
  assert.equal(normRel('/x/y/'), 'x/y');
});

test('refuses to delete project root', () => {
  assert.equal(assessCleanTarget('', PRESERVE).allowed, false);
  assert.equal(assessCleanTarget('.', PRESERVE).allowed, false);
});

test('refuses path traversal', () => {
  assert.equal(assessCleanTarget('../secrets', PRESERVE).allowed, false);
});

test('refuses preserved paths and their ancestors/descendants', () => {
  assert.equal(assessCleanTarget('.git', PRESERVE).allowed, false);
  assert.equal(assessCleanTarget('docs/sub', PRESERVE).allowed, false); // inside preserved
  assert.equal(assessCleanTarget('.loop-engineer', PRESERVE).allowed, false); // ancestor of preserved state
});

test('allows genuine generated paths', () => {
  assert.equal(assessCleanTarget('node_modules', PRESERVE).allowed, true);
  assert.equal(assessCleanTarget('.runtime/logs', PRESERVE).allowed, true);
  assert.equal(assessCleanTarget('dist', PRESERVE).allowed, true);
});

test('resolveCleanTargets returns only allowed + existing paths', () => {
  const manifest = {
    categories: {
      generated: ['node_modules', 'dist', '.git'],
      preserve: PRESERVE,
    },
    cleanable_categories: ['generated'],
  };
  const exists = (p) => ['node_modules', '.git'].includes(p);
  const { targets, skipped } = resolveCleanTargets(manifest, exists);
  assert.deepEqual(targets.map((t) => t.path), ['node_modules']); // dist not existing, .git protected
  assert.ok(skipped.some((s) => s.path === '.git'));
});

test('parsePidFile parses JSON and rejects garbage', () => {
  assert.deepEqual(parsePidFile('{"pid":123,"role":"server"}'), { pid: 123, role: 'server' });
  assert.equal(parsePidFile('not json'), null);
});

// ---- Exit-code contracts (LC2 / CGHC-006) ----

test('init is idempotent: exit 0 on first run and on repeat (no-op)', () => {
  const root = freshRoot();
  try {
    assert.equal(cmdInit(root, NPM_PRESENT), 0, 'first init should succeed');
    // .runtime subdirs are created
    for (const d of ['pids', 'logs', 'state', 'temp']) {
      assert.ok(existsSync(join(root, '.runtime', d)), `.runtime/${d} exists`);
    }
    // re-running is a clean no-op and still exits 0
    assert.equal(cmdInit(root, NPM_PRESENT), 0, 'repeat init should be a no-op 0');
    for (const d of ['pids', 'logs', 'state', 'temp']) {
      assert.ok(existsSync(join(root, '.runtime', d)), `.runtime/${d} still exists after repeat`);
    }
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('init returns 2 when the toolchain (npm) is missing — never fakes success', () => {
  const root = freshRoot();
  try {
    assert.equal(cmdInit(root, { toolPresent: () => false }), 2);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('start before the runtime exists returns 3 (honest NOT_READY, never a fake PID)', () => {
  const root = freshRoot();
  try {
    // not initialized yet -> 3
    assert.equal(cmdStart(root), 3, 'start before init is NOT READY (3)');
    // after init the runtime binary still does not exist -> still an honest 3
    assert.equal(cmdInit(root, NPM_PRESENT), 0);
    assert.equal(cmdStart(root), 3, 'start after init is still NOT READY (3) — runtime not built');
    // no fabricated pid-file was written
    assert.ok(!existsSync(join(root, '.runtime', 'pids', 'server.json')), 'no fake pid record created');
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('stop with nothing running is a valid exit 0 (delegates to the empty-reaper path)', () => {
  const root = freshRoot();
  try {
    const emptyReaper = () => ({ mode: 'empty', killed: [], pruned: [], failed: [], unverifiable: [] });
    assert.equal(cmdStop(root, { stopAll: emptyReaper }), 0);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

// ---- Root-independence (double-click from a different CWD) ----

test('lifecycle resolves its root from the passed root, not process.cwd()', () => {
  const projectRoot = freshRoot();
  const otherCwd = freshRoot();
  const prev = process.cwd();
  try {
    process.chdir(otherCwd); // simulate double-click from Explorer with an unrelated CWD
    assert.equal(cmdInit(projectRoot, NPM_PRESENT), 0);
    // effects land under the explicit root (as %~dp0 supplies), never under the caller CWD
    assert.ok(existsSync(join(projectRoot, '.runtime', 'pids')), 'runtime dirs under the passed root');
    assert.ok(!existsSync(join(otherCwd, '.runtime')), 'nothing created under the unrelated CWD');
  } finally {
    process.chdir(prev);
    rmSync(projectRoot, { recursive: true, force: true });
    rmSync(otherCwd, { recursive: true, force: true });
  }
});

test('DEFAULT_ROOT is derived from the module location, independent of process.cwd()', () => {
  const prev = process.cwd();
  const scratch = freshRoot();
  try {
    process.chdir(scratch);
    // DEFAULT_ROOT is the project root two levels up from tools/loop-engineer, and stays
    // stable no matter where the process was launched from (the .bat passes %~dp0 explicitly,
    // and the CLI fallback never reads the caller CWD).
    assert.notEqual(DEFAULT_ROOT, process.cwd());
    assert.ok(existsSync(join(DEFAULT_ROOT, 'tools', 'loop-engineer', 'lifecycle.mjs')));
  } finally {
    process.chdir(prev);
    rmSync(scratch, { recursive: true, force: true });
  }
});

// ---- Node-missing -> 9 contract (enforced by the .bat entry points) ----

test('each .bat entry checks for Node and exits 9 when it is missing (never fakes success)', () => {
  for (const name of ['init.bat', 'start.bat', 'stop.bat']) {
    const src = readFileSync(join(SCRIPTS_DIR, name), 'utf8');
    assert.match(src, /where node/i, `${name} probes for Node on PATH`);
    assert.match(src, /exit \/b 9/i, `${name} exits 9 when Node is missing`);
    // the CLI is invoked with an explicit --root derived from the script's own location
    assert.match(src, /%~dp0/, `${name} self-locates the project root via %~dp0`);
    assert.match(src, /--root/, `${name} passes an explicit --root to the CLI`);
    assert.match(src, /exit \/b %RC%/i, `${name} propagates the CLI exit code (never always-0)`);
  }
});
