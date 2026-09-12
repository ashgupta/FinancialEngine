# Implementation Plan: Portfolio Upload & Evaluation

**Branch**: `005-portfolio-upload` | **Date**: 2026-05-09 | **Spec**: [spec.md](./spec.md)

## Summary

New `PortfolioTab` component in `src/components/`. Client-side CSV parsing via
`papaparse`. Pure engine modules `src/engine/portfolioParser.js` and
`src/engine/portfolioMetrics.js`. Minimal Vitest bundled so tests land
alongside code (satisfies Principle V; supersedes hard dep on spec 003). A
`src/engine/brokerProfiles.js` registry enumerates broker formats.

## Technical Context

- **Runtime**: Browser. Server only consulted via existing `/yf/quote/:symbol`
  for price enrichment. Zero holdings data egress.
- **Dependencies added**: `papaparse` (~45KB), `vitest` + `@vitest/coverage-v8`
  (dev only; bundled here since spec 003 hasn't shipped).
- **No new top-level UI library.** Reuses React, Tailwind, Recharts,
  lucide-react.
- **Target platforms**: All evergreen browsers supported by Vite 7.

## Constitution Check (v1.2.0)

| Principle | Status | Notes |
|---|---|---|
| I. Educational, Not Advice | ✅ | Disclaimer banner on tab; framing "hint" not "recommendation" |
| II. Pure Engine Layer | ✅ | Parser + metrics in `src/engine/`; UI consumes pure outputs |
| III. Schema-Validated Boundaries | ✅ | PapaParse output schema-validated before entering engine |
| IV. Source-Cited Logic | ✅ | US-situs classification cites IRC §2104 adjacent; NRA exemption cites existing InternationalInvestorCalc citations |
| V. Test-First (NON-NEG) | ✅ | Vitest bundled in this spec; engine tests authored before/with implementation |
| VI. UI Discipline & Accessibility | ✅ | Drag-drop accessible (keyboard click-upload fallback), charts labeled |
| VII. Drawdown Guard (NON-NEG) | ✅ | Inline `DrawdownWarning` component; marked with TODO to migrate to shared once spec 004 lands |
| VIII. Data Integrity (NON-NEG) | ✅ | Price cells show `fetchedAt` + source via inline `DataSourceBadge`; user-provided cost basis clearly labeled; unknown symbols flagged, never fabricated |

**Gate status**: PASS.

## Files

```text
src/engine/
├── portfolioParser.js           NEW — pure: CSV → normalized Positions
├── portfolioMetrics.js          NEW — pure: Positions → PortfolioMetrics
└── brokerProfiles.js            NEW — broker column-header registry

src/components/
├── PortfolioTab.jsx             NEW — main tab UI
└── DataSourceBadge.jsx          NEW — inline provenance badge (TODO: migrate to shared spec)

src/App.jsx                       UPDATED — register 'portfolio' tab

tests/
└── engine/
    ├── portfolioParser.test.js  NEW
    └── portfolioMetrics.test.js NEW

vitest.config.js                 NEW (bundles spec 003 scope)
package.json                     UPDATED — add papaparse + vitest devDeps + test scripts
.gitignore                        UPDATED — add coverage/
```

## Contracts (engine)

See `contracts/engine.md`. Summary:

- `detectBroker(headers: string[]) → BrokerProfile | null`
- `parseCsv(csvText: string, profile?: BrokerProfile) → { positions: Position[], broker: string, warnings: string[] }`
- `classify(symbol: string, quoteType?: string) → 'equity' | 'etf' | 'bond' | 'reit' | 'cash' | 'unknown'`
- `isUsSitus(symbol: string, classification: string) → boolean`
- `enrich(positions: Position[], quotes: Record<Symbol, Quote>) → EnrichedPosition[]`
- `computeMetrics(enriched: EnrichedPosition[]) → PortfolioMetrics`

## Implementation tasks (executed in this pass)

1. Add deps + vitest config + test scripts
2. `brokerProfiles.js` (Fidelity, Schwab, Vanguard, E*TRADE, IBKR, Robinhood, generic)
3. `portfolioParser.js` + test (detectBroker, parseCsv, classify, isUsSitus)
4. `portfolioMetrics.js` + test (enrich, computeMetrics)
5. `DataSourceBadge.jsx`
6. `PortfolioTab.jsx` (upload zone, table, summary, insights, US-situs panel)
7. Register in `App.jsx`
8. Run tests; verify SC

## Post-design Constitution Re-check

PASS. TODOs recorded for migrating DrawdownWarning and DataSourceBadge to
shared implementations when specs 004 and the future provenance spec land.
