import { describe, it, expect } from 'vitest';
import { expr } from '../../../src/logic/expr.js';

describe('Expression Helpers', () => {
  // ── Arithmetic ──────────────────────────────────────────────────

  describe('arithmetic', () => {
    it('add', () => {
      expect(expr.add('$a', '$b')).toEqual({ $add: ['$a', '$b'] });
    });

    it('subtract', () => {
      expect(expr.subtract('$total', '$discount')).toEqual({ $subtract: ['$total', '$discount'] });
    });

    it('multiply', () => {
      expect(expr.multiply('$qty', '$price')).toEqual({ $multiply: ['$qty', '$price'] });
    });

    it('divide', () => {
      expect(expr.divide('$total', 2)).toEqual({ $divide: ['$total', 2] });
    });

    it('mod', () => {
      expect(expr.mod('$value', 3)).toEqual({ $mod: ['$value', 3] });
    });

    it('abs', () => {
      expect(expr.abs('$balance')).toEqual({ $abs: '$balance' });
    });

    it('round with decimals', () => {
      expect(expr.round('$price', 2)).toEqual({ $round: ['$price', 2] });
    });

    it('round defaults to 0 decimals', () => {
      expect(expr.round('$price')).toEqual({ $round: ['$price', 0] });
    });

    it('floor', () => {
      expect(expr.floor('$avg')).toEqual({ $floor: '$avg' });
    });

    it('ceil', () => {
      expect(expr.ceil('$avg')).toEqual({ $ceil: '$avg' });
    });
  });

  // ── Comparison ──────────────────────────────────────────────────

  describe('comparison', () => {
    it('eq', () => {
      expect(expr.eq('$status', 'paid')).toEqual({ $eq: ['$status', 'paid'] });
    });

    it('neq', () => {
      expect(expr.neq('$status', 'cancelled')).toEqual({ $neq: ['$status', 'cancelled'] });
    });

    it('gt', () => {
      expect(expr.gt('$amount', 1000)).toEqual({ $gt: ['$amount', 1000] });
    });

    it('gte', () => {
      expect(expr.gte('$age', 18)).toEqual({ $gte: ['$age', 18] });
    });

    it('lt', () => {
      expect(expr.lt('$stock', 10)).toEqual({ $lt: ['$stock', 10] });
    });

    it('lte', () => {
      expect(expr.lte('$price', 500)).toEqual({ $lte: ['$price', 500] });
    });

    it('between', () => {
      expect(expr.between('$age', 18, 65)).toEqual({ $between: ['$age', 18, 65] });
    });

    it('isIn', () => {
      expect(expr.isIn('$status', ['paid', 'shipped'])).toEqual({
        $in: ['$status', ['paid', 'shipped']],
      });
    });
  });

  // ── Logical ─────────────────────────────────────────────────────

  describe('logical', () => {
    it('and', () => {
      const a = expr.gt('$x', 0);
      const b = expr.lt('$x', 100);
      expect(expr.and(a, b)).toEqual({ $and: [a, b] });
    });

    it('and with multiple args', () => {
      const result = expr.and(
        expr.gt('$a', 0),
        expr.lt('$b', 10),
        expr.eq('$c', true),
      );
      expect(result.$and).toHaveLength(3);
    });

    it('or', () => {
      const a = expr.eq('$x', 1);
      const b = expr.eq('$x', 2);
      expect(expr.or(a, b)).toEqual({ $or: [a, b] });
    });

    it('not', () => {
      const inner = expr.eq('$status', 'cancelled');
      expect(expr.not(inner)).toEqual({ $not: inner });
    });

    it('cond', () => {
      expect(expr.cond(expr.gt('$a', 0), '$a', 0)).toEqual({
        $cond: [{ $gt: ['$a', 0] }, '$a', 0],
      });
    });
  });

  // ── String ──────────────────────────────────────────────────────

  describe('string', () => {
    it('concat', () => {
      expect(expr.concat('$first', ' ', '$last')).toEqual({
        $concat: ['$first', ' ', '$last'],
      });
    });

    it('upper', () => {
      expect(expr.upper('$name')).toEqual({ $upper: '$name' });
    });

    it('lower', () => {
      expect(expr.lower('$email')).toEqual({ $lower: '$email' });
    });

    it('length', () => {
      expect(expr.length('$name')).toEqual({ $length: '$name' });
    });

    it('trim', () => {
      expect(expr.trim('$input')).toEqual({ $trim: '$input' });
    });

    it('substring with length', () => {
      expect(expr.substring('$code', 0, 3)).toEqual({ $substring: ['$code', 0, 3] });
    });

    it('substring without length', () => {
      expect(expr.substring('$code', 2)).toEqual({ $substring: ['$code', 2] });
    });
  });

  // ── Date ────────────────────────────────────────────────────────

  describe('date', () => {
    it('now', () => {
      expect(expr.now()).toEqual({ $now: true });
    });

    it('year', () => {
      expect(expr.year('$createdAt')).toEqual({ $year: '$createdAt' });
    });

    it('month', () => {
      expect(expr.month('$createdAt')).toEqual({ $month: '$createdAt' });
    });

    it('day', () => {
      expect(expr.day('$createdAt')).toEqual({ $day: '$createdAt' });
    });

    it('daysBetween', () => {
      expect(expr.daysBetween('$issued', '$due')).toEqual({
        $daysBetween: ['$issued', '$due'],
      });
    });

    it('dateAdd', () => {
      expect(expr.dateAdd('$issued', 30, 'day')).toEqual({
        $dateAdd: ['$issued', 30, 'day'],
      });
    });
  });

  // ── Aggregate ───────────────────────────────────────────────────

  describe('aggregate', () => {
    it('sum', () => {
      expect(expr.sum('amount')).toEqual({ $sum: 'amount' });
    });

    it('avg', () => {
      expect(expr.avg('rating')).toEqual({ $avg: 'rating' });
    });

    it('min', () => {
      expect(expr.min('price')).toEqual({ $min: 'price' });
    });

    it('max', () => {
      expect(expr.max('price')).toEqual({ $max: 'price' });
    });

    it('count with field', () => {
      expect(expr.count('id')).toEqual({ $count: 'id' });
    });

    it('count without field defaults to *', () => {
      expect(expr.count()).toEqual({ $count: '*' });
    });
  });

  // ── Utility ─────────────────────────────────────────────────────

  describe('utility', () => {
    it('f creates field reference', () => {
      expect(expr.f('price')).toBe('$price');
    });

    it('f with nested field', () => {
      expect(expr.f('address.city')).toBe('$address.city');
    });
  });

  // ── Composition ─────────────────────────────────────────────────

  describe('composition', () => {
    it('nesting works correctly', () => {
      const totalPrice = expr.multiply(
        '$quantity',
        expr.multiply('$unitPrice', expr.subtract(1, '$discount')),
      );

      expect(totalPrice).toEqual({
        $multiply: [
          '$quantity',
          { $multiply: ['$unitPrice', { $subtract: [1, '$discount'] }] },
        ],
      });
    });

    it('complex condition with aggregate', () => {
      const balance = expr.subtract(expr.sum('je.debit'), expr.sum('je.credit'));

      expect(balance).toEqual({
        $subtract: [{ $sum: 'je.debit' }, { $sum: 'je.credit' }],
      });
    });
  });
});
