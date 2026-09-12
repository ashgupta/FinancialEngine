/**
 * CFTC Commitments of Traders (COT) Report Parser & Summarizer
 *
 * Parses the legacy short-format futures-only HTML reports published weekly
 * by the CFTC at:
 *   https://www.cftc.gov/dea/futures/deacmesf.htm  (CME)
 *   https://www.cftc.gov/dea/futures/deacmxsf.htm  (COMEX)
 *   https://www.cftc.gov/dea/futures/deanymesf.htm (NYMEX)
 *   https://www.cftc.gov/dea/futures/deacbtsf.htm  (CBOT)
 *
 * The format is fixed-width text inside <pre>-like blocks. Each contract has:
 *   - Title line: "CONTRACT NAME - EXCHANGE"
 *   - "FUTURES ONLY POSITIONS AS OF MM/DD/YY"
 *   - Header / separator rows
 *   - "(CONTRACTS OF ...) OPEN INTEREST: NNN"
 *   - "COMMITMENTS" row: 9 numbers (NonComm L/S, Spreads, Comm L/S, Total L/S, NonReport L/S)
 *   - "CHANGES FROM MM/DD/YY (CHANGE IN OPEN INTEREST: NNN)" row: 9 numbers
 *   - "PERCENT OF OPEN INTEREST..." row
 *   - "NUMBER OF TRADERS..." row
 */

// ─── Curated key markets ─────────────────────────────────
// Maps the exact contract title (as it appears in the CFTC report) to an
// asset class + display metadata. Only markets in this map are surfaced in
// the summary; the parser still returns everything for completeness.
export const KEY_MARKETS = {
  // Equities (CME)
  'E-MINI S&P 500 - CHICAGO MERCANTILE EXCHANGE': { assetClass: 'Equities', display: 'E-Mini S&P 500', symbol: 'ES=F' },
  'MICRO E-MINI NASDAQ-100 INDEX - CHICAGO MERCANTILE EXCHANGE': { assetClass: 'Equities', display: 'Micro E-Mini Nasdaq-100', symbol: 'NQ=F' },
  'DJIA Consolidated - CHICAGO BOARD OF TRADE': { assetClass: 'Equities', display: 'DJIA', symbol: 'YM=F' },

  // FX (CME)
  'EURO FX - CHICAGO MERCANTILE EXCHANGE': { assetClass: 'FX', display: 'Euro FX', symbol: 'EURUSD=X' },
  'JAPANESE YEN - CHICAGO MERCANTILE EXCHANGE': { assetClass: 'FX', display: 'Japanese Yen', symbol: 'JPY=X' },
  'BRITISH POUND - CHICAGO MERCANTILE EXCHANGE': { assetClass: 'FX', display: 'British Pound', symbol: 'GBPUSD=X' },
  'CANADIAN DOLLAR - CHICAGO MERCANTILE EXCHANGE': { assetClass: 'FX', display: 'Canadian Dollar', symbol: 'CAD=X' },
  'SWISS FRANC - CHICAGO MERCANTILE EXCHANGE': { assetClass: 'FX', display: 'Swiss Franc', symbol: 'CHF=X' },
  'AUSTRALIAN DOLLAR - CHICAGO MERCANTILE EXCHANGE': { assetClass: 'FX', display: 'Australian Dollar', symbol: 'AUD=X' },
  'MEXICAN PESO - CHICAGO MERCANTILE EXCHANGE': { assetClass: 'FX', display: 'Mexican Peso', symbol: 'MXN=X' },
  'BITCOIN - CHICAGO MERCANTILE EXCHANGE': { assetClass: 'FX', display: 'Bitcoin', symbol: 'BTC=F' },

  // Metals (COMEX)
  'GOLD - COMMODITY EXCHANGE INC.': { assetClass: 'Metals', display: 'Gold', symbol: 'GC=F' },
  'SILVER - COMMODITY EXCHANGE INC.': { assetClass: 'Metals', display: 'Silver', symbol: 'SI=F' },
  'COPPER- #1 - COMMODITY EXCHANGE INC.': { assetClass: 'Metals', display: 'Copper', symbol: 'HG=F' },

  // Energy (NYMEX)
  'WTI-PHYSICAL - NEW YORK MERCANTILE EXCHANGE': { assetClass: 'Energy', display: 'WTI Crude Oil', symbol: 'CL=F' },
  'NAT GAS NYME - NEW YORK MERCANTILE EXCHANGE': { assetClass: 'Energy', display: 'Natural Gas', symbol: 'NG=F' },
  'NY HARBOR ULSD - NEW YORK MERCANTILE EXCHANGE': { assetClass: 'Energy', display: 'NY Harbor ULSD (Diesel)', symbol: 'HO=F' },

  // Treasuries (CBOT)
  'UST BOND - CHICAGO BOARD OF TRADE': { assetClass: 'Rates', display: '30Y UST Bond', symbol: 'ZB=F' },
  'ULTRA UST BOND - CHICAGO BOARD OF TRADE': { assetClass: 'Rates', display: 'Ultra UST Bond', symbol: 'UB=F' },
  'UST 10Y NOTE - CHICAGO BOARD OF TRADE': { assetClass: 'Rates', display: '10Y UST Note', symbol: 'ZN=F' },
  'UST 5Y NOTE - CHICAGO BOARD OF TRADE': { assetClass: 'Rates', display: '5Y UST Note', symbol: 'ZF=F' },
  'UST 2Y NOTE - CHICAGO BOARD OF TRADE': { assetClass: 'Rates', display: '2Y UST Note', symbol: 'ZT=F' },

  // Agriculture (CBOT)
  'CORN - CHICAGO BOARD OF TRADE': { assetClass: 'Agriculture', display: 'Corn', symbol: 'ZC=F' },
  'SOYBEANS - CHICAGO BOARD OF TRADE': { assetClass: 'Agriculture', display: 'Soybeans', symbol: 'ZS=F' },
  'SOYBEAN OIL - CHICAGO BOARD OF TRADE': { assetClass: 'Agriculture', display: 'Soybean Oil', symbol: 'ZL=F' },
  'SOYBEAN MEAL - CHICAGO BOARD OF TRADE': { assetClass: 'Agriculture', display: 'Soybean Meal', symbol: 'ZM=F' },
  'WHEAT-SRW - CHICAGO BOARD OF TRADE': { assetClass: 'Agriculture', display: 'Wheat (SRW)', symbol: 'ZW=F' },
  'WHEAT-HRW - CHICAGO BOARD OF TRADE': { assetClass: 'Agriculture', display: 'Wheat (HRW)', symbol: 'KE=F' },

  // Livestock (CME)
  'LIVE CATTLE - CHICAGO MERCANTILE EXCHANGE': { assetClass: 'Livestock', display: 'Live Cattle', symbol: 'LE=F' },
  'LEAN HOGS - CHICAGO MERCANTILE EXCHANGE': { assetClass: 'Livestock', display: 'Lean Hogs', symbol: 'HE=F' },
};

export const ASSET_CLASSES = ['Equities', 'FX', 'Metals', 'Energy', 'Rates', 'Agriculture', 'Livestock'];

// ─── Parser ──────────────────────────────────────────────

/**
 * Extract all integer/float tokens from a line of text.
 * CFTC numbers may be comma-separated and can include "." for missing.
 * @param {string} line
 * @returns {number[]} parsed numbers (null for ".")
 */
function extractNumbers(line) {
  // Match runs of digits possibly with commas/decimal point; "." alone = missing
  const tokens = line.trim().split(/\s+/);
  return tokens.map((t) => {
    if (t === '.' || t === '') return null;
    const cleaned = t.replace(/,/g, '');
    const n = Number(cleaned);
    return Number.isFinite(n) ? n : null;
  }).filter((n) => n !== null);
}

/**
 * Parse a single CFTC report HTML file into an array of contract records.
 * @param {string} html - raw HTML from one of the dea/futures/dea*sf.htm pages
 * @returns {{title:string, asOf:string, openInterest:number, commitments:number[], changes:number[], prevDate:string, changeInOI:number}[]}
 */
export function parseCotReport(html) {
  if (!html || typeof html !== 'string') return [];
  // Strip HTML tags; the report body is plain text inside <pre> or just text.
  const text = html
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\r/g, '');

  const lines = text.split('\n').map((l) => l.trimEnd());
  const records = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];
    // A contract title line contains " - " and an exchange name, and is followed
    // within a few lines by "FUTURES ONLY POSITIONS AS OF".
    if (line.includes(' - ') && (line.includes('EXCHANGE') || line.includes('BOARD OF TRADE'))) {
      // Look ahead for the AS OF marker
      let j = i + 1;
      let asOfLine = null;
      while (j < i + 6 && j < lines.length) {
        const m = lines[j].match(/FUTURES ONLY POSITIONS AS OF\s+(\d{2}\/\d{2}\/\d{2})/);
        if (m) { asOfLine = m; break; }
        j++;
      }
      if (!asOfLine) { i++; continue; }

      const title = line.replace(/\s+Code-\S+.*$/, '').trim();
      const asOf = asOfLine[1];

      // Find OPEN INTEREST line (within next ~10 lines)
      let k = j + 1;
      let oiLine = null;
      while (k < j + 15 && k < lines.length) {
        const m = lines[k].match(/OPEN INTEREST:\s*([\d,]+)/);
        if (m) { oiLine = m; break; }
        k++;
      }
      if (!oiLine) { i = j + 1; continue; }
      const openInterest = parseInt(oiLine[1].replace(/,/g, ''), 10);

      // COMMITMENTS row is the line after "COMMITMENTS"
      let commitIdx = -1;
      for (let m = k; m < k + 8 && m < lines.length; m++) {
        if (lines[m].includes('COMMITMENTS')) { commitIdx = m; break; }
      }
      if (commitIdx < 0) { i = k + 1; continue; }
      const commitLine = lines[commitIdx + 1] || '';
      const commitments = extractNumbers(commitLine);
      if (commitments.length < 9) { i = commitIdx + 2; continue; }

      // CHANGES row
      let changeIdx = -1;
      let prevDate = null;
      let changeInOI = null;
      for (let m = commitIdx + 2; m < commitIdx + 8 && m < lines.length; m++) {
        const cm = lines[m].match(/CHANGES FROM\s+(\d{2}\/\d{2}\/\d{2})\s*\(CHANGE IN OPEN INTEREST:\s*(-?[\d,]+)\)/);
        if (cm) {
          changeIdx = m;
          prevDate = cm[1];
          changeInOI = parseInt(cm[2].replace(/,/g, ''), 10);
          break;
        }
      }
      const changes = changeIdx >= 0 ? extractNumbers(lines[changeIdx + 1] || '') : [];

      records.push({
        title,
        asOf,
        openInterest,
        commitments: commitments.slice(0, 9),
        changes: changes.slice(0, 9),
        prevDate,
        changeInOI,
      });

      i = changeIdx >= 0 ? changeIdx + 2 : commitIdx + 2;
      continue;
    }
    i++;
  }

  return records;
}

// ─── Positioning computation ─────────────────────────────

/**
 * Compute net positioning and derived metrics for a parsed contract record.
 * Non-Commercial = large speculators / hedge funds.
 * Net = NonComm Long - NonComm Short. Positive = net long, negative = net short.
 *
 * @param {{commitments:number[], changes:number[], openInterest:number}} rec
 * @returns {{net:number, netLong:number, netShort:number, spreads:number, commNet:number, weekDelta:number, longPct:number, shortPct:number, oi:number, oiChange:number}}
 */
export function computePositioning(rec) {
  const c = rec.commitments || [];
  const ch = rec.changes || [];
  const [ncLong, ncShort, spreads, commLong, commShort] = c;
  const [ncLongCh, ncShortCh] = ch;
  const oi = rec.openInterest || 0;

  const net = (ncLong || 0) - (ncShort || 0);
  const commNet = (commLong || 0) - (commShort || 0);
  const weekDelta = (ncLongCh || 0) - (ncShortCh || 0);

  return {
    net,
    netLong: ncLong || 0,
    netShort: ncShort || 0,
    spreads: spreads || 0,
    commNet,
    weekDelta,
    longPct: oi ? ((ncLong || 0) / oi) * 100 : 0,
    shortPct: oi ? ((ncShort || 0) / oi) * 100 : 0,
    oi,
    oiChange: rec.changeInOI || 0,
  };
}

/**
 * Classify positioning stance.
 * @param {number} net
 * @param {number} longPct
 * @param {number} shortPct
 * @returns {'heavily long'|'net long'|'neutral'|'net short'|'heavily short'}
 */
export function classifyStance(net, longPct, shortPct) {
  const diff = longPct - shortPct;
  if (diff > 30) return 'heavily long';
  if (diff > 5) return 'net long';
  if (diff < -30) return 'heavily short';
  if (diff < -5) return 'net short';
  return 'neutral';
}

// ─── Summarizer ──────────────────────────────────────────

/**
 * Merge parsed records from multiple exchanges, keep only KEY_MARKETS,
 * compute positioning, and group by asset class.
 *
 * @param {{title:string, asOf:string, openInterest:number, commitments:number[], changes:number[], prevDate:string, changeInOI:number}[]} records
 * @returns {{reportDate:string, prevDate:string, markets:any[], byClass:Record<string,any[]>}}
 */
export function summarizeCot(records) {
  const seen = new Set();
  const markets = [];
  let reportDate = null;
  let prevDate = null;

  for (const rec of records) {
    const meta = KEY_MARKETS[rec.title];
    if (!meta) continue;
    if (seen.has(rec.title)) continue;
    seen.add(rec.title);

    const pos = computePositioning(rec);
    const stance = classifyStance(pos.net, pos.longPct, pos.shortPct);

    if (!reportDate) reportDate = rec.asOf;
    if (!prevDate) prevDate = rec.prevDate;

    markets.push({
      title: rec.title,
      display: meta.display,
      symbol: meta.symbol,
      assetClass: meta.assetClass,
      asOf: rec.asOf,
      ...pos,
      stance,
    });
  }

  // Group by asset class
  const byClass = {};
  for (const ac of ASSET_CLASSES) byClass[ac] = [];
  for (const m of markets) {
    if (byClass[m.assetClass]) byClass[m.assetClass].push(m);
  }

  return { reportDate, prevDate, markets, byClass };
}

/**
 * Generate human-readable key takeaways from the summarized COT data.
 * Highlights: largest net long/short, biggest weekly shifts, stance extremes.
 *
 * @param {{markets:any[], byClass:Record<string,any[]>}} summary
 * @returns {{bullish:string[], bearish:string[], shifts:string[], classSummary:Record<string,string>}[]}
 */
export function generateTakeaways(summary) {
  const { markets, byClass } = summary;
  if (!markets.length) return { bullish: [], bearish: [], shifts: [], classSummary: {} };

  const bullish = [];
  const bearish = [];
  const shifts = [];

  // Top net long / net short by absolute net
  const sorted = [...markets].sort((a, b) => b.net - a.net);
  const topLong = sorted.slice(0, 3);
  const topShort = sorted.slice(-3).reverse();

  for (const m of topLong) {
    if (m.net > 0) {
      bullish.push(`${m.display}: net long ${Math.abs(m.net).toLocaleString()} contracts (${m.longPct.toFixed(1)}% long vs ${m.shortPct.toFixed(1)}% short)`);
    }
  }
  for (const m of topShort) {
    if (m.net < 0) {
      bearish.push(`${m.display}: net short ${Math.abs(m.net).toLocaleString()} contracts (${m.shortPct.toFixed(1)}% short vs ${m.longPct.toFixed(1)}% long)`);
    }
  }

  // Biggest weekly shifts (by |weekDelta|)
  const byShift = [...markets]
    .filter((m) => Math.abs(m.weekDelta) > 0)
    .sort((a, b) => Math.abs(b.weekDelta) - Math.abs(a.weekDelta))
    .slice(0, 5);
  for (const m of byShift) {
    const dir = m.weekDelta > 0 ? 'more long' : 'more short';
    shifts.push(`${m.display}: ${dir} by ${Math.abs(m.weekDelta).toLocaleString()} contracts (wk)`);
  }

  // Per-class one-line summary
  const classSummary = {};
  for (const ac of ASSET_CLASSES) {
    const list = byClass[ac] || [];
    if (!list.length) { classSummary[ac] = 'No data'; continue; }
    const longs = list.filter((m) => m.net > 0).length;
    const shorts = list.filter((m) => m.net < 0).length;
    if (longs > shorts * 1.5) {
      classSummary[ac] = `Broadly net long (${longs} long / ${shorts} short)`;
    } else if (shorts > longs * 1.5) {
      classSummary[ac] = `Broadly net short (${longs} long / ${shorts} short)`;
    } else {
      classSummary[ac] = `Mixed (${longs} long / ${shorts} short)`;
    }
  }

  return { bullish, bearish, shifts, classSummary };
}

// ─── Full pipeline (used by server) ──────────────────────

/**
 * Parse multiple exchange HTML reports and return a full summary + takeaways.
 * @param {{cme?:string, cmx?:string, nym?:string, cbt?:string}} htmls
 * @returns {{reportDate:string, prevDate:string, markets:any[], byClass:Record<string,any[]>, takeaways:any, fetchedAt:string}}
 */
export function buildCotReport(htmls) {
  const all = [];
  for (const html of [htmls.cme, htmls.cmx, htmls.nym, htmls.cbt]) {
    if (html) {
      try {
        all.push(...parseCotReport(html));
      } catch (err) {
        console.error('COT parse error:', err?.message || String(err));
      }
    }
  }
  const summary = summarizeCot(all);
  const takeaways = generateTakeaways(summary);
  return {
    ...summary,
    takeaways,
    fetchedAt: new Date().toISOString(),
  };
}

// ─── Historical / Time-series functions ─────────────────

/**
 * Compute the last N report dates (Tuesdays) ending at or before a reference date.
 * CFTC data is always as of Tuesday. We step back 7 days at a time.
 * @param {string} referenceDate - MM/DD/YY format (latest report's "as of" date)
 * @param {number} weeks - number of weeks to go back (including the reference)
 * @returns {string[]} array of MM/DD/YY dates, oldest first
 */
export function computeReportDates(referenceDate, weeks = 12) {
  if (!referenceDate) return [];
  const m = referenceDate.match(/^(\d{2})\/(\d{2})\/(\d{2})$/);
  if (!m) return [];
  const ref = new Date(2000 + parseInt(m[3], 10), parseInt(m[1], 10) - 1, parseInt(m[2], 10));
  const dates = [];
  for (let i = weeks - 1; i >= 0; i--) {
    const d = new Date(ref);
    d.setDate(d.getDate() - i * 7);
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    const yy = String(d.getFullYear()).slice(-2);
    dates.push(`${mm}/${dd}/${yy}`);
  }
  return dates;
}

/**
 * Build the 4 CFTC archive URLs for a given report date.
 * @param {string} dateStr - MM/DD/YY
 * @returns {{cme:string, cmx:string, nym:string, cbt:string}}
 */
export function buildArchiveUrls(dateStr) {
  const compact = dateStr.replace(/\//g, ''); // MMDDYY
  const m = dateStr.match(/^(\d{2})\/(\d{2})\/(\d{2})$/);
  if (!m) return {};
  const year = `20${m[3]}`;
  const base = `https://www.cftc.gov/sites/default/files/files/dea/cotarchives/${year}/futures`;
  return {
    cme: `${base}/deacmesf${compact}.htm`,
    cmx: `${base}/deacmxsf${compact}.htm`,
    nym: `${base}/deanymesf${compact}.htm`,
    cbt: `${base}/deacbtsf${compact}.htm`,
  };
}

/**
 * Build a per-market time series from multiple weekly reports.
 * Each report is the output of summarizeCot (has .markets array).
 *
 * @param {{date:string, summary:any}[]} reports - array of {date, summary}, oldest first
 * @returns {Record<string, {display:string, assetClass:string, symbol:string, series:{date:string,net:number,netLong:number,netShort:number,oi:number}[]}>}
 */
export function buildTimeSeries(reports) {
  const series = {};
  for (const { date, summary } of reports) {
    if (!summary?.markets) continue;
    for (const m of summary.markets) {
      if (!series[m.title]) {
        series[m.title] = {
          display: m.display,
          assetClass: m.assetClass,
          symbol: m.symbol,
          series: [],
        };
      }
      series[m.title].series.push({
        date,
        net: m.net,
        netLong: m.netLong,
        netShort: m.netShort,
        oi: m.oi,
      });
    }
  }
  return series;
}

/**
 * Compare the current report with a historical report (N weeks ago).
 * Identifies major changes: net delta, percentage change, stance flips,
 * and ranks by absolute shift.
 *
 * @param {any[]} currentMarkets - markets array from current summarizeCot
 * @param {any[]} pastMarkets - markets array from historical summarizeCot
 * @param {number} weeksAgo - how many weeks back the comparison is
 * @returns {{comparisons:any[], flips:any[], topMovers:any[]}}
 */
export function compareWithHistory(currentMarkets, pastMarkets, weeksAgo) {
  const pastMap = new Map();
  for (const m of pastMarkets) pastMap.set(m.title, m);

  const comparisons = [];
  const flips = [];

  for (const curr of currentMarkets) {
    const past = pastMap.get(curr.title);
    if (!past) continue;

    const netDelta = curr.net - past.net;
    const pctChange = past.net !== 0 ? ((netDelta / Math.abs(past.net)) * 100) : 0;
    const oiDelta = curr.oi - past.oi;
    const flipped = (past.net > 0 && curr.net < 0) || (past.net < 0 && curr.net > 0);

    const comp = {
      display: curr.display,
      symbol: curr.symbol,
      assetClass: curr.assetClass,
      title: curr.title,
      currentNet: curr.net,
      pastNet: past.net,
      netDelta,
      pctChange,
      currentStance: curr.stance,
      pastStance: past.stance,
      flipped,
      currentOI: curr.oi,
      pastOI: past.oi,
      oiDelta,
      weeksAgo,
    };
    comparisons.push(comp);
    if (flipped) flips.push(comp);
  }

  // Top movers by absolute net delta
  const topMovers = [...comparisons]
    .sort((a, b) => Math.abs(b.netDelta) - Math.abs(a.netDelta))
    .slice(0, 10);

  return { comparisons, flips, topMovers, weeksAgo };
}

/**
 * Build a full historical report: fetch 12 weeks, parse, build time series,
 * compare current vs 12 weeks ago.
 *
 * @param {{date:string, htmls:{cme:string,cmx:string,nym:string,cbt:string}}[]} historicalRaw
 *   Array of {date, htmls} for each week, oldest first. htmls values are raw HTML strings.
 * @param {any} currentSummary - the current week's summarizeCot output
 * @returns {{timeSeries:any, comparison:any, weeksCovered:number}}
 */
export function buildHistoricalReport(historicalRaw, currentSummary) {
  const reports = [];
  for (const { date, htmls } of historicalRaw) {
    try {
      const all = [];
      for (const html of [htmls.cme, htmls.cmx, htmls.nym, htmls.cbt]) {
        if (html) all.push(...parseCotReport(html));
      }
      const summary = summarizeCot(all);
      if (summary.markets.length) {
        reports.push({ date, summary });
      }
    } catch (err) {
      console.error(`COT historical parse error for ${date}:`, err?.message || String(err));
    }
  }

  // Add current week as the latest data point
  if (currentSummary?.markets?.length) {
    reports.push({ date: currentSummary.reportDate, summary: currentSummary });
  }

  const timeSeries = buildTimeSeries(reports);

  // Compare current vs oldest available historical report
  let comparison = { comparisons: [], flips: [], topMovers: [] };
  if (reports.length >= 2) {
    const oldest = reports[0];
    const latest = reports[reports.length - 1];
    const weeksAgo = reports.length - 1;
    comparison = compareWithHistory(latest.summary.markets, oldest.summary.markets, weeksAgo);
  }

  return {
    timeSeries,
    comparison,
    weeksCovered: reports.length,
    dates: reports.map((r) => r.date),
  };
}
