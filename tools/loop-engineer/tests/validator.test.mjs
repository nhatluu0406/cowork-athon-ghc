import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateProjectState, validateLoopsDoc, validateTasksDoc } from '../validator.mjs';

test('valid project state passes', () => {
  const r = validateProjectState({ version: 1, product: 'Cowork GHC', current_phase: 'L0', loops: [{ id: 'L0', status: 'COMPLETED' }] });
  assert.equal(r.valid, true);
});

test('bad loop id/status fails', () => {
  const r = validateProjectState({ version: 1, product: 'x', current_phase: 'L0', loops: [{ id: 'X0', status: 'NOPE' }] });
  assert.equal(r.valid, false);
  assert.equal(r.errors.length, 2);
});

test('COMPLETED loop without PASS gate fails', () => {
  const r = validateLoopsDoc({ loops: [{ id: 'L0', name: 'B', status: 'COMPLETED' }] });
  assert.equal(r.valid, false);
  assert.match(r.errors.join(' '), /gate.result === PASS/);
});

test('COMPLETED loop with PASS gate passes', () => {
  const r = validateLoopsDoc({ loops: [{ id: 'L0', name: 'B', status: 'COMPLETED', gate: { result: 'PASS' } }] });
  assert.equal(r.valid, true);
});

test('task reviewer must differ from owner', () => {
  const r = validateTasksDoc({ tasks: [{ id: 'CGHC-001', status: 'READY', owner: 'a', reviewer: 'a' }] });
  assert.equal(r.valid, false);
  assert.match(r.errors.join(' '), /reviewer must differ/);
});

test('bad task id format fails', () => {
  const r = validateTasksDoc({ tasks: [{ id: 'T-1', status: 'READY', owner: 'a', reviewer: 'b' }] });
  assert.equal(r.valid, false);
});

test('valid task passes', () => {
  const r = validateTasksDoc({ tasks: [{ id: 'CGHC-042', status: 'READY', owner: 'runtime-llm-engineer', reviewer: 'code-reviewer', priority: 'HIGH' }] });
  assert.equal(r.valid, true);
});

test('empty tasks doc is valid', () => {
  assert.equal(validateTasksDoc({ tasks: [] }).valid, true);
});
