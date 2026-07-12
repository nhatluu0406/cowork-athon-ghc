import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parse, stringify } from '../yaml.mjs';

test('parse scalars and types', () => {
  const doc = parse('version: 1\nproduct: Cowork GHC\nflag: true\nempty:\nnope: false\nnil: null');
  assert.equal(doc.version, 1);
  assert.equal(doc.product, 'Cowork GHC');
  assert.equal(doc.flag, true);
  assert.equal(doc.nope, false);
  assert.equal(doc.empty, null);
  assert.equal(doc.nil, null);
});

test('parse nested map and sequences', () => {
  const doc = parse([
    'reference_source:',
    '  repository: different-ai/openwork',
    '  commit: "abc123"',
    'loops:',
    '  - id: L0',
    '    status: COMPLETED',
    '    depends_on: []',
    '  - id: L1',
    '    status: READY',
    '    depends_on:',
    '      - L0',
  ].join('\n'));
  assert.equal(doc.reference_source.repository, 'different-ai/openwork');
  assert.equal(doc.reference_source.commit, 'abc123');
  assert.equal(doc.loops.length, 2);
  assert.deepEqual(doc.loops[0], { id: 'L0', status: 'COMPLETED', depends_on: [] });
  assert.deepEqual(doc.loops[1].depends_on, ['L0']);
});

test('quoted strings preserve special chars', () => {
  const doc = parse('note: "value: with colon # and hash"\npath: "C:/a b/c"');
  assert.equal(doc.note, 'value: with colon # and hash');
  assert.equal(doc.path, 'C:/a b/c');
});

test('comments are ignored', () => {
  const doc = parse('# header\nversion: 1  # trailing\nname: ok');
  assert.equal(doc.version, 1);
  assert.equal(doc.name, 'ok');
});

test('round-trips a complex document', () => {
  const original = {
    version: 1,
    product: 'Cowork GHC',
    meta: { a: 1, b: 'two: colon', flag: false, empty_map: {}, empty_list: [] },
    loops: [
      { id: 'L0', status: 'COMPLETED', outputs: ['a/', 'b.md'], gate: { result: 'PASS', evidence: ['e.md'] } },
      { id: 'L1', status: 'READY', depends_on: ['L0'] },
    ],
  };
  const round = parse(stringify(original));
  assert.deepEqual(round, original);
});

test('gate nested inside a sequence map round-trips', () => {
  const doc = { loops: [{ id: 'L0', gate: { result: 'PASS', evidence: ['x.md', 'y.md'] } }] };
  assert.deepEqual(parse(stringify(doc)), doc);
});
