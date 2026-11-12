import { BadRequestException } from '@nestjs/common';
import type { EntityDefinition, FieldDefinition } from '@nexus/shared-types';

/** Validate & coerce record data against field definitions. `partial` for PATCH. */
export function validateRecord(def: EntityDefinition, input: Record<string, unknown>, partial = false): Record<string, unknown> {
  const known = new Map(def.fields.map((f) => [f.name, f]));
  const errors: string[] = [];
  const out: Record<string, unknown> = {};

  for (const key of Object.keys(input)) {
    if (!known.has(key)) errors.push(`Unknown field "${key}"`);
  }

  for (const field of def.fields) {
    const has = Object.prototype.hasOwnProperty.call(input, field.name);
    let value = has ? input[field.name] : partial ? undefined : field.defaultValue;
    if (!has && partial) continue;

    if (value === undefined || value === null || value === '') {
      if (field.required) errors.push(`${field.label} is required`);
      if (has) out[field.name] = null;
      continue;
    }
    try {
      value = coerce(field, value);
      out[field.name] = value;
    } catch (e) {
      errors.push(`${field.label}: ${(e as Error).message}`);
    }
  }

  if (errors.length) throw new BadRequestException({ message: 'Validation failed', errors });
  return out;
}

function coerce(field: FieldDefinition, value: unknown): unknown {
  switch (field.type) {
    case 'number':
    case 'money': {
      const n = Number(value);
      if (!Number.isFinite(n)) throw new Error('must be a number');
      return n;
    }
    case 'boolean':
      if (typeof value === 'boolean') return value;
      if (value === 'true' || value === 'false') return value === 'true';
      throw new Error('must be true/false');
    case 'date':
    case 'datetime': {
      const d = new Date(String(value));
      if (Number.isNaN(d.getTime())) throw new Error('invalid date');
      return field.type === 'date' ? d.toISOString().slice(0, 10) : d.toISOString();
    }
    case 'email':
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value))) throw new Error('invalid email');
      return String(value).toLowerCase();
    case 'select':
      if (field.options && !field.options.includes(String(value))) throw new Error(`must be one of ${field.options.join(', ')}`);
      return String(value);
    case 'multiselect': {
      const arr = Array.isArray(value) ? value.map(String) : [String(value)];
      if (field.options && arr.some((v) => !field.options!.includes(v))) throw new Error('invalid option');
      return arr;
    }
    case 'json':
      return value;
    default: {
      const s = String(value);
      if (s.length > 10_000) throw new Error('too long');
      return s;
    }
  }
}
