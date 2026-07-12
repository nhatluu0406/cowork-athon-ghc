// Lightweight validators for state documents. Mirrors .agent-workflow/schemas/
// without pulling a JSON-schema dependency. Returns { valid, errors: [] }.
import { LOOP_STATUS, TASK_STATUS } from './state.mjs';

const LOOP_ID = /^L[0-9]+$/;
const TASK_ID = /^CGHC-[0-9]{3,}$/;
const GATE_RESULTS = ['PASS', 'PARTIAL', 'FAIL', 'PENDING'];
const PRIORITIES = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'];

function result(errors) {
  return { valid: errors.length === 0, errors };
}

export function validateProjectState(doc) {
  const e = [];
  if (!doc || typeof doc !== 'object') return result(['project-state: not an object']);
  if (typeof doc.version !== 'number') e.push('project-state: version must be a number');
  if (typeof doc.product !== 'string') e.push('project-state: product must be a string');
  if (typeof doc.current_phase !== 'string') e.push('project-state: current_phase must be a string');
  if (!Array.isArray(doc.loops)) e.push('project-state: loops must be an array');
  else doc.loops.forEach((l, i) => {
    if (!LOOP_ID.test(l.id || '')) e.push(`project-state.loops[${i}]: bad id "${l.id}"`);
    if (!LOOP_STATUS.includes(l.status)) e.push(`project-state.loops[${i}]: bad status "${l.status}"`);
  });
  return result(e);
}

export function validateLoop(loop, index = 0) {
  const e = [];
  const at = `loop[${index}]`;
  if (!loop || typeof loop !== 'object') return [`${at}: not an object`];
  if (!LOOP_ID.test(loop.id || '')) e.push(`${at}: bad id "${loop.id}"`);
  if (typeof loop.name !== 'string') e.push(`${at}: name required`);
  if (!LOOP_STATUS.includes(loop.status)) e.push(`${at}: bad status "${loop.status}"`);
  if (loop.depends_on && !Array.isArray(loop.depends_on)) e.push(`${at}: depends_on must be an array`);
  if (loop.gate && !GATE_RESULTS.includes(loop.gate.result)) e.push(`${at}: bad gate.result "${loop.gate.result}"`);
  if (loop.status === 'COMPLETED' && (!loop.gate || loop.gate.result !== 'PASS')) {
    e.push(`${at}: COMPLETED requires gate.result === PASS`);
  }
  return e;
}

export function validateLoopsDoc(doc) {
  const e = [];
  if (!doc || !Array.isArray(doc.loops)) return result(['loops: loops array required']);
  doc.loops.forEach((l, i) => e.push(...validateLoop(l, i)));
  return result(e);
}

export function validateTask(task, index = 0) {
  const e = [];
  const at = `task[${index}]`;
  if (!task || typeof task !== 'object') return [`${at}: not an object`];
  if (!TASK_ID.test(task.id || '')) e.push(`${at}: bad id "${task.id}" (expected CGHC-NNN)`);
  if (!TASK_STATUS.includes(task.status)) e.push(`${at}: bad status "${task.status}"`);
  if (!task.owner) e.push(`${at}: owner required`);
  if (!task.reviewer) e.push(`${at}: reviewer required`);
  if (task.owner && task.reviewer && task.owner === task.reviewer) {
    e.push(`${at}: reviewer must differ from owner ("${task.owner}")`);
  }
  if (task.priority && !PRIORITIES.includes(task.priority)) e.push(`${at}: bad priority "${task.priority}"`);
  return e;
}

export function validateTasksDoc(doc) {
  const e = [];
  if (!doc || !Array.isArray(doc.tasks)) return result(['tasks: tasks array required']);
  doc.tasks.forEach((t, i) => e.push(...validateTask(t, i)));
  return result(e);
}

export default { validateProjectState, validateLoop, validateLoopsDoc, validateTask, validateTasksDoc };
