import { describe, it, expect } from 'vitest';
import {
  bsCallPrice,
  bsCallDelta,
  impliedVolCall,
  analyzeLeapsCall,
  compareLeapsVsShares,
  pickStockReplacementStrike,
  midPrice,
} from '../../src/engine/leapsAnalyzer.js';

describe('leapsAnalyzer', () => {
  // ── bsCallPrice ─────────────────────────────────────────
  describe('bsCallPrice', () => {
    it('prices an ATM call with positive time value', () => {
      const price = bsCallPrice(100, 100, 1, 0.04, 0, 0.20);
      expect(price).toBeGreaterThan(0);
      expect(price).toBeLessThan(100);
    });

    it('at expiry returns intrinsic value', () => {
      expect(bsCallPrice(120, 100, 0, 0.04, 0, 0.2)).toBeCloseTo(20, 6);
      expect(bsCallPrice(80, 100, 0, 0.04, 0, 0.2)).toBeCloseTo(0, 6);
    });

    it('zero vol returns discounted intrinsic (forward) value', () => {
      const price = bsCallPrice(100, 90, 1, 0.04, 0, 0);
      // S·e^0 - K·e^(-rT) = 100 - 90·e^-0.04
      expect(price).toBeCloseTo(100 - 90 * Math.exp(-0.04), 6);
    });

    it('returns NaN for invalid inputs', () => {
      expect(Number.isNaN(bsCallPrice(0, 100, 1, 0.04, 0, 0.2))).toBe(true);
      expect(Number.isNaN(bsCallPrice(100, 0, 1, 0.04, 0, 0.2))).toBe(true);
    });
  });

  // ── bsCallDelta ─────────────────────────────────────────
  describe('bsCallDelta', () => {
    it('deep ITM call has delta near 1', () => {
      expect(bsCallDelta(200, 100, 1, 0.04, 0, 0.2)).toBeGreaterThan(0.95);
    });

    it('deep OTM call has delta near 0', () => {
      expect(bsCallDelta(50, 100, 1, 0.04, 0, 0.2)).toBeLessThan(0.05);
    });

    it('ATM call delta is around 0.5-0.6', () => {
      const d = bsCallDelta(100, 100, 1, 0.04, 0, 0.2);
      expect(d).toBeGreaterThan(0.5);
      expect(d).toBeLessThan(0.7);
    });
  });

  // ── impliedVolCall (round-trip) ─────────────────────────
  describe('impliedVolCall', () => {
    it('recovers the vol used to price a call (round-trip)', () => {
      const trueVol = 0.25;
      const price = bsCallPrice(755, 650, 1.5, 0.043, 0.01, trueVol);
      const iv = impliedVolCall(price, 755, 650, 1.5, 0.043, 0.01);
      expect(iv).toBeCloseTo(trueVol, 3);
    });

    it('returns null for a price below the no-arbitrage floor', () => {
      // intrinsic PV floor; price of 1 is impossibly low for a deep-ITM call
      expect(impliedVolCall(1, 755, 650, 1.5, 0.043, 0.01)).toBeNull();
    });

    it('returns null for invalid inputs', () => {
      expect(impliedVolCall(0, 100, 100, 1, 0.04, 0)).toBeNull();
      expect(impliedVolCall(10, 100, 100, 0, 0.04, 0)).toBeNull();
    });
  });

  // ── analyzeLeapsCall (the core decomposition) ───────────
  describe('analyzeLeapsCall', () => {
    // Reproduces the SPY $650 Jan-2028 example: S=755, premium=165, ~18mo
    const a = analyzeLeapsCall({ spot: 755, strike: 650, premium: 165, dte: 548, riskFreeRate: 0.043, dividendYield: 0.01 });

    it('splits premium into intrinsic + extrinsic', () => {
      expect(a.intrinsic).toBeCloseTo(105, 6);
      expect(a.extrinsic).toBeCloseTo(60, 6);
    });

    it('extrinsic equals netCarry + volatilityPremium', () => {
      expect(a.netCarry + a.volatilityPremium).toBeCloseTo(a.extrinsic, 6);
    });

    it('interest carry is positive and dividend drag reduces value', () => {
      expect(a.interestCarry).toBeGreaterThan(0);
      expect(a.dividendDrag).toBeGreaterThan(0);
      expect(a.netCarry).toBeCloseTo(a.interestCarry - a.dividendDrag, 6);
    });

    it('back-solves a plausible LEAPS implied vol (well above a low VIX)', () => {
      expect(a.impliedVol).toBeGreaterThan(0.15);
      expect(a.impliedVol).toBeLessThan(0.40);
    });

    it('computes breakeven as strike + premium', () => {
      expect(a.breakeven).toBeCloseTo(815, 6);
    });

    it('delta for a deep-ITM stock replacement is high', () => {
      expect(a.delta).toBeGreaterThan(0.7);
    });
  });

  // ── compareLeapsVsShares ────────────────────────────────
  describe('compareLeapsVsShares', () => {
    const r = compareLeapsVsShares({
      spot: 755, strike: 650, premium: 165, dte: 548, contracts: 1,
      riskFreeRate: 0.043, dividendYield: 0.01, freedCapitalYield: 0.05,
    });
    const c = r.comparison;

    it('LEAPS uses far less capital than shares', () => {
      expect(c.shareCapital).toBeCloseTo(75500, 2);
      expect(c.leapsCapital).toBeCloseTo(16500, 2);
      expect(c.capitalFreed).toBeCloseTo(59000, 2);
      expect(c.capitalEfficiency).toBeLessThan(0.25);
    });

    it('max loss equals total premium paid', () => {
      expect(c.maxLoss).toBeCloseTo(16500, 2);
    });

    it('freed capital earns income over the option life', () => {
      expect(c.freedCapitalIncomeOverLife).toBeGreaterThan(0);
      // 59000 × 5% × (548/365)
      expect(c.freedCapitalIncomeOverLife).toBeCloseTo(59000 * 0.05 * (548 / 365), 2);
    });

    it('volatility cost is positive and expressed as a % of share capital', () => {
      expect(c.volatilityCost).toBeGreaterThan(0);
      expect(c.volatilityCostPct).toBeGreaterThan(0);
      expect(c.volatilityCostPct).toBeLessThan(0.15);
    });

    it('delta exposure is the share-equivalent position', () => {
      expect(c.deltaExposure).toBeGreaterThan(70);
      expect(c.deltaExposure).toBeLessThanOrEqual(100);
    });

    it('defaults freedCapitalYield to the risk-free rate when omitted', () => {
      const r2 = compareLeapsVsShares({ spot: 755, strike: 650, premium: 165, dte: 548, riskFreeRate: 0.043, dividendYield: 0.01 });
      expect(r2.comparison.freedCapitalIncome).toBeCloseTo(r2.comparison.capitalFreed * 0.043, 6);
    });
  });

  // ── pickStockReplacementStrike ──────────────────────────
  describe('pickStockReplacementStrike', () => {
    const calls = [
      { strike: 600, bid: 160, ask: 162, impliedVolatility: 0.26 },
      { strike: 650, bid: 118, ask: 120, impliedVolatility: 0.25 },
      { strike: 700, bid: 80, ask: 82, impliedVolatility: 0.23 },
      { strike: 750, bid: 48, ask: 50, impliedVolatility: 0.21 },
      { strike: 800, bid: 25, ask: 27, impliedVolatility: 0.20 },
    ];

    it('picks a deep-ITM strike for a 0.80 target delta', () => {
      const pick = pickStockReplacementStrike(calls, 755, 548, 0.80, 0.043, 0.01);
      expect(pick).not.toBeNull();
      expect(pick.delta).toBeGreaterThan(0.7);
      expect(pick.contract.strike).toBeLessThan(755);
    });

    it('picks a lower-delta strike for a 0.50 target', () => {
      const deep = pickStockReplacementStrike(calls, 755, 548, 0.80, 0.043, 0.01);
      const atm = pickStockReplacementStrike(calls, 755, 548, 0.50, 0.043, 0.01);
      expect(atm.contract.strike).toBeGreaterThanOrEqual(deep.contract.strike);
    });

    it('returns null for an empty chain', () => {
      expect(pickStockReplacementStrike([], 755, 548)).toBeNull();
    });
  });

  // ── midPrice ────────────────────────────────────────────
  describe('midPrice', () => {
    it('averages bid and ask when both present', () => {
      expect(midPrice({ bid: 10, ask: 12 })).toBe(11);
    });

    it('falls back to last price when bid/ask missing', () => {
      expect(midPrice({ bid: 0, ask: 0, lastPrice: 9.5 })).toBe(9.5);
    });

    it('returns 0 for null', () => {
      expect(midPrice(null)).toBe(0);
    });
  });
});
