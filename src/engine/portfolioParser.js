/**
 * portfolioParser.js
 * Pure engine module: CSV text → normalized Position[]
 *
 * Constitution Principle II: no React, no DOM, no I/O.
 * Constitution Principle III: schema validation at input boundary.
 * Constitution Principle VIII: user-provided cost basis is labeled as such;
 *   no prices are fabricated here.
 */

import Papa from 'papaparse';
import { detectBroker, fuzzyDetectColumns, sniffColumnTypes, BROKER_PROFILES } from './brokerProfiles.js';

// ── Option symbol parsing ────────────────────────────────────────────────────
// Supported formats:
//   OCC full  : AAPL  250516C00150000   (YYMMDD + 8-digit strike × 1000)
//   OCC short : -AAPL250516C150        (Fidelity / ToS dot-prefix)
//   IBKR      : AAPL 16MAY25 150.0 C
//   Slash-date: AAPL 05/16/2025 150 C  (Schwab / ETRADE)
//   Verbose   : AAPL May 16 2025 $150 Call

const _MONTHS = { jan:0,feb:1,mar:2,apr:3,may:4,jun:5,jul:6,aug:7,sep:8,oct:9,nov:10,dec:11 };
const _RE_OCC_FULL  = /^[-.·\s]*([A-Z0-9]{1,6})\s*(\d{6})([CP])(\d{8})$/i;
const _RE_OCC_SHORT = /^[-.·\s]*([A-Z]{1,6})(\d{6})([CP])([\d]+(?:\.[\d]+)?)$/i;
const _RE_IBKR      = /^([A-Z]{1,6})\s+(\d{1,2})([A-Z]{3})(\d{2,4})\s+([\d.]+)\s+([CP])$/i;
const _RE_SLASH_DT  = /^([A-Z]{1,6})\s+(\d{1,2})\/(\d{1,2})\/(\d{2,4})\s+([\d.]+)\s+([CP])$/i;
const _RE_VERBOSE   = /^([A-Z]{1,6})\s+([A-Za-z]{3,9})\s+(\d{1,2}),?\s+(\d{4})\s+\$?([\d.]+)\s+(Call|Put|C|P)$/i;

function _occDate(s) {
  return `${2000 + parseInt(s.slice(0,2),10)}-${s.slice(2,4)}-${s.slice(4,6)}`;
}
function _occStrike(s) { return parseInt(s, 10) / 1000; }
function _optT(c)       { return c.toUpperCase() === 'C' ? 'call' : 'put'; }
function _padMon(n)     { return String(n + 1).padStart(2, '0'); }
function _pad2(s)       { return String(s).padStart(2, '0'); }

/**
 * Parse an option symbol string into its components.
 * Returns null for plain equity/ETF/bond symbols.
 *
 * @param {string} symbol
 * @returns {{ underlying:string, expiry:string, optionType:'call'|'put',
 *             strike:number, contractMultiplier:number } | null}
 */
export function parseOptionSymbol(symbol) {
  if (!symbol || typeof symbol !== 'string') return null;
  const s = symbol.trim();
  let m;

  if ((m = s.match(_RE_OCC_FULL)))
    return { underlying: m[1].toUpperCase(), expiry: _occDate(m[2]),
             optionType: _optT(m[3]), strike: _occStrike(m[4]), contractMultiplier: 100 };

  if ((m = s.match(_RE_OCC_SHORT)))
    return { underlying: m[1].toUpperCase(), expiry: _occDate(m[2]),
             optionType: _optT(m[3]), strike: parseFloat(m[4]), contractMultiplier: 100 };

  if ((m = s.match(_RE_IBKR))) {
    const mo = _MONTHS[m[3].toLowerCase()];
    if (mo == null) return null;
    const yr = m[4].length === 2 ? 2000 + parseInt(m[4]) : parseInt(m[4]);
    return { underlying: m[1].toUpperCase(),
             expiry: `${yr}-${_padMon(mo)}-${_pad2(m[2])}`,
             optionType: _optT(m[6]), strike: parseFloat(m[5]), contractMultiplier: 100 };
  }

  if ((m = s.match(_RE_SLASH_DT))) {
    const yr = m[4].length === 2 ? 2000 + parseInt(m[4]) : parseInt(m[4]);
    return { underlying: m[1].toUpperCase(),
             expiry: `${yr}-${_pad2(m[2])}-${_pad2(m[3])}`,
             optionType: _optT(m[6]), strike: parseFloat(m[5]), contractMultiplier: 100 };
  }

  if ((m = s.match(_RE_VERBOSE))) {
    const mo = _MONTHS[m[2].slice(0,3).toLowerCase()];
    if (mo == null) return null;
    return { underlying: m[1].toUpperCase(),
             expiry: `${m[4]}-${_padMon(mo)}-${_pad2(m[3])}`,
             optionType: /^c(all)?$/i.test(m[6]) ? 'call' : 'put',
             strike: parseFloat(m[5]), contractMultiplier: 100 };
  }

  return null;
}

/**
 * @typedef {Object} Position
 * @property {string}  symbol
 * @property {number}  quantity
 * @property {number|null} costBasis        total cost basis (USD), null if not provided
 * @property {string}  description
 * @property {string}  account
 * @property {'equity'|'etf'|'bond'|'reit'|'cash'|'option'|'unknown'} classification
 * @property {boolean} isUsSitus
 * @property {boolean} isOption
 * @property {string|null}       underlying        underlying symbol for options
 * @property {'call'|'put'|null} optionType
 * @property {number|null}       strike
 * @property {string|null}       expiry            ISO date YYYY-MM-DD
 * @property {number}            contractMultiplier default 100
 * @property {number|null}       daysToExpiry
 * @property {boolean|null}      inTheMoney        null until enriched with underlying price
 * @property {number|null}       underlyingPrice   set during enrichment
 */

/**
 * @typedef {Object} ParseResult
 * @property {Position[]} positions
 * @property {string}     broker           - detected broker name or 'Unknown'
 * @property {string[]}   warnings         - non-fatal issues encountered
 * @property {boolean}    autoDetected     - true when fuzzy/content detection was used
 * @property {number}     confidence       - 0-100 confidence in column mapping
 * @property {object|null} detectedColumns - the columnMap that was applied
 */

const CASH_TICKERS = new Set([
  'SPAXX', 'VMFXX', 'FDRXX', 'FDIC', 'FCASH', 'CORE',
  'USD', '$', 'CASH', 'MMDA1', 'SWVXX',
]);

const ETF_SUFFIXES = /\.(L|AS|PA|DE|MI|SW|ST|HE|CO|OL|LN)$/i;

const KNOWN_REIT_TICKERS = new Set([
  'VNQ', 'SCHH', 'IYR', 'RWR', 'AMT', 'PLD', 'EQIX', 'SPG', 'O', 'PSA',
  'DLR', 'AVB', 'EQR', 'WY', 'SBA', 'WELL', 'ARE', 'BXP', 'NNN',
]);

const KNOWN_BOND_TICKERS = new Set([
  'BND', 'AGG', 'LQD', 'TLT', 'IEF', 'SHY', 'BNDX', 'VCIT', 'VCSH',
  'MUB', 'HYG', 'JNK', 'TIP', 'VTIP', 'SCHR', 'SCHO', 'VGIT', 'VGLT',
]);

const IRISH_UCITS_TICKERS = new Set([
  'CSPX', 'VUAA', 'VWCE', 'IWDA', 'EIMI', 'AGGH', 'IUSA', 'SWDA',
  'VUSA', 'VHYL', 'IQQQ', 'ISAC',
]);

/**
 * Classify a symbol into an asset category.
 * @param {string} symbol
 * @param {string} [quoteType] - quoteType from Yahoo Finance quote (optional)
 * @returns {'equity'|'etf'|'bond'|'reit'|'cash'|'unknown'}
 */
export function classify(symbol, quoteType) {
  if (!symbol || typeof symbol !== 'string') return 'unknown';
  const s = symbol.trim().toUpperCase();

  if (CASH_TICKERS.has(s) || s === '' || s.startsWith('$')) return 'cash';

  if (quoteType) {
    const qt = quoteType.toLowerCase();
    if (qt === 'option') return 'option';
    if (qt === 'etf' || qt === 'mutualfund') return 'etf';
    if (qt === 'equity') {
      if (KNOWN_REIT_TICKERS.has(s)) return 'reit';
      return 'equity';
    }
  }

  if (parseOptionSymbol(s)) return 'option';
  if (KNOWN_REIT_TICKERS.has(s)) return 'reit';
  if (KNOWN_BOND_TICKERS.has(s)) return 'bond';
  if (ETF_SUFFIXES.test(s)) return 'etf';

  return 'equity';
}

/**
 * Determine US-situs classification for estate-tax purposes.
 * Source: IRC §2104 (US-situs assets for NRA estate tax).
 * US-situs: US-listed stocks, US-domiciled ETFs, US real estate.
 * Non-US-situs: Irish-domiciled UCITS, ADRs representing foreign shares,
 *   foreign-listed securities (e.g. CSPX.L).
 *
 * @param {string}      symbol
 * @param {string}      classification
 * @param {string|null} [underlying]  option's underlying for correct US-situs determination
 * @returns {boolean}
 */
export function isUsSitus(symbol, classification, underlying = null) {
  if (!symbol || typeof symbol !== 'string') return false;
  const s = symbol.trim().toUpperCase();

  if (classification === 'cash') return false;

  if (classification === 'option') {
    const ul = (underlying || parseOptionSymbol(s)?.underlying || '').toUpperCase();
    // Recurse: option is US-situs iff its underlying is US-situs
    return ul ? isUsSitus(ul, 'equity') : true;
  }

  if (IRISH_UCITS_TICKERS.has(s)) return false;
  if (ETF_SUFFIXES.test(s)) return false;

  return true;
}

/** Parse call/put string from a broker "Right" column. */
function _parseOptType(v) {
  if (!v) return null;
  const l = String(v).trim().toLowerCase();
  if (l === 'c' || l === 'call') return 'call';
  if (l === 'p' || l === 'put')  return 'put';
  return null;
}

/**
 * Parse a numeric string that may contain currency symbols, commas, parentheses.
 * Returns null if unparseable.
 * @param {string|number} val
 * @returns {number|null}
 */
function parseNum(val) {
  if (val === null || val === undefined || val === '') return null;
  if (typeof val === 'number') return isNaN(val) ? null : val;
  const cleaned = String(val)
    .replace(/[$,\s]/g, '')
    .replace(/\(([^)]+)\)/, '-$1');
  const n = parseFloat(cleaned);
  return isNaN(n) ? null : n;
}

/**
 * Build a manual (generic) broker profile for a given column mapping.
 * @param {{ symbol: string, quantity: string, costBasis?: string }} mapping
 * @returns {import('./brokerProfiles.js').BrokerProfile}
 */
export function buildManualProfile(mapping) {
  return {
    name: 'Manual',
    headerSignals: [],
    columnMap: mapping,
  };
}

/**
 * Parse CSV text into normalized positions.
 * @param {string} csvText       - Raw CSV string
 * @param {import('./brokerProfiles.js').BrokerProfile|null} [profile]
 *   Caller-supplied profile (from manual mapping). If null, auto-detection runs.
 * @returns {ParseResult}
 */
export function parseCsv(csvText, profile = null) {
  const warnings = [];

  if (!csvText || typeof csvText !== 'string' || csvText.trim() === '') {
    return { positions: [], broker: 'Unknown', warnings: ['Empty or invalid input'] };
  }

  // ── Step 1: Parse as raw 2D array so we can scan for the actual header row ──
  let raw;
  try {
    raw = Papa.parse(csvText.trim(), { header: false, skipEmptyLines: true });
  } catch (e) {
    return { positions: [], broker: 'Unknown', warnings: [`CSV parse error: ${e.message}`],
             autoDetected: false, confidence: 0, detectedColumns: null };
  }

  const allRows = (raw.data || []).filter(
    r => Array.isArray(r) && r.some(c => String(c ?? '').trim() !== '')
  );
  if (allRows.length === 0) {
    return { positions: [], broker: 'Unknown', warnings: ['No data rows found'],
             autoDetected: false, confidence: 0, detectedColumns: null };
  }

  // Helper: build object-rows for a given header row index
  const buildDataRows = (headerRow, fromIdx) => {
    const hdrs = headerRow.map(c => String(c ?? '').trim());
    return allRows.slice(fromIdx + 1).map(row => {
      const obj = {};
      for (let j = 0; j < hdrs.length; j++) {
        if (hdrs[j]) obj[hdrs[j]] = row[j];
      }
      return obj;
    });
  };

  // ── Step 2: Find the best header row across the first 15 rows ──
  let detectedProfile = null;
  let autoDetected    = false;
  let confidence      = 0;
  let bestHeaderIdx   = -1;
  let bestDataRows    = [];
  let headers         = [];

  if (profile) {
    // Caller passed an explicit profile (manual mapping flow) — assume row 0 is headers
    detectedProfile = profile;
    autoDetected    = false;
    confidence      = 100;
    bestHeaderIdx   = 0;
    headers         = allRows[0].map(c => String(c ?? '').trim());
    bestDataRows    = buildDataRows(allRows[0], 0);
  } else {
    const maxTry = Math.min(allRows.length - 1, 15);
    for (let i = 0; i <= maxTry; i++) {
      const candidate = allRows[i].map(c => String(c ?? '').trim());
      // Need ≥2 non-empty cells, and must be mostly text (not numeric data masquerading as headers)
      const nonEmpty = candidate.filter(Boolean);
      if (nonEmpty.length < 2) continue;
      const numericCells = nonEmpty.filter(c => /^-?[\d$,.\s]+$/.test(c)).length;
      if (numericCells / nonEmpty.length > 0.5) continue; // looks like a data row, not headers

      const dataRows = buildDataRows(allRows[i], i);

      // Try detection tiers on this candidate
      let p = detectBroker(candidate);
      let conf = p ? 100 : 0;
      let auto = false;
      if (!p) { p = fuzzyDetectColumns(candidate); if (p) { conf = p.confidence; auto = true; } }
      if (!p && dataRows.length > 0) {
        p = sniffColumnTypes(candidate, dataRows);
        if (p) { conf = p.confidence; auto = true; }
      }

      // Prefer earlier rows on ties; require strict improvement to override
      if (p && conf > confidence) {
        detectedProfile = p;
        confidence      = conf;
        autoDetected    = auto;
        bestHeaderIdx   = i;
        headers         = candidate;
        bestDataRows    = dataRows;
        if (conf >= 100) break; // exact match — stop scanning
      }
    }
  }

  // ── Step 3: All tiers failed across all candidate rows ──
  if (!detectedProfile) {
    return {
      positions: [],
      broker: 'Unknown',
      warnings: ['Could not auto-detect column layout. Please map the columns manually.'],
      autoDetected: false,
      confidence: 0,
      detectedColumns: null,
    };
  }

  if (bestHeaderIdx > 0) {
    warnings.push(`Skipped ${bestHeaderIdx} preamble row(s) before header on row ${bestHeaderIdx + 1}`);
  }
  if (detectedProfile.warnings) warnings.push(...detectedProfile.warnings);

  const map = detectedProfile.columnMap;
  const positions = [];
  let skipped = 0;

  for (const row of bestDataRows) {
    const rawSymbol = map.symbol ? (row[map.symbol] || '').trim() : '';
    if (!rawSymbol || rawSymbol === '--' || rawSymbol === 'N/A') {
      skipped++;
      continue;
    }

    const symbol = rawSymbol.toUpperCase();
    const quantity = parseNum(map.quantity ? row[map.quantity] : null);

    if (quantity === null || quantity === 0) {
      skipped++;
      continue;
    }

    const costBasis    = map.costBasis    ? parseNum(row[map.costBasis])            : null;
    const description  = map.description  ? (row[map.description]  || '').trim()   : '';
    const account      = map.account      ? (row[map.account]      || '').trim()   : '';

    // ── Option field extraction ───────────────────────────────────────
    // Tier A: parse option metadata from the symbol string itself
    const optData = parseOptionSymbol(rawSymbol);
    const cls = optData ? 'option' : classify(symbol);

    // Helper: read an optional column if it exists in the profile's columnMap
    const col = (key) => map[key] ? (row[map[key]] || '').trim() || null : null;

    // Tier B: fall back to separate option columns (e.g. IBKR position CSV)
    const underlying         = optData?.underlying  ?? col('underlying');
    const optionType         = optData?.optionType  ?? _parseOptType(col('optionType'));
    const strike             = optData?.strike      ?? parseNum(col('strike'));
    const contractMultiplier = optData?.contractMultiplier ?? parseNum(col('contractMultiplier')) ?? 100;

    let expiry = optData?.expiry ?? col('expiry');
    // Normalise various date formats to YYYY-MM-DD
    if (expiry && !/^\d{4}-\d{2}-\d{2}$/.test(expiry)) {
      const d = new Date(expiry);
      if (!isNaN(d.getTime())) expiry = d.toISOString().slice(0, 10);
      else expiry = null;
    }

    const daysToExpiry = expiry
      ? Math.ceil((new Date(expiry) - new Date()) / 864e5)
      : null;

    const isOption = !!(optData || (underlying && optionType !== null && strike !== null));

    positions.push({
      symbol,
      quantity,
      costBasis,
      description,
      account,
      classification: cls,
      isUsSitus: isUsSitus(symbol, cls, underlying),
      isOption,
      underlying:          underlying          ?? null,
      optionType:          optionType          ?? null,
      strike:              strike              ?? null,
      expiry:              expiry              ?? null,
      contractMultiplier,
      daysToExpiry,
      inTheMoney:    null,
      underlyingPrice: null,
    });
  }

  if (skipped > 0) {
    warnings.push(`${skipped} row(s) skipped (missing symbol or zero quantity)`);
  }

  if (positions.length === 0) {
    warnings.push('No valid positions found after parsing');
  }

  return {
    positions,
    broker: detectedProfile.name,
    warnings,
    autoDetected,
    confidence,
    detectedColumns: detectedProfile.columnMap,
  };
}

export { detectBroker, fuzzyDetectColumns, sniffColumnTypes, BROKER_PROFILES, parseOptionSymbol as _parseOptionSymbol };
