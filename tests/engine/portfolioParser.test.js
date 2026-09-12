import { describe, it, expect } from 'vitest';
import { detectBroker, BROKER_PROFILES } from '../../src/engine/brokerProfiles.js';
import { parseCsv, classify, isUsSitus, buildManualProfile, parseOptionSymbol } from '../../src/engine/portfolioParser.js';

// ---------------------------------------------------------------------------
// detectBroker
// ---------------------------------------------------------------------------
describe('detectBroker', () => {
  it('detects Fidelity by headers', () => {
    const headers = ['Symbol', 'Description', 'Quantity', 'Last Price', 'Cost Basis Total'];
    const profile = detectBroker(headers);
    expect(profile).not.toBeNull();
    expect(profile.name).toBe('Fidelity');
  });

  it('detects Schwab by headers', () => {
    const headers = ['Symbol', 'Description', 'Quantity', 'Price', 'Price Change $', 'Market Value'];
    expect(detectBroker(headers).name).toBe('Schwab');
  });

  it('detects Vanguard by headers', () => {
    const headers = ['Ticker Symbol', 'Fund Name', 'Shares', 'Share Price', 'Total Value'];
    expect(detectBroker(headers).name).toBe('Vanguard');
  });

  it('detects IBKR by headers', () => {
    const headers = ['Symbol', 'Quantity', 'MarkPrice', 'CostBasisMoney', 'FifoPnlUnrealized'];
    expect(detectBroker(headers).name).toBe('IBKR');
  });

  it('detects Robinhood by headers', () => {
    const headers = ['Instrument', 'Quantity', 'Price', 'Average Cost'];
    expect(detectBroker(headers).name).toBe('Robinhood');
  });

  it('detects Generic by lowercase headers', () => {
    const headers = ['symbol', 'quantity', 'cost_basis'];
    expect(detectBroker(headers).name).toBe('Generic');
  });

  it('returns null for empty headers', () => {
    expect(detectBroker([])).toBeNull();
  });

  it('returns null for unrecognised headers', () => {
    expect(detectBroker(['foo', 'bar', 'baz'])).toBeNull();
  });

  it('returns null for non-array input', () => {
    expect(detectBroker(null)).toBeNull();
    expect(detectBroker('Symbol,Qty')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// classify
// ---------------------------------------------------------------------------
describe('classify', () => {
  it('classifies cash tickers correctly', () => {
    expect(classify('SPAXX')).toBe('cash');
    expect(classify('VMFXX')).toBe('cash');
    expect(classify('USD')).toBe('cash');
  });

  it('classifies known REIT tickers', () => {
    expect(classify('VNQ')).toBe('reit');
    expect(classify('O')).toBe('reit');
  });

  it('classifies known bond ETFs', () => {
    expect(classify('BND')).toBe('bond');
    expect(classify('AGG')).toBe('bond');
  });

  it('classifies foreign-listed ETFs by suffix', () => {
    expect(classify('CSPX.L')).toBe('etf');
    expect(classify('IWDA.AS')).toBe('etf');
  });

  it('defaults unrecognised symbol to equity', () => {
    expect(classify('AAPL')).toBe('equity');
    expect(classify('MSFT')).toBe('equity');
  });

  it('uses quoteType override when provided', () => {
    expect(classify('SPY', 'ETF')).toBe('etf');
    expect(classify('AAPL', 'EQUITY')).toBe('equity');
  });

  it('returns unknown for invalid input', () => {
    expect(classify(null)).toBe('unknown');
    expect(classify('')).toBe('unknown');
    expect(classify(42)).toBe('unknown');
  });
});

// ---------------------------------------------------------------------------
// isUsSitus
// ---------------------------------------------------------------------------
describe('isUsSitus', () => {
  it('US-listed equity is US-situs', () => {
    expect(isUsSitus('AAPL', 'equity')).toBe(true);
    expect(isUsSitus('MSFT', 'equity')).toBe(true);
  });

  it('Irish-domiciled UCITS ETFs are NOT US-situs', () => {
    expect(isUsSitus('CSPX', 'etf')).toBe(false);
    expect(isUsSitus('VUAA', 'etf')).toBe(false);
    expect(isUsSitus('IWDA', 'etf')).toBe(false);
  });

  it('foreign-listed symbols (suffix) are NOT US-situs', () => {
    expect(isUsSitus('CSPX.L', 'etf')).toBe(false);
    expect(isUsSitus('IWDA.AS', 'etf')).toBe(false);
  });

  it('cash is NOT US-situs', () => {
    expect(isUsSitus('SPAXX', 'cash')).toBe(false);
    expect(isUsSitus('USD', 'cash')).toBe(false);
  });

  it('US ETFs like VTI are US-situs', () => {
    expect(isUsSitus('VTI', 'etf')).toBe(true);
    expect(isUsSitus('SPY', 'etf')).toBe(true);
  });

  it('returns false for invalid input', () => {
    expect(isUsSitus(null, 'equity')).toBe(false);
    expect(isUsSitus('', 'equity')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// parseOptionSymbol
// ---------------------------------------------------------------------------
describe('parseOptionSymbol', () => {
  describe('OCC full format (AAPL250516C00150000)', () => {
    it('parses standard OCC symbol', () => {
      const r = parseOptionSymbol('AAPL250516C00150000');
      expect(r).not.toBeNull();
      expect(r.underlying).toBe('AAPL');
      expect(r.expiry).toBe('2025-05-16');
      expect(r.optionType).toBe('call');
      expect(r.strike).toBeCloseTo(150);
      expect(r.contractMultiplier).toBe(100);
    });
    it('parses put with prefix dash', () => {
      const r = parseOptionSymbol('-SPY250919P00450000');
      expect(r.underlying).toBe('SPY');
      expect(r.optionType).toBe('put');
      expect(r.strike).toBeCloseTo(450);
      expect(r.expiry).toBe('2025-09-19');
    });
  });

  describe('OCC short / Fidelity format (-AAPL250516C150)', () => {
    it('parses Fidelity-style dash prefix', () => {
      const r = parseOptionSymbol('-AAPL250516C150');
      expect(r.underlying).toBe('AAPL');
      expect(r.optionType).toBe('call');
      expect(r.strike).toBe(150);
      expect(r.expiry).toBe('2025-05-16');
    });
    it('parses ToS dot prefix', () => {
      const r = parseOptionSymbol('.TSLA260117P00200');
      expect(r.underlying).toBe('TSLA');
      expect(r.optionType).toBe('put');
      expect(r.strike).toBe(200);
    });
    it('handles decimal strike', () => {
      const r = parseOptionSymbol('-MSFT250620C00415500');
      expect(r.strike).toBeCloseTo(415.5);
    });
  });

  describe('IBKR verbose format (AAPL 16MAY25 150.0 C)', () => {
    it('parses IBKR 2-digit year', () => {
      const r = parseOptionSymbol('AAPL 16MAY25 150.0 C');
      expect(r.underlying).toBe('AAPL');
      expect(r.optionType).toBe('call');
      expect(r.strike).toBe(150);
      expect(r.expiry).toBe('2025-05-16');
    });
    it('parses IBKR 4-digit year', () => {
      const r = parseOptionSymbol('QQQ 20DEC2026 400 P');
      expect(r.underlying).toBe('QQQ');
      expect(r.optionType).toBe('put');
      expect(r.expiry).toBe('2026-12-20');
    });
  });

  describe('Slash-date format (AAPL 05/16/2025 150.00 C)', () => {
    it('parses slash-date full year', () => {
      const r = parseOptionSymbol('AAPL 05/16/2025 150.00 C');
      expect(r.underlying).toBe('AAPL');
      expect(r.expiry).toBe('2025-05-16');
      expect(r.strike).toBe(150);
    });
    it('parses slash-date 2-digit year', () => {
      const r = parseOptionSymbol('SPY 9/19/25 450 P');
      expect(r.underlying).toBe('SPY');
      expect(r.expiry).toBe('2025-09-19');
      expect(r.optionType).toBe('put');
    });
  });

  describe('Verbose text format (AAPL May 16 2025 $150 Call)', () => {
    it('parses verbose call with dollar sign', () => {
      const r = parseOptionSymbol('AAPL May 16 2025 $150 Call');
      expect(r.underlying).toBe('AAPL');
      expect(r.optionType).toBe('call');
      expect(r.strike).toBe(150);
    });
    it('parses verbose put without dollar sign', () => {
      const r = parseOptionSymbol('MSFT December 20 2026 300 Put');
      expect(r.underlying).toBe('MSFT');
      expect(r.optionType).toBe('put');
      expect(r.expiry).toBe('2026-12-20');
    });
  });

  describe('null cases', () => {
    it('returns null for plain equity symbol', () => {
      expect(parseOptionSymbol('AAPL')).toBeNull();
    });
    it('returns null for ETF symbol', () => {
      expect(parseOptionSymbol('SPY')).toBeNull();
    });
    it('returns null for empty string', () => {
      expect(parseOptionSymbol('')).toBeNull();
    });
    it('returns null for null input', () => {
      expect(parseOptionSymbol(null)).toBeNull();
    });
  });
});

// ---------------------------------------------------------------------------
// classify — option detection
// ---------------------------------------------------------------------------
describe('classify – option detection', () => {
  it('classifies OCC symbol as option', () => {
    expect(classify('AAPL250516C00150000')).toBe('option');
  });
  it('classifies IBKR option symbol as option', () => {
    expect(classify('AAPL 16MAY25 150.0 C')).toBe('option');
  });
  it('classifies quoteType=OPTION as option', () => {
    expect(classify('AAPL', 'OPTION')).toBe('option');
  });
  it('still classifies plain AAPL as equity', () => {
    expect(classify('AAPL')).toBe('equity');
  });
});

// ---------------------------------------------------------------------------
// isUsSitus — option cases
// ---------------------------------------------------------------------------
describe('isUsSitus – option cases', () => {
  it('AAPL call option is US-situs', () => {
    expect(isUsSitus('AAPL250516C00150000', 'option')).toBe(true);
  });
  it('option with explicit US underlying is US-situs', () => {
    expect(isUsSitus('-AAPL250516C150', 'option', 'AAPL')).toBe(true);
  });
  it('option with non-US underlying (CSPX) is non-US-situs', () => {
    expect(isUsSitus('CSPX250516C00100000', 'option', 'CSPX')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// parseCsv — Fidelity format
// ---------------------------------------------------------------------------
const FIDELITY_CSV = `Symbol,Description,Quantity,Last Price,Cost Basis Total,Current Value
AAPL,Apple Inc,10,$185.00,"$1,700.00","$1,850.00"
MSFT,Microsoft Corp,5,$415.00,"$1,500.00","$2,075.00"
SPAXX,Fidelity Gov MMF,1000,$1.00,"$1,000.00","$1,000.00"
`;

describe('parseCsv — Fidelity', () => {
  it('detects broker as Fidelity', () => {
    const result = parseCsv(FIDELITY_CSV);
    expect(result.broker).toBe('Fidelity');
  });

  it('parses 3 positions (including cash)', () => {
    const { positions } = parseCsv(FIDELITY_CSV);
    expect(positions).toHaveLength(3);
  });

  it('parses AAPL quantity and costBasis correctly', () => {
    const { positions } = parseCsv(FIDELITY_CSV);
    const aapl = positions.find(p => p.symbol === 'AAPL');
    expect(aapl).toBeDefined();
    expect(aapl.quantity).toBe(10);
    expect(aapl.costBasis).toBe(1700);
  });

  it('classifies SPAXX as cash', () => {
    const { positions } = parseCsv(FIDELITY_CSV);
    const cash = positions.find(p => p.symbol === 'SPAXX');
    expect(cash.classification).toBe('cash');
  });

  it('marks AAPL as US-situs', () => {
    const { positions } = parseCsv(FIDELITY_CSV);
    const aapl = positions.find(p => p.symbol === 'AAPL');
    expect(aapl.isUsSitus).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// parseCsv — Generic format
// ---------------------------------------------------------------------------
const GENERIC_CSV = `symbol,quantity,cost_basis,description
TSLA,8,200.00,Tesla
BND,50,74.50,Vanguard Bond ETF
CSPX,20,450.00,iShares Core S&P 500 UCITS
`;

describe('parseCsv — Generic', () => {
  it('detects broker as Generic', () => {
    expect(parseCsv(GENERIC_CSV).broker).toBe('Generic');
  });

  it('parses 3 positions', () => {
    expect(parseCsv(GENERIC_CSV).positions).toHaveLength(3);
  });

  it('CSPX is NOT US-situs', () => {
    const { positions } = parseCsv(GENERIC_CSV);
    const cspx = positions.find(p => p.symbol === 'CSPX');
    expect(cspx.isUsSitus).toBe(false);
  });

  it('BND classifies as bond', () => {
    const { positions } = parseCsv(GENERIC_CSV);
    const bnd = positions.find(p => p.symbol === 'BND');
    expect(bnd.classification).toBe('bond');
  });
});

// ---------------------------------------------------------------------------
// parseCsv — Edge cases
// ---------------------------------------------------------------------------
describe('parseCsv — edge cases', () => {
  it('returns empty + warning on empty input', () => {
    const result = parseCsv('');
    expect(result.positions).toHaveLength(0);
    expect(result.warnings.length).toBeGreaterThan(0);
  });

  it('returns warning when broker cannot be detected', () => {
    const result = parseCsv('foo,bar\n1,2\n');
    expect(result.warnings.some(w => w.includes('auto-detect'))).toBe(true);
    expect(result.positions).toHaveLength(0);
  });

  it('skips rows with missing symbol', () => {
    const csv = `symbol,quantity\n,10\nAAPL,5\n`;
    const { positions } = parseCsv(csv);
    expect(positions).toHaveLength(1);
    expect(positions[0].symbol).toBe('AAPL');
  });

  it('skips rows with zero quantity', () => {
    const csv = `symbol,quantity\nAAPL,0\nMSFT,5\n`;
    const { positions } = parseCsv(csv);
    expect(positions).toHaveLength(1);
  });

  it('handles parenthetical negatives in cost basis', () => {
    const csv = `symbol,quantity,cost_basis\nAAPL,10,(500.00)\n`;
    const { positions } = parseCsv(csv);
    expect(positions[0].costBasis).toBe(-500);
  });

  it('handles commas in numeric values', () => {
    const csv = `symbol,quantity,cost_basis\nAAPL,10,"1,250.00"\n`;
    const { positions } = parseCsv(csv);
    expect(positions[0].costBasis).toBe(1250);
  });

  it('accepts a manual profile override', () => {
    const csv = `ticker,shares\nGOOGL,3\n`;
    const manualProfile = {
      name: 'Manual',
      headerSignals: [],
      columnMap: { symbol: 'ticker', quantity: 'shares' },
    };
    const { positions, broker } = parseCsv(csv, manualProfile);
    expect(broker).toBe('Manual');
    expect(positions[0].symbol).toBe('GOOGL');
    expect(positions[0].quantity).toBe(3);
  });
});
