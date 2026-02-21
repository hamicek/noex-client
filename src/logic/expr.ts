import type { Expression } from '../types.js';

type Arg = Expression;

export const expr = {
  // ── Arithmetic ──────────────────────────────────────────────────

  add: (a: Arg, b: Arg) => ({ $add: [a, b] }),
  subtract: (a: Arg, b: Arg) => ({ $subtract: [a, b] }),
  multiply: (a: Arg, b: Arg) => ({ $multiply: [a, b] }),
  divide: (a: Arg, b: Arg) => ({ $divide: [a, b] }),
  mod: (a: Arg, b: Arg) => ({ $mod: [a, b] }),
  abs: (a: Arg) => ({ $abs: a }),
  round: (a: Arg, decimals?: number) => ({ $round: [a, decimals ?? 0] }),
  floor: (a: Arg) => ({ $floor: a }),
  ceil: (a: Arg) => ({ $ceil: a }),

  // ── Comparison ──────────────────────────────────────────────────

  eq: (a: Arg, b: Arg) => ({ $eq: [a, b] }),
  neq: (a: Arg, b: Arg) => ({ $neq: [a, b] }),
  gt: (a: Arg, b: Arg) => ({ $gt: [a, b] }),
  gte: (a: Arg, b: Arg) => ({ $gte: [a, b] }),
  lt: (a: Arg, b: Arg) => ({ $lt: [a, b] }),
  lte: (a: Arg, b: Arg) => ({ $lte: [a, b] }),
  between: (a: Arg, min: Arg, max: Arg) => ({ $between: [a, min, max] }),
  isIn: (a: Arg, list: Arg[]) => ({ $in: [a, list] }),

  // ── Logical ─────────────────────────────────────────────────────

  and: (...conds: Arg[]) => ({ $and: conds }),
  or: (...conds: Arg[]) => ({ $or: conds }),
  not: (a: Arg) => ({ $not: a }),
  cond: (condition: Arg, then: Arg, otherwise: Arg) => ({ $cond: [condition, then, otherwise] }),

  // ── String ──────────────────────────────────────────────────────

  concat: (...parts: Arg[]) => ({ $concat: parts }),
  upper: (a: Arg) => ({ $upper: a }),
  lower: (a: Arg) => ({ $lower: a }),
  length: (a: Arg) => ({ $length: a }),
  trim: (a: Arg) => ({ $trim: a }),
  substring: (a: Arg, start: number, len?: number) => (
    len !== undefined ? { $substring: [a, start, len] } : { $substring: [a, start] }
  ),

  // ── Date ────────────────────────────────────────────────────────

  now: () => ({ $now: true }),
  year: (a: Arg) => ({ $year: a }),
  month: (a: Arg) => ({ $month: a }),
  day: (a: Arg) => ({ $day: a }),
  daysBetween: (a: Arg, b: Arg) => ({ $daysBetween: [a, b] }),
  dateAdd: (date: Arg, n: number, unit: 'day' | 'month' | 'year') => ({ $dateAdd: [date, n, unit] }),

  // ── Aggregate ───────────────────────────────────────────────────

  sum: (field: string) => ({ $sum: field }),
  avg: (field: string) => ({ $avg: field }),
  min: (field: string) => ({ $min: field }),
  max: (field: string) => ({ $max: field }),
  count: (field?: string) => ({ $count: field ?? '*' }),

  // ── Utility ─────────────────────────────────────────────────────

  /** Shorthand for field reference: expr.f('price') → '$price' */
  f: (fieldName: string) => `$${fieldName}` as const,
} as const;
