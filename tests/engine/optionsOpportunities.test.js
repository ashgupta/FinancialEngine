import { describe, it, expect } from 'vitest';
import {
  buildOptionsOpportunities,
  BANDS,
  daysToExpiration,
  classifyBand,
  computeOpportunityScore,
  getDirection,
  CURATED_LIQUID,
} from '../../src/engine/optionsOpportunities.js';

// ─── Fixtures ────────────────────────────────────────────

const now = Date.now();
const D = (days) => Math.floor((now + days * 86400000) / 1000);

// Build a simple price history (uptrending)
function makeHistory(startPrice, endPrice, bars = 250) {
  const closes = [];
  const highs = [];
  const lows = [];
  const volumes = [];
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

// Build a declining history
function makeDecliningHistory(startPrice, endPrice, bars = 250) {
  const closes = [];
  const highs = [];
  const lows = [];
  const volumes = [];
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

// Build a flat history (range-bound)
function makeFlatHistory(price, bars = 250) {
  const closes = [];
  const highs = [];
  const lows = [];
  const volumes = [];
  for (let i = 0; i < bars; i++) {
    const p = price + Math.sin(i * 0.4) * 3;
    closes.push(+p.toFixed(2));
    highs.push(+(p + 1).toFixed(2));
    lows.push(+(p - 1).toFixed(2));
    volumes.push(800_000 + Math.floor(Math.random() * 300_000));
  }
  return { closes, highs, lows, volumes };
}

// Build a mock option chain
function makeChain(underlyingPrice, expirationTimestamp, iv = 0.3) {
  const calls = [];
  const puts = [];
  const strikes = [];
  for (let i = -5; i <= 5; i++) {
    const strike = +(underlyingPrice * (1 + i * 0.05)).toFixed(0);
    strikes.push(strike);
    const itmCall = i < 0;
    const itmPut = i > 0;
    const callMid = Math.max(0.5, underlyingPrice - strike) + Math.max(0.1, 3 - Math.max(0, i) * 0.3);
    const putMid = Math.max(0.5, strike - underlyingPrice) + Math.max(0.1, 3 - Math.max(0, -i) * 0.3);
    calls.push({
      strike,
      lastPrice: +callMid.toFixed(2),
      bid: +(callMid - 0.1).toFixed(2),
      ask: +(callMid + 0.1).toFixed(2),
      volume: 500 + Math.floor(Math.random() * 500),
      openInterest: 1000 + Math.floor(Math.random() * 1000),
      impliedVolatility: iv,
      inTheMoney: itmCall,
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
      inTheMoney: itmPut,
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

// ─── Tests ───────────────────────────────────────────────

describe('optionsOpportunities', () => {

  describe('constants & helpers', () => {
    it('BANDS has 3 bands with correct DTE ranges', () => {
      expect(Object.keys(BANDS)).toHaveLength(3);
      expect(BANDS.short.dteMax).toBe(365);
      expect(BANDS.medium.dteMin).toBe(366);
      expect(BANDS.medium.dteMax).toBe(730);
      expect(BANDS.leaps.dteMin).toBe(731);
      expect(BANDS.leaps.dteMax).toBe(Infinity);
    });

    it('daysToExpiration computes correctly', () => {
      const future = D(90);
      const dte = daysToExpiration(future);
      expect(dte).toBeGreaterThan(88);
      expect(dte).toBeLessThan(92);
    });

    it('daysToExpiration returns null for invalid input', () => {
      expect(daysToExpiration(null)).toBeNull();
      expect(daysToExpiration(0)).toBeNull();
    });

    it('classifyBand buckets correctly', () => {
      expect(classifyBand(60)).toBe('short');
      expect(classifyBand(365)).toBe('short');
      expect(classifyBand(366)).toBe('medium');
      expect(classifyBand(730)).toBe('medium');
      expect(classifyBand(731)).toBe('leaps');
      expect(classifyBand(1000)).toBe('leaps');
      expect(classifyBand(null)).toBeNull();
    });

    it('getDirection extracts direction from signal', () => {
      expect(getDirection({ signal: 'strong bullish' })).toBe('bullish');
      expect(getDirection({ signal: 'bullish' })).toBe('bullish');
      expect(getDirection({ signal: 'strong bearish' })).toBe('bearish');
      expect(getDirection({ signal: 'bearish' })).toBe('bearish');
      expect(getDirection({ signal: 'neutral' })).toBe('neutral');
      expect(getDirection({})).toBe('neutral');
    });

    it('CURATED_LIQUID has at least 10 symbols', () => {
      expect(CURATED_LIQUID.length).toBeGreaterThanOrEqual(10);
    });
  });

  describe('computeOpportunityScore', () => {
    it('returns a number 0-100', () => {
      const asset = {
        signal: 'bullish',
        momentumScore: 15,
        timeSeries: { aboveSMA200: true, breakout: 'none' },
        volume: { confirmation: 'bullish' },
      };
      const score = computeOpportunityScore(asset);
      expect(score).toBeGreaterThanOrEqual(0);
      expect(score).toBeLessThanOrEqual(100);
    });

    it('higher momentum scores higher', () => {
      const strong = computeOpportunityScore({
        signal: 'strong bullish',
        momentumScore: 18,
        timeSeries: { aboveSMA200: true, breakout: '52w-high' },
        volume: { confirmation: 'bullish' },
      });
      const weak = computeOpportunityScore({
        signal: 'neutral',
        momentumScore: 0,
        timeSeries: { aboveSMA200: false, breakout: 'none' },
        volume: { confirmation: 'neutral' },
      });
      expect(strong).toBeGreaterThan(weak);
    });

    it('handles null fields gracefully', () => {
      const score = computeOpportunityScore({});
      expect(score).toBe(0);
    });
  });

  describe('buildOptionsOpportunities', () => {
    it('returns 3 bands with empty arrays when no data', () => {
      const result = buildOptionsOpportunities({});
      expect(result.bands).toHaveLength(3);
      expect(result.bands[0].band).toBe('short');
      expect(result.bands[1].band).toBe('medium');
      expect(result.bands[2].band).toBe('leaps');
      expect(result.bands[0].recommendations).toEqual([]);
      expect(result.asOf).toBeTruthy();
    });

    it('produces recommendations for bullish assets', () => {
      const universe = [
        { symbol: 'AAPL', name: 'Apple', history: makeHistory(150, 200) },
        { symbol: 'MSFT', name: 'Microsoft', history: makeHistory(350, 450) },
      ];
      const chains = new Map();
      chains.set('AAPL', makeChain(200, D(60), 0.25));
      chains.set('MSFT', makeChain(450, D(60), 0.22));

      const result = buildOptionsOpportunities({ universe, chains });
      const shortBand = result.bands.find((b) => b.band === 'short');
      expect(shortBand.recommendations.length).toBeGreaterThan(0);
    });

    it('each recommendation has required fields', () => {
      const universe = [
        { symbol: 'AAPL', name: 'Apple', history: makeHistory(150, 200) },
      ];
      const chains = new Map();
      chains.set('AAPL', makeChain(200, D(60), 0.25));

      const result = buildOptionsOpportunities({ universe, chains });
      for (const band of result.bands) {
        for (const rec of band.recommendations) {
          expect(rec).toHaveProperty('symbol');
          expect(rec).toHaveProperty('direction');
          expect(rec).toHaveProperty('strategy');
          expect(rec).toHaveProperty('legs');
          expect(rec).toHaveProperty('underlyingPrice');
          expect(rec).toHaveProperty('maxLoss');
          expect(rec).toHaveProperty('dte');
          expect(rec).toHaveProperty('opportunityScore');
          expect(rec).toHaveProperty('why');
          expect(rec.why).toHaveProperty('signalSummary');
          expect(rec.why).toHaveProperty('strikeReason');
          expect(rec.why).toHaveProperty('horizonReason');
          expect(rec.why).toHaveProperty('riskNote');
        }
      }
    });

    it('LEAPS band only produces bullish recommendations', () => {
      const universe = [
        { symbol: 'AAPL', name: 'Apple', history: makeHistory(150, 200) },
        { symbol: 'TSLA', name: 'Tesla', history: makeDecliningHistory(300, 180) },
      ];
      const chains = new Map();
      chains.set('AAPL', makeChain(200, D(800), 0.25));
      chains.set('TSLA', makeChain(180, D(800), 0.35));

      const result = buildOptionsOpportunities({ universe, chains });
      const leapsBand = result.bands.find((b) => b.band === 'leaps');
      for (const rec of leapsBand.recommendations) {
        expect(rec.direction).toBe('bullish');
        // Should not be long puts or bear put spreads
        expect(rec.strategyType).not.toBe('long_put');
        expect(rec.strategyType).not.toBe('bear_put');
      }
    });

    it('max 5 recommendations per band', () => {
      const universe = [];
      for (let i = 0; i < 12; i++) {
        const sym = `STK${i}`;
        universe.push({ symbol: sym, name: `Stock ${i}`, history: makeHistory(50 + i * 5, 80 + i * 5) });
      }
      const chains = new Map();
      for (let i = 0; i < 12; i++) {
        const sym = `STK${i}`;
        chains.set(sym, makeChain(80 + i * 5, D(60), 0.25));
      }

      const result = buildOptionsOpportunities({ universe, chains });
      for (const band of result.bands) {
        expect(band.recommendations.length).toBeLessThanOrEqual(5);
      }
    });

    it('recommendations are sorted by opportunity score descending', () => {
      const universe = [
        { symbol: 'AAPL', name: 'Apple', history: makeHistory(150, 200) },
        { symbol: 'MSFT', name: 'Microsoft', history: makeHistory(350, 420) },
        { symbol: 'NVDA', name: 'NVIDIA', history: makeHistory(100, 180) },
      ];
      const chains = new Map();
      chains.set('AAPL', makeChain(200, D(60), 0.25));
      chains.set('MSFT', makeChain(420, D(60), 0.22));
      chains.set('NVDA', makeChain(180, D(60), 0.30));

      const result = buildOptionsOpportunities({ universe, chains });
      const shortBand = result.bands.find((b) => b.band === 'short');
      for (let i = 1; i < shortBand.recommendations.length; i++) {
        expect(shortBand.recommendations[i].opportunityScore)
          .toBeLessThanOrEqual(shortBand.recommendations[i - 1].opportunityScore);
      }
    });

    it('drawdown flag is set when maxLoss > 15% of allocation', () => {
      const universe = [
        { symbol: 'AAPL', name: 'Apple', history: makeHistory(150, 200) },
      ];
      const chains = new Map();
      chains.set('AAPL', makeChain(200, D(60), 0.25));

      const result = buildOptionsOpportunities({
        universe,
        chains,
        allocationPerTrade: 1, // tiny allocation → all trades flagged
      });
      const shortBand = result.bands.find((b) => b.band === 'short');
      for (const rec of shortBand.recommendations) {
        if (rec.maxLoss > 0) {
          expect(rec.drawdownFlag).toBe(true);
          expect(rec.lossPctOfAllocation).toBeGreaterThan(15);
        }
      }
    });

    it('drawdown flag is false with large allocation', () => {
      const universe = [
        { symbol: 'AAPL', name: 'Apple', history: makeHistory(150, 200) },
      ];
      const chains = new Map();
      chains.set('AAPL', makeChain(200, D(60), 0.25));

      const result = buildOptionsOpportunities({
        universe,
        chains,
        allocationPerTrade: 100000, // huge allocation → no flags
      });
      const shortBand = result.bands.find((b) => b.band === 'short');
      for (const rec of shortBand.recommendations) {
        expect(rec.drawdownFlag).toBe(false);
      }
    });

    it('isHeld is true for symbols in heldSet', () => {
      const universe = [
        { symbol: 'AAPL', name: 'Apple', history: makeHistory(150, 200) },
        { symbol: 'MSFT', name: 'Microsoft', history: makeHistory(350, 420) },
      ];
      const chains = new Map();
      chains.set('AAPL', makeChain(200, D(60), 0.25));
      chains.set('MSFT', makeChain(420, D(60), 0.22));

      const result = buildOptionsOpportunities({
        universe,
        chains,
        heldSet: new Set(['AAPL']),
      });
      const shortBand = result.bands.find((b) => b.band === 'short');
      const aaplRec = shortBand.recommendations.find((r) => r.symbol === 'AAPL');
      const msftRec = shortBand.recommendations.find((r) => r.symbol === 'MSFT');
      if (aaplRec) expect(aaplRec.isHeld).toBe(true);
      if (msftRec) expect(msftRec.isHeld).toBe(false);
    });

    it('handles insufficient data gracefully', () => {
      const universe = [
        { symbol: 'NEW', name: 'New IPO', history: makeHistory(50, 55, 20) }, // too short
      ];
      const chains = new Map();
      chains.set('NEW', makeChain(55, D(60), 0.3));

      const result = buildOptionsOpportunities({ universe, chains });
      const shortBand = result.bands.find((b) => b.band === 'short');
      expect(shortBand.recommendations).toEqual([]);
    });

    it('LEAPS bull call spreads prefer widest viable spread with step-down from 100pt', () => {
      // Wide-strike chain with $50 spacing — 100pt spreads are achievable
      // (2 strikes apart). The step-down starts at 100pt; if candidates pass
      // all gates at that floor, the widest among them is chosen.
      const wideChain = (underlyingPrice, expirationTimestamp, iv = 0.3) => {
        const calls = [];
        const puts = [];
        const strikes = [];
        for (let i = -5; i <= 5; i++) {
          const strike = +(underlyingPrice + i * 50).toFixed(0); // $50 apart
          strikes.push(strike);
          const callMid = Math.max(0.5, underlyingPrice - strike) + Math.max(0.1, 10 - Math.max(0, i) * 0.5);
          const putMid = Math.max(0.5, strike - underlyingPrice) + Math.max(0.1, 10 - Math.max(0, -i) * 0.5);
          calls.push({
            strike, lastPrice: +callMid.toFixed(2), bid: +(callMid - 0.1).toFixed(2), ask: +(callMid + 0.1).toFixed(2),
            volume: 500, openInterest: 1000, impliedVolatility: iv, inTheMoney: i < 0,
            contractSymbol: `C${strike}`, expiration: expirationTimestamp,
          });
          puts.push({
            strike, lastPrice: +putMid.toFixed(2), bid: +(putMid - 0.1).toFixed(2), ask: +(putMid + 0.1).toFixed(2),
            volume: 400, openInterest: 800, impliedVolatility: iv, inTheMoney: i > 0,
            contractSymbol: `P${strike}`, expiration: expirationTimestamp,
          });
        }
        return {
          expirations: [D(60), D(800)],
          strikes, calls, puts, underlyingPrice, expirationDate: expirationTimestamp,
        };
      };

      const universe = [
        { symbol: 'AAPL', name: 'Apple', history: makeHistory(150, 200) },
      ];
      const chains = new Map();
      chains.set('AAPL', wideChain(200, D(800), 0.25));

      const result = buildOptionsOpportunities({ universe, chains });
      const leapsBand = result.bands.find((b) => b.band === 'leaps');
      const bullCallSpreads = leapsBand.recommendations.filter((r) => r.strategyType === 'bull_call');
      expect(bullCallSpreads.length).toBeGreaterThan(0);
      // The best recommendation should be the widest available
      const best = bullCallSpreads[0];
      const bestWidth = best.legs[1].strike - best.legs[0].strike;
      for (const rec of bullCallSpreads) {
        const w = rec.legs[1].strike - rec.legs[0].strike;
        expect(bestWidth).toBeGreaterThanOrEqual(w);
      }
    });

    it('LEAPS bull call spreads step down from 100pt to find widest viable spread', () => {
      // Chain with strikes $30 apart — no 100pt spread is possible, but
      // the step-down logic should find a 30pt spread (the widest available).
      const narrowChain = (underlyingPrice, expirationTimestamp, iv = 0.3) => {
        const calls = [];
        const puts = [];
        const strikes = [];
        for (let i = -5; i <= 5; i++) {
          const strike = +(underlyingPrice + i * 30).toFixed(0); // $30 apart
          strikes.push(strike);
          const callMid = Math.max(0.5, underlyingPrice - strike) + Math.max(0.1, 10 - Math.max(0, i) * 0.5);
          const putMid = Math.max(0.5, strike - underlyingPrice) + Math.max(0.1, 10 - Math.max(0, -i) * 0.5);
          calls.push({
            strike, lastPrice: +callMid.toFixed(2), bid: +(callMid - 0.1).toFixed(2), ask: +(callMid + 0.1).toFixed(2),
            volume: 500, openInterest: 1000, impliedVolatility: iv, inTheMoney: i < 0,
            contractSymbol: `C${strike}`, expiration: expirationTimestamp,
          });
          puts.push({
            strike, lastPrice: +putMid.toFixed(2), bid: +(putMid - 0.1).toFixed(2), ask: +(putMid + 0.1).toFixed(2),
            volume: 400, openInterest: 800, impliedVolatility: iv, inTheMoney: i > 0,
            contractSymbol: `P${strike}`, expiration: expirationTimestamp,
          });
        }
        return {
          expirations: [D(60), D(800)],
          strikes, calls, puts, underlyingPrice, expirationDate: expirationTimestamp,
        };
      };

      const universe = [
        { symbol: 'AAPL', name: 'Apple', history: makeHistory(150, 200) },
      ];
      const chains = new Map();
      chains.set('AAPL', narrowChain(200, D(800), 0.25));

      const result = buildOptionsOpportunities({ universe, chains });
      const leapsBand = result.bands.find((b) => b.band === 'leaps');
      const bullCallSpreads = leapsBand.recommendations.filter((r) => r.strategyType === 'bull_call');
      // Should find at least one spread even though 100pt is impossible
      expect(bullCallSpreads.length).toBeGreaterThan(0);
      for (const rec of bullCallSpreads) {
        const width = rec.legs[1].strike - rec.legs[0].strike;
        // Widest available with $30 spacing is 30 (or multiples thereof)
        expect(width).toBeGreaterThan(0);
        expect(width).toBeLessThanOrEqual(30 * 5); // max possible with 11 strikes
      }
    });

    it('LEAPS bull call spreads prefer widest spread among candidates', () => {
      // Chain with mixed spacing: some 100pt+ spreads and some narrower ones.
      // The step-down should find candidates at 100pt and pick the widest.
      const mixedChain = (underlyingPrice, expirationTimestamp, iv = 0.3) => {
        const calls = [];
        const puts = [];
        // Strikes at: -200, -100, -50, -25, 0, 25, 50, 100, 200 from spot
        const offsets = [-200, -100, -50, -25, 0, 25, 50, 100, 200];
        const strikes = [];
        for (const off of offsets) {
          const strike = underlyingPrice + off;
          strikes.push(strike);
          const callMid = Math.max(0.5, underlyingPrice - strike) + Math.max(0.1, 10 - Math.abs(off) * 0.02);
          const putMid = Math.max(0.5, strike - underlyingPrice) + Math.max(0.1, 10 - Math.abs(off) * 0.02);
          calls.push({
            strike, lastPrice: +callMid.toFixed(2), bid: +(callMid - 0.1).toFixed(2), ask: +(callMid + 0.1).toFixed(2),
            volume: 500, openInterest: 1000, impliedVolatility: iv, inTheMoney: off < 0,
            contractSymbol: `C${strike}`, expiration: expirationTimestamp,
          });
          puts.push({
            strike, lastPrice: +putMid.toFixed(2), bid: +(putMid - 0.1).toFixed(2), ask: +(putMid + 0.1).toFixed(2),
            volume: 400, openInterest: 800, impliedVolatility: iv, inTheMoney: off > 0,
            contractSymbol: `P${strike}`, expiration: expirationTimestamp,
          });
        }
        return {
          expirations: [D(60), D(800)],
          strikes, calls, puts, underlyingPrice, expirationDate: expirationTimestamp,
        };
      };

      const universe = [
        { symbol: 'AAPL', name: 'Apple', history: makeHistory(150, 200) },
      ];
      const chains = new Map();
      chains.set('AAPL', mixedChain(200, D(800), 0.25));

      const result = buildOptionsOpportunities({ universe, chains });
      const leapsBand = result.bands.find((b) => b.band === 'leaps');
      const bullCallSpreads = leapsBand.recommendations.filter((r) => r.strategyType === 'bull_call');
      expect(bullCallSpreads.length).toBeGreaterThan(0);
      // The first (best) recommendation should have the widest spread
      const best = bullCallSpreads[0];
      const bestWidth = best.legs[1].strike - best.legs[0].strike;
      for (const rec of bullCallSpreads) {
        const w = rec.legs[1].strike - rec.legs[0].strike;
        expect(bestWidth).toBeGreaterThanOrEqual(w);
      }
    });

    it('handles missing chain for symbol', () => {
      const universe = [
        { symbol: 'AAPL', name: 'Apple', history: makeHistory(150, 200) },
        { symbol: 'NOCHAIN', name: 'No Chain', history: makeHistory(50, 80) },
      ];
      const chains = new Map();
      chains.set('AAPL', makeChain(200, D(60), 0.25));
      // NOCHAIN has no chain

      const result = buildOptionsOpportunities({ universe, chains });
      const shortBand = result.bands.find((b) => b.band === 'short');
      for (const rec of shortBand.recommendations) {
        expect(rec.symbol).not.toBe('NOCHAIN');
      }
    });
  });
});
