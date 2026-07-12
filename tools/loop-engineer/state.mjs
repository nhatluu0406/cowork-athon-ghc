// State model + pure selectors + file IO for the Loop Engineer controller.
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse, stringify } from './yaml.mjs';

export const LOOP_STATUS = ['NOT_READY', 'READY', 'RUNNING', 'BLOCKED', 'REVIEW_REQUIRED', 'VERIFY_REQUIRED', 'COMPLETED', 'STALE', 'FAILED'];
export const TASK_STATUS = ['BACKLOG', 'READY', 'IN_PROGRESS', 'BLOCKED', 'REVIEW', 'VERIFY', 'DONE', 'STALE', 'FAILED'];

// Project root = two levels up from tools/loop-engineer/.
export function projectRoot() {
  return join(dirname(fileURLToPath(import.meta.url)), '..', '..');
}

export function stateDir(root = projectRoot()) {
  return join(root, '.loop-engineer', 'state');
}

const FILES = {
  project: 'project-state.yaml',
  loops: 'loops.yaml',
  tasks: 'tasks.yaml',
  currentRun: 'current-run.yaml',
};

export function loadYaml(absPath, fallback = null) {
  if (!existsSync(absPath)) return fallback;
  return parse(readFileSync(absPath, 'utf8'));
}

export function saveYaml(absPath, value) {
  mkdirSync(dirname(absPath), { recursive: true });
  writeFileSync(absPath, stringify(value), 'utf8');
}

export function loadState(root = projectRoot()) {
  const dir = stateDir(root);
  return {
    root,
    project: loadYaml(join(dir, FILES.project)),
    loops: loadYaml(join(dir, FILES.loops)),
    tasks: loadYaml(join(dir, FILES.tasks)),
    currentRun: loadYaml(join(dir, FILES.currentRun)),
  };
}

export function saveLoops(loopsDoc, root = projectRoot()) {
  saveYaml(join(stateDir(root), FILES.loops), loopsDoc);
}

// ---- Pure selectors (data in, decision out) ----

export function isLoopValid(loop) {
  return !!loop
    && loop.status === 'COMPLETED'
    && !loop.invalidated
    && !!loop.gate && loop.gate.result === 'PASS';
}

export function loopDepsSatisfied(loop, loops) {
  const byId = Object.fromEntries((loops || []).map((l) => [l.id, l]));
  return (loop.depends_on || []).every((dep) => isLoopValid(byId[dep]));
}

export function loopRunState(loop, loops) {
  if (isLoopValid(loop)) return 'SKIPPED_ALREADY_VALID';
  if (loop.status === 'STALE') return 'RUN';
  if (loop.status === 'FAILED') return 'RETRY';
  if (!loopDepsSatisfied(loop, loops)) return 'NOT_READY';
  return 'RUN';
}

// Selection order per SKILL "next": IN_PROGRESS task, VERIFY task, REVIEW task,
// READY task (deps done), then first runnable READY loop.
export function selectNextUnit({ loops = [], tasks = [] } = {}) {
  const taskById = Object.fromEntries(tasks.map((t) => [t.id, t]));
  const taskDone = (id) => taskById[id] && taskById[id].status === 'DONE';
  for (const status of ['IN_PROGRESS', 'VERIFY', 'REVIEW']) {
    const t = tasks.find((x) => x.status === status);
    if (t) return { kind: 'task', id: t.id, status, reason: `task ${status}` };
  }
  const readyTask = tasks.find((t) => t.status === 'READY' && (t.dependencies || []).every(taskDone));
  if (readyTask) return { kind: 'task', id: readyTask.id, status: 'READY', reason: 'task READY, deps done' };
  for (const loop of loops) {
    if (isLoopValid(loop)) continue;
    if ((loop.status === 'READY' || loop.status === 'STALE') && loopDepsSatisfied(loop, loops)) {
      return { kind: 'loop', id: loop.id, status: loop.status, reason: `loop ${loop.status}, deps satisfied` };
    }
  }
  return null;
}

export function setLoopStatus(loopsDoc, id, patch) {
  const loop = (loopsDoc.loops || []).find((l) => l.id === id);
  if (!loop) throw new Error(`Unknown loop ${id}`);
  Object.assign(loop, patch);
  return loop;
}

export default {
  LOOP_STATUS, TASK_STATUS, projectRoot, stateDir, loadState, loadYaml, saveYaml,
  saveLoops, isLoopValid, loopDepsSatisfied, loopRunState, selectNextUnit, setLoopStatus,
};
