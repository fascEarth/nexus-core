/**
 * Small, synchronous condition evaluator used by ABAC permissions, workflow
 * guards and the rules engine. Format is compatible with json-rules-engine:
 *
 * { "all": [ { "fact": "after.days", "operator": "greaterThan", "value": 5 } ] }
 * { "any": [ ... ] }   { "not": { ... } }
 *
 * `value` may reference another fact: { "fact": "after.reorderLevel" }.
 */

export type Operator =
  | 'equal' | 'notEqual'
  | 'lessThan' | 'lessThanInclusive' | 'greaterThan' | 'greaterThanInclusive'
  | 'in' | 'notIn' | 'contains' | 'doesNotContain'
  | 'exists' | 'notExists' | 'changed';

export interface LeafCondition {
  fact: string;
  operator: Operator;
  value?: unknown;
}

export type Condition =
  | { all: Condition[] }
  | { any: Condition[] }
  | { not: Condition }
  | LeafCondition;

export function getPath(obj: unknown, path: string): unknown {
  return path.split('.').reduce<unknown>((acc, key) => {
    if (acc === null || acc === undefined) return undefined;
    return (acc as Record<string, unknown>)[key];
  }, obj);
}

function resolveValue(value: unknown, facts: Record<string, unknown>): unknown {
  if (value && typeof value === 'object' && 'fact' in (value as object)) {
    return getPath(facts, (value as { fact: string }).fact);
  }
  return value;
}

function compare(op: Operator, left: unknown, right: unknown, facts: Record<string, unknown>, fact: string): boolean {
  switch (op) {
    case 'equal': return left === right;
    case 'notEqual': return left !== right;
    case 'lessThan': return Number(left) < Number(right);
    case 'lessThanInclusive': return Number(left) <= Number(right);
    case 'greaterThan': return Number(left) > Number(right);
    case 'greaterThanInclusive': return Number(left) >= Number(right);
    case 'in': return Array.isArray(right) && right.includes(left);
    case 'notIn': return Array.isArray(right) && !right.includes(left);
    case 'contains':
      return Array.isArray(left) ? left.includes(right) : String(left ?? '').includes(String(right));
    case 'doesNotContain':
      return Array.isArray(left) ? !left.includes(right) : !String(left ?? '').includes(String(right));
    case 'exists': return left !== undefined && left !== null;
    case 'notExists': return left === undefined || left === null;
    case 'changed': {
      // fact like "after.status" → compare with "before.status"
      const beforePath = fact.replace(/^after\./, 'before.');
      return JSON.stringify(getPath(facts, beforePath)) !== JSON.stringify(left);
    }
    default: return false;
  }
}

export function evaluate(condition: Condition | null | undefined, facts: Record<string, unknown>): boolean {
  if (!condition) return true;
  if ('all' in condition) return condition.all.every((c) => evaluate(c, facts));
  if ('any' in condition) return condition.any.some((c) => evaluate(c, facts));
  if ('not' in condition) return !evaluate(condition.not, facts);
  const left = getPath(facts, condition.fact);
  const right = resolveValue(condition.value, facts);
  return compare(condition.operator, left, right, facts, condition.fact);
}

/** Replace {{path}} placeholders with fact values. */
export function renderTemplate(template: string, facts: Record<string, unknown>): string {
  return template.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_, path: string) => {
    const v = getPath(facts, path);
    return v === undefined || v === null ? '' : String(v);
  });
}

/** Render templates deep inside an object (strings only). */
export function renderDeep<T>(value: T, facts: Record<string, unknown>): T {
  if (typeof value === 'string') {
    // A value that is exactly one placeholder keeps its original type.
    const single = value.match(/^\{\{\s*([\w.]+)\s*\}\}$/);
    if (single) return getPath(facts, single[1]) as T;
    return renderTemplate(value, facts) as T;
  }
  if (Array.isArray(value)) return value.map((v) => renderDeep(v, facts)) as T;
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, renderDeep(v, facts)])) as T;
  }
  return value;
}
