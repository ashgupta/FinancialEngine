import { describe, it, expect } from 'vitest';
import { computeVixIndexCurve, analyzeVolatility } from '../../src/engine/volatilityEngine.js';
import { computeCrashIndicator } from '../../src/engine/crashIndicator.js';

const series = (n, v) => Array.from({ length: n }, (_, i) => v + Math.sin(i) * 0.1);

describe('computeVixIndexCurve (CBOE VIX9D/VIX3M/VIX6M)', () => {
  it('contango when VIX3M > VIX (live 2026-09-26: 14.87 / 17.93 / 20.01)', () => {
    const c = computeVixIndexCurve(14.87, { vix9d: 12.76, vix3m: 17.93, vix6m: 20.01 });
    expect(c.contango).toBe(true);
    expect(c.backwardation).toBe(false);
    expect(c.label).toBe('Contango (normal)');
    expect(c.ratio).toBeCloseTo(14.87 / 17.93, 4);
    expect(c.spread).toBeCloseTo(3.06, 2);
    expect(c.source).toBe('cboe-index');
    expect(c.vx1).toBeNull();
  });

  it('backwardation when VIX > VIX3M', () => {
    const c = computeVixIndexCurve(38, { vix3m: 31, vix6m: 28 });
    expect(c.backwardation).toBe(true);
    expect(c.label).toMatch(/Backwardation/);
    expect(c.ratio).toBeGreaterThan(1);
  });

  it('boundary: equal values → Flat', () => {
    expect(computeVixIndexCurve(20, { vix3m: 20 }).label).toBe('Flat');
  });

  it('invalid input → null', () => {
    expect(computeVixIndexCurve(null, { vix3m: 18 })).toBeNull();
    expect(computeVixIndexCurve(15, {})).toBeNull();
    expect(computeVixIndexCurve(15, { vix3m: 0 })).toBeNull();
  });
});

describe('analyzeVolatility with curve histories', () => {
  const vix = { closes: series(130, 15) };
  const spy = { closes: series(130, 700) };

  it('uses the index curve when futures are absent', () => {
    const r = analyzeVolatility(vix, spy, null, null, {
      vix9d: { closes: series(130, 13) },
      vix3m: { closes: series(130, 18) },
      vix6m: { closes: series(130, 20) },
    });
    expect(r.termStructure).not.toBeNull();
    expect(r.termStructure.source).toBe('cboe-index');
    expect(r.termStructure.contango).toBe(true);
    expect(r.description).toMatch(/VIX curve is in contango/);
  });

  it('prefers real futures when VX1 is present', () => {
    const r = analyzeVolatility(vix, spy, { closes: series(130, 16) }, { closes: series(130, 17) }, {
      vix3m: { closes: series(130, 18) },
    });
    expect(r.termStructure.vx1).not.toBeNull();
    expect(r.termStructure.source).toBeUndefined();
  });

  it('no futures and no curve → termStructure null (unchanged behaviour)', () => {
    expect(analyzeVolatility(vix, spy).termStructure).toBeNull();
  });
});

describe('crash indicator term-structure factor with VIX3M', () => {
  it('scores contango low and names VIX3M in the note', () => {
    const r = computeCrashIndicator({ volatility: { vixLevel: 14.9, termStructure: { vix: 14.9, vx1: null, vix3m: 17.9 } } });
    const f = r.factors.find((x) => x.key === 'termStructure');
    expect(f.value).toBeCloseTo(-3.0, 1);
    expect(f.score).toBe(5);
    expect(f.note).toMatch(/VIX3M/);
  });

  it('scores inversion high', () => {
    const r = computeCrashIndicator({ volatility: { vixLevel: 40, termStructure: { vix: 40, vix3m: 34 } } });
    const f = r.factors.find((x) => x.key === 'termStructure');
    expect(f.score).toBe(100);
    expect(f.note).toMatch(/Backwardation/);
  });

  it('missing forward point → unavailable, score 0', () => {
    const r = computeCrashIndicator({ volatility: { vixLevel: 20, termStructure: { vix: 20 } } });
    const f = r.factors.find((x) => x.key === 'termStructure');
    expect(f.value).toBeNull();
    expect(f.note).toMatch(/unavailable/);
  });
});
