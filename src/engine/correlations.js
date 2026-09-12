/**
 * Cross-Asset Correlation & Regime-Based Opportunity Screener.
 *
 * Computes rolling correlations between the bond ladder / yields and other
 * major asset classes (gold, USD, real estate, world equities, commodities,
 * oil, crypto), classifies the current macro regime, and surfaces a static
 * historically-informed "opportunity playbook" for that regime plus any
 * correlation pairs that have structurally diverged from their long-run norm.
 *
 * All regime/playbook content is historical tendency, not a prediction or
 * investment advice.
 *
 * @module correlations
 */

// ─── Universe ───────────────────────────────────────────────────────────
export const CROSS_ASSET_UNIVERSE = [
  { ticker: 'TLT',     label: 'Long Treasuries (20yr+)', group: 'bonds' },
  { ticker: 'IEF',     label: 'Intermediate Treasuries (7-10yr)', group: 'bonds' },
  { ticker: 'SGOV',    label: 'Short T-Bills (0-3mo)', group: 'bonds' },
  { ticker: 'GLD',     label: 'Gold', group: 'metals' },
  { ticker: 'UUP',     label: 'US Dollar Index', group: 'currency' },
  { ticker: 'VNQ',     label: 'US Real Estate (REITs)', group: 'real_estate' },
  { ticker: 'ACWI',    label: 'World Equities', group: 'equities' },
  { ticker: 'SPY',     label: 'US Equities (S&P 500)', group: 'equities' },
  { ticker: 'DBC',     label: 'Broad Commodities', group: 'commodities' },
  { ticker: 'USO',     label: 'Crude Oil', group: 'commodities' },
  { ticker: 'BTC-USD', label: 'Bitcoin', group: 'crypto' },
];

export const CORRELATION_WINDOWS = [
  { id: '30d',  label: '30-Day',  days: 30 },
  { id: '90d',  label: '90-Day',  days: 90 },
  { id: '365d', label: '1-Year',  days: 365 },
];

// ─── Return / correlation math ─────────────────────────────────────────
/**
 * Convert a series of closing prices into daily simple returns.
 * @param {number[]} closes
 * @returns {number[]}
 */
export function computeReturns(closes) {
  if (!closes || closes.length < 2) return [];
  const returns = [];
  for (let i = 1; i < closes.length; i++) {
    const prev = closes[i - 1];
    const curr = closes[i];
    if (prev == null || curr == null || prev === 0) continue;
    returns.push((curr - prev) / prev);
  }
  return returns;
}

/**
 * Pearson correlation coefficient between two equal-ish-length return series.
 * Series are aligned from the END (most recent values), truncated to the
 * shorter length.
 * @param {number[]} a
 * @param {number[]} b
 * @returns {number|null}
 */
export function pearsonCorrelation(a, b) {
  if (!a || !b || a.length < 3 || b.length < 3) return null;
  const len = Math.min(a.length, b.length);
  const sa = a.slice(a.length - len);
  const sb = b.slice(b.length - len);

  const meanA = sa.reduce((s, v) => s + v, 0) / len;
  const meanB = sb.reduce((s, v) => s + v, 0) / len;

  let cov = 0, varA = 0, varB = 0;
  for (let i = 0; i < len; i++) {
    const da = sa[i] - meanA;
    const db = sb[i] - meanB;
    cov += da * db;
    varA += da * da;
    varB += db * db;
  }
  if (varA === 0 || varB === 0) return null;
  return cov / Math.sqrt(varA * varB);
}

/**
 * Take the trailing N calendar days worth of returns from a returns array
 * (approximated as trailing N daily observations, since return series are
 * already daily-frequency with weekends/holidays removed).
 * @param {number[]} returns
 * @param {number} windowDays
 * @returns {number[]}
 */
export function trailingWindow(returns, windowDays) {
  if (!returns) return [];
  // Daily trading data → roughly 252 trading days/year, so scale calendar
  // days to trading days (~0.69 ratio) for a reasonable approximation.
  const tradingDays = Math.max(3, Math.round(windowDays * (252 / 365)));
  return returns.slice(-tradingDays);
}

/**
 * Build a full ticker x ticker correlation matrix for a given rolling window.
 * @param {Record<string, number[]>} returnsByTicker - full-history daily returns per ticker
 * @param {number} windowDays
 * @returns {{tickers: string[], matrix: (number|null)[][]}}
 */
export function buildCorrelationMatrix(returnsByTicker, windowDays) {
  const tickers = Object.keys(returnsByTicker);
  const windowed = {};
  for (const t of tickers) windowed[t] = trailingWindow(returnsByTicker[t], windowDays);

  const matrix = tickers.map((ti) =>
    tickers.map((tj) => {
      if (ti === tj) return 1;
      return pearsonCorrelation(windowed[ti], windowed[tj]);
    })
  );

  return { tickers, matrix };
}

/**
 * Find asset pairs whose short-window correlation has diverged materially
 * from their long-window correlation — a simple structural-shift indicator.
 * @param {{tickers: string[], matrix: (number|null)[][]}} shortMatrix
 * @param {{tickers: string[], matrix: (number|null)[][]}} longMatrix
 * @param {number} threshold - minimum absolute delta to flag (default 0.4)
 * @returns {Array<{a: string, b: string, shortCorr: number, longCorr: number, delta: number}>}
 */
export function findDivergences(shortMatrix, longMatrix, threshold = 0.4) {
  const results = [];
  const { tickers } = shortMatrix;
  for (let i = 0; i < tickers.length; i++) {
    for (let j = i + 1; j < tickers.length; j++) {
      const shortCorr = shortMatrix.matrix[i][j];
      const longCorr = longMatrix.matrix[i][j];
      if (shortCorr == null || longCorr == null) continue;
      const delta = shortCorr - longCorr;
      if (Math.abs(delta) >= threshold) {
        results.push({ a: tickers[i], b: tickers[j], shortCorr, longCorr, delta });
      }
    }
  }
  return results.sort((x, y) => Math.abs(y.delta) - Math.abs(x.delta));
}

// ─── Regime classification ──────────────────────────────────────────────
/**
 * Compute a simple trailing % slope (return) over a window from a closes array.
 * @param {number[]} closes
 * @param {number} windowDays
 * @returns {number|null} % change over the window
 */
export function trailingSlopePct(closes, windowDays) {
  if (!closes || closes.length < 2) return null;
  const tradingDays = Math.max(2, Math.round(windowDays * (252 / 365)));
  const slice = closes.slice(-tradingDays);
  if (slice.length < 2) return null;
  const start = slice[0];
  const end = slice[slice.length - 1];
  if (!start) return null;
  return ((end - start) / start) * 100;
}

export const REGIME_QUADRANTS = {
  RISING_YIELDS_RISK_ON:  'Rising Yields + Risk-On',
  RISING_YIELDS_RISK_OFF: 'Rising Yields + Risk-Off',
  FALLING_YIELDS_RISK_ON: 'Falling Yields + Risk-On',
  FALLING_YIELDS_RISK_OFF:'Falling Yields + Risk-Off',
};

/**
 * Classify the current macro regime along two axes:
 *  1. Yield direction — rising vs falling 10-yr yield over ~90 days.
 *  2. Growth/risk proxy — rising vs falling world/US equities over ~90 days.
 * @param {object} p
 * @param {number} p.yieldSlopeBps - change in 10-yr yield in bps over the window (positive = rising)
 * @param {number} p.equitySlopePct - % return of equities proxy over the window (positive = risk-on)
 * @returns {string} one of REGIME_QUADRANTS values
 */
export function classifyRegime({ yieldSlopeBps, equitySlopePct }) {
  const risingYields = (yieldSlopeBps ?? 0) > 0;
  const riskOn = (equitySlopePct ?? 0) > 0;
  if (risingYields && riskOn) return REGIME_QUADRANTS.RISING_YIELDS_RISK_ON;
  if (risingYields && !riskOn) return REGIME_QUADRANTS.RISING_YIELDS_RISK_OFF;
  if (!risingYields && riskOn) return REGIME_QUADRANTS.FALLING_YIELDS_RISK_ON;
  return REGIME_QUADRANTS.FALLING_YIELDS_RISK_OFF;
}

// ─── Static historically-informed playbook (educational, not advice) ────
export const REGIME_PLAYBOOK = {
  [REGIME_QUADRANTS.RISING_YIELDS_RISK_ON]: {
    summary: 'Growth optimism + rising rates — the "reflation" regime.',
    favored: ['Short-duration bonds (SGOV/SHY)', 'US Dollar (mixed)', 'Cyclical/value equities', 'Commodities & oil', 'Real assets'],
    disfavored: ['Long-duration Treasuries (TLT/EDV)', 'Gold (loses luster vs. real yields rising)', 'Rate-sensitive REITs'],
    rationale: 'Strong growth expectations push yields up as investors demand more term premium and rotate out ' +
      'of safe-haven duration into risk assets and inflation-linked real assets. Historically similar to 2003-2007, 2021.',
  },
  [REGIME_QUADRANTS.RISING_YIELDS_RISK_OFF]: {
    summary: 'Inflation fight / stagflation fear — the hardest regime for traditional 60/40.',
    favored: ['Cash & short T-bills (SGOV)', 'US Dollar (often strengthens on rate-hike expectations)', 'Commodities (inflation hedge)', 'Gold (mixed — depends on real yields)'],
    disfavored: ['Long-duration Treasuries (TLT/EDV) — worst regime for duration', 'Growth equities', 'REITs (rate-sensitive)'],
    rationale: 'This is the 2022-style environment: the Fed hikes into weakening growth to fight inflation. Both ' +
      'stocks and long bonds can fall together, breaking the classic negative stock-bond correlation.',
  },
  [REGIME_QUADRANTS.FALLING_YIELDS_RISK_ON]: {
    summary: 'Goldilocks / soft-landing — rates easing while growth holds up.',
    favored: ['Intermediate & long duration (IEF/TLT) — price appreciation as yields fall', 'Growth equities', 'REITs (benefit from lower discount rates)', 'World equities'],
    disfavored: ['Cash (opportunity cost of not holding duration)', 'US Dollar (often weakens as rate-cut cycle begins)'],
    rationale: 'Falling yields with resilient growth is historically the best environment for a traditional 60/40 ' +
      'portfolio — bonds and stocks can both rally. Similar to 1995, 2019.',
  },
  [REGIME_QUADRANTS.FALLING_YIELDS_RISK_OFF]: {
    summary: 'Flight to quality / recession fear — the classic hedge regime.',
    favored: ['Long-duration Treasuries (TLT/EDV) — biggest price appreciation as yields collapse', 'Gold (safe-haven demand)', 'US Dollar (safe-haven flows)', 'Intermediate Treasuries (IEF)'],
    disfavored: ['Equities (world & US)', 'Commodities & oil (demand destruction fears)', 'REITs & crypto (risk-asset correlation)'],
    rationale: 'The Fed cuts aggressively as the economy weakens (2000-02, 2008-style). Duration earns its keep as ' +
      'the classic diversifier exactly when equities are falling hardest.',
  },
};

export const PLAYBOOK_DISCLAIMER =
  'Historical tendency only — not a prediction, recommendation, or guarantee. Regimes can shift quickly and ' +
  'correlations are not stable across all periods (e.g. 2022 broke the usual stock-bond negative correlation). ' +
  'Always do your own research and consult a qualified financial advisor.';
