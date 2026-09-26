import { describe, it, expect } from 'vitest';
import {
  KARSAN_THESIS,
  UNDERLYINGS,
  resolveUnderlying,
  bsPutPrice,
  pickExpiry,
  shockedIv,
  scenarioPnl,
  computeThesisPhase,
  buildTermIv,
  buildScorecard,
  buildCrashTrades,
  buildButterflies,
  portfolioImpact,
  buildVBottomPlan,
  buildDebasementPanel,
  buildCrashThesis,
  _internal,
} from '../../src/engine/crashThesis.js';
import { bsCallPrice } from '../../src/engine/leapsAnalyzer.js';

// ─── Fixtures ────────────────────────────────────────────

const ASOF = Date.UTC(2026, 8, 26); // 2026-09-26
const SPOT = 771.35;
const ts = (y, m, d) => Date.UTC(y, m - 1, d) / 1000;
const EXP = {
  nov: ts(2026, 11, 20),
  dec: ts(2026, 12, 18),
  mar: ts(2027, 3, 19),
  jun: ts(2027, 6, 17),
};

/** SPY-like put chain with downside skew; near-dated skew steeper. */
function makeChain(exp, { base, skew }) {
  const T = (exp * 1000 - ASOF) / 86400000 / 365;
  const puts = [];
  for (let k = 580; k <= 820; k += 5) {
    const iv = Math.max(0.08, base + skew * (1 - k / SPOT));
    const px = bsPutPrice(SPOT, k, T, 0.043, 0.01, iv);
    const m = Math.max(px, 0.05);
    puts.push({ strike: k, bid: +(m * 0.995).toFixed(2), ask: +(m * 1.005 + 0.01).toFixed(2), impliedVolatility: iv, openInterest: 1000, volume: 100 });
  }
  return { expirationDate: exp, underlyingPrice: SPOT, puts, calls: [] };
}

const CHAINS = [
  makeChain(EXP.nov, { base: 0.12, skew: 0.85 }),
  makeChain(EXP.dec, { base: 0.123, skew: 0.75 }),
  makeChain(EXP.mar, { base: 0.126, skew: 0.6 }),
  makeChain(EXP.jun, { base: 0.131, skew: 0.48 }),
];

const CALM_CRASH = {
  score: 17.9, level: 'calm', label: 'Calm',
  factors: [
    { key: 'breadth', score: 11, note: '11% of sectors below 200-DMA — broad strength' },
    { key: 'cotPositioning', score: 100, note: 'COT equity net -65,277 — sharp de-risking by smart money' },
  ],
  spy: { last: 771.35, sma200: 718.5, high52w: 779.4 },
};
const CALM_VOL = {
  vixLevel: 14.87,
  termStructure: { vix: 14.87, vix3m: 17.93, contango: true, backwardation: false, label: 'Contango (normal)' },
  chart: Array.from({ length: 20 }, () => ({ vix: 15 })),
};

// ─── Pricing helpers ─────────────────────────────────────

describe('bsPutPrice', () => {
  it('satisfies put-call parity', () => {
    const S = 100, K = 95, T = 0.5, r = 0.04, q = 0.01, v = 0.2;
    const lhs = bsCallPrice(S, K, T, r, q, v) - bsPutPrice(S, K, T, r, q, v);
    const rhs = S * Math.exp(-q * T) - K * Math.exp(-r * T);
    expect(lhs).toBeCloseTo(rhs, 8);
  });
  it('returns intrinsic at expiry (boundary)', () => {
    expect(bsPutPrice(90, 100, 0, 0.04, 0, 0.2)).toBe(10);
    expect(bsPutPrice(110, 100, 0, 0.04, 0, 0.2)).toBe(0);
  });
  it('invalid input → NaN', () => {
    expect(bsPutPrice(0, 100, 1, 0.04, 0, 0.2)).toBeNaN();
    expect(bsPutPrice(100, -5, 1, 0.04, 0, 0.2)).toBeNaN();
  });
});

describe('pickExpiry', () => {
  const exps = Object.values(EXP);
  it('picks the closest expiry to a target', () => {
    expect(pickExpiry(exps, Date.UTC(2026, 11, 20))).toBe(EXP.dec);
  });
  it('respects bounds', () => {
    expect(pickExpiry(exps, Date.UTC(2026, 10, 1), { minMs: Date.UTC(2027, 0, 1) })).toBe(EXP.mar);
  });
  it('returns null when nothing is in range', () => {
    expect(pickExpiry(exps, 0, { minMs: Date.UTC(2030, 0, 1) })).toBeNull();
    expect(pickExpiry([], 0)).toBeNull();
  });
});

describe('shockedIv', () => {
  it('declines raise IV, rallies lower it', () => {
    expect(shockedIv(0.15, -0.2, 30)).toBeGreaterThan(0.15);
    expect(shockedIv(0.15, 0.1, 30)).toBeLessThan(0.15);
  });
  it('long-dated legs react less (term damping)', () => {
    expect(shockedIv(0.15, -0.2, 200) - 0.15).toBeLessThan(shockedIv(0.15, -0.2, 30) - 0.15);
  });
  it('never drops below the IV floor', () => {
    expect(shockedIv(0.09, 0.5, 30)).toBeGreaterThanOrEqual(0.08);
  });
});

describe('scenarioPnl', () => {
  it('long put gains in a decline and loses ≈ premium in a rally at expiry', () => {
    const leg = { action: 'BUY', type: 'PUT', strike: 700, dte: 30, mid: 5, iv: 0.2 };
    const s = scenarioPnl([leg], 770, 30);
    expect(s.find((x) => x.move === -0.2).pnl).toBeGreaterThan(0);
    expect(s.find((x) => x.move === 0.1).pnl).toBe(-500);
  });
});

// ─── Phase / timeline ────────────────────────────────────

describe('computeThesisPhase', () => {
  const spyCalm = { last: 771, sma200: 718, high52w: 779 };
  it('pre-window before the midterms', () => {
    const p = computeThesisPhase({ asOf: ASOF, spy: spyCalm, vixLevel: 15, crash: CALM_CRASH });
    expect(p.phase).toBe('pre-window');
    expect(p.daysToMidterms).toBe(38);
    expect(p.daysToKillSwitch).toBe(186);
    expect(p.windowProgressPct).toBe(0);
  });
  it('window-open between midterms and kill switch', () => {
    expect(computeThesisPhase({ asOf: Date.UTC(2026, 11, 15), spy: spyCalm }).phase).toBe('window-open');
  });
  it('kill-switch after March with no drawdown', () => {
    const p = computeThesisPhase({ asOf: Date.UTC(2027, 3, 5), spy: spyCalm });
    expect(p.phase).toBe('kill-switch');
    expect(p.daysToKillSwitch).toBeLessThan(0);
  });
  it('underway on a 12% drawdown', () => {
    expect(computeThesisPhase({ asOf: ASOF, spy: { last: 686, sma200: 720, high52w: 779 } }).phase).toBe('underway');
  });
  it('capitulation on a 25% drawdown with VIX ≥ 30', () => {
    expect(computeThesisPhase({ asOf: ASOF, spy: { last: 584, sma200: 720, high52w: 779 }, vixLevel: 38 }).phase).toBe('capitulation');
  });
  it('missing SPY data falls back to the calendar', () => {
    const p = computeThesisPhase({ asOf: ASOF });
    expect(p.phase).toBe('pre-window');
    expect(p.drawdownPct).toBeNull();
  });
});

// ─── IV term structure + scorecard ───────────────────────

describe('buildTermIv', () => {
  it('sorts by DTE and shows downside skew', () => {
    const t = buildTermIv(CHAINS, ASOF);
    expect(t.map((x) => x.expiry)).toEqual([EXP.nov, EXP.dec, EXP.mar, EXP.jun]);
    for (const row of t) expect(row.iv90).toBeGreaterThan(row.atmIv);
  });
  it('ignores empty chains', () => {
    expect(buildTermIv([{ expirationDate: EXP.nov, puts: [] }, null], ASOF)).toEqual([]);
  });
});

describe('buildScorecard', () => {
  it('calm market: cheap vol supports entry but no confirmation', () => {
    const s = buildScorecard({ crash: CALM_CRASH, volatility: CALM_VOL, spy: CALM_CRASH.spy, termIv: buildTermIv(CHAINS, ASOF) });
    expect(s.checks.find((c) => c.key === 'volCheap').status).toBe('supports');
    expect(s.checks.find((c) => c.key === 'skewEdge').status).toBe('supports');
    expect(s.checks.find((c) => c.key === 'trend').status).toBe('against');
    expect(s.checks.find((c) => c.key === 'cot').status).toBe('supports');
    expect(s.confirming).toBe(1);
    expect(s.verdict).toMatch(/Early warning/);
  });
  it('stressed market confirms the thesis', () => {
    const s = buildScorecard({
      crash: { score: 72, level: 'high', label: 'High', factors: [{ key: 'breadth', score: 70, note: '' }, { key: 'cotPositioning', score: 80, note: '' }] },
      volatility: { vixLevel: 32, termStructure: { vix: 32, vix3m: 27, backwardation: true, label: 'Backwardation (stress)' } },
      spy: { last: 650, sma200: 720 },
    });
    expect(s.confirming).toBeGreaterThanOrEqual(3);
    expect(s.verdict).toMatch(/confirming/);
    expect(s.checks.find((c) => c.key === 'volCheap').status).toBe('against');
  });
  it('empty input → no checks', () => {
    const s = buildScorecard({});
    expect(s.checks).toEqual([]);
    expect(s.verdict).toMatch(/No confirmation/);
  });
});

// ─── Trades ──────────────────────────────────────────────

describe('buildCrashTrades', () => {
  const budget = 10000;
  const r = buildCrashTrades({ asOf: ASOF, chains: CHAINS, budget });
  const get = (k) => r.trades.find((t) => t.key === k);

  it('builds all four Karsan structures', () => {
    expect(r.trades.map((t) => t.key).sort()).toEqual(['calendar', 'diagonal', 'killSwitchPut', 'putSpread']);
    expect(r.horizon.date).toBe('2026-12-18'); // first cycle ~6 weeks after midterms
  });

  it('calendar: sell Dec / buy June at the same ~95% strike, IV edge positive', () => {
    const c = get('calendar');
    const [short, long] = c.legs;
    expect(short.action).toBe('SELL');
    expect(long.action).toBe('BUY');
    expect(short.strike).toBe(long.strike);
    expect(short.strike).toBe(735);
    expect(short.expiry).toBe(EXP.dec);
    expect(long.expiry).toBe(EXP.jun);
    expect(c.ivEdge).toBeGreaterThan(0);
    expect(c.netDebit).toBeGreaterThan(0);
    expect(c.pnlFlat).toBeGreaterThan(0); // front expires worthless, June retains value
  });

  it('diagonal: short strike below long strike, different expiries', () => {
    const d = get('diagonal');
    const long = d.legs.find((l) => l.action === 'BUY');
    const short = d.legs.find((l) => l.action === 'SELL');
    expect(short.strike).toBeLessThan(long.strike);
    expect(short.expiry).toBeLessThan(long.expiry);
  });

  it('put spread and kill-switch put pay in a crash, lose ≈ premium in a rally', () => {
    expect(get('putSpread').pnlAtMinus20).toBeGreaterThan(0);
    expect(get('putSpread').maxProfit).toBeGreaterThan(get('putSpread').maxLoss);
    const k = get('killSwitchPut');
    expect(k.legs[0].expiry).toBe(EXP.mar);
    expect(k.pnlAtMinus30).toBeGreaterThan(k.costPerContract);
    expect(k.scenarios.find((s) => s.move === 0.1).pnl).toBeLessThan(0);
  });

  it('suggested contracts never exceed the budget', () => {
    const spent = r.trades.reduce((s, t) => s + t.suggestedContracts * t.costPerContract, 0);
    expect(spent).toBeLessThanOrEqual(budget);
    const weights = Object.values(_internal.TRADE_WEIGHTS).reduce((a, b) => a + b, 0);
    expect(weights).toBeCloseTo(1, 10);
  });

  it('missing chains → no trades, reason reported', () => {
    const e = buildCrashTrades({ asOf: ASOF, chains: [], budget });
    expect(e.trades).toEqual([]);
    expect(e.unavailable.length).toBeGreaterThan(0);
  });

  it('skips untradeable (wide/one-sided) quotes', () => {
    const bad = CHAINS.map((c) => ({ ...c, puts: c.puts.map((p) => ({ ...p, bid: 0 })) }));
    expect(buildCrashTrades({ asOf: ASOF, chains: bad, budget }).trades).toEqual([]);
  });
});

// ─── Portfolio impact / V-bottom / debasement ────────────

describe('portfolioImpact', () => {
  const { trades } = buildCrashTrades({ asOf: ASOF, chains: CHAINS, budget: 10000 });
  const rows = portfolioImpact({ trades, portfolioValue: 500000, equityExposurePct: 0.8 });
  it('hedges reduce the loss in a −30% scenario', () => {
    const r = rows.find((x) => x.move === -0.3);
    expect(r.unhedged).toBe(-120000);
    expect(r.hedged).toBeGreaterThan(r.unhedged);
    expect(r.flagUnhedged).toBe(true);
  });
  it('flat scenario has no drawdown flag', () => {
    expect(rows.find((x) => x.move === 0).flagUnhedged).toBe(false);
  });
});

describe('buildVBottomPlan', () => {
  it('standby in a calm market', () => {
    const phase = computeThesisPhase({ asOf: ASOF, spy: CALM_CRASH.spy });
    const v = buildVBottomPlan({ phase, crash: CALM_CRASH, vixLevel: 15, vixChart: CALM_VOL.chart });
    expect(v.status).toBe('standby');
    expect(v.triggers.find((t) => t.key === 'policy').met).toBeNull();
  });
  it('triggered after a 25% drawdown with VIX rolling over from 45', () => {
    const phase = { drawdownPct: 0.25 };
    const chart = [30, 38, 45, 42, 40, 36, 34, 33, 32, 31].map((vix) => ({ vix }));
    const v = buildVBottomPlan({ phase, crash: { level: 'high', score: 75 }, vixLevel: 31, vixChart: chart });
    expect(v.status).toBe('triggered');
    expect(v.metCount).toBeGreaterThanOrEqual(3);
  });
});

describe('buildDebasementPanel', () => {
  const a = (symbol, above, roc6m, extra = {}) => ({
    symbol, name: symbol, role: symbol, ...extra,
    analysis: { signal: 'bullish', timeSeries: { last: 100, aboveSMA200: above, roc3m: roc6m / 2, roc6m, roc12m: roc6m * 2 } },
  });
  it('confirms when gold and CHF trend up and the dollar trends down', () => {
    const p = buildDebasementPanel([a('GLD', true, 12), a('FXF', true, 4), a('UUP', false, -3, { inverse: true })]);
    expect(p.confirmingCount).toBe(3);
    expect(p.verdict).toMatch(/working/);
  });
  it('mixed when trends disagree; skips insufficient data', () => {
    const p = buildDebasementPanel([a('GLD', false, -2), a('FXF', true, 1), { symbol: 'X', analysis: { insufficientData: true } }]);
    expect(p.rows).toHaveLength(2);
    expect(p.verdict).toMatch(/mixed/);
  });
  it('empty input', () => {
    expect(buildDebasementPanel().verdict).toMatch(/unavailable/);
  });
});

// ─── Underlying selection (SPY / SPX / XSP) ─────────────

describe('UNDERLYINGS / resolveUnderlying', () => {
  it('resolves keys and falls back to SPY', () => {
    expect(resolveUnderlying('spx').symbol).toBe('^SPX');
    expect(resolveUnderlying('xsp').symbol).toBe('^XSP');
    expect(resolveUnderlying('spy').symbol).toBe('SPY');
    expect(resolveUnderlying('bogus').symbol).toBe('SPY');
    expect(resolveUnderlying().symbol).toBe('SPY');
  });
  it('index underlyings are European, cash-settled §1256; SPY is American', () => {
    for (const k of ['spx', 'xsp']) {
      expect(UNDERLYINGS[k].style).toBe('european');
      expect(UNDERLYINGS[k].cashSettled).toBe(true);
      expect(UNDERLYINGS[k].section1256).toBe(true);
    }
    expect(UNDERLYINGS.spy.style).toBe('american');
    expect(UNDERLYINGS.spy.section1256).toBe(false);
  });
});

/** SPX-like chains: ~10× SPY spot and strikes. */
const SPX_SPOT = 7713.5;
function makeSpxChain(exp, { base, skew }) {
  const T = (exp * 1000 - ASOF) / 86400000 / 365;
  const puts = [];
  for (let k = 5800; k <= 8200; k += 50) {
    const iv = Math.max(0.08, base + skew * (1 - k / SPX_SPOT));
    const px = bsPutPrice(SPX_SPOT, k, T, 0.043, 0.013, iv);
    const m = Math.max(px, 0.5);
    puts.push({ strike: k, bid: +(m * 0.995).toFixed(2), ask: +(m * 1.005 + 0.05).toFixed(2), impliedVolatility: iv, openInterest: 5000, volume: 200 });
  }
  return { expirationDate: exp, underlyingPrice: SPX_SPOT, puts, calls: [] };
}
const SPX_CHAINS = [
  makeSpxChain(EXP.dec, { base: 0.123, skew: 0.75 }),
  makeSpxChain(EXP.mar, { base: 0.126, skew: 0.6 }),
  makeSpxChain(EXP.jun, { base: 0.131, skew: 0.48 }),
];

describe('buildCrashTrades on index underlyings', () => {
  const r = buildCrashTrades({ asOf: ASOF, chains: SPX_CHAINS, budget: 20000, underlying: 'spx' });

  it('prices all four structures at index scale', () => {
    expect(r.trades.map((t) => t.key).sort()).toEqual(['calendar', 'diagonal', 'killSwitchPut', 'putSpread']);
    const cal = r.trades.find((t) => t.key === 'calendar');
    expect(cal.legs[0].strike).toBe(cal.legs[1].strike);
    expect(cal.legs[0].strike).toBe(7350); // ~95% of 7713.5
    expect(cal.costPerContract).toBeGreaterThan(5000); // index-scale debit
  });

  it('uses the underlying label and European-style risk text', () => {
    const cal = r.trades.find((t) => t.key === 'calendar');
    expect(cal.maxProfitNote).toMatch(/SPX/);
    expect(cal.risks.join(' ')).toMatch(/no early assignment/i);
  });

  it('empty SPX chains report the underlying name', () => {
    const e = buildCrashTrades({ asOf: ASOF, chains: [], budget: 1000, underlying: 'xsp' });
    expect(e.unavailable[0]).toMatch(/XSP/);
  });
});

describe('buildCrashThesis underlying handling', () => {
  it('echoes the resolved underlying and its dividend yield', () => {
    const r = buildCrashThesis({ asOf: ASOF, chains: SPX_CHAINS, underlying: 'spx', portfolioValue: 500000, hedgeBudgetPct: 0.02 });
    expect(r.underlying.label).toBe('SPX');
    expect(r.underlying.section1256).toBe(true);
    expect(r.assumptions.dividendYield).toBe(0.013);
    expect(r.spot).toBeCloseTo(SPX_SPOT, 1);
  });
  it('defaults to SPY when no underlying is given', () => {
    const r = buildCrashThesis({ asOf: ASOF, chains: CHAINS });
    expect(r.underlying.symbol).toBe('SPY');
    expect(r.assumptions.dividendYield).toBe(0.01);
  });
});

// ─── Crash-target butterflies ────────────────────────────

describe('buildButterflies', () => {
  it('builds symmetric and broken-wing variants when wings exist (10% target)', () => {
    const r = buildButterflies({ asOf: ASOF, chains: CHAINS, targetDecline: 0.10 });
    expect(r.variants.map((v) => v.key)).toEqual(['symFly', 'bwbFly']);
    const fly = r.variants[0];
    expect(fly.legs).toHaveLength(3);
    const sell = fly.legs.find((l) => l.action === 'SELL');
    expect(sell.qty).toBe(2);
    expect(fly.upperStrike).toBeGreaterThan(fly.bodyStrike);
    expect(fly.bodyStrike).toBeGreaterThan(fly.lowerStrike);
    expect(fly.breakevens.upper).toBeLessThan(fly.upperStrike);
    expect(fly.netDebit).toBeGreaterThan(0);
    expect(fly.maxProfit).toBeGreaterThan(fly.maxLoss);
    // scenario P&L is expiry payoff — peaks at the body strike
    const bodyMove = fly.bodyStrike / r.spot - 1;
    const near = fly.scenarios.reduce((b, s) => (Math.abs(s.move - bodyMove) < Math.abs(b.move - bodyMove) ? s : b));
    expect(near.pnl).toBeGreaterThan(0);
  });

  it('skips the symmetric variant when its lower wing is off the board (20% target)', () => {
    const r = buildButterflies({ asOf: ASOF, chains: CHAINS, targetDecline: 0.20 });
    // sym lower (535) is below the fixture's strike range → only BWB survives
    expect(r.variants.map((v) => v.key)).toEqual(['bwbFly']);
    const bwb = r.variants[0];
    expect(bwb.bodyStrike).toBe(615); // ~80% of 771.35
    expect(bwb.tailFloor).not.toBeNull();
    expect(bwb.maxProfitNote).toMatch(/SPY/);
  });

  it('respects an explicit expiry and reports the target price', () => {
    const r = buildButterflies({ asOf: ASOF, chains: CHAINS, targetDecline: 0.10, expiryTs: EXP.jun });
    expect(r.expiryTs).toBe(EXP.jun);
    expect(r.expiryLabel).toBe('2027-06-17');
    expect(r.targetPrice).toBe(694); // 771.35 × 0.9
  });

  it('clamps an extreme target and reports when no strikes bracket it', () => {
    const r = buildButterflies({ asOf: ASOF, chains: CHAINS, targetDecline: 0.9 });
    expect(r.variants).toEqual([]);
    expect(r.unavailable.join(' ')).toMatch(/50%/);
  });

  it('exposes the available expiries and honors the underlying dividend yield', () => {
    const r = buildButterflies({ asOf: ASOF, chains: SPX_CHAINS, underlying: 'spx', targetDecline: 0.20 });
    expect(r.availableExpiries.map((e) => e.ts)).toEqual([EXP.dec, EXP.mar, EXP.jun]);
    expect(r.variants.length).toBeGreaterThanOrEqual(1);
    const v = r.variants[0];
    expect(v.bodyStrike).toBe(6150); // ~80% of 7713.5 → nearest 50-pt strike
    expect(v.maxProfitNote).toMatch(/SPX/);
    expect(v.management.join(' ')).toMatch(/European/);
  });

  it('empty chains → no variants, reason reported', () => {
    const r = buildButterflies({ asOf: ASOF, chains: [] });
    expect(r.variants).toEqual([]);
    expect(r.unavailable.length).toBeGreaterThan(0);
  });
});

// ─── Integration ─────────────────────────────────────────

describe('buildCrashThesis', () => {
  it('assembles the full payload deterministically', () => {
    const p = { asOf: ASOF, crash: CALM_CRASH, volatility: CALM_VOL, chains: CHAINS, portfolioValue: 500000, hedgeBudgetPct: 0.02 };
    const a = buildCrashThesis(p);
    const b = buildCrashThesis(p);
    expect(a).toEqual(b);
    expect(a.thesis).toBe(KARSAN_THESIS);
    expect(a.phase.phase).toBe('pre-window');
    expect(a.headline).toMatch(/Window opens in 38 days/);
    expect(a.headline).toMatch(/Vol is cheap/);
    expect(a.sizing.budget).toBe(10000);
    expect(a.trades).toHaveLength(4);
    expect(a.guard.totalPremium).toBeLessThanOrEqual(10000);
    expect(a.guard.hedgedDrawdownAt30).toBeLessThan(a.guard.unhedgedDrawdownAt30);
  });
  it('clamps invalid sizing inputs', () => {
    const r = buildCrashThesis({ asOf: ASOF, portfolioValue: -5, hedgeBudgetPct: 0.9, equityExposurePct: 9 });
    expect(r.sizing.portfolioValue).toBe(500000);
    expect(r.sizing.hedgeBudgetPct).toBe(0.10);
    expect(r.sizing.equityExposurePct).toBe(1.5);
    expect(r.trades).toEqual([]);
  });
});
