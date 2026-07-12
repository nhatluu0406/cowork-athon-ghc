#!/usr/bin/env node
// Loop Engineer controller CLI. Manages state; reports the next valid unit. Actual
// loop/task WORK is orchestrated by the /loop-engineer skill (an AI agent); this CLI
// is the neutral state manager, validator, and reporter it relies on.
import { join } from 'node:path';
import { existsSync } from 'node:fs';
import {
  projectRoot, loadState, saveLoops, selectNextUnit, isLoopValid, loopDepsSatisfied, setLoopStatus,
} from './state.mjs';
import { validateProjectState, validateLoopsDoc, validateTasksDoc } from './validator.mjs';

function out(s = '') { process.stdout.write(s + '\n'); }

function cmdStatus(st) {
  out('Cowork GHC — Loop Engineer status');
  out(`  phase: ${st.project?.current_phase ?? 'unknown'}`);
  const loops = st.loops?.loops || [];
  out('  loops:');
  for (const l of loops) {
    const tag = isLoopValid(l) ? 'valid' : (loopDepsSatisfied(l, loops) ? 'ready?' : 'blocked-deps');
    const gate = l.gate?.result ? ` gate=${l.gate.result}` : '';
    out(`    ${l.id.padEnd(4)} ${String(l.status).padEnd(18)} [${tag}]${gate}  ${l.name || ''}`);
  }
  const tasks = st.tasks?.tasks || [];
  out(`  tasks: ${tasks.length === 0 ? 'none' : tasks.length}`);
  for (const t of tasks) out(`    ${t.id} ${t.status} owner=${t.owner} reviewer=${t.reviewer}`);
  const next = selectNextUnit({ loops, tasks });
  out(`  next: ${next ? `${next.kind} ${next.id} (${next.reason})` : 'none — all valid or blocked'}`);
  return 0;
}

function cmdNext(st) {
  const next = selectNextUnit({ loops: st.loops?.loops || [], tasks: st.tasks?.tasks || [] });
  if (!next) { out('next: nothing runnable (COMPLETED-and-valid units are skipped).'); return 0; }
  out(`next: ${next.kind} ${next.id} — ${next.reason}`);
  out('Run it via the /loop-engineer skill (orchestrates agents); this CLI only reports.');
  return 0;
}

function cmdVerify(st) {
  const results = [
    ['project-state', validateProjectState(st.project)],
    ['loops', validateLoopsDoc(st.loops)],
    ['tasks', validateTasksDoc(st.tasks)],
  ];
  let ok = true;
  for (const [name, r] of results) {
    if (r.valid) out(`  OK   ${name}`);
    else { ok = false; out(`  FAIL ${name}`); r.errors.forEach((e) => out(`         - ${e}`)); }
  }
  // Output existence check for COMPLETED loops.
  for (const l of st.loops?.loops || []) {
    if (l.status !== 'COMPLETED' || !Array.isArray(l.outputs)) continue;
    for (const rel of l.outputs) {
      const exists = existsAny(join(st.root, rel));
      if (!exists) { ok = false; out(`  FAIL ${l.id} output missing: ${rel}`); }
    }
  }
  out(ok ? 'verify: PASS' : 'verify: FAIL');
  return ok ? 0 : 1;
}

function existsAny(p) {
  // trailing-slash tolerant existence check
  return existsSync(p.replace(/[\\/]+$/, ''));
}

function cmdDryRun(st, selector) {
  out(`dry-run ${selector || '(next)'} — no changes made`);
  const next = selectNextUnit({ loops: st.loops?.loops || [], tasks: st.tasks?.tasks || [] });
  out(`  planned unit: ${next ? `${next.kind} ${next.id}` : 'none'}`);
  out('  agents/files/tests/cost/risks are determined by the /loop-engineer skill at run time.');
  return 0;
}

function cmdInvalidate(st, id, reason) {
  if (!id) { out('invalidate: missing loop id'); return 1; }
  setLoopStatus(st.loops, id, { status: 'STALE', invalidated: { at: new Date().toISOString(), reason: reason || 'unspecified' } });
  saveLoops(st.loops, st.root);
  out(`invalidated ${id}: ${reason || 'unspecified'} -> status STALE`);
  return 0;
}

function main(argv = process.argv.slice(2)) {
  const st = loadState(projectRoot());
  const cmd = argv[0] || 'status';
  switch (cmd) {
    case 'status': return cmdStatus(st);
    case 'next': return cmdNext(st);
    case 'verify': return cmdVerify(st);
    case 'dry-run': return cmdDryRun(st, argv[1]);
    case 'invalidate': {
      const reasonIdx = argv.indexOf('--reason');
      return cmdInvalidate(st, argv[1], reasonIdx !== -1 ? argv.slice(reasonIdx + 1).join(' ') : '');
    }
    case 'run': case 'task': case 'slice': case 'all': case 'resume': case 'bootstrap': case 'plan':
      out(`"${cmd}" is orchestrated by the /loop-engineer skill (agent-led).`);
      out('This controller tracks state; use it for: status | next | verify | dry-run | invalidate.');
      return cmdStatus(st);
    default:
      out('usage: cli.mjs <status|next|verify|dry-run|invalidate|run|task|slice|all|resume|bootstrap|plan>');
      return 1;
  }
}

process.exit(main());
