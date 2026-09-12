import React, { useState, useCallback, useMemo, useEffect } from 'react';
import {
  Upload, FileText, AlertTriangle, CheckCircle, X, RefreshCw,
  TrendingUp, TrendingDown, DollarSign, PieChart, Globe, Shield, Info, Layers,
  GitBranch, ChevronRight, ChevronDown,
} from 'lucide-react';
import {
  PieChart as RPieChart, Pie, Cell, ResponsiveContainer, Tooltip,
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Legend,
} from 'recharts';
import { parseCsv, buildManualProfile } from '../engine/portfolioParser.js';
import { enrich, computeMetrics } from '../engine/portfolioMetrics.js';
import { detectStrategies } from '../engine/optionStrategies.js';
import { fetchQuotes, fetchQuotesGoogle } from '../engine/marketData.js';
import DataSourceBadge from './DataSourceBadge.jsx';

const ALLOC_COLORS = {
  equity: '#60a5fa',
  etf: '#a78bfa',
  bond: '#34d399',
  reit: '#fbbf24',
  cash: '#94a3b8',
  option: '#f97316',
  unknown: '#6b7280',
};

const fmtUsd = (v) =>
  v == null ? '—' : new Intl.NumberFormat('en-US', {
    style: 'currency', currency: 'USD', maximumFractionDigits: 0,
  }).format(v);

const fmtPct = (v, digits = 2) =>
  v == null ? '—' : `${(v * 100).toFixed(digits)}%`;

function formatRelative(iso) {
  if (!iso) return '';
  const ms = Date.now() - new Date(iso).getTime();
  if (ms < 60_000) return 'just now';
  const mins = Math.floor(ms / 60_000);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(iso).toLocaleDateString();
}

const STORAGE_KEY = 'portfolio:v1';

function loadStored() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const obj = JSON.parse(raw);
    if (!obj || typeof obj.csvText !== 'string' || !obj.csvText.trim()) return null;
    return obj; // { csvText, uploadedAt, manualProfile? }
  } catch { return null; }
}
function saveStored(data) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(data)); } catch {}
}
function clearStored() {
  try { localStorage.removeItem(STORAGE_KEY); } catch {}
}

export default function PortfolioTab() {
  const [parseResult, setParseResult] = useState(null);
  const [enrichedPositions, setEnrichedPositions] = useState(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [error, setError] = useState(null);
  const [needsMapping, setNeedsMapping] = useState(null); // { headers, rawText, initialMap }
  const [manualMap, setManualMap] = useState({ symbol: '', quantity: '', costBasis: '' });  
  const [columnsExpanded, setColumnsExpanded] = useState(false);
  const [uploadedAt, setUploadedAt] = useState(null); // ISO string — when CSV was first stored

  const metrics = useMemo(
    () => (enrichedPositions ? computeMetrics(enrichedPositions) : null),
    [enrichedPositions]
  );

  const enrichWithLivePrices = useCallback(async (positions) => {
    // Fetch quotes for non-cash equities/ETFs (not option contracts themselves)
    const equitySymbols = [...new Set(
      positions
        .filter(p => p.classification !== 'cash' && p.classification !== 'option')
        .map(p => p.symbol)
    )];
    // Also fetch underlying prices for ITM/OTM computation
    const underlyingSymbols = [...new Set(
      positions
        .filter(p => p.isOption && p.underlying)
        .map(p => p.underlying)
        .filter(u => !equitySymbols.includes(u))
    )];

    const allToFetch = [...equitySymbols, ...underlyingSymbols];
    const fetchedAt = new Date().toISOString();

    // ── Primary: Yahoo Finance ──────────────────────────────────
    const yahooMap = allToFetch.length > 0 ? await fetchQuotes(allToFetch) : new Map();

    // ── Fallback: Google Finance for any symbols Yahoo missed ──
    const missedSymbols = allToFetch.filter(sym => !yahooMap.has(sym));
    const googleMap = missedSymbols.length > 0 ? await fetchQuotesGoogle(missedSymbols) : new Map();

    const quotesObj = {};
    for (const [sym, q] of yahooMap.entries()) {
      quotesObj[sym] = {
        price: q.regularMarketPrice ?? q.price ?? null,
        previousClose: q.regularMarketPreviousClose ?? null,
        dividendYield: q.trailingAnnualDividendYield ?? q.dividendYield ?? null,
        quoteType: q.quoteType ?? null,
        fetchedAt,
        source: 'Yahoo Finance',
      };
    }
    for (const [sym, q] of googleMap.entries()) {
      if (!quotesObj[sym]) {
        quotesObj[sym] = {
          price: q.regularMarketPrice ?? q.price ?? null,
          previousClose: q.regularMarketPreviousClose ?? null,
          dividendYield: q.trailingAnnualDividendYield ?? q.dividendYield ?? null,
          quoteType: q.quoteType ?? null,
          fetchedAt,
          source: 'Google Finance',
        };
      }
    }

    // Cash positions: $1 per unit
    for (const p of positions) {
      if (p.classification === 'cash' && !quotesObj[p.symbol]) {
        quotesObj[p.symbol] = {
          price: 1, previousClose: 1, dividendYield: null,
          quoteType: 'CASH', fetchedAt, source: 'User-supplied (cash)',
        };
      }
    }

    const enriched = enrich(positions, quotesObj);

    // Post-enrich: compute ITM/OTM for options using underlying live price
    return enriched.map(pos => {
      if (!pos.isOption || !pos.underlying || pos.strike == null) return pos;
      const ulq = quotesObj[pos.underlying];
      const underlyingPrice = ulq?.price ?? null;
      if (underlyingPrice == null) return pos;
      const inTheMoney = pos.optionType === 'call'
        ? underlyingPrice > pos.strike
        : underlyingPrice < pos.strike;
      return { ...pos, underlyingPrice, inTheMoney };
    });
  }, []);

  const processCsvText = useCallback(async (csvText, profile = null) => {
    setError(null);
    setIsProcessing(true);
    try {
      const result = parseCsv(csvText, profile);

      // Only fall back to manual mapping when ALL tiers failed (Tier 4)
      if (result.positions.length === 0 && result.confidence === 0 && result.broker === 'Unknown') {
        const headers = csvText
          .split('\n')[0]
          ?.split(',')
          .map(h => h.trim().replace(/^["']|["']$/g, '')) || [];
        // Pre-populate with any partial detection result
        const initialMap = result.detectedColumns
          ? { symbol: result.detectedColumns.symbol || '', quantity: result.detectedColumns.quantity || '', costBasis: result.detectedColumns.costBasis || '' }
          : { symbol: '', quantity: '', costBasis: '' };
        setManualMap(initialMap);
        setNeedsMapping({ headers, rawText: csvText, initialMap });
        setIsProcessing(false);
        return;
      }

      if (result.positions.length === 0) {
        setError(result.warnings.join(' · ') || 'No valid positions found in file.');
        setIsProcessing(false);
        return;
      }

      setParseResult(result);
      const enriched = await enrichWithLivePrices(result.positions);
      setEnrichedPositions(enriched);

      // Persist raw CSV + manual profile so the portfolio survives reloads
      const stored = loadStored();
      const uploadedAtIso = stored?.uploadedAt && stored?.csvText === csvText
        ? stored.uploadedAt
        : new Date().toISOString();
      saveStored({ csvText, uploadedAt: uploadedAtIso, manualProfile: profile || null });
      setUploadedAt(uploadedAtIso);
    } catch (e) {
      setError(`Processing error: ${e.message}`);
    } finally {
      setIsProcessing(false);
    }
  }, [enrichWithLivePrices]);

  // ── Auto-restore: on mount, replay any stored CSV through the parser/enricher ──
  useEffect(() => {
    const stored = loadStored();
    if (!stored) return;
    setUploadedAt(stored.uploadedAt || null);
    processCsvText(stored.csvText, stored.manualProfile || null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleFile = useCallback((file) => {
    if (!file) return;
    if (!/\.(csv|txt)$/i.test(file.name)) {
      setError('Please upload a .csv file. (XLSX support is out of scope for v1.)');
      return;
    }
    const reader = new FileReader();
    reader.onload = (e) => processCsvText(String(e.target.result));
    reader.onerror = () => setError('Could not read file.');
    reader.readAsText(file);
  }, [processCsvText]);

  const handleDrop = useCallback((e) => {
    e.preventDefault();
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      handleFile(e.dataTransfer.files[0]);
    }
  }, [handleFile]);

  const handleDragOver = useCallback((e) => { e.preventDefault(); }, []);

  const reset = () => {
    setParseResult(null);
    setEnrichedPositions(null);
    setError(null);
    setNeedsMapping(null);
    setManualMap({ symbol: '', quantity: '', costBasis: '' });
    setUploadedAt(null);
    clearStored();
  };

  const refreshPrices = useCallback(async () => {
    if (!parseResult) return;
    setIsProcessing(true);
    try {
      const enriched = await enrichWithLivePrices(parseResult.positions);
      setEnrichedPositions(enriched);
    } finally {
      setIsProcessing(false);
    }
  }, [parseResult, enrichWithLivePrices]);

  const submitManualMapping = () => {
    if (!manualMap.symbol || !manualMap.quantity) {
      setError('Symbol and Quantity columns are required.');
      return;
    }
    const prof = buildManualProfile({
      symbol: manualMap.symbol,
      quantity: manualMap.quantity,
      costBasis: manualMap.costBasis || undefined,
    });
    const text = needsMapping.rawText;
    setNeedsMapping(null);
    processCsvText(text, prof);
  };

  // ──────────────────────────────────────────────────────────
  // RENDER
  // ──────────────────────────────────────────────────────────
  return (
    <div className="space-y-6">
      {/* Disclaimer (Principle I) */}
      <div className="flex items-start gap-2 p-3 bg-yellow-500/10 border border-yellow-500/30 rounded-lg text-sm text-yellow-200">
        <Info size={16} className="mt-0.5 flex-shrink-0" aria-hidden="true" />
        <span>
          <strong>Educational use only.</strong> This tool analyses your uploaded
          portfolio for awareness — not as personalised financial, tax, or
          investment advice. Your file is parsed entirely in your browser; only
          ticker symbols are sent to the price data source.
        </span>
      </div>

      {/* Upload state */}
      {!parseResult && !needsMapping && (
        <UploadZone
          onDrop={handleDrop}
          onDragOver={handleDragOver}
          onFile={handleFile}
          isProcessing={isProcessing}
          error={error}
        />
      )}

      {/* Manual column mapping */}
      {needsMapping && (
        <ManualMappingDialog
          headers={needsMapping.headers}
          mapping={manualMap}
          onChange={setManualMap}
          onSubmit={submitManualMapping}
          onCancel={reset}
          error={error}
          hasPreFill={!!(needsMapping.initialMap?.symbol)}
        />
      )}

      {/* Loaded portfolio */}
      {parseResult && metrics && (
        <PortfolioReport
          parseResult={parseResult}
          metrics={metrics}
          onReset={reset}
          onRefresh={refreshPrices}
          isProcessing={isProcessing}
          uploadedAt={uploadedAt}
          columnsExpanded={columnsExpanded}
          onToggleColumns={() => setColumnsExpanded(v => !v)}
        />
      )}
    </div>
  );
}

// ──────────────────────────────────────────────────────────
// UploadZone
// ──────────────────────────────────────────────────────────
function UploadZone({ onDrop, onDragOver, onFile, isProcessing, error }) {
  const inputRef = React.useRef(null);

  return (
    <div className="space-y-3">
      <div
        onDrop={onDrop}
        onDragOver={onDragOver}
        className="relative border-2 border-dashed border-blue-400/40 hover:border-blue-400/70 bg-blue-500/5 rounded-xl p-12 text-center transition-colors"
        role="button"
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            inputRef.current?.click();
          }
        }}
        onClick={() => inputRef.current?.click()}
        aria-label="Upload portfolio CSV file"
      >
        <input
          ref={inputRef}
          type="file"
          accept=".csv,.txt,text/csv"
          className="hidden"
          onChange={(e) => onFile(e.target.files[0])}
        />
        {isProcessing ? (
          <div className="flex flex-col items-center gap-3 text-blue-300">
            <RefreshCw size={32} className="animate-spin" />
            <div>Parsing portfolio and fetching live prices…</div>
          </div>
        ) : (
          <>
            <Upload size={36} className="mx-auto text-blue-400 mb-3" aria-hidden="true" />
            <div className="text-lg font-medium text-blue-100">
              Drop a portfolio CSV here, or click to browse
            </div>
            <div className="text-sm text-blue-300/70 mt-2">
              Supported: Fidelity · Schwab · Vanguard · E*TRADE · IBKR · Robinhood · generic <code>symbol,quantity[,cost_basis]</code>
            </div>
          </>
        )}
      </div>

      {error && (
        <div className="flex items-start gap-2 p-3 bg-red-500/10 border border-red-500/30 rounded-lg text-sm text-red-200">
          <AlertTriangle size={16} className="mt-0.5 flex-shrink-0" />
          <span>{error}</span>
        </div>
      )}
    </div>
  );
}

// ──────────────────────────────────────────────────────────
// ManualMappingDialog
// ──────────────────────────────────────────────────────────
function ManualMappingDialog({ headers, mapping, onChange, onSubmit, onCancel, error, hasPreFill }) {
  const setField = (k, v) => onChange({ ...mapping, [k]: v });

  return (
    <div className="bg-gray-800/60 border border-gray-700 rounded-xl p-6 space-y-4">
      <div className="flex items-start gap-2">
        <FileText className="text-yellow-400 mt-0.5" size={20} />
        <div>
          <h3 className="text-lg font-medium text-gray-100">Map your columns</h3>
          <p className="text-sm text-gray-400">
            {hasPreFill
              ? 'We made a best guess at the column layout — please confirm or correct before proceeding.'
              : "We couldn't auto-detect your broker format. Please tell us which columns contain symbol, quantity, and (optionally) cost basis."}
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <Field label="Symbol column *" value={mapping.symbol} onChange={(v) => setField('symbol', v)} options={headers} />
        <Field label="Quantity column *" value={mapping.quantity} onChange={(v) => setField('quantity', v)} options={headers} />
        <Field label="Cost basis (optional)" value={mapping.costBasis} onChange={(v) => setField('costBasis', v)} options={headers} />
      </div>

      {error && (
        <div className="text-sm text-red-300">{error}</div>
      )}

      <div className="flex gap-2 justify-end pt-2">
        <button onClick={onCancel} className="px-4 py-2 text-sm bg-gray-700 hover:bg-gray-600 rounded-lg text-gray-200">Cancel</button>
        <button onClick={onSubmit} className="px-4 py-2 text-sm bg-blue-600 hover:bg-blue-500 rounded-lg text-white">Evaluate</button>
      </div>
    </div>
  );
}

function Field({ label, value, onChange, options }) {
  return (
    <label className="block">
      <div className="text-xs text-gray-400 mb-1">{label}</div>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full px-3 py-2 bg-gray-900 border border-gray-700 rounded-lg text-gray-100 text-sm"
      >
        <option value="">— select —</option>
        {options.map((h) => <option key={h} value={h}>{h}</option>)}
      </select>
    </label>
  );
}

// ──────────────────────────────────────────────────────────
// PortfolioReport
// ──────────────────────────────────────────────────────────
function PortfolioReport({ parseResult, metrics, onReset, onRefresh, isProcessing, uploadedAt, columnsExpanded, onToggleColumns }) {
  const allocData = Object.entries(metrics.allocation)
    .filter(([, pct]) => pct > 0.1)
    .map(([k, v]) => ({ name: k, value: v }));

  const sortedPositions = [...metrics.positions].sort(
    (a, b) => (b.currentValue ?? 0) - (a.currentValue ?? 0)
  );

  const strategyResult = useMemo(
    () => detectStrategies(metrics.positions),
    [metrics.positions]
  );

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <div className="flex items-center gap-2 flex-wrap">
            <CheckCircle size={18} className="text-green-400" />
            <span className="text-sm text-gray-300">
              Detected: <strong className="text-gray-100">{parseResult.broker}</strong>
              <span className="text-gray-500 ml-2">· {parseResult.positions.length} positions</span>
            </span>
            {parseResult.autoDetected && (
              <ConfidenceBadge
                confidence={parseResult.confidence}
                onClick={onToggleColumns}
                expanded={columnsExpanded}
              />
            )}
          </div>
          {parseResult.warnings.filter(w => !w.includes('skipped')).length > 0 && (
            <div className="text-xs text-yellow-400 mt-1">
              ⚠ {parseResult.warnings.filter(w => !w.includes('skipped')).join(' · ')}
            </div>
          )}
          {parseResult.autoDetected && columnsExpanded && (
            <DetectedColumnsPanel columns={parseResult.detectedColumns} className="mt-3" />
          )}
        </div>
        <div className="flex items-center gap-2">
          {uploadedAt && (
            <span className="text-xs text-gray-500" title={`Stored locally on ${new Date(uploadedAt).toLocaleString()}`}>
              Saved · {formatRelative(uploadedAt)}
            </span>
          )}
          {onRefresh && (
            <button
              onClick={onRefresh}
              disabled={isProcessing}
              className="flex items-center gap-1 px-3 py-1.5 text-sm bg-gray-700 hover:bg-gray-600 disabled:opacity-50 rounded-lg text-gray-200"
              title="Refetch live prices"
            >
              <RefreshCw size={14} className={isProcessing ? 'animate-spin' : ''} /> Refresh
            </button>
          )}
          <button
            onClick={onReset}
            className="flex items-center gap-1 px-3 py-1.5 text-sm bg-gray-700 hover:bg-gray-600 rounded-lg text-gray-200"
            title="Remove portfolio from local storage"
          >
            <X size={14} /> Clear
          </button>
        </div>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
        <SummaryCard
          icon={DollarSign}
          label="Total Value"
          value={fmtUsd(metrics.totalValue)}
          color="text-blue-300"
        />
        <SummaryCard
          icon={metrics.totalUnrealizedGain >= 0 ? TrendingUp : TrendingDown}
          label="Unrealised Gain"
          value={fmtUsd(metrics.totalUnrealizedGain)}
          color={metrics.totalUnrealizedGain >= 0 ? 'text-green-300' : 'text-red-300'}
        />
        <SummaryCard
          icon={metrics.totalDayChange >= 0 ? TrendingUp : TrendingDown}
          label="Day Change"
          value={fmtUsd(metrics.totalDayChange)}
          color={metrics.totalDayChange >= 0 ? 'text-green-300' : 'text-red-300'}
        />
        <SummaryCard
          icon={PieChart}
          label="Avg Dividend Yield"
          value={fmtPct(metrics.weightedDividendYield)}
          color="text-purple-300"
        />
      </div>

      {/* Allocation + Insights side by side */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card title="Allocation by Asset Class" icon={PieChart}>
          {allocData.length > 0 ? (
            <ResponsiveContainer width="100%" height={220}>
              <RPieChart>
                <Pie
                  data={allocData}
                  dataKey="value"
                  nameKey="name"
                  innerRadius={50}
                  outerRadius={85}
                  paddingAngle={2}
                >
                  {allocData.map((d) => (
                    <Cell key={d.name} fill={ALLOC_COLORS[d.name] || '#6b7280'} />
                  ))}
                </Pie>
                <Tooltip
                  formatter={(v) => `${v.toFixed(1)}%`}
                  contentStyle={{ background: '#111827', border: '1px solid #374151', borderRadius: 6, fontSize: 12 }}
                />
                <Legend />
              </RPieChart>
            </ResponsiveContainer>
          ) : (
            <div className="text-sm text-gray-500 py-6 text-center">No priced positions to allocate.</div>
          )}
        </Card>

        <Card title="Insights" icon={Shield}>
          <InsightsPanel metrics={metrics} />
        </Card>
      </div>

      {/* Strategy groups (only shown when multi-leg strategies are detected) */}
      {strategyResult.optionGroups > 0 && (
        <StrategyGroupsPanel result={strategyResult} />
      )}

      {/* Options summary (totals/by underlying) */}
      <OptionsSummaryPanel metrics={metrics} />

      {/* Holdings table */}
      <Card title={`Holdings (${sortedPositions.length})`} icon={FileText}>
        <HoldingsTable positions={sortedPositions} />
      </Card>

      {/* US-situs panel (de-emphasised — bottom) */}
      <Card title="US-Situs Estate Exposure (NRA)" icon={Globe}>
        <UsSitusPanel metrics={metrics} />
      </Card>
    </div>
  );
}

// ──────────────────────────────────────────────────────────
// StrategyGroupsPanel — groups positions into recognised strategies
// ──────────────────────────────────────────────────────────
const STRATEGY_COLOR = {
  // bullish = green-ish, bearish = red-ish, neutral = blue/purple
  bull_call_spread:    'border-green-500/40 bg-green-500/5',
  bull_put_spread:     'border-green-500/40 bg-green-500/5',
  bear_call_spread:    'border-red-500/40 bg-red-500/5',
  bear_put_spread:     'border-red-500/40 bg-red-500/5',
  long_straddle:       'border-purple-500/40 bg-purple-500/5',
  short_straddle:      'border-purple-500/40 bg-purple-500/5',
  long_strangle:       'border-purple-500/40 bg-purple-500/5',
  short_strangle:      'border-purple-500/40 bg-purple-500/5',
  long_call_butterfly: 'border-blue-500/40 bg-blue-500/5',
  short_call_butterfly:'border-blue-500/40 bg-blue-500/5',
  long_put_butterfly:  'border-blue-500/40 bg-blue-500/5',
  short_put_butterfly: 'border-blue-500/40 bg-blue-500/5',
  iron_condor:         'border-cyan-500/40 bg-cyan-500/5',
  iron_butterfly:      'border-cyan-500/40 bg-cyan-500/5',
  reverse_iron_condor: 'border-cyan-500/40 bg-cyan-500/5',
  reverse_iron_butterfly: 'border-cyan-500/40 bg-cyan-500/5',
  calendar_spread:     'border-teal-500/40 bg-teal-500/5',
  diagonal_spread:     'border-teal-500/40 bg-teal-500/5',
  covered_call:        'border-amber-500/40 bg-amber-500/5',
  collar:              'border-amber-500/40 bg-amber-500/5',
  multi_leg:           'border-gray-500/40 bg-gray-500/5',
};

function StrategyGroupsPanel({ result }) {
  // Show only multi-leg groups; singletons are listed in the holdings table.
  const multiLeg = result.groups.filter(g => g.legs.length >= 2);
  if (multiLeg.length === 0) return null;

  // Bucket strategies by category for visual grouping
  const buckets = {
    'Vertical Spreads':  multiLeg.filter(g => /spread/.test(g.type) && !/calendar|diagonal/.test(g.type)),
    'Volatility Plays':  multiLeg.filter(g => /straddle|strangle/.test(g.type)),
    'Butterflies / Condors': multiLeg.filter(g => /butterfly|condor/.test(g.type)),
    'Time Spreads':      multiLeg.filter(g => /calendar|diagonal/.test(g.type)),
    'Stock + Options':   multiLeg.filter(g => /covered_call|collar/.test(g.type)),
    'Other':             multiLeg.filter(g => g.type === 'multi_leg'),
  };

  return (
    <Card title={`Strategies — ${multiLeg.length} group${multiLeg.length !== 1 ? 's' : ''}`} icon={GitBranch}>
      <div className="space-y-4">
        {Object.entries(buckets).map(([bucketName, groups]) =>
          groups.length === 0 ? null : (
            <div key={bucketName}>
              <div className="text-xs uppercase tracking-wide text-gray-400 mb-2">
                {bucketName} <span className="text-gray-600">· {groups.length}</span>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                {groups.map(g => <StrategyCard key={g.id} group={g} />)}
              </div>
            </div>
          )
        )}
      </div>
    </Card>
  );
}

function StrategyCard({ group }) {
  const [expanded, setExpanded] = useState(false);
  const colorClass = STRATEGY_COLOR[group.type] || 'border-gray-600 bg-gray-700/20';
  const isCredit = group.netCost < 0;

  return (
    <div className={`border rounded-lg p-3 ${colorClass}`}>
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-start justify-between gap-2 text-left"
      >
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5">
            {expanded
              ? <ChevronDown size={14} className="text-gray-400 flex-shrink-0" />
              : <ChevronRight size={14} className="text-gray-400 flex-shrink-0" />}
            <span className="font-medium text-sm text-gray-100">{group.label}</span>
          </div>
          <div className="ml-5 mt-0.5 text-xs text-gray-400 flex items-center gap-2 flex-wrap">
            <span className="font-mono text-gray-300">{group.underlying}</span>
            {group.expiry && <span>· exp {group.expiry}</span>}
            <span>· {group.legs.length} legs</span>
            <span>· {group.contractCount} cts</span>
          </div>
        </div>
        <div className="text-right text-xs flex-shrink-0">
          <div className="text-gray-500">{isCredit ? 'Credit' : 'Debit'}</div>
          <div className={`font-mono font-semibold ${isCredit ? 'text-green-300' : 'text-gray-200'}`}>
            {fmtUsd(Math.abs(group.netCost))}
          </div>
        </div>
      </button>

      {expanded && (
        <div className="mt-3 ml-5 pl-3 border-l border-gray-600 space-y-1.5 text-xs">
          {group.legs.map((leg, i) => (
            <div key={i} className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-1.5 flex-wrap min-w-0">
                <span className={`px-1.5 py-0.5 rounded font-semibold text-xs ${
                  leg.quantity > 0 ? 'bg-green-500/20 text-green-300' : 'bg-red-500/20 text-red-300'
                }`}>
                  {leg.quantity > 0 ? `+${leg.quantity}` : leg.quantity}
                </span>
                {leg.isOption ? (
                  <span className="font-mono text-gray-300">
                    {leg.underlying} {leg.expiry} ${leg.strike?.toFixed(0)}{leg.optionType === 'call' ? 'C' : 'P'}
                  </span>
                ) : (
                  <span className="font-mono text-gray-300">{leg.symbol} stock</span>
                )}
              </div>
              <span className="text-gray-500 font-mono">
                {leg.costBasis != null ? fmtUsd(leg.costBasis) : '—'}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function SummaryCard({ icon: Icon, label, value, color = 'text-gray-200' }) {
  return (
    <div className="bg-gray-800/60 border border-gray-700 rounded-lg p-4">
      <div className="flex items-center gap-2 text-gray-400 text-xs mb-1">
        <Icon size={14} />{label}
      </div>
      <div className={`text-2xl font-semibold ${color}`}>{value}</div>
    </div>
  );
}

function Card({ title, icon: Icon, children }) {
  return (
    <div className="bg-gray-800/60 border border-gray-700 rounded-xl p-5">
      <div className="flex items-center gap-2 text-gray-200 text-sm font-medium mb-3">
        {Icon && <Icon size={16} />}{title}
      </div>
      {children}
    </div>
  );
}

function InsightsPanel({ metrics }) {
  const { concentration, allocation } = metrics;
  const items = [];

  if (concentration.exceeds20pct.length > 0) {
    items.push({
      tone: 'warn',
      text: `Concentration risk: ${concentration.exceeds20pct.join(', ')} ${concentration.exceeds20pct.length === 1 ? 'is' : 'are'} > 20% of portfolio.`,
    });
  } else {
    items.push({ tone: 'ok', text: 'No single holding exceeds 20% of portfolio.' });
  }

  // Tax-location hints (Principle I framing — not advice)
  if (allocation.bond > 5) {
    items.push({
      tone: 'info',
      text: 'Bonds are typically more tax-efficient in tax-deferred accounts (IRA/401k). Consider this when locating holdings across accounts.',
    });
  }
  if (allocation.reit > 5) {
    items.push({
      tone: 'info',
      text: 'REIT distributions are often taxed as ordinary income; tax-deferred accounts can shelter this drag.',
    });
  }

  // Top 5
  return (
    <div className="space-y-3">
      <div>
        <div className="text-xs text-gray-400 mb-1.5">Top 5 holdings</div>
        <ResponsiveContainer width="100%" height={140}>
          <BarChart data={concentration.top5} layout="vertical" margin={{ left: 0, right: 16 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
            <XAxis type="number" tick={{ fill: '#9ca3af', fontSize: 11 }} unit="%" />
            <YAxis type="category" dataKey="symbol" tick={{ fill: '#d1d5db', fontSize: 11 }} width={60} />
            <Tooltip
              formatter={(v) => `${v.toFixed(1)}%`}
              contentStyle={{ background: '#111827', border: '1px solid #374151', borderRadius: 6, fontSize: 12 }}
            />
            <Bar dataKey="pct" fill="#60a5fa" />
          </BarChart>
        </ResponsiveContainer>
      </div>

      <ul className="space-y-1.5">
        {items.map((it, i) => (
          <li key={i} className="flex items-start gap-2 text-xs">
            {it.tone === 'warn' ? (
              <AlertTriangle size={13} className="text-yellow-400 mt-0.5 flex-shrink-0" />
            ) : it.tone === 'ok' ? (
              <CheckCircle size={13} className="text-green-400 mt-0.5 flex-shrink-0" />
            ) : (
              <Info size={13} className="text-blue-400 mt-0.5 flex-shrink-0" />
            )}
            <span className="text-gray-300">{it.text}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function UsSitusPanel({ metrics }) {
  const { usSitus } = metrics;
  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
      <div className="p-3 bg-blue-500/10 border border-blue-500/30 rounded-lg">
        <div className="text-xs text-blue-300/70">US-situs value</div>
        <div className="text-xl font-semibold text-blue-200">{fmtUsd(usSitus.usSitusValue)}</div>
        <div className="text-xs text-blue-400/70 mt-1">{usSitus.usSitusPct.toFixed(1)}% of total</div>
      </div>
      <div className="p-3 bg-purple-500/10 border border-purple-500/30 rounded-lg">
        <div className="text-xs text-purple-300/70">Non-US-situs value</div>
        <div className="text-xl font-semibold text-purple-200">{fmtUsd(usSitus.nonUsSitusValue)}</div>
        <div className="text-xs text-purple-400/70 mt-1">{(100 - usSitus.usSitusPct).toFixed(1)}% of total</div>
      </div>
      <div className={`p-3 border rounded-lg ${
        usSitus.nraEstateTaxExposure > 0
          ? 'bg-red-500/10 border-red-500/30'
          : 'bg-green-500/10 border-green-500/30'
      }`}>
        <div className="text-xs text-gray-300/70">NRA estate exposure (above $60K)</div>
        <div className={`text-xl font-semibold ${
          usSitus.nraEstateTaxExposure > 0 ? 'text-red-200' : 'text-green-200'
        }`}>
          {fmtUsd(usSitus.nraEstateTaxExposure)}
        </div>
        <div className="text-xs text-gray-400 mt-1">
          IRC §2104 · only if non-resident-alien at death
        </div>
      </div>
    </div>
  );
}

// ──────────────────────────────────────────────────────────
// OptionsSummaryPanel
// ──────────────────────────────────────────────────────────
function OptionsSummaryPanel({ metrics }) {
  const { optionSummary } = metrics;
  if (!optionSummary || optionSummary.totalContracts === 0) return null;

  const underlyings = Object.entries(optionSummary.byUnderlying);

  return (
    <Card title={`Options \u2014 ${optionSummary.totalContracts} contract${optionSummary.totalContracts !== 1 ? 's' : ''}`} icon={Layers}>
      <div className="space-y-3">
        <div className="flex gap-6 text-sm">
          <div>
            <span className="text-gray-400">Calls\u00a0</span>
            <span className="text-green-300 font-semibold">{optionSummary.callCount}</span>
          </div>
          <div>
            <span className="text-gray-400">Puts\u00a0</span>
            <span className="text-red-300 font-semibold">{optionSummary.putCount}</span>
          </div>
        </div>

        {underlyings.length > 0 && (
          <div>
            <div className="text-xs text-gray-400 mb-1.5">By underlying</div>
            <div className="flex flex-wrap gap-2">
              {underlyings.map(([ul, d]) => (
                <div key={ul} className="flex items-center gap-1.5 px-2 py-1 bg-gray-700/50 border border-gray-600 rounded text-xs">
                  <span className="font-mono text-gray-100">{ul}</span>
                  {d.calls > 0 && <span className="text-green-300">{d.calls}C</span>}
                  {d.puts > 0  && <span className="text-red-300">{d.puts}P</span>}
                  <span className="text-gray-500">{d.contracts} cts</span>
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="text-xs text-gray-500 flex items-center gap-1.5 pt-1">
          <Info size={11} />
          Live option premiums are not auto-fetched. Underlying prices are used for ITM/OTM only.
        </div>
      </div>
    </Card>
  );
}

// ──────────────────────────────────────────────────────────
// ConfidenceBadge
// ──────────────────────────────────────────────────────────
function ConfidenceBadge({ confidence, onClick, expanded }) {
  const { bg, text, label } =
    confidence >= 80 ? { bg: 'bg-green-500/15 border-green-500/30',  text: 'text-green-300',  label: 'Auto-detected' } :
    confidence >= 55 ? { bg: 'bg-yellow-500/15 border-yellow-500/30', text: 'text-yellow-300', label: 'Auto-detected (verify)' } :
                       { bg: 'bg-red-500/15 border-red-500/30',       text: 'text-red-300',    label: 'Low-confidence detection' };

  return (
    <button
      onClick={onClick}
      className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full border text-xs font-medium ${bg} ${text}`}
      title="Click to review detected column mappings"
      aria-expanded={expanded}
    >
      <Info size={11} />
      {label} — {confidence}% confidence
      <span className="opacity-60">{expanded ? '▲' : '▼'}</span>
    </button>
  );
}

// ──────────────────────────────────────────────────────────
// DetectedColumnsPanel
// ──────────────────────────────────────────────────────────
const FIELD_LABELS = {
  symbol: 'Symbol',
  quantity: 'Quantity',
  costBasis: 'Cost Basis',
  currentPrice: 'Current Price',
  currentValue: 'Market Value',
  description: 'Description',
  account: 'Account',
};

function DetectedColumnsPanel({ columns, className = '' }) {
  if (!columns) return null;
  const entries = Object.entries(columns).filter(([, v]) => v);

  return (
    <div className={`flex flex-wrap gap-2 ${className}`} role="status" aria-label="Auto-detected column mappings">
      {entries.map(([field, header]) => (
        <span key={field} className="inline-flex items-center gap-1 px-2 py-1 bg-gray-700/60 border border-gray-600 rounded text-xs">
          <span className="text-gray-400">{FIELD_LABELS[field] ?? field}</span>
          <span className="text-gray-500">→</span>
          <span className="text-gray-100 font-mono">{header}</span>
        </span>
      ))}
    </div>
  );
}

// ──────────────────────────────────────────────────────────
// HoldingsTable
// ──────────────────────────────────────────────────────────
function HoldingsTable({ positions }) {
  const hasOptions = positions.some(p => p.isOption);

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-gray-400 text-xs border-b border-gray-700">
            <th className="text-left py-2 pr-3">Symbol</th>
            {hasOptions && <th className="text-left pr-3">Underlying</th>}
            <th className="text-left pr-3">Type</th>
            {hasOptions && <th className="text-right pr-3">Strike</th>}
            {hasOptions && <th className="text-right pr-3">Expiry (DTE)</th>}
            <th className="text-right pr-3">Qty</th>
            <th className="text-right pr-3">Price</th>
            <th className="text-right pr-3">Value</th>
            <th className="text-right pr-3">Gain</th>
            <th className="text-right pr-3">Alloc</th>
            <th className="text-left">Source</th>
          </tr>
        </thead>
        <tbody>
          {positions.map((p) => (
            <tr key={p.symbol + (p.account || '')} className="border-b border-gray-800/60 hover:bg-gray-800/40">

              {/* Symbol + ITM/OTM badge */}
              <td className="py-2 pr-3 font-mono text-xs text-gray-100">
                <span className="flex items-center gap-1.5 flex-wrap">
                  <span>{p.symbol}</span>
                  {p.isOption && p.inTheMoney !== null && (
                    <span className={`text-xs px-1 py-0.5 rounded font-medium ${
                      p.inTheMoney ? 'bg-green-500/20 text-green-300' : 'bg-gray-600/40 text-gray-400'
                    }`}>
                      {p.inTheMoney ? 'ITM' : 'OTM'}
                    </span>
                  )}
                  {!p.priceAvailable && !p.isOption && (
                    <span className="text-yellow-400 text-xs">price N/A</span>
                  )}
                </span>
              </td>

              {/* Underlying (options only) */}
              {hasOptions && (
                <td className="pr-3 font-mono text-gray-300 text-xs">
                  {p.isOption ? (p.underlying || '\u2014') : ''}
                </td>
              )}

              {/* Classification / call-put badge */}
              <td className="pr-3 text-xs">
                {p.isOption ? (
                  <span className={`inline-flex items-center px-1.5 py-0.5 rounded font-semibold ${
                    p.optionType === 'call' ? 'bg-green-500/20 text-green-300' : 'bg-red-500/20 text-red-300'
                  }`}>
                    {p.optionType ? p.optionType.toUpperCase() : '?'}
                  </span>
                ) : (
                  <span className="text-gray-400 capitalize">
                    {p.classification}
                    {!p.isUsSitus && p.classification !== 'cash' && (
                      <span className="ml-1 text-purple-400">non-US</span>
                    )}
                  </span>
                )}
              </td>

              {/* Strike (options only) */}
              {hasOptions && (
                <td className="pr-3 text-right font-mono text-gray-300 text-xs">
                  {p.isOption && p.strike != null ? `$${p.strike.toFixed(2)}` : ''}
                </td>
              )}

              {/* Expiry + DTE (options only) */}
              {hasOptions && (
                <td className="pr-3 text-right text-xs">
                  {p.isOption && p.expiry ? (
                    <span className={`${
                      p.daysToExpiry != null && p.daysToExpiry <=  7 ? 'text-red-300' :
                      p.daysToExpiry != null && p.daysToExpiry <= 30 ? 'text-yellow-300' :
                      'text-gray-300'
                    }`}>
                      {p.expiry}
                      {p.daysToExpiry != null && (
                        <span className="ml-1 text-gray-500">({p.daysToExpiry}d)</span>
                      )}
                    </span>
                  ) : ''}
                </td>
              )}

              {/* Quantity */}
              <td className="pr-3 text-right text-gray-300 font-mono text-xs">
                {p.quantity.toLocaleString(undefined, { maximumFractionDigits: 4 })}
                {p.isOption && <span className="text-gray-500 ml-0.5">cts</span>}
              </td>

              {/* Price */}
              <td className="pr-3 text-right text-gray-300 font-mono text-xs">
                {p.isOption
                  ? (p.underlyingPrice != null ? `$${p.underlyingPrice.toFixed(2)} ul` : '\u2014')
                  : (p.currentPrice == null ? '\u2014' : `$${p.currentPrice.toFixed(2)}`)
                }
              </td>

              {/* Value */}
              <td className="pr-3 text-right text-gray-100 font-mono text-xs">
                {p.isOption && p.currentValue == null && p.costBasis != null
                  ? <span className="text-gray-400">{fmtUsd(p.costBasis)}<span className="text-gray-600 ml-0.5">cost</span></span>
                  : fmtUsd(p.currentValue)
                }
              </td>

              {/* Unrealized gain */}
              <td className={`pr-3 text-right font-mono text-xs ${
                p.unrealizedGain == null ? 'text-gray-500' :
                p.unrealizedGain >= 0 ? 'text-green-300' : 'text-red-300'
              }`}>
                {fmtUsd(p.unrealizedGain)}
              </td>

              {/* Allocation % */}
              <td className="pr-3 text-right text-gray-400 font-mono text-xs">
                {p.allocationPct.toFixed(1)}%
              </td>

              {/* Source badge */}
              <td>
                {p.priceAvailable && (
                  <DataSourceBadge source={p.source} fetchedAt={p.fetchedAt} />
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
