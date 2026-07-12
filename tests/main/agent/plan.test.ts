import { describe, it, expect } from 'vitest';
import { normalizePlanSteps, UPDATE_PLAN_SPEC } from '../../../src/main/agent/plan';

describe('UPDATE_PLAN_SPEC', () => {
  it('is named update_plan and requires steps', () => {
    expect(UPDATE_PLAN_SPEC.name).toBe('update_plan');
    expect(UPDATE_PLAN_SPEC.parameters.required).toEqual(['steps']);
  });
});

describe('normalizePlanSteps', () => {
  it('normalizes valid steps and clamps unknown status to pending', () => {
    const result = normalizePlanSteps([
      { title: 'Read data', status: 'done' },
      { title: 'Write report', status: 'bogus' },
      { title: 'Send Teams message' },
    ]);
    expect(result).toEqual([
      { title: 'Read data', status: 'done' },
      { title: 'Write report', status: 'pending' },
      { title: 'Send Teams message', status: 'pending' },
    ]);
  });

  it('drops items with an empty title and non-object items', () => {
    const result = normalizePlanSteps([{ title: '   ' }, 'not-an-object', { title: 'Valid' }]);
    expect(result).toEqual([{ title: 'Valid', status: 'pending' }]);
  });

  it('returns an empty array when raw is not an array', () => {
    expect(normalizePlanSteps(null)).toEqual([]);
    expect(normalizePlanSteps({})).toEqual([]);
  });
});
