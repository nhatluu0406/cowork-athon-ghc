import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isLoopValid, loopDepsSatisfied, loopRunState, selectNextUnit } from '../state.mjs';

const L0 = { id: 'L0', status: 'COMPLETED', depends_on: [], gate: { result: 'PASS' } };
const L1ready = { id: 'L1', status: 'READY', depends_on: ['L0'] };
const L2blocked = { id: 'L2', status: 'READY', depends_on: ['L1'] };

test('isLoopValid requires COMPLETED + gate PASS + not invalidated', () => {
  assert.equal(isLoopValid(L0), true);
  assert.equal(isLoopValid({ ...L0, gate: { result: 'FAIL' } }), false);
  assert.equal(isLoopValid({ ...L0, invalidated: { reason: 'x' } }), false);
  assert.equal(isLoopValid({ ...L0, status: 'READY' }), false);
});

test('loopDepsSatisfied checks dependency validity', () => {
  const loops = [L0, L1ready, L2blocked];
  assert.equal(loopDepsSatisfied(L1ready, loops), true);
  assert.equal(loopDepsSatisfied(L2blocked, loops), false);
});

test('loopRunState returns SKIPPED_ALREADY_VALID for valid loops', () => {
  assert.equal(loopRunState(L0, [L0]), 'SKIPPED_ALREADY_VALID');
  assert.equal(loopRunState(L1ready, [L0, L1ready]), 'RUN');
  assert.equal(loopRunState(L2blocked, [L0, L1ready, L2blocked]), 'NOT_READY');
  assert.equal(loopRunState({ id: 'LX', status: 'FAILED', depends_on: [] }, []), 'RETRY');
});

test('selectNextUnit skips valid loops and picks first runnable', () => {
  const next = selectNextUnit({ loops: [L0, L1ready, L2blocked], tasks: [] });
  assert.deepEqual({ kind: next.kind, id: next.id }, { kind: 'loop', id: 'L1' });
});

test('selectNextUnit prioritizes in-progress tasks over loops', () => {
  const tasks = [{ id: 'CGHC-001', status: 'IN_PROGRESS', owner: 'a', reviewer: 'b' }];
  const next = selectNextUnit({ loops: [L0, L1ready], tasks });
  assert.deepEqual({ kind: next.kind, id: next.id }, { kind: 'task', id: 'CGHC-001' });
});

test('selectNextUnit task order: VERIFY before REVIEW before READY', () => {
  const tasks = [
    { id: 'CGHC-010', status: 'READY', owner: 'a', reviewer: 'b', dependencies: [] },
    { id: 'CGHC-011', status: 'REVIEW', owner: 'a', reviewer: 'b' },
    { id: 'CGHC-012', status: 'VERIFY', owner: 'a', reviewer: 'b' },
  ];
  assert.equal(selectNextUnit({ loops: [], tasks }).id, 'CGHC-012');
});

test('selectNextUnit returns null when everything is valid', () => {
  assert.equal(selectNextUnit({ loops: [L0], tasks: [] }), null);
});
