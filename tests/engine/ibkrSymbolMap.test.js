import { describe, it, expect, beforeEach } from 'vitest';
import {
  getIbkrSearchSymbol,
  getCachedConid,
  cacheConid,
  resolveConid,
  resolveConids,
} from '../../src/engine/ibkrSymbolMap.js';

describe('ibkrSymbolMap', () => {
  describe('getIbkrSearchSymbol', () => {
    it('maps Yahoo index symbols to IBKR search symbols', () => {
      expect(getIbkrSearchSymbol('^GSPC')).toEqual({ symbol: 'SPX', secType: 'IND' });
      expect(getIbkrSearchSymbol('^VIX')).toEqual({ symbol: 'VIX', secType: 'IND' });
      expect(getIbkrSearchSymbol('^IXIC')).toEqual({ symbol: 'COMP', secType: 'IND' });
    });

    it('maps Yahoo futures symbols to IBKR root symbols', () => {
      expect(getIbkrSearchSymbol('ES=F')).toEqual({ symbol: 'ES', secType: 'FUT', exchange: 'CME' });
      expect(getIbkrSearchSymbol('CL=F')).toEqual({ symbol: 'CL', secType: 'FUT', exchange: 'NYMEX' });
      expect(getIbkrSearchSymbol('GC=F')).toEqual({ symbol: 'GC', secType: 'FUT', exchange: 'COMEX' });
    });

    it('maps BRK-B to BRK B (IBKR format)', () => {
      expect(getIbkrSearchSymbol('BRK-B')).toEqual({ symbol: 'BRK B', secType: 'STK' });
    });

    it('passes through regular stock symbols', () => {
      const result = getIbkrSearchSymbol('AAPL');
      expect(result.symbol).toBe('AAPL');
      expect(result.secType).toBe('STK');
    });

    it('handles hyphenated symbols by converting to space', () => {
      const result = getIbkrSearchSymbol('BRK-B');
      // BRK-B is in the override table, so it returns the mapped value
      expect(result.symbol).toBe('BRK B');
    });
  });

  describe('getCachedConid / cacheConid', () => {
    it('returns known conids for common symbols', () => {
      expect(getCachedConid('SPY')).toBe(756733);
      expect(getCachedConid('AAPL')).toBe(265598);
      expect(getCachedConid('QQQ')).toBe(320227);
    });

    it('returns null for unknown symbols', () => {
      expect(getCachedConid('UNKNOWNXYZ')).toBeNull();
    });

    it('allows caching new conids at runtime', () => {
      cacheConid('TESTSYM', 12345);
      expect(getCachedConid('TESTSYM')).toBe(12345);
    });
  });

  describe('resolveConid', () => {
    it('returns cached conid without calling searchFn', async () => {
      const searchFn = vi.fn();
      const conid = await resolveConid('SPY', searchFn);
      expect(conid).toBe(756733);
      expect(searchFn).not.toHaveBeenCalled();
    });

    it('calls searchFn for uncached symbols', async () => {
      const searchFn = vi.fn().mockResolvedValue([{ conid: '99999' }]);
      const conid = await resolveConid('NEWSTOCK', searchFn);
      expect(conid).toBe(99999);
      expect(searchFn).toHaveBeenCalledWith('NEWSTOCK', 'STK');
    });

    it('caches resolved conids for future calls', async () => {
      const searchFn = vi.fn().mockResolvedValue([{ conid: '88888' }]);
      await resolveConid('CACHETEST', searchFn);
      expect(searchFn).toHaveBeenCalledTimes(1);
      // Second call should use cache
      const conid = await resolveConid('CACHETEST', vi.fn());
      expect(conid).toBe(88888);
    });

    it('returns null when search fails', async () => {
      const searchFn = vi.fn().mockRejectedValue(new Error('Network error'));
      const conid = await resolveConid('FAILSYM', searchFn);
      expect(conid).toBeNull();
    });

    it('returns null when search returns empty results', async () => {
      const searchFn = vi.fn().mockResolvedValue([]);
      const conid = await resolveConid('EMPTYRESULT', searchFn);
      expect(conid).toBeNull();
    });
  });

  describe('resolveConids (batch)', () => {
    it('resolves mixed cached and uncached symbols', async () => {
      const searchFn = vi.fn().mockResolvedValue([{ conid: '77777' }]);
      const result = await resolveConids(['SPY', 'NEWBATCH'], searchFn);
      expect(result.get('SPY')).toBe(756733);
      expect(result.get('NEWBATCH')).toBe(77777);
      expect(searchFn).toHaveBeenCalledTimes(1); // only for NEWBATCH
    });

    it('returns only cached symbols when all are cached', async () => {
      const searchFn = vi.fn();
      const result = await resolveConids(['SPY', 'AAPL'], searchFn);
      expect(result.get('SPY')).toBe(756733);
      expect(result.get('AAPL')).toBe(265598);
      expect(searchFn).not.toHaveBeenCalled();
    });
  });
});
