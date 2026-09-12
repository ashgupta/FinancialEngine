import { describe, it, expect } from 'vitest';
import { enrich, computeMetrics } from '../../src/engine/portfolioMetrics.js';

const makePosition = (overrides = {}) => ({
  symbol: 'AAPL',
  quantity: 10,
  costBasis: 1500,
  description: 'Apple Inc',
  account: '',
  classification: 'equity',
  isUsSitus: true,
  ...overrides,
});

const makeQuote = (overrides = {}) => ({
  price: 185,
  previousClose: 180,
  dividendYield: 0.005,
  quoteType: 'EQUITY',
  fetchedAt: '2026-05-09T18:00:00Z',
  source: 'Yahoo Finance',
  ...overrides,
});

// ---------------------------------------------------------------------------
// enrich
// ---------------------------------------------------------------------------
describe('enrich', () => {
  it('enriches a single position with a quote', () => {
    const positions = [makePosition()];
    const quotes = { AAPL: makeQuote() };
    const result = enrich(positions, quotes);
    expect(result).toHaveLength(1);
    expect(result[0].currentPrice).toBe(185);
    expect(result[0].currentValue).toBe(1850);
    expect(result[0].priceAvailable).toBe(true);
  });

  it('computes unrealized gain correctly', () => {
    const pos = makePosition({ quantity: 10, costBasis: 1500 });
    const result = enrich([pos], { AAPL: makeQuote({ price: 185 }) });
    expect(result[0].unrealizedGain).toBeCloseTo(350, 2);
  });

  it('computes day change percent correctly', () => {
    const result = enrich([makePosition()], { AAPL: makeQuote({ price: 185, previousClose: 180 }) });
    expect(result[0].dayChangePct).toBeCloseTo(5 / 180, 6);
  });

  it('sets priceAvailable=false when quote missing', () => {
    const result = enrich([makePosition({ symbol: 'UNKWN' })], {});
    expect(result[0].priceAvailable).toBe(false);
    expect(result[0].currentPrice).toBeNull();
    expect(result[0].currentValue).toBeNull();
  });

  it('computes allocation percent across two positions', () => {
    const positions = [
      makePosition({ symbol: 'AAPL', quantity: 10 }),
      makePosition({ symbol: 'MSFT', quantity: 5 }),
    ];
    const quotes = {
      AAPL: makeQuote({ price: 200 }),
      MSFT: makeQuote({ price: 400 }),
    };
    const result = enrich(positions, quotes);
    const aapl = result.find(p => p.symbol === 'AAPL');
    const msft = result.find(p => p.symbol === 'MSFT');
    expect(aapl.allocationPct).toBeCloseTo((2000 / 4000) * 100, 2);
    expect(msft.allocationPct).toBeCloseTo((2000 / 4000) * 100, 2);
  });

  it('returns empty array for invalid positions input', () => {
    expect(enrich(null, {})).toEqual([]);
    expect(enrich(undefined, {})).toEqual([]);
  });

  it('handles null quotes gracefully', () => {
    const result = enrich([makePosition()], null);
    expect(result[0].priceAvailable).toBe(false);
  });

  it('propagates fetchedAt and source from quote', () => {
    const result = enrich([makePosition()], { AAPL: makeQuote() });
    expect(result[0].fetchedAt).toBe('2026-05-09T18:00:00Z');
    expect(result[0].source).toBe('Yahoo Finance');
  });

  it('sets null fetchedAt when no quote', () => {
    const result = enrich([makePosition({ symbol: 'X' })], {});
    expect(result[0].fetchedAt).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// computeMetrics
// ---------------------------------------------------------------------------
describe('computeMetrics', () => {
  const makeEnriched = (overrides = {}) => ({
    symbol: 'AAPL',
    quantity: 10,
    costBasis: 1500,
    description: '',
    account: '',
    classification: 'equity',
    isUsSitus: true,
    currentPrice: 185,
    currentValue: 1850,
    unrealizedGain: 350,
    dayChangePct: 0.05 / 180,
    dividendYield: 0.005,
    allocationPct: 100,
    priceAvailable: true,
    fetchedAt: '2026-05-09T18:00:00Z',
    source: 'Yahoo Finance',
    ...overrides,
  });

  it('computes totalValue correctly', () => {
    const positions = [
      makeEnriched({ symbol: 'AAPL', currentValue: 1850 }),
      makeEnriched({ symbol: 'MSFT', currentValue: 2000 }),
    ];
    const metrics = computeMetrics(positions);
    expect(metrics.totalValue).toBeCloseTo(3850, 2);
  });

  it('computes totalUnrealizedGain correctly', () => {
    const positions = [
      makeEnriched({ unrealizedGain: 350 }),
      makeEnriched({ symbol: 'MSFT', unrealizedGain: 200 }),
    ];
    expect(computeMetrics(positions).totalUnrealizedGain).toBeCloseTo(550, 2);
  });

  it('sets totalUnrealizedGain to null when no cost basis available', () => {
    const p = makeEnriched({ unrealizedGain: null });
    expect(computeMetrics([p]).totalUnrealizedGain).toBeNull();
  });

  it('computes allocation breakdown', () => {
    const positions = [
      makeEnriched({ symbol: 'AAPL', classification: 'equity', allocationPct: 60 }),
      makeEnriched({ symbol: 'BND', classification: 'bond', allocationPct: 40 }),
    ];
    const { allocation } = computeMetrics(positions);
    expect(allocation.equity).toBeCloseTo(60, 2);
    expect(allocation.bond).toBeCloseTo(40, 2);
    expect(allocation.etf).toBe(0);
  });

  it('identifies top 5 and concentration flags', () => {
    const positions = Array.from({ length: 3 }, (_, i) => makeEnriched({
      symbol: ['AAPL', 'MSFT', 'GOOGL'][i],
      currentValue: [1000, 5000, 200][i],
      allocationPct: [15.9, 79.4, 3.2][i],
    }));
    const { concentration } = computeMetrics(positions);
    expect(concentration.top5[0].symbol).toBe('MSFT');
    expect(concentration.exceeds20pct).toContain('MSFT');
    expect(concentration.exceeds20pct).not.toContain('AAPL');
  });

  it('computes US-situs breakdown', () => {
    const positions = [
      makeEnriched({ symbol: 'AAPL', isUsSitus: true, currentValue: 5000 }),
      makeEnriched({ symbol: 'CSPX', isUsSitus: false, currentValue: 3000 }),
    ];
    const { usSitus } = computeMetrics(positions);
    expect(usSitus.usSitusValue).toBeCloseTo(5000, 2);
    expect(usSitus.nonUsSitusValue).toBeCloseTo(3000, 2);
    expect(usSitus.usSitusPct).toBeCloseTo((5000 / 8000) * 100, 2);
  });

  it('computes NRA estate tax exposure above $60K exemption', () => {
    const positions = [
      makeEnriched({ symbol: 'AAPL', isUsSitus: true, currentValue: 200_000 }),
    ];
    const { usSitus } = computeMetrics(positions);
    expect(usSitus.nraEstateTaxExposure).toBeCloseTo(140_000, 2);
  });

  it('nraEstateTaxExposure is 0 when US-situs value below $60K', () => {
    const positions = [makeEnriched({ currentValue: 50_000 })];
    const { usSitus } = computeMetrics(positions);
    expect(usSitus.nraEstateTaxExposure).toBe(0);
  });

  it('computes weighted dividend yield', () => {
    const positions = [
      makeEnriched({ symbol: 'AAPL', currentValue: 1000, dividendYield: 0.01 }),
      makeEnriched({ symbol: 'MSFT', currentValue: 1000, dividendYield: 0.02 }),
    ];
    const metrics = computeMetrics(positions);
    expect(metrics.weightedDividendYield).toBeCloseTo(0.015, 5);
  });

  it('returns safe defaults for empty input', () => {
    const metrics = computeMetrics([]);
    expect(metrics.totalValue).toBe(0);
    expect(metrics.drawdownWarning).toBe(false);
    expect(metrics.positions).toEqual([]);
  });

  it('returns safe defaults for null input', () => {
    const metrics = computeMetrics(null);
    expect(metrics.totalValue).toBe(0);
  });
});
