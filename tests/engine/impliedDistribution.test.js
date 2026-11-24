import { describe, it, expect } from 'vitest';
import {
  black76,
  buildImpliedDistribution,
  probBelow,
  probAbove,
  lognormalProbBelow,
  expectedPayoff,
  probPayoffPositive,
  classifyShape,
  distributionSummary,
  distributionCurve,
} from '../../src/engine/impliedDistribution.js';

// ─── Synthetic chains ────────────────────────────────────

const R = 0.043;
const SPOT = 100;
const DTE = 120;
const T = DTE / 365;
const F = SPOT * Math.exp(R * T);

/** Two-sided chain priced off a volatility function of log-moneyness. */
function makeChain(volFn, { lo = 50, hi = 170, step = 5, spread = 0.02 } = {}) {
  const calls = [];
  const puts = [];
  for (let k = lo; k <= hi; k += step) {
    const iv = volFn(Math.log(k / F));
    const c = black76(F, k, T, iv, true, R);
    const p = black76(F, k, T, iv, false, R);
    const q = (m) => {
      const mid = Math.max(m, 0.02);
      return { bid: +(mid * (1 - spread)).toFixed(4), ask: +(mid * (1 + spread)).toFixed(4) };
    };
    calls.push({ strike: k, ...q(c), impliedVolatility: iv, openInterest: 500, volume: 50 });
    puts.push({ strike: k, ...q(p), impliedVolatility: iv, openInterest: 500, volume: 50 });
  }
  return { calls, puts };
}

const flat = makeChain(() => 0.30);
const skewed = makeChain((x) => Math.max(0.12, 0.30 - 0.45 * x + 0.6 * x * x));
const lottery = makeChain(() => 0.90, { lo: 10, hi: 400, step: 10 });

const normCdf = (z) => {
  // reference via erf series-free approximation (same accuracy as engine)
  const t = 1 / (1 + 0.3275911 * Math.abs(z) / Math.SQRT2);
  const y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-(z * z) / 2);
  return 0.5 * (1 + (z < 0 ? -y : y));
};
const lognormalBelow = (K, sigma) => normCdf((Math.log(K / F) + 0.5 * sigma * sigma * T) / (sigma * Math.sqrt(T)));

// ─── black76 ─────────────────────────────────────────────

describe('black76', () => {
  it('satisfies put-call parity on the forward', () => {
    const c = black76(F, 95, T, 0.3, true, R);
    const p = black76(F, 95, T, 0.3, false, R);
    expect(c - p).toBeCloseTo(Math.exp(-R * T) * (F - 95), 8);
  });
  it('zero vol / zero time → discounted intrinsic (boundary)', () => {
    expect(black76(F, 90, 0, 0.3, true, R)).toBeCloseTo(F - 90, 8);
    expect(black76(F, 110, T, 0, true, R)).toBe(0);
  });
  it('invalid input → NaN', () => {
    expect(black76(-1, 100, T, 0.3, true, R)).toBeNaN();
  });
});

// ─── buildImpliedDistribution ────────────────────────────

describe('buildImpliedDistribution', () => {
  const d = buildImpliedDistribution({ ...flat, spot: SPOT, daysToExpiry: DTE, riskFreeRate: R });

  it('flat-vol chain recovers the lognormal distribution', () => {
    expect(d).not.toBeNull();
    expect(d.forward).toBeCloseTo(F, 1);
    expect(d.atmIv).toBeCloseTo(0.30, 2);
    expect(d.stats.mean).toBeCloseTo(F, 0);
    for (const K of [80, 90, 100, 110, 125]) {
      expect(probBelow(d, K)).toBeCloseTo(lognormalBelow(K, 0.30), 2);
    }
    expect(d.shape.key).toBe('normal');
  });

  it('density integrates to 1 and the CDF is monotone', () => {
    const h = d.grid[1] - d.grid[0];
    expect(d.pdf.reduce((s, v) => s + v * h, 0)).toBeCloseTo(1, 6);
    for (let i = 1; i < d.cdf.length; i++) expect(d.cdf[i]).toBeGreaterThanOrEqual(d.cdf[i - 1]);
  });

  it('expected call payoff reprices the market call (Breeden–Litzenberger consistency)', () => {
    const ev = expectedPayoff(d, (S) => Math.max(S - 105, 0));
    const callMid = black76(F, 105, T, 0.30, true, R) * Math.exp(R * T);
    expect(ev).toBeCloseTo(callMid, 1);
  });

  it('put skew produces a fatter left tail than lognormal', () => {
    const s = buildImpliedDistribution({ ...skewed, spot: SPOT, daysToExpiry: DTE, riskFreeRate: R });
    expect(s.tails.implied.down30).toBeGreaterThan(s.tails.lognormal.down30 * 1.4);
    expect(s.shape.key).toBe('left-tail');
    expect(s.stats.skew).toBeLessThan(d.stats.skew);
  });

  it('very high vol is classified as a lottery-ticket shape', () => {
    const l = buildImpliedDistribution({ ...lottery, spot: SPOT, daysToExpiry: DTE, riskFreeRate: R });
    expect(l.shape.key).toBe('lottery');
    expect(l.tails.implied.up30).toBeGreaterThan(0.15);
  });

  it('works from a puts-only chain using the carry forward (boundary)', () => {
    const p = buildImpliedDistribution({ calls: [], puts: flat.puts, spot: SPOT, daysToExpiry: DTE, riskFreeRate: R });
    expect(p).not.toBeNull();
    expect(p.forwardSource).toBe('carry');
    expect(probBelow(p, 90)).toBeCloseTo(lognormalBelow(90, 0.30), 2);
  });

  it('ignores one-sided and very wide quotes', () => {
    const noisy = {
      calls: flat.calls.map((c, i) => (i % 3 === 0 ? { ...c, bid: 0 } : c)),
      puts: flat.puts.map((c, i) => (i % 4 === 0 ? { ...c, bid: c.bid * 0.1, ask: c.ask * 3 } : c)),
    };
    const n = buildImpliedDistribution({ ...noisy, spot: SPOT, daysToExpiry: DTE, riskFreeRate: R });
    expect(n.strikesUsed).toBeLessThan(d.strikesUsed);
    expect(probBelow(n, 90)).toBeCloseTo(lognormalBelow(90, 0.30), 2);
  });

  it('insufficient or invalid input → null', () => {
    expect(buildImpliedDistribution({ calls: flat.calls.slice(0, 2), puts: [], spot: SPOT, daysToExpiry: DTE })).toBeNull();
    expect(buildImpliedDistribution({ ...flat, spot: 0, daysToExpiry: DTE })).toBeNull();
    expect(buildImpliedDistribution({ ...flat, spot: SPOT, daysToExpiry: 0 })).toBeNull();
    expect(buildImpliedDistribution()).toBeNull();
  });
});

// ─── Probability helpers ─────────────────────────────────

describe('probBelow / probAbove', () => {
  const d = buildImpliedDistribution({ ...flat, spot: SPOT, daysToExpiry: DTE, riskFreeRate: R });
  it('are complementary', () => {
    expect(probBelow(d, 97) + probAbove(d, 97)).toBeCloseTo(1, 10);
  });
  it('clamp to 0 / 1 outside the grid (boundary)', () => {
    expect(probBelow(d, 1)).toBe(0);
    expect(probBelow(d, 10000)).toBe(1);
  });
  it('null distribution → null', () => {
    expect(probBelow(null, 100)).toBeNull();
    expect(probAbove(undefined, 100)).toBeNull();
  });
});

describe('expectedPayoff / probPayoffPositive', () => {
  const d = buildImpliedDistribution({ ...flat, spot: SPOT, daysToExpiry: DTE, riskFreeRate: R });
  it('bull call spread: PoP equals P(S > breakeven)', () => {
    const debit = 3;
    const payoff = (S) => Math.min(Math.max(S - 100, 0), 10) - debit;
    expect(probPayoffPositive(d, payoff)).toBeCloseTo(probAbove(d, 103), 2);
  });
  it('fairly priced spread has ≈ zero expected value', () => {
    const debit = (black76(F, 100, T, 0.3, true, R) - black76(F, 110, T, 0.3, true, R)) * Math.exp(R * T);
    const ev = expectedPayoff(d, (S) => Math.min(Math.max(S - 100, 0), 10) - debit);
    expect(Math.abs(ev)).toBeLessThan(0.05);
  });
  it('invalid input → null', () => {
    expect(expectedPayoff(null, () => 1)).toBeNull();
    expect(probPayoffPositive(d, null)).toBeNull();
  });
});

// ─── Shape classification ────────────────────────────────

describe('classifyShape', () => {
  const ln = { down20: 0.12, down30: 0.04, up20: 0.15, up30: 0.08 };
  it('left tail when crash odds ≥1.4× lognormal', () => {
    expect(classifyShape({ atmIv: 0.35, implied: { ...ln, down30: 0.07 }, lognormal: ln }).key).toBe('left-tail');
  });
  it('right tail when upside odds ≥1.25× lognormal', () => {
    expect(classifyShape({ atmIv: 0.35, implied: { ...ln, up30: 0.11 }, lognormal: ln }).key).toBe('right-tail');
  });
  it('lottery at ≥70% vol; narrow below 25% vol (boundaries)', () => {
    expect(classifyShape({ atmIv: 0.70, implied: ln, lognormal: ln }).key).toBe('lottery');
    expect(classifyShape({ atmIv: 0.249, implied: ln, lognormal: ln }).key).toBe('narrow');
    expect(classifyShape({ atmIv: 0.25, implied: ln, lognormal: ln }).key).toBe('normal');
  });
  it('invalid input → unknown', () => {
    expect(classifyShape({}).key).toBe('unknown');
  });
});

// ─── Summary / curve ─────────────────────────────────────

describe('distributionSummary / distributionCurve', () => {
  const d = buildImpliedDistribution({ ...skewed, spot: SPOT, daysToExpiry: DTE, riskFreeRate: R });
  it('summary drops the heavy arrays and keeps the decision fields', () => {
    const s = distributionSummary(d);
    expect(s.grid).toBeUndefined();
    expect(s.shape.key).toBe('left-tail');
    expect(s.tails.implied.down30).toBeGreaterThan(0);
    expect(s.range90[0]).toBeLessThan(SPOT);
    expect(s.range90[1]).toBeGreaterThan(SPOT);
  });
  it('curve is downsampled to the requested number of points', () => {
    const c = distributionCurve(d, 60);
    expect(c).toHaveLength(60);
    expect(c[0]).toHaveProperty('implied');
    expect(c[0]).toHaveProperty('lognormal');
  });
  it('null input → null / empty', () => {
    expect(distributionSummary(null)).toBeNull();
    expect(distributionCurve(null)).toEqual([]);
  });
});

describe('lognormalProbBelow', () => {
  const d = buildImpliedDistribution({ ...flat, spot: SPOT, daysToExpiry: DTE, riskFreeRate: R });
  it('matches the closed-form lognormal CDF', () => {
    expect(lognormalProbBelow(d, 90)).toBeCloseTo(lognormalBelow(90, d.atmIv), 6);
  });
  it('is ≈ the implied CDF for a flat-vol chain', () => {
    expect(lognormalProbBelow(d, 85)).toBeCloseTo(probBelow(d, 85), 2);
  });
  it('invalid input → null', () => {
    expect(lognormalProbBelow(null, 90)).toBeNull();
    expect(lognormalProbBelow(d, 0)).toBeNull();
  });
});
