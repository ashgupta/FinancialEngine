import { describe, it, expect } from 'vitest';
import { evaluateStrategy } from '../../src/engine/strategyEvaluator.js';
import { black76, buildImpliedDistribution, probAbove } from '../../src/engine/impliedDistribution.js';

const R = 0.043, DTE = 90, T = DTE / 365, S = 100, F = S * Math.exp(R * T);
const vol = (k) => Math.max(0.12, 0.28 - 0.4 * Math.log(k / F) + 0.5 * Math.log(k / F) ** 2);
const chain = (isCall) => {
  const out = [];
  for (let k = 60; k <= 150; k += 5) {
    const p = black76(F, k, T, vol(k), isCall, R);
    out.push({ strike: k, bid: p * 0.99, ask: p * 1.01 });
  }
  return out;
};
const dist = buildImpliedDistribution({ calls: chain(true), puts: chain(false), spot: S, daysToExpiry: DTE, riskFreeRate: R });

const callPx = (k) => black76(F, k, T, vol(k), true, R);
const bullCall = [
  { kind: 'call', side: 'long', quantity: 1, strike: 100, premium: callPx(100), iv: vol(100), dte: DTE },
  { kind: 'call', side: 'short', quantity: 1, strike: 110, premium: callPx(110), iv: vol(110), dte: DTE },
];

describe('evaluateStrategy', () => {
  it('lognormal Monte Carlo PoP by default', () => {
    const r = evaluateStrategy({ legs: bullCall, spotPrice: S });
    expect(r.valid).toBe(true);
    expect(r.popMethod).toBe('lognormal');
    expect(r.probabilityOfProfit).toBeGreaterThan(0);
    expect(r.expectedValue).toBeNull();
  });

  it('implied distribution PoP equals P(S > breakeven) and EV ≈ 0 for a fair spread', () => {
    const r = evaluateStrategy({ legs: bullCall, spotPrice: S, distribution: dist });
    expect(r.popMethod).toBe('implied');
    const be = 100 + (callPx(100) - callPx(110));
    expect(r.probabilityOfProfit).toBeCloseTo(probAbove(dist, be), 3);
    // Premiums are discounted prices; EV at expiry is ≈ the carry on the debit.
    expect(Math.abs(r.expectedValue)).toBeLessThan(15);
    expect(r.distributionShape.key).toBeDefined();
  });

  it('invalid distribution falls back to lognormal (boundary)', () => {
    const r = evaluateStrategy({ legs: bullCall, spotPrice: S, distribution: { grid: [] } });
    expect(r.popMethod).toBe('lognormal');
  });

  it('no legs → invalid', () => {
    expect(evaluateStrategy({ legs: [], spotPrice: S }).valid).toBe(false);
  });
});
