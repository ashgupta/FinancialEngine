import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import {
  MessageCircle, RefreshCw, X, TrendingUp, TrendingDown,
  Minus, Flame, Clock, Filter, Search, Plus, Play, Database, Settings,
  Activity, ExternalLink, Award,
} from 'lucide-react';
import {
  normalizeStockTwits, normalizeReddit, normalizeHN, normalizeNews,
  normalizeYoutube, normalizeFinnhub, normalizeAlphaVantage,
  aggregateForSymbol, watchlistRollup,
} from '../engine/socialAggregator.js';
import { useWatchlist } from '../contexts/WatchlistContext.jsx';
import { OPTIONABLE_SYMBOLS } from '../engine/marketData.js';
import SectionTimestamp from './SectionTimestamp';
import WeeklyTrendView from './WeeklyTrendView';

// ─── Constants ───────────────────────────────────────────────
const SOURCE_META = {
  stocktwits:   { label: 'StockTwits',   color: 'bg-blue-500/15 text-blue-300 border-blue-500/30' },
  reddit:       { label: 'Reddit',       color: 'bg-orange-500/15 text-orange-300 border-orange-500/30' },
  hackernews:   { label: 'HN',           color: 'bg-amber-500/15 text-amber-300 border-amber-500/30' },
  news:         { label: 'Yahoo News',   color: 'bg-purple-500/15 text-purple-300 border-purple-500/30' },
  youtube:      { label: 'YouTube',      color: 'bg-red-500/15 text-red-300 border-red-500/30' },
  finnhub:      { label: 'Finnhub',      color: 'bg-cyan-500/15 text-cyan-300 border-cyan-500/30' },
  alphavantage: { label: 'AlphaVantage', color: 'bg-green-500/15 text-green-300 border-green-500/30' },
};
const SENTIMENT_META = {
  bullish: { color: 'text-green-400', bg: 'bg-green-500/15 border-green-500/30', icon: TrendingUp },
  bearish: { color: 'text-red-400',   bg: 'bg-red-500/15 border-red-500/30',     icon: TrendingDown },
  neutral: { color: 'text-gray-400',  bg: 'bg-gray-700/40 border-gray-600/30',   icon: Minus },
};
const ALL_SOURCES = ['stocktwits', 'reddit', 'hackernews', 'news', 'youtube', 'finnhub', 'alphavantage'];
const ALL_SENTIMENTS = ['bullish', 'bearish', 'neutral'];

function timeAgo(ts) {
  if (!ts) return '—';
  const diff = Math.floor(Date.now() / 1000) - ts;
  if (diff < 60) return `${diff}s`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m`;
  if (diff < 86_400) return `${Math.floor(diff / 3600)}h`;
  return `${Math.floor(diff / 86_400)}d`;
}

// Convert /social/all response → array of normalised Posts
function normalizeAll(payload, symbol) {
  if (!payload) return [];
  const posts = [];
  for (const m of (payload.stocktwits?.messages || [])) posts.push(normalizeStockTwits(m, symbol));
  for (const c of (payload.reddit?.children   || [])) posts.push(normalizeReddit(c, symbol));
  for (const h of (payload.hackernews?.hits   || [])) posts.push(normalizeHN(h, symbol));
  for (const i of (payload.news?.items        || [])) posts.push(normalizeNews(i, symbol));
  return posts;
}

// ─── UI primitives ───────────────────────────────────────────
function Card({ children, className = '' }) {
  return <div className={`bg-gray-800/60 border border-gray-700 rounded-lg p-4 ${className}`}>{children}</div>;
}

function SentimentBar({ stats }) {
  if (!stats || stats.totalPosts === 0) return <div className="text-xs text-gray-500">No data</div>;
  const total = stats.totalPosts;
  const bullPct = (stats.bullishCount / total) * 100;
  const bearPct = (stats.bearishCount / total) * 100;
  const neutPct = 100 - bullPct - bearPct;
  return (
    <div className="space-y-1">
      <div className="flex h-2 rounded-full overflow-hidden bg-gray-800">
        <div className="bg-green-500" style={{ width: `${bullPct}%` }} />
        <div className="bg-gray-500" style={{ width: `${neutPct}%` }} />
        <div className="bg-red-500" style={{ width: `${bearPct}%` }} />
      </div>
      <div className="flex justify-between text-[10px] text-gray-500">
        <span className="text-green-400">{bullPct.toFixed(0)}% bull</span>
        <span>{neutPct.toFixed(0)}% neut</span>
        <span className="text-red-400">{bearPct.toFixed(0)}% bear</span>
      </div>
    </div>
  );
}

function SymbolCard({ entry, stats, selected, onSelect, onRemove }) {
  const net = stats?.netSentiment ?? 0;
  const netColor = net > 0.15 ? 'text-green-400' : net < -0.15 ? 'text-red-400' : 'text-gray-400';
  return (
    <button
      onClick={() => onSelect(entry.symbol)}
      className={`w-full text-left p-3 rounded-lg border transition group ${
        selected
          ? 'bg-cyan-500/10 border-cyan-500/40'
          : 'bg-gray-900/40 border-gray-700 hover:border-gray-600'
      }`}
    >
      <div className="flex items-center justify-between mb-1">
        <div className="flex items-center gap-2">
          <span className="font-bold text-gray-100">{entry.symbol}</span>
          <span className={`text-xs ${netColor}`}>
            {net > 0 ? '+' : ''}{(net * 100).toFixed(0)}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-[10px] text-gray-500">{stats?.totalPosts ?? 0} posts</span>
          <button
            onClick={(e) => { e.stopPropagation(); onRemove(entry.symbol); }}
            className="opacity-0 group-hover:opacity-100 text-gray-500 hover:text-red-400 transition"
            title="Remove from watchlist"
          ><X size={12} /></button>
        </div>
      </div>
      <div className="text-[10px] text-gray-500 mb-2 truncate">{entry.name}</div>
      <SentimentBar stats={stats} />
    </button>
  );
}

function PostCard({ post }) {
  const sm = SENTIMENT_META[post.sentiment] || SENTIMENT_META.neutral;
  const SrcIcon = sm.icon;
  const src = SOURCE_META[post.source] || { label: post.source, color: 'bg-gray-700/40 text-gray-300 border-gray-600/30' };
  return (
    <div className="bg-gray-900/40 border border-gray-700 rounded-lg p-3 hover:border-gray-600 transition">
      <div className="flex items-center justify-between mb-2 text-[11px]">
        <div className="flex items-center gap-2">
          <span className="font-mono font-bold text-cyan-300">{post.symbol}</span>
          <span className={`px-1.5 py-0.5 rounded border ${src.color}`}>{src.label}</span>
          <span className={`flex items-center gap-1 px-1.5 py-0.5 rounded border ${sm.bg}`}>
            <SrcIcon size={10} className={sm.color} />
            <span className={sm.color}>{post.sentiment}</span>
          </span>
          {post.subreddit && <span className="text-gray-500">r/{post.subreddit}</span>}
          {post.publisher && <span className="text-gray-500">{post.publisher}</span>}
        </div>
        <div className="flex items-center gap-2 text-gray-500">
          <span className="flex items-center gap-1"><Clock size={10} />{timeAgo(post.timestamp)}</span>
          {post.url && (
            <a href={post.url} target="_blank" rel="noopener noreferrer" className="hover:text-cyan-400" title="Open original">
              <ExternalLink size={11} />
            </a>
          )}
        </div>
      </div>
      <div className="text-sm text-gray-200 leading-snug">{post.text || <span className="italic text-gray-500">(no text)</span>}</div>
      <div className="mt-1.5 flex items-center gap-3 text-[10px] text-gray-500">
        <span>@{post.author}</span>
        {post.engagement > 0 && <span className="flex items-center gap-1"><Activity size={9} />{post.engagement.toLocaleString()}</span>}
      </div>
    </div>
  );
}

// ─── Main component ────────────────────────────────────────
export default function SocialPulseTab() {
  const {
    watchlist, activeList, listNames, createList, deleteList, setActiveList,
    addSymbol: addGlobalSymbol, removeSymbol: removeGlobalSymbol,
  } = useWatchlist();
  const [newListInput, setNewListInput] = useState('');
  const [postsBySymbol, setPostsBySymbol] = useState({});      // symbol → Post[]
  const [statsBySymbol, setStatsBySymbol] = useState({});      // symbol → SymbolStats
  const [loadingSymbols, setLoadingSymbols] = useState(new Set());
  const [selectedSymbol, setSelectedSymbol] = useState(null);
  const [activeSources, setActiveSources] = useState(new Set(ALL_SOURCES));
  const [activeSentiments, setActiveSentiments] = useState(new Set(ALL_SENTIMENTS));
  const [lastRefresh, setLastRefresh] = useState(null);
  const [autoRefresh, setAutoRefresh] = useState(false);
  const [addSymbolInput, setAddSymbolInput] = useState('');
  const [showSettings, setShowSettings] = useState(false);
  const [apiKeys, setApiKeys] = useState(() => {
    try {
      const stored = localStorage.getItem('windsurf_social_keys');
      return stored ? JSON.parse(stored) : { yt: '', fh: '', av: '' };
    } catch {
      return { yt: '', fh: '', av: '' };
    }
  });
  const fetchedRef = useRef(false);

  // ── Persist states ─────────────────────────────────
  useEffect(() => { localStorage.setItem('windsurf_social_keys', JSON.stringify(apiKeys)); }, [apiKeys]);

  // ── Fetch one symbol ─────────────────────────────────
  const fetchOne = useCallback(async (symbol) => {
    setLoadingSymbols(s => new Set(s).add(symbol));
    try {
      const q = new URLSearchParams();
      if (apiKeys.yt) q.append('yt', apiKeys.yt);
      if (apiKeys.fh) q.append('fh', apiKeys.fh);
      if (apiKeys.av) q.append('av', apiKeys.av);

      const r = await fetch(`/social/all/${encodeURIComponent(symbol)}?${q.toString()}`);
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const payload = await r.json();
      const posts = normalizeAll(payload, symbol);
      const { stats } = aggregateForSymbol(posts, symbol);
      setPostsBySymbol(prev => ({ ...prev, [symbol]: posts }));
      setStatsBySymbol(prev => ({ ...prev, [symbol]: stats }));
    } catch (err) {
      console.error(`Social fetch failed for ${symbol}:`, err);
    } finally {
      setLoadingSymbols(s => {
        const next = new Set(s);
        next.delete(symbol);
        return next;
      });
    }
  }, []);

  // ── Refresh entire watchlist (parallel, throttled to 4 at a time) ──
  const refreshAll = useCallback(async () => {
    const symbols = watchlist.map(w => w.symbol);
    const batchSize = 4;
    for (let i = 0; i < symbols.length; i += batchSize) {
      await Promise.all(symbols.slice(i, i + batchSize).map(fetchOne));
    }
    setLastRefresh(new Date());
  }, [watchlist, fetchOne]);

  // ── Initial fetch ────────────────────────────────────
  useEffect(() => {
    if (!fetchedRef.current) {
      fetchedRef.current = true;
      refreshAll();
    }
  }, [refreshAll]);

  // ── Auto-refresh (every 24h) ─────────────────────────
  useEffect(() => {
    if (!autoRefresh) return;
    const id = setInterval(refreshAll, 24 * 60 * 60_000);
    return () => clearInterval(id);
  }, [autoRefresh, refreshAll]);

  // ── Watchlist management ─────────────────────────────
  const removeSymbol = (sym) => {
    removeGlobalSymbol(sym);
    setPostsBySymbol(p => { const next = { ...p }; delete next[sym]; return next; });
    setStatsBySymbol(s => { const next = { ...s }; delete next[sym]; return next; });
    if (selectedSymbol === sym) setSelectedSymbol(null);
  };

  const addSymbol = (e) => {
    e?.preventDefault?.();
    const input = addSymbolInput.trim().toUpperCase();
    if (!input) return;
    
    // Split by commas, spaces, or newlines to allow bulk-pasting from Excel
    const symbols = input.split(/[\s,]+/).filter(Boolean);
    let addedCount = 0;

    for (const sym of symbols) {
      if (addGlobalSymbol(sym)) {
        fetchOne(sym);
        addedCount++;
      }
    }

    if (addedCount > 0 || symbols.length === 1) {
      setAddSymbolInput('');
    }
  };

  // ── Derived: rollup + combined timeline ──────────────
  const rollup = useMemo(() => watchlistRollup(statsBySymbol), [statsBySymbol]);

  const allPosts = useMemo(() => {
    const merged = Object.values(postsBySymbol).flat();
    return merged
      .filter(p => activeSources.has(p.source))
      .filter(p => activeSentiments.has(p.sentiment))
      .filter(p => selectedSymbol == null || p.symbol === selectedSymbol)
      .sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
  }, [postsBySymbol, activeSources, activeSentiments, selectedSymbol]);

  const grouped = useMemo(() => {
    const groups = {};
    for (const w of watchlist) {
      if (!groups[w.group]) groups[w.group] = [];
      groups[w.group].push(w);
    }
    return groups;
  }, [watchlist]);

  const totalLoading = loadingSymbols.size > 0;

  // ── Render ───────────────────────────────────────────
  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <div className="flex items-center gap-2">
            <MessageCircle size={22} className="text-cyan-400" />
            <h1 className="text-2xl font-bold tracking-tight">Social Pulse</h1>
            {totalLoading && (
              <span className="text-xs text-gray-500 flex items-center gap-1">
                <RefreshCw size={11} className="animate-spin" /> fetching {loadingSymbols.size}…
              </span>
            )}
          </div>
          <p className="text-sm text-gray-400 mt-1">
            Live chatter from StockTwits, Reddit (WSB / stocks / investing), Hacker News, and financial press
          </p>
        </div>
        <div className="flex items-center gap-2">
          {lastRefresh && (
            <span className="text-xs text-gray-500 flex items-center gap-1">
              <Clock size={11} /> {lastRefresh.toLocaleTimeString()}
            </span>
          )}
          <button
            onClick={() => setAutoRefresh(a => !a)}
            className={`px-2.5 py-1.5 text-xs rounded-lg border transition ${
              autoRefresh ? 'bg-green-500/15 text-green-300 border-green-500/40' : 'bg-gray-800 text-gray-400 border-gray-700'
            }`}
          >
            Auto-refresh {autoRefresh ? 'ON' : 'OFF'}
          </button>
          <button
            onClick={() => setShowSettings(!showSettings)}
            className="p-1.5 text-gray-400 hover:text-white hover:bg-gray-700 rounded-lg transition"
            title="API Key Settings"
          >
            <Settings size={18} />
          </button>
          <button
            onClick={refreshAll}
            disabled={totalLoading}
            className="flex items-center gap-1 px-3 py-1.5 text-sm bg-gray-700 hover:bg-gray-600 disabled:opacity-50 rounded-lg text-gray-200"
          >
            <RefreshCw size={14} className={totalLoading ? 'animate-spin' : ''} /> Refresh
          </button>
        </div>
      </div>

      {/* Section timestamp */}
      {lastRefresh && (
        <SectionTimestamp fetchedAt={lastRefresh} label="Social Pulse" loading={totalLoading} onRefresh={refreshAll} />
      )}

      {/* Settings Panel */}
      {showSettings && (
        <Card className="border-blue-500/30 bg-blue-500/5">
          <h3 className="font-semibold text-lg flex items-center gap-2 mb-4">
            <Database size={18} className="text-blue-400" /> Premium Data Sources
          </h3>
          <p className="text-sm text-gray-400 mb-4">
            StockTwits, Reddit, HackerNews, and Yahoo News are included for free. You can add YouTube, Finnhub, and AlphaVantage by providing your own free API keys.
          </p>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <label className="block text-xs font-medium text-gray-400 uppercase tracking-wider mb-1">YouTube Data API</label>
              <input
                type="password"
                placeholder="AIzaSy..."
                value={apiKeys.yt}
                onChange={e => setApiKeys(k => ({ ...k, yt: e.target.value }))}
                className="w-full bg-gray-900 border border-gray-700 rounded p-2 text-sm focus:outline-none focus:border-blue-500"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-400 uppercase tracking-wider mb-1">Finnhub API</label>
              <input
                type="password"
                placeholder="cg..."
                value={apiKeys.fh}
                onChange={e => setApiKeys(k => ({ ...k, fh: e.target.value }))}
                className="w-full bg-gray-900 border border-gray-700 rounded p-2 text-sm focus:outline-none focus:border-blue-500"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-400 uppercase tracking-wider mb-1">AlphaVantage API</label>
              <input
                type="password"
                placeholder="XYZ123..."
                value={apiKeys.av}
                onChange={e => setApiKeys(k => ({ ...k, av: e.target.value }))}
                className="w-full bg-gray-900 border border-gray-700 rounded p-2 text-sm focus:outline-none focus:border-blue-500"
              />
            </div>
          </div>
        </Card>
      )}

      {/* Top rollup cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
        <Card>
          <div className="flex items-center gap-2 text-xs uppercase tracking-wider text-gray-500 mb-2">
            <Activity size={12} /> Total Posts
          </div>
          <div className="text-2xl font-bold text-gray-100">{rollup.totalPosts.toLocaleString()}</div>
          <div className="text-xs text-gray-500 mt-1">across {watchlist.length} symbols</div>
        </Card>
        <RollupCard title="Most Bullish" icon={TrendingUp} color="text-green-400" items={rollup.topBullish} fmt={(s) => `${(s.netSentiment * 100).toFixed(0)}`} onSelect={setSelectedSymbol} />
        <RollupCard title="Most Bearish" icon={TrendingDown} color="text-red-400"   items={rollup.topBearish} fmt={(s) => `${(s.netSentiment * 100).toFixed(0)}`} onSelect={setSelectedSymbol} />
        <RollupCard title="Trending"     icon={Flame}        color="text-orange-400" items={rollup.topTrending} fmt={(s) => `${s.postsPerHour.toFixed(1)}/h`} onSelect={setSelectedSymbol} />
      </div>

      {/* Two-column layout: watchlist + feed */}
      <div className="grid grid-cols-1 lg:grid-cols-4 gap-4">
        {/* Watchlist sidebar */}
        <div className="lg:col-span-1 space-y-3">
          <Card>
            {/* List tabs */}
            <div className="flex flex-wrap gap-1 mb-3">
              {listNames.map(name => (
                <button
                  key={name}
                  onClick={() => { setActiveList(name); setPostsBySymbol({}); setStatsBySymbol({}); }}
                  className={`text-[11px] px-2 py-0.5 rounded-full border transition ${
                    name === activeList
                      ? 'bg-cyan-500/20 text-cyan-300 border-cyan-500/40'
                      : 'bg-gray-800 text-gray-400 border-gray-700 hover:text-white'
                  }`}
                >
                  {name}
                </button>
              ))}
              <button
                onClick={() => {
                  const name = newListInput.trim();
                  if (name) { createList(name); setNewListInput(''); }
                }}
                title="New list"
                className="text-[11px] px-2 py-0.5 rounded-full border border-dashed border-gray-600 text-gray-500 hover:text-cyan-400 hover:border-cyan-500/40 transition"
              >
                + New
              </button>
              {listNames.length > 1 && (
                <button
                  onClick={() => deleteList(activeList)}
                  title="Delete active list"
                  className="text-[11px] px-2 py-0.5 rounded-full border border-dashed border-red-700/40 text-red-500/60 hover:text-red-400 hover:border-red-500/40 transition"
                >
                  Delete
                </button>
              )}
            </div>

            {/* New list name input */}
            <form onSubmit={e => { e.preventDefault(); const n = newListInput.trim(); if (n) { createList(n); setNewListInput(''); } }} className="flex gap-1 mb-2">
              <input
                value={newListInput}
                onChange={e => setNewListInput(e.target.value)}
                placeholder="New list name…"
                className="flex-1 bg-gray-900 border border-dashed border-gray-700 rounded px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-cyan-500/50 text-gray-400 placeholder-gray-600"
              />
            </form>

            <div className="flex items-center gap-2 text-xs uppercase tracking-wider text-gray-500 mb-2">
              <Award size={12} /> {activeList} ({watchlist.length})
            </div>

            <form onSubmit={addSymbol} className="flex gap-1 mb-3">
              <input
                value={addSymbolInput}
                onChange={(e) => setAddSymbolInput(e.target.value)}
                placeholder="Add ticker…"
                className="flex-1 bg-gray-900 border border-gray-700 rounded px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-cyan-500 uppercase"
              />
              <button type="submit" className="px-2 py-1 bg-cyan-500/20 text-cyan-300 rounded hover:bg-cyan-500/30">
                <Plus size={12} />
              </button>
            </form>

            <div className="space-y-3 max-h-[60vh] overflow-y-auto">
              {Object.entries(grouped).map(([group, entries]) => (
                <div key={group}>
                  <div className="text-[10px] uppercase tracking-wider text-gray-500 font-semibold mb-1.5">{group}</div>
                  <div className="space-y-1.5">
                    {entries.map(e => (
                      <SymbolCard
                        key={e.symbol}
                        entry={e}
                        stats={statsBySymbol[e.symbol]}
                        selected={selectedSymbol === e.symbol}
                        onSelect={(sym) => setSelectedSymbol(prev => prev === sym ? null : sym)}
                        onRemove={removeSymbol}
                      />
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </Card>
        </div>

        {/* Feed */}
        <div className="lg:col-span-3 space-y-3">
          {/* Filters */}
          <Card className="py-3">
            <div className="flex flex-wrap items-center gap-3">
              <div className="flex items-center gap-2">
                <Filter size={12} className="text-gray-500" />
                <span className="text-xs text-gray-500 uppercase tracking-wider">Sources</span>
                {ALL_SOURCES.map(src => {
                  const active = activeSources.has(src);
                  return (
                    <button
                      key={src}
                      onClick={() => setActiveSources(s => {
                        const next = new Set(s);
                        if (next.has(src)) next.delete(src); else next.add(src);
                        return next;
                      })}
                      className={`text-[10px] px-2 py-1 rounded border transition ${
                        active ? SOURCE_META[src].color : 'bg-gray-800/30 text-gray-500 border-gray-700'
                      }`}
                    >
                      {SOURCE_META[src].label}
                    </button>
                  );
                })}
              </div>
              <div className="flex items-center gap-2">
                <span className="text-xs text-gray-500 uppercase tracking-wider">Sentiment</span>
                {ALL_SENTIMENTS.map(s => {
                  const active = activeSentiments.has(s);
                  return (
                    <button
                      key={s}
                      onClick={() => setActiveSentiments(set => {
                        const next = new Set(set);
                        if (next.has(s)) next.delete(s); else next.add(s);
                        return next;
                      })}
                      className={`text-[10px] px-2 py-1 rounded border transition capitalize ${
                        active ? SENTIMENT_META[s].bg + ' ' + SENTIMENT_META[s].color : 'bg-gray-800/30 text-gray-500 border-gray-700'
                      }`}
                    >
                      {s}
                    </button>
                  );
                })}
              </div>
              {selectedSymbol && (
                <button
                  onClick={() => setSelectedSymbol(null)}
                  className="ml-auto text-xs text-cyan-400 hover:text-cyan-300 flex items-center gap-1"
                >
                  <X size={11} /> Clear filter: {selectedSymbol}
                </button>
              )}
            </div>
          </Card>

          {/* Posts */}
          <div className="space-y-3">
            {allPosts.length === 0 ? (
              <Card>
                <div className="py-6 text-center text-sm text-gray-500">
                  {totalLoading
                    ? 'Fetching latest chatter…'
                    : 'No posts match your filters. Try widening sentiment or source filters, or refresh.'}
                </div>
              </Card>
            ) : (
              allPosts.slice(0, 200).map((p, i) => <PostCard key={`${p.id}-${p.symbol}-${i}`} post={p} />)
            )}
            {allPosts.length > 200 && (
              <div className="text-center text-xs text-gray-500 py-2">
                Showing 200 of {allPosts.length} posts. Filter to narrow.
              </div>
            )}
          </div>
        </div>
      </div>

      {/* 12-Week Trend View */}
      <WeeklyTrendView symbol="SPY" title="SPY — 12-Week Market Sentiment Trend" color="#3b82f6" />
    </div>
  );
}

// ─── Rollup card (top bullish/bearish/trending) ──────────────
function RollupCard({ title, icon: Icon, color, items, fmt, onSelect }) {
  return (
    <Card>
      <div className={`flex items-center gap-2 text-xs uppercase tracking-wider text-gray-500 mb-2`}>
        <Icon size={12} className={color} /> {title}
      </div>
      {items.length === 0 ? (
        <div className="text-xs text-gray-500">No data yet</div>
      ) : (
        <div className="space-y-1">
          {items.slice(0, 3).map(s => (
            <button
              key={s.symbol}
              onClick={() => onSelect(prev => prev === s.symbol ? null : s.symbol)}
              className="w-full flex items-center justify-between text-xs hover:bg-gray-700/40 px-1.5 py-0.5 rounded transition"
            >
              <span className="font-mono font-bold text-gray-100">{s.symbol}</span>
              <span className={color}>{fmt(s)}</span>
            </button>
          ))}
        </div>
      )}
    </Card>
  );
}
