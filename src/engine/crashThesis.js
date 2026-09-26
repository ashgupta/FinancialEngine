/**
 * Crash Thesis Engine — Cem Karsan (Kai Volatility) drawdown/V-bottom playbook.
 *
 * Source: interview with Cem Karsan, https://www.youtube.com/watch?v=DtG925dx2OA
 * (thesis summarized in KARSAN_THESIS below). This engine does NOT endorse or
 * predict the thesis; it operationalizes it so the user can see (a) whether
 * live data is confirming it, (b) what the structures he describes cost
 * today, and (c) the pre-committed exit rules (kill switch, V-bottom flip).
 *
 * Constitution Principle I:   educational framing, scenarios not directives.
 * Constitution Principle II:  pure functions — `asOf` is injected, no I/O.
 * Constitution Principle IV:  every assumption is documented next to its constant.
 * Constitution Principle VII: hedged vs. unhedged portfolio drawdown is
 *                             flagged against the 15% threshold.
 *
 * Pricing: Black-Scholes-Merton (Hull, "Options, Futures, and Other
 * Derivatives", 10th ed., Ch. 15) via leapsAnalyzer.bsCallPrice, with puts
 * from put-call parity. Scenario P&L is an approximation for comparing
 * structures — American early exercise, skew dynamics and fills are ignored.
 */

import { bsCallPrice } from './leapsAnalyzer.js';

// ─── Thesis definition ───────────────────────────────────

export const KARSAN_THESIS = {
  speaker: 'Cem Karsan (Kai Volatility)',
  url: 'https://www.youtube.com/watch?v=DtG925dx2OA',
  // US midterm general election: Tuesday, November 3, 2026.
  midtermDate: '2026-11-03',
  // "Whatever comes should be underway before March. If it has not started
  // by then, you turn long again." — kill switch at end of March.
  killSwitchDate: '2027-03-31',
  // "…finance longer-dated vega out into June."
  vegaTargetDate: '2027-06-18',
  drawdownRange: [0.20, 0.40],
  pillars: [
    { key: 'timing', title: 'Drawdown window', text: 'A 20–40% decline starting after the midterms and clearly underway before the end of March. If nothing has started by then, turn long again.' },
    { key: 'structure', title: 'Own vol via calendars', text: 'Sell nearer-dated premium to finance longer-dated vega out to June — a structure with a built-in kill switch if volatility never shows up.' },
    { key: 'vbottom', title: 'Fast V-bottom', text: 'Aggressive policy response (sovereign wealth fund, equity-supportive QE as in Japan) makes the recovery sharp. The crash is a trade, not a permanent bear market.' },
    { key: 'debasement', title: 'Debasement trade', text: 'Favor gold and Swiss francs; keep cheap long-dated fixed-rate debt (e.g., a 30-year mortgage) as future inflation erodes it.' },
  ],
};

// ─── Model assumptions (documented per Principle IV) ─────

const RISK_FREE = 0.043;      // ~3-month T-bill yield, Sep 2026 (same default as LEAPS tab)
const SPY_DIV_YIELD = 0.01;   // SPY trailing yield ≈1% (same default as Dashboard LEAPS widget)
// Spot-vol beta: IV points gained per 1% index decline. Historical SPX
// selloffs: 2018-Q4 ≈1.1, 2022 ≈0.8, 2020 ≈1.9 (VIX rise ÷ % decline).
// 0.8 is the conservative middle; rallies compress IV by 0.25 pts per 1%.
const VOL_BETA_DOWN = 0.8;
const VOL_BETA_UP = 0.25;
const MIN_IV = 0.08;
// Long-dated IV reacts less than short-dated IV (VIX3M typically moves
// ~50–70% as much as VIX). Shock is damped by √(60 / days remaining),
// clamped to [0.4, 1].
const TERM_DAMPING_REF_DAYS = 60;
const SCENARIO_MOVES = [-0.40, -0.30, -0.20, -0.10, -0.05, 0, 0.05, 0.10];
const MAX_LEG_QUOTE_SPREAD_PCT = 0.20;
const PRINCIPLE_VII_DRAWDOWN = 0.15;
const SOFT_PREMIUM_CAP_PCT = 0.03; // hedge premium above 3% of portfolio/yr is flagged
// Budget split across the four structures (primary = Karsan calendar).
const TRADE_WEIGHTS = { calendar: 0.40, diagonal: 0.25, putSpread: 0.25, killSwitchPut: 0.10 };

const DAY_MS = 86400000;

// ─── Small helpers ───────────────────────────────────────

const toMs = (iso) => Date.parse(`${iso}T00:00:00Z`);
const daysBetween = (fromMs, toMsVal) => Math.round((toMsVal - fromMs) / DAY_MS);
const isoDate = (ms) => new Date(ms).toISOString().slice(0, 10);
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

/** BSM European put via put-call parity. */
export function bsPutPrice(S, K, T, r, q, sigma) {
  if (!(S > 0) || !(K > 0)) return NaN;
  if (T <= 0) return Math.max(0, K - S);
  const call = bsCallPrice(S, K, T, r, q, sigma);
  return call - S * Math.exp(-q * T) + K * Math.exp(-r * T);
}

function tradeable(c) {
  if (!(c?.bid > 0 && c?.ask > 0 && c.ask >= c.bid)) return false;
  const mid = (c.bid + c.ask) / 2;
  return (c.ask - c.bid) / mid <= MAX_LEG_QUOTE_SPREAD_PCT;
}

const mid = (c) => (c.bid + c.ask) / 2;

/** Nearest tradeable put to a target strike. */
function pickPut(chain, target) {
  const puts = (chain?.puts || []).filter(tradeable);
  if (puts.length === 0) return null;
  return puts.reduce((b, p) => (Math.abs(p.strike - target) < Math.abs(b.strike - target) ? p : b));
}

/** Nearest strike to `target` that is tradeable in BOTH chains (for calendars). */
function pickCommonPut(chainA, chainB, target) {
  const bByStrike = new Map((chainB?.puts || []).filter(tradeable).map((p) => [p.strike, p]));
  const common = (chainA?.puts || []).filter((p) => tradeable(p) && bByStrike.has(p.strike));
  if (common.length === 0) return null;
  const a = common.reduce((b, p) => (Math.abs(p.strike - target) < Math.abs(b.strike - target) ? p : b));
  return { a, b: bByStrike.get(a.strike) };
}

/** Pick the expiry (seconds) closest to a target date, optionally bounded. */
export function pickExpiry(expirations, targetMs, { minMs = -Infinity, maxMs = Infinity } = {}) {
  const inRange = (expirations || []).filter((e) => e * 1000 >= minMs && e * 1000 <= maxMs);
  if (inRange.length === 0) return null;
  return inRange.reduce((b, e) => (Math.abs(e * 1000 - targetMs) < Math.abs(b * 1000 - targetMs) ? e : b));
}

function legOf(action, contract, chain, asOf) {
  const dte = daysBetween(asOf, chain.expirationDate * 1000);
  return {
    action,
    type: 'PUT',
    strike: contract.strike,
    expiry: chain.expirationDate,
    expiryLabel: isoDate(chain.expirationDate * 1000),
    dte,
    bid: contract.bid,
    ask: contract.ask,
    mid: +mid(contract).toFixed(2),
    iv: contract.impliedVolatility > 0 ? contract.impliedVolatility : null,
  };
}

// ─── Scenario valuation ──────────────────────────────────

/** Scenario IV for a leg after an index move, with term damping. */
export function shockedIv(baseIv, move, daysRemaining) {
  const damp = clamp(Math.sqrt(TERM_DAMPING_REF_DAYS / Math.max(daysRemaining, 1)), 0.4, 1);
  const pts = move < 0 ? -move * 100 * VOL_BETA_DOWN : -move * 100 * VOL_BETA_UP;
  return Math.max(MIN_IV, baseIv + (pts / 100) * damp);
}

/**
 * P&L per contract of a multi-leg put position at a horizon, for each move.
 * @param {object[]} legs   legOf() objects (BUY/SELL puts)
 * @param {number} spot
 * @param {number} horizonDays days from asOf to evaluation date
 * @param {number[]} [moves]
 */
export function scenarioPnl(legs, spot, horizonDays, moves = SCENARIO_MOVES) {
  const entry = legs.reduce((s, l) => s + (l.action === 'BUY' ? l.mid : -l.mid), 0);
  return moves.map((move) => {
    const S = spot * (1 + move);
    const value = legs.reduce((s, l) => {
      const remaining = l.dte - horizonDays;
      const iv = shockedIv(l.iv ?? 0.2, move, remaining);
      const px = bsPutPrice(S, l.strike, Math.max(remaining, 0) / 365, RISK_FREE, SPY_DIV_YIELD, iv);
      return s + (l.action === 'BUY' ? px : -px);
    }, 0);
    return { move, spot: +S.toFixed(2), pnl: +((value - entry) * 100).toFixed(0) };
  });
}

// ─── Phase / timeline ────────────────────────────────────

const PHASES = {
  'pre-window':   { label: 'Pre-window',            tone: 'blue',    action: 'Build the position while vol is cheap; the thesis window opens after the midterms.' },
  'window-open':  { label: 'Window open',           tone: 'yellow',  action: 'Hold the calendar; roll the short leg each cycle. Watch for trend breaks — no confirmation yet.' },
  'underway':     { label: 'Drawdown underway',     tone: 'orange',  action: 'Thesis confirming: keep long vega, stop selling new near-dated puts against it, scale profits into strength of VIX.' },
  'capitulation': { label: 'Capitulation / V-watch',tone: 'red',     action: 'Monetize puts in tranches and arm the V-bottom long plan (deep-ITM LEAPS).' },
  'kill-switch':  { label: 'Kill switch hit',       tone: 'emerald', action: 'Nothing started by end of March: close remaining hedges and turn long, per Karsan.' },
};

/**
 * Determine where we are in the thesis timeline.
 * @param {object} p
 * @param {number} p.asOf  epoch ms
 * @param {{level?:string}} [p.crash]
 * @param {{last?:number, sma200?:number, high52w?:number}} [p.spy]
 * @param {number|null} [p.vixLevel]
 * @param {object} [p.thesis]
 */
export function computeThesisPhase({ asOf, crash = null, spy = null, vixLevel = null, thesis = KARSAN_THESIS }) {
  const midtermMs = toMs(thesis.midtermDate);
  const kill = toMs(thesis.killSwitchDate);
  const vega = toMs(thesis.vegaTargetDate);
  const drawdown = spy?.high52w > 0 && spy?.last > 0 ? (spy.high52w - spy.last) / spy.high52w : null;
  const belowTrend = spy?.last > 0 && spy?.sma200 > 0 ? spy.last < spy.sma200 : null;
  const stressed = ['elevated', 'high', 'severe'].includes(crash?.level);
  const extreme = ['high', 'severe'].includes(crash?.level);

  let phase;
  if (drawdown != null && drawdown >= thesis.drawdownRange[0] && ((vixLevel ?? 0) >= 30 || extreme)) phase = 'capitulation';
  else if ((drawdown != null && drawdown >= 0.10) || (belowTrend && stressed)) phase = 'underway';
  else if (asOf < midtermMs) phase = 'pre-window';
  else if (asOf <= kill) phase = 'window-open';
  else phase = 'kill-switch';

  const windowLen = kill - midtermMs;
  const windowProgressPct = clamp(((asOf - midtermMs) / windowLen) * 100, 0, 100);

  return {
    phase,
    ...PHASES[phase],
    drawdownPct: drawdown,
    belowTrend,
    daysToMidterms: daysBetween(asOf, midtermMs),
    daysToKillSwitch: daysBetween(asOf, kill),
    daysToVegaTarget: daysBetween(asOf, vega),
    windowProgressPct: +windowProgressPct.toFixed(1),
    milestones: [
      { key: 'today', label: 'Today', date: isoDate(asOf) },
      { key: 'midterms', label: 'Midterms — window opens', date: thesis.midtermDate },
      { key: 'kill', label: 'Kill switch — turn long if nothing started', date: thesis.killSwitchDate },
      { key: 'vega', label: 'Long-vega expiry target (June)', date: thesis.vegaTargetDate },
    ],
  };
}

// ─── IV term structure from chains ───────────────────────

/**
 * ATM / 95% / 90% put IV per expiry — shows whether near-dated OTM puts are
 * rich relative to long-dated ones (the edge a put calendar harvests).
 * @param {object[]} chains  [{expirationDate, puts, underlyingPrice}]
 * @param {number} asOf
 */
export function buildTermIv(chains, asOf) {
  return (chains || [])
    .filter((c) => c?.puts?.length && c.underlyingPrice > 0)
    .map((c) => {
      const spot = c.underlyingPrice;
      const ivAt = (pct) => {
        const p = pickPut(c, spot * pct);
        return p && p.impliedVolatility > 0 ? +p.impliedVolatility.toFixed(4) : null;
      };
      return {
        expiry: c.expirationDate,
        expiryLabel: isoDate(c.expirationDate * 1000),
        dte: daysBetween(asOf, c.expirationDate * 1000),
        atmIv: ivAt(1.0),
        iv95: ivAt(0.95),
        iv90: ivAt(0.90),
      };
    })
    .sort((a, b) => a.dte - b.dte);
}

// ─── Scorecard ───────────────────────────────────────────

/**
 * Compare live data to the conditions the thesis relies on.
 * status: 'supports' | 'neutral' | 'against'
 */
export function buildScorecard({ crash = null, volatility = null, spy = null, termIv = [] }) {
  const checks = [];
  const factor = (k) => crash?.factors?.find((f) => f.key === k) || null;
  const vix = volatility?.vixLevel ?? null;

  if (vix != null) {
    checks.push({
      key: 'volCheap', label: 'Volatility is cheap to own',
      status: vix < 16 ? 'supports' : vix <= 22 ? 'neutral' : 'against',
      detail: `VIX ${vix.toFixed(1)} — ${vix < 16 ? 'cheap long vega, ideal entry for calendars' : vix <= 22 ? 'fairly priced' : 'vol already bid; calendars cost more and crash may be priced in'}`,
    });
  }

  const near = termIv.find((t) => t.dte >= 30 && t.iv90 != null);
  const far = [...termIv].reverse().find((t) => t.iv90 != null);
  if (near && far && near !== far) {
    const edge = near.iv90 - far.iv90;
    checks.push({
      key: 'skewEdge', label: 'Near OTM puts rich vs long-dated',
      status: edge > 0.005 ? 'supports' : edge < -0.02 ? 'against' : 'neutral',
      detail: `90% put IV ${(near.iv90 * 100).toFixed(1)}% (${near.expiryLabel}) vs ${(far.iv90 * 100).toFixed(1)}% (${far.expiryLabel}) — ${edge > 0.005 ? 'selling near/buying far captures the skew' : 'little skew edge for the calendar'}`,
    });
  }

  const ts = volatility?.termStructure;
  if (ts && (ts.vix3m != null || ts.vx1 != null)) {
    checks.push({
      key: 'curve', label: 'VIX curve stress',
      status: ts.backwardation ? 'supports' : 'neutral',
      detail: ts.backwardation ? `${ts.label} — hedging demand building` : `${ts.label} — no stress yet (expected before the window)`,
    });
  }

  const cot = factor('cotPositioning');
  if (cot?.score != null) {
    checks.push({
      key: 'cot', label: 'Smart money de-risking (COT)',
      status: cot.score >= 60 ? 'supports' : cot.score <= 40 ? 'against' : 'neutral',
      detail: cot.note,
    });
  }

  if (spy?.last > 0 && spy?.sma200 > 0) {
    const pct = ((spy.last - spy.sma200) / spy.sma200) * 100;
    checks.push({
      key: 'trend', label: 'SPY trend broken',
      status: pct < 0 ? 'supports' : pct < 3 ? 'neutral' : 'against',
      detail: `SPY ${pct >= 0 ? '+' : ''}${pct.toFixed(1)}% vs 200-DMA — ${pct < 0 ? 'trend broken' : 'uptrend intact; thesis unconfirmed by price'}`,
    });
  }

  const breadth = factor('breadth');
  if (breadth?.score != null) {
    checks.push({
      key: 'breadth', label: 'Breadth deteriorating',
      status: breadth.score >= 50 ? 'supports' : breadth.score >= 25 ? 'neutral' : 'against',
      detail: breadth.note,
    });
  }

  if (crash?.score != null) {
    checks.push({
      key: 'composite', label: 'Composite Crash Radar',
      status: ['elevated', 'high', 'severe'].includes(crash.level) ? 'supports' : crash.level === 'watch' ? 'neutral' : 'against',
      detail: `${crash.label || crash.level} ${crash.score.toFixed(0)}/100`,
    });
  }

  const supportCount = checks.filter((c) => c.status === 'supports').length;
  const againstCount = checks.filter((c) => c.status === 'against').length;
  // Cheap vol + skew are ENTRY conditions, not confirmation; separate them.
  const confirmKeys = ['curve', 'cot', 'trend', 'breadth', 'composite'];
  const confirming = checks.filter((c) => confirmKeys.includes(c.key) && c.status === 'supports').length;
  let verdict;
  if (confirming >= 3) verdict = 'Market data is confirming the drawdown thesis.';
  else if (confirming >= 1) verdict = 'Early warning signs only — thesis not yet confirmed by price.';
  else verdict = 'No confirmation yet — the thesis is a timing call, not something the data shows today.';

  return { checks, supportCount, againstCount, confirming, verdict };
}

// ─── Trade construction ──────────────────────────────────

/**
 * Build the four Karsan-style structures from live SPY chains.
 * @param {object} p
 * @param {number} p.asOf
 * @param {object[]} p.chains      SPY chains for several expiries
 * @param {number} p.budget        total hedge budget in $
 * @param {object} [p.thesis]
 */
export function buildCrashTrades({ asOf, chains = [], budget = 0, thesis = KARSAN_THESIS }) {
  const byExp = new Map(chains.filter((c) => c?.expirationDate).map((c) => [c.expirationDate, c]));
  const exps = [...byExp.keys()];
  const unavailable = [];
  if (exps.length === 0) return { trades: [], unavailable: ['No SPY option chains available'], horizon: null };

  const midtermMs = toMs(thesis.midtermDate);
  // Front leg: first standard cycle that settles after the election (~6 weeks out).
  const frontExp = pickExpiry(exps, midtermMs + 45 * DAY_MS, { minMs: midtermMs + 7 * DAY_MS, maxMs: toMs(thesis.killSwitchDate) });
  const marchExp = pickExpiry(exps, toMs(thesis.killSwitchDate) - 12 * DAY_MS, { minMs: midtermMs, maxMs: toMs(thesis.killSwitchDate) + 21 * DAY_MS });
  const juneExp = pickExpiry(exps, toMs(thesis.vegaTargetDate), { minMs: toMs(thesis.killSwitchDate) + 30 * DAY_MS });
  const front = frontExp ? byExp.get(frontExp) : null;
  const march = marchExp ? byExp.get(marchExp) : null;
  const june = juneExp ? byExp.get(juneExp) : null;
  const spot = (june || front || march)?.underlyingPrice;
  if (!spot) return { trades: [], unavailable: ['Underlying price unavailable'], horizon: null };

  const horizonDays = front ? daysBetween(asOf, front.expirationDate * 1000) : 60;
  const trades = [];

  const finalize = (t, legs, extra = {}) => {
    const netDebit = legs.reduce((s, l) => s + (l.action === 'BUY' ? l.mid : -l.mid), 0);
    if (!(netDebit > 0)) { unavailable.push(`${t.name}: no net-debit structure at current quotes`); return; }
    const costPerContract = +(netDebit * 100).toFixed(0);
    const allocated = budget * (TRADE_WEIGHTS[t.key] || 0);
    const suggestedContracts = costPerContract > 0 ? Math.floor(allocated / costPerContract) : 0;
    const scenarios = scenarioPnl(legs, spot, horizonDays);
    const at = (m) => scenarios.find((s) => s.move === m)?.pnl ?? null;
    trades.push({
      ...t,
      legs,
      netDebit: +netDebit.toFixed(2),
      costPerContract,
      maxLoss: costPerContract,
      weight: TRADE_WEIGHTS[t.key] || 0,
      allocated: +allocated.toFixed(0),
      suggestedContracts,
      notionalHedged: +(suggestedContracts * 100 * spot).toFixed(0),
      scenarios,
      pnlAtMinus20: at(-0.20),
      pnlAtMinus30: at(-0.30),
      pnlFlat: at(0),
      bestScenario: scenarios.reduce((b, s) => (s.pnl > b.pnl ? s : b), scenarios[0]),
      ...extra,
    });
  };

  // A. Karsan core: put calendar at ~95% of spot
  if (front && june) {
    const pair = pickCommonPut(june, front, spot * 0.95);
    if (pair) {
      const legs = [legOf('SELL', pair.b, front, asOf), legOf('BUY', pair.a, june, asOf)];
      const ivEdge = legs[0].iv != null && legs[1].iv != null ? +(legs[0].iv - legs[1].iv).toFixed(4) : null;
      finalize({
        key: 'calendar',
        name: 'Put calendar (Karsan core)',
        tagline: 'Sell the post-midterm put, own June vega at the same strike',
        karsanFit: 'Exactly the structure described: near-dated premium finances longer-dated vega out to June, with a natural kill switch.',
        maxProfitNote: 'Peaks if SPY sits near the strike at the front expiry while IV rises; loses if SPY rallies hard or crashes straight through the strike early.',
        management: [
          `At ${legs[0].expiryLabel}, sell the next monthly put at the same or lower strike to keep financing the June leg.`,
          'Stop rolling new short puts once the drawdown is underway — let the long June put run.',
          `Kill switch: if no drawdown has started by ${thesis.killSwitchDate}, close the June put and turn long.`,
        ],
        risks: ['Short put can be assigned early if deep ITM', 'Sharp rally decays the June put', 'IV collapse hurts the long vega leg'],
      }, legs, { ivEdge });
    } else unavailable.push('Put calendar: no common tradeable strike in both expiries');
  } else unavailable.push('Put calendar: missing post-midterm or June expiry');

  // B. Put diagonal: long June 95%, short front 90%
  if (front && june) {
    const long = pickPut(june, spot * 0.95);
    const short = pickPut(front, spot * 0.90);
    if (long && short && short.strike < long.strike) {
      const legs = [legOf('BUY', long, june, asOf), legOf('SELL', short, front, asOf)];
      const ivEdge = legs[1].iv != null && legs[0].iv != null ? +(legs[1].iv - legs[0].iv).toFixed(4) : null;
      finalize({
        key: 'diagonal',
        name: 'Put diagonal',
        tagline: 'Own June 95% put, sell richer front 90% put',
        karsanFit: 'Same financing idea, but the lower short strike leaves room for a real 20–40% decline to pay out.',
        maxProfitNote: 'Gains accelerate below the short strike only after the front leg expires; max loss is the net debit because the long put covers the lower short put.',
        management: [
          'Roll the short put monthly to a strike ~10% below spot to keep harvesting the skew.',
          `Kill switch: close by ${thesis.killSwitchDate} if the thesis has not started.`,
        ],
        risks: ['Rally decays the long put', 'Short leg adds negative gamma near its strike'],
      }, legs, { ivEdge });
    } else unavailable.push('Put diagonal: no suitable strikes');
  }

  // C. June bear put spread 95/80 — defined payoff sized for a 20% decline
  if (june) {
    const long = pickPut(june, spot * 0.95);
    const short = pickPut(june, spot * 0.80);
    if (long && short && short.strike < long.strike) {
      const legs = [legOf('BUY', long, june, asOf), legOf('SELL', short, june, asOf)];
      const width = long.strike - short.strike;
      finalize({
        key: 'putSpread',
        name: 'June crash put spread',
        tagline: 'Defined payoff for a 5–20% decline by June',
        karsanFit: 'Monetizes the drawdown directly at expiry; cheaper than an outright put because it caps the payoff at a 20% decline.',
        maxProfitNote: `Max profit $${((width - (mid(long) - mid(short))) * 100).toFixed(0)} per contract if SPY ≤ $${short.strike} at expiry.`,
        management: ['Take profits early if SPY reaches the short strike before June — most of the value is captured.', `Close by ${thesis.killSwitchDate} if no drawdown has started.`],
        risks: ['Payoff capped below the short strike', 'Loses the full debit if SPY finishes above the long strike'],
      }, legs, { maxProfit: +((width - (mid(long) - mid(short))) * 100).toFixed(0) });
    }
  }

  // D. Kill-switch put: March 90% put expiring at the deadline
  if (march) {
    const long = pickPut(march, spot * 0.90);
    if (long) {
      const legs = [legOf('BUY', long, march, asOf)];
      finalize({
        key: 'killSwitchPut',
        name: 'Kill-switch put (March)',
        tagline: 'Outright put that expires on Karsan’s deadline',
        karsanFit: 'The simplest expression of the timing rule: it pays in a crash before March and simply expires if nothing happens.',
        maxProfitNote: 'Convex: payoff grows the further SPY falls below the strike before expiry.',
        management: ['No rolling needed — expiry enforces the kill switch.', 'Sell into VIX spikes rather than holding to expiry.'],
        risks: ['Loses 100% of premium if SPY stays above the strike', 'Theta accelerates in the final 60 days'],
      }, legs);
    }
  }

  return {
    trades,
    unavailable,
    spot,
    horizon: front ? { days: horizonDays, date: isoDate(front.expirationDate * 1000) } : { days: horizonDays, date: null },
  };
}

// ─── Portfolio impact (Principle VII) ────────────────────

export function portfolioImpact({ trades, portfolioValue, equityExposurePct }) {
  const exposure = portfolioValue * equityExposurePct;
  const byMove = new Map();
  for (const t of trades) {
    for (const s of t.scenarios) {
      byMove.set(s.move, (byMove.get(s.move) || 0) + s.pnl * t.suggestedContracts);
    }
  }
  return SCENARIO_MOVES.map((move) => {
    const unhedged = exposure * move;
    const hedgePnl = byMove.get(move) || 0;
    const hedged = unhedged + hedgePnl;
    return {
      move,
      unhedged: +unhedged.toFixed(0),
      hedgePnl: +hedgePnl.toFixed(0),
      hedged: +hedged.toFixed(0),
      unhedgedPct: portfolioValue > 0 ? unhedged / portfolioValue : 0,
      hedgedPct: portfolioValue > 0 ? hedged / portfolioValue : 0,
      flagUnhedged: portfolioValue > 0 && -unhedged / portfolioValue > PRINCIPLE_VII_DRAWDOWN,
      flagHedged: portfolioValue > 0 && -hedged / portfolioValue > PRINCIPLE_VII_DRAWDOWN,
    };
  });
}

// ─── V-bottom plan ───────────────────────────────────────

export function buildVBottomPlan({ phase, crash = null, vixLevel = null, vixChart = [] }) {
  const recent = (vixChart || []).slice(-10).map((p) => p.vix).filter((v) => v != null);
  const peak = recent.length ? Math.max(...recent) : null;
  const rollingOver = peak != null && vixLevel != null && peak >= 30 && vixLevel <= peak * 0.8;
  const dd = phase?.drawdownPct ?? null;

  const triggers = [
    { key: 'drawdown', label: 'SPY down ≥ 20% from its high', met: dd != null && dd >= 0.20, detail: dd != null ? `Currently ${(dd * 100).toFixed(1)}% below the 52-week high` : 'Drawdown unavailable' },
    { key: 'vixSpike', label: 'VIX ≥ 30 (panic)', met: vixLevel != null && vixLevel >= 30, detail: vixLevel != null ? `VIX ${vixLevel.toFixed(1)}` : 'VIX unavailable' },
    { key: 'vixRollover', label: 'VIX rolling over (≥20% off a 30+ peak)', met: rollingOver, detail: peak != null ? `10-day VIX peak ${peak.toFixed(1)}` : 'VIX history unavailable' },
    { key: 'crashLevel', label: 'Crash Radar High/Severe', met: ['high', 'severe'].includes(crash?.level), detail: crash ? `${crash.label || crash.level} ${crash.score?.toFixed(0)}/100` : 'Crash Radar unavailable' },
    { key: 'policy', label: 'Policy response (sovereign wealth fund / equity QE)', met: null, detail: 'Manual check — watch Treasury/Fed announcements' },
  ];
  const metCount = triggers.filter((t) => t.met === true).length;
  let status;
  if (triggers[0].met && rollingOver) status = 'triggered';
  else if (metCount >= 2) status = 'arming';
  else status = 'standby';

  return {
    status,
    metCount,
    triggers,
    actions: [
      'Take profits on long puts in thirds: at −20%, at −30%, and when VIX rolls over.',
      'Redeploy proceeds into deep-ITM (~0.80Δ) SPY/QQQ LEAPS calls for leveraged exposure to the V — see the LEAPS Analyzer tab.',
      'Ladder entries rather than calling the exact low; policy-driven bottoms are fast.',
      'Once the V is confirmed (SPY back above its 50-DMA), stop hedging and let the long exposure run.',
    ],
  };
}

// ─── Debasement panel ────────────────────────────────────

/**
 * @param {{symbol:string, name:string, role:string, inverse?:boolean, analysis:object}[]} assets
 *   analysis = momentumEngine.analyzeAsset() output
 */
export function buildDebasementPanel(assets = []) {
  const rows = assets.filter((a) => a?.analysis && !a.analysis.insufficientData).map((a) => {
    const ts = a.analysis.timeSeries || {};
    const trendUp = ts.aboveSMA200 === true && (ts.roc6m ?? 0) > 0;
    const confirming = a.inverse ? !trendUp && (ts.roc6m ?? 0) < 0 : trendUp;
    return {
      symbol: a.symbol,
      name: a.name,
      role: a.role,
      inverse: !!a.inverse,
      last: ts.last ?? null,
      aboveSMA200: ts.aboveSMA200 ?? null,
      roc3m: ts.roc3m ?? null,
      roc6m: ts.roc6m ?? null,
      roc12m: ts.roc12m ?? null,
      signal: a.analysis.signal,
      confirming,
    };
  });
  const confirmingCount = rows.filter((r) => r.confirming).length;
  return {
    rows,
    confirmingCount,
    verdict: rows.length === 0
      ? 'Debasement data unavailable.'
      : confirmingCount > rows.length / 2
        ? 'Debasement trade is working: hard/alternative currencies are trending up.'
        : 'Debasement trade is mixed — trends are not confirming yet.',
    notes: [
      'Scenario, not a directive: a 5–10% combined sleeve in gold (GLD/IAU) and Swiss francs (FXF) is a common way to express this view.',
      'Long-dated fixed-rate debt (e.g., a 30-year mortgage) is effectively short the dollar — inflation erodes the real balance. Paying it down early gives up that hedge.',
      'Avoid options on FXF (thin liquidity); use shares.',
    ],
  };
}

// ─── Main entry point ────────────────────────────────────

/**
 * Build the full crash-thesis payload.
 * @param {object} p
 * @param {number} p.asOf                     epoch ms (injected for determinism)
 * @param {object} [p.crash]                  /crash/scan payload (incl. .spy)
 * @param {object} [p.volatility]             volatility analysis (vixLevel, termStructure, chart)
 * @param {object[]} [p.chains]               SPY option chains (several expiries)
 * @param {object[]} [p.debasementAssets]     see buildDebasementPanel
 * @param {number} [p.portfolioValue=500000]
 * @param {number} [p.hedgeBudgetPct=0.02]    annual hedge budget as fraction of portfolio (0–0.10)
 * @param {number} [p.equityExposurePct=0.8]  fraction of portfolio in equities (0–1.5)
 */
export function buildCrashThesis(p = {}) {
  const asOf = Number.isFinite(p.asOf) ? p.asOf : 0;
  const portfolioValue = Number.isFinite(p.portfolioValue) && p.portfolioValue > 0 ? p.portfolioValue : 500000;
  const hedgeBudgetPct = Number.isFinite(p.hedgeBudgetPct) ? clamp(p.hedgeBudgetPct, 0, 0.10) : 0.02;
  const equityExposurePct = Number.isFinite(p.equityExposurePct) ? clamp(p.equityExposurePct, 0, 1.5) : 0.8;
  const budget = portfolioValue * hedgeBudgetPct;
  const crash = p.crash || null;
  const volatility = p.volatility || null;
  const spy = crash?.spy || null;

  const phase = computeThesisPhase({ asOf, crash, spy, vixLevel: volatility?.vixLevel ?? null });
  const termIv = buildTermIv(p.chains, asOf);
  const scorecard = buildScorecard({ crash, volatility, spy, termIv });
  const { trades, unavailable, horizon, spot } = buildCrashTrades({ asOf, chains: p.chains, budget });
  const impact = portfolioImpact({ trades, portfolioValue, equityExposurePct });
  const totalPremium = trades.reduce((s, t) => s + t.suggestedContracts * t.costPerContract, 0);
  const vBottom = buildVBottomPlan({ phase, crash, vixLevel: volatility?.vixLevel ?? null, vixChart: volatility?.chart });
  const debasement = buildDebasementPanel(p.debasementAssets);

  const worst = impact.find((r) => r.move === -0.30);
  const guard = {
    totalPremium,
    premiumPctOfPortfolio: portfolioValue > 0 ? totalPremium / portfolioValue : 0,
    premiumFlag: portfolioValue > 0 && totalPremium / portfolioValue > SOFT_PREMIUM_CAP_PCT,
    unhedgedDrawdownAt30: worst ? -worst.unhedgedPct : null,
    hedgedDrawdownAt30: worst ? -worst.hedgedPct : null,
    flag: worst ? worst.flagHedged : false,
    note: worst
      ? `In a −30% scenario the portfolio falls ${(-worst.unhedgedPct * 100).toFixed(1)}% unhedged vs ${(-worst.hedgedPct * 100).toFixed(1)}% with the suggested hedges${worst.flagHedged ? ' — still above the 15% drawdown guard; consider a larger budget or lower equity exposure.' : ' — within the 15% drawdown guard.'}`
      : 'Portfolio impact unavailable.',
  };

  const vix = volatility?.vixLevel;
  const headline = [
    phase.phase === 'pre-window'
      ? `Window opens in ${phase.daysToMidterms} days (midterms ${KARSAN_THESIS.midtermDate}); kill switch in ${phase.daysToKillSwitch} days.`
      : `${phase.label}. Kill switch ${phase.daysToKillSwitch >= 0 ? `in ${phase.daysToKillSwitch} days` : 'has passed'}.`,
    crash?.score != null ? `Crash Radar ${crash.label || crash.level} ${crash.score.toFixed(0)}/100.` : null,
    scorecard.verdict,
    vix != null && vix < 16 ? `Vol is cheap (VIX ${vix.toFixed(1)}), which favors building the calendar now rather than after stress arrives.` : null,
  ].filter(Boolean).join(' ');

  return {
    thesis: KARSAN_THESIS,
    asOf: new Date(asOf).toISOString(),
    headline,
    phase,
    scorecard,
    termIv,
    spot: spot ?? null,
    horizon,
    trades,
    unavailable,
    sizing: { portfolioValue, hedgeBudgetPct, budget, equityExposurePct },
    portfolioImpact: impact,
    guard,
    vBottom,
    debasement,
    assumptions: {
      riskFree: RISK_FREE,
      dividendYield: SPY_DIV_YIELD,
      volBetaDown: VOL_BETA_DOWN,
      volBetaUp: VOL_BETA_UP,
      note: 'Scenario P&L uses Black-Scholes with a spot-vol shock of +0.8 IV pts per 1% decline (damped for long-dated legs). Approximation for comparing structures, not a price forecast.',
    },
  };
}

export const _internal = { tradeable, pickPut, pickCommonPut, TRADE_WEIGHTS, SCENARIO_MOVES, PHASES };
