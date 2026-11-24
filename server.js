/**
 * Lightweight API server using yahoo-finance2 for reliable market data.
 * Handles rate-limiting, auth cookies, and batching automatically.
 */
import express from 'express';
import cors from 'cors';
import YahooFinance from 'yahoo-finance2';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';

// Load .env if present (development only; production uses platform env vars)
try {
  const envPath = path.join(path.dirname(fileURLToPath(import.meta.url)), '.env');
  if (fs.existsSync(envPath)) {
    const envContent = fs.readFileSync(envPath, 'utf8');
    for (const line of envContent.split('\n')) {
      const match = line.match(/^([A-Z_]+)=(.*)$/);
      if (match && !process.env[match[1]]) {
        process.env[match[1]] = match[2].trim();
      }
    }
  }
} catch (e) { /* ignore */ }

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const yahooFinance = new YahooFinance();

const app = express();

// ─── Security: only allow requests from localhost ─────
app.use(cors({ origin: (origin, cb) => cb(null, true) })); // Allow same-network access for PWA
app.use(express.json()); // Parse JSON request bodies (for POST endpoints)

// ─── Rate limiting: max 200 requests per minute per IP ──
const rateLimitMap = new Map();
app.use((req, res, next) => {
  const ip = req.ip;
  const now = Date.now();
  const windowMs = 60_000;
  const maxReqs = 200;
  const entry = rateLimitMap.get(ip) || { count: 0, resetAt: now + windowMs };
  if (now > entry.resetAt) { entry.count = 0; entry.resetAt = now + windowMs; }
  entry.count++;
  rateLimitMap.set(ip, entry);
  if (entry.count > maxReqs) return res.status(429).json({ error: 'Rate limit exceeded' });
  next();
});

// ─── Input validation helper ────────────────────────────
const SYMBOL_RE = /^[A-Za-z0-9.^=\-]{1,20}$/;
function validateSymbol(sym) {
  return typeof sym === 'string' && SYMBOL_RE.test(sym);
}

// ─── Quote endpoint (batch) ─────────────────────────────
app.get('/yf/quote', async (req, res) => {
  try {
    const symbols = (req.query.symbols || '').split(',').filter(Boolean).filter(validateSymbol);
    if (!symbols.length) return res.json({ quotes: [] });
    if (symbols.length > 50) return res.status(400).json({ error: 'Too many symbols (max 50)', quotes: [] });

    const results = await yahooFinance.quote(symbols, {}, { validateResult: false });
    const quotes = (Array.isArray(results) ? results : [results]).map((q) => ({
      symbol: q.symbol,
      name: q.shortName || q.longName || q.symbol,
      price: q.regularMarketPrice ?? 0,
      change: q.regularMarketChange ?? 0,
      changePercent: q.regularMarketChangePercent ?? 0,
      previousClose: q.regularMarketPreviousClose ?? 0,
      open: q.regularMarketOpen ?? 0,
      dayHigh: q.regularMarketDayHigh ?? 0,
      dayLow: q.regularMarketDayLow ?? 0,
      volume: q.regularMarketVolume ?? 0,
      marketCap: q.marketCap ?? 0,
      fiftyTwoWeekHigh: q.fiftyTwoWeekHigh ?? 0,
      fiftyTwoWeekLow: q.fiftyTwoWeekLow ?? 0,
      fiftyDayAvg: q.fiftyDayAverage ?? 0,
      twoHundredDayAvg: q.twoHundredDayAverage ?? 0,
      exchange: q.exchange || '',
      marketState: q.marketState || 'CLOSED',
      currency: q.currency || 'USD',
      regularMarketTime: q.regularMarketTime ? new Date(q.regularMarketTime).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', second: '2-digit', hour12: true }) : '',
    }));

    res.json({ quotes });
  } catch (err) {
    console.error('Quote error:', err.message);
    res.status(500).json({ error: err.message, quotes: [] });
  }
});

// ─── Historical chart endpoint ──────────────────────────
app.get('/yf/history/:symbol', async (req, res) => {
  try {
    const { symbol } = req.params;
    if (!validateSymbol(symbol)) return res.status(400).json({ error: 'Invalid symbol' });
    const { range = '1y', interval = '1d' } = req.query;

    const validRanges = ['1d', '5d', '1mo', '3mo', '6mo', '1y', '2y', '5y', '10y', 'max'];
    const validIntervals = ['1d', '1wk', '1mo', '5m', '15m', '1h'];
    if (!validRanges.includes(range)) return res.status(400).json({ error: 'Invalid range' });
    if (!validIntervals.includes(interval)) return res.status(400).json({ error: 'Invalid interval' });

    // Map range strings to period1/period2
    const rangeMap = { '1d': 1, '5d': 5, '1mo': 30, '3mo': 90, '6mo': 180, '1y': 365, '2y': 730, '5y': 1825, '10y': 3650, 'max': 36500 };
    const days = rangeMap[range] || 365;
    const period1 = new Date(Date.now() - days * 86400000);

    const result = await yahooFinance.chart(symbol, {
      period1,
      interval,
    }, { validateResult: false });

    const quotes = result.quotes || [];
    const data = {
      dates: quotes.map((q) => q.date.toISOString().slice(0, 10)),
      closes: quotes.map((q) => q.close),
      highs: quotes.map((q) => q.high),
      lows: quotes.map((q) => q.low),
      opens: quotes.map((q) => q.open),
      volumes: quotes.map((q) => q.volume),
      meta: result.meta ? {
        regularMarketPrice: result.meta.regularMarketPrice,
        chartPreviousClose: result.meta.chartPreviousClose,
        fiftyTwoWeekHigh: result.meta.fiftyTwoWeekHigh,
        fiftyTwoWeekLow: result.meta.fiftyTwoWeekLow,
        shortName: result.meta.shortName,
        symbol: result.meta.symbol,
        exchangeName: result.meta.exchangeName,
        regularMarketVolume: result.meta.regularMarketVolume,
      } : null,
    };

    res.json(data);
  } catch (err) {
    console.error(`History error (${req.params.symbol}):`, err.message);
    res.status(500).json({ error: err.message, dates: [], closes: [], highs: [], lows: [], opens: [], volumes: [] });
  }
});

// ─── Options chain endpoint ─────────────────────────────
app.get('/yf/options/:symbol', async (req, res) => {
  try {
    const { symbol } = req.params;
    if (!validateSymbol(symbol)) return res.status(400).json({ error: 'Invalid symbol' });
    const { date } = req.query;
    if (date && (isNaN(parseInt(date)) || parseInt(date) < 0)) return res.status(400).json({ error: 'Invalid date' });

    const opts = {};
    if (date) opts.date = new Date(parseInt(date) * 1000);

    const result = await yahooFinance.options(symbol, opts, { validateResult: false });

    const mapContract = (c) => ({
      strike: c.strike,
      lastPrice: c.lastPrice ?? 0,
      bid: c.bid ?? 0,
      ask: c.ask ?? 0,
      change: c.change ?? 0,
      changePercent: c.percentChange ?? 0,
      volume: c.volume ?? 0,
      openInterest: c.openInterest ?? 0,
      impliedVolatility: c.impliedVolatility ?? 0,
      inTheMoney: c.inTheMoney ?? false,
      contractSymbol: c.contractSymbol || '',
      expiration: c.expiration ? Math.floor(new Date(c.expiration).getTime() / 1000) : 0,
    });

    res.json({
      expirations: (result.expirationDates || []).map((d) => Math.floor(new Date(d).getTime() / 1000)),
      strikes: result.strikes || [],
      calls: (result.options?.[0]?.calls || []).map(mapContract),
      puts: (result.options?.[0]?.puts || []).map(mapContract),
      underlyingPrice: result.quote?.regularMarketPrice ?? 0,
      underlyingName: result.quote?.shortName || symbol,
      expirationDate: result.options?.[0]?.expirationDate
        ? Math.floor(new Date(result.options[0].expirationDate).getTime() / 1000)
        : 0,
    });
  } catch (err) {
    console.error(`Options error (${req.params.symbol}):`, err.message);
    res.json({ expirations: [], strikes: [], calls: [], puts: [], underlyingPrice: 0, underlyingName: req.params.symbol, expirationDate: 0 });
  }
});

// ─── Options-implied distribution (Breeden–Litzenberger) ─
// GET /options/distribution/:symbol[?date=<expiry unix s>] (default ≈30 DTE) → summary, density
// curve and smile for one expiry. Pure math lives in impliedDistribution.js.
import { buildImpliedDistribution, distributionSummary, distributionCurve } from './src/engine/impliedDistribution.js';

app.get('/options/distribution/:symbol', async (req, res) => {
  try {
    const { symbol } = req.params;
    if (!validateSymbol(symbol)) return res.status(400).json({ error: 'Invalid symbol' });
    const { date } = req.query;
    if (date && (isNaN(parseInt(date)) || parseInt(date) < 0)) return res.status(400).json({ error: 'Invalid date' });
    let result = await yahooFinance.options(symbol, date ? { date: new Date(parseInt(date) * 1000) } : {}, { validateResult: false });
    if (!date) {
      // Default expiry: nearest to 30 days out (≥7d) — 0–2 DTE chains are too short to read a distribution from.
      const target = Date.now() + 30 * 86400000;
      const exps = (result.expirationDates || []).map((d) => new Date(d).getTime()).filter((t) => t >= Date.now() + 7 * 86400000);
      const pick = exps.reduce((a, t) => (a == null || Math.abs(t - target) < Math.abs(a - target) ? t : a), null);
      if (pick) result = await yahooFinance.options(symbol, { date: new Date(pick) }, { validateResult: false });
    }
    const o = result.options?.[0];
    const spot = result.quote?.regularMarketPrice ?? 0;
    if (!o || !(spot > 0)) return res.status(404).json({ error: 'No option chain' });
    const expiry = Math.floor(new Date(o.expirationDate).getTime() / 1000);
    const dte = (expiry * 1000 - Date.now()) / 86400000;
    const q = (c) => ({ strike: c.strike, bid: c.bid ?? 0, ask: c.ask ?? 0 });
    const dist = buildImpliedDistribution({ calls: (o.calls || []).map(q), puts: (o.puts || []).map(q), spot, daysToExpiry: dte });
    res.json({
      symbol,
      name: result.quote?.shortName || symbol,
      expiry,
      expirations: (result.expirationDates || []).map((d) => Math.floor(new Date(d).getTime() / 1000)),
      summary: distributionSummary(dist),
      curve: distributionCurve(dist, 80),
      smile: dist?.smilePoints ?? [],
      fetchedAt: new Date().toISOString(),
      source: 'Yahoo Finance option chain; Breeden–Litzenberger density (risk-neutral)',
    });
  } catch (err) {
    console.error(`Distribution error (${req.params.symbol}):`, err.message);
    res.status(500).json({ error: err.message });
  }
});

// ─── Google Finance quote endpoint (secondary source) ────
// Google Finance has no official API; this extracts price from the public quote page.
// Used as a fallback when Yahoo Finance is unavailable or returns no data.
app.get('/gf/quote', async (req, res) => {
  try {
    const symbols = (req.query.symbols || '').split(',').filter(Boolean).filter(validateSymbol);
    if (!symbols.length) return res.json({ quotes: [] });
    if (symbols.length > 20) return res.status(400).json({ error: 'Too many symbols (max 20)', quotes: [] });

    const quotes = [];
    for (const sym of symbols) {
      try {
        // Google Finance uses exchange suffixes; try common US exchanges
        const exchanges = ['NASDAQ', 'NYSE', 'NYSEARCA', 'NYSEAMERICAN', 'BATS'];
        let found = false;

        for (const exch of exchanges) {
          const url = `https://www.google.com/finance/quote/${encodeURIComponent(sym)}:${exch}`;
          const resp = await fetch(url, {
            headers: { 'User-Agent': 'Mozilla/5.0 (compatible; PortfolioTool/1.0)' },
            signal: AbortSignal.timeout(5000),
          });
          if (!resp.ok) continue;

          const html = await resp.text();

          // Extract price from Google Finance page (multiple fallback patterns)
          let price = null;
          let name = sym;
          let previousClose = null;
          let change = null;

          // Pattern 1: JSON-LD structured data
          const jsonLdMatch = html.match(/<script[^>]*type="application\/ld\+json"[^>]*>([^<]+)<\/script>/i);
          if (jsonLdMatch) {
            try {
              const ld = JSON.parse(jsonLdMatch[1]);
              if (ld?.price) price = parseFloat(ld.price);
              if (ld?.name) name = ld.name;
            } catch {}
          }

          // Pattern 2: data-last-price attribute
          if (price == null) {
            const dpMatch = html.match(/data-last-price="([^"]+)"/);
            if (dpMatch) price = parseFloat(dpMatch[1]);
          }

          // Pattern 3: regex on visible price patterns in the page
          if (price == null) {
            const pxMatch = html.match(/"regularMarketPrice"\s*:\s*\[null,\s*([\d.]+)\]/);
            if (pxMatch) price = parseFloat(pxMatch[1]);
          }

          // Pattern 4: previous close
          const pcMatch = html.match(/"regularMarketPreviousClose"\s*:\s*\[null,\s*([\d.]+)\]/);
          if (pcMatch) previousClose = parseFloat(pcMatch[1]);

          // Pattern 5: change
          const chMatch = html.match(/"regularMarketChange"\s*:\s*\[null,\s*([\d.\-]+)\]/);
          if (chMatch) change = parseFloat(chMatch[1]);

          if (price != null && !isNaN(price) && price > 0) {
            quotes.push({
              symbol: sym,
              name,
              price,
              change: change ?? 0,
              changePercent: previousClose ? ((price - previousClose) / previousClose) * 100 : 0,
              previousClose: previousClose ?? price,
              open: 0,
              dayHigh: 0,
              dayLow: 0,
              volume: 0,
              marketCap: 0,
              fiftyTwoWeekHigh: 0,
              fiftyTwoWeekLow: 0,
              fiftyDayAvg: 0,
              twoHundredDayAvg: 0,
              exchange: exch,
              marketState: 'UNKNOWN',
              currency: 'USD',
              regularMarketTime: new Date().toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true }),
            });
            found = true;
            break; // Got a price, stop trying exchanges
          }
        }

        if (!found) {
          console.warn(`Google Finance: no price found for ${sym}`);
        }
      } catch (symErr) {
        console.warn(`Google Finance error for ${sym}:`, symErr.message);
      }
    }

    res.json({ quotes });
  } catch (err) {
    console.error('Google Finance error:', err.message);
    res.status(500).json({ error: err.message, quotes: [] });
  }
});

// ─── COT (Commitments of Traders) endpoint ──────────────
// Fetches the weekly CFTC COT report (4 exchange HTML files), parses, and
// returns structured positioning + key takeaways. Cached 1 hour (report is
// weekly; refreshes Fri 3:30pm ET, delayed to Mon on holiday weeks).
import { buildCotReport, computeReportDates, buildArchiveUrls, buildHistoricalReport } from './src/engine/cotReport.js';

const COT_URLS = {
  cme: 'https://www.cftc.gov/dea/futures/deacmesf.htm',
  cmx: 'https://www.cftc.gov/dea/futures/deacmxsf.htm',
  nym: 'https://www.cftc.gov/dea/futures/deanymesf.htm',
  cbt: 'https://www.cftc.gov/dea/futures/deacbtsf.htm',
};
let cotCache = null;       // { data, expiresAt }
const COT_TTL = 24 * 60 * 60_000; // 24 hours (daily refresh)

app.get('/cot/report', async (req, res) => {
  try {
    const forceRefresh = req.query.refresh === '1';
    if (cotCache && cotCache.expiresAt > Date.now() && !forceRefresh) {
      return res.json({ ...cotCache.data, cached: true });
    }

    const fetchOpts = {
      headers: { 'User-Agent': 'windsurf-investment-tools/1.0 (https://github.com/ashgupta/windsurf-project)' },
      signal: AbortSignal.timeout(15_000),
    };
    const [cme, cmx, nym, cbt] = await Promise.all([
      fetch(COT_URLS.cme, fetchOpts).then((r) => r.ok ? r.text() : '').catch(() => ''),
      fetch(COT_URLS.cmx, fetchOpts).then((r) => r.ok ? r.text() : '').catch(() => ''),
      fetch(COT_URLS.nym, fetchOpts).then((r) => r.ok ? r.text() : '').catch(() => ''),
      fetch(COT_URLS.cbt, fetchOpts).then((r) => r.ok ? r.text() : '').catch(() => ''),
    ]);

    if (!cme && !cmx && !nym && !cbt) {
      if (cotCache) return res.json({ ...cotCache.data, cached: true, stale: true });
      return res.status(503).json({ error: 'CFTC unavailable' });
    }

    const report = buildCotReport({ cme, cmx, nym, cbt });
    if (!report.markets.length) {
      if (cotCache) return res.json({ ...cotCache.data, cached: true, stale: true });
      return res.status(502).json({ error: 'COT parse produced no markets' });
    }

    cotCache = { data: report, expiresAt: Date.now() + COT_TTL };
    res.json({ ...report, cached: false });
  } catch (err) {
    console.error('COT report error:', err.message);
    if (cotCache) return res.json({ ...cotCache.data, cached: true, stale: true });
    res.status(500).json({ error: err.message });
  }
});

// ─── COT historical (12-week trend) endpoint ────────────
// Fetches the last 12 weekly COT reports from CFTC archives, builds a
// per-market time series, and compares current vs oldest available.
// Cached 24 hours (historical data doesn't change).
let cotHistoryCache = null;
const COT_HIST_TTL = 24 * 60 * 60_000; // 24 hours

app.get('/cot/history', async (req, res) => {
  try {
    if (cotHistoryCache && cotHistoryCache.expiresAt > Date.now() && req.query.refresh !== '1') {
      return res.json({ ...cotHistoryCache.data, cached: true });
    }

    // First, get the current report to find the latest "as of" date
    const fetchOpts = {
      headers: { 'User-Agent': 'windsurf-investment-tools/1.0 (https://github.com/ashgupta/windsurf-project)' },
      signal: AbortSignal.timeout(15_000),
    };
    const [cme0, cmx0, nym0, cbt0] = await Promise.all([
      fetch(COT_URLS.cme, fetchOpts).then((r) => r.ok ? r.text() : '').catch(() => ''),
      fetch(COT_URLS.cmx, fetchOpts).then((r) => r.ok ? r.text() : '').catch(() => ''),
      fetch(COT_URLS.nym, fetchOpts).then((r) => r.ok ? r.text() : '').catch(() => ''),
      fetch(COT_URLS.cbt, fetchOpts).then((r) => r.ok ? r.text() : '').catch(() => ''),
    ]);

    const currentReport = buildCotReport({ cme: cme0, cmx: cmx0, nym: nym0, cbt: cbt0 });
    if (!currentReport.markets.length) {
      if (cotHistoryCache) return res.json({ ...cotHistoryCache.data, cached: true, stale: true });
      return res.status(503).json({ error: 'Cannot fetch current COT report for historical baseline' });
    }

    // Compute last 12 report dates (including current). We fetch 11 historical
    // (current is already parsed above).
    const dates = computeReportDates(currentReport.reportDate, 12);
    const historicalDates = dates.slice(0, -1); // exclude current (last in array)

    // Fetch all historical weeks in parallel (11 weeks × 4 exchanges = 44 requests)
    const histFetchOpts = {
      headers: { 'User-Agent': 'windsurf-investment-tools/1.0 (https://github.com/ashgupta/windsurf-project)' },
      signal: AbortSignal.timeout(20_000),
    };

    const fetchPromises = historicalDates.map(async (date) => {
      const urls = buildArchiveUrls(date);
      const [cme, cmx, nym, cbt] = await Promise.all([
        fetch(urls.cme, histFetchOpts).then((r) => r.ok ? r.text() : '').catch(() => ''),
        fetch(urls.cmx, histFetchOpts).then((r) => r.ok ? r.text() : '').catch(() => ''),
        fetch(urls.nym, histFetchOpts).then((r) => r.ok ? r.text() : '').catch(() => ''),
        fetch(urls.cbt, histFetchOpts).then((r) => r.ok ? r.text() : '').catch(() => ''),
      ]);
      return { date, htmls: { cme, cmx, nym, cbt } };
    });

    const historicalRaw = await Promise.all(fetchPromises);

    // Build the historical report (time series + comparison)
    const result = buildHistoricalReport(historicalRaw, currentReport);

    const payload = {
      ...result,
      currentReportDate: currentReport.reportDate,
      fetchedAt: new Date().toISOString(),
    };

    cotHistoryCache = { data: payload, expiresAt: Date.now() + COT_HIST_TTL };
    res.json({ ...payload, cached: false });
  } catch (err) {
    console.error('COT history error:', err.message);
    if (cotHistoryCache) return res.json({ ...cotHistoryCache.data, cached: true, stale: true });
    res.status(500).json({ error: err.message });
  }
});

// ─── Momentum & Volume scan endpoint ────────────────────
// Fetches 1y daily history for major indices, stocks, ETFs, and factor ETFs,
// computes time-series momentum, cross-sectional ranking, factor rotation,
// and volume analysis. Cached 24 hours (daily refresh).
import { MOMENTUM_UNIVERSE, FACTOR_ETFS, buildMomentumScan } from './src/engine/momentumEngine.js';
import { analyzeVolatility } from './src/engine/volatilityEngine.js';
import { SECTOR_ETFS, computeSectorRotation } from './src/engine/sectorRotation.js';

let momentumCache = null;
const MOMENTUM_TTL = 24 * 60 * 60_000; // 24 hours (daily refresh)

app.get('/momentum/scan', async (req, res) => {
  try {
    if (momentumCache && momentumCache.expiresAt > Date.now() && req.query.refresh !== '1') {
      return res.json({ ...momentumCache.data, cached: true });
    }

    const allAssets = [
      ...MOMENTUM_UNIVERSE.indices,
      ...MOMENTUM_UNIVERSE.stocks,
      ...MOMENTUM_UNIVERSE.etfs,
    ];

    const period1 = new Date(Date.now() - 400 * 86400000); // ~13 months for 252-day ROC

    // Fetch all asset histories in parallel
    const fetchOne = async (symbol) => {
      try {
        const result = await yahooFinance.chart(symbol, {
          period1,
          interval: '1d',
        }, { validateResult: false });
        const quotes = result.quotes || [];
        return {
          closes: quotes.map((q) => q.close),
          highs: quotes.map((q) => q.high),
          lows: quotes.map((q) => q.low),
          volumes: quotes.map((q) => q.volume),
        };
      } catch (err) {
        console.error(`Momentum fetch ${symbol} error:`, err?.message || String(err));
        return { closes: [], highs: [], lows: [], volumes: [] };
      }
    };

    const [assetHistories, factorHistories] = await Promise.all([
      Promise.all(allAssets.map(async (a) => ({
        symbol: a.symbol,
        name: a.name,
        history: await fetchOne(a.symbol),
      }))),
      Promise.all(FACTOR_ETFS.map(async (f) => ({
        symbol: f.symbol,
        name: f.name,
        factor: f.factor,
        history: await fetchOne(f.symbol),
      }))),
    ]);

    const scan = buildMomentumScan(assetHistories, factorHistories);

    if (!scan.assets.length || scan.assets.every((a) => a.insufficientData)) {
      if (momentumCache) return res.json({ ...momentumCache.data, cached: true, stale: true });
      return res.status(503).json({ error: 'No momentum data available' });
    }

    momentumCache = { data: scan, expiresAt: Date.now() + MOMENTUM_TTL };
    res.json({ ...scan, cached: false });
  } catch (err) {
    console.error('Momentum scan error:', err.message);
    if (momentumCache) return res.json({ ...momentumCache.data, cached: true, stale: true });
    res.status(500).json({ error: err.message });
  }
});

// ─── AI Commentary endpoint (Groq) ──────────────────────
// Uses the server-side GROQ_API_KEY to generate AI commentary on market data.
// The key is never exposed to the client. Accepts a data payload + type, builds
// a prompt, calls Groq, and returns the analysis.
//
// MODEL AUTO-SELECTION: The model is NOT hardcoded. On server startup and
// every 30 days thereafter, the server queries Groq's /models endpoint, scores
// all available chat models (see modelSelector.js), and picks the best one.
// The selection is persisted to .groq-model-state.json (gitignored) so it
// survives restarts. This ensures the app always uses the latest AI model
// available from Groq without manual intervention.
import { selectBestModel, needsRefresh, displayModelName } from './src/engine/modelSelector.js';

const GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions';
const GROQ_MODELS_URL = 'https://api.groq.com/openai/v1/models';
const GROQ_STATE_FILE = path.join(__dirname, '.groq-model-state.json');
const MODEL_REFRESH_INTERVAL_DAYS = 30;
const MODEL_REFRESH_INTERVAL_MS = MODEL_REFRESH_INTERVAL_DAYS * 24 * 60 * 60 * 1000;

// In-memory model state (loaded from file on startup)
let groqModel = null;
let groqModelCheckedAt = null;
let groqModelHistory = []; // [{ model, selectedAt }]

/**
 * Load persisted model state from file.
 */
function loadModelState() {
  try {
    if (fs.existsSync(GROQ_STATE_FILE)) {
      const raw = fs.readFileSync(GROQ_STATE_FILE, 'utf8');
      const state = JSON.parse(raw);
      groqModel = state.model || null;
      groqModelCheckedAt = state.lastCheckedAt || null;
      groqModelHistory = state.history || [];
      console.log(`[Groq] Loaded model state: ${groqModel} (last checked: ${groqModelCheckedAt})`);
    }
  } catch (e) {
    console.warn('[Groq] Could not load model state:', e.message);
  }
}

/**
 * Save model state to file.
 */
function saveModelState() {
  try {
    const state = {
      model: groqModel,
      lastCheckedAt: groqModelCheckedAt,
      history: groqModelHistory,
    };
    fs.writeFileSync(GROQ_STATE_FILE, JSON.stringify(state, null, 2));
  } catch (e) {
    console.warn('[Groq] Could not save model state:', e.message);
  }
}

/**
 * Query Groq for available models and select the best one.
 * Updates groqModel, groqModelCheckedAt, and groqModelHistory.
 *
 * @param {boolean} force — if true, refresh even if interval hasn't elapsed
 * @returns {{model: string|null, changed: boolean, available: string[]}}
 */
async function refreshGroqModel(force = false) {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) {
    console.warn('[Groq] No GROQ_API_KEY — skipping model refresh');
    return { model: groqModel, changed: false, available: [] };
  }

  if (!force && !needsRefresh(groqModelCheckedAt, MODEL_REFRESH_INTERVAL_DAYS)) {
    return { model: groqModel, changed: false, available: [] };
  }

  try {
    const res = await fetch(GROQ_MODELS_URL, {
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) {
      console.error('[Groq] /models returned', res.status);
      return { model: groqModel, changed: false, available: [] };
    }
    const data = await res.json();
    const availableIds = (data.data || []).map((m) => m.id);
    const { bestModel, ranked } = selectBestModel(availableIds);

    if (!bestModel) {
      console.warn('[Groq] No chat models found in available list');
      return { model: groqModel, changed: false, available: availableIds };
    }

    const changed = bestModel !== groqModel;
    const previousModel = groqModel;
    groqModel = bestModel;
    groqModelCheckedAt = new Date().toISOString();

    if (changed) {
      groqModelHistory.push({
        model: bestModel,
        selectedAt: groqModelCheckedAt,
        replaced: previousModel,
      });
      // Keep only last 20 entries
      if (groqModelHistory.length > 20) groqModelHistory = groqModelHistory.slice(-20);
      console.log(`[Groq] Model updated: ${previousModel || '(none)'} → ${bestModel}`);
    } else {
      console.log(`[Groq] Model confirmed: ${bestModel} (no change)`);
    }

    saveModelState();
    return { model: bestModel, changed, available: availableIds, ranked };
  } catch (err) {
    console.error('[Groq] Model refresh failed:', err.message);
    return { model: groqModel, changed: false, available: [] };
  }
}

// Load persisted state on startup
loadModelState();

// Refresh model on startup (if needed) and set up monthly interval
refreshGroqModel().then(() => {
  if (!groqModel) {
    // Fallback if refresh failed (e.g., no API key, network error)
    groqModel = 'llama-3.3-70b-versatile';
    groqModelCheckedAt = new Date().toISOString();
    console.warn(`[Groq] Using fallback model: ${groqModel}`);
    saveModelState();
  }
});

// Monthly auto-refresh. We check daily (not every 30 days) because Node's
// setInterval overflows on values > 2^31 ms (~24.8 days). refreshGroqModel
// internally checks if the 30-day interval has actually elapsed before
// hitting the Groq API, so this is just a lightweight timer tick.
const ONE_DAY_MS = 24 * 60 * 60 * 1000;
setInterval(() => refreshGroqModel(), ONE_DAY_MS);

// Commentary cache (24h TTL — same data → same commentary)
const commentaryCache = new Map();
const COMMENTARY_TTL = 24 * 60 * 60_000; // 24 hours (daily refresh)

function buildCotPrompt(data) {
  const { reportDate, prevDate, takeaways, markets } = data;
  const topMarkets = markets?.slice(0, 15).map(m =>
    `${m.display} (${m.assetClass}): net ${m.net > 0 ? 'long' : 'short'} ${Math.abs(m.net).toLocaleString()}, ${m.stance}, wk delta ${m.weekDelta > 0 ? '+' : ''}${m.weekDelta.toLocaleString()}`
  ).join('\n');

  return `You are a professional commodities/futures analyst. Analyze this CFTC Commitments of Traders report data and provide key insights.

Report date: ${reportDate} (vs prior: ${prevDate})

Top positions by market:
${topMarkets}

Bullish takeaways: ${takeaways?.bullish?.join('; ') || 'none'}
Bearish takeaways: ${takeaways?.bearish?.join('; ') || 'none'}
Biggest weekly shifts: ${takeaways?.shifts?.join('; ') || 'none'}

Provide a concise (3-4 paragraph) analysis covering:
1. Overall positioning theme (what are large speculators doing?)
2. Notable shifts or extremes (any stance flips, crowded trades?)
3. Risk warnings (contrarian signals, crowded positioning that could reverse)
4. What to watch next week

Be specific and data-driven. No disclaimers needed. Max 300 words.`;
}

function buildMomentumPrompt(data) {
  const { crossSectional, factorMomentum, volumeSummary, assets } = data;
  const topMovers = crossSectional?.ranked?.slice(0, 5).map(a =>
    `${a.symbol}: momentum ${a.momentumScore > 0 ? '+' : ''}${a.momentumScore?.toFixed(1)}%, signal ${a.signal}`
  ).join('\n');
  const bottomMovers = crossSectional?.ranked?.slice(-5).map(a =>
    `${a.symbol}: momentum ${a.momentumScore > 0 ? '+' : ''}${a.momentumScore?.toFixed(1)}%, signal ${a.signal}`
  ).join('\n');
  const factors = factorMomentum?.ranked?.map(f =>
    `${f.factor}: 3M ROC ${f.roc3m > 0 ? '+' : ''}${f.roc3m?.toFixed(1)}%`
  ).join('\n');
  const breakouts = assets?.filter(a => a.timeSeries?.breakout !== 'none' && a.timeSeries?.breakout).map(a =>
    `${a.symbol}: ${a.timeSeries.breakout}`
  ).join(', ') || 'none';
  const volSpikes = assets?.filter(a => a.volume?.spikes?.length > 0).map(a =>
    `${a.symbol}: ${a.volume.spikes.length} spike(s), ${a.volume.confirmation}`
  ).join(', ') || 'none';

  return `You are a quantitative momentum analyst. Analyze this momentum scan data and provide key insights.

Top 5 by momentum:
${topMovers}

Bottom 5:
${bottomMovers}

Factor rotation (ranked by 3M ROC):
${factors}

Leading factor: ${factorMomentum?.leading}
Breakout signals: ${breakouts}
Volume spikes: ${volSpikes}
Volume summary: ${volumeSummary?.confirmed} bullish confirmed, ${volumeSummary?.bearish} bearish, ${volumeSummary?.spikes} with spikes

Provide a concise (3-4 paragraph) analysis covering:
1. Overall market momentum theme (risk-on vs risk-off?)
2. Cross-sectional leaders/laggards and what that tells us
3. Factor rotation insight (which factors are working, what to rotate into)
4. Volume confirmation and spike warnings (capitulation? absorption?)

Be specific and data-driven. No disclaimers needed. Max 300 words.`;
}

app.post('/ai/commentary', async (req, res) => {
  try {
    const { type, data } = req.body;
    if (!type || !data) return res.status(400).json({ error: 'Missing type or data' });

    const apiKey = process.env.GROQ_API_KEY;
    if (!apiKey) return res.status(503).json({ error: 'GROQ_API_KEY not configured on server' });

    // Build prompt based on type
    let prompt;
    let cacheKey;
    if (type === 'cot') {
      prompt = buildCotPrompt(data);
      cacheKey = `cot:${data.reportDate}`;
    } else if (type === 'momentum') {
      prompt = buildMomentumPrompt(data);
      cacheKey = `momentum:${data.fetchedAt?.slice(0, 16) || Date.now()}`;
    } else {
      return res.status(400).json({ error: 'Unknown commentary type' });
    }

    // Check cache (bypass if refresh=1)
    const forceRefresh = req.query.refresh === '1';
    if (!forceRefresh) {
      const cached = commentaryCache.get(cacheKey);
      if (cached && cached.expiresAt > Date.now()) {
        return res.json({ commentary: cached.text, cached: true });
      }
    }

    // Call Groq
    const groqRes = await fetch(GROQ_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: groqModel,
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.7,
        max_tokens: 600,
      }),
      signal: AbortSignal.timeout(30_000),
    });

    if (!groqRes.ok) {
      const errText = await groqRes.text();
      console.error('Groq API error:', groqRes.status, errText);
      return res.status(502).json({ error: `Groq API error: ${groqRes.status}` });
    }

    const groqData = await groqRes.json();
    const commentary = groqData.choices?.[0]?.message?.content || 'No commentary generated.';

    commentaryCache.set(cacheKey, { text: commentary, expiresAt: Date.now() + COMMENTARY_TTL });
    res.json({ commentary, cached: false });
  } catch (err) {
    console.error('AI commentary error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ─── AI Model status + refresh endpoints ────────────────
// GET /ai/model — returns the current model, when it was last checked,
// the refresh interval, and the model history.
app.get('/ai/model', (req, res) => {
  res.json({
    model: groqModel,
    displayName: displayModelName(groqModel),
    lastCheckedAt: groqModelCheckedAt,
    refreshIntervalDays: MODEL_REFRESH_INTERVAL_DAYS,
    nextCheckAt: groqModelCheckedAt
      ? new Date(new Date(groqModelCheckedAt).getTime() + MODEL_REFRESH_INTERVAL_MS).toISOString()
      : null,
    needsRefresh: needsRefresh(groqModelCheckedAt, MODEL_REFRESH_INTERVAL_DAYS),
    history: groqModelHistory,
  });
});

// POST /ai/model/refresh — forces a model refresh now (queries Groq /models,
// picks the best, updates state). Useful for manual testing or when a new
// model is announced and you don't want to wait for the monthly cycle.
app.post('/ai/model/refresh', async (req, res) => {
  try {
    const result = await refreshGroqModel(true);
    res.json({
      model: groqModel,
      displayName: displayModelName(groqModel),
      lastCheckedAt: groqModelCheckedAt,
      changed: result.changed,
      available: result.available || [],
      ranked: (result.ranked || []).slice(0, 10),
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Sector Rotation scan endpoint ──────────────────────
// Fetches 1y daily history for all 11 S&P sector ETFs + SPY, computes
// relative-strength ranking, regime classification, and rotation signal.
// Cached 24 hours (daily refresh).
let sectorCache = null;
const SECTOR_TTL = 24 * 60 * 60_000; // 24 hours (daily refresh)

app.get('/sector/scan', async (req, res) => {
  try {
    if (sectorCache && sectorCache.expiresAt > Date.now() && req.query.refresh !== '1') {
      return res.json({ ...sectorCache.data, cached: true });
    }

    const period1 = new Date(Date.now() - 400 * 86400000); // ~13 months for 252-day ROC

    const fetchOne = async (symbol) => {
      try {
        const result = await yahooFinance.chart(symbol, {
          period1,
          interval: '1d',
        }, { validateResult: false });
        const quotes = result.quotes || [];
        return {
          closes: quotes.map((q) => q.close),
          highs: quotes.map((q) => q.high),
          lows: quotes.map((q) => q.low),
          volumes: quotes.map((q) => q.volume),
        };
      } catch (err) {
        console.error(`Sector fetch ${symbol} error:`, err?.message || String(err));
        return { closes: [], highs: [], lows: [], volumes: [] };
      }
    };

    const [sectorHistories, spyHistory] = await Promise.all([
      Promise.all(SECTOR_ETFS.map(async (e) => ({
        symbol: e.symbol,
        name: e.name,
        sector: e.sector,
        history: await fetchOne(e.symbol),
      }))),
      fetchOne('SPY'),
    ]);

    const scan = computeSectorRotation(sectorHistories, spyHistory);

    if (!scan.ranked.length) {
      if (sectorCache) return res.json({ ...sectorCache.data, cached: true, stale: true });
      return res.status(503).json({ error: 'No sector rotation data available' });
    }

    sectorCache = { data: scan, expiresAt: Date.now() + SECTOR_TTL };
    res.json({ ...scan, cached: false });
  } catch (err) {
    console.error('Sector scan error:', err.message);
    if (sectorCache) return res.json({ ...sectorCache.data, cached: true, stale: true });
    res.status(500).json({ error: err.message });
  }
});

// ─── Volatility scan endpoint ───────────────────────────
// Fetches 6mo daily history for ^VIX, SPY, ^VX1, ^VX2 (some may fail —
// handled gracefully), computes the volatility dashboard analysis, and
// caches 24 hours (daily refresh). Same parallel-fetch pattern as /momentum/scan.
let volatilityCache = null;
const VOLATILITY_TTL = 24 * 60 * 60_000; // 24 hours (daily refresh)

app.get('/volatility/scan', async (req, res) => {
  try {
    if (volatilityCache && volatilityCache.expiresAt > Date.now() && req.query.refresh !== '1') {
      return res.json({ ...volatilityCache.data, cached: true });
    }

    const period1 = new Date(Date.now() - 200 * 86400000); // ~6.5 months for 126-day chart

    const fetchOne = async (symbol) => {
      try {
        const result = await yahooFinance.chart(symbol, {
          period1,
          interval: '1d',
        }, { validateResult: false });
        const quotes = result.quotes || [];
        return {
          closes: quotes.map((q) => q.close),
          dates: quotes.map((q) => q.date.toISOString().slice(0, 10)),
        };
      } catch (err) {
        console.error(`Volatility fetch ${symbol} error:`, err?.message || String(err));
        return { closes: [], dates: [] };
      }
    };

    // Yahoo has no continuous VIX futures (^VX1/^VX2 return nothing); the
    // CBOE constant-maturity indices give the same curve shape.
    const [vixHistory, spyHistory, vix9d, vix3m, vix6m] = await Promise.all([
      fetchOne('^VIX'),
      fetchOne('SPY'),
      fetchOne('^VIX9D'),
      fetchOne('^VIX3M'),
      fetchOne('^VIX6M'),
    ]);

    const analysis = analyzeVolatility(vixHistory, spyHistory, null, null, { vix9d, vix3m, vix6m });

    if (analysis.vixLevel == null) {
      if (volatilityCache) return res.json({ ...volatilityCache.data, cached: true, stale: true });
      return res.status(503).json({ error: 'No volatility data available' });
    }

    volatilityCache = { data: analysis, expiresAt: Date.now() + VOLATILITY_TTL };
    res.json({ ...analysis, cached: false });
  } catch (err) {
    console.error('Volatility scan error:', err.message);
    if (volatilityCache) return res.json({ ...volatilityCache.data, cached: true, stale: true });
    res.status(500).json({ error: err.message });
  }
});

// ─── Social media proxy endpoints ───────────────────────
// All sources are free + no-auth. CORS-blocked from the browser so we
// proxy here. 24-hour in-memory cache per source+symbol.
const socialCache = new Map();      // key: "source:symbol" → { data, expiresAt }
const SOCIAL_TTL = 24 * 60 * 60_000; // 24 hours (daily refresh)

const cacheGet = (key) => {
  const e = socialCache.get(key);
  if (e && e.expiresAt > Date.now()) return e.data;
  if (e) socialCache.delete(key);
  return null;
};
const cacheSet = (key, data) => socialCache.set(key, { data, expiresAt: Date.now() + SOCIAL_TTL });

const SOCIAL_UA = 'windsurf-investment-tools/1.0 (https://github.com/ashgupta/windsurf-project)';

async function fetchStockTwits(symbol) {
  const key = `stocktwits:${symbol}`;
  const cached = cacheGet(key);
  if (cached) return cached;
  const r = await fetch(`https://api.stocktwits.com/api/2/streams/symbol/${encodeURIComponent(symbol)}.json`, {
    headers: { 'User-Agent': SOCIAL_UA },
  });
  if (!r.ok) return { messages: [] };
  const j = await r.json();
  const data = { messages: j.messages || [] };
  cacheSet(key, data);
  return data;
}

async function fetchReddit(symbol) {
  const key = `reddit:${symbol}`;
  const cached = cacheGet(key);
  if (cached) return cached;
  // Cross-subreddit search: WSB + r/stocks + r/investing
  const url = `https://www.reddit.com/r/wallstreetbets+stocks+investing/search.json?q=${encodeURIComponent(symbol)}&sort=new&restrict_sr=1&limit=25`;
  const r = await fetch(url, { headers: { 'User-Agent': SOCIAL_UA } });
  if (!r.ok) return { children: [] };
  const j = await r.json();
  const data = { children: j.data?.children || [] };
  cacheSet(key, data);
  return data;
}

async function fetchHackerNews(symbol) {
  const key = `hn:${symbol}`;
  const cached = cacheGet(key);
  if (cached) return cached;
  const url = `https://hn.algolia.com/api/v1/search_by_date?query=${encodeURIComponent(symbol)}&tags=story&hitsPerPage=15`;
  const r = await fetch(url, { headers: { 'User-Agent': SOCIAL_UA } });
  if (!r.ok) return { hits: [] };
  const j = await r.json();
  const data = { hits: j.hits || [] };
  cacheSet(key, data);
  return data;
}

async function fetchNews(symbol) {
  const key = `news:${symbol}`;
  const cached = cacheGet(key);
  if (cached) return cached;
  try {
    const result = await yahooFinance.search(symbol, { newsCount: 10, quotesCount: 0 }, { validateResult: false });
    const data = { items: result.news || [] };
    cacheSet(key, data);
    return data;
  } catch {
    return { items: [] };
  }
}

async function fetchYoutube(symbol, key) {
  const cacheKey = `yt:${symbol}`;
  const cached = cacheGet(cacheKey);
  if (cached) return cached;
  const q = encodeURIComponent(`${symbol} stock OR finance OR earnings`);
  const r = await fetch(`https://www.googleapis.com/youtube/v3/search?part=snippet&q=${q}&order=date&type=video&maxResults=10&key=${key}`);
  if (!r.ok) return { items: [] };
  const data = await r.json();
  cacheSet(cacheKey, data);
  return data;
}

async function fetchFinnhub(symbol, key) {
  const cacheKey = `fh:${symbol}`;
  const cached = cacheGet(cacheKey);
  if (cached) return cached;
  const toDate = new Date();
  const fromDate = new Date(Date.now() - 3 * 86400000);
  const to = toDate.toISOString().split('T')[0];
  const from = fromDate.toISOString().split('T')[0];
  const r = await fetch(`https://finnhub.io/api/v1/company-news?symbol=${symbol}&from=${from}&to=${to}&token=${key}`);
  if (!r.ok) return [];
  const data = await r.json();
  cacheSet(cacheKey, data);
  return data; // Array
}

async function fetchAlphaVantage(symbol, key) {
  const cacheKey = `av:${symbol}`;
  const cached = cacheGet(cacheKey);
  if (cached) return cached;
  const r = await fetch(`https://www.alphavantage.co/query?function=NEWS_SENTIMENT&tickers=${symbol}&limit=15&apikey=${key}`);
  if (!r.ok) return { feed: [] };
  const data = await r.json();
  cacheSet(cacheKey, data);
  return data;
}

app.get('/social/stocktwits/:symbol', async (req, res) => {
  const { symbol } = req.params;
  if (!validateSymbol(symbol)) return res.status(400).json({ error: 'Invalid symbol' });
  try { res.json(await fetchStockTwits(symbol)); }
  catch (err) { console.error(`StockTwits error (${symbol}):`, err.message); res.json({ messages: [] }); }
});

app.get('/social/reddit/:symbol', async (req, res) => {
  const { symbol } = req.params;
  if (!validateSymbol(symbol)) return res.status(400).json({ error: 'Invalid symbol' });
  try { res.json(await fetchReddit(symbol)); }
  catch (err) { console.error(`Reddit error (${symbol}):`, err.message); res.json({ children: [] }); }
});

app.get('/social/hn/:symbol', async (req, res) => {
  const { symbol } = req.params;
  if (!validateSymbol(symbol)) return res.status(400).json({ error: 'Invalid symbol' });
  try { res.json(await fetchHackerNews(symbol)); }
  catch (err) { console.error(`HN error (${symbol}):`, err.message); res.json({ hits: [] }); }
});

app.get('/social/news/:symbol', async (req, res) => {
  const { symbol } = req.params;
  if (!validateSymbol(symbol)) return res.status(400).json({ error: 'Invalid symbol' });
  try { res.json(await fetchNews(symbol)); }
  catch (err) { console.error(`News error (${symbol}):`, err.message); res.json({ items: [] }); }
});

// Combined endpoint: one round trip fetches all 4 sources in parallel.
app.get('/social/all/:symbol', async (req, res) => {
  const { symbol } = req.params;
  const { yt, fh, av } = req.query;

  if (!validateSymbol(symbol)) return res.status(400).json({ error: 'Invalid symbol' });
  try {
    const [stocktwits, reddit, hackernews, news, youtube, finnhub, alphavantage] = await Promise.all([
      fetchStockTwits(symbol).catch(() => ({ messages: [] })),
      fetchReddit(symbol).catch(() => ({ children: [] })),
      fetchHackerNews(symbol).catch(() => ({ hits: [] })),
      fetchNews(symbol).catch(() => ({ items: [] })),
      yt ? fetchYoutube(symbol, yt).catch(() => ({ items: [] })) : Promise.resolve({ items: [] }),
      fh ? fetchFinnhub(symbol, fh).catch(() => []) : Promise.resolve([]),
      av ? fetchAlphaVantage(symbol, av).catch(() => ({ feed: [] })) : Promise.resolve({ feed: [] })
    ]);
    res.json({ symbol, stocktwits, reddit, hackernews, news, youtube, finnhub, alphavantage, fetchedAt: Date.now() });
  } catch (err) {
    console.error(`Social all error (${symbol}):`, err.message);
    res.status(500).json({ error: err.message });
  }
});

// ─── Crash Indicator endpoint ───────────────────────────
// Reuses /volatility/scan, /momentum/scan, /sector/scan, /cot/report data
// to compute the composite crash risk score. 24h cache, ?refresh=1 bypass.
import { computeCrashIndicator } from './src/engine/crashIndicator.js';

let crashCache = null;
const CRASH_TTL = 24 * 60 * 60_000; // 24 hours

/**
 * Shared crash-scan computation (used by /crash/scan, /options/opportunities
 * and /thesis/karsan). Returns { data, cached }. Also returns the volatility
 * analysis it computed so callers don't refetch it.
 */
async function getCrashScan({ refresh = false } = {}) {
  if (crashCache && crashCache.expiresAt > Date.now() && !refresh) {
    return { data: crashCache.data, volatility: crashCache.volatility, cached: true };
  }
  const { result, volatility } = await computeCrashScan();
  crashCache = { data: result, volatility, expiresAt: Date.now() + CRASH_TTL };
  return { data: result, volatility, cached: false };
}

async function computeCrashScan() {
    // Fetch all inputs in parallel (reuse the same yahooFinance instance)
    const period1 = new Date(Date.now() - 400 * 86400000); // ~13 months

    const fetchHistory = async (symbol) => {
      try {
        const result = await yahooFinance.chart(symbol, {
          period1,
          interval: '1d',
        }, { validateResult: false });
        const quotes = result.quotes || [];
        return {
          closes: quotes.map((q) => q.close),
          highs: quotes.map((q) => q.high),
          lows: quotes.map((q) => q.low),
          volumes: quotes.map((q) => q.volume),
        };
      } catch {
        return { closes: [], highs: [], lows: [], volumes: [] };
      }
    };

    // 1. Volatility data (VIX, SPY + CBOE VIX9D/VIX3M/VIX6M curve)
    const [vixHist, spyHist, vix9d, vix3m, vix6m] = await Promise.all([
      fetchHistory('^VIX'),
      fetchHistory('SPY'),
      fetchHistory('^VIX9D'),
      fetchHistory('^VIX3M'),
      fetchHistory('^VIX6M'),
    ]);
    const volatility = analyzeVolatility(vixHist, spyHist, null, null, { vix9d, vix3m, vix6m });

    // 2. Momentum scan (reuse MOMENTUM_UNIVERSE + FACTOR_ETFS)
    const allAssets = [
      ...MOMENTUM_UNIVERSE.indices,
      ...MOMENTUM_UNIVERSE.stocks,
      ...MOMENTUM_UNIVERSE.etfs,
    ];
    const [assetHistories, factorHistories] = await Promise.all([
      Promise.all(allAssets.map(async (a) => ({
        symbol: a.symbol,
        name: a.name,
        history: await fetchHistory(a.symbol),
      }))),
      Promise.all(FACTOR_ETFS.map(async (f) => ({
        symbol: f.symbol,
        name: f.name,
        factor: f.factor,
        history: await fetchHistory(f.symbol),
      }))),
    ]);
    const momentumScan = buildMomentumScan(assetHistories, factorHistories);

    // 3. Sector scan (for breadth)
    const [sectorHistories, spyHistForSector] = await Promise.all([
      Promise.all(SECTOR_ETFS.map(async (e) => ({
        symbol: e.symbol,
        name: e.name,
        sector: e.sector,
        history: await fetchHistory(e.symbol),
      }))),
      fetchHistory('SPY'),
    ]);
    const sectorScan = computeSectorRotation(sectorHistories, spyHistForSector);

    // 4. COT report (for positioning)
    let cotReport = null;
    try {
      const fetchOpts = {
        headers: { 'User-Agent': 'windsurf-investment-tools/1.0' },
        signal: AbortSignal.timeout(15_000),
      };
      const [cme, cmx, nym, cbt] = await Promise.all([
        fetch(COT_URLS.cme, fetchOpts).then((r) => r.ok ? r.text() : '').catch(() => ''),
        fetch(COT_URLS.cmx, fetchOpts).then((r) => r.ok ? r.text() : '').catch(() => ''),
        fetch(COT_URLS.nym, fetchOpts).then((r) => r.ok ? r.text() : '').catch(() => ''),
        fetch(COT_URLS.cbt, fetchOpts).then((r) => r.ok ? r.text() : '').catch(() => ''),
      ]);
      if (cme || cmx || nym || cbt) {
        cotReport = buildCotReport({ cme, cmx, nym, cbt });
      }
    } catch {
      // COT is optional — crash indicator still works without it
    }

    // 5. Compute composite crash indicator
    const result = computeCrashIndicator({
      volatility,
      momentumScan,
      sectorScan,
      cotReport,
    });
    // Expose SPY trend context for downstream consumers (crash thesis tab)
    const spyTs = momentumScan?.assets?.find((a) => a.symbol === 'SPY')?.timeSeries;
    if (spyTs) {
      result.spy = {
        last: spyTs.last ?? null,
        sma200: spyTs.sma200 ?? null,
        high52w: spyTs.range52w?.high52w ?? null,
      };
    }
    return { result, volatility };
}

app.get('/crash/scan', async (req, res) => {
  try {
    const { data, cached } = await getCrashScan({ refresh: req.query.refresh === '1' });
    res.json({ ...data, cached });
  } catch (err) {
    console.error('Crash scan error:', err.message);
    if (crashCache) return res.json({ ...crashCache.data, cached: true, stale: true });
    res.status(500).json({ error: err.message });
  }
});

// ─── Options Opportunities endpoint ─────────────────────
// POST endpoint: client sends universe (portfolio + watchlist symbols).
// Server adds curated liquid names, fetches histories + option chains,
// runs the options opportunities engine, returns top 5 per band.
// 24h cache keyed by universe hash, ?refresh=1 bypass.
import { buildOptionsOpportunities, CURATED_LIQUID } from './src/engine/optionsOpportunities.js';

let optionsOppCache = null;
const OPTIONS_OPP_TTL = 24 * 60 * 60_000; // 24 hours

app.post('/options/opportunities', async (req, res) => {
  try {
    const clientUniverse = (req.body?.symbols || []).filter(validateSymbol).slice(0, 50);
    const heldSet = new Set((req.body?.heldSymbols || []).filter(validateSymbol));
    const rawAlloc = Number(req.body?.allocationPerTrade);
    const allocationPerTrade = Number.isFinite(rawAlloc) && rawAlloc > 0
      ? Math.min(Math.max(rawAlloc, 500), 10_000_000)
      : 10000;

    // Cache key: sorted unique symbols + allocation (sizing depends on it)
    const cacheKey = `${[...new Set([...clientUniverse])].sort().join(',')}|${allocationPerTrade}`;
    if (optionsOppCache && optionsOppCache.expiresAt > Date.now()
        && optionsOppCache.key === cacheKey && req.query.refresh !== '1') {
      return res.json({ ...optionsOppCache.data, cached: true });
    }

    // Merge client universe with curated liquid names (deduped)
    const curated = CURATED_LIQUID.filter((c, i, arr) =>
      arr.findIndex((x) => x.symbol === c.symbol) === i
    );
    const universeMap = new Map();
    for (const s of clientUniverse) {
      universeMap.set(s, { symbol: s, name: s });
    }
    for (const c of curated) {
      if (!universeMap.has(c.symbol)) universeMap.set(c.symbol, c);
    }
    const universe = [...universeMap.values()];

    // Fetch histories for all symbols
    const period1 = new Date(Date.now() - 400 * 86400000);
    const fetchHistory = async (symbol) => {
      try {
        const result = await yahooFinance.chart(symbol, {
          period1,
          interval: '1d',
        }, { validateResult: false });
        const quotes = result.quotes || [];
        return {
          closes: quotes.map((q) => q.close),
          highs: quotes.map((q) => q.high),
          lows: quotes.map((q) => q.low),
          volumes: quotes.map((q) => q.volume),
        };
      } catch {
        return { closes: [], highs: [], lows: [], volumes: [] };
      }
    };

    const histories = await Promise.all(
      universe.map(async (a) => ({
        symbol: a.symbol,
        name: a.name,
        history: await fetchHistory(a.symbol),
      }))
    );

    // Filter out symbols with insufficient data
    const validAssets = histories.filter((a) => a.history.closes.length >= 50);

    // Fetch options chains for valid assets
    // For each symbol, get the default chain + fetch chains for the best expiry per band
    const chains = new Map();
    const chainsByBand = new Map();

    const mapContract = (c) => ({
      strike: c.strike,
      lastPrice: c.lastPrice ?? 0,
      bid: c.bid ?? 0,
      ask: c.ask ?? 0,
      volume: c.volume ?? 0,
      openInterest: c.openInterest ?? 0,
      impliedVolatility: c.impliedVolatility ?? 0,
      inTheMoney: c.inTheMoney ?? false,
      contractSymbol: c.contractSymbol || '',
      expiration: c.expiration ? Math.floor(new Date(c.expiration).getTime() / 1000) : 0,
    });

    const buildChainObj = (result) => {
      const calls = (result.options?.[0]?.calls || []).map(mapContract);
      const puts = (result.options?.[0]?.puts || []).map(mapContract);
      const exp = result.options?.[0]?.expirationDate
        ? Math.floor(new Date(result.options[0].expirationDate).getTime() / 1000)
        : 0;
      return {
        expirations: (result.expirationDates || []).map((d) =>
          Math.floor(new Date(d).getTime() / 1000)
        ),
        strikes: result.strikes || [],
        calls,
        puts,
        underlyingPrice: result.quote?.regularMarketPrice ?? 0,
        expirationDate: exp,
      };
    };

    // Band sweet spots for picking the best expiry to fetch
    const BAND_TARGETS = { short: 75, medium: 500, leaps: 900 };
    const BAND_RANGES = {
      short: [0, 365],
      medium: [366, 730],
      leaps: [731, Infinity],
    };

    await Promise.all(validAssets.map(async (asset) => {
      try {
        // First fetch: get all expirations + nearest chain
        const result = await yahooFinance.options(asset.symbol, {}, { validateResult: false });
        const expirations = (result.expirationDates || []).map((d) =>
          Math.floor(new Date(d).getTime() / 1000)
        );

        const defaultChain = buildChainObj(result);
        chains.set(asset.symbol, defaultChain);

        // For each band, find the best expiry and fetch that chain
        const bandChains = new Map();
        for (const bandKey of ['short', 'medium', 'leaps']) {
          const [minDte, maxDte] = BAND_RANGES[bandKey];
          const now = Date.now();
          const inBand = expirations.filter((exp) => {
            const dte = Math.round((exp * 1000 - now) / 86400000);
            return dte >= minDte && dte <= maxDte;
          });
          if (inBand.length === 0) continue;

          // Pick closest to sweet spot
          const target = BAND_TARGETS[bandKey];
          const bestExp = inBand.reduce((best, exp) => {
            const dte = Math.round((exp * 1000 - now) / 86400000);
            const bestDte = Math.round((best * 1000 - now) / 86400000);
            return Math.abs(dte - target) < Math.abs(bestDte - target) ? exp : best;
          });

          // If the best expiry matches the default chain's expiry, reuse it
          if (bestExp === defaultChain.expirationDate) {
            bandChains.set(bandKey, defaultChain);
            continue;
          }

          // Fetch the chain for this specific expiry
          try {
            const bandResult = await yahooFinance.options(asset.symbol, {
              date: new Date(bestExp * 1000),
            }, { validateResult: false });
            bandChains.set(bandKey, buildChainObj(bandResult));
          } catch {
            // If fetch fails, skip this band for this symbol
          }
        }

        if (bandChains.size > 0) {
          chainsByBand.set(asset.symbol, bandChains);
        }
      } catch (err) {
        console.error(`Options chain fetch error (${asset.symbol}):`, err?.message || String(err));
      }
    }));

    // Crash regime overlay (optional — degrade gracefully per Principle X)
    let crashRisk = null;
    try {
      crashRisk = (await getCrashScan()).data;
    } catch (err) {
      console.error('Options opportunities: crash regime unavailable:', err?.message || String(err));
    }

    // Build opportunities
    const result = buildOptionsOpportunities({
      universe: validAssets,
      chains,
      chainsByBand,
      heldSet,
      allocationPerTrade,
      crashRisk,
    });

    optionsOppCache = { key: cacheKey, data: result, expiresAt: Date.now() + OPTIONS_OPP_TTL };
    res.json({ ...result, cached: false, universeSize: universe.length });
  } catch (err) {
    console.error('Options opportunities error:', err.message);
    if (optionsOppCache) return res.json({ ...optionsOppCache.data, cached: true, stale: true });
    res.status(500).json({ error: err.message });
  }
});

// ─── Crash Thesis (Cem Karsan) endpoint ─────────────────
// GET /thesis/karsan?portfolio=500000&budget=0.02&equity=0.8[&refresh=1]
// Market inputs (crash scan, VIX curve, SPY chains for the thesis expiries,
// GLD/FXF/UUP trends) are cached for 1 hour — options quotes go stale faster
// than the 24h cadence used for daily scans. Sizing params are applied per
// request by the pure engine, so changing them never refetches data.
import { buildCrashThesis, KARSAN_THESIS, pickExpiry as pickThesisExpiry, UNDERLYINGS, resolveUnderlying } from './src/engine/crashThesis.js';
import { analyzeAsset } from './src/engine/momentumEngine.js';

let thesisMarketCache = null;
const thesisChainsCache = new Map(); // symbol -> { chains, expiresAt }
const THESIS_TTL = 60 * 60_000; // 1 hour
const DEBASEMENT_ASSETS = [
  { symbol: 'GLD', name: 'SPDR Gold Shares', role: 'Gold' },
  { symbol: 'FXF', name: 'Invesco CurrencyShares Swiss Franc', role: 'Swiss franc' },
  { symbol: 'UUP', name: 'Invesco DB US Dollar Index Bullish', role: 'US dollar (should weaken)', inverse: true },
];

async function fetchThesisChains(symbol) {
  // Option chains for the expiries the thesis needs, for the given underlying
  const base = await yahooFinance.options(symbol, {}, { validateResult: false });
  const expirations = (base.expirationDates || []).map((d) => Math.floor(new Date(d).getTime() / 1000));
  const day = 86400000;
  const now = Date.now();
  const mid = Date.parse(`${KARSAN_THESIS.midtermDate}T00:00:00Z`);
  const kill = Date.parse(`${KARSAN_THESIS.killSwitchDate}T00:00:00Z`);
  const vega = Date.parse(`${KARSAN_THESIS.vegaTargetDate}T00:00:00Z`);
  const targets = [now + 30 * day, mid + 17 * day, mid + 45 * day, kill - 12 * day, vega];
  const wanted = [...new Set(targets.map((t) => pickThesisExpiry(expirations, t, { minMs: now + 7 * day })).filter(Boolean))];

  const toContract = (c) => ({
    strike: c.strike,
    bid: c.bid ?? 0,
    ask: c.ask ?? 0,
    lastPrice: c.lastPrice ?? 0,
    impliedVolatility: c.impliedVolatility ?? 0,
    openInterest: c.openInterest ?? 0,
    volume: c.volume ?? 0,
  });
  const chains = (await Promise.all(wanted.map(async (exp) => {
    try {
      const r = await yahooFinance.options(symbol, { date: new Date(exp * 1000) }, { validateResult: false });
      const o = r.options?.[0];
      if (!o) return null;
      return {
        expirationDate: Math.floor(new Date(o.expirationDate).getTime() / 1000),
        underlyingPrice: r.quote?.regularMarketPrice ?? 0,
        puts: (o.puts || []).map(toContract),
        calls: [],
      };
    } catch (err) {
      console.error(`Thesis chain fetch ${symbol}@${exp} error:`, err?.message || String(err));
      return null;
    }
  }))).filter(Boolean);

  return chains;
}

async function fetchThesisMarketInputs(refresh) {
  const { data: crash, volatility } = await getCrashScan({ refresh });
  const day = 86400000;
  const now = Date.now();

  // Debasement trend inputs
  const period1 = new Date(now - 400 * day);
  const debasementAssets = await Promise.all(DEBASEMENT_ASSETS.map(async (a) => {
    try {
      const r = await yahooFinance.chart(a.symbol, { period1, interval: '1d' }, { validateResult: false });
      const q = (r.quotes || []).filter((x) => x.close != null);
      const history = {
        closes: q.map((x) => x.close), highs: q.map((x) => x.high),
        lows: q.map((x) => x.low), volumes: q.map((x) => x.volume),
      };
      return { ...a, analysis: analyzeAsset(history, a) };
    } catch {
      return { ...a, analysis: null };
    }
  }));

  // Credit-spread proxy inputs (HYG ÷ IEF), see computeCreditStress.
  const closesFor = async (symbol) => {
    try {
      const r = await yahooFinance.chart(symbol, { period1, interval: '1d' }, { validateResult: false });
      return (r.quotes || []).filter((x) => x.close != null).map((x) => x.adjclose ?? x.close);
    } catch (err) {
      console.error(`Credit input ${symbol} error:`, err?.message || String(err));
      return [];
    }
  };
  const [hyg, ief] = await Promise.all([closesFor('HYG'), closesFor('IEF')]);

  return { crash, volatility, debasementAssets, creditInputs: { hyg, ief }, fetchedAt: new Date().toISOString() };
}

app.get('/thesis/karsan', async (req, res) => {
  const num = (v, d) => (v != null && v !== '' && Number.isFinite(+v) ? +v : d);
  try {
    const refresh = req.query.refresh === '1';
    const underlying = resolveUnderlying(req.query.underlying);
    if (!thesisMarketCache || thesisMarketCache.expiresAt <= Date.now() || refresh) {
      const inputs = await fetchThesisMarketInputs(refresh);
      thesisMarketCache = { inputs, expiresAt: Date.now() + THESIS_TTL, cached: false };
    } else {
      thesisMarketCache.cached = true;
    }
    const { inputs } = thesisMarketCache;

    // Per-underlying option chains, cached separately so switching underlyings
    // reuses the crash/debasement inputs without refetching them.
    let chainsEntry = thesisChainsCache.get(underlying.symbol);
    if (!chainsEntry || chainsEntry.expiresAt <= Date.now() || refresh) {
      const chains = await fetchThesisChains(underlying.symbol);
      chainsEntry = { chains, expiresAt: Date.now() + THESIS_TTL };
      thesisChainsCache.set(underlying.symbol, chainsEntry);
    }

    const result = buildCrashThesis({
      asOf: Date.now(),
      crash: inputs.crash,
      volatility: inputs.volatility,
      chains: chainsEntry.chains,
      underlying,
      debasementAssets: inputs.debasementAssets,
      creditInputs: inputs.creditInputs,
      portfolioValue: num(req.query.portfolio, 500000),
      hedgeBudgetPct: num(req.query.budget, 0.02),
      equityExposurePct: num(req.query.equity, 0.8),
      flyTarget: num(req.query.flyTarget, 0.20),
      flyExpiry: req.query.flyExpiry != null && req.query.flyExpiry !== '' ? parseInt(req.query.flyExpiry, 10) : null,
    });
    res.json({
      ...result,
      fetchedAt: inputs.fetchedAt,
      cached: thesisMarketCache.cached,
      source: `Yahoo Finance (${underlying.symbol} options, ^VIX/^VIX3M curve, GLD/FXF/UUP, HYG/IEF credit proxy) + CFTC COT via Crash Radar`,
    });
  } catch (err) {
    console.error('Crash thesis error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ─── IBKR Client Portal Gateway endpoints ───────────────
// These endpoints proxy to the IBKR Client Portal Gateway (running locally
// on :5010) with automatic fallback to Yahoo Finance when IBKR is unavailable.
import * as ibkrProvider from './src/engine/ibkrProvider.js';
import * as dataProvider from './src/engine/dataProvider.js';

// Allow self-signed certs from IBKR gateway
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

// GET /ibkr/status — gateway health + active provider
app.get('/ibkr/status', async (req, res) => {
  try {
    const status = await dataProvider.getStatus();
    res.json(status);
  } catch (err) {
    res.status(500).json({ error: err.message, provider: 'none', ibkr: { online: false, authenticated: false } });
  }
});

// POST /ibkr/reconnect — force gateway re-authentication check
app.post('/ibkr/reconnect', async (req, res) => {
  try {
    const health = await ibkrProvider.healthCheck();
    if (health.online && health.authenticated) {
      ibkrProvider.startHeartbeat();
    }
    res.json({ success: true, ...health });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET /ibkr/quote?symbols=SPY,AAPL — real-time quotes (IBKR or Yahoo fallback)
app.get('/ibkr/quote', async (req, res) => {
  try {
    const symbols = (req.query.symbols || '').split(',').filter(Boolean).filter(validateSymbol);
    if (!symbols.length) return res.json({ quotes: [], provider: 'none' });
    if (symbols.length > 50) return res.status(400).json({ error: 'Too many symbols (max 50)', quotes: [], provider: 'none' });

    const { quotes, provider, error } = await dataProvider.getQuotes(symbols);
    res.json({ quotes, provider, error: error || undefined });
  } catch (err) {
    console.error('IBKR quote error:', err.message);
    res.status(500).json({ error: err.message, quotes: [], provider: 'none' });
  }
});

// GET /ibkr/history/:symbol?range=1y&interval=1d — historical OHLCV (IBKR or Yahoo fallback)
app.get('/ibkr/history/:symbol', async (req, res) => {
  try {
    const { symbol } = req.params;
    if (!validateSymbol(symbol)) return res.status(400).json({ error: 'Invalid symbol' });
    const { range = '1y', interval = '1d' } = req.query;

    const validRanges = ['1d', '5d', '1mo', '3mo', '6mo', '1y', '2y', '5y', '10y', 'max'];
    const validIntervals = ['1d', '1wk', '1mo', '5m', '15m', '1h'];
    if (!validRanges.includes(range)) return res.status(400).json({ error: 'Invalid range' });
    if (!validIntervals.includes(interval)) return res.status(400).json({ error: 'Invalid interval' });

    const { data, provider, error } = await dataProvider.getHistory(symbol, range, interval);
    res.json({ ...data, provider, error: error || undefined });
  } catch (err) {
    console.error(`IBKR history error (${req.params.symbol}):`, err.message);
    res.status(500).json({ error: err.message, dates: [], closes: [], highs: [], lows: [], opens: [], volumes: [], provider: 'none' });
  }
});

// GET /ibkr/options/:symbol — options chain (IBKR or Yahoo fallback)
app.get('/ibkr/options/:symbol', async (req, res) => {
  try {
    const { symbol } = req.params;
    if (!validateSymbol(symbol)) return res.status(400).json({ error: 'Invalid symbol' });
    const { date } = req.query;
    if (date && (isNaN(parseInt(date)) || parseInt(date) < 0)) return res.status(400).json({ error: 'Invalid date' });

    const { data, provider, error } = await dataProvider.getOptions(symbol, date ? parseInt(date) : undefined);
    res.json({ ...data, provider, error: error || undefined });
  } catch (err) {
    console.error(`IBKR options error (${req.params.symbol}):`, err.message);
    res.json({ expirations: [], strikes: [], calls: [], puts: [], underlyingPrice: 0, underlyingName: req.params.symbol, expirationDate: 0, provider: 'none' });
  }
});

// GET /ibkr/account/summary — IBKR account balance & P&L (IBKR only, no Yahoo fallback)
app.get('/ibkr/account/summary', async (req, res) => {
  try {
    const summary = await ibkrProvider.getAccountSummary();
    res.json(summary);
  } catch (err) {
    console.error('IBKR account summary error:', err.message);
    res.status(503).json({ error: err.message, _source: 'ibkr' });
  }
});

// GET /ibkr/account/positions — IBKR account positions (IBKR only, no Yahoo fallback)
app.get('/ibkr/account/positions', async (req, res) => {
  try {
    const positions = await ibkrProvider.getPositions();
    res.json({ positions, _source: 'ibkr' });
  } catch (err) {
    console.error('IBKR positions error:', err.message);
    res.status(503).json({ error: err.message, positions: [], _source: 'ibkr' });
  }
});

// ─── Reject unknown /yf/* and /ibkr/* API routes ────────
app.use('/yf', (req, res) => {
  res.status(404).json({ error: 'Not found' });
});
app.use('/ibkr', (req, res) => {
  res.status(404).json({ error: 'Not found' });
});

// ─── Static frontend (production) ───────────────────────
// In production (e.g. Render), the Vite-built `dist/` directory is served
// from this same Express process so the whole app lives at one URL.
const distPath = path.join(__dirname, 'dist');
app.use(express.static(distPath));

// SPA fallback — any non-API GET serves index.html
app.get(/^\/(?!yf\/|ibkr\/).*/, (req, res) => {
  res.sendFile(path.join(distPath, 'index.html'), (err) => {
    if (err) res.status(404).send('Frontend not built. Run `npm run build` first.');
  });
});

const PORT = process.env.PORT || 3001;
// Bind to all interfaces for LAN/PWA access (still protected by rate limiting + input validation)
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running on http://0.0.0.0:${PORT}`);
});
