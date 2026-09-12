import { describe, it, expect } from 'vitest';
import { detectStrategies } from '../../src/engine/optionStrategies.js';

// ── Helpers ────────────────────────────────────────────────────────
const opt = (overrides) => ({
  symbol: 'X',
  quantity: 1,
  costBasis: 0,
  description: '',
  account: '',
  classification: 'option',
  isUsSitus: true,
  isOption: true,
  underlying: 'AAPL',
  optionType: 'call',
  strike: 150,
  expiry: '2025-06-20',
  contractMultiplier: 100,
  daysToExpiry: 30,
  inTheMoney: null,
  underlyingPrice: null,
  ...overrides,
});

const stock = (overrides) => ({
  symbol: 'AAPL', quantity: 100, costBasis: 15000,
  description: '', account: '',
  classification: 'equity', isUsSitus: true, isOption: false,
  underlying: null, optionType: null, strike: null, expiry: null,
  contractMultiplier: 100, daysToExpiry: null, inTheMoney: null, underlyingPrice: null,
  ...overrides,
});

// ── Vertical spreads ───────────────────────────────────────────────
describe('detectStrategies — vertical spreads', () => {
  it('detects bull call spread', () => {
    const r = detectStrategies([
      opt({ symbol: 'L', strike: 150, quantity:  1, optionType: 'call' }),
      opt({ symbol: 'H', strike: 160, quantity: -1, optionType: 'call' }),
    ]);
    expect(r.groups).toHaveLength(1);
    expect(r.groups[0].type).toBe('bull_call_spread');
    expect(r.optionGroups).toBe(1);
  });

  it('detects bear call spread', () => {
    const r = detectStrategies([
      opt({ strike: 150, quantity: -1, optionType: 'call' }),
      opt({ strike: 160, quantity:  1, optionType: 'call' }),
    ]);
    expect(r.groups[0].type).toBe('bear_call_spread');
  });

  it('detects bull put spread (long lower, short higher = credit)', () => {
    const r = detectStrategies([
      opt({ strike: 140, quantity:  1, optionType: 'put' }),
      opt({ strike: 150, quantity: -1, optionType: 'put' }),
    ]);
    expect(r.groups[0].type).toBe('bull_put_spread');
  });

  it('detects bear put spread (short lower, long higher = debit)', () => {
    const r = detectStrategies([
      opt({ strike: 140, quantity: -1, optionType: 'put' }),
      opt({ strike: 150, quantity:  1, optionType: 'put' }),
    ]);
    expect(r.groups[0].type).toBe('bear_put_spread');
  });
});

// ── Straddle / strangle ────────────────────────────────────────────
describe('detectStrategies — straddle / strangle', () => {
  it('detects long straddle', () => {
    const r = detectStrategies([
      opt({ strike: 150, optionType: 'call', quantity: 1 }),
      opt({ strike: 150, optionType: 'put',  quantity: 1 }),
    ]);
    expect(r.groups[0].type).toBe('long_straddle');
  });

  it('detects short strangle', () => {
    const r = detectStrategies([
      opt({ strike: 145, optionType: 'put',  quantity: -1 }),
      opt({ strike: 155, optionType: 'call', quantity: -1 }),
    ]);
    expect(r.groups[0].type).toBe('short_strangle');
  });
});

// ── Butterfly ──────────────────────────────────────────────────────
describe('detectStrategies — butterfly', () => {
  it('detects long call butterfly (1:-2:1)', () => {
    const r = detectStrategies([
      opt({ strike: 140, quantity:  1 }),
      opt({ strike: 150, quantity: -2 }),
      opt({ strike: 160, quantity:  1 }),
    ]);
    expect(r.groups[0].type).toBe('long_call_butterfly');
  });

  it('detects short put butterfly (-1:2:-1)', () => {
    const r = detectStrategies([
      opt({ strike: 140, optionType: 'put', quantity: -1 }),
      opt({ strike: 150, optionType: 'put', quantity:  2 }),
      opt({ strike: 160, optionType: 'put', quantity: -1 }),
    ]);
    expect(r.groups[0].type).toBe('short_put_butterfly');
  });

  it('rejects non-equidistant strikes as multi-leg', () => {
    const r = detectStrategies([
      opt({ strike: 140, quantity:  1 }),
      opt({ strike: 150, quantity: -2 }),
      opt({ strike: 165, quantity:  1 }),
    ]);
    expect(r.groups[0].type).toBe('multi_leg');
  });
});

// ── Iron condor / iron butterfly ───────────────────────────────────
describe('detectStrategies — iron condor / butterfly', () => {
  it('detects iron condor', () => {
    const r = detectStrategies([
      opt({ strike: 140, optionType: 'put',  quantity:  1 }),  // long lower put
      opt({ strike: 145, optionType: 'put',  quantity: -1 }),  // short put
      opt({ strike: 155, optionType: 'call', quantity: -1 }),  // short call
      opt({ strike: 160, optionType: 'call', quantity:  1 }),  // long upper call
    ]);
    expect(r.groups[0].type).toBe('iron_condor');
  });

  it('detects iron butterfly (short put strike == short call strike)', () => {
    const r = detectStrategies([
      opt({ strike: 140, optionType: 'put',  quantity:  1 }),
      opt({ strike: 150, optionType: 'put',  quantity: -1 }),
      opt({ strike: 150, optionType: 'call', quantity: -1 }),
      opt({ strike: 160, optionType: 'call', quantity:  1 }),
    ]);
    expect(r.groups[0].type).toBe('iron_butterfly');
  });
});

// ── Stock + option combos ──────────────────────────────────────────
describe('detectStrategies — covered call & collar', () => {
  it('detects covered call', () => {
    const r = detectStrategies([
      stock({ quantity: 100 }),
      opt({ strike: 160, optionType: 'call', quantity: -1 }),
    ]);
    expect(r.groups[0].type).toBe('covered_call');
    expect(r.groups[0].legs).toHaveLength(2);
  });

  it('detects collar (stock + long put + short call)', () => {
    const r = detectStrategies([
      stock({ quantity: 100 }),
      opt({ strike: 140, optionType: 'put',  quantity:  1 }),
      opt({ strike: 160, optionType: 'call', quantity: -1 }),
    ]);
    expect(r.groups[0].type).toBe('collar');
    expect(r.groups[0].legs).toHaveLength(3);
  });
});

// ── Calendar / diagonal ────────────────────────────────────────────
describe('detectStrategies — calendar / diagonal', () => {
  it('detects calendar spread (same strike, different expiry)', () => {
    const r = detectStrategies([
      opt({ strike: 150, expiry: '2025-06-20', quantity: -1 }),
      opt({ strike: 150, expiry: '2025-09-19', quantity:  1 }),
    ]);
    expect(r.groups[0].type).toBe('calendar_spread');
  });

  it('detects diagonal spread (different strike + expiry)', () => {
    const r = detectStrategies([
      opt({ strike: 150, expiry: '2025-06-20', quantity: -1 }),
      opt({ strike: 160, expiry: '2025-09-19', quantity:  1 }),
    ]);
    expect(r.groups[0].type).toBe('diagonal_spread');
  });
});

// ── Singletons & misc ──────────────────────────────────────────────
describe('detectStrategies — singletons', () => {
  it('keeps a lone option as a singleton', () => {
    const r = detectStrategies([opt({ quantity: 1 })]);
    expect(r.groups[0].type).toBe('single_call');
    expect(r.optionGroups).toBe(0);
  });

  it('keeps a lone stock as a singleton', () => {
    const r = detectStrategies([stock({ quantity: 50 })]);
    expect(r.groups[0].type).toBe('single_equity');
  });

  it('returns empty for empty input', () => {
    expect(detectStrategies([])).toEqual({ groups: [], optionGroups: 0 });
  });
});
