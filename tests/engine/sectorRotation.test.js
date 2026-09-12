import { describe, it, expect } from 'vitest';
import {
  SECTOR_ETFS,
  rateOfChange,
  computeSectorRotation,
} from '../../src/engine/sectorRotation.js';

// ─── Helpers ────────────────────────────────────────────

// Generate a synthetic uptrend of N closes.
function makeUptrend(n = 260, drift = 0.001, start = 100) {
  const closes = [start];
  for (let i = 1; i < n; i++) {
    closes.push(+(closes[i - 1] * (1 + drift)).toFixed(4));
  }
  return closes;
}

function makeDowntrend(n = 260, drift = -0.001, start = 100) {
  return makeUptrend(n, drift, start);
}

// Build sectorsData from a map of symbol -> closes array
function buildSectors(symbolClosesMap) {
  const meta = Object.fromEntries(
    SECTOR_ETFS.map((e) => [e.symbol, e])
  );
  return Object.entries(symbolClosesMap).map(([symbol, closes]) => ({
    symbol,
    name: meta[symbol]?.name || symbol,
    sector: meta[symbol]?.sector || symbol,
    history: { closes },
  }));
}

// ─── rateOfChange ───────────────────────────────────────

describe('rateOfChange', () => {
  it('computes percentage change over N periods', () => {
    expect(rateOfChange([100, 110], 1)).toBeCloseTo(10, 5);
  });
  it('returns null for insufficient data', () => {
    expect(rateOfChange([1, 2], 5)).toBeNull();
  });
  it('returns null for empty input', () => {
    expect(rateOfChange([], 1)).toBeNull();
    expect(rateOfChange(null, 1)).toBeNull();
  });
  it('handles zero baseline', () => {
    expect(rateOfChange([0, 10], 1)).toBeNull();
  });
  it('computes negative ROC for downtrend', () => {
    expect(rateOfChange([100, 90], 1)).toBeCloseTo(-10, 5);
  });
});

// ─── computeSectorRotation ──────────────────────────────

describe('computeSectorRotation', () => {
  it('handles empty input', () => {
    const result = computeSectorRotation([], { closes: [] });
    expect(result.ranked).toEqual([]);
    expect(result.leading).toEqual([]);
    expect(result.trailing).toEqual([]);
    expect(result.regime).toBe('mixed');
  });

  it('handles null input', () => {
    const result = computeSectorRotation(null, null);
    expect(result.ranked).toEqual([]);
    expect(result.regime).toBe('mixed');
  });

  it('handles missing spy closes', () => {
    const sectors = buildSectors({ XLK: makeUptrend(260) });
    const result = computeSectorRotation(sectors, { closes: [] });
    expect(result.ranked).toEqual([]);
  });

  it('ranks sectors by relative strength', () => {
    // SPY moderate uptrend
    const spyCloses = makeUptrend(260, 0.001);
    // XLK strong uptrend, XLU slight downtrend
    const sectors = buildSectors({
      XLK: makeUptrend(260, 0.003),
      XLU: makeDowntrend(260, -0.0005),
      XLF: makeUptrend(260, 0.002),
      XLP: makeUptrend(260, 0.0005),
    });
    const result = computeSectorRotation(sectors, { closes: spyCloses });
    expect(result.ranked.length).toBe(4);
    // XLK should be top (strongest uptrend vs SPY)
    expect(result.ranked[0].symbol).toBe('XLK');
    // XLU should be bottom (downtrend vs SPY uptrend)
    expect(result.ranked[result.ranked.length - 1].symbol).toBe('XLU');
  });

  it('classifies risk-on when cyclical sectors lead', () => {
    const spyCloses = makeUptrend(260, 0.001);
    // All cyclical sectors outperform, all defensive underperform
    const sectors = buildSectors({
      XLK: makeUptrend(260, 0.003),
      XLF: makeUptrend(260, 0.0025),
      XLY: makeUptrend(260, 0.002),
      XLV: makeUptrend(260, 0.0003),
      XLP: makeUptrend(260, 0.0002),
      XLU: makeDowntrend(260, -0.0005),
    });
    const result = computeSectorRotation(sectors, { closes: spyCloses });
    expect(result.regime).toBe('risk-on');
    expect(result.leading.length).toBe(3);
    // Top 3 should all be cyclical
    const leadSymbols = result.leading.map((l) => l.symbol);
    expect(leadSymbols).toContain('XLK');
    expect(leadSymbols).toContain('XLF');
    expect(leadSymbols).toContain('XLY');
  });

  it('classifies risk-off when defensive sectors lead', () => {
    // SPY flat-ish so the RS ratio is well-behaved (ratio breaks when SPY ROC < 0)
    const spyCloses = makeUptrend(260, 0.0001);
    // Defensive sectors up, cyclical sectors down
    const sectors = buildSectors({
      XLV: makeUptrend(260, 0.0005),
      XLP: makeUptrend(260, 0.0004),
      XLU: makeUptrend(260, 0.0003),
      XLK: makeDowntrend(260, -0.003),
      XLF: makeDowntrend(260, -0.0025),
      XLY: makeDowntrend(260, -0.002),
    });
    const result = computeSectorRotation(sectors, { closes: spyCloses });
    expect(result.regime).toBe('risk-off');
    const leadSymbols = result.leading.map((l) => l.symbol);
    expect(leadSymbols).toContain('XLV');
    expect(leadSymbols).toContain('XLP');
    expect(leadSymbols).toContain('XLU');
  });

  it('classifies mixed when leadership is balanced', () => {
    const spyCloses = makeUptrend(260, 0.001);
    // Cyclical and defensive sectors closely matched in RS
    const sectors = buildSectors({
      XLK: makeUptrend(260, 0.0015),  // cyclical - slightly above SPY
      XLV: makeUptrend(260, 0.0014),  // defensive - slightly above SPY
      XLF: makeUptrend(260, 0.0013),  // cyclical
      XLU: makeUptrend(260, 0.0012),  // defensive
      XLP: makeUptrend(260, 0.0011),  // defensive
      XLY: makeUptrend(260, 0.0010),  // cyclical
    });
    const result = computeSectorRotation(sectors, { closes: spyCloses });
    expect(result.regime).toBe('mixed');
  });

  it('produces a rotation signal description', () => {
    const spyCloses = makeUptrend(260, 0.001);
    const sectors = buildSectors({
      XLK: makeUptrend(260, 0.003),
      XLF: makeUptrend(260, 0.0025),
      XLY: makeUptrend(260, 0.002),
      XLU: makeDowntrend(260, -0.0005),
    });
    const result = computeSectorRotation(sectors, { closes: spyCloses });
    expect(typeof result.rotationSignal).toBe('string');
    expect(result.rotationSignal.length).toBeGreaterThan(0);
    expect(result.rotationSignal).toContain('risk-on');
  });

  it('includes rsScore, roc values, trend, and vsSpy per ranked sector', () => {
    const spyCloses = makeUptrend(260, 0.001);
    const sectors = buildSectors({
      XLK: makeUptrend(260, 0.003),
      XLU: makeUptrend(260, 0.0005),
    });
    const result = computeSectorRotation(sectors, { closes: spyCloses });
    const first = result.ranked[0];
    expect(first).toHaveProperty('symbol');
    expect(first).toHaveProperty('name');
    expect(first).toHaveProperty('sector');
    expect(first).toHaveProperty('rsScore');
    expect(first).toHaveProperty('roc1m');
    expect(first).toHaveProperty('roc3m');
    expect(first).toHaveProperty('roc6m');
    expect(first).toHaveProperty('roc12m');
    expect(first).toHaveProperty('trend');
    expect(first).toHaveProperty('vsSpy');
  });

  it('leading has at most 3 and trailing has at most 3', () => {
    const spyCloses = makeUptrend(260, 0.001);
    const all = {};
    for (const e of SECTOR_ETFS) {
      all[e.symbol] = makeUptrend(260, Math.random() * 0.002);
    }
    const result = computeSectorRotation(buildSectors(all), { closes: spyCloses });
    expect(result.leading.length).toBeLessThanOrEqual(3);
    expect(result.trailing.length).toBeLessThanOrEqual(3);
  });
});

// ─── SECTOR_ETFS ────────────────────────────────────────

describe('SECTOR_ETFS', () => {
  it('contains all 11 sector ETFs', () => {
    expect(SECTOR_ETFS.length).toBe(11);
    const symbols = SECTOR_ETFS.map((e) => e.symbol);
    expect(symbols).toEqual(
      expect.arrayContaining([
        'XLK', 'XLF', 'XLE', 'XLV', 'XLI', 'XLY', 'XLP', 'XLU', 'XLB', 'XLRE', 'XLC',
      ])
    );
  });
  it('each entry has symbol, name, sector', () => {
    for (const e of SECTOR_ETFS) {
      expect(e).toHaveProperty('symbol');
      expect(e).toHaveProperty('name');
      expect(e).toHaveProperty('sector');
    }
  });
});
