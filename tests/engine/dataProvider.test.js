import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the IBKR provider module
vi.mock('../../src/engine/ibkrProvider.js', () => ({
  healthCheck: vi.fn(),
  startHeartbeat: vi.fn(),
  stopHeartbeat: vi.fn(),
  getQuotes: vi.fn(),
  getHistory: vi.fn(),
  getOptions: vi.fn(),
  getAccountSummary: vi.fn(),
  getPositions: vi.fn(),
  checkAuthStatus: vi.fn(),
}));

// Mock yahoo-finance2
vi.mock('yahoo-finance2', () => {
  const mockQuote = vi.fn().mockResolvedValue([
    {
      symbol: 'SPY',
      shortName: 'SPDR S&P 500',
      regularMarketPrice: 745.71,
      regularMarketChange: 1.23,
      regularMarketChangePercent: 0.16,
      regularMarketPreviousClose: 744.48,
      regularMarketOpen: 745.0,
      regularMarketDayHigh: 746.0,
      regularMarketDayLow: 743.0,
      regularMarketVolume: 50000000,
      marketCap: 0,
      fiftyTwoWeekHigh: 760,
      fiftyTwoWeekLow: 650,
      fiftyDayAverage: 740,
      twoHundredDayAverage: 720,
      exchange: 'NYSEArca',
      marketState: 'CLOSED',
      currency: 'USD',
      regularMarketTime: new Date(),
    },
  ]);

  const mockChart = vi.fn().mockResolvedValue({
    quotes: [
      { date: new Date('2026-07-01'), close: 745, high: 746, low: 743, open: 744, volume: 50000000 },
      { date: new Date('2026-07-02'), close: 744, high: 747, low: 742, open: 745, volume: 48000000 },
    ],
    meta: {
      regularMarketPrice: 745,
      chartPreviousClose: 744,
      fiftyTwoWeekHigh: 760,
      fiftyTwoWeekLow: 650,
      shortName: 'SPDR S&P 500',
      symbol: 'SPY',
      exchangeName: 'NYSEArca',
      regularMarketVolume: 50000000,
    },
  });

  const mockOptions = vi.fn().mockResolvedValue({
    expirationDates: [new Date('2026-07-19')],
    strikes: [740, 745, 750],
    options: [{
      calls: [{ strike: 745, lastPrice: 3.50, bid: 3.40, ask: 3.60, volume: 1000, openInterest: 500, impliedVolatility: 0.15, inTheMoney: true, contractSymbol: 'SPY250719C00745000', expiration: new Date('2026-07-19'), change: 0.1, percentChange: 2.9 }],
      puts: [{ strike: 745, lastPrice: 2.50, bid: 2.40, ask: 2.60, volume: 800, openInterest: 300, impliedVolatility: 0.14, inTheMoney: false, contractSymbol: 'SPY250719P00745000', expiration: new Date('2026-07-19'), change: -0.05, percentChange: -1.9 }],
      expirationDate: new Date('2026-07-19'),
    }],
    quote: { regularMarketPrice: 745.71, shortName: 'SPDR S&P 500' },
  });

  return { default: class { quote = mockQuote; chart = mockChart; options = mockOptions; } };
});

import * as dataProvider from '../../src/engine/dataProvider.js';
import * as ibkr from '../../src/engine/ibkrProvider.js';

describe('dataProvider', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Reset env
    process.env.DATA_PROVIDER = 'auto';
  });

  describe('getStatus', () => {
    it('returns yahoo provider when IBKR is offline', async () => {
      ibkr.healthCheck.mockResolvedValue({ online: false, authenticated: false, connected: false });
      const status = await dataProvider.getStatus();
      expect(status.provider).toBe('yahoo');
      expect(status.ibkr.online).toBe(false);
    });

    it('returns ibkr provider when IBKR is online and authenticated', async () => {
      ibkr.healthCheck.mockResolvedValue({ online: true, authenticated: true, connected: true });
      const status = await dataProvider.getStatus();
      expect(status.provider).toBe('ibkr');
      expect(status.ibkr.online).toBe(true);
    });
  });

  describe('getQuotes', () => {
    it('uses IBKR when available', async () => {
      ibkr.healthCheck.mockResolvedValue({ online: true, authenticated: true, connected: true });
      ibkr.getQuotes.mockResolvedValue([
        { symbol: 'SPY', price: 745.71, _source: 'ibkr' },
      ]);

      const { quotes, provider } = await dataProvider.getQuotes(['SPY']);
      expect(provider).toBe('ibkr');
      expect(quotes).toHaveLength(1);
      expect(quotes[0].price).toBe(745.71);
    });

    it('falls back to Yahoo when IBKR fails', async () => {
      ibkr.healthCheck.mockResolvedValue({ online: true, authenticated: true, connected: true });
      ibkr.getQuotes.mockRejectedValue(new Error('IBKR connection failed'));

      const { quotes, provider } = await dataProvider.getQuotes(['SPY']);
      expect(provider).toBe('yahoo');
      expect(quotes).toHaveLength(1);
      expect(quotes[0].symbol).toBe('SPY');
    });

    it('uses Yahoo directly when IBKR is offline', async () => {
      ibkr.healthCheck.mockResolvedValue({ online: false, authenticated: false, connected: false });

      const { quotes, provider } = await dataProvider.getQuotes(['SPY']);
      expect(provider).toBe('yahoo');
      expect(quotes).toHaveLength(1);
    });

    it('returns empty quotes for empty input', async () => {
      const { quotes, provider } = await dataProvider.getQuotes([]);
      expect(quotes).toEqual([]);
      expect(provider).toBe('none');
    });
  });

  describe('getHistory', () => {
    it('uses IBKR when available and returns data', async () => {
      ibkr.healthCheck.mockResolvedValue({ online: true, authenticated: true, connected: true });
      ibkr.getHistory.mockResolvedValue({
        dates: ['2026-07-01', '2026-07-02'],
        closes: [745, 744],
        highs: [746, 747],
        lows: [743, 742],
        opens: [744, 745],
        volumes: [50000000, 48000000],
        meta: { regularMarketPrice: 744 },
        _source: 'ibkr',
      });

      const { data, provider } = await dataProvider.getHistory('SPY', '1mo', '1d');
      expect(provider).toBe('ibkr');
      expect(data.dates).toHaveLength(2);
    });

    it('falls back to Yahoo when IBKR returns empty data', async () => {
      ibkr.healthCheck.mockResolvedValue({ online: true, authenticated: true, connected: true });
      ibkr.getHistory.mockResolvedValue({ dates: [], closes: [], highs: [], lows: [], opens: [], volumes: [] });

      const { data, provider } = await dataProvider.getHistory('SPY', '1mo', '1d');
      expect(provider).toBe('yahoo');
      expect(data.dates).toHaveLength(2);
    });
  });

  describe('DATA_PROVIDER=yahoo (forced)', () => {
    it('always uses Yahoo regardless of IBKR status', async () => {
      process.env.DATA_PROVIDER = 'yahoo';
      ibkr.healthCheck.mockResolvedValue({ online: true, authenticated: true, connected: true });

      const { provider } = await dataProvider.getQuotes(['SPY']);
      expect(provider).toBe('yahoo');
      expect(ibkr.getQuotes).not.toHaveBeenCalled();
    });
  });
});
