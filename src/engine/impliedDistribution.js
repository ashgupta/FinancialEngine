/**
 * Options-implied (risk-neutral) price distribution — Breeden & Litzenberger.
 *
 * The option chain prices every point of the outcome distribution, not just
 * its mean: the second derivative of the call price with respect to strike is
 * the discounted probability density of the underlying at expiry
 *   f(K) = e^{rT} · ∂²C/∂K²
 * (Breeden & Litzenberger, "Prices of State-Contingent Claims Implicit in
 * Option Prices", Journal of Business 51(4), 1978). Two stocks with the same
 * price and ATM vol can carry very different tails — that shape is what this
 * module extracts so every options trade in the app can be judged against
 * what the market is actually pricing (fat crash tail, lottery-ticket upside…)
 * instead of a single-vol lognormal bell curve.
 *
 * Method (single expiry):
 *   1. Mid prices from two-sided quotes; very wide quotes are discarded.
 *   2. Forward from put-call parity near the money (captures dividends);
 *      falls back to spot·e^{(r−q)T} when no call/put pair is quoted.
 *   3. OTM options (puts below F, calls above) → Black-76 implied vols.
 *   4. Weighted quadratic smile in log-moneyness, extended along its tangent
 *      beyond the last strike. Smoothing is required: raw mids are too noisy
 *      to differentiate twice.
 *   5. Call prices on a fine strike grid → numerical second derivative →
 *      density (clipped at 0, renormalised), CDF by trapezoid rule.
 *
 * Constitution Principle II: pure functions, no I/O.
 * Constitution Principle IV: every threshold documented next to its constant.
 * Constitution Principle I: these are RISK-NEUTRAL probabilities (prices, not
 * forecasts). They embed risk premia — investors overpay for crash
 * protection — so real-world crash odds are usually lower than the left tail.
 */

// ─── Constants ───────────────────────────────────────────

const DEFAULT_RATE = 0.043;          // ~3-month T-bill, Nov 2026 (matches leapsAnalyzer default)
const MAX_REL_QUOTE_WIDTH = 0.6;     // (ask−bid)/mid above this → quote is noise, skip
const MIN_MID = 0.05;                // sub-nickel mids sit at the minimum tick — their IVs are noise
const MIN_STRIKES = 5;               // fewer usable strikes → no distribution
const GOOD_STRIKES = 8;              // ≥8 strikes on both sides of F → 'good' quality
const IV_BOUNDS = [0.02, 4];         // reject solver results outside this band
const MIN_SMILE_IV = 0.02;
const WING_FLOOR = 0.5;             // extrapolated wing vol never falls below 50% of the last quoted strike's vol
const GRID_STDEVS = 5;               // grid spans F·e^{±5σ√T}
const DEFAULT_GRID = 401;
const PARITY_STRIKES = 4;            // strikes nearest spot used for the parity forward
// Shape classification (see classifyShape). Ratios compare the implied tail
// probability with a lognormal at the same forward and ATM vol.
const LOTTERY_IV = 0.70;             // ≥70% ATM vol: outcome range dominates (e.g. MRNA ~90%)
const NARROW_IV = 0.25;              // <25% ATM vol: low-drama distribution
const LEFT_TAIL_RATIO = 1.4;         // P(≤−30%) ≥ 1.4× lognormal → market paying up for crash risk
const RIGHT_TAIL_RATIO = 1.25;       // P(≥+30%) ≥ 1.25× lognormal → upside priced rich
const MIN_TAIL_PROB = 0.02;          // ignore ratio signals on negligible tails

// ─── Math helpers ────────────────────────────────────────

/** Abramowitz & Stegun 7.1.26, |error| < 1.5e-7. */
function erf(x) {
  const t = 1 / (1 + 0.3275911 * Math.abs(x));
  const y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x);
  return x < 0 ? -y : y;
}
const normCdf = (z) => 0.5 * (1 + erf(z / Math.SQRT2));

/**
 * Black-76 option price on a forward (Hull, Options, Futures & Other Derivatives, 10th ed., §18.8).
 * @returns {number} discounted price, NaN on invalid input
 */
export function black76(F, K, T, sigma, isCall, r = DEFAULT_RATE) {
  if (!(F > 0) || !(K > 0) || !Number.isFinite(T) || !Number.isFinite(sigma)) return NaN;
  const df = Math.exp(-r * Math.max(T, 0));
  if (T <= 0 || sigma <= 0) return df * Math.max(0, isCall ? F - K : K - F);
  const sd = sigma * Math.sqrt(T);
  const d1 = (Math.log(F / K) + 0.5 * sd * sd) / sd;
  const d2 = d1 - sd;
  return isCall ? df * (F * normCdf(d1) - K * normCdf(d2)) : df * (K * normCdf(-d2) - F * normCdf(-d1));
}

function impliedVol(price, F, K, T, isCall, r) {
  const intrinsic = Math.exp(-r * T) * Math.max(0, isCall ? F - K : K - F);
  if (!(price > intrinsic + 1e-8)) return null;
  let lo = 1e-4;
  let hi = 5;
  if (black76(F, K, T, hi, isCall, r) < price) return null;
  for (let i = 0; i < 80; i++) {
    const m = 0.5 * (lo + hi);
    if (black76(F, K, T, m, isCall, r) > price) hi = m; else lo = m;
  }
  const v = 0.5 * (lo + hi);
  return v >= IV_BOUNDS[0] && v <= IV_BOUNDS[1] ? v : null;
}

const quoteMid = (c) => {
  const bid = c?.bid ?? 0;
  const ask = c?.ask ?? 0;
  if (!(bid > 0) || !(ask >= bid)) return null;
  const mid = 0.5 * (bid + ask);
  if (mid < MIN_MID) return null;
  return (ask - bid) / mid <= MAX_REL_QUOTE_WIDTH ? mid : null;
};

/** Solve a small dense linear system (Gaussian elimination, partial pivot). */
function solve(A, b) {
  const n = b.length;
  const M = A.map((row, i) => [...row, b[i]]);
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let i = c + 1; i < n; i++) if (Math.abs(M[i][c]) > Math.abs(M[p][c])) p = i;
    if (Math.abs(M[p][c]) < 1e-12) return null;
    [M[c], M[p]] = [M[p], M[c]];
    for (let i = 0; i < n; i++) {
      if (i === c) continue;
      const f = M[i][c] / M[c][c];
      for (let j = c; j <= n; j++) M[i][j] -= f * M[c][j];
    }
  }
  return M.map((row, i) => row[n] / row[i]);
}

/** Weighted polynomial least squares; degrades to lower degree when singular. */
function fitSmile(xs, ys, ws, maxDeg = 2) {
  for (let deg = Math.min(maxDeg, xs.length - 1); deg >= 0; deg--) {
    const A = [];
    const b = [];
    for (let i = 0; i <= deg; i++) {
      A.push([]);
      for (let j = 0; j <= deg; j++) A[i].push(xs.reduce((s, x, k) => s + ws[k] * x ** (i + j), 0));
      b.push(xs.reduce((s, x, k) => s + ws[k] * ys[k] * x ** i, 0));
    }
    const c = solve(A, b);
    if (c) return [...c, 0, 0].slice(0, 3);
  }
  return [ys.reduce((a, v) => a + v, 0) / ys.length, 0, 0];
}

// ─── Public API ──────────────────────────────────────────

/**
 * Build the options-implied distribution for one expiry.
 * @param {object} p
 * @param {object[]} [p.calls]  [{strike,bid,ask}]
 * @param {object[]} [p.puts]   [{strike,bid,ask}]
 * @param {number} p.spot
 * @param {number} p.daysToExpiry
 * @param {number} [p.riskFreeRate=0.043]
 * @param {number} [p.dividendYield=0]   only used for the carry-forward fallback
 * @param {number} [p.gridSize=401]
 * @returns {object|null}
 */
export function buildImpliedDistribution({
  calls = [], puts = [], spot, daysToExpiry, riskFreeRate = DEFAULT_RATE, dividendYield = 0, gridSize = DEFAULT_GRID,
} = {}) {
  if (!(spot > 0) || !(daysToExpiry > 0)) return null;
  const r = Number.isFinite(riskFreeRate) ? riskFreeRate : DEFAULT_RATE;
  const T = daysToExpiry / 365;

  const callMid = new Map();
  const putMid = new Map();
  for (const c of calls || []) { const m = quoteMid(c); if (c?.strike > 0 && m != null) callMid.set(c.strike, m); }
  for (const c of puts || []) { const m = quoteMid(c); if (c?.strike > 0 && m != null) putMid.set(c.strike, m); }

  // Forward from put-call parity on the strikes nearest spot.
  const pairs = [...callMid.keys()].filter((k) => putMid.has(k)).sort((a, b) => Math.abs(a - spot) - Math.abs(b - spot)).slice(0, PARITY_STRIKES);
  let forward;
  let forwardSource;
  if (pairs.length) {
    forward = pairs.reduce((s, k) => s + k + Math.exp(r * T) * (callMid.get(k) - putMid.get(k)), 0) / pairs.length;
    forwardSource = 'parity';
  }
  if (!(forward > 0) || Math.abs(forward / spot - 1) > 0.5) {
    forward = spot * Math.exp((r - (dividendYield || 0)) * T);
    forwardSource = 'carry';
  }

  // OTM side preferred; the other side fills gaps.
  const strikes = [...new Set([...callMid.keys(), ...putMid.keys()])].sort((a, b) => a - b);
  const pts = [];
  for (const k of strikes) {
    const preferCall = k >= forward;
    let isCall = preferCall;
    let mid = (preferCall ? callMid : putMid).get(k);
    if (mid == null) { isCall = !preferCall; mid = (isCall ? callMid : putMid).get(k); }
    if (mid == null) continue;
    const v = impliedVol(mid, forward, k, T, isCall, r);
    if (v != null) pts.push({ x: Math.log(k / forward), iv: v, strike: k });
  }
  if (pts.length < MIN_STRIKES) return null;

  const xs = pts.map((p) => p.x);
  const ivs = pts.map((p) => p.iv);
  const nearest = pts.reduce((a, p) => (Math.abs(p.x) < Math.abs(a.x) ? p : a));
  const bw = 1.5 * nearest.iv * Math.sqrt(T);
  const ws = xs.map((x) => Math.exp(-((x / bw) ** 2)) + 0.15);
  const coef = fitSmile(xs, ivs, ws);
  const xMin = Math.min(...xs);
  const xMax = Math.max(...xs);
  // Beyond the quoted strikes the smile continues along its tangent (C¹), so
  // the call-price curve has no kink at the last strike — a flat extension
  // would create a spurious point mass in the density there.
  const quad = (x) => coef[0] + coef[1] * x + coef[2] * x * x;
  const slope = (x) => coef[1] + 2 * coef[2] * x;
  const smile = (x) => {
    let v;
    if (x < xMin) v = Math.max(WING_FLOOR * quad(xMin), quad(xMin) + slope(xMin) * (x - xMin));
    else if (x > xMax) v = Math.max(WING_FLOOR * quad(xMax), quad(xMax) + slope(xMax) * (x - xMax));
    else v = quad(x);
    return Math.min(IV_BOUNDS[1], Math.max(MIN_SMILE_IV, v));
  };
  const atmIv = smile(0);

  // Density on a strike grid.
  const sd = atmIv * Math.sqrt(T);
  const lo = forward * Math.exp(-GRID_STDEVS * sd);
  const hi = forward * Math.exp(GRID_STDEVS * sd);
  const n = Math.max(51, Math.floor(gridSize)) - 1;
  const h = (hi - lo) / n;
  const grid = Array.from({ length: n + 1 }, (_, i) => lo + i * h);
  const C = grid.map((K) => black76(forward, K, T, smile(Math.log(K / forward)), true, r));
  const growth = Math.exp(r * T);
  const pdf = grid.map((_, i) => (i === 0 || i === n ? 0 : Math.max(0, growth * (C[i + 1] - 2 * C[i] + C[i - 1]) / (h * h))));
  let total = 0;
  for (let i = 1; i <= n; i++) total += 0.5 * (pdf[i] + pdf[i - 1]) * h;
  if (!(total > 0)) return null;
  for (let i = 0; i <= n; i++) pdf[i] /= total;
  const cdf = [0];
  for (let i = 1; i <= n; i++) cdf.push(Math.min(1, cdf[i - 1] + 0.5 * (pdf[i] + pdf[i - 1]) * h));
  cdf[n] = 1;

  const dist = { spot, forward, forwardSource, daysToExpiry, T, riskFreeRate: r, atmIv, smile: { coef, xMin, xMax }, grid, pdf, cdf };

  // Moments.
  const integrate = (fn) => {
    let s = 0;
    for (let i = 1; i <= n; i++) s += 0.5 * (fn(grid[i]) * pdf[i] + fn(grid[i - 1]) * pdf[i - 1]) * h;
    return s;
  };
  const mean = integrate((K) => K);
  const std = Math.sqrt(Math.max(integrate((K) => (K - mean) ** 2), 0));
  const skew = std > 0 ? integrate((K) => ((K - mean) / std) ** 3) : 0;

  // Tails vs spot, implied and lognormal at the same forward / ATM vol.
  const lnBelow = (K) => normCdf((Math.log(K / forward) + 0.5 * sd * sd) / sd);
  const tailSet = (below) => ({
    down20: below(spot * 0.8), down30: below(spot * 0.7), up20: 1 - below(spot * 1.2), up30: 1 - below(spot * 1.3),
  });
  const tails = { implied: tailSet((K) => probBelow(dist, K)), lognormal: tailSet(lnBelow) };

  const usedBelow = pts.filter((p) => p.x < 0).length;
  const usedAbove = pts.length - usedBelow;
  return {
    ...dist,
    strikesUsed: pts.length,
    smilePoints: pts.map((p) => ({ strike: p.strike, iv: +p.iv.toFixed(4) })),
    quality: pts.length >= GOOD_STRIKES && usedBelow >= 2 && usedAbove >= 2 ? 'good' : 'fair',
    stats: { mean, std, skew, p5: quantile(dist, 0.05), p50: quantile(dist, 0.5), p95: quantile(dist, 0.95) },
    tails,
    shape: classifyShape({ atmIv, implied: tails.implied, lognormal: tails.lognormal }),
  };
}

/** P(S_T ≤ price) by linear interpolation of the CDF; 0/1 outside the grid. */
export function probBelow(dist, price) {
  if (!dist?.grid?.length || !Number.isFinite(price)) return null;
  const { grid, cdf } = dist;
  const n = grid.length - 1;
  if (price <= grid[0]) return 0;
  if (price >= grid[n]) return 1;
  const h = grid[1] - grid[0];
  const i = Math.min(n - 1, Math.floor((price - grid[0]) / h));
  const w = (price - grid[i]) / h;
  return cdf[i] + w * (cdf[i + 1] - cdf[i]);
}

/** P(S_T ≤ price) under a lognormal at the same forward and ATM vol (comparison baseline). */
export function lognormalProbBelow(dist, price) {
  if (!dist?.grid?.length || !(price > 0)) return null;
  const sd = dist.atmIv * Math.sqrt(dist.T);
  return normCdf((Math.log(price / dist.forward) + 0.5 * sd * sd) / sd);
}

/** P(S_T > price). */
export function probAbove(dist, price) {
  const b = probBelow(dist, price);
  return b == null ? null : 1 - b;
}

/** Price at a given cumulative probability (linear CDF inversion). */
export function quantile(dist, q) {
  if (!dist?.grid?.length || !(q >= 0 && q <= 1)) return null;
  const { grid, cdf } = dist;
  for (let i = 1; i < grid.length; i++) {
    if (cdf[i] >= q) {
      const span = cdf[i] - cdf[i - 1];
      return span > 0 ? grid[i - 1] + ((q - cdf[i - 1]) / span) * (grid[i] - grid[i - 1]) : grid[i];
    }
  }
  return grid[grid.length - 1];
}

/**
 * Risk-neutral expectation of a payoff at expiry (trapezoid rule).
 * @param {object} dist
 * @param {(price:number)=>number} payoff  P&L at expiry, any units
 */
export function expectedPayoff(dist, payoff) {
  if (!dist?.grid?.length || typeof payoff !== 'function') return null;
  const { grid, pdf } = dist;
  const h = grid[1] - grid[0];
  let s = 0;
  let prev = payoff(grid[0]) * pdf[0];
  for (let i = 1; i < grid.length; i++) {
    const cur = payoff(grid[i]) * pdf[i];
    s += 0.5 * (cur + prev) * h;
    prev = cur;
  }
  return s;
}

/**
 * Probability that a payoff finishes > 0. Sign changes are located by linear
 * interpolation and measured on the CDF, so the result matches probAbove /
 * probBelow at the breakevens exactly.
 */
export function probPayoffPositive(dist, payoff) {
  if (!dist?.grid?.length || typeof payoff !== 'function') return null;
  const { grid } = dist;
  let p = 0;
  let prevK = grid[0];
  let prevV = payoff(prevK);
  if (prevV > 0) p += probBelow(dist, prevK); // mass below grid start is 0 by construction
  for (let i = 1; i < grid.length; i++) {
    const K = grid[i];
    const v = payoff(K);
    if (prevV > 0 && v > 0) p += probBelow(dist, K) - probBelow(dist, prevK);
    else if (prevV > 0 || v > 0) {
      const cross = prevK + (prevV / (prevV - v)) * (K - prevK);
      p += prevV > 0 ? probBelow(dist, cross) - probBelow(dist, prevK) : probBelow(dist, K) - probBelow(dist, cross);
    }
    prevK = K;
    prevV = v;
  }
  if (prevV > 0) p += 1 - probBelow(dist, prevK);
  return Math.min(1, Math.max(0, p));
}

const SHAPES = {
  lottery: { label: 'Lottery-ticket', description: 'Very wide outcome range with a long upside tail. If bullish, an out-of-the-money call captures the right tail for a fraction of the capital; owning the stock means owning the large downside too.' },
  'left-tail': { label: 'Fat left tail', description: 'The market prices a crash well above a normal bell curve. Owners should hedge this tail (puts / put spreads); selling puts is paid for taking exactly this risk.' },
  'right-tail': { label: 'Fat right tail', description: 'Upside moves priced rich versus a normal bell curve — calls are expensive; call spreads or selling upside fits better than buying calls outright.' },
  narrow: { label: 'Narrow', description: 'Low-volatility, tight distribution. Options add little edge; the stock is often the simpler instrument.' },
  normal: { label: 'Near-normal', description: 'Tails close to a lognormal bell curve at the ATM vol — no strong tail premium either way.' },
  unknown: { label: 'Unknown', description: 'Not enough quoted strikes to estimate the distribution.' },
};

/**
 * Classify the distribution shape from ATM vol and tail ratios.
 * Precedence: lottery → left tail → right tail → narrow → normal.
 */
export function classifyShape({ atmIv, implied, lognormal } = {}) {
  if (!Number.isFinite(atmIv) || !implied || !lognormal) return { key: 'unknown', ...SHAPES.unknown };
  const ratio = (a, b) => (b > 0 ? a / b : 0);
  const leftRatio = ratio(implied.down30, lognormal.down30);
  const rightRatio = ratio(implied.up30, lognormal.up30);
  let key = 'normal';
  if (atmIv >= LOTTERY_IV) key = 'lottery';
  else if (implied.down30 >= MIN_TAIL_PROB && leftRatio >= LEFT_TAIL_RATIO) key = 'left-tail';
  else if (implied.up30 >= MIN_TAIL_PROB && rightRatio >= RIGHT_TAIL_RATIO) key = 'right-tail';
  else if (atmIv < NARROW_IV) key = 'narrow';
  return { key, ...SHAPES[key], leftTailRatio: +leftRatio.toFixed(2), rightTailRatio: +rightRatio.toFixed(2) };
}

/** Compact, JSON-friendly summary (no grid arrays) for recommendations and the UI. */
export function distributionSummary(dist) {
  if (!dist?.grid) return null;
  const round = (o) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, +v.toFixed(4)]));
  return {
    spot: dist.spot,
    forward: +dist.forward.toFixed(4),
    forwardSource: dist.forwardSource,
    daysToExpiry: dist.daysToExpiry,
    atmIv: +dist.atmIv.toFixed(4),
    strikesUsed: dist.strikesUsed,
    quality: dist.quality,
    median: dist.stats.p50,
    range90: [dist.stats.p5, dist.stats.p95],
    skew: +dist.stats.skew.toFixed(3),
    tails: { implied: round(dist.tails.implied), lognormal: round(dist.tails.lognormal) },
    shape: dist.shape,
  };
}

/** Downsampled density curve [{price, implied, lognormal}] for charts. */
export function distributionCurve(dist, points = 80) {
  if (!dist?.grid?.length) return [];
  const { grid, pdf, forward, T, atmIv } = dist;
  const sd = atmIv * Math.sqrt(T);
  const mu = Math.log(forward) - 0.5 * sd * sd;
  const ln = (K) => Math.exp(-((Math.log(K) - mu) ** 2) / (2 * sd * sd)) / (K * sd * Math.sqrt(2 * Math.PI));
  const m = Math.max(2, Math.floor(points));
  return Array.from({ length: m }, (_, j) => {
    const i = Math.round((j * (grid.length - 1)) / (m - 1));
    return { price: +grid[i].toFixed(2), implied: pdf[i], lognormal: ln(grid[i]) };
  });
}

export const _internal = { impliedVol, quoteMid, fitSmile, SHAPES };
