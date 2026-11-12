import { evaluate, renderDeep, renderTemplate } from './conditions';

describe('conditions', () => {
  const facts = {
    before: { status: 'draft', qty: 10 },
    after: { status: 'submitted', qty: 3, reorderLevel: 5, tags: ['urgent'] },
    user: { id: 'u1' },
  };

  it('evaluates all/any/not', () => {
    expect(evaluate({ all: [{ fact: 'after.qty', operator: 'lessThan', value: 5 }] }, facts)).toBe(true);
    expect(evaluate({ any: [{ fact: 'after.qty', operator: 'greaterThan', value: 50 }, { fact: 'after.status', operator: 'equal', value: 'submitted' }] }, facts)).toBe(true);
    expect(evaluate({ not: { fact: 'after.status', operator: 'equal', value: 'submitted' } }, facts)).toBe(false);
  });

  it('compares against another fact', () => {
    expect(evaluate({ fact: 'after.qty', operator: 'lessThan', value: { fact: 'after.reorderLevel' } }, facts)).toBe(true);
  });

  it('detects changed fields', () => {
    expect(evaluate({ fact: 'after.status', operator: 'changed' }, facts)).toBe(true);
  });

  it('supports contains on arrays', () => {
    expect(evaluate({ fact: 'after.tags', operator: 'contains', value: 'urgent' }, facts)).toBe(true);
  });

  it('treats empty condition as true', () => {
    expect(evaluate(undefined, facts)).toBe(true);
  });

  it('renders templates and keeps types for single placeholders', () => {
    expect(renderTemplate('Qty {{after.qty}} for {{user.id}}', facts)).toBe('Qty 3 for u1');
    expect(renderDeep<Record<string, unknown>>({ qty: '{{after.qty}}', note: 'x{{after.qty}}' }, facts)).toEqual({ qty: 3, note: 'x3' });
  });
});
