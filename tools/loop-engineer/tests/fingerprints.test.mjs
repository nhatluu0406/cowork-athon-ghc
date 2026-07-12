import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hashString, compareFingerprints, fingerprintFile } from '../fingerprints.mjs';
import { fileURLToPath } from 'node:url';

test('hashString is stable and sensitive', () => {
  assert.equal(hashString('a'), hashString('a'));
  assert.notEqual(hashString('a'), hashString('b'));
  assert.match(hashString('x'), /^[0-9a-f]{64}$/);
});

test('fingerprintFile handles missing file', () => {
  const fp = fingerprintFile('/definitely/not/here/xyz.tmp');
  assert.equal(fp.exists, false);
  assert.equal(fp.sha256, null);
});

test('fingerprintFile hashes an existing file', () => {
  const self = fileURLToPath(import.meta.url);
  const fp = fingerprintFile(self);
  assert.equal(fp.exists, true);
  assert.match(fp.sha256, /^[0-9a-f]{64}$/);
});

test('compareFingerprints detects sha change', () => {
  const a = { req: { path: 'r.md', sha256: '111' } };
  const b = { req: { path: 'r.md', sha256: '222' } };
  const r = compareFingerprints(a, b);
  assert.equal(r.stale, true);
  assert.deepEqual(r.changed, ['req']);
});

test('compareFingerprints detects commit change', () => {
  const a = { ref: { commit: 'aaa' } };
  const b = { ref: { commit: 'bbb' } };
  assert.equal(compareFingerprints(a, b).stale, true);
});

test('compareFingerprints stable when equal', () => {
  const a = { x: { sha256: '1' }, y: { commit: 'c' } };
  assert.deepEqual(compareFingerprints(a, a), { stale: false, changed: [] });
});
