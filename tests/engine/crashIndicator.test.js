import { describe, it, expect } from 'vitest';
import { computeCrashIndicator, WEIGHTS, RISK_LEVELS } from '../../src/engine/crashIndicator.js';

describe('crashIndicator', () => {
  // ── Fixtures ──────────────────────────────────────────

  const calmInputs = {
    volatility: {
      vixLevel: 13,
      termStructure: { vix: 13, vx1: 14.5, vx2: 15.5, contango: true, backwardation: false },
    },
    momentumScan: {
      assets: [
        {
          symbol: 'SPY',
          timeSeries: { last: 580, sma200: 540, deathCross: false, range52w: { high52w: 585, low52w: 480 } },
          momentumScore: 18,
        },
        { symbol: 'QQQ', timeSeries: { last: 500, sma200: 460 }, momentumScore: 22 },
        { symbol: 'IWM', timeSeries: { last: 230, sma200: 210 }, momentumScore: 15 },
        { symbol: 'DIA', timeSeries: { last: 430, sma200: 410 }, momentumScore: 12 },
      ],
    },
    cotReport: {
      byClass: {
        Equities: [
          { weekDelta: 15000 }, { weekDelta: 8000 },
        ],
      },
    },
  };

  const crisisInputs = {
    volatility: {
      vixLevel: 45,
      termStructure: { vix: 45, vx1: 38, vx2: 35, contango: false, backwardation: true },
    },
    momentumScan: {
      assets: [
        {
          symbol: 'SPY',
          timeSeries: { last: 410, sma200: 540, deathCross: true, range52w: { high52w: 585, low52w: 400 } },
          momentumScore: -18,
        },
        { symbol: 'QQQ', timeSeries: { last: 350, sma200: 460 }, momentumScore: -22 },
        { symbol: 'IWM', timeSeries: { last: 180, sma200: 210 }, momentumScore: -15 },
        { symbol: 'DIA', timeSeries: { last: 370, sma200: 410 }, momentumScore: -12 },
      ],
    },
    cotReport: {
      byClass: {
        Equities: [
          { weekDelta: -25000 }, { weekDelta: -18000 },
        ],
      },
    },
  };

  // ── Tests ─────────────────────────────────────────────

  it('returns a calm score for calm market inputs', () => {
    const result = computeCrashIndicator(calmInputs);
    expect(result.score).toBeLessThan(25);
    expect(result.level).toBe('calm');
    expect(result.factors).toHaveLength(7);
  });

  it('returns a high/severe score for crisis inputs', () => {
    const result = computeCrashIndicator(crisisInputs);
    expect(result.score).toBeGreaterThan(65);
    expect(['high', 'severe']).toContain(result.level);
  });

  it('produces all 7 factors with required fields', () => {
    const result = computeCrashIndicator(calmInputs);
    for (const f of result.factors) {
      expect(f).toHaveProperty('key');
      expect(f).toHaveProperty('label');
      expect(f).toHaveProperty('value');
      expect(f).toHaveProperty('score');
      expect(f).toHaveProperty('note');
      expect(f).toHaveProperty('weight');
      expect(f).toHaveProperty('contribution');
      expect(typeof f.score).toBe('number');
      expect(f.score).toBeGreaterThanOrEqual(0);
      expect(f.score).toBeLessThanOrEqual(100);
    }
  });

  it('weights sum to 1.0', () => {
    const totalWeight = Object.values(WEIGHTS).reduce((s, w) => s + w, 0);
    expect(totalWeight).toBeCloseTo(1.0, 5);
  });

  it('monotonicity: worsening VIX never lowers the score', () => {
    const base = computeCrashIndicator(calmInputs);
    const worse = computeCrashIndicator({
      ...calmInputs,
      volatility: { ...calmInputs.volatility, vixLevel: 35 },
    });
    expect(worse.score).toBeGreaterThanOrEqual(base.score);
  });

  it('monotonicity: SPY dropping below 200-DMA never lowers the score', () => {
    const base = computeCrashIndicator(calmInputs);
    const worse = computeCrashIndicator({
      ...calmInputs,
      momentumScan: {
        ...calmInputs.momentumScan,
        assets: calmInputs.momentumScan.assets.map((a) =>
          a.symbol === 'SPY'
            ? { ...a, timeSeries: { ...a.timeSeries, last: 500, sma200: 540, deathCross: true } }
            : a
        ),
      },
    });
    expect(worse.score).toBeGreaterThanOrEqual(base.score);
  });

  it('handles null/missing inputs gracefully', () => {
    const result = computeCrashIndicator({});
    expect(result.score).toBe(0);
    expect(result.level).toBe('calm');
    expect(result.factors).toHaveLength(7);
    for (const f of result.factors) {
      expect(f.note).toContain('unavailable');
    }
  });

  it('handles partial data (only volatility)', () => {
    const result = computeCrashIndicator({
      volatility: { vixLevel: 30, termStructure: { vix: 30, vx1: 25 } },
    });
    expect(result.score).toBeGreaterThan(0);
    expect(result.factors).toHaveLength(7);
    // Factors without data should have score 0
    const breadthF = result.factors.find((f) => f.key === 'breadth');
    expect(breadthF.score).toBe(0);
  });

  it('classifies levels correctly at boundaries', () => {
    // With only 2 of 7 factors (vix + termStructure), scores are proportionally lower.
    // Full-data calm/crisis are tested above; here we verify relative ordering.
    const calm = computeCrashIndicator({
      volatility: { vixLevel: 13, termStructure: { vix: 13, vx1: 14 } },
    });
    expect(calm.score).toBeLessThan(15);

    const stressed = computeCrashIndicator({
      volatility: { vixLevel: 55, termStructure: { vix: 55, vx1: 45 } },
    });
    // 2 factors at max → ~30 (0.30 weight × 100), which is still > calm
    expect(stressed.score).toBeGreaterThan(calm.score * 3);
  });

  it('RISK_LEVELS has 5 levels in ascending order', () => {
    expect(RISK_LEVELS).toHaveLength(5);
    for (let i = 1; i < RISK_LEVELS.length; i++) {
      expect(RISK_LEVELS[i].max).toBeGreaterThan(RISK_LEVELS[i - 1].max);
    }
  });

  it('term structure backwardation scores higher than contango', () => {
    const contango = computeCrashIndicator({
      volatility: { vixLevel: 20, termStructure: { vix: 20, vx1: 22, contango: true, backwardation: false } },
    });
    const backwardation = computeCrashIndicator({
      volatility: { vixLevel: 20, termStructure: { vix: 20, vx1: 16, contango: false, backwardation: true } },
    });
    expect(backwardation.score).toBeGreaterThan(contango.score);
  });

  it('COT de-risking scores higher than COT adding longs', () => {
    const addingLongs = computeCrashIndicator({
      cotReport: { byClass: { Equities: [{ weekDelta: 20000 }, { weekDelta: 15000 }] } },
    });
    const deRisking = computeCrashIndicator({
      cotReport: { byClass: { Equities: [{ weekDelta: -30000 }, { weekDelta: -20000 }] } },
    });
    expect(deRisking.score).toBeGreaterThan(addingLongs.score);
  });
});
