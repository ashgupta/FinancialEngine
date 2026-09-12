/**
 * Social-media aggregator for stock-watchlist chatter.
 *
 * Normalises raw responses from 4 free public sources into a single
 * unified Post shape, scores rough sentiment, and summarises per-symbol
 * statistics.
 *
 * Constitution Principle II: pure functions, no React, no I/O, no DOM.
 *
 * Sources:
 *   - StockTwits      explicit Bullish/Bearish tags from authors
 *   - Reddit          r/wallstreetbets, r/stocks, r/investing public JSON
 *   - Hacker News     Algolia search API (tech-stock signal)
 *   - Yahoo News      mainstream press mentions
 */

/**
 * @typedef {Object} Post
 * @property {string}  id
 * @property {'stocktwits'|'reddit'|'hackernews'|'news'} source
 * @property {string}  symbol
 * @property {string}  author
 * @property {string}  text
 * @property {string}  url
 * @property {number}  timestamp        unix seconds
 * @property {'bullish'|'bearish'|'neutral'} sentiment
 * @property {number}  sentimentScore   -1..+1
 * @property {number}  engagement       likes/comments/upvotes (best-effort)
 * @property {string}  [subreddit]      reddit only
 * @property {string}  [publisher]      news only
 */

// ── Sentiment scoring ─────────────────────────────────────────────────

const BULLISH_TERMS = [
  'moon', 'rocket', '🚀', 'breakout', 'bullish', 'buy', 'long', 'calls',
  'rally', 'pump', 'squeeze', 'all-time high', 'ath', 'beat estimates',
  'upgrade', 'outperform', 'strong buy', 'soaring', 'surge', 'gains',
  'higher', 'bullrun', 'undervalued', 'accumulate', 'hold', 'diamond hands',
];

const BEARISH_TERMS = [
  'crash', 'dump', 'bearish', 'sell', 'short', 'puts', 'tank', 'drop',
  'plunge', 'collapse', 'overvalued', 'bubble', 'downgrade', 'underperform',
  'miss estimates', 'losses', 'bagholder', 'rugpull', 'rugged', 'dead cat',
  'falling knife', 'capitulation', 'recession', 'bankrupt', 'bankruptcy',
];

/**
 * Score sentiment of a free-text post on a -1..+1 scale.
 * @param {string} text
 * @returns {{score: number, label: 'bullish'|'bearish'|'neutral'}}
 */
export function scoreSentiment(text) {
  if (!text || typeof text !== 'string') return { score: 0, label: 'neutral' };
  const lower = text.toLowerCase();
  let bull = 0;
  let bear = 0;
  for (const t of BULLISH_TERMS) if (lower.includes(t)) bull++;
  for (const t of BEARISH_TERMS) if (lower.includes(t)) bear++;
  if (bull === 0 && bear === 0) return { score: 0, label: 'neutral' };
  const score = (bull - bear) / Math.max(1, bull + bear);
  const label = score > 0.15 ? 'bullish' : score < -0.15 ? 'bearish' : 'neutral';
  return { score, label };
}

// ── Normalisers (per source) ──────────────────────────────────────────

/**
 * @param {object} msg StockTwits message object
 * @param {string} symbol
 * @returns {Post}
 */
export function normalizeStockTwits(msg, symbol) {
  const explicit = msg?.entities?.sentiment?.basic;          // 'Bullish' | 'Bearish' | null
  const text = msg?.body ?? '';
  const fallback = scoreSentiment(text);
  const sentiment = explicit === 'Bullish'
    ? 'bullish'
    : explicit === 'Bearish'
    ? 'bearish'
    : fallback.label;
  const score = explicit === 'Bullish' ? 1
              : explicit === 'Bearish' ? -1
              : fallback.score;
  return {
    id: `st-${msg?.id ?? Math.random().toString(36).slice(2)}`,
    source: 'stocktwits',
    symbol,
    author: msg?.user?.username ?? 'unknown',
    text,
    url: `https://stocktwits.com/message/${msg?.id ?? ''}`,
    timestamp: msg?.created_at ? Math.floor(new Date(msg.created_at).getTime() / 1000) : 0,
    sentiment,
    sentimentScore: score,
    engagement: (msg?.likes?.total ?? 0) + (msg?.reshares?.reshared_count ?? 0),
  };
}

/**
 * @param {object} child Reddit listing child ({ kind, data })
 * @param {string} symbol
 * @returns {Post}
 */
export function normalizeReddit(child, symbol) {
  const d = child?.data ?? {};
  const text = `${d.title ?? ''} ${d.selftext ?? ''}`.trim();
  const sent = scoreSentiment(text);
  return {
    id: `rd-${d.id ?? Math.random().toString(36).slice(2)}`,
    source: 'reddit',
    symbol,
    author: d.author ?? 'unknown',
    text: d.title ?? '',
    url: d.permalink ? `https://reddit.com${d.permalink}` : (d.url ?? ''),
    timestamp: d.created_utc ?? 0,
    sentiment: sent.label,
    sentimentScore: sent.score,
    engagement: (d.ups ?? 0) + (d.num_comments ?? 0),
    subreddit: d.subreddit ?? '',
  };
}

/**
 * @param {object} hit Hacker News Algolia hit
 * @param {string} symbol
 * @returns {Post}
 */
export function normalizeHN(hit, symbol) {
  const text = `${hit?.title ?? ''} ${hit?.story_text ?? ''}`.trim();
  const sent = scoreSentiment(text);
  return {
    id: `hn-${hit?.objectID ?? Math.random().toString(36).slice(2)}`,
    source: 'hackernews',
    symbol,
    author: hit?.author ?? 'unknown',
    text: hit?.title ?? '',
    url: hit?.url || `https://news.ycombinator.com/item?id=${hit?.objectID ?? ''}`,
    timestamp: hit?.created_at_i ?? 0,
    sentiment: sent.label,
    sentimentScore: sent.score,
    engagement: (hit?.points ?? 0) + (hit?.num_comments ?? 0),
  };
}

/**
 * @param {object} item News item from Yahoo Finance search
 * @param {string} symbol
 * @returns {Post}
 */
export function normalizeNews(item, symbol) {
  const text = `${item?.title ?? ''} ${item?.summary ?? ''}`.trim();
  const sent = scoreSentiment(text);
  const ts = item?.providerPublishTime
    ? (typeof item.providerPublishTime === 'number'
        ? item.providerPublishTime
        : Math.floor(new Date(item.providerPublishTime).getTime() / 1000))
    : 0;
  return {
    id: `nw-${item?.uuid ?? item?.link ?? Math.random().toString(36).slice(2)}`,
    source: 'news',
    symbol,
    author: item?.publisher ?? 'unknown',
    text: item?.title ?? '',
    url: item?.link ?? '',
    timestamp: ts,
    sentiment: sent.label,
    sentimentScore: sent.score,
    engagement: 0,
    publisher: item?.publisher ?? '',
  };
}

// ── Aggregation ───────────────────────────────────────────────────────

/**
 * Merge posts from all sources for a single symbol into one chronological
 * feed (newest first) and compute summary stats.
 *
 * @param {Post[]} posts
 * @param {string} symbol
 * @returns {{posts: Post[], stats: SymbolStats}}
 *
 * @typedef {Object} SymbolStats
 * @property {string} symbol
 * @property {number} totalPosts
 * @property {number} bullishCount
 * @property {number} bearishCount
 * @property {number} neutralCount
 * @property {number} bullishPct        0..1
 * @property {number} bearishPct        0..1
 * @property {number} netSentiment      -1..+1 (engagement-weighted average)
 * @property {Object<string,number>} bySource counts per source
 * @property {number} mostRecent        unix seconds (or 0 if empty)
 * @property {number} postsPerHour      mentions/hour over last 24h
 */
export function aggregateForSymbol(posts, symbol) {
  const filtered = (posts || []).filter(p => p && p.symbol === symbol);
  filtered.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));

  const stats = {
    symbol,
    totalPosts: filtered.length,
    bullishCount: 0,
    bearishCount: 0,
    neutralCount: 0,
    bullishPct: 0,
    bearishPct: 0,
    netSentiment: 0,
    bySource: { stocktwits: 0, reddit: 0, hackernews: 0, news: 0 },
    mostRecent: filtered[0]?.timestamp ?? 0,
    postsPerHour: 0,
  };

  if (filtered.length === 0) return { posts: filtered, stats };

  let weightedSum = 0;
  let weightTotal = 0;
  const cutoff = Math.floor(Date.now() / 1000) - 86_400;

  for (const p of filtered) {
    if (p.sentiment === 'bullish') stats.bullishCount++;
    else if (p.sentiment === 'bearish') stats.bearishCount++;
    else stats.neutralCount++;

    if (stats.bySource[p.source] != null) stats.bySource[p.source]++;

    const w = 1 + Math.log10(1 + (p.engagement ?? 0));
    weightedSum += (p.sentimentScore ?? 0) * w;
    weightTotal += w;
  }

  stats.bullishPct = stats.bullishCount / filtered.length;
  stats.bearishPct = stats.bearishCount / filtered.length;
  stats.netSentiment = weightTotal > 0 ? weightedSum / weightTotal : 0;

  const recent24h = filtered.filter(p => (p.timestamp ?? 0) >= cutoff).length;
  stats.postsPerHour = recent24h / 24;

  return { posts: filtered, stats };
}

/**
 * Compute aggregate stats across an entire watchlist for the dashboard.
 * @param {Object<string, SymbolStats>} statsBySymbol
 * @returns {{
 *   totalPosts: number,
 *   topBullish: SymbolStats[],   // sorted by netSentiment desc
 *   topBearish: SymbolStats[],   // sorted by netSentiment asc
 *   topMentioned: SymbolStats[], // sorted by totalPosts desc
 *   topTrending: SymbolStats[],  // sorted by postsPerHour desc
 * }}
 */
export function watchlistRollup(statsBySymbol) {
  const all = Object.values(statsBySymbol || {});
  const totalPosts = all.reduce((s, x) => s + (x.totalPosts ?? 0), 0);
  const withPosts = all.filter(s => s.totalPosts > 0);

  return {
    totalPosts,
    topBullish:   [...withPosts].sort((a, b) => b.netSentiment - a.netSentiment).slice(0, 5),
    topBearish:   [...withPosts].sort((a, b) => a.netSentiment - b.netSentiment).slice(0, 5),
    topMentioned: [...withPosts].sort((a, b) => b.totalPosts - a.totalPosts).slice(0, 5),
    topTrending:  [...withPosts].sort((a, b) => b.postsPerHour - a.postsPerHour).slice(0, 5),
  };
}

// ── Default watchlist ─────────────────────────────────────────────────

/**
 * Curated watchlist focused on names that actually generate social
 * chatter. Mix of mega-caps, meme stocks, indices, and sector ETFs.
 */
export const DEFAULT_SOCIAL_WATCHLIST = [
  { symbol: 'AAPL', name: 'Apple Inc.', group: 'Tech' },
  { symbol: 'NVDA', name: 'NVIDIA Corp.', group: 'Tech' },
  { symbol: 'TSLA', name: 'Tesla Inc.', group: 'Tech' },
  { symbol: 'SPY', name: 'SPDR S&P 500', group: 'Index' },
  { symbol: 'QQQ', name: 'Invesco QQQ', group: 'Index' },
  { symbol: 'PLTR', name: 'Palantir Technologies Inc.', group: 'Tech' },
  // Meme / retail-driven names
  { symbol: 'GME',   name: 'GameStop',       group: 'Retail Favourite' },
  { symbol: 'AMC',   name: 'AMC',            group: 'Retail Favourite' }
];

export function normalizeYoutube(item, symbol) {
  const snippet = item.snippet || {};
  const text = `${snippet.title} ${snippet.description}`;
  const sent = scoreSentiment(text);
  return {
    id: `yt-${item.id?.videoId || Math.random().toString(36).slice(2)}`,
    source: 'youtube',
    symbol,
    author: snippet.channelTitle || 'YouTube',
    text: snippet.title || '',
    url: `https://www.youtube.com/watch?v=${item.id?.videoId}`,
    timestamp: snippet.publishedAt ? Math.floor(new Date(snippet.publishedAt).getTime() / 1000) : 0,
    sentiment: sent.label,
    sentimentScore: sent.score,
    engagement: 0,
  };
}

export function normalizeFinnhub(item, symbol) {
  const text = `${item.headline} ${item.summary}`;
  const sent = scoreSentiment(text);
  return {
    id: `fh-${item.id || Math.random().toString(36).slice(2)}`,
    source: 'finnhub',
    symbol,
    author: item.source || 'Finnhub',
    text: item.headline || '',
    url: item.url || '',
    timestamp: item.datetime || 0,
    sentiment: sent.label,
    sentimentScore: sent.score,
    engagement: 0,
  };
}

export function normalizeAlphaVantage(item, symbol) {
  const ts = (item.ticker_sentiment || []).find(t => t.ticker === symbol);
  let sentLabel = 'neutral';
  let sentScore = 0;
  
  if (ts) {
    if (ts.ticker_sentiment_label === 'Bullish' || ts.ticker_sentiment_label === 'Somewhat-Bullish') {
      sentLabel = 'bullish'; sentScore = 1;
    } else if (ts.ticker_sentiment_label === 'Bearish' || ts.ticker_sentiment_label === 'Somewhat-Bearish') {
      sentLabel = 'bearish'; sentScore = -1;
    }
  } else {
    const fallback = scoreSentiment(`${item.title} ${item.summary}`);
    sentLabel = fallback.label;
    sentScore = fallback.score;
  }

  const timeStr = item.time_published || ''; // format: YYYYMMDDTHHMMSS
  let timestamp = 0;
  if (timeStr.length === 15) {
    const y = timeStr.slice(0, 4), mo = timeStr.slice(4, 6), d = timeStr.slice(6, 8);
    const h = timeStr.slice(9, 11), m = timeStr.slice(11, 13), s = timeStr.slice(13, 15);
    timestamp = Math.floor(new Date(`${y}-${mo}-${d}T${h}:${m}:${s}Z`).getTime() / 1000);
  }

  return {
    id: `av-${Math.random().toString(36).slice(2)}`,
    source: 'alphavantage',
    symbol,
    author: item.source || 'AlphaVantage',
    text: item.title || '',
    url: item.url || '',
    timestamp,
    sentiment: sentLabel,
    sentimentScore: sentScore,
    engagement: 0,
  };
}

export function normalizeAll(payload, symbol) {
  if (!payload) return [];
  const posts = [];
  if (Array.isArray(payload.stocktwits?.messages)) {
    posts.push(...payload.stocktwits.messages.map(m => normalizeStockTwits(m, symbol)));
  }
  if (Array.isArray(payload.reddit?.children)) {
    posts.push(...payload.reddit.children.map(m => normalizeReddit(m, symbol)));
  }
  if (Array.isArray(payload.hackernews?.hits)) {
    posts.push(...payload.hackernews.hits.map(m => normalizeHN(m, symbol)));
  }
  if (Array.isArray(payload.news?.items)) {
    posts.push(...payload.news.items.map(m => normalizeNews(m, symbol)));
  }
  if (Array.isArray(payload.youtube?.items)) {
    posts.push(...payload.youtube.items.map(m => normalizeYoutube(m, symbol)));
  }
  if (Array.isArray(payload.finnhub)) {
    posts.push(...payload.finnhub.map(m => normalizeFinnhub(m, symbol)));
  }
  if (Array.isArray(payload.alphavantage?.feed)) {
    posts.push(...payload.alphavantage.feed.map(m => normalizeAlphaVantage(m, symbol)));
  }
  return posts;
}

export async function fetchSocialAll(symbol) {
  try {
    const keysStr = localStorage.getItem('windsurf_social_keys');
    const keys = keysStr ? JSON.parse(keysStr) : {};
    const q = new URLSearchParams();
    if (keys.yt) q.append('yt', keys.yt);
    if (keys.fh) q.append('fh', keys.fh);
    if (keys.av) q.append('av', keys.av);

    const r = await fetch(`/social/all/${encodeURIComponent(symbol)}?${q.toString()}`);
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const payload = await r.json();
    return normalizeAll(payload, symbol);
  } catch (err) {
    console.error(`Social fetch failed for ${symbol}:`, err);
    return [];
  }
}
