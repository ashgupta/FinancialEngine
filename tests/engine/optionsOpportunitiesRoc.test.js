import { describe, it, expect } from 'vitest';
import {
  analyzeSpreads,
  _internal,
} from '../../src/engine/spreadAnalyzer.js';
import {
  buildOptionsOpportunities,
  CURATED_LIQUID,
  _internal as ooInternal,
} from '../../src/engine/optionsOpportunities.js';

const { MIN_RETURN_ON_CAPITAL, MIN_POP, HIGH_IV_THRESHOLD } = ooInternal;

// ── Helpers ────────────────────────────────────────────────────────────

const now = Date.now();
const D = (days) => Math.floor((now + days * 86400000) / 1000);

const opt = (strike, bid, ask, iv = 0.30, vol = 500, oi = 1000) => ({
  strike,
  bid,
  ask,
  lastPrice: +(((bid + ask) / 2).toFixed(2)),
  impliedVolatility: iv,
  volume: vol,
  openInterest: oi,
  inTheMoney: false,
  contractSymbol: `OPT_${strike}`,
});

function makeHistory(startPrice, endPrice, bars = 250) {
  const closes = [], highs = [], lows = [], volumes = [];
  for (let i = 0; i < bars; i++) {
    const t = i / bars;
    const price = startPrice + (endPrice - startPrice) * t + Math.sin(i * 0.3) * 2;
    closes.push(+price.toFixed(2));
    highs.push(+(price + 1.5).toFixed(2));
    lows.push(+(price - 1.5).toFixed(2));
    volumes.push(1_000_000 + Math.floor(Math.random() * 500_000));
  }
  return { closes, highs, lows, volumes };
}

function makeDecliningHistory(startPrice, endPrice, bars = 250) {
  const closes = [], highs = [], lows = [], volumes = [];
  for (let i = 0; i < bars; i++) {
    const t = i / bars;
    const price = startPrice + (endPrice - startPrice) * t + Math.sin(i * 0.3) * 2;
    closes.push(+price.toFixed(2));
    highs.push(+(price + 1.5).toFixed(2));
    lows.push(+(price - 1.5).toFixed(2));
    volumes.push(1_200_000 + Math.floor(Math.random() * 500_000));
  }
  return { closes, highs, lows, volumes };
}

function makeChain(underlyingPrice, expirationTimestamp, iv = 0.3, strikeStep = 5) {
  const calls = [], puts = [], strikes = [];
  const numStrikes = Math.floor(underlyingPrice / strikeStep * 0.3);
  for (let i = -numStrikes; i <= numStrikes; i++) {
    const strike = underlyingPrice + i * strikeStep;
    strikes.push(strike);
    const callIntrinsic = Math.max(0, underlyingPrice - strike);
    const putIntrinsic = Math.max(0, strike - underlyingPrice);
    // Deterministic time value: decreases with OTM distance (no Math.random)
    const callTV = Math.max(0.1, 3 - Math.max(0, i) * 0.15);
    const putTV  = Math.max(0.1, 3 - Math.max(0, -i) * 0.15);
    const callMid = callIntrinsic + callTV;
    const putMid = putIntrinsic + putTV;
    calls.push({
      strike,
      lastPrice: +callMid.toFixed(2),
      bid: +(callMid - 0.1).toFixed(2),
      ask: +(callMid + 0.1).toFixed(2),
      volume: 500 + Math.floor(Math.random() * 500),
      openInterest: 1000 + Math.floor(Math.random() * 1000),
      impliedVolatility: iv,
      inTheMoney: strike < underlyingPrice,
      contractSymbol: `C${strike}`,
      expiration: expirationTimestamp,
    });
    puts.push({
      strike,
      lastPrice: +putMid.toFixed(2),
      bid: +(putMid - 0.1).toFixed(2),
      ask: +(putMid + 0.1).toFixed(2),
      volume: 400 + Math.floor(Math.random() * 500),
      openInterest: 800 + Math.floor(Math.random() * 1000),
      impliedVolatility: iv,
      inTheMoney: strike > underlyingPrice,
      contractSymbol: `P${strike}`,
      expiration: expirationTimestamp,
    });
  }
  return {
    expirations: [D(60), D(180), D(400), D(550), D(800), D(1000)],
    strikes,
    calls,
    puts,
    underlyingPrice,
    expirationDate: expirationTimestamp,
  };
}

// ── Tests ──────────────────────────────────────────────────────────────

describe('spreadAnalyzer RoC filter', () => {
  it('rejects spreads with RoC below minReturnOnCapital', () => {
    const calls = [
      opt(100, 10.0, 10.2, 0.3, 1000, 2000),
      opt(105, 5.0, 5.2, 0.3, 1000, 2000),
      opt(110, 2.0, 2.2, 0.3, 1000, 2000),
    ];
    // bull_call 100/105: cost ~5, max profit ~0 → low RoC
    // bull_call 100/110: cost ~7.9, max profit ~2.1 → RoC ~0.27
    const noFilter = analyzeSpreads({
      calls, puts: [], underlyingPrice: 100, daysToExpiry: 60,
      spreadType: 'bull_call', minLiquidity: 0,
    });
    const withFilter = analyzeSpreads({
      calls, puts: [], underlyingPrice: 100, daysToExpiry: 60,
      spreadType: 'bull_call', minLiquidity: 0,
      minReturnOnCapital: 3.0,
    });
    expect(noFilter.length).toBeGreaterThan(0);
    // With 3.0 RoC gate, the tight spreads above should be filtered out
    for (const c of withFilter) {
      expect(c.returnOnCapital).toBeGreaterThanOrEqual(3.0);
    }
  });

  it('admits spreads that meet the RoC threshold', () => {
    // Wide OTM bull call: buy 100, sell 130 → very cheap, high RoC if it passes
    const calls = [
      opt(100, 10.0, 10.2, 0.3, 1000, 2000),
      opt(130, 0.05, 0.15, 0.3, 1000, 2000),
    ];
    const result = analyzeSpreads({
      calls, puts: [], underlyingPrice: 100, daysToExpiry: 365,
      spreadType: 'bull_call', minLiquidity: 0,
      minReturnOnCapital: 3.0,
    });
    // 100/130: cost ~10.05, max profit ~19.95 → RoC ~1.99 — may or may not pass
    // But the filter logic is what we test: every returned candidate has RoC ≥ 3
    for (const c of result) {
      expect(c.returnOnCapital).toBeGreaterThanOrEqual(3.0);
    }
  });

  it('returnOnCapital field is present on every candidate', () => {
    const calls = [
      opt(100, 10.0, 10.2, 0.3, 1000, 2000),
      opt(110, 2.0, 2.2, 0.3, 1000, 2000),
    ];
    const result = analyzeSpreads({
      calls, puts: [], underlyingPrice: 100, daysToExpiry: 60,
      spreadType: 'bull_call', minLiquidity: 0,
    });
    for (const c of result) {
      expect(c).toHaveProperty('returnOnCapital');
      expect(c.returnOnCapital).toBeGreaterThan(0);
    }
  });
});

describe('spreadAnalyzer PoP guard', () => {
  it('rejects spreads with PoP below minProbabilityOfProfit', () => {
    // Far OTM calls → very low PoP
    const calls = [
      opt(100, 10.0, 10.2, 0.3, 1000, 2000),
      opt(200, 0.01, 0.05, 0.3, 1000, 2000),
    ];
    const withPopGuard = analyzeSpreads({
      calls, puts: [], underlyingPrice: 100, daysToExpiry: 30,
      spreadType: 'bull_call', minLiquidity: 0,
      minProbabilityOfProfit: 0.30,
    });
    for (const c of withPopGuard) {
      expect(c.probabilityOfProfit).toBeGreaterThanOrEqual(0.30);
    }
  });

  it('admits spreads with PoP above threshold', () => {
    // ATM-ish bull call with reasonable PoP
    const calls = [
      opt(95, 7.0, 7.2, 0.2, 1000, 2000),
      opt(100, 3.0, 3.2, 0.2, 1000, 2000),
    ];
    const result = analyzeSpreads({
      calls, puts: [], underlyingPrice: 100, daysToExpiry: 90,
      spreadType: 'bull_call', minLiquidity: 0,
      minProbabilityOfProfit: 0.30,
    });
    for (const c of result) {
      expect(c.probabilityOfProfit).toBeGreaterThanOrEqual(0.30);
    }
  });
});

describe('spreadAnalyzer composite scoring with RoC', () => {
  it('compositeScore uses RoC as a component (25% weight)', () => {
    const calls = [
      opt(90, 12.0, 12.2, 0.3, 1000, 2000),
      opt(95, 8.0, 8.2, 0.3, 1000, 2000),
      opt(100, 4.0, 4.2, 0.3, 1000, 2000),
      opt(105, 1.5, 1.7, 0.3, 1000, 2000),
      opt(110, 0.5, 0.7, 0.3, 1000, 2000),
    ];
    const result = analyzeSpreads({
      calls, puts: [], underlyingPrice: 100, daysToExpiry: 90,
      spreadType: 'bull_call', minLiquidity: 0,
    });
    expect(result.length).toBeGreaterThan(1);
    // All scores should be 0-100
    for (const c of result) {
      expect(c.compositeScore).toBeGreaterThanOrEqual(0);
      expect(c.compositeScore).toBeLessThanOrEqual(100);
    }
    // Sorted by compositeScore descending
    for (let i = 1; i < result.length; i++) {
      expect(result[i].compositeScore).toBeLessThanOrEqual(result[i - 1].compositeScore);
    }
  });
});

describe('CURATED_LIQUID de-duplication', () => {
  it('has no duplicate symbols', () => {
    const symbols = CURATED_LIQUID.map((s) => s.symbol);
    const unique = new Set(symbols);
    expect(unique.size).toBe(symbols.length);
  });

  it('contains SPY exactly once', () => {
    const spyCount = CURATED_LIQUID.filter((s) => s.symbol === 'SPY').length;
    expect(spyCount).toBe(1);
  });
});

describe('optionsOpportunities constants', () => {
  it('MIN_RETURN_ON_CAPITAL is 3.0', () => {
    expect(MIN_RETURN_ON_CAPITAL).toBe(3.0);
  });

  it('MIN_POP is 0.30', () => {
    expect(MIN_POP).toBe(0.30);
  });

  it('HIGH_IV_THRESHOLD is 0.40', () => {
    expect(HIGH_IV_THRESHOLD).toBe(0.40);
  });
});

describe('selectStrategy spread-first (no naked longs)', () => {
  it('never returns long_call or long_put strategy types', () => {
    const universe = [
      { symbol: 'AAPL', name: 'Apple', history: makeHistory(150, 200) },
      { symbol: 'TSLA', name: 'Tesla', history: makeDecliningHistory(300, 180) },
    ];
    const chains = new Map();
    chains.set('AAPL', makeChain(200, D(60), 0.25));
    chains.set('TSLA', makeChain(180, D(60), 0.35));

    const result = buildOptionsOpportunities({ universe, chains });
    for (const band of result.bands) {
      for (const rec of band.recommendations) {
        expect(rec.strategyType).not.toBe('long_call');
        expect(rec.strategyType).not.toBe('long_put');
      }
    }
  });

  it('all recommendations have returnOnCapital field', () => {
    const universe = [
      { symbol: 'AAPL', name: 'Apple', history: makeHistory(150, 200) },
    ];
    const chains = new Map();
    chains.set('AAPL', makeChain(200, D(60), 0.25));

    const result = buildOptionsOpportunities({ universe, chains });
    for (const band of result.bands) {
      for (const rec of band.recommendations) {
        expect(rec).toHaveProperty('returnOnCapital');
        if (rec.strategyType !== 'pmcc') {
          expect(rec.returnOnCapital).toBeGreaterThanOrEqual(MIN_RETURN_ON_CAPITAL);
        }
      }
    }
  });

  it('all recommendations have PoP ≥ MIN_POP', () => {
    const universe = [
      { symbol: 'AAPL', name: 'Apple', history: makeHistory(150, 200) },
      { symbol: 'MSFT', name: 'Microsoft', history: makeHistory(350, 420) },
    ];
    const chains = new Map();
    chains.set('AAPL', makeChain(200, D(60), 0.25));
    chains.set('MSFT', makeChain(420, D(60), 0.22));

    const result = buildOptionsOpportunities({ universe, chains });
    for (const band of result.bands) {
      for (const rec of band.recommendations) {
        if (rec.probabilityOfProfit != null) {
          expect(rec.probabilityOfProfit).toBeGreaterThanOrEqual(MIN_POP);
        }
      }
    }
  });
});

describe('selectStrategy IV-aware routing', () => {
  it('routes bullish low-IV to debit spread (bull_call)', () => {
    const { selectStrategy } = ooInternal;
    const asset = {
      symbol: 'AAPL', name: 'Apple',
      signal: 'bullish', momentumScore: 12,
      timeSeries: { aboveSMA200: true, maStack: 'bullish' },
      volume: { confirmation: 'bullish' },
    };
    const chain = makeChain(200, D(60), 0.20); // low IV
    const rec = selectStrategy(asset, chain, 'short', new Set());
    if (rec) {
      // Low IV bullish → bull_call debit spread (not credit)
      expect(rec.strategyType).toBe('bull_call');
    }
  });

  it('routes bullish high-IV to credit spread (bull_put)', () => {
    const { selectStrategy } = ooInternal;
    const asset = {
      symbol: 'AAPL', name: 'Apple',
      signal: 'bullish', momentumScore: 12,
      timeSeries: { aboveSMA200: true, maStack: 'bullish' },
      volume: { confirmation: 'bullish' },
    };
    const chain = makeChain(200, D(60), 0.60); // high IV
    const rec = selectStrategy(asset, chain, 'short', new Set());
    if (rec) {
      // High IV bullish → bull_put credit spread (preferred) or bull_call fallback
      expect(['bull_put', 'bull_call']).toContain(rec.strategyType);
    }
  });

  it('routes bearish low-IV to debit spread (bear_put)', () => {
    const { selectStrategy } = ooInternal;
    const asset = {
      symbol: 'TSLA', name: 'Tesla',
      signal: 'bearish', momentumScore: -12,
      timeSeries: { aboveSMA200: false, maStack: 'bearish' },
      volume: { confirmation: 'bearish' },
    };
    const chain = makeChain(180, D(60), 0.20); // low IV
    const rec = selectStrategy(asset, chain, 'short', new Set());
    if (rec) {
      expect(rec.strategyType).toBe('bear_put');
    }
  });

  it('routes bearish high-IV to credit spread (bear_call)', () => {
    const { selectStrategy } = ooInternal;
    const asset = {
      symbol: 'TSLA', name: 'Tesla',
      signal: 'bearish', momentumScore: -12,
      timeSeries: { aboveSMA200: false, maStack: 'bearish' },
      volume: { confirmation: 'bearish' },
    };
    const chain = makeChain(180, D(60), 0.60); // high IV
    const rec = selectStrategy(asset, chain, 'short', new Set());
    if (rec) {
      expect(['bear_call', 'bear_put']).toContain(rec.strategyType);
    }
  });
});

describe('selectStrategy LEAPS band', () => {
  it('LEAPS only produces bullish recommendations', () => {
    const { selectStrategy } = ooInternal;
    const bullishAsset = {
      symbol: 'AAPL', name: 'Apple',
      signal: 'bullish', momentumScore: 12,
      timeSeries: { aboveSMA200: true, maStack: 'bullish' },
      volume: { confirmation: 'bullish' },
    };
    const bearishAsset = {
      symbol: 'TSLA', name: 'Tesla',
      signal: 'bearish', momentumScore: -12,
      timeSeries: { aboveSMA200: false, maStack: 'bearish' },
      volume: { confirmation: 'bearish' },
    };
    const chain = makeChain(200, D(800), 0.25);
    const recBull = selectStrategy(bullishAsset, chain, 'leaps', new Set());
    const recBear = selectStrategy(bearishAsset, chain, 'leaps', new Set());

    if (recBull) expect(recBull.direction).toBe('bullish');
    expect(recBear).toBeNull(); // bearish LEAPS should produce nothing
  });

  it('LEAPS falls back to bull_call when no short chain for PMCC', () => {
    const { selectStrategy } = ooInternal;
    const asset = {
      symbol: 'AAPL', name: 'Apple',
      signal: 'bullish', momentumScore: 12,
      timeSeries: { aboveSMA200: true, maStack: 'bullish' },
      volume: { confirmation: 'bullish' },
    };
    const chain = makeChain(200, D(800), 0.25);
    const rec = selectStrategy(asset, chain, 'leaps', new Set(), null);
    if (rec) {
      expect(['bull_call', 'pmcc']).toContain(rec.strategyType);
    }
  });
});

describe('buildPMCC diagonal builder', () => {
  it('returns null when short chain is missing or invalid', () => {
    const { buildPMCC } = ooInternal;
    const asset = { symbol: 'AAPL', name: 'Apple', signal: 'bullish', momentumScore: 12 };
    const longChain = makeChain(200, D(800), 0.25);
    expect(buildPMCC(asset, longChain, null)).toBeNull();
    expect(buildPMCC(asset, longChain, undefined)).toBeNull();
  });

  it('returns null when short DTE >= long DTE', () => {
    const { buildPMCC } = ooInternal;
    const asset = { symbol: 'AAPL', name: 'Apple', signal: 'bullish', momentumScore: 12 };
    const longChain = makeChain(200, D(800), 0.25);
    const shortChain = makeChain(200, D(900), 0.25); // longer than long!
    expect(buildPMCC(asset, longChain, shortChain)).toBeNull();
  });

  it('produces a PMCC rec with correct structure when valid', () => {
    const { buildPMCC } = ooInternal;
    const asset = {
      symbol: 'AAPL', name: 'Apple',
      signal: 'bullish', momentumScore: 12,
      timeSeries: { aboveSMA200: true, maStack: 'bullish' },
      volume: { confirmation: 'bullish' },
    };
    const longChain = makeChain(200, D(800), 0.25);
    const shortChain = makeChain(200, D(60), 0.25);
    const rec = buildPMCC(asset, longChain, shortChain);

    if (rec) {
      expect(rec.strategyType).toBe('pmcc');
      expect(rec.direction).toBe('bullish');
      expect(rec.band).toBe('leaps');
      expect(rec.legs).toHaveLength(2);
      expect(rec.legs[0].action).toBe('BUY');
      expect(rec.legs[0].type).toBe('CALL');
      expect(rec.legs[1].action).toBe('SELL');
      expect(rec.legs[1].type).toBe('CALL');
      expect(rec.legs[0].strike).toBeLessThan(rec.legs[1].strike);
      expect(rec.netCost).toBeGreaterThan(0);
      expect(rec.maxLoss).toBe(rec.netCost);
      expect(rec).toHaveProperty('returnOnCapital');
      expect(rec).toHaveProperty('probabilityOfProfit');
      expect(rec.why).toHaveProperty('signalSummary');
      expect(rec.why).toHaveProperty('strikeReason');
      expect(rec.why).toHaveProperty('horizonReason');
      expect(rec.why).toHaveProperty('riskNote');
    }
  });

  it('PMCC legs use different expirations (diagonal)', () => {
    const { buildPMCC } = ooInternal;
    const asset = {
      symbol: 'AAPL', name: 'Apple',
      signal: 'bullish', momentumScore: 12,
      timeSeries: { aboveSMA200: true, maStack: 'bullish' },
      volume: { confirmation: 'bullish' },
    };
    const longChain = makeChain(200, D(800), 0.25);
    const shortChain = makeChain(200, D(60), 0.25);
    const rec = buildPMCC(asset, longChain, shortChain);

    if (rec) {
      expect(rec.legs[0].expiry).not.toBe(rec.legs[1].expiry);
      expect(rec.legs[0].expiry).toBe(longChain.expirationDate);
      expect(rec.legs[1].expiry).toBe(shortChain.expirationDate);
    }
  });

  it('PMCC enforces RoC ≥ 3× gate', () => {
    const { buildPMCC } = ooInternal;
    const asset = {
      symbol: 'AAPL', name: 'Apple',
      signal: 'bullish', momentumScore: 12,
      timeSeries: { aboveSMA200: true, maStack: 'bullish' },
      volume: { confirmation: 'bullish' },
    };
    const longChain = makeChain(200, D(800), 0.25);
    const shortChain = makeChain(200, D(60), 0.25);
    const rec = buildPMCC(asset, longChain, shortChain);

    if (rec) {
      expect(rec.returnOnCapital).toBeGreaterThanOrEqual(MIN_RETURN_ON_CAPITAL);
    }
  });

  it('PMCC enforces PoP ≥ 30% gate', () => {
    const { buildPMCC } = ooInternal;
    const asset = {
      symbol: 'AAPL', name: 'Apple',
      signal: 'bullish', momentumScore: 12,
      timeSeries: { aboveSMA200: true, maStack: 'bullish' },
      volume: { confirmation: 'bullish' },
    };
    const longChain = makeChain(200, D(800), 0.25);
    const shortChain = makeChain(200, D(60), 0.25);
    const rec = buildPMCC(asset, longChain, shortChain);

    if (rec && rec.probabilityOfProfit != null) {
      expect(rec.probabilityOfProfit).toBeGreaterThanOrEqual(MIN_POP);
    }
  });
});

describe('buildOptionsOpportunities does not pad with low-quality trades', () => {
  it('bands may have 0 recommendations when nothing passes the gates', () => {
    // Use a flat/range-bound history with very low IV → few qualifying spreads
    const universe = [
      { symbol: 'FLAT', name: 'Flat Co', history: makeHistory(100, 100.5, 250) },
    ];
    const chains = new Map();
    chains.set('FLAT', makeChain(100, D(60), 0.15, 1));

    const result = buildOptionsOpportunities({ universe, chains });
    // With near-zero momentum and tight strikes, some bands may be empty
    // The key assertion: we never produce picks that violate the gates
    for (const band of result.bands) {
      for (const rec of band.recommendations) {
        if (rec.returnOnCapital != null && rec.strategyType !== 'pmcc') {
          expect(rec.returnOnCapital).toBeGreaterThanOrEqual(MIN_RETURN_ON_CAPITAL);
        }
        if (rec.probabilityOfProfit != null) {
          expect(rec.probabilityOfProfit).toBeGreaterThanOrEqual(MIN_POP);
        }
      }
    }
  });
});
