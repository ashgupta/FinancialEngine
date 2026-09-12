/**
 * Momentum & Volume Engine
 *
 * Implements three kinds of momentum (per the trading transcript):
 *   1. Time Series Momentum — the asset's own trend (MA crossovers, ROC, RSI)
 *   2. Cross-Sectional Momentum — rank assets in a basket by relative strength
 *   3. Factor Momentum — which factor ETFs are leading right now (rotation)
 *
 * Plus Volume Analysis:
 *   - Volume-price confirmation (volume rising on up days vs down days)
 *   - Volume spikes (capitulation / absorption detection)
 *   - OBV (On-Balance Volume) trend
 *
 * Constitution Principle II: pure functions, no I/O, no DOM.
 * Data source: Yahoo Finance via fetchHistory (closes, highs, lows, volumes).
 */

// ─── Asset Universe ──────────────────────────────────────

export const MOMENTUM_UNIVERSE = {
  indices: [
    { symbol: '^GSPC', name: 'S&P 500' },
    { symbol: '^IXIC', name: 'Nasdaq Composite' },
    { symbol: '^DJI', name: 'Dow Jones' },
    { symbol: '^RUT', name: 'Russell 2000' },
    { symbol: '^VIX', name: 'VIX' },
  ],
  stocks: [
    { symbol: 'AAPL', name: 'Apple' },
    { symbol: 'MSFT', name: 'Microsoft' },
    { symbol: 'NVDA', name: 'NVIDIA' },
    { symbol: 'AMZN', name: 'Amazon' },
    { symbol: 'GOOGL', name: 'Alphabet' },
    { symbol: 'META', name: 'Meta' },
    { symbol: 'TSLA', name: 'Tesla' },
    { symbol: 'JPM', name: 'JPMorgan' },
    { symbol: 'BRK-B', name: 'Berkshire' },
  ],
  etfs: [
    { symbol: 'SPY', name: 'SPDR S&P 500' },
    { symbol: 'QQQ', name: 'Invesco QQQ' },
    { symbol: 'IWM', name: 'iShares Russell 2000' },
    { symbol: 'DIA', name: 'SPDR Dow Jones' },
  ],
};

// Factor ETFs for factor momentum (proxies for size, value, growth, quality, momentum, low-vol)
export const FACTOR_ETFS = [
  { symbol: 'MTUM', name: 'iShares Momentum', factor: 'Momentum' },
  { symbol: 'VLUE', name: 'iShares Value', factor: 'Value' },
  { symbol: 'QUAL', name: 'iShares Quality', factor: 'Quality' },
  { symbol: 'SIZE', name: 'iShares Size (Small-Cap)', factor: 'Size' },
  { symbol: 'USMV', name: 'iShares Min Vol', factor: 'Low Vol' },
  { symbol: 'SPYG', name: 'SPDR Growth', factor: 'Growth' },
  { symbol: 'SPYV', name: 'SPDR Value', factor: 'Value (SPDR)' },
  { symbol: 'EFAV', name: 'iShares Intl Value', factor: 'Intl Value' },
];

// ─── Technical Indicators (pure) ─────────────────────────

/**
 * Simple Moving Average over the last N periods.
 * @param {number[]} values
 * @param {number} period
 * @returns {number|null} SMA or null if insufficient data
 */
export function sma(values, period) {
  if (!values || values.length < period || period <= 0) return null;
  let sum = 0;
  for (let i = values.length - period; i < values.length; i++) {
    sum += values[i];
  }
  return sum / period;
}

/**
 * Exponential Moving Average over the full series, returning the latest value.
 * @param {number[]} values
 * @param {number} period
 * @returns {number|null}
 */
export function ema(values, period) {
  if (!values || values.length < period || period <= 0) return null;
  const k = 2 / (period + 1);
  let prev = values.slice(0, period).reduce((s, v) => s + v, 0) / period;
  for (let i = period; i < values.length; i++) {
    prev = values[i] * k + prev * (1 - k);
  }
  return prev;
}

/**
 * Rate of Change: percentage change over N periods.
 * @param {number[]} values
 * @param {number} period - number of bars to look back
 * @returns {number|null} ROC as percentage (e.g., 5.2 = +5.2%)
 */
export function rateOfChange(values, period) {
  if (!values || values.length <= period) return null;
  const past = values[values.length - 1 - period];
  if (!past || past === 0) return null;
  return ((values[values.length - 1] - past) / past) * 100;
}

/**
 * RSI (Relative Strength Index) using Wilder's smoothing.
 * @param {number[]} values
 * @param {number} period - typically 14
 * @returns {number|null} RSI 0-100
 */
export function rsi(values, period = 14) {
  if (!values || values.length < period + 1) return null;
  let gains = 0;
  let losses = 0;
  for (let i = 1; i <= period; i++) {
    const diff = values[i] - values[i - 1];
    if (diff >= 0) gains += diff;
    else losses -= diff;
  }
  let avgGain = gains / period;
  let avgLoss = losses / period;
  for (let i = period + 1; i < values.length; i++) {
    const diff = values[i] - values[i - 1];
    avgGain = (avgGain * (period - 1) + (diff >= 0 ? diff : 0)) / period;
    avgLoss = (avgLoss * (period - 1) + (diff < 0 ? -diff : 0)) / period;
  }
  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  return 100 - 100 / (1 + rs);
}

/**
 * Bollinger Bands.
 * @param {number[]} values
 * @param {number} period - typically 20
 * @param {number} numStd - typically 2
 * @returns {{upper:number, middle:number, lower:number, bandwidth:number, percentB:number}|null}
 */
export function bollingerBands(values, period = 20, numStd = 2) {
  if (!values || values.length < period) return null;
  const slice = values.slice(-period);
  const mean = slice.reduce((s, v) => s + v, 0) / period;
  const variance = slice.reduce((s, v) => s + (v - mean) ** 2, 0) / period;
  const std = Math.sqrt(variance);
  const upper = mean + numStd * std;
  const lower = mean - numStd * std;
  const bandwidth = mean !== 0 ? ((upper - lower) / mean) * 100 : 0;
  const last = values[values.length - 1];
  const percentB = (upper - lower) !== 0 ? ((last - lower) / (upper - lower)) * 100 : 50;
  return { upper, middle: mean, lower, bandwidth, percentB };
}

/**
 * On-Balance Volume (OBV).
 * @param {number[]} closes
 * @param {number[]} volumes
 * @returns {number[]} OBV series (same length as closes)
 */
export function obv(closes, volumes) {
  if (!closes || !volumes || closes.length !== volumes.length) return [];
  const result = [0];
  for (let i = 1; i < closes.length; i++) {
    if (closes[i] > closes[i - 1]) {
      result.push(result[i - 1] + volumes[i]);
    } else if (closes[i] < closes[i - 1]) {
      result.push(result[i - 1] - volumes[i]);
    } else {
      result.push(result[i - 1]);
    }
  }
  return result;
}

/**
 * Average Volume over last N bars.
 * @param {number[]} volumes
 * @param {number} period
 * @returns {number|null}
 */
export function avgVolume(volumes, period = 20) {
  if (!volumes || volumes.length < period) return null;
  const slice = volumes.slice(-period);
  return slice.reduce((s, v) => s + v, 0) / period;
}

/**
 * 52-week (252 trading day) high and low.
 * @param {number[]} highs
 * @param {number[]} lows
 * @returns {{high52w:number|null, low52w:number|null, pctFromHigh:number|null, pctFromLow:number|null}}
 */
export function fiftyTwoWeekRange(highs, lows) {
  if (!highs || !lows || highs.length === 0) {
    return { high52w: null, low52w: null, pctFromHigh: null, pctFromLow: null };
  }
  const lookback = Math.min(252, highs.length);
  const highSlice = highs.slice(-lookback);
  const lowSlice = lows.slice(-lookback);
  const high52w = Math.max(...highSlice);
  const low52w = Math.min(...lowSlice);
  const last = highSlice[highSlice.length - 1]; // approximate last close with high
  const pctFromHigh = high52w !== 0 ? ((last - high52w) / high52w) * 100 : 0;
  const pctFromLow = low52w !== 0 ? ((last - low52w) / low52w) * 100 : 0;
  return { high52w, low52w, pctFromHigh, pctFromLow };
}

// ─── 1. Time Series Momentum ─────────────────────────────

/**
 * Compute time series momentum signals for a single asset.
 * MA crossover system: above MA = long signal, below = short signal.
 *
 * @param {{closes:number[], highs:number[], lows:number[], volumes:number[]}} history
 * @returns {object} momentum signals
 */
export function computeTimeSeriesMomentum(history) {
  const { closes, highs, lows, volumes } = history;
  if (!closes || closes.length < 50) {
    return { insufficientData: true };
  }

  const last = closes[closes.length - 1];
  const sma20 = sma(closes, 20);
  const sma50 = sma(closes, 50);
  const sma200 = sma(closes, 200);
  const ema12 = ema(closes, 12);
  const ema26 = ema(closes, 26);

  // Rate of change over various lookbacks
  const roc1m = rateOfChange(closes, 21);   // ~1 month
  const roc3m = rateOfChange(closes, 63);   // ~3 months
  const roc6m = rateOfChange(closes, 126);  // ~6 months
  const roc12m = rateOfChange(closes, 252); // ~12 months

  const rsi14 = rsi(closes, 14);
  const bb = bollingerBands(closes, 20, 2);
  const range52w = fiftyTwoWeekRange(highs, lows);

  // MA stack alignment: strongest when sma20 > sma50 > sma200
  let maStack = 'mixed';
  if (sma200 && sma50 > sma200 && sma20 > sma50) maStack = 'bullish';
  else if (sma200 && sma50 < sma200 && sma20 < sma50) maStack = 'bearish';

  // Crossover signals
  const goldenCross = sma200 && sma50 > sma200;
  const deathCross = sma200 && sma50 < sma200;

  // Composite momentum score: weighted blend of ROCs
  const rocScore = [
    { val: roc1m, w: 0.15 },
    { val: roc3m, w: 0.30 },
    { val: roc6m, w: 0.30 },
    { val: roc12m, w: 0.25 },
  ].filter((r) => r.val != null);
  const totalW = rocScore.reduce((s, r) => s + r.w, 0);
  const momentumScore = totalW > 0
    ? rocScore.reduce((s, r) => s + r.val * (r.w / totalW), 0)
    : null;

  // Breakout detection
  let breakout = 'none';
  if (bb) {
    if (last > bb.upper) breakout = 'upper-band';
    else if (last < bb.lower) breakout = 'lower-band';
  }
  if (range52w.high52w && last >= range52w.high52w * 0.98) breakout = breakout === 'none' ? '52w-high' : breakout;
  if (range52w.low52w && last <= range52w.low52w * 1.02) breakout = breakout === 'none' ? '52w-low' : breakout;

  // Signal classification
  let signal = 'neutral';
  if (momentumScore != null) {
    if (momentumScore > 10 && maStack === 'bullish') signal = 'strong bullish';
    else if (momentumScore > 3) signal = 'bullish';
    else if (momentumScore < -10 && maStack === 'bearish') signal = 'strong bearish';
    else if (momentumScore < -3) signal = 'bearish';
  }

  return {
    last,
    sma20,
    sma50,
    sma200,
    ema12,
    ema26,
    roc1m,
    roc3m,
    roc6m,
    roc12m,
    rsi14,
    bollinger: bb,
    range52w,
    maStack,
    goldenCross,
    deathCross,
    momentumScore,
    breakout,
    signal,
    aboveSMA20: sma20 ? last > sma20 : null,
    aboveSMA50: sma50 ? last > sma50 : null,
    aboveSMA200: sma200 ? last > sma200 : null,
  };
}

// ─── 2. Cross-Sectional Momentum ─────────────────────────

/**
 * Rank a basket of assets by momentum score (cross-sectional momentum).
 * Buy the leaders, sell the laggards.
 *
 * @param {{symbol:string, name:string, momentumScore:number, roc3m:number, roc6m:number}[]} assets
 * @returns {{ranked:any[], leaders:any[], laggards:any[], medianScore:number}}
 */
export function computeCrossSectionalMomentum(assets) {
  const valid = assets.filter((a) => a.momentumScore != null);
  if (!valid.length) return { ranked: [], leaders: [], laggards: [], medianScore: null };

  const ranked = [...valid].sort((a, b) => b.momentumScore - a.momentumScore);

  // Assign percentile rank
  ranked.forEach((a, i) => {
    a.percentile = ((ranked.length - i) / ranked.length) * 100;
    a.csRank = i + 1;
  });

  const medianIdx = Math.floor(ranked.length / 2);
  const medianScore = ranked[medianIdx]?.momentumScore ?? null;

  // Top 25% = leaders, bottom 25% = laggards
  const quarterSize = Math.max(1, Math.floor(ranked.length / 4));
  const leaders = ranked.slice(0, quarterSize);
  const laggards = ranked.slice(-quarterSize);

  return { ranked, leaders, laggards, medianScore };
}

// ─── 3. Factor Momentum ──────────────────────────────────

/**
 * Compute factor momentum: rank factor ETFs by recent performance.
 * "Which factors are working now" — rotate into leading factors.
 *
 * @param {{symbol:string, name:string, factor:string, roc1m:number, roc3m:number, momentumScore:number}[]} factors
 * @returns {{ranked:any[], leading:string, trailing:string, rotation:string[]}}
 */
export function computeFactorMomentum(factors) {
  const valid = factors.filter((f) => f.momentumScore != null);
  if (!valid.length) return { ranked: [], leading: null, trailing: null, rotation: [] };

  // Rank by 3-month ROC (primary signal for factor rotation)
  const ranked = [...valid].sort((a, b) => (b.roc3m ?? -Infinity) - (a.roc3m ?? -Infinity));

  ranked.forEach((f, i) => { f.factorRank = i + 1; });

  const leading = ranked[0]?.factor ?? null;
  const trailing = ranked[ranked.length - 1]?.factor ?? null;

  // Rotation signal: factors ranked best → worst
  const rotation = ranked.map((f) => f.factor);

  return { ranked, leading, trailing, rotation };
}

// ─── 4. Volume Analysis ──────────────────────────────────

/**
 * Analyze volume patterns relative to price action.
 * - Volume-price confirmation: volume should increase on up days, decrease on down days
 * - Volume spikes: 3x+ average volume = capitulation or absorption
 * - OBV trend: rising OBV = accumulation, falling = distribution
 *
 * @param {{closes:number[], volumes:number[], highs:number[], lows:number[]}} history
 * @returns {object} volume analysis
 */
export function computeVolumeAnalysis(history) {
  const { closes, volumes } = history;
  if (!closes || !volumes || closes.length < 30 || closes.length !== volumes.length) {
    return { insufficientData: true };
  }

  const avgVol20 = avgVolume(volumes, 20);
  const lastVol = volumes[volumes.length - 1];
  const volRatio = avgVol20 && avgVol20 > 0 ? lastVol / avgVol20 : null;

  // Volume-price confirmation over last 20 bars
  let upVol = 0;
  let downVol = 0;
  let upDays = 0;
  let downDays = 0;
  const lookback = Math.min(20, closes.length - 1);
  for (let i = closes.length - lookback; i < closes.length; i++) {
    if (closes[i] > closes[i - 1]) {
      upVol += volumes[i];
      upDays++;
    } else if (closes[i] < closes[i - 1]) {
      downVol += volumes[i];
      downDays++;
    }
  }
  const totalVol = upVol + downVol;
  const upVolPct = totalVol > 0 ? (upVol / totalVol) * 100 : 50;

  // Confirmation: upVolPct > 55 = confirmed bullish, < 45 = confirmed bearish
  let confirmation = 'neutral';
  if (upVolPct > 60) confirmation = 'strong bullish';
  else if (upVolPct > 55) confirmation = 'bullish';
  else if (upVolPct < 40) confirmation = 'strong bearish';
  else if (upVolPct < 45) confirmation = 'bearish';

  // Volume spike detection (last 5 bars)
  const spikes = [];
  if (avgVol20 && avgVol20 > 0) {
    for (let i = Math.max(1, closes.length - 5); i < closes.length; i++) {
      const ratio = volumes[i] / avgVol20;
      if (ratio >= 3) {
        const priceUp = closes[i] > closes[i - 1];
        spikes.push({
          bar: i,
          volume: volumes[i],
          ratio: +ratio.toFixed(1),
          interpretation: priceUp ? 'absorption (buying on high volume)' : 'capitulation (selling on high volume)',
          priceUp,
        });
      }
    }
  }

  // OBV trend
  const obvSeries = obv(closes, volumes);
  const obvLast = obvSeries[obvSeries.length - 1];
  const obv20ago = obvSeries[Math.max(0, obvSeries.length - 21)];
  const obvTrend = obvLast > obv20ago ? 'rising (accumulation)' : obvLast < obv20ago ? 'falling (distribution)' : 'flat';

  // Volume trend (last 20 vs prior 20)
  const recentVol = avgVolume(volumes.slice(-20), 20) || 0;
  const priorVol = avgVolume(volumes.slice(-40, -20), 20) || 0;
  const volTrend = priorVol > 0 ? ((recentVol - priorVol) / priorVol) * 100 : 0;

  return {
    avgVol20,
    lastVol,
    volRatio: volRatio ? +volRatio.toFixed(2) : null,
    upVolPct: +upVolPct.toFixed(1),
    downVolPct: +(100 - upVolPct).toFixed(1),
    confirmation,
    spikes,
    obvTrend,
    obv: obvLast,
    volTrend: +volTrend.toFixed(1),
    upDays,
    downDays,
  };
}

// ─── Full Asset Analysis ─────────────────────────────────

/**
 * Compute the complete momentum + volume profile for a single asset.
 * @param {{closes:number[], highs:number[], lows:number[], volumes:number[]} history
 * @param {{symbol:string, name:string}} meta
 * @returns {object} combined analysis
 */
export function analyzeAsset(history, meta) {
  const tsm = computeTimeSeriesMomentum(history);
  const vol = computeVolumeAnalysis(history);
  return {
    symbol: meta.symbol,
    name: meta.name,
    timeSeries: tsm,
    volume: vol,
    momentumScore: tsm.momentumScore ?? null,
    roc3m: tsm.roc3m ?? null,
    roc6m: tsm.roc6m ?? null,
    signal: tsm.signal ?? 'neutral',
    insufficientData: tsm.insufficientData || vol.insufficientData,
  };
}

/**
 * Build the full momentum scan result from a set of asset histories.
 *
 * @param {{symbol:string, name:string, history:{closes:number[],highs:number[],lows:number[],volumes:number[]}}[]} assetsData
 * @param {{symbol:string, name:string, factor:string, history:object}[]} factorData
 * @returns {object} full scan with all 4 momentum types
 */
export function buildMomentumScan(assetsData, factorData = []) {
  // Analyze each asset
  const analyzed = assetsData.map((a) => analyzeAsset(a.history, { symbol: a.symbol, name: a.name }));

  // Cross-sectional momentum (all assets in one basket)
  const crossSectional = computeCrossSectionalMomentum(analyzed);

  // Factor momentum
  const factorAnalyzed = factorData.map((f) => {
    const tsm = computeTimeSeriesMomentum(f.history);
    return {
      symbol: f.symbol,
      name: f.name,
      factor: f.factor,
      momentumScore: tsm.momentumScore ?? null,
      roc1m: tsm.roc1m ?? null,
      roc3m: tsm.roc3m ?? null,
      signal: tsm.signal ?? 'neutral',
    };
  });
  const factorMomentum = computeFactorMomentum(factorAnalyzed);

  // Volume analysis summary
  const volumeSummary = {
    confirmed: analyzed.filter((a) => a.volume?.confirmation?.includes('bullish')).length,
    bearish: analyzed.filter((a) => a.volume?.confirmation?.includes('bearish')).length,
    neutral: analyzed.filter((a) => a.volume?.confirmation === 'neutral').length,
    spikes: analyzed.filter((a) => a.volume?.spikes?.length > 0).length,
  };

  return {
    assets: analyzed,
    crossSectional,
    factorMomentum,
    volumeSummary,
    fetchedAt: new Date().toISOString(),
  };
}
