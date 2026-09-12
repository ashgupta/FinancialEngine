import { describe, it, expect } from 'vitest';
import {
  sma, ema, rateOfChange, rsi, bollingerBands, obv, avgVolume, fiftyTwoWeekRange,
  computeTimeSeriesMomentum, computeCrossSectionalMomentum, computeFactorMomentum,
  computeVolumeAnalysis, analyzeAsset, buildMomentumScan,
  MOMENTUM_UNIVERSE, FACTOR_ETFS,
} from '../../src/engine/momentumEngine.js';

// ─── Helpers ────────────────────────────────────────────
// Generate a synthetic uptrend: N bars, starting at 100, +0.1% avg daily
function makeUptrend(n = 260, drift = 0.001, volatility = 0.01, start = 100) {
  const closes = [start];
  const highs = [start * 1.005];
  const lows = [start * 0.995];
  const volumes = [1_000_000];
  for (let i = 1; i < n; i++) {
    const noise = (Math.sin(i * 0.3) + Math.cos(i * 0.7)) * volatility;
    const close = closes[i - 1] * (1 + drift + noise);
    closes.push(+close.toFixed(4));
    highs.push(+(close * 1.01).toFixed(4));
    lows.push(+(close * 0.99).toFixed(4));
    // Higher volume on up days
    const up = close > closes[i - 1];
    volumes.push(Math.round(1_000_000 * (up ? 1.3 : 0.7) + Math.random() * 200_000));
  }
  return { closes, highs, lows, volumes };
}

function makeDowntrend(n = 260) {
  const closes = [100];
  const highs = [100.5];
  const lows = [99.5];
  const volumes = [1_000_000];
  const drift = -0.001;
  const volatility = 0.01;
  for (let i = 1; i < n; i++) {
    const noise = (Math.sin(i * 0.3) + Math.cos(i * 0.7)) * volatility;
    const close = closes[i - 1] * (1 + drift + noise);
    closes.push(+close.toFixed(4));
    highs.push(+(close * 1.01).toFixed(4));
    lows.push(+(close * 0.99).toFixed(4));
    // In a downtrend, higher volume on DOWN days (distribution)
    const up = close > closes[i - 1];
    volumes.push(Math.round(1_000_000 * (up ? 0.7 : 1.3) + Math.random() * 200_000));
  }
  return { closes, highs, lows, volumes };
}

function makeSideways(n = 200) {
  return makeUptrend(n, 0, 0.01, 100);
}

// ─── Technical indicator tests ──────────────────────────
describe('sma', () => {
  it('computes simple moving average', () => {
    expect(sma([1, 2, 3, 4, 5], 3)).toBe(4); // (3+4+5)/3
  });
  it('returns null for insufficient data', () => {
    expect(sma([1, 2], 5)).toBeNull();
  });
  it('returns null for empty input', () => {
    expect(sma([], 5)).toBeNull();
  });
});

describe('ema', () => {
  it('computes exponential moving average', () => {
    const result = ema([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 5);
    expect(result).toBeGreaterThan(5);
    expect(result).toBeLessThan(10);
  });
  it('returns null for insufficient data', () => {
    expect(ema([1, 2], 5)).toBeNull();
  });
});

describe('rateOfChange', () => {
  it('computes percentage change over N periods', () => {
    // 100 → 110 over 5 periods = +10%
    expect(rateOfChange([100, 101, 102, 103, 104, 110], 5)).toBeCloseTo(10, 1);
  });
  it('returns null for insufficient data', () => {
    expect(rateOfChange([100, 101], 5)).toBeNull();
  });
  it('handles negative ROC', () => {
    expect(rateOfChange([100, 99, 98, 97, 96, 90], 5)).toBeCloseTo(-10, 1);
  });
});

describe('rsi', () => {
  it('returns 100 for all-up series', () => {
    const closes = Array.from({ length: 20 }, (_, i) => 100 + i);
    expect(rsi(closes, 14)).toBe(100);
  });
  it('returns 0 for all-down series', () => {
    const closes = Array.from({ length: 20 }, (_, i) => 100 - i);
    expect(rsi(closes, 14)).toBe(0);
  });
  it('returns ~50 for balanced series', () => {
    const closes = [];
    for (let i = 0; i < 30; i++) closes.push(100 + (i % 2 === 0 ? 1 : -1));
    const result = rsi(closes, 14);
    expect(result).toBeGreaterThan(40);
    expect(result).toBeLessThan(60);
  });
  it('returns null for insufficient data', () => {
    expect(rsi([1, 2, 3], 14)).toBeNull();
  });
});

describe('bollingerBands', () => {
  it('computes upper, middle, lower bands', () => {
    const closes = Array.from({ length: 20 }, (_, i) => 100 + Math.sin(i) * 2);
    const bb = bollingerBands(closes, 20, 2);
    expect(bb.upper).toBeGreaterThan(bb.middle);
    expect(bb.middle).toBeGreaterThan(bb.lower);
    expect(bb.bandwidth).toBeGreaterThan(0);
    expect(bb.percentB).toBeGreaterThanOrEqual(0);
    expect(bb.percentB).toBeLessThanOrEqual(100);
  });
  it('returns null for insufficient data', () => {
    expect(bollingerBands([1, 2, 3], 20)).toBeNull();
  });
});

describe('obv', () => {
  it('accumulates volume on up days, subtracts on down days', () => {
    const closes = [100, 102, 101, 103];
    const volumes = [1000, 2000, 1500, 3000];
    const result = obv(closes, volumes);
    expect(result[0]).toBe(0);
    expect(result[1]).toBe(2000);   // up day → +2000
    expect(result[2]).toBe(500);    // down day → -1500
    expect(result[3]).toBe(3500);   // up day → +3000
  });
  it('returns empty for mismatched lengths', () => {
    expect(obv([1, 2], [1])).toEqual([]);
  });
});

describe('avgVolume', () => {
  it('computes average of last N volumes', () => {
    expect(avgVolume([100, 200, 300, 400, 500], 3)).toBe(400); // (300+400+500)/3
  });
  it('returns null for insufficient data', () => {
    expect(avgVolume([100, 200], 5)).toBeNull();
  });
});

describe('fiftyTwoWeekRange', () => {
  it('computes 52-week high and low', () => {
    const highs = Array.from({ length: 252 }, (_, i) => 100 + i * 0.1);
    const lows = Array.from({ length: 252 }, (_, i) => 95 + i * 0.1);
    const result = fiftyTwoWeekRange(highs, lows);
    expect(result.high52w).toBeCloseTo(100 + 251 * 0.1, 1);
    expect(result.low52w).toBeCloseTo(95, 1);
  });
  it('handles empty input', () => {
    const result = fiftyTwoWeekRange([], []);
    expect(result.high52w).toBeNull();
  });
});

// ─── Time Series Momentum tests ─────────────────────────
describe('computeTimeSeriesMomentum', () => {
  it('detects bullish momentum in uptrend', () => {
    const hist = makeUptrend(260);
    const tsm = computeTimeSeriesMomentum(hist);
    expect(tsm.insufficientData).toBeUndefined();
    expect(tsm.momentumScore).toBeGreaterThan(0);
    expect(tsm.signal).toMatch(/bullish/);
    expect(tsm.roc12m).toBeGreaterThan(0);
    // MA stack depends on noise cycle position; just verify it's set
    expect(tsm.maStack).toBeDefined();
  });

  it('detects bearish momentum in downtrend', () => {
    const hist = makeDowntrend(252);
    const tsm = computeTimeSeriesMomentum(hist);
    expect(tsm.momentumScore).toBeLessThan(0);
    expect(tsm.signal).toMatch(/bearish/);
  });

  it('returns insufficientData for short series', () => {
    expect(computeTimeSeriesMomentum({ closes: [1, 2, 3] }).insufficientData).toBe(true);
  });

  it('computes RSI in valid range', () => {
    const hist = makeUptrend(252);
    const tsm = computeTimeSeriesMomentum(hist);
    expect(tsm.rsi14).toBeGreaterThanOrEqual(0);
    expect(tsm.rsi14).toBeLessThanOrEqual(100);
  });

  it('detects Bollinger Band breakout', () => {
    const hist = makeSideways(252);
    // Spike the last close above the upper band
    hist.closes[hist.closes.length - 1] = hist.closes[hist.closes.length - 1] * 1.1;
    const tsm = computeTimeSeriesMomentum(hist);
    expect(['upper-band', '52w-high']).toContain(tsm.breakout);
  });
});

// ─── Cross-Sectional Momentum tests ─────────────────────
describe('computeCrossSectionalMomentum', () => {
  it('ranks assets by momentum score', () => {
    const assets = [
      { symbol: 'A', name: 'Asset A', momentumScore: 15 },
      { symbol: 'B', name: 'Asset B', momentumScore: -5 },
      { symbol: 'C', name: 'Asset C', momentumScore: 10 },
      { symbol: 'D', name: 'Asset D', momentumScore: -10 },
    ];
    const result = computeCrossSectionalMomentum(assets);
    expect(result.ranked[0].symbol).toBe('A');
    expect(result.ranked[3].symbol).toBe('D');
    expect(result.leaders[0].symbol).toBe('A');
    expect(result.laggards[0].symbol).toBe('D');
  });

  it('assigns percentile ranks', () => {
    const assets = [
      { symbol: 'A', momentumScore: 10 },
      { symbol: 'B', momentumScore: 5 },
      { symbol: 'C', momentumScore: 0 },
      { symbol: 'D', momentumScore: -5 },
    ];
    const result = computeCrossSectionalMomentum(assets);
    expect(result.ranked[0].percentile).toBe(100);
    expect(result.ranked[3].percentile).toBe(25);
  });

  it('handles empty input', () => {
    const result = computeCrossSectionalMomentum([]);
    expect(result.ranked).toEqual([]);
    expect(result.medianScore).toBeNull();
  });
});

// ─── Factor Momentum tests ──────────────────────────────
describe('computeFactorMomentum', () => {
  it('ranks factors by 3-month ROC', () => {
    const factors = [
      { symbol: 'MTUM', name: 'Momentum', factor: 'Momentum', roc3m: 8, momentumScore: 7 },
      { symbol: 'VLUE', name: 'Value', factor: 'Value', roc3m: 2, momentumScore: 1 },
      { symbol: 'QUAL', name: 'Quality', factor: 'Quality', roc3m: 5, momentumScore: 4 },
    ];
    const result = computeFactorMomentum(factors);
    expect(result.ranked[0].factor).toBe('Momentum');
    expect(result.ranked[2].factor).toBe('Value');
    expect(result.leading).toBe('Momentum');
    expect(result.trailing).toBe('Value');
  });

  it('handles empty input', () => {
    expect(computeFactorMomentum([]).ranked).toEqual([]);
  });
});

// ─── Volume Analysis tests ──────────────────────────────
describe('computeVolumeAnalysis', () => {
  it('detects bullish volume confirmation in uptrend', () => {
    const hist = makeUptrend(252);
    const va = computeVolumeAnalysis(hist);
    expect(va.insufficientData).toBeUndefined();
    expect(va.upVolPct).toBeGreaterThan(50);
    expect(va.confirmation).toMatch(/bullish/);
    expect(va.obvTrend).toContain('rising');
  });

  it('detects bearish volume confirmation in downtrend', () => {
    const hist = makeDowntrend(252);
    const va = computeVolumeAnalysis(hist);
    expect(va.upVolPct).toBeLessThan(50);
    expect(va.confirmation).toMatch(/bearish/);
    expect(va.obvTrend).toContain('falling');
  });

  it('detects volume spikes', () => {
    const hist = makeSideways(252);
    // Add a 5x volume spike on the last bar
    hist.volumes[hist.volumes.length - 1] = (avgVolume(hist.volumes, 20) || 0) * 5;
    const va = computeVolumeAnalysis(hist);
    expect(va.spikes.length).toBeGreaterThan(0);
    expect(va.spikes[0].ratio).toBeGreaterThanOrEqual(3);
  });

  it('returns insufficientData for short series', () => {
    expect(computeVolumeAnalysis({ closes: [1, 2], volumes: [100, 200] }).insufficientData).toBe(true);
  });
});

// ─── analyzeAsset tests ─────────────────────────────────
describe('analyzeAsset', () => {
  it('combines time series + volume analysis', () => {
    const hist = makeUptrend(252);
    const result = analyzeAsset(hist, { symbol: 'TEST', name: 'Test Asset' });
    expect(result.symbol).toBe('TEST');
    expect(result.timeSeries).toBeDefined();
    expect(result.volume).toBeDefined();
    expect(result.momentumScore).toBeGreaterThan(0);
    expect(!result.insufficientData).toBe(true);
  });
});

// ─── buildMomentumScan tests ────────────────────────────
describe('buildMomentumScan', () => {
  it('builds full scan from multiple assets + factors', () => {
    const assetsData = [
      { symbol: 'UP', name: 'Uptrend', history: makeUptrend(252) },
      { symbol: 'DOWN', name: 'Downtrend', history: makeDowntrend(252) },
      { symbol: 'FLAT', name: 'Sideways', history: makeSideways(252) },
    ];
    const factorData = [
      { symbol: 'MTUM', name: 'Momentum', factor: 'Momentum', history: makeUptrend(252) },
      { symbol: 'VLUE', name: 'Value', factor: 'Value', history: makeSideways(252) },
    ];
    const scan = buildMomentumScan(assetsData, factorData);
    expect(scan.assets.length).toBe(3);
    expect(scan.crossSectional.ranked.length).toBe(3);
    expect(scan.crossSectional.ranked[0].symbol).toBe('UP');
    expect(scan.factorMomentum.ranked.length).toBe(2);
    expect(scan.factorMomentum.leading).toBe('Momentum');
    expect(scan.volumeSummary).toBeDefined();
    expect(scan.fetchedAt).toBeDefined();
  });

  it('handles empty input', () => {
    const scan = buildMomentumScan([], []);
    expect(scan.assets).toEqual([]);
    expect(scan.crossSectional.ranked).toEqual([]);
  });
});

// ─── Universe tests ─────────────────────────────────────
describe('MOMENTUM_UNIVERSE', () => {
  it('has indices, stocks, and etfs', () => {
    expect(MOMENTUM_UNIVERSE.indices.length).toBeGreaterThan(0);
    expect(MOMENTUM_UNIVERSE.stocks.length).toBeGreaterThan(0);
    expect(MOMENTUM_UNIVERSE.etfs.length).toBeGreaterThan(0);
  });
  it('has symbol + name for each entry', () => {
    for (const list of Object.values(MOMENTUM_UNIVERSE)) {
      for (const a of list) {
        expect(a.symbol).toBeTruthy();
        expect(a.name).toBeTruthy();
      }
    }
  });
});

describe('FACTOR_ETFS', () => {
  it('has multiple factor categories', () => {
    const factors = new Set(FACTOR_ETFS.map((f) => f.factor));
    expect(factors.size).toBeGreaterThanOrEqual(4);
  });
  it('has symbol, name, factor for each', () => {
    for (const f of FACTOR_ETFS) {
      expect(f.symbol).toBeTruthy();
      expect(f.name).toBeTruthy();
      expect(f.factor).toBeTruthy();
    }
  });
});
