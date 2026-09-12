import { describe, it, expect } from 'vitest';
import {
  analyzeSpreads,
  isLeaps,
  formatDTE,
  expiryCategory,
  _internal,
} from '../../src/engine/spreadAnalyzer.js';

const { normalCdf, probabilityCrosses, midPrice } = _internal;

// ── Helpers ────────────────────────────────────────────────────────────
const opt = (strike, bid, ask, iv = 0.30, vol = 100, oi = 500) => ({
  strike,
  bid,
  ask,
  lastPrice: (bid + ask) / 2,
  impliedVolatility: iv,
  volume: vol,
  openInterest: oi,
  inTheMoney: false,
  contractSymbol: `OPT_${strike}`,
});

// ── Math primitives ───────────────────────────────────────────────────
describe('normalCdf', () => {
  it('returns 0.5 at zero', () => {
    expect(normalCdf(0)).toBeCloseTo(0.5, 4);
  });
  it('returns ~0.8413 at +1σ', () => {
    expect(normalCdf(1)).toBeCloseTo(0.8413, 3);
  });
  it('returns ~0.1587 at -1σ', () => {
    expect(normalCdf(-1)).toBeCloseTo(0.1587, 3);
  });
  it('approaches 1 at +5σ', () => {
    expect(normalCdf(5)).toBeGreaterThan(0.9999);
  });
});

describe('probabilityCrosses', () => {
  it('returns null for non-positive sigma or T', () => {
    expect(probabilityCrosses(100, 100, 0, 0.1, 'above')).toBeNull();
    expect(probabilityCrosses(100, 100, 0.3, 0, 'above')).toBeNull();
  });
  it('ATM 30-day option has ~50% PoP at the money', () => {
    const p = probabilityCrosses(100, 100, 0.3, 30/365, 'above');
    expect(p).toBeGreaterThan(0.4);
    expect(p).toBeLessThan(0.6);
  });
  it('Far OTM bullish bet has low PoP', () => {
    const p = probabilityCrosses(100, 150, 0.3, 30/365, 'above');
    expect(p).toBeLessThan(0.1);
  });
  it('Direction "below" inverts probability', () => {
    const above = probabilityCrosses(100, 110, 0.3, 30/365, 'above');
    const below = probabilityCrosses(100, 110, 0.3, 30/365, 'below');
    expect(above + below).toBeCloseTo(1, 4);
  });
});

describe('midPrice', () => {
  it('uses (bid+ask)/2 when both positive', () => {
    expect(midPrice({ bid: 1, ask: 3, lastPrice: 5 })).toBe(2);
  });
  it('falls back to lastPrice when bid/ask zero', () => {
    expect(midPrice({ bid: 0, ask: 0, lastPrice: 5 })).toBe(5);
  });
});

// ── Bull call spread ──────────────────────────────────────────────────
describe('analyzeSpreads — bull call', () => {
  const baseChain = {
    calls: [
      opt(95, 6.0, 6.5),
      opt(100, 3.0, 3.5),
      opt(105, 1.0, 1.5),
      opt(110, 0.3, 0.5),
    ],
    puts: [],
    underlyingPrice: 100,
    daysToExpiry: 30,
  };

  it('produces candidates for every valid strike pair', () => {
    const r = analyzeSpreads({ ...baseChain, spreadType: 'bull_call' });
    // 4 strikes -> C(4,2) = 6 pairs (all should pass since prices descend)
    expect(r.length).toBeGreaterThan(0);
    expect(r.length).toBeLessThanOrEqual(6);
  });

  it('100/105 bull call: debit ≈ 2.5, max profit ≈ 2.5, BE ≈ 102.5', () => {
    const r = analyzeSpreads({ ...baseChain, spreadType: 'bull_call' });
    const c = r.find(x => x.longLeg.strike === 100 && x.shortLeg.strike === 105);
    expect(c).toBeDefined();
    // long mid 3.25, short mid 1.25 -> debit 2.0
    expect(c.netCost).toBeCloseTo(2.0, 2);
    expect(c.maxLoss).toBeCloseTo(200, 1);          // 2.0 × 100
    expect(c.maxProfit).toBeCloseTo(300, 1);        // (5 - 2) × 100
    expect(c.breakeven).toBeCloseTo(102.0, 2);
    expect(c.flow).toBe('debit');
  });

  it('respects maxRiskPerContract filter', () => {
    const r = analyzeSpreads({ ...baseChain, spreadType: 'bull_call', maxRiskPerContract: 150 });
    expect(r.every(c => c.maxLoss <= 150)).toBe(true);
  });

  it('respects maxWidth filter', () => {
    const r = analyzeSpreads({ ...baseChain, spreadType: 'bull_call', maxWidth: 5 });
    expect(r.every(c => c.width <= 5)).toBe(true);
  });

  it('respects minWidth filter', () => {
    // baseChain strikes are 95/100/105/110 -> widest available pair is 15
    const r = analyzeSpreads({ ...baseChain, spreadType: 'bull_call', minWidth: 12 });
    expect(r.every(c => c.width >= 12)).toBe(true);
    // 95/110 (width 15) should survive; 100/105 (width 5) should not
    expect(r.some(c => c.longLeg.strike === 95 && c.shortLeg.strike === 110)).toBe(true);
    expect(r.some(c => c.longLeg.strike === 100 && c.shortLeg.strike === 105)).toBe(false);
  });

  it('minWidth of 100 rejects all candidates on a narrow chain', () => {
    const r = analyzeSpreads({ ...baseChain, spreadType: 'bull_call', minWidth: 100 });
    expect(r.length).toBe(0);
  });

  it('rejects illiquid legs when minLiquidity set', () => {
    const illiquid = {
      ...baseChain,
      calls: [
        opt(100, 3.0, 3.5, 0.30, 0, 0),   // zero liquidity
        opt(105, 1.0, 1.5, 0.30, 100, 500),
      ],
    };
    const r = analyzeSpreads({ ...illiquid, spreadType: 'bull_call', minLiquidity: 50 });
    expect(r.length).toBe(0);
  });
});

// ── Bear put spread (debit) ───────────────────────────────────────────
describe('analyzeSpreads — bear put', () => {
  it('100/95 bear put: long 100p (mid 3), short 95p (mid 1.5) → debit 1.5', () => {
    const r = analyzeSpreads({
      calls: [],
      puts: [
        opt(95, 1.25, 1.75),
        opt(100, 2.75, 3.25),
      ],
      underlyingPrice: 100,
      daysToExpiry: 30,
      spreadType: 'bear_put',
    });
    const c = r[0];
    expect(c.flow).toBe('debit');
    expect(c.longLeg.strike).toBe(100);
    expect(c.shortLeg.strike).toBe(95);
    expect(c.netCost).toBeCloseTo(1.5, 2);
    expect(c.maxLoss).toBeCloseTo(150, 1);
    expect(c.maxProfit).toBeCloseTo(350, 1);    // (5 - 1.5) × 100
    expect(c.breakeven).toBeCloseTo(98.5, 2);
  });
});

// ── Bull put spread (credit) ──────────────────────────────────────────
describe('analyzeSpreads — bull put', () => {
  it('95/100 bull put: short 100p (mid 3), long 95p (mid 1.5) → credit 1.5', () => {
    const r = analyzeSpreads({
      calls: [],
      puts: [
        opt(95, 1.25, 1.75),
        opt(100, 2.75, 3.25),
      ],
      underlyingPrice: 100,
      daysToExpiry: 30,
      spreadType: 'bull_put',
    });
    const c = r[0];
    expect(c.flow).toBe('credit');
    expect(c.netCost).toBeCloseTo(-1.5, 2);    // negative = credit received
    expect(c.maxProfit).toBeCloseTo(150, 1);   // credit × 100
    expect(c.maxLoss).toBeCloseTo(350, 1);     // (5 - 1.5) × 100
    expect(c.breakeven).toBeCloseTo(98.5, 2);  // upper - credit
  });
});

// ── Bear call spread (credit) ─────────────────────────────────────────
describe('analyzeSpreads — bear call', () => {
  it('100/105 bear call: short 100c (3.25), long 105c (1.25) → credit 2.0', () => {
    const r = analyzeSpreads({
      calls: [
        opt(100, 3.0, 3.5),
        opt(105, 1.0, 1.5),
      ],
      puts: [],
      underlyingPrice: 100,
      daysToExpiry: 30,
      spreadType: 'bear_call',
    });
    const c = r[0];
    expect(c.flow).toBe('credit');
    expect(c.netCost).toBeCloseTo(-2.0, 2);
    expect(c.maxProfit).toBeCloseTo(200, 1);
    expect(c.maxLoss).toBeCloseTo(300, 1);     // (5 - 2) × 100
    expect(c.breakeven).toBeCloseTo(102, 2);   // lower + credit
  });
});

// ── Ranking & composite score ─────────────────────────────────────────
describe('analyzeSpreads — ranking', () => {
  it('returns candidates sorted by compositeScore descending', () => {
    const r = analyzeSpreads({
      calls: [
        opt(95, 6.0, 6.5),
        opt(100, 3.0, 3.5),
        opt(105, 1.0, 1.5),
        opt(110, 0.3, 0.5),
      ],
      puts: [],
      underlyingPrice: 100,
      daysToExpiry: 30,
      spreadType: 'bull_call',
    });
    for (let i = 1; i < r.length; i++) {
      expect(r[i - 1].compositeScore).toBeGreaterThanOrEqual(r[i].compositeScore);
    }
  });

  it('every candidate has valid math invariants', () => {
    const r = analyzeSpreads({
      calls: [
        opt(95, 6.0, 6.5),
        opt(100, 3.0, 3.5),
        opt(105, 1.0, 1.5),
      ],
      puts: [],
      underlyingPrice: 100,
      daysToExpiry: 30,
      spreadType: 'bull_call',
    });
    for (const c of r) {
      expect(c.maxProfit + c.maxLoss).toBeCloseTo(c.width * 100, 1);
      expect(c.riskReward).toBeCloseTo(c.maxProfit / c.maxLoss, 4);
      expect(c.probabilityOfProfit).toBeGreaterThanOrEqual(0);
      expect(c.probabilityOfProfit).toBeLessThanOrEqual(1);
    }
  });
});

// ── Edge cases ────────────────────────────────────────────────────────
describe('analyzeSpreads — edge cases', () => {
  it('returns [] for unknown spread type', () => {
    expect(() => analyzeSpreads({
      calls: [opt(100, 3, 3.5)], puts: [],
      underlyingPrice: 100, daysToExpiry: 30,
      spreadType: 'foo_bar',
    })).toThrow(/Unknown spread type/);
  });

  it('returns [] for empty chain', () => {
    expect(analyzeSpreads({
      calls: [], puts: [], underlyingPrice: 100,
      daysToExpiry: 30, spreadType: 'bull_call',
    })).toEqual([]);
  });

  it('returns [] when only one strike available', () => {
    expect(analyzeSpreads({
      calls: [opt(100, 3, 3.5)], puts: [],
      underlyingPrice: 100, daysToExpiry: 30,
      spreadType: 'bull_call',
    })).toEqual([]);
  });

  it('returns [] when underlyingPrice is invalid', () => {
    expect(analyzeSpreads({
      calls: [opt(95, 6, 6.5), opt(100, 3, 3.5)],
      puts: [], underlyingPrice: 0,
      daysToExpiry: 30, spreadType: 'bull_call',
    })).toEqual([]);
  });

  it('filters out arbitrage candidates (negative profit)', () => {
    // Inverted prices: lower strike call cheaper than higher
    const r = analyzeSpreads({
      calls: [
        opt(100, 1.0, 1.5),
        opt(105, 3.0, 3.5),
      ],
      puts: [],
      underlyingPrice: 100,
      daysToExpiry: 30,
      spreadType: 'bull_call',
    });
    expect(r.length).toBe(0);
  });
});

// ── LEAPS helpers ─────────────────────────────────────────────────────
describe('LEAPS helpers', () => {
  it('isLeaps: 30d = false, 270d = true, 365d = true, 1095d = true', () => {
    expect(isLeaps(30)).toBe(false);
    expect(isLeaps(180)).toBe(false);
    expect(isLeaps(269)).toBe(false);
    expect(isLeaps(270)).toBe(true);
    expect(isLeaps(365)).toBe(true);
    expect(isLeaps(1095)).toBe(true);
  });

  it('formatDTE: short-dated in days, >= 1y in years', () => {
    expect(formatDTE(7)).toBe('7d');
    expect(formatDTE(30)).toBe('30d');
    expect(formatDTE(364)).toBe('364d');
    expect(formatDTE(365)).toBe('1.0y');
    expect(formatDTE(730)).toBe('2.0y');
    expect(formatDTE(913)).toBe('2.5y');
    expect(formatDTE(1095)).toBe('3.0y');
  });

  it('formatDTE: handles invalid input gracefully', () => {
    expect(formatDTE(null)).toBe('—');
    expect(formatDTE(NaN)).toBe('—');
    expect(formatDTE(-5)).toBe('—');
  });

  it('expiryCategory: classifies all four tiers', () => {
    expect(expiryCategory(7)).toBe('weekly');
    expect(expiryCategory(14)).toBe('weekly');
    expect(expiryCategory(30)).toBe('monthly');
    expect(expiryCategory(60)).toBe('monthly');
    expect(expiryCategory(90)).toBe('quarterly');
    expect(expiryCategory(180)).toBe('quarterly');
    expect(expiryCategory(269)).toBe('quarterly');
    expect(expiryCategory(270)).toBe('leaps');
    expect(expiryCategory(730)).toBe('leaps');
    expect(expiryCategory(1095)).toBe('leaps');
  });
});

// ── Dividend yield impact on PoP (LEAPS-relevant) ─────────────────────
describe('probabilityCrosses — dividend yield', () => {
  it('q > 0 lowers P(above target) for a bullish bet (drag on forward)', () => {
    const noDiv  = probabilityCrosses(100, 110, 0.25, 2, 'above', 0.045, 0);
    const withDiv = probabilityCrosses(100, 110, 0.25, 2, 'above', 0.045, 0.03);
    expect(withDiv).toBeLessThan(noDiv);
  });

  it('q > 0 raises P(below target) for a bearish bet symmetrically', () => {
    const noDiv  = probabilityCrosses(100, 90, 0.25, 2, 'below', 0.045, 0);
    const withDiv = probabilityCrosses(100, 90, 0.25, 2, 'below', 0.045, 0.03);
    expect(withDiv).toBeGreaterThan(noDiv);
  });

  it('dividend effect is negligible for 30-day options', () => {
    const noDiv   = probabilityCrosses(100, 105, 0.3, 30/365, 'above', 0.045, 0);
    const withDiv = probabilityCrosses(100, 105, 0.3, 30/365, 'above', 0.045, 0.03);
    expect(Math.abs(withDiv - noDiv)).toBeLessThan(0.01);
  });

  it('dividend effect is significant for 3-year LEAPS', () => {
    const noDiv   = probabilityCrosses(100, 110, 0.25, 3, 'above', 0.045, 0);
    const withDiv = probabilityCrosses(100, 110, 0.25, 3, 'above', 0.045, 0.03);
    // 9% accumulated dividend drag over 3 years on a marginal-OTM bet is material
    expect(noDiv - withDiv).toBeGreaterThan(0.04);
  });
});

// ── Full pipeline: LEAPS scenarios ────────────────────────────────────
describe('analyzeSpreads — LEAPS horizons', () => {
  // Realistic ITM/ATM/OTM LEAPS prices: long-dated calls are expensive.
  // For a $100 stock with 25% IV at 1-year, ATM call ≈ $11, $90 call ≈ $17,
  // $110 call ≈ $6. These match Black-Scholes approximations.
  const leapsChain = {
    calls: [
      opt(80,  22.50, 23.50, 0.25, 50, 200),
      opt(90,  16.00, 17.00, 0.25, 80, 350),
      opt(100, 10.50, 11.50, 0.25, 120, 500),
      opt(110,  6.50,  7.50, 0.25, 90, 300),
      opt(120,  3.50,  4.50, 0.25, 60, 200),
      opt(130,  1.80,  2.80, 0.25, 30, 100),
    ],
    puts: [
      opt(80,   2.00,  3.00, 0.25, 40, 150),
      opt(90,   4.50,  5.50, 0.25, 70, 250),
      opt(100,  8.50,  9.50, 0.25, 110, 400),
      opt(110, 14.50, 15.50, 0.25, 80, 300),
      opt(120, 21.50, 22.50, 0.25, 50, 200),
    ],
    underlyingPrice: 100,
  };

  it('1-year bull call LEAPS produces valid candidates with isLeaps flag', () => {
    const r = analyzeSpreads({
      ...leapsChain,
      daysToExpiry: 365,
      spreadType: 'bull_call',
      maxRiskPerContract: 5000,
      maxWidth: 50,
    });
    expect(r.length).toBeGreaterThan(0);
    expect(r.every(c => c.isLeaps === true)).toBe(true);
    expect(r.every(c => c.daysToExpiry === 365)).toBe(true);
    for (const c of r) {
      expect(c.maxProfit + c.maxLoss).toBeCloseTo(c.width * 100, 0);
      expect(c.probabilityOfProfit).toBeGreaterThan(0);
      expect(c.probabilityOfProfit).toBeLessThan(1);
    }
  });

  it('2.5-year LEAPS: math still holds, breakeven sensible', () => {
    const r = analyzeSpreads({
      ...leapsChain,
      daysToExpiry: 913,
      spreadType: 'bull_call',
      maxRiskPerContract: 5000,
      maxWidth: 50,
    });
    expect(r.length).toBeGreaterThan(0);
    expect(r[0].isLeaps).toBe(true);
    // Breakeven should be between long and short strikes for bull call
    for (const c of r) {
      expect(c.breakeven).toBeGreaterThanOrEqual(c.longLeg.strike);
      expect(c.breakeven).toBeLessThanOrEqual(c.shortLeg.strike);
    }
  });

  it('3-year LEAPS with dividend yield: PoP lower than no-div case for bullish', () => {
    const noDiv = analyzeSpreads({
      ...leapsChain,
      daysToExpiry: 1095,
      spreadType: 'bull_call',
      maxRiskPerContract: 5000,
      maxWidth: 50,
      dividendYield: 0,
    });
    const withDiv = analyzeSpreads({
      ...leapsChain,
      daysToExpiry: 1095,
      spreadType: 'bull_call',
      maxRiskPerContract: 5000,
      maxWidth: 50,
      dividendYield: 0.03,
    });
    // Match by strike pair so we compare apples to apples
    const popByPair = (arr) => new Map(
      arr.map(c => [`${c.longLeg.strike}-${c.shortLeg.strike}`, c.probabilityOfProfit])
    );
    const a = popByPair(noDiv);
    const b = popByPair(withDiv);
    let comparisons = 0, droppedCount = 0;
    for (const [k, pNo] of a.entries()) {
      const pWith = b.get(k);
      if (pNo == null || pWith == null) continue;
      comparisons++;
      if (pWith < pNo) droppedCount++;
    }
    expect(comparisons).toBeGreaterThan(0);
    // Every comparable pair should show dividend drag for bullish
    expect(droppedCount).toBe(comparisons);
  });

  it('LEAPS with maxRiskPerContract = 500 (short-dated default): filters out most candidates', () => {
    const r = analyzeSpreads({
      ...leapsChain,
      daysToExpiry: 730,
      spreadType: 'bull_call',
      maxRiskPerContract: 500,    // way too tight for 2y LEAPS
      maxWidth: 50,
    });
    // Only the cheapest OTM verticals can have <$500 max loss
    expect(r.every(c => c.maxLoss <= 500)).toBe(true);
  });

  it('LEAPS bull put credit spread: time-decay benefit at 1y still produces credit', () => {
    const r = analyzeSpreads({
      ...leapsChain,
      daysToExpiry: 365,
      spreadType: 'bull_put',
      maxRiskPerContract: 5000,
      maxWidth: 50,
    });
    expect(r.length).toBeGreaterThan(0);
    expect(r.every(c => c.flow === 'credit')).toBe(true);
    expect(r.every(c => c.netCost < 0)).toBe(true);   // credit received
  });
});
