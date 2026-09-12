import { describe, it, expect } from 'vitest';
import {
  scoreSentiment,
  normalizeStockTwits,
  normalizeReddit,
  normalizeHN,
  normalizeNews,
  aggregateForSymbol,
  watchlistRollup,
  DEFAULT_SOCIAL_WATCHLIST,
} from '../../src/engine/socialAggregator.js';

// ── scoreSentiment ────────────────────────────────────────────────────
describe('scoreSentiment', () => {
  it('returns neutral for empty / non-string input', () => {
    expect(scoreSentiment('').label).toBe('neutral');
    expect(scoreSentiment(null).label).toBe('neutral');
    expect(scoreSentiment(undefined).label).toBe('neutral');
  });

  it('flags bullish phrases', () => {
    const r = scoreSentiment('AAPL to the moon, calls printing, breakout incoming');
    expect(r.label).toBe('bullish');
    expect(r.score).toBeGreaterThan(0);
  });

  it('flags bearish phrases', () => {
    const r = scoreSentiment('TSLA is a bubble, puts loaded, expecting a crash');
    expect(r.label).toBe('bearish');
    expect(r.score).toBeLessThan(0);
  });

  it('mixed signal lands neutral', () => {
    const r = scoreSentiment('Some say buy, others say sell, market is mixed');
    expect(['neutral', 'bullish', 'bearish']).toContain(r.label);
    expect(Math.abs(r.score)).toBeLessThanOrEqual(1);
  });

  it('benign post returns neutral', () => {
    const r = scoreSentiment('Earnings report next Tuesday');
    expect(r.label).toBe('neutral');
    expect(r.score).toBe(0);
  });
});

// ── Normalisers ───────────────────────────────────────────────────────
describe('normalizeStockTwits', () => {
  it('uses explicit Bullish tag from author', () => {
    const p = normalizeStockTwits({
      id: 1,
      body: 'whatever',
      entities: { sentiment: { basic: 'Bullish' } },
      user: { username: 'trader1' },
      created_at: '2024-01-01T00:00:00Z',
      likes: { total: 5 },
    }, 'AAPL');
    expect(p.source).toBe('stocktwits');
    expect(p.symbol).toBe('AAPL');
    expect(p.sentiment).toBe('bullish');
    expect(p.sentimentScore).toBe(1);
    expect(p.author).toBe('trader1');
    expect(p.engagement).toBe(5);
  });

  it('uses explicit Bearish tag', () => {
    const p = normalizeStockTwits({
      id: 2, body: '', entities: { sentiment: { basic: 'Bearish' } },
    }, 'AAPL');
    expect(p.sentiment).toBe('bearish');
    expect(p.sentimentScore).toBe(-1);
  });

  it('falls back to keyword scoring when no explicit tag', () => {
    const p = normalizeStockTwits({
      id: 3, body: 'massive crash incoming, puts loaded',
    }, 'AAPL');
    expect(p.sentiment).toBe('bearish');
  });

  it('handles missing fields gracefully', () => {
    const p = normalizeStockTwits({}, 'AAPL');
    expect(p.author).toBe('unknown');
    expect(p.engagement).toBe(0);
  });
});

describe('normalizeReddit', () => {
  it('extracts title, author, score, comments', () => {
    const p = normalizeReddit({
      data: {
        id: 'abc123',
        title: 'GME to the moon, diamond hands',
        selftext: '',
        author: 'apes',
        subreddit: 'wallstreetbets',
        ups: 1500,
        num_comments: 200,
        created_utc: 1700000000,
        permalink: '/r/wallstreetbets/comments/abc123/',
      },
    }, 'GME');
    expect(p.source).toBe('reddit');
    expect(p.symbol).toBe('GME');
    expect(p.author).toBe('apes');
    expect(p.subreddit).toBe('wallstreetbets');
    expect(p.engagement).toBe(1700);
    expect(p.url).toContain('reddit.com');
    expect(p.sentiment).toBe('bullish');
  });
});

describe('normalizeHN', () => {
  it('extracts story', () => {
    const p = normalizeHN({
      objectID: '123',
      title: 'Apple announces new chip',
      author: 'pg',
      url: 'https://example.com',
      created_at_i: 1700000000,
      points: 250,
      num_comments: 50,
    }, 'AAPL');
    expect(p.source).toBe('hackernews');
    expect(p.engagement).toBe(300);
  });

  it('falls back to HN URL when story has no external link', () => {
    const p = normalizeHN({ objectID: '999', title: 'Ask HN', created_at_i: 0 }, 'AAPL');
    expect(p.url).toContain('news.ycombinator.com/item?id=999');
  });
});

describe('normalizeNews', () => {
  it('handles unix-second providerPublishTime', () => {
    const p = normalizeNews({
      uuid: 'abc',
      title: 'Apple beats earnings, surge in revenue',
      summary: '',
      link: 'https://example.com/news',
      publisher: 'Reuters',
      providerPublishTime: 1700000000,
    }, 'AAPL');
    expect(p.source).toBe('news');
    expect(p.publisher).toBe('Reuters');
    expect(p.timestamp).toBe(1700000000);
    expect(p.sentiment).toBe('bullish');
  });

  it('handles ISO-string providerPublishTime', () => {
    const p = normalizeNews({
      title: 'x', link: 'y',
      providerPublishTime: '2024-01-01T00:00:00Z',
    }, 'AAPL');
    expect(p.timestamp).toBeGreaterThan(0);
  });
});

// ── aggregateForSymbol ────────────────────────────────────────────────
describe('aggregateForSymbol', () => {
  const now = Math.floor(Date.now() / 1000);
  const samplePosts = [
    {
      id: '1', source: 'stocktwits', symbol: 'AAPL', author: 'a', text: '',
      url: '', timestamp: now - 100, sentiment: 'bullish',  sentimentScore:  1, engagement: 10,
    },
    {
      id: '2', source: 'stocktwits', symbol: 'AAPL', author: 'b', text: '',
      url: '', timestamp: now - 200, sentiment: 'bearish',  sentimentScore: -1, engagement: 0,
    },
    {
      id: '3', source: 'reddit',     symbol: 'AAPL', author: 'c', text: '',
      url: '', timestamp: now - 300, sentiment: 'bullish',  sentimentScore: 0.5, engagement: 100,
    },
    {
      id: '4', source: 'reddit',     symbol: 'TSLA', author: 'd', text: '',
      url: '', timestamp: now - 400, sentiment: 'bearish',  sentimentScore: -0.5, engagement: 50,
    },
    {
      id: '5', source: 'news',       symbol: 'AAPL', author: 'e', text: '',
      url: '', timestamp: now - 500, sentiment: 'neutral',  sentimentScore: 0, engagement: 0,
    },
  ];

  it('filters posts to the target symbol', () => {
    const r = aggregateForSymbol(samplePosts, 'AAPL');
    expect(r.posts.length).toBe(4);
    expect(r.posts.every(p => p.symbol === 'AAPL')).toBe(true);
  });

  it('sorts newest first', () => {
    const r = aggregateForSymbol(samplePosts, 'AAPL');
    for (let i = 1; i < r.posts.length; i++) {
      expect(r.posts[i - 1].timestamp).toBeGreaterThanOrEqual(r.posts[i].timestamp);
    }
  });

  it('counts sentiment buckets', () => {
    const r = aggregateForSymbol(samplePosts, 'AAPL');
    expect(r.stats.bullishCount).toBe(2);
    expect(r.stats.bearishCount).toBe(1);
    expect(r.stats.neutralCount).toBe(1);
  });

  it('counts by source', () => {
    const r = aggregateForSymbol(samplePosts, 'AAPL');
    expect(r.stats.bySource.stocktwits).toBe(2);
    expect(r.stats.bySource.reddit).toBe(1);
    expect(r.stats.bySource.news).toBe(1);
    expect(r.stats.bySource.hackernews).toBe(0);
  });

  it('engagement-weighted net sentiment leans toward high-engagement posts', () => {
    // Reddit post (id=3) has engagement=100 and is bullish; should pull net positive
    const r = aggregateForSymbol(samplePosts, 'AAPL');
    expect(r.stats.netSentiment).toBeGreaterThan(0);
  });

  it('returns zero-stats for an empty symbol', () => {
    const r = aggregateForSymbol(samplePosts, 'NVDA');
    expect(r.posts.length).toBe(0);
    expect(r.stats.totalPosts).toBe(0);
    expect(r.stats.netSentiment).toBe(0);
    expect(r.stats.mostRecent).toBe(0);
  });

  it('postsPerHour computed over last 24h only', () => {
    const old = now - 86_400 * 2;        // 2 days ago, should be excluded
    const recent = now - 3600;           // 1 hour ago, included
    const r = aggregateForSymbol([
      { id: 'a', source: 'reddit', symbol: 'AAPL', timestamp: old,    sentiment: 'neutral', sentimentScore: 0, engagement: 0, author: '', text: '', url: '' },
      { id: 'b', source: 'reddit', symbol: 'AAPL', timestamp: recent, sentiment: 'neutral', sentimentScore: 0, engagement: 0, author: '', text: '', url: '' },
      { id: 'c', source: 'reddit', symbol: 'AAPL', timestamp: recent, sentiment: 'neutral', sentimentScore: 0, engagement: 0, author: '', text: '', url: '' },
    ], 'AAPL');
    expect(r.stats.postsPerHour).toBeCloseTo(2 / 24, 4);
  });
});

// ── watchlistRollup ───────────────────────────────────────────────────
describe('watchlistRollup', () => {
  it('produces top-5 lists across the watchlist', () => {
    const stats = {
      AAPL: { symbol: 'AAPL', totalPosts: 50, netSentiment:  0.6, postsPerHour: 2 },
      TSLA: { symbol: 'TSLA', totalPosts: 30, netSentiment: -0.4, postsPerHour: 5 },
      MSFT: { symbol: 'MSFT', totalPosts: 20, netSentiment:  0.2, postsPerHour: 1 },
      GME:  { symbol: 'GME',  totalPosts: 80, netSentiment:  0.8, postsPerHour: 8 },
      NVDA: { symbol: 'NVDA', totalPosts: 10, netSentiment: -0.7, postsPerHour: 0.5 },
      QQQ:  { symbol: 'QQQ',  totalPosts:  0, netSentiment:  0,   postsPerHour: 0 }, // excluded
    };
    const r = watchlistRollup(stats);
    expect(r.totalPosts).toBe(190);
    expect(r.topBullish[0].symbol).toBe('GME');
    expect(r.topBearish[0].symbol).toBe('NVDA');
    expect(r.topMentioned[0].symbol).toBe('GME');
    expect(r.topTrending[0].symbol).toBe('GME');
    // Empty-stats symbol (QQQ with 0 posts) should be excluded
    expect(r.topMentioned.find(x => x.symbol === 'QQQ')).toBeUndefined();
  });

  it('handles empty watchlist gracefully', () => {
    const r = watchlistRollup({});
    expect(r.totalPosts).toBe(0);
    expect(r.topBullish).toEqual([]);
  });
});

// ── Default watchlist ─────────────────────────────────────────────────
describe('DEFAULT_SOCIAL_WATCHLIST', () => {
  it('contains a diverse set of tickers', () => {
    expect(DEFAULT_SOCIAL_WATCHLIST.length).toBeGreaterThan(10);
    expect(DEFAULT_SOCIAL_WATCHLIST.every(w => w.symbol && w.name && w.group)).toBe(true);
  });

  it('includes mega-caps and retail favourites', () => {
    const symbols = DEFAULT_SOCIAL_WATCHLIST.map(w => w.symbol);
    expect(symbols).toContain('AAPL');
    expect(symbols).toContain('GME');
    expect(symbols).toContain('SPY');
  });
});
