import { describe, it, expect } from 'vitest';
import {
  computeRealizedVolatility,
  computeVolRegime,
  computeVixTermStructure,
  computeVolOfVol,
  analyzeVolatility,
  rateOfChange,
} from '../../src/engine/volatilityEngine.js';

// ─── Helpers ────────────────────────────────────────────

// Build a close series with a known daily volatility.
// dailyVol is the standard deviation of the daily log return (e.g. 0.01 = 1%).
function makeSeries(n = 60, dailyVol = 0.01, start = 100, seed = 42) {
  // Deterministic pseudo-random (LCG) so tests are reproducible
  let s = seed;
  const rand = () => {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    return s / 0x7fffffff;
  };
  // Box-Muller for normal-ish noise
  const gauss = () => {
    const u1 = Math.max(rand(), 1e-9);
    const u2 = rand();
    return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
  };
  const closes = [start];
  for (let i = 1; i < n; i++) {
    const ret = gauss() * dailyVol;
    closes.push(+(closes[i - 1] * Math.exp(ret)).toFixed(4));
  }
  return closes;
}

// ─── computeRealizedVolatility ──────────────────────────
describe('computeRealizedVolatility', () => {
  it('returns a positive annualized percentage for valid data', () => {
    const closes = makeSeries(60, 0.01);
    const vol = computeRealizedVolatility(closes, 20);
    expect(vol).not.toBeNull();
    expect(vol).toBeGreaterThan(0);
    // 1% daily vol * sqrt(252) * 100 ≈ 15.87%
    expect(vol).toBeGreaterThan(8);
    expect(vol).toBeLessThan(25);
  });

  it('returns higher vol for noisier series', () => {
    const calm = makeSeries(60, 0.005, 100, 1);
    const wild = makeSeries(60, 0.03, 100, 1);
    const volCalm = computeRealizedVolatility(calm, 20);
    const volWild = computeRealizedVolatility(wild, 20);
    expect(volWild).toBeGreaterThan(volCalm);
  });

  it('returns null for insufficient data', () => {
    expect(computeRealizedVolatility([100, 101, 102], 20)).toBeNull();
  });

  it('returns null for empty input', () => {
    expect(computeRealizedVolatility([], 20)).toBeNull();
    expect(computeRealizedVolatility(null, 20)).toBeNull();
  });

  it('respects the period parameter', () => {
    const closes = makeSeries(60, 0.01);
    const v20 = computeRealizedVolatility(closes, 20);
    const v40 = computeRealizedVolatility(closes, 40);
    expect(v20).not.toBeNull();
    expect(v40).not.toBeNull();
    // Both should be reasonable
    expect(v20).toBeGreaterThan(0);
    expect(v40).toBeGreaterThan(0);
  });
});

// ─── computeVolRegime ───────────────────────────────────
describe('computeVolRegime', () => {
  it('classifies low regime (< 15)', () => {
    expect(computeVolRegime(10)).toBe('low');
    expect(computeVolRegime(14.9)).toBe('low');
    expect(computeVolRegime(0)).toBe('low');
  });

  it('classifies normal regime (15-20)', () => {
    expect(computeVolRegime(15)).toBe('normal');
    expect(computeVolRegime(18)).toBe('normal');
    expect(computeVolRegime(19.9)).toBe('normal');
  });

  it('classifies elevated regime (20-30)', () => {
    expect(computeVolRegime(20)).toBe('elevated');
    expect(computeVolRegime(25)).toBe('elevated');
    expect(computeVolRegime(29.9)).toBe('elevated');
  });

  it('classifies high regime (30-50)', () => {
    expect(computeVolRegime(30)).toBe('high');
    expect(computeVolRegime(40)).toBe('high');
    expect(computeVolRegime(49.9)).toBe('high');
  });

  it('classifies crisis regime (> 50)', () => {
    expect(computeVolRegime(50)).toBe('crisis');
    expect(computeVolRegime(75)).toBe('crisis');
    expect(computeVolRegime(100)).toBe('crisis');
  });

  it('handles edge cases gracefully', () => {
    expect(computeVolRegime(null)).toBe('normal');
    expect(computeVolRegime(undefined)).toBe('normal');
    expect(computeVolRegime(NaN)).toBe('normal');
  });
});

// ─── computeVixTermStructure ────────────────────────────
describe('computeVixTermStructure', () => {
  it('detects contango when VX1 > VIX', () => {
    const result = computeVixTermStructure(
      { closes: [15, 16, 17] },
      { closes: [18, 19, 19.5] },
      { closes: [20, 21, 21.5] },
    );
    expect(result.vix).toBe(17);
    expect(result.vx1).toBe(19.5);
    expect(result.vx2).toBe(21.5);
    expect(result.contango).toBe(true);
    expect(result.backwardation).toBe(false);
    expect(result.spread).toBeCloseTo(2.5, 2);
    expect(result.label).toContain('Contango');
  });

  it('detects backwardation when VX1 < VIX', () => {
    const result = computeVixTermStructure(
      { closes: [15, 25, 30] },
      { closes: [18, 22, 25] },
      { closes: [20, 21, 27] },
    );
    expect(result.vix).toBe(30);
    expect(result.vx1).toBe(25);
    expect(result.contango).toBe(false);
    expect(result.backwardation).toBe(true);
    expect(result.spread).toBeCloseTo(-5, 2);
    expect(result.label).toContain('Backwardation');
  });

  it('computes slope when VX2 available', () => {
    const result = computeVixTermStructure(
      { closes: [15] },
      { closes: [17] },
      { closes: [20] },
    );
    // slope = (vx2 - vix) / vx2 = (20 - 15) / 20 = 0.25
    expect(result.slope).toBeCloseTo(0.25, 4);
  });

  it('handles missing VX2 gracefully', () => {
    const result = computeVixTermStructure(
      { closes: [15, 16, 17] },
      { closes: [18, 19, 19.5] },
      null,
    );
    expect(result.vix).toBe(17);
    expect(result.vx1).toBe(19.5);
    expect(result.vx2).toBeNull();
    expect(result.slope).toBeNull();
    expect(result.contango).toBe(true);
  });

  it('returns null when no VIX data', () => {
    expect(computeVixTermStructure({ closes: [] }, { closes: [18] })).toBeNull();
    expect(computeVixTermStructure(null, null)).toBeNull();
  });

  it('returns "Unavailable" label when VIX present but no VX1', () => {
    const result = computeVixTermStructure({ closes: [15, 16, 17] }, { closes: [] }, { closes: [] });
    expect(result.vix).toBe(17);
    expect(result.label).toBe('Unavailable');
    expect(result.spread).toBeNull();
  });
});

// ─── computeVolOfVol ────────────────────────────────────
describe('computeVolOfVol', () => {
  it('computes realized vol of VIX closes', () => {
    const vixCloses = makeSeries(60, 0.05, 20); // VIX around 20, 5% daily moves
    const vov = computeVolOfVol(vixCloses, 20);
    expect(vov).not.toBeNull();
    expect(vov).toBeGreaterThan(0);
    // 5% daily * sqrt(252) * 100 ≈ 79%
    expect(vov).toBeGreaterThan(40);
  });

  it('returns null for insufficient data', () => {
    expect(computeVolOfVol([20, 21, 22], 20)).toBeNull();
    expect(computeVolOfVol([], 20)).toBeNull();
  });
});

// ─── analyzeVolatility ──────────────────────────────────
describe('analyzeVolatility', () => {
  it('produces a complete dashboard payload', () => {
    const vixHistory = { closes: makeSeries(130, 0.03, 18), dates: [] };
    const spyHistory = { closes: makeSeries(130, 0.008, 400), dates: [] };
    const vx1History = { closes: makeSeries(130, 0.03, 19) };
    const vx2History = { closes: makeSeries(130, 0.03, 20) };

    const result = analyzeVolatility(vixHistory, spyHistory, vx1History, vx2History);

    expect(result.vixLevel).not.toBeNull();
    expect(result.volRegime).toBeDefined();
    expect(result.regimeColor).toBeDefined();
    expect(result.realizedVolSPY).not.toBeNull();
    expect(result.realizedVolSPY).toBeGreaterThan(0);
    expect(result.volRiskPremium).not.toBeNull();
    expect(result.volOfVol).not.toBeNull();
    expect(result.termStructure).not.toBeNull();
    expect(result.signal).toBeDefined();
    expect(result.description).toBeTruthy();
    expect(typeof result.description).toBe('string');
    expect(result.chart).toBeInstanceOf(Array);
    expect(result.chart.length).toBeGreaterThan(0);
    expect(result.fetchedAt).toBeTruthy();
  });

  it('sets sell vol signal when premium > 5', () => {
    // VIX high, SPY calm → big positive premium
    const vixHistory = { closes: makeSeries(130, 0.01, 25, 7) };
    const spyHistory = { closes: makeSeries(130, 0.003, 400, 9) };
    const result = analyzeVolatility(vixHistory, spyHistory);
    expect(result.volRiskPremium).not.toBeNull();
    // VIX ~25, realized ~ 0.3%*sqrt(252)*100 ≈ 4.8% → premium ~20
    if (result.volRiskPremium > 5) {
      expect(result.signal).toBe('sell vol');
    }
  });

  it('sets buy vol signal when premium < -5', () => {
    // VIX low, SPY wild → negative premium
    const vixHistory = { closes: makeSeries(130, 0.01, 12, 3) };
    const spyHistory = { closes: makeSeries(130, 0.04, 400, 5) };
    const result = analyzeVolatility(vixHistory, spyHistory);
    expect(result.volRiskPremium).not.toBeNull();
    // VIX ~12, realized ~ 4%*sqrt(252)*100 ≈ 63% → premium ~ -51
    if (result.volRiskPremium < -5) {
      expect(result.signal).toBe('buy vol');
    }
  });

  it('works without VX1/VX2 (termStructure null)', () => {
    const vixHistory = { closes: makeSeries(130, 0.02, 18) };
    const spyHistory = { closes: makeSeries(130, 0.01, 400) };
    const result = analyzeVolatility(vixHistory, spyHistory);
    expect(result.termStructure).toBeNull();
    expect(result.vixLevel).not.toBeNull();
    expect(result.signal).toBeDefined();
  });

  it('handles empty / insufficient input gracefully', () => {
    const result = analyzeVolatility(
      { closes: [] },
      { closes: [] },
      { closes: [] },
      { closes: [] },
    );
    expect(result.vixLevel).toBeNull();
    expect(result.realizedVolSPY).toBeNull();
    expect(result.volRiskPremium).toBeNull();
    expect(result.signal).toBe('neutral');
    expect(result.description).toBeTruthy();
  });

  it('handles null inputs', () => {
    const result = analyzeVolatility(null, null, null, null);
    expect(result.vixLevel).toBeNull();
    expect(result.signal).toBe('neutral');
  });
});

// ─── rateOfChange ───────────────────────────────────────
describe('rateOfChange', () => {
  it('computes percentage change over N periods', () => {
    expect(rateOfChange([100, 101, 102, 103, 104, 110], 5)).toBeCloseTo(10, 1);
  });

  it('returns null for insufficient data', () => {
    expect(rateOfChange([100, 101], 5)).toBeNull();
    expect(rateOfChange([], 5)).toBeNull();
    expect(rateOfChange(null, 5)).toBeNull();
  });

  it('returns null when past value is zero', () => {
    // period=3 looks back to index 0 which is 0
    expect(rateOfChange([0, 10, 20, 30], 3)).toBeNull();
  });
});
