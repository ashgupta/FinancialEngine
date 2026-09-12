/**
 * Bond Market Intelligence — historical data, the "bond rule" duration-timing
 * signal, and yield/price sensitivity math.
 *
 * Historical annual-return dataset is compiled from publicly documented
 * long-run market history (Damodaran-style S&P 500 / 3-month T-bill / 10-year
 * Treasury total-return series). Pre-1990 values are approximate composites
 * for educational illustration — cross-reference NYU Stern's public dataset
 * (pages.stern.nyu.edu/~adamodar/New_Home_Page/datafile/histretSP.html) for
 * precise figures. Values are in percent (e.g. -18.1 = -18.1%).
 *
 * @module bondMarket
 */

// ─── The 26 negative S&P 500 years (1928–2025) ─────────────────────────────
// Fields: year, sp500 (total return %), tbill3mo (total return %),
// treasury10y (total return %, note-repricing method per Damodaran, NOT the
// fund-rolling method — see NEGATIVE_YEARS_NOTE below).
export const NEGATIVE_YEARS = [
  { year: 1929, sp500: -8.4,  tbill3mo: 4.7,  treasury10y: 3.4 },
  { year: 1930, sp500: -24.9, tbill3mo: 2.4,  treasury10y: 4.5 },
  { year: 1931, sp500: -43.3, tbill3mo: 1.1,  treasury10y: -2.6 },
  { year: 1932, sp500: -8.2,  tbill3mo: 1.1,  treasury10y: 16.8 },
  { year: 1934, sp500: -1.4,  tbill3mo: 0.3,  treasury10y: 9.0 },
  { year: 1937, sp500: -35.3, tbill3mo: 0.3,  treasury10y: 1.6 },
  { year: 1939, sp500: -0.4,  tbill3mo: 0.0,  treasury10y: 4.4 },
  { year: 1940, sp500: -9.8,  tbill3mo: 0.0,  treasury10y: 6.0 },
  { year: 1941, sp500: -11.6, tbill3mo: 0.1,  treasury10y: -2.0 },
  { year: 1946, sp500: -8.1,  tbill3mo: 0.4,  treasury10y: 1.7 },
  { year: 1953, sp500: -1.1,  tbill3mo: 1.9,  treasury10y: 4.1 },
  { year: 1957, sp500: -10.8, tbill3mo: 3.2,  treasury10y: 6.8 },
  { year: 1962, sp500: -8.8,  tbill3mo: 2.8,  treasury10y: 5.7 },
  { year: 1966, sp500: -10.1, tbill3mo: 4.8,  treasury10y: 3.0 },
  { year: 1969, sp500: -8.5,  tbill3mo: 6.7,  treasury10y: -5.0 },
  { year: 1973, sp500: -14.7, tbill3mo: 6.9,  treasury10y: 3.7 },
  { year: 1974, sp500: -26.5, tbill3mo: 7.8,  treasury10y: 2.0 },
  { year: 1977, sp500: -7.4,  tbill3mo: 5.1,  treasury10y: 1.4 },
  { year: 1981, sp500: -4.9,  tbill3mo: 14.7, treasury10y: 8.2 },
  { year: 1990, sp500: -3.1,  tbill3mo: 7.5,  treasury10y: 6.2 },
  { year: 2000, sp500: -9.1,  tbill3mo: 5.9,  treasury10y: 16.7 },
  { year: 2001, sp500: -11.9, tbill3mo: 3.4,  treasury10y: 5.6 },
  { year: 2002, sp500: -22.1, tbill3mo: 1.6,  treasury10y: 14.6 },
  { year: 2008, sp500: -37.0, tbill3mo: 1.5,  treasury10y: 20.1 },
  { year: 2018, sp500: -4.4,  tbill3mo: 1.9,  treasury10y: -0.02 },
  { year: 2022, sp500: -18.1, tbill3mo: 1.5,  treasury10y: -17.8 },
];

export const NEGATIVE_YEARS_NOTE =
  'Dataset covers the 26 calendar years (1928–2025) in which the S&P 500 posted a negative total return. ' +
  '10-year Treasury figures use the "buy-and-hold note, reprice at year-end" method (Damodaran convention), ' +
  'not the fund-rolling method — a real bond FUND (e.g. a 10-year Treasury ETF) behaves slightly differently ' +
  '(e.g. 2022: note method ≈ -17.8%, fund method ≈ -15%, since a fund continuously rolls into higher-yielding ' +
  'new issues). Pre-1990 values are approximate composites for educational illustration.';

// ─── Headline stats (referenced directly in the source analysis) ──────────
export const HEADLINE_STATS = {
  totalYears: 98,
  negativeStockYears: 26,
  treasuryPositiveInNegativeYears: 21,
  bothNegativeYears: [1931, 1941, 1969, 2018, 2022],
  worstTreasuryYear: { year: 2022, fundReturn: -15.2, noteReturn: -17.8 },
  onlyYearBelowNegative6Pct: 2022,
  avgTreasuryReturnInDownYears: 4.3,
  avgTbillReturnInDownYears: 3.5,
  bondsBeatCashCount: 14,
  cashBeatBondsCount: 12,
  cashWinsExInflationEra: 5, // wins outside 1966-1981 & excluding 2022
};

// ─── Named crash-window deep dives (peak-to-trough, exact dates from source) ──
export const CRASH_WINDOWS = [
  {
    id: '1973-74',
    label: '1973–74 Bear Market (Inflation Shock)',
    start: '1973-01-01',
    end: '1974-10-01',
    stockReturn: -48,
    tbillReturn: 14,
    treasury10yReturn: 1,
    tenYearYieldStart: 6.4,
    tenYearYieldEnd: 8.0,
    cpiStart: 8.7,
    cpiEnd: 12.3,
    narrative:
      'Rising yields during a bear market is the "duration killer" scenario. CPI raced from 8.7% to 12.3%, ' +
      'the 10-yr yield rose from 6.4% to 8.0%, and new higher-yield issuance made existing bonds less valuable. ' +
      'Short T-bills, which roll into new higher rates quickly, gained ~14% while 10-yr notes were barely positive.',
    lesson: 'Rising-rate + high-inflation regime → short duration wins.',
  },
  {
    id: '2000-02',
    label: 'Dot-Com Collapse (Falling Rates)',
    start: '2000-03-24',
    end: '2002-10-09',
    stockReturn: -49,
    treasury10yReturn: 39,
    tenYearYieldStart: 6.2,
    tenYearYieldEnd: 3.6,
    narrative:
      'The opposite environment: yields fell from 6.2% to 3.6% over 31 months as the Fed eased. Falling yields ' +
      'push existing (higher-coupon) bond prices UP — 10-yr Treasuries gained ~39% while the S&P 500 nearly halved.',
    lesson: 'Falling-rate bear market → intermediate/long duration is a powerful hedge.',
  },
  {
    id: '2008',
    label: '2008 Financial Crisis (Flight to Quality)',
    start: '2007-10-09',
    end: '2009-03-09',
    stockReturn: -57,
    treasury10yReturn: 20,
    fedFundsStart: 4.25,
    fedFundsEnd: 0.0,
    tenYearYieldStart: 3.9,
    tenYearYieldEnd: 2.25,
    narrative:
      'The Fed cut the funds rate from 4.25% to effectively 0% in a single year. The 10-yr yield fell from 3.9% ' +
      'to 2.25%, and Treasuries gained ~20% at the exact moment stocks lost 57% — the textbook diversification case.',
    lesson: 'Economic-collapse-driven Fed cuts → duration earns its keep as the classic hedge.',
  },
  {
    id: '2022',
    label: '2022 (Inflation Fight, Zero Cushion)',
    start: '2022-01-03',
    end: '2022-10-12',
    stockReturn: -25,
    treasury10yReturn: -15,
    fedFundsStart: 0.08,
    fedFundsEnd: 4.25,
    tenYearYieldStart: 1.63,
    tenYearYieldEnd: 3.9,
    tenYearYieldPeak: 4.25,
    narrative:
      'The Fed hiked from ~0% to 4%+ in one year to fight inflation — NOT an economic collapse. The 10-yr entered ' +
      'the year at just 1.63% with almost no coupon cushion (vs. 6–7% coupons in 1973–74), so the price shock from ' +
      'rapidly rising yields was uncushioned. This made 2022 the single worst calendar year for 10-yr Treasuries ' +
      'in the full 98-year dataset (note method: -17.8%; fund method: ≈-15.2%).',
    lesson: 'Rapid-hike-from-near-zero-yield regime → duration gets hurt hard; this was the exception, not the rule.',
  },
];

// ─── The "Bond Rule" — duration-timing signal from the source analysis ────
export const BOND_RULE_THRESHOLDS = {
  curveInversionBps: 10,   // 3mo yield must exceed 10yr yield by >10bps
  momentumThresholdPct: 1.0, // 3mo yield must have risen >1.0 percentage point over prior 3 months
};

/**
 * Compute the live "bond rule" signal from current and 3-months-ago yields.
 * Rule (verbatim from source):
 *   1. Curve signal: fires if 3mo yield > 10yr yield by more than 10bps (inverted).
 *   2. Momentum signal: fires if 3mo yield rose more than 1.0 percentage point
 *      over the trailing 3 months.
 * If EITHER signal fires → recommend shifting duration sleeve to short-term
 * (SGOV). Both signals must be quiet to recommend moving back to intermediate
 * duration (IEF) — asymmetric/conservative re-entry, per the source's own rule.
 *
 * @param {object} p
 * @param {number} p.irx3moNow - current 13-week T-bill yield (%), e.g. from ^IRX
 * @param {number} p.irx3moAgo - 13-week T-bill yield (%) ~3 months ago
 * @param {number} p.tnx10yNow - current 10-year Treasury yield (%), e.g. from ^TNX
 * @returns {{curveSignal: boolean, momentumSignal: boolean, recommendation: 'IEF'|'SGOV', curveSpreadBps: number, momentumDeltaPct: number}}
 */
export function computeBondRule({ irx3moNow, irx3moAgo, tnx10yNow }) {
  if (irx3moNow == null || tnx10yNow == null) {
    return {
      curveSignal: null, momentumSignal: null, recommendation: null,
      curveSpreadBps: null, momentumDeltaPct: null, insufficientData: true,
    };
  }

  const curveSpreadBps = (irx3moNow - tnx10yNow) * 100; // positive = inverted
  const curveSignal = curveSpreadBps > BOND_RULE_THRESHOLDS.curveInversionBps;

  const momentumDeltaPct = irx3moAgo != null ? irx3moNow - irx3moAgo : null;
  const momentumSignal = momentumDeltaPct != null
    ? momentumDeltaPct > BOND_RULE_THRESHOLDS.momentumThresholdPct
    : false;

  const anyFired = curveSignal || momentumSignal;
  const recommendation = anyFired ? 'SGOV' : 'IEF';

  return { curveSignal, momentumSignal, recommendation, curveSpreadBps, momentumDeltaPct };
}

// ─── 2022 backtest of the bond rule (illustrative, from the source) ───────
export const BOND_RULE_2022_BACKTEST = {
  triggerDate: '2022-07-01',
  triggerReason: 'Momentum signal fired: 3mo yield rose from ~0.51% to ~1.66% (Δ1.15pp) over prior 3 months.',
  curveSignalFiredLater: true,
  ruleBasedFullYearReturn: -9.0,
  bareIefFullYearReturn: -15.2,
  differencePct: 6.1,
  differenceDollarsPer100k: 6100,
  stockMarketBottomDate: '2022-10-12',
  bondMarketBottomDate: '2022-10-24',
  tenYearYieldPeakOnBottom: 4.25,
  note: 'The rule did not call the top — it reacted after damage had already started, then avoided the worst of ' +
    'the remaining decline by shifting to T-bills roughly 3.5 months before the stock market bottomed.',
};

// ─── Duration / yield sensitivity ─────────────────────────────────────────
/**
 * Approximate price change for a bond/bond-fund given its effective duration
 * and a change in yield (first-order duration approximation, ignoring convexity).
 * Rule of thumb from the source: ~7-year duration fund ≈ 7% price move per 1pp yield change.
 * @param {number} durationYears - effective/modified duration
 * @param {number} yieldChangePct - change in yield in percentage points (e.g. -1 = yields fall 1pp)
 * @returns {number} approximate % price change
 */
export function estimateDurationPriceImpact(durationYears, yieldChangePct) {
  if (durationYears == null || yieldChangePct == null) return null;
  return -durationYears * yieldChangePct;
}

// ─── Duration ladder reference (approx effective durations, for the UI) ──
export const DURATION_LADDER = [
  { ticker: 'SGOV', label: '0–3 Month T-Bills',  approxDuration: 0.1, category: 'ultra-short' },
  { ticker: 'SHY',  label: '1–3 Year Treasuries', approxDuration: 1.9, category: 'short' },
  { ticker: 'IEI',  label: '3–7 Year Treasuries', approxDuration: 4.5, category: 'short-intermediate' },
  { ticker: 'IEF',  label: '7–10 Year Treasuries', approxDuration: 7.5, category: 'intermediate' },
  { ticker: 'TLH',  label: '10–20 Year Treasuries', approxDuration: 11.5, category: 'long' },
  { ticker: 'TLT',  label: '20+ Year Treasuries',  approxDuration: 16.5, category: 'long' },
  { ticker: 'EDV',  label: 'Extended Duration (~25yr, long-bond proxy)', approxDuration: 24.0, category: 'extended' },
];

// ─── Yahoo/CBOE yield ticker normalization ────────────────────────────────
// CBOE's ^TNX (10yr) and ^TYX (30yr) indices quote at 10x the actual yield
// (e.g. a 4.50% yield shows as 45.0). ^IRX (13-week T-bill) quotes the actual
// discount yield directly (e.g. 5.25% shows as 5.25). Always run raw Yahoo
// values through `normalizeYield()` before using them as a percentage.
export const YIELD_TICKERS = {
  threeMonth: { symbol: '^IRX', divisor: 1,  label: '3-Month T-Bill Yield' },
  tenYear:    { symbol: '^TNX', divisor: 10, label: '10-Year Treasury Yield' },
  thirtyYear: { symbol: '^TYX', divisor: 10, label: '30-Year Treasury Yield' },
};

/**
 * Normalize a raw Yahoo Finance quote/close value for a yield ticker into an
 * actual percentage (e.g. 45.0 → 4.50 for ^TNX).
 * @param {string} symbol - '^IRX' | '^TNX' | '^TYX'
 * @param {number} rawValue
 * @returns {number|null}
 */
export function normalizeYield(symbol, rawValue) {
  if (rawValue == null || isNaN(rawValue)) return null;
  const entry = Object.values(YIELD_TICKERS).find((y) => y.symbol === symbol);
  const divisor = entry ? entry.divisor : 1;
  return rawValue / divisor;
}

// ─── Today's-setup reference points (income cushion framing) ─────────────
export const SETUP_REFERENCE = {
  y2022EntryYield10y: 1.63,
  y2022PeakYield10y: 4.25,
  note: 'The 10-yr Treasury entered 2022 yielding just 1.63% — almost no coupon cushion against rising rates. ' +
    'Compare today\'s live 10-yr yield (below) to that 1.63% starting point: a materially higher starting yield ' +
    'means more income cushion if rates rise further from here.',
};
