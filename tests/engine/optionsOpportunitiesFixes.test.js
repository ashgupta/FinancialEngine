import { describe, it, expect } from 'vitest';
import { analyzeSpreads, _internal as saInternal } from '../../src/engine/spreadAnalyzer.js';
import {
  buildOptionsOpportunities,
  _internal as ooInternal,
} from '../../src/engine/optionsOpportunities.js';

const now = Date.now();
const D = (days) => Math.floor((now + days * 86400000) / 1000);

const opt = (strike, bid, ask, iv = 0.3, vol = 500, oi = 1000) => ({
  strike, bid, ask, lastPrice: +((bid + ask) / 2).toFixed(2),
  impliedVolatility: iv, volume: vol, openInterest: oi,
});

function makeHistory(startPrice, endPrice, bars = 250) {
  const closes = [], highs = [], lows = [], volumes = [];
  for (let i = 0; i < bars; i++) {
    const price = startPrice + (endPrice - startPrice) * (i / bars) + Math.sin(i * 0.3) * 2;
    closes.push(+price.toFixed(2));
    highs.push(+(price + 1.5).toFixed(2));
    lows.push(+(price - 1.5).toFixed(2));
    volumes.push(1_000_000 + (i % 7) * 50_000);
  }
  return { closes, highs, lows, volumes };
}

// ─── Fix #1: credit spreads must be OTM (no ITM "income" plays) ───────────

describe('credit spreads — requireOtmShort', () => {
  // Spot 225. ITM put pair (245/240) is what the live app used to recommend
  // as "income": credit $3.75 on a $5 width → looks like 3× RoC.
  const puts = [
    opt(200, 1.00, 1.10, 0.35),
    opt(205, 1.50, 1.60, 0.34),
    opt(210, 2.30, 2.40, 0.33),
    opt(215, 3.40, 3.50, 0.32),
    opt(240, 22.50, 22.65, 0.30),
    opt(245, 26.25, 26.40, 0.30),
  ];
  const base = { calls: [], puts, underlyingPrice: 225, daysToExpiry: 82, spreadType: 'bull_put' };

  it('without the guard an ITM short strike can pass a 3× RoC floor', () => {
    const c = analyzeSpreads({ ...base, minReturnOnCapital: 3 });
    expect(c.some((x) => x.shortLeg.strike >= 225)).toBe(true);
  });

  it('with the guard, every short put strike is below spot', () => {
    const c = analyzeSpreads({ ...base, requireOtmShort: true });
    expect(c.length).toBeGreaterThan(0);
    for (const x of c) expect(x.shortLeg.strike).toBeLessThan(225);
  });

  it('bear call guard: every short call strike is above spot', () => {
    const calls = [opt(90, 11, 11.2), opt(95, 6.8, 7), opt(105, 1.6, 1.7), opt(110, 0.6, 0.7)];
    const c = analyzeSpreads({ calls, puts: [], underlyingPrice: 100, daysToExpiry: 45, spreadType: 'bear_call', requireOtmShort: true });
    expect(c.length).toBeGreaterThan(0);
    for (const x of c) expect(x.shortLeg.strike).toBeGreaterThan(100);
  });

  it('guard is ignored for debit spreads', () => {
    const calls = [opt(90, 11, 11.2), opt(95, 6.8, 7), opt(105, 1.6, 1.7)];
    const withGuard = analyzeSpreads({ calls, puts: [], underlyingPrice: 100, daysToExpiry: 45, spreadType: 'bull_call', requireOtmShort: true });
    const without = analyzeSpreads({ calls, puts: [], underlyingPrice: 100, daysToExpiry: 45, spreadType: 'bull_call' });
    expect(withGuard.length).toBe(without.length);
  });
});

// ─── Fix #2: quote-quality gate (phantom LEAPS spreads) ──────────────────

describe('quote-quality gate', () => {
  // Live SPY Jan-2028 quotes (spot 771): 645C 172.19/177.00, 650C 171.11/176.00.
  // Mid difference ≈ $1.04 on a $5 spread — a phantom 3.8× "RoC".
  const calls = [opt(645, 172.19, 177.0, 0.315), opt(650, 171.11, 176.0, 0.322)];
  const base = { calls, puts: [], underlyingPrice: 771.35, daysToExpiry: 481, spreadType: 'bull_call' };

  it('without the gate the phantom spread is admitted', () => {
    const c = analyzeSpreads({ ...base, minReturnOnCapital: 3 });
    expect(c).toHaveLength(1);
    expect(c[0].netCost).toBeCloseTo(1.04, 2);
  });

  it('maxLegSpreadToWidth rejects it (legs ≈ $9.7 wide vs $5 strike width)', () => {
    const c = analyzeSpreads({ ...base, maxLegSpreadToWidth: 0.35 });
    expect(c).toHaveLength(0);
  });

  it('natural price ≥ width is rejected when two-sided quotes are required', () => {
    const c = analyzeSpreads({ ...base, requireTwoSidedQuotes: true });
    expect(c).toHaveLength(0); // buy 645 @177, sell 650 @171.11 → $5.89 > $5 width
  });

  it('requireTwoSidedQuotes drops legs that only have a lastPrice', () => {
    const stale = [{ strike: 100, bid: 0, ask: 0, lastPrice: 5, impliedVolatility: 0.3, volume: 10, openInterest: 100 }, opt(105, 2, 2.1)];
    const c = analyzeSpreads({ calls: stale, puts: [], underlyingPrice: 100, daysToExpiry: 30, spreadType: 'bull_call', requireTwoSidedQuotes: true });
    expect(c).toHaveLength(0);
  });

  it('tight, real quotes pass and expose naturalNetCost + legSpreadToWidth', () => {
    const tight = [opt(100, 3.0, 3.05), opt(105, 1.0, 1.05)];
    const c = analyzeSpreads({ calls: tight, puts: [], underlyingPrice: 100, daysToExpiry: 30, spreadType: 'bull_call', requireTwoSidedQuotes: true, maxLegSpreadToWidth: 0.35 });
    expect(c).toHaveLength(1);
    expect(c[0].naturalNetCost).toBeCloseTo(2.05, 2);
    expect(c[0].legSpreadToWidth).toBeCloseTo(0.02, 3);
  });

  it('helpers: hasTwoSidedQuote / quoteWidth', () => {
    expect(saInternal.hasTwoSidedQuote({ bid: 1, ask: 1.1 })).toBe(true);
    expect(saInternal.hasTwoSidedQuote({ bid: 0, ask: 1.1 })).toBe(false);
    expect(saInternal.hasTwoSidedQuote({ bid: 1.2, ask: 1.1 })).toBe(false); // crossed
    expect(saInternal.quoteWidth({ bid: 1, ask: 1.25 })).toBeCloseTo(0.25);
    expect(saInternal.quoteWidth({ bid: 0, ask: 0 })).toBe(0);
  });

  it('hasTradeableQuote rejects wide single legs (PMCC picker)', () => {
    expect(ooInternal.hasTradeableQuote({ bid: 172.19, ask: 177 })).toBe(true); // 2.8% of mid
    expect(ooInternal.hasTradeableQuote({ bid: 1.0, ask: 1.5 })).toBe(false);   // 40% of mid
    expect(ooInternal.hasTradeableQuote({ bid: 0, ask: 2 })).toBe(false);
  });
});

// ─── Credit-spread builder produces OTM income trades ────────────────────

describe('buildIncomeSpread (engine) — OTM with credit/PoP gates', () => {
  const { buildIncomeSpread, MIN_CREDIT_POP, MIN_CREDIT_RETURN_ON_CAPITAL } = ooInternal;
  const asset = { symbol: 'XYZ', name: 'XYZ', signal: 'bullish', momentumScore: 10, timeSeries: { aboveSMA200: true }, volume: {} };

  it('returns an OTM bull put whose why text says out-of-the-money', () => {
    // High-IV chain, spot 100, 45 DTE: realistic OTM credits
    const puts = [
      opt(80, 0.55, 0.6, 0.55), opt(85, 1.1, 1.15, 0.52), opt(90, 2.05, 2.1, 0.5),
      opt(95, 3.6, 3.65, 0.48), opt(100, 5.9, 6.0, 0.46), opt(105, 8.9, 9.0, 0.45),
    ];
    const chain = { calls: [], puts, underlyingPrice: 100, expirationDate: D(45) };
    const rec = buildIncomeSpread(asset, chain, 'short', 'bullish');
    expect(rec).not.toBeNull();
    const shortLeg = rec.legs.find((l) => l.action === 'SELL');
    expect(shortLeg.strike).toBeLessThan(100);
    expect(rec.probabilityOfProfit).toBeGreaterThanOrEqual(MIN_CREDIT_POP);
    expect(rec.returnOnCapital).toBeGreaterThanOrEqual(MIN_CREDIT_RETURN_ON_CAPITAL);
    expect(rec.why.strikeReason).toMatch(/out-of-the-money/);
    expect(rec.naturalCost).toBeLessThan(0); // still a credit at natural prices
  });

  it('returns null when only ITM pairs exist', () => {
    const puts = [opt(110, 10.5, 10.6), opt(115, 15.3, 15.4)];
    const chain = { calls: [], puts, underlyingPrice: 100, expirationDate: D(45) };
    expect(buildIncomeSpread(asset, chain, 'short', 'bullish')).toBeNull();
  });
});

// ─── Fix #4: crash-regime overlay ────────────────────────────────────────

describe('crash regime overlay', () => {
  const { buildRegime, REGIME_MULTIPLIERS } = ooInternal;

  it('buildRegime returns null for missing/invalid input', () => {
    expect(buildRegime(null)).toBeNull();
    expect(buildRegime({ score: 50, level: 'bogus' })).toBeNull();
    expect(buildRegime({ level: 'calm' })).toBeNull();
  });

  it('calm/watch leave multipliers at 1', () => {
    expect(buildRegime({ score: 10, level: 'calm' }).multipliers).toEqual({ bullish: 1, bearish: 1 });
    expect(buildRegime({ score: 30, level: 'watch' }).stressed).toBe(false);
  });

  it('stressed regimes de-rate bullish monotonically', () => {
    const levels = ['elevated', 'high', 'severe'];
    for (let i = 1; i < levels.length; i++) {
      expect(REGIME_MULTIPLIERS[levels[i]].bullish).toBeLessThan(REGIME_MULTIPLIERS[levels[i - 1]].bullish);
    }
    const r = buildRegime({ score: 85, level: 'severe', label: 'Severe' });
    expect(r.stressed).toBe(true);
    expect(r.note).toMatch(/de-rated/);
  });

  it('end-to-end: bullish scores drop under a severe regime and regime is returned', () => {
    const chainFor = (spot) => {
      const calls = [];
      for (let i = -6; i <= 6; i++) {
        const k = spot + i * 5;
        const mid = Math.max(0, spot - k) + Math.max(0.2, 3 - Math.max(0, i) * 0.4);
        calls.push(opt(k, +(mid - 0.05).toFixed(2), +(mid + 0.05).toFixed(2), 0.25));
      }
      return { expirations: [D(60)], calls, puts: [], underlyingPrice: spot, expirationDate: D(60) };
    };
    const universe = [{ symbol: 'AAA', name: 'AAA', history: makeHistory(150, 200) }];
    const chains = new Map([['AAA', chainFor(200)]]);
    const calm = buildOptionsOpportunities({ universe, chains, crashRisk: { score: 10, level: 'calm' } });
    const severe = buildOptionsOpportunities({ universe, chains, crashRisk: { score: 90, level: 'severe', label: 'Severe' } });
    expect(severe.regime.level).toBe('severe');
    const c = calm.bands[0].recommendations[0];
    const s = severe.bands[0].recommendations[0];
    if (c && s && c.direction === 'bullish') {
      expect(s.opportunityScore).toBeLessThan(c.opportunityScore);
      expect(s.regimeNote).toMatch(/De-rated/);
    }
  });

  it('no crashRisk → regime null (backwards compatible)', () => {
    expect(buildOptionsOpportunities({}).regime).toBeNull();
  });
});
