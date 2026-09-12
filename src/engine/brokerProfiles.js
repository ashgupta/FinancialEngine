/**
 * brokerProfiles.js
 * Registry of known broker CSV export formats.
 * Each profile maps broker-specific column headers to normalized field names.
 *
 * Constitution Principle VIII: this registry is the single source of truth
 * for broker format knowledge. New broker formats must be added here.
 */

/**
 * @typedef {Object} BrokerProfile
 * @property {string} name           - Human-readable broker name
 * @property {string[]} headerSignals - Column headers that uniquely identify this broker
 * @property {{ symbol: string, quantity: string, costBasis?: string,
 *              currentPrice?: string, description?: string, account?: string,
 *              dayChange?: string, dividendYield?: string }} columnMap
 */

/** @type {BrokerProfile[]} */
export const BROKER_PROFILES = [
  {
    name: 'Fidelity',
    headerSignals: ['Symbol', 'Description', 'Quantity', 'Last Price', 'Cost Basis Total'],
    columnMap: {
      symbol: 'Symbol',
      description: 'Description',
      quantity: 'Quantity',
      currentPrice: 'Last Price',
      costBasis: 'Cost Basis Total',
      currentValue: 'Current Value',
      dayChange: "Today's Gain/Loss Dollar",
    },
  },
  {
    name: 'Schwab',
    headerSignals: ['Symbol', 'Description', 'Quantity', 'Price', 'Price Change $', 'Market Value'],
    columnMap: {
      symbol: 'Symbol',
      description: 'Description',
      quantity: 'Quantity',
      currentPrice: 'Price',
      costBasis: 'Cost Basis',
      currentValue: 'Market Value',
      dayChange: 'Price Change $',
    },
  },
  {
    name: 'Vanguard',
    headerSignals: ['Ticker Symbol', 'Fund Name', 'Shares', 'Share Price', 'Total Value'],
    columnMap: {
      symbol: 'Ticker Symbol',
      description: 'Fund Name',
      quantity: 'Shares',
      currentPrice: 'Share Price',
      currentValue: 'Total Value',
    },
  },
  {
    name: 'ETRADE',
    headerSignals: ['Symbol', 'Last Price', 'Price Paid', 'Quantity', 'Total Gain'],
    columnMap: {
      symbol: 'Symbol',
      description: 'Description',
      quantity: 'Quantity',
      currentPrice: 'Last Price',
      costBasis: 'Price Paid',
    },
  },
  {
    name: 'IBKR',
    headerSignals: ['Symbol', 'Quantity', 'MarkPrice', 'CostBasisMoney', 'FifoPnlUnrealized'],
    columnMap: {
      symbol: 'Symbol',
      description: 'Description',
      quantity: 'Quantity',
      currentPrice: 'MarkPrice',
      costBasis: 'CostBasisMoney',
      // Option columns present in IBKR position exports
      strike: 'Strike',
      expiry: 'Expiry',
      optionType: 'Right',
      contractMultiplier: 'Mult',
    },
  },
  {
    name: 'Robinhood',
    headerSignals: ['Instrument', 'Quantity', 'Price', 'Average Cost'],
    columnMap: {
      symbol: 'Instrument',
      quantity: 'Quantity',
      currentPrice: 'Price',
      costBasis: 'Average Cost',
    },
  },
  {
    name: 'Generic',
    headerSignals: ['symbol', 'quantity'],
    columnMap: {
      symbol: 'symbol',
      quantity: 'quantity',
      costBasis: 'cost_basis',
      description: 'description',
      account: 'account',
    },
  },
];

/**
 * Detect broker profile from CSV column headers.
 * @param {string[]} headers - Raw header strings from parsed CSV
 * @returns {BrokerProfile | null} Matched profile, or null if no match
 */
export function detectBroker(headers) {
  if (!Array.isArray(headers) || headers.length === 0) return null;

  const headerSet = new Set(headers.map(h => h.trim()));

  let bestProfile = null;
  let bestScore = 1; // require at least 2 matches (score > 1)

  for (const profile of BROKER_PROFILES) {
    const matched = profile.headerSignals.filter(sig => headerSet.has(sig));
    if (matched.length > bestScore) {
      bestScore = matched.length;
      bestProfile = profile;
    }
  }
  return bestProfile;
}

// ─────────────────────────────────────────────────────────────
// Fuzzy header detection — pattern-scored, broker-agnostic
// ─────────────────────────────────────────────────────────────

/**
 * Scored keyword patterns for each normalized field.
 * Earlier entries score higher (more specific match).
 */
const FIELD_PATTERNS = {
  symbol: [
    { re: /^(symbol|ticker|instrument)$/i,              score: 100 },
    { re: /^(security|stock|asset)$/i,                  score: 90  },
    { re: /^(sym|tick|tkr)$/i,                          score: 85  },
    { re: /ticker.*symbol|symbol.*ticker/i,              score: 80  },
    { re: /(symbol|ticker|instrument)/i,                 score: 70  },
    { re: /(security|stock)/i,                           score: 55  },
    { re: /(isin|cusip|sedol)/i,                         score: 45  },
  ],
  quantity: [
    { re: /^(quantity|qty|shares|units)$/i,              score: 100 },
    { re: /^(holding|position)$/i,                       score: 80  },
    { re: /^(no\.?\s*of\s*(shares|units)|share\s*count)$/i, score: 90 },
    { re: /(quantity|qty|shares|units)/i,                score: 75  },
    { re: /(holding|position\s*size|amount\s*held)/i,    score: 60  },
  ],
  costBasis: [
    { re: /^cost\s*basis(\s*total)?$/i,                  score: 100 },
    { re: /^(avg|average)\s*cost(\s*per\s*share)?$/i,    score: 100 },
    { re: /^price\s*paid$/i,                             score: 95  },
    { re: /^(book\s*(value|cost)|total\s*cost|cost\s*total)$/i, score: 90 },
    { re: /^purchase\s*price$/i,                         score: 88  },
    { re: /(cost.*basis|basis.*cost)/i,                  score: 85  },
    { re: /(avg.*cost|average.*cost)/i,                  score: 80  },
    { re: /price.*paid/i,                                score: 75  },
    { re: /^cost$/i,                                     score: 60  },
  ],
  currentPrice: [
    { re: /^(last\s*price|current\s*price|mark\s*price|market\s*price)$/i, score: 100 },
    { re: /^(price|close|last|nav|rate|share\s*price)$/i, score: 90  },
    { re: /(last.*price|current.*price|market.*price|mark.*price)/i, score: 80 },
    { re: /^(close\s*price|closing\s*price)$/i,          score: 85  },
    { re: /price/i,                                      score: 35  },
  ],
  currentValue: [
    { re: /^(market\s*value|current\s*value|total\s*value|position\s*value)$/i, score: 100 },
    { re: /^(value|mkt\s*val(ue)?)$/i,                   score: 85  },
    { re: /(market.*value|total.*value|current.*value)/i, score: 80  },
    { re: /value/i,                                      score: 30  },
  ],
  description: [
    { re: /^(description|desc|name|fund\s*name|security\s*name|company\s*(name)?)$/i, score: 100 },
    { re: /(description|fund.*name|security.*name)/i,    score: 75  },
    { re: /^(company|issuer|asset\s*name)$/i,            score: 70  },
  ],
  account: [
    { re: /^(account|acct|account\s*(number|name|type)|portfolio)$/i, score: 100 },
    { re: /(account|portfolio)/i,                        score: 60  },
  ],
  // ── Option-specific fields ──────────────────────────────────
  underlying: [
    { re: /^(underlying|underlying\s*symbol|root|base\s*symbol)$/i, score: 100 },
    { re: /^(ul|u\.s\.)$/i,                              score: 85  },
    { re: /underlying/i,                                 score: 75  },
  ],
  optionType: [
    { re: /^(put\s*\/\s*call|call\s*\/\s*put|right|option\s*type)$/i, score: 100 },
    { re: /^(p\/c|c\/p|put_call|call_put)$/i,           score: 95  },
    { re: /(put.*call|call.*put|option.*type)/i,          score: 80  },
    { re: /^(type|cp)$/i,                                score: 70  },
  ],
  strike: [
    { re: /^(strike|strike\s*price|exercise\s*price)$/i, score: 100 },
    { re: /^(stk|strk|str\.?\s*px)$/i,                  score: 85  },
    { re: /strike/i,                                     score: 70  },
  ],
  expiry: [
    { re: /^(expiry|expiration|exp\.?(\s*date)?)$/i,     score: 100 },
    { re: /^(maturity|maturity\s*date|exp)$/i,           score: 90  },
    { re: /(expir|expiry)/i,                             score: 75  },
  ],
  contractMultiplier: [
    { re: /^(multiplier|mult|contract\s*size|lot\s*size)$/i, score: 100 },
    { re: /(multiplier|contract.*size|lot.*size)/i,      score: 75  },
  ],
};

const FUZZY_FIELDS = [
  'symbol', 'quantity', 'costBasis', 'currentPrice', 'currentValue',
  'description', 'account',
  'underlying', 'optionType', 'strike', 'expiry', 'contractMultiplier',
];

/** Score a single header against a field's patterns. Returns 0 if no match. */
function scoreHeader(header, field) {
  for (const { re, score } of (FIELD_PATTERNS[field] || [])) {
    if (re.test(header)) return score;
  }
  return 0;
}

/**
 * Fuzzy column detection using keyword-pattern scoring.
 * Greedily assigns the highest-scoring header to each field (no duplicates).
 *
 * @param {string[]} headers
 * @returns {{ name: string, headerSignals: [], columnMap: object, confidence: number, warnings: string[] } | null}
 */
export function fuzzyDetectColumns(headers) {
  if (!Array.isArray(headers) || headers.length === 0) return null;

  // Build all (score, headerIdx, field) candidates
  const candidates = [];
  for (let i = 0; i < headers.length; i++) {
    for (const field of FUZZY_FIELDS) {
      const s = scoreHeader(headers[i], field);
      if (s > 0) candidates.push({ score: s, idx: i, field });
    }
  }

  // Sort highest score first; greedy unique assignment
  candidates.sort((a, b) => b.score - a.score);
  const assigned = {};   // field → header string
  const usedIdx = new Set();

  for (const { score, idx, field } of candidates) {
    if (!assigned[field] && !usedIdx.has(idx)) {
      assigned[field] = headers[idx];
      usedIdx.add(idx);
    }
  }

  // Both symbol AND quantity are mandatory
  if (!assigned.symbol || !assigned.quantity) return null;

  const symScore  = scoreHeader(assigned.symbol,   'symbol');
  const qtyScore  = scoreHeader(assigned.quantity, 'quantity');
  const confidence = Math.round((symScore + qtyScore) / 2);

  const warnings = confidence < 70
    ? ['Auto-detection confidence is low — please verify the column mappings below.']
    : [];

  return {
    name: 'Auto-detected',
    headerSignals: [],
    columnMap: { ...assigned },
    confidence,
    warnings,
  };
}

// ─────────────────────────────────────────────────────────────
// Content-based column sniffing — last-resort tier
// ─────────────────────────────────────────────────────────────

const TICKER_RE  = /^[A-Z][A-Z0-9.\-^]{0,9}$/;
const DOLLAR_RE  = /^\$?-?[\d,]+\.\d{2}$/;
const INT_RE     = /^-?[\d,]+$/;

function analyzeColumn(header, rows) {
  const vals = rows
    .map(r => String(r[header] ?? '').replace(/[$,\s]/g, '').trim())
    .filter(v => v !== '' && v !== '--' && v !== 'N/A');

  if (vals.length === 0) return { type: 'empty', score: 0 };

  let ticker = 0, integer = 0, dollar = 0, decimal = 0;
  for (const v of vals) {
    if (TICKER_RE.test(v.toUpperCase())) ticker++;
    if (INT_RE.test(v))                   integer++;
    if (DOLLAR_RE.test(v))                dollar++;
    if (/^-?\d+\.\d+$/.test(v))           decimal++;
  }
  const n = vals.length;

  if (ticker / n > 0.55 && vals.every(v => v.length <= 12))
    return { type: 'symbol',   score: Math.round((ticker / n) * 85) };
  if (integer / n > 0.65 && dollar / n < 0.2)
    return { type: 'quantity', score: Math.round((integer / n) * 72) };
  if ((dollar + decimal) / n > 0.55)
    return { type: 'dollar',   score: Math.round(((dollar + decimal) / n) * 60) };
  if ((integer + decimal) / n > 0.65)
    return { type: 'numeric',  score: 40 };

  return { type: 'text', score: 0 };
}

/**
 * Detect column roles by inspecting data content (not header names).
 * Used as a fallback when fuzzyDetectColumns fails.
 *
 * @param {string[]} headers
 * @param {object[]} rows - PapaParse rows (header: true format)
 * @returns {{ name: string, headerSignals: [], columnMap: object, confidence: number, warnings: string[] } | null}
 */
export function sniffColumnTypes(headers, rows) {
  if (!Array.isArray(headers) || !Array.isArray(rows) || rows.length === 0) return null;

  const sample = rows.slice(0, Math.min(15, rows.length));
  const analysis = headers.map(h => ({ header: h, ...analyzeColumn(h, sample) }));

  const symbolCols   = analysis.filter(a => a.type === 'symbol').sort((a, b) => b.score - a.score);
  const quantityCols = analysis.filter(a => a.type === 'quantity').sort((a, b) => b.score - a.score);
  const dollarCols   = analysis.filter(a => a.type === 'dollar').sort((a, b) => b.score - a.score);
  const textCols     = analysis.filter(a => a.type === 'text');

  if (!symbolCols.length || !quantityCols.length) return null;

  const columnMap = {
    symbol:   symbolCols[0].header,
    quantity: quantityCols[0].header,
  };

  // Heuristic: if multiple dollar columns, the one with larger median values is currentValue;
  // smaller median or second column is costBasis.
  const medianOf = (col) => {
    const nums = sample
      .map(r => parseFloat(String(r[col.header] ?? '').replace(/[$,]/g, '')))
      .filter(v => !isNaN(v))
      .sort((a, b) => a - b);
    return nums.length ? nums[Math.floor(nums.length / 2)] : 0;
  };

  if (dollarCols.length >= 2) {
    const [a, b] = dollarCols;
    const [bigger, smaller] = medianOf(a) >= medianOf(b) ? [a, b] : [b, a];
    columnMap.currentValue = bigger.header;
    columnMap.costBasis    = smaller.header;
  } else if (dollarCols.length === 1) {
    columnMap.costBasis = dollarCols[0].header;
  }

  if (textCols.length > 0) {
    columnMap.description = textCols[0].header;
  }

  const confidence = Math.round((symbolCols[0].score + quantityCols[0].score) / 2);

  return {
    name: 'Content-detected',
    headerSignals: [],
    columnMap,
    confidence,
    warnings: ['Columns detected from data — please verify the field mappings are correct.'],
  };
}
