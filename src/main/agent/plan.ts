import { ToolSpec, PlanStep } from './types';

const VALID_STATUS = new Set(['pending', 'running', 'done']);

export const UPDATE_PLAN_SPEC: ToolSpec = {
  name: 'update_plan',
  description:
    "Update the task checklist shown to the user. Pass the FULL list of steps with each step's status " +
    "(pending / running / done). Call it as you work: mark the current step 'running', then 'done' when finished.",
  parameters: {
    type: 'object',
    properties: {
      steps: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            title: { type: 'string' },
            status: { type: 'string', enum: ['pending', 'running', 'done'] },
          },
          required: ['title'],
        },
      },
    },
    required: ['steps'],
  },
};

export function normalizePlanSteps(raw: unknown): PlanStep[] {
  if (!Array.isArray(raw)) return [];
  const out: PlanStep[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const title = String((item as any).title ?? '').trim();
    if (!title) continue;
    let status = String((item as any).status ?? 'pending').trim().toLowerCase();
    if (!VALID_STATUS.has(status)) status = 'pending';
    out.push({ title, status: status as PlanStep['status'] });
  }
  return out;
}
