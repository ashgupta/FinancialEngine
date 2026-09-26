import { fetchQuotes, fetchAllFutures, fetchMarketSnapshot } from './marketData';
import { fetchSocialAll } from './socialAggregator';

const GLOBAL_INDICES = [
  { symbol: '^GSPC', name: 'S&P 500' },
  { symbol: '^DJI', name: 'Dow Jones' },
  { symbol: '^IXIC', name: 'NASDAQ' },
  { symbol: '^RUT', name: 'Russell 2000' }
];

const SYSTEM_PROMPT = `You are a concise, highly knowledgeable financial assistant embedded in a personal finance workbench.
You have access to real-time data from ALL sections of the app, provided below in the context.
This includes: global market indices, watchlist quotes, futures, COT (Commitments of Traders) reports,
momentum scans, sector rotation analysis, volatility analysis, social media sentiment, and options data.

Your job is to answer the user's questions using the real-time data provided in the context.
Do not hallucinate data. If the data is not in the context, say you don't have it right now.
Keep your answers brief, analytical, and easy to read. Use bullet points where appropriate.
When referencing numbers, always cite the specific data point from the context.
If the user asks about a topic covered in the data, provide specific insights from that data.
You can cross-reference data sources (e.g., relate momentum signals to COT positioning, or
volatility levels to options strategies).`;

export async function buildMarketContext(watchlistSymbols = []) {
  const contextParts = [SYSTEM_PROMPT];
  const dataSources = [];

  // Helper: safe fetch with timeout
  const safeFetch = async (url, opts = {}) => {
    try {
      const res = await fetch(url, { ...opts, signal: AbortSignal.timeout(15000) });
      if (!res.ok) return null;
      return await res.json();
    } catch { return null; }
  };

  // Run all independent fetches in parallel
  const [
    indicesMap, watchlistMap, futuresData, marketSnap,
    cotReport, cotHistory, momentumScan, sectorScan, volatilityScan,
    crashScan, crashThesis,
  ] = await Promise.all([
    // 1. Global indices
    fetchQuotes(GLOBAL_INDICES.map(idx => idx.symbol)).catch(() => new Map()),
    // 2. Watchlist quotes
    watchlistSymbols.length > 0 ? fetchQuotes(watchlistSymbols).catch(() => new Map()) : Promise.resolve(new Map()),
    // 3. Futures
    fetchAllFutures().catch(() => null),
    // 4. Market snapshot (world markets)
    fetchMarketSnapshot().catch(() => null),
    // 5. COT report
    safeFetch('/cot/report'),
    // 6. COT history (12-week trend)
    safeFetch('/cot/history'),
    // 7. Momentum scan
    safeFetch('/momentum/scan'),
    // 8. Sector rotation scan
    safeFetch('/sector/scan'),
    // 9. Volatility scan
    safeFetch('/volatility/scan'),
    // 10. Crash indicator scan
    safeFetch('/crash/scan'),
    // 11. Crash thesis (Cem Karsan playbook)
    safeFetch('/thesis/karsan'),
  ]);

  // 10. Social data for watchlist (separate since it's per-symbol)
  let socialResults = [];
  if (watchlistSymbols.length > 0) {
    socialResults = await Promise.all(
      watchlistSymbols.map(sym => fetchSocialAll(sym).catch(() => []))
    );
  }

  // --- Build context text sections ---

  // 1. Global Indices
  const indicesData = GLOBAL_INDICES.map(idx => {
    const q = indicesMap.get(idx.symbol);
    return q ? { ...q, name: idx.name } : null;
  }).filter(Boolean);

  if (indicesData.length > 0) {
    let text = '--- GLOBAL MARKET INDICES ---\n';
    indicesData.forEach(q => {
      const chg = q.changePercent > 0 ? '+' : '';
      text += `${q.name} (${q.symbol}): ${q.price?.toFixed(2)} (${chg}${q.changePercent?.toFixed(2)}%) | 52wk: ${q.fiftyTwoWeekLow?.toFixed(0)}-${q.fiftyTwoWeekHigh?.toFixed(0)}\n`;
    });
    contextParts.push(text);
    dataSources.push('Global Indices');
  }

  // 2. Watchlist
  if (watchlistSymbols.length > 0) {
    const quotes = watchlistSymbols.map(sym => watchlistMap.get(sym)).filter(Boolean);
    if (quotes.length > 0) {
      let text = '--- WATCHLIST QUOTES ---\n';
      quotes.forEach(q => {
        const chg = q.changePercent > 0 ? '+' : '';
        text += `${q.symbol} (${q.name || '?'}): ${q.price?.toFixed(2)} (${chg}${q.changePercent?.toFixed(2)}%) | Vol: ${q.volume?.toLocaleString()} | MCap: ${q.marketCap ? (q.marketCap / 1e9).toFixed(1) + 'B' : 'N/A'} | 50d MA: ${q.fiftyDayAvg?.toFixed(2)} | 200d MA: ${q.twoHundredDayAvg?.toFixed(2)} | 52wk: ${q.fiftyTwoWeekLow?.toFixed(0)}-${q.fiftyTwoWeekHigh?.toFixed(0)}\n`;
      });
      contextParts.push(text);
      dataSources.push('Watchlist');
    }
  }

  // 3. Futures
  if (futuresData) {
    let text = '--- FUTURES MARKETS ---\n';
    const catMap = {
      'Index Futures': futuresData.indexFutures,
      'Commodity Futures': futuresData.commodityFutures,
      'Currency Futures': futuresData.currencyFutures,
      'Bond Futures': futuresData.bondFutures,
    };
    for (const [catName, contracts] of Object.entries(catMap)) {
      if (!contracts || contracts.length === 0) continue;
      text += `[${catName}]\n`;
      contracts.slice(0, 6).forEach(c => {
        const chg = c.changePercent > 0 ? '+' : '';
        text += `  ${c.symbol} (${c.name || '?'}): ${c.price?.toFixed(2)} (${chg}${c.changePercent?.toFixed(2)}%)\n`;
      });
    }
    contextParts.push(text);
    dataSources.push('Futures');
  }

  // 4. World Market Snapshot
  if (marketSnap && marketSnap.indices) {
    let text = '--- WORLD MARKETS SNAPSHOT ---\n';
    const regions = {};
    marketSnap.indices.forEach(i => {
      const r = i.region || 'Other';
      if (!regions[r]) regions[r] = [];
      regions[r].push(i);
    });
    for (const [region, indices] of Object.entries(regions)) {
      text += `[${region}]\n`;
      indices.forEach(i => {
        const chg = i.changePercent > 0 ? '+' : '';
        text += `  ${i.name} (${i.symbol}): ${i.price?.toFixed(0)} (${chg}${i.changePercent?.toFixed(2)}%)\n`;
      });
    }
    if (marketSnap.etfs && marketSnap.etfs.length > 0) {
      text += '[Portfolio ETFs]\n';
      marketSnap.etfs.slice(0, 8).forEach(e => {
        const chg = e.changePercent > 0 ? '+' : '';
        const ret = e.trailingReturn != null ? `, 1Y ret ${e.trailingReturn > 0 ? '+' : ''}${(e.trailingReturn * 100).toFixed(1)}%` : '';
        text += `  ${e.symbol} (${e.name}): ${e.price?.toFixed(2)} (${chg}${e.changePercent?.toFixed(2)}%)${ret}\n`;
      });
    }
    contextParts.push(text);
    dataSources.push('World Markets');
  }

  // 5. COT Report
  if (cotReport && cotReport.markets && cotReport.markets.length > 0) {
    let text = `--- COT REPORT (as of ${cotReport.reportDate}) ---\n`;
    const byClass = cotReport.byClass || {};
    for (const [className, markets] of Object.entries(byClass)) {
      if (!markets || !Array.isArray(markets) || markets.length === 0) continue;
      text += `[${className}]\n`;
      markets.slice(0, 5).forEach(m => {
        text += `  ${m.display || m.title}: net ${m.net > 0 ? 'long' : 'short'} ${Math.abs(m.net).toLocaleString()}, stance=${m.stance}, wk delta=${m.weekDelta > 0 ? '+' : ''}${m.weekDelta?.toLocaleString()}\n`;
      });
    }
    if (cotReport.takeaways) {
      if (cotReport.takeaways.bullish?.length) text += `Bullish: ${cotReport.takeaways.bullish.join('; ')}\n`;
      if (cotReport.takeaways.bearish?.length) text += `Bearish: ${cotReport.takeaways.bearish.join('; ')}\n`;
      if (cotReport.takeaways.shifts?.length) text += `Key shifts: ${cotReport.takeaways.shifts.join('; ')}\n`;
    }
    contextParts.push(text);
    dataSources.push('COT Report');
  }

  // 6. COT History (12-week trend)
  if (cotHistory && cotHistory.timeSeries) {
    let text = '--- COT 12-WEEK TREND ---\n';
    const ts = cotHistory.timeSeries;
    const symbols = Object.keys(ts).slice(0, 10);
    symbols.forEach(sym => {
      const entry = ts[sym];
      const series = entry.series || entry;
      if (!Array.isArray(series) || series.length < 2) return;
      const latest = series[series.length - 1];
      const oldest = series[0];
      const delta = latest.net - oldest.net;
      text += `  ${entry.display || sym}: net ${latest.net > 0 ? 'long' : 'short'} ${Math.abs(latest.net).toLocaleString()}, 12wk change ${delta > 0 ? '+' : ''}${delta.toLocaleString()}\n`;
    });
    contextParts.push(text);
    dataSources.push('COT History');
  }

  // 7. Momentum Scan
  if (momentumScan && momentumScan.assets) {
    let text = '--- MOMENTUM SCAN ---\n';
    const cs = momentumScan.crossSectional;
    if (cs?.ranked) {
      text += 'Cross-sectional ranking (top 5 / bottom 5):\n';
      cs.ranked.slice(0, 5).forEach(a => {
        text += `  ${a.symbol}: momentum ${a.momentumScore > 0 ? '+' : ''}${a.momentumScore?.toFixed(1)}%, signal=${a.signal}\n`;
      });
      text += '  ...\n';
      cs.ranked.slice(-5).forEach(a => {
        text += `  ${a.symbol}: momentum ${a.momentumScore > 0 ? '+' : ''}${a.momentumScore?.toFixed(1)}%, signal=${a.signal}\n`;
      });
    }
    if (momentumScan.factorMomentum?.ranked) {
      text += 'Factor rotation:\n';
      momentumScan.factorMomentum.ranked.forEach(f => {
        text += `  ${f.factor}: 3M ROC ${f.roc3m > 0 ? '+' : ''}${f.roc3m?.toFixed(1)}%\n`;
      });
    }
    if (momentumScan.volumeSummary) {
      const v = momentumScan.volumeSummary;
      text += `Volume: ${v.confirmed} bullish confirmed, ${v.bearish} bearish, ${v.spikes} with spikes\n`;
    }
    contextParts.push(text);
    dataSources.push('Momentum');
  }

  // 8. Sector Rotation
  if (sectorScan && sectorScan.ranked) {
    let text = `--- SECTOR ROTATION (regime: ${sectorScan.regime || '?'}) ---\n`;
    sectorScan.ranked.forEach((s, i) => {
      text += `  ${i + 1}. ${s.symbol} (${s.name || s.sector || '?'}): RS=${s.rsScore?.toFixed(2)}, 1M=${s.roc1m?.toFixed(1) || '?'}%, 3M=${s.roc3m?.toFixed(1) || '?'}%, 6M=${s.roc6m?.toFixed(1) || '?'}%\n`;
    });
    if (sectorScan.rotationSignal) text += `Signal: ${sectorScan.rotationSignal}\n`;
    contextParts.push(text);
    dataSources.push('Sector Rotation');
  }

  // 9. Volatility Scan
  if (volatilityScan && volatilityScan.vixLevel != null) {
    let text = '--- VOLATILITY ANALYSIS ---\n';
    text += `VIX: ${volatilityScan.vixLevel?.toFixed(2)} | Regime: ${volatilityScan.volRegime} | Signal: ${volatilityScan.signal}\n`;
    text += `SPY Realized Vol: ${volatilityScan.realizedVolSPY?.toFixed(2)}% | Vol Risk Premium: ${volatilityScan.volRiskPremium?.toFixed(2)}\n`;
    const ts = volatilityScan.termStructure;
    if (ts) {
      const fwd = ts.vix3m != null ? `VIX3M ${ts.vix3m.toFixed(2)}` : ts.vx1 != null ? `VX1 ${ts.vx1.toFixed(2)}` : 'forward n/a';
      text += `Term Structure: ${ts.label} (VIX ${ts.vix?.toFixed(2)} vs ${fwd}${ts.vix6m != null ? `, VIX6M ${ts.vix6m.toFixed(2)}` : ''})\n`;
    }
    text += `Vol of Vol: ${volatilityScan.volOfVol?.toFixed(1)}\n`;
    if (volatilityScan.description) text += `Summary: ${volatilityScan.description}\n`;
    contextParts.push(text);
    dataSources.push('Volatility');
  }

  // 10. Crash Risk Indicator
  if (crashScan && crashScan.score != null) {
    let text = '--- CRASH RISK INDICATOR ---\n';
    text += `Composite Score: ${crashScan.score}/100 | Level: ${crashScan.label}\n`;
    if (crashScan.factors) {
      text += 'Factor Breakdown:\n';
      crashScan.factors.forEach(f => {
        text += `  ${f.label}: score ${f.score?.toFixed(0)}/100 (weight ${(f.weight * 100).toFixed(0)}%) — ${f.note}\n`;
      });
    }
    contextParts.push(text);
    dataSources.push('Crash Risk');
  }

  // 10b. Crash Thesis (Cem Karsan drawdown / V-bottom playbook)
  if (crashThesis && crashThesis.phase) {
    let text = '--- CRASH THESIS (Cem Karsan: 20-40% drawdown after midterms, underway before end of March, then V-bottom) ---\n';
    text += `${crashThesis.headline}\n`;
    text += `Phase: ${crashThesis.phase.label} | Days to midterms: ${crashThesis.phase.daysToMidterms} | Days to kill switch (${crashThesis.thesis?.killSwitchDate}): ${crashThesis.phase.daysToKillSwitch}\n`;
    (crashThesis.scorecard?.checks || []).forEach((c) => {
      text += `  [${c.status}] ${c.label}: ${c.detail}\n`;
    });
    (crashThesis.trades || []).forEach((t) => {
      const legs = t.legs.map((l) => `${l.action} ${l.strike}P ${l.expiryLabel} @${l.mid}`).join(' / ');
      text += `  Trade ${t.name}: ${legs} | cost $${t.costPerContract}/contract | P&L at -20%: $${t.pnlAtMinus20}, flat: $${t.pnlFlat}\n`;
    });
    if (crashThesis.vBottom) text += `V-bottom plan status: ${crashThesis.vBottom.status}\n`;
    if (crashThesis.debasement) text += `Debasement: ${crashThesis.debasement.verdict}\n`;
    contextParts.push(text);
    dataSources.push('Crash Thesis');
  }

  // 11. Social Sentiment
  if (watchlistSymbols.length > 0 && socialResults.some(r => r && r.length > 0)) {
    let text = '--- SOCIAL MEDIA & NEWS SENTIMENT ---\n';
    watchlistSymbols.forEach((sym, i) => {
      const posts = socialResults[i];
      if (!posts || posts.length === 0) return;
      const bullish = posts.filter(p => p.sentiment === 'bullish').length;
      const bearish = posts.filter(p => p.sentiment === 'bearish').length;
      const net = bullish - bearish;
      let label = 'Neutral';
      if (net > 1) label = 'Bullish';
      if (net < -1) label = 'Bearish';
      const recent = posts.slice(0, 2).map(p => `- [${p.source}] ${p.content.substring(0, 120)}...`).join('\n');
      text += `${sym}: ${label} (${bullish} bull, ${bearish} bear)\n${recent}\n\n`;
    });
    contextParts.push(text);
    dataSources.push('Social Sentiment');
  }

  // Data sources summary
  if (dataSources.length > 0) {
    contextParts.push(`--- AVAILABLE DATA SOURCES ---\nThe assistant has access to: ${dataSources.join(', ')}. Ask about any of these topics.`);
  }

  return contextParts.join('\n\n');
}

export function getAvailableDataSources() {
  return [
    'Global Indices', 'Watchlist', 'Futures', 'World Markets',
    'COT Report', 'COT History', 'Momentum', 'Sector Rotation',
    'Volatility', 'Crash Risk', 'Crash Thesis', 'Social Sentiment',
  ];
}
