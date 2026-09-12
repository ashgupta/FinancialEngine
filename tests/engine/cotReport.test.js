import { describe, it, expect } from 'vitest';
import {
  parseCotReport,
  computePositioning,
  classifyStance,
  summarizeCot,
  generateTakeaways,
  buildCotReport,
  KEY_MARKETS,
  ASSET_CLASSES,
} from '../../src/engine/cotReport.js';

// ─── Synthetic CFTC-format HTML fixture ─────────────────
// Mimics the structure of the real deacmesf.htm / deacbtsf.htm reports.
const SAMPLE_CME = `
<pre>
GOLD - COMMODITY EXCHANGE INC.                                       Code-088691
FUTURES ONLY POSITIONS AS OF 06/23/26                         |
--------------------------------------------------------------| NONREPORTABLE
      NON-COMMERCIAL      |   COMMERCIAL    |      TOTAL      |   POSITIONS
--------------------------|-----------------|-----------------|-----------------
  LONG  | SHORT  |SPREADS |  LONG  | SHORT  |  LONG  | SHORT  |  LONG  | SHORT
--------------------------------------------------------------------------------
(CONTRACTS OF 100 TROY OUNCES)                       OPEN INTEREST:      352,167
COMMITMENTS
 217,028   35,689   31,295   64,579  269,983  312,902  336,967   39,265   15,200

CHANGES FROM 06/16/26 (CHANGE IN OPEN INTEREST:     12,837)
   5,901    4,782    5,278    6,359    4,200   17,538   14,260   -4,701   -1,423

PERCENT OF OPEN INTEREST FOR EACH CATEGORY OF TRADERS
    61.6     10.1      8.9     18.3     76.7     88.9     95.7     11.1      4.3

NUMBER OF TRADERS IN EACH CATEGORY (TOTAL TRADERS:      282)
     152       61       69       45       46      227      151


E-MINI S&P 500 - CHICAGO MERCANTILE EXCHANGE                         Code-13874A
FUTURES ONLY POSITIONS AS OF 06/23/26                         |
--------------------------------------------------------------| NONREPORTABLE
      NON-COMMERCIAL      |   COMMERCIAL    |      TOTAL      |   POSITIONS
--------------------------|-----------------|-----------------|-----------------
  LONG  | SHORT  |SPREADS |  LONG  | SHORT  |  LONG  | SHORT  |  LONG  | SHORT
--------------------------------------------------------------------------------
($50 X S&P 500 INDEX)                                OPEN INTEREST:    1,980,254
COMMITMENTS
 251,385  286,833   24,622 1444102 1531232 1720109 1842687  260,145  137,567

CHANGES FROM 06/16/26 (CHANGE IN OPEN INTEREST:   -599,666)
 -10,985 -169,515  -54,980 -500,450 -353,117 -566,415 -577,612  -33,251  -22,054

PERCENT OF OPEN INTEREST FOR EACH CATEGORY OF TRADERS
    12.7     14.5      1.2     72.9     77.3     86.9     93.1     13.1      6.9

NUMBER OF TRADERS IN EACH CATEGORY (TOTAL TRADERS:      433)
      65       62       35      240      182      324      260
</pre>
`;

const SAMPLE_CBT = `
<pre>
UST 10Y NOTE - CHICAGO BOARD OF TRADE                                Code-043602
FUTURES ONLY POSITIONS AS OF 06/23/26                         |
--------------------------------------------------------------| NONREPORTABLE
      NON-COMMERCIAL      |   COMMERCIAL    |      TOTAL      |   POSITIONS
--------------------------|-----------------|-----------------|-----------------
  LONG  | SHORT  |SPREADS |  LONG  | SHORT  |  LONG  | SHORT  |  LONG  | SHORT
--------------------------------------------------------------------------------
(CONTRACTS OF $100,000 FACE VALUE)                   OPEN INTEREST:    5,271,748
COMMITMENTS
 506,918 1342184   85,150 4298422 3472228 4890490 4899562  381,258  372,186

CHANGES FROM 06/16/26 (CHANGE IN OPEN INTEREST:    -52,842)
  34,874  -40,942  -25,057 -49,207   15,930 -39,390 -50,069 -13,452   -2,773

PERCENT OF OPEN INTEREST FOR EACH CATEGORY OF TRADERS
     9.6     25.5      1.6     81.5     65.9     92.8     92.9      7.2      7.1

NUMBER OF TRADERS IN EACH CATEGORY (TOTAL TRADERS:      432)
      69       76       37      213      204      306      293
</pre>
`;

// ─── Parser tests ───────────────────────────────────────
describe('parseCotReport', () => {
  it('returns empty array for null/undefined input', () => {
    expect(parseCotReport(null)).toEqual([]);
    expect(parseCotReport(undefined)).toEqual([]);
    expect(parseCotReport('')).toEqual([]);
  });

  it('parses multiple contracts from CME sample', () => {
    const records = parseCotReport(SAMPLE_CME);
    expect(records.length).toBe(2);

    const gold = records.find((r) => r.title.includes('GOLD'));
    expect(gold).toBeDefined();
    expect(gold.asOf).toBe('06/23/26');
    expect(gold.openInterest).toBe(352167);
    expect(gold.prevDate).toBe('06/16/26');
    expect(gold.changeInOI).toBe(12837);
    expect(gold.commitments.length).toBe(9);
    expect(gold.commitments[0]).toBe(217028);  // NonComm Long
    expect(gold.commitments[1]).toBe(35689);   // NonComm Short
    expect(gold.changes.length).toBe(9);
    expect(gold.changes[0]).toBe(5901);
  });

  it('parses E-Mini S&P with comma-separated numbers', () => {
    const records = parseCotReport(SAMPLE_CME);
    const es = records.find((r) => r.title.includes('E-MINI S&P 500'));
    expect(es).toBeDefined();
    expect(es.openInterest).toBe(1980254);
    expect(es.commitments[0]).toBe(251385);
    expect(es.commitments[3]).toBe(1444102); // Comm Long with no comma in source
    expect(es.changeInOI).toBe(-599666);
  });

  it('parses CBOT Treasury notes', () => {
    const records = parseCotReport(SAMPLE_CBT);
    expect(records.length).toBe(1);
    const tenYear = records[0];
    expect(tenYear.title).toContain('UST 10Y NOTE');
    expect(tenYear.openInterest).toBe(5271748);
    expect(tenYear.commitments[0]).toBe(506918);
    expect(tenYear.commitments[1]).toBe(1342184);
  });
});

// ─── Positioning computation tests ──────────────────────
describe('computePositioning', () => {
  it('computes net long for gold', () => {
    const rec = {
      commitments: [217028, 35689, 31295, 64579, 269983],
      changes: [5901, 4782, 5278, 6359, 4200],
      openInterest: 352167,
      changeInOI: 12837,
    };
    const pos = computePositioning(rec);
    expect(pos.net).toBe(217028 - 35689);
    expect(pos.netLong).toBe(217028);
    expect(pos.netShort).toBe(35689);
    expect(pos.commNet).toBe(64579 - 269983);
    expect(pos.weekDelta).toBe(5901 - 4782);
    expect(pos.oi).toBe(352167);
    expect(pos.longPct).toBeCloseTo(61.6, 1);
    expect(pos.shortPct).toBeCloseTo(10.1, 1);
  });

  it('computes net short for S&P 500', () => {
    const rec = {
      commitments: [251385, 286833, 24622, 1444102, 1531232],
      changes: [-10985, -169515, -54980, -500450, -353117],
      openInterest: 1980254,
      changeInOI: -599666,
    };
    const pos = computePositioning(rec);
    expect(pos.net).toBe(251385 - 286833);
    expect(pos.net).toBeLessThan(0);
    expect(pos.weekDelta).toBe(-10985 - (-169515));
    expect(pos.weekDelta).toBeGreaterThan(0); // shorts cut more than longs
  });

  it('handles missing/zero values gracefully', () => {
    const pos = computePositioning({ commitments: [], changes: [], openInterest: 0 });
    expect(pos.net).toBe(0);
    expect(pos.longPct).toBe(0);
  });
});

// ─── Stance classification tests ────────────────────────
describe('classifyStance', () => {
  it('classifies heavily long', () => {
    expect(classifyStance(100000, 65, 5)).toBe('heavily long');
  });
  it('classifies net long', () => {
    expect(classifyStance(10000, 30, 20)).toBe('net long');
  });
  it('classifies neutral', () => {
    expect(classifyStance(100, 15, 14)).toBe('neutral');
  });
  it('classifies net short', () => {
    expect(classifyStance(-10000, 20, 30)).toBe('net short');
  });
  it('classifies heavily short', () => {
    expect(classifyStance(-100000, 5, 65)).toBe('heavily short');
  });
});

// ─── Summarizer tests ───────────────────────────────────
describe('summarizeCot', () => {
  it('filters to KEY_MARKETS and groups by asset class', () => {
    const all = [
      ...parseCotReport(SAMPLE_CME),
      ...parseCotReport(SAMPLE_CBT),
    ];
    const summary = summarizeCot(all);
    expect(summary.reportDate).toBe('06/23/26');
    expect(summary.prevDate).toBe('06/16/26');
    expect(summary.markets.length).toBe(3); // Gold, ES, 10Y

    const gold = summary.markets.find((m) => m.display === 'Gold');
    expect(gold).toBeDefined();
    expect(gold.assetClass).toBe('Metals');
    expect(gold.stance).toBe('heavily long');

    const es = summary.markets.find((m) => m.display === 'E-Mini S&P 500');
    expect(es).toBeDefined();
    expect(es.assetClass).toBe('Equities');
    expect(es.stance).toBe('neutral'); // 12.7% long vs 14.5% short, diff < 5

    const tenYear = summary.markets.find((m) => m.display === '10Y UST Note');
    expect(tenYear).toBeDefined();
    expect(tenYear.assetClass).toBe('Rates');
    expect(tenYear.stance).toBe('net short');

    expect(summary.byClass.Metals.length).toBe(1);
    expect(summary.byClass.Equities.length).toBe(1);
    expect(summary.byClass.Rates.length).toBe(1);
  });

  it('deduplicates repeated titles', () => {
    const records = [...parseCotReport(SAMPLE_CME), ...parseCotReport(SAMPLE_CME)];
    const summary = summarizeCot(records);
    expect(summary.markets.length).toBe(2); // not 4
  });
});

// ─── Takeaways tests ────────────────────────────────────
describe('generateTakeaways', () => {
  it('generates bullish/bearish/shifts from summary', () => {
    const all = [...parseCotReport(SAMPLE_CME), ...parseCotReport(SAMPLE_CBT)];
    const summary = summarizeCot(all);
    const takeaways = generateTakeaways(summary);

    expect(takeaways.bullish.length).toBeGreaterThan(0);
    expect(takeaways.bearish.length).toBeGreaterThan(0);
    expect(takeaways.shifts.length).toBeGreaterThan(0);

    // Gold (heavily long) should appear in bullish
    expect(takeaways.bullish.some((t) => t.includes('Gold'))).toBe(true);
    // 10Y (net short) should appear in bearish
    expect(takeaways.bearish.some((t) => t.includes('10Y'))).toBe(true);

    // Class summaries should cover all asset classes
    for (const ac of ASSET_CLASSES) {
      expect(takeaways.classSummary[ac]).toBeDefined();
    }
  });

  it('returns empty arrays for empty markets', () => {
    const takeaways = generateTakeaways({ markets: [], byClass: {} });
    expect(takeaways.bullish).toEqual([]);
    expect(takeaways.bearish).toEqual([]);
  });
});

// ─── Full pipeline tests ────────────────────────────────
describe('buildCotReport', () => {
  it('merges multiple exchanges and returns full report', () => {
    const report = buildCotReport({
      cme: SAMPLE_CME,
      cmx: '',
      nym: '',
      cbt: SAMPLE_CBT,
    });
    expect(report.reportDate).toBe('06/23/26');
    expect(report.markets.length).toBe(3);
    expect(report.byClass.Metals.length).toBe(1);
    expect(report.byClass.Rates.length).toBe(1);
    expect(report.byClass.Equities.length).toBe(1);
    expect(report.takeaways.bullish.length).toBeGreaterThan(0);
    expect(report.fetchedAt).toBeDefined();
  });

  it('handles all-empty input gracefully', () => {
    const report = buildCotReport({});
    expect(report.markets).toEqual([]);
    expect(report.reportDate).toBeNull();
  });
});

// ─── Key markets registry tests ─────────────────────────
describe('KEY_MARKETS', () => {
  it('covers all asset classes', () => {
    const classes = new Set(Object.values(KEY_MARKETS).map((m) => m.assetClass));
    for (const ac of ASSET_CLASSES) {
      expect(classes.has(ac)).toBe(true);
    }
  });

  it('has display + symbol for every entry', () => {
    for (const [title, meta] of Object.entries(KEY_MARKETS)) {
      expect(meta.display).toBeTruthy();
      expect(meta.symbol).toBeTruthy();
      expect(meta.assetClass).toBeTruthy();
    }
  });
});

// ─── Historical / Time-series tests ─────────────────────
import {
  computeReportDates,
  buildArchiveUrls,
  buildTimeSeries,
  compareWithHistory,
  buildHistoricalReport,
} from '../../src/engine/cotReport.js';

describe('computeReportDates', () => {
  it('computes N weekly dates ending at reference', () => {
    const dates = computeReportDates('06/23/26', 4);
    expect(dates.length).toBe(4);
    expect(dates[3]).toBe('06/23/26'); // latest last
    expect(dates[0]).toBe('06/02/26'); // 3 weeks before
  });

  it('computes 12 weeks by default', () => {
    const dates = computeReportDates('06/23/26');
    expect(dates.length).toBe(12);
    expect(dates[11]).toBe('06/23/26');
    expect(dates[0]).toBe('04/07/26'); // 11 weeks before
  });

  it('returns empty for invalid input', () => {
    expect(computeReportDates(null)).toEqual([]);
    expect(computeReportDates('')).toEqual([]);
    expect(computeReportDates('invalid')).toEqual([]);
  });

  it('handles year boundary', () => {
    const dates = computeReportDates('01/05/26', 3);
    expect(dates.length).toBe(3);
    expect(dates[2]).toBe('01/05/26');
    expect(dates[0]).toBe('12/22/25'); // crosses into 2025
  });
});

describe('buildArchiveUrls', () => {
  it('builds 4 CFTC archive URLs for a date', () => {
    const urls = buildArchiveUrls('06/23/26');
    expect(urls.cme).toBe('https://www.cftc.gov/sites/default/files/files/dea/cotarchives/2026/futures/deacmesf062326.htm');
    expect(urls.cmx).toBe('https://www.cftc.gov/sites/default/files/files/dea/cotarchives/2026/futures/deacmxsf062326.htm');
    expect(urls.nym).toBe('https://www.cftc.gov/sites/default/files/files/dea/cotarchives/2026/futures/deanymesf062326.htm');
    expect(urls.cbt).toBe('https://www.cftc.gov/sites/default/files/files/dea/cotarchives/2026/futures/deacbtsf062326.htm');
  });

  it('returns empty object for invalid date', () => {
    expect(buildArchiveUrls('bad')).toEqual({});
  });
});

describe('buildTimeSeries', () => {
  it('builds per-market time series from multiple reports', () => {
    const reports = [
      {
        date: '06/02/26',
        summary: {
          markets: [
            { title: 'GOLD - COMMODITY EXCHANGE INC.', display: 'Gold', assetClass: 'Metals', symbol: 'GC=F', net: 180000, netLong: 200000, netShort: 20000, oi: 340000 },
            { title: 'E-MINI S&P 500 - CHICAGO MERCANTILE EXCHANGE', display: 'ES', assetClass: 'Equities', symbol: 'ES=F', net: -30000, netLong: 250000, netShort: 280000, oi: 2000000 },
          ],
        },
      },
      {
        date: '06/23/26',
        summary: {
          markets: [
            { title: 'GOLD - COMMODITY EXCHANGE INC.', display: 'Gold', assetClass: 'Metals', symbol: 'GC=F', net: 217028, netLong: 217028, netShort: 35689, oi: 352167 },
            { title: 'E-MINI S&P 500 - CHICAGO MERCANTILE EXCHANGE', display: 'ES', assetClass: 'Equities', symbol: 'ES=F', net: -35448, netLong: 251385, netShort: 286833, oi: 1980254 },
          ],
        },
      },
    ];

    const ts = buildTimeSeries(reports);
    expect(Object.keys(ts).length).toBe(2);

    const gold = ts['GOLD - COMMODITY EXCHANGE INC.'];
    expect(gold.display).toBe('Gold');
    expect(gold.series.length).toBe(2);
    expect(gold.series[0].net).toBe(180000);
    expect(gold.series[1].net).toBe(217028);
  });

  it('handles empty reports', () => {
    expect(buildTimeSeries([])).toEqual({});
  });
});

describe('compareWithHistory', () => {
  const currentMarkets = [
    { title: 'GOLD - COMMODITY EXCHANGE INC.', display: 'Gold', assetClass: 'Metals', symbol: 'GC=F', net: 217028, stance: 'heavily long', oi: 352167 },
    { title: 'E-MINI S&P 500 - CHICAGO MERCANTILE EXCHANGE', display: 'ES', assetClass: 'Equities', symbol: 'ES=F', net: -35448, stance: 'neutral', oi: 1980254 },
    { title: 'UST 10Y NOTE - CHICAGO BOARD OF TRADE', display: '10Y', assetClass: 'Rates', symbol: 'ZN=F', net: -835266, stance: 'net short', oi: 5271748 },
  ];
  const pastMarkets = [
    { title: 'GOLD - COMMODITY EXCHANGE INC.', display: 'Gold', assetClass: 'Metals', symbol: 'GC=F', net: 180000, stance: 'heavily long', oi: 340000 },
    { title: 'E-MINI S&P 500 - CHICAGO MERCANTILE EXCHANGE', display: 'ES', assetClass: 'Equities', symbol: 'ES=F', net: 50000, stance: 'net long', oi: 2100000 },
    { title: 'UST 10Y NOTE - CHICAGO BOARD OF TRADE', display: '10Y', assetClass: 'Rates', symbol: 'ZN=F', net: -700000, stance: 'net short', oi: 5200000 },
  ];

  it('computes net delta and pct change for each market', () => {
    const { comparisons } = compareWithHistory(currentMarkets, pastMarkets, 12);
    expect(comparisons.length).toBe(3);

    const gold = comparisons.find((c) => c.display === 'Gold');
    expect(gold.netDelta).toBe(217028 - 180000);
    expect(gold.pctChange).toBeCloseTo(((217028 - 180000) / 180000) * 100, 1);
    expect(gold.flipped).toBe(false);

    const es = comparisons.find((c) => c.display === 'ES');
    expect(es.netDelta).toBe(-35448 - 50000);
    expect(es.flipped).toBe(true); // was long, now short
  });

  it('identifies stance flips', () => {
    const { flips } = compareWithHistory(currentMarkets, pastMarkets, 12);
    expect(flips.length).toBe(1);
    expect(flips[0].display).toBe('ES');
  });

  it('ranks top movers by absolute net delta', () => {
    const { topMovers } = compareWithHistory(currentMarkets, pastMarkets, 12);
    expect(topMovers.length).toBe(3);
    // 10Y has the biggest absolute delta: -835266 - (-700000) = -135266
    // ES: -35448 - 50000 = -85448
    // Gold: 217028 - 180000 = 37028
    expect(Math.abs(topMovers[0].netDelta)).toBeGreaterThanOrEqual(Math.abs(topMovers[1].netDelta));
  });

  it('handles markets only in current (no past match)', () => {
    const { comparisons } = compareWithHistory(
      [...currentMarkets, { title: 'NEW MARKET', display: 'New', net: 1000, oi: 5000 }],
      pastMarkets,
      12,
    );
    // NEW MARKET has no past, so it's excluded
    expect(comparisons.length).toBe(3);
  });
});

describe('buildHistoricalReport', () => {
  it('builds time series and comparison from historical raw data', () => {
    const historicalRaw = [
      {
        date: '06/02/26',
        htmls: { cme: SAMPLE_CME, cmx: '', nym: '', cbt: SAMPLE_CBT },
      },
    ];
    const currentSummary = summarizeCot([
      ...parseCotReport(SAMPLE_CME),
      ...parseCotReport(SAMPLE_CBT),
    ]);

    const result = buildHistoricalReport(historicalRaw, currentSummary);
    expect(result.weeksCovered).toBe(2); // 1 historical + 1 current
    expect(result.dates.length).toBe(2);
    expect(result.dates[0]).toBe('06/02/26');
    expect(result.dates[1]).toBe('06/23/26');

    // Time series should have entries for Gold, ES, 10Y
    expect(Object.keys(result.timeSeries).length).toBe(3);

    // Comparison should have 3 markets
    expect(result.comparison.comparisons.length).toBe(3);
    expect(result.comparison.weeksAgo).toBe(1);
  });

  it('handles empty historical data', () => {
    const result = buildHistoricalReport([], null);
    expect(result.weeksCovered).toBe(0);
    expect(result.timeSeries).toEqual({});
    expect(result.comparison.comparisons).toEqual([]);
  });

  it('handles parse failures gracefully', () => {
    const historicalRaw = [
      { date: '06/02/26', htmls: { cme: 'garbage', cmx: '', nym: '', cbt: '' } },
    ];
    const currentSummary = summarizeCot([...parseCotReport(SAMPLE_CME)]);

    const result = buildHistoricalReport(historicalRaw, currentSummary);
    // Historical parse produced no markets, but current is still added
    expect(result.weeksCovered).toBe(1);
  });
});
