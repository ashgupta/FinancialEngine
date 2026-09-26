<!--
SYNC IMPACT REPORT
==================
Version change: 1.11.0 → 1.12.0
Ratification: 2026-05-09 (original); amended 2026-05-09 (v1.1.0); amended 2026-05-09 (v1.2.0); amended 2026-07-04 (v1.3.0); amended 2026-07-04 (v1.4.0); amended 2026-07-04 (v1.4.1); amended 2026-07-04 (v1.5.0); amended 2026-07-11 (v1.6.0); amended 2026-07-11 (v1.7.0); amended 2026-07-11 (v1.8.0); amended 2026-07-11 (v1.9.0); amended 2026-07-11 (v1.10.0); amended 2026-07-12 (v1.11.0); amended 2026-09-26 (v1.12.0)
Bump rationale: MINOR — extends Principle XIV with (1) cash-flow-specific
gates for options recommendations (credit spreads must be OTM; the 3×
RoC floor applies to debit structures only), (2) a quote-quality gate
rejecting phantom spreads priced off wide/stale quotes, (3) a Crash
Radar regime overlay on Options Opportunities, (4) a Crash Thesis
(Cem Karsan) engine + tab, and (5) the CBOE VIX index curve as the
term-structure source.

Change since 1.11.0:
  Principles modified:
    XIV. Risk & Opportunity Intelligence — new sub-sections: cash-flow
    gates, quote-quality gate, crash-regime overlay, Crash Thesis, VIX
    term structure source
  Files added:
    ⚠ src/engine/crashThesis.js               — pure engine (phase,
       scorecard, IV term structure, 4 structures, scenario P&L,
       portfolio impact, V-bottom plan, debasement panel)
    ⚠ src/components/CrashThesisTab.jsx       — new tab
    ⚠ tests/engine/crashThesis.test.js        — 37 tests
    ⚠ tests/engine/optionsOpportunitiesFixes.test.js — 18 tests
    ⚠ tests/engine/vixCurve.test.js           — 10 tests
  Files modified:
    ⚠ src/engine/spreadAnalyzer.js            — requireOtmShort,
       requireTwoSidedQuotes, maxLegSpreadToWidth, naturalNetCost
    ⚠ src/engine/optionsOpportunities.js      — credit gates, quote
       gate, PMCC quote check, regime overlay
    ⚠ src/engine/volatilityEngine.js          — computeVixIndexCurve
    ⚠ src/engine/crashIndicator.js            — VIX3M fallback
    ⚠ src/engine/briefingContext.js           — term-structure text
       fix ([object Object]); Crash Thesis context section
    ⚠ server.js                               — ^VIX9D/^VIX3M/^VIX6M;
       shared getCrashScan(); regime → /options/opportunities;
       GET /thesis/karsan
    ⚠ tests/engine/optionsOpportunitiesRoc.test.js — RoC assertion
       updated for the deliberate credit-spread spec change
    ⚠ SpreadFinderTab / OptionsOpportunitiesTab / VolatilityTab /
       AIChatTab / App.jsx / vite.config.js     — UI + proxy wiring
  Deferred TODOs resolved:
    - TODO(OPTIONS-MULTI-EXPIRY-CHAIN) — server already fetches one
      chain per band (resolved before v1.12.0; noted here)
  Deferred TODOs added:
    - TODO(COT-NORMALIZATION): crash COT factor saturates at ±50k
      contracts of weekly change; a single week can contribute the
      majority of a calm-market score — normalize by open interest
    - TODO(IBKR-AUTH): /ibkr/account/* endpoints are unauthenticated and
      CORS allows any origin; restrict before exposing beyond localhost
    - TODO(BUNDLE-SPLIT): 1.1 MB JS bundle — lazy-load heavy tabs
    - TODO(SOCIAL-WATCHLIST-TEST): DEFAULT_SOCIAL_WATCHLIST has 8
      entries but its test expects > 10 (pre-existing failure)

----- previous rationale (v1.11.0) -----
MINOR — extends Principle XIV (Risk & Opportunity
Intelligence) with a LEAPS Stock-Replacement Analyzer: a pure engine
that decomposes a deep-ITM LEAPS premium into intrinsic, interest
carry, dividend drag, and volatility premium, back-solves implied
vol, and compares LEAPS vs. shares. Ships with 28 Vitest tests, a
dedicated tab, and a Dashboard widget.

Change since 1.10.0:
  Principles modified:
    XIV. Risk & Opportunity Intelligence — extended with the LEAPS
    Stock-Replacement Analyzer requirement (pure engine + tests +
    tab + Dashboard widget)
  Sections modified:
    - Sync Impact Report — updated with v1.11.0 changes
  Files added:
    ⚠ src/engine/leapsAnalyzer.js              — pure engine: BS-Merton
       call price/delta, implied-vol solver, premium decomposition
       (intrinsic/carry/dividend/vol), LEAPS-vs-shares comparison,
       target-delta strike picker
    ⚠ tests/engine/leapsAnalyzer.test.js       — 28 unit tests
       (round-trip IV, decomposition identity, capital efficiency,
       boundary + invalid-input cases)
    ⚠ src/components/LeapsAnalyzerTab.jsx       — new tab: live chain
       fetch, target-delta strike selection, premium-decomposition
       chart, volatility term-structure panel (near-term vs LEAPS IV),
       LEAPS-vs-shares table, WeeklyTrendView, SectionTimestamp,
       educational disclaimer
    ⚠ src/App.jsx                              — new LEAPS tab +
       Dashboard LEAPS widget (default SPY 0.80-delta analysis)

----- previous rationale (v1.10.0) -----
MINOR — introduces Principle XV (Dell 401(k) Plan
Tracking) requiring a dedicated Dell 401k tab with fund menu,
current holdings, weekly price-change tracking via underlying ETFs,
and a WeeklyTrendView per Principle XII.

Change since 1.9.0:
  Principles added:
    XV. Dell 401(k) Plan Tracking (NON-NEGOTIABLE) — requires a
    dedicated Dell 401k tab showing the plan fund menu, current
    holdings with balances, and weekly price-change tracking of each
    held fund via its underlying ETF proxy
  Principles modified: none
  Sections modified:
    - Sync Impact Report — updated with v1.10.0 changes
    - Principle list — added XV
    - Merge gate — added clause (l)
  Sections added:
    - Principle XV full text

Change since 1.8.0:
  Principles added:
    XIV. Risk & Opportunity Intelligence (NON-NEGOTIABLE) — requires
    a composite multi-factor crash risk indicator with transparent
    factor breakdown, and an options opportunities engine scanning
    portfolio + watchlist + curated liquid names across three horizon
    bands with ranked recommendations and structured rationale
  Principles modified: none
  Sections modified:
    - Sync Impact Report — updated with v1.9.0 changes
    - Principle list — added XIV
    - Merge gate — added clause (k)
  Sections added:
    - Principle XIV full text

  Templates checked:
    ✅ .specify/templates/plan-template.md      — no structural change
    ✅ .specify/templates/spec-template.md      — no structural change
    ⚠ src/engine/crashIndicator.js             — new pure engine:
       composite 0-100 crash risk score from 7 weighted factors
       (VIX level, term structure, SPY vs 200-DMA, sector breadth,
       momentum, drawdown, COT positioning)
    ⚠ src/engine/optionsOpportunities.js       — new pure engine:
       scans universe, scores by momentum/volume/200-DMA, buckets
       into short/medium/LEAPS bands, selects strategies per band,
       produces top 5 ranked recommendations with structured rationale
    ⚠ tests/engine/crashIndicator.test.js      — 12 unit tests
    ⚠ tests/engine/optionsOpportunities.test.js — 20 unit tests
    ⚠ server.js                                — new endpoints:
       GET /crash/scan (24h cache, ?refresh=1 bypass)
       POST /options/opportunities (24h cache, ?refresh=1 bypass)
    ⚠ src/contexts/PortfolioContext.jsx        — new context provider
       reading localStorage['portfolio:v1'], exposing holdings,
       underlyings, heldSet
    ⚠ src/components/CrashGauge.jsx            — shared radial gauge
       component (full + compact variants)
    ⚠ src/components/CrashRadarTab.jsx         — new tab with gauge,
       factor breakdown table, WeeklyTrendView, SectionTimestamp
    ⚠ src/components/OptionsOpportunitiesTab.jsx — new tab with 3
       band sections, 5 ranked cards each, rationale panels,
       drawdown flags, WeeklyTrendView, SectionTimestamp
    ⚠ src/App.jsx                              — new tabs (crash,
       opportunities), Dashboard CrashGauge widget, PortfolioProvider
    ⚠ src/engine/briefingContext.js            — crash scan added to
       parallel fetch and context sections
    ⚠ src/components/AIChatTab.jsx             — crash risk and
       options suggested questions added
    ⚠ src/components/VolatilityTab.jsx          — refresh() accepts
       forceRefresh; passes ?refresh=1; WeeklyTrendView added
    ⚠ src/components/MarketsTab.jsx             — WeeklyTrendView added
       for selected ETF symbol
    ⚠ src/components/COTTab.jsx                 — WeeklyTrendView added
       for ES=F (S&P 500 futures)
    ⚠ src/components/SocialPulseTab.jsx         — WeeklyTrendView added
       for SPY
    ⚠ src/components/ProjectionsTab.jsx         — WeeklyTrendView added
       for SPY
    ⚠ src/components/PortfolioMergedTab.jsx     — WeeklyTrendView added
       for SPY (portfolio benchmark)
    ⚠ src/components/RetirementTab.jsx          — WeeklyTrendView added
       for VTI (retirement portfolio)
    ⚠ src/components/BrokeragePlanTab.jsx       — WeeklyTrendView added
       for SPY (brokerage benchmark)
    ⚠ src/components/AIChatTab.jsx              — WeeklyTrendView added
       for SPY (market context)
    ⚠ src/engine/fundUniverse.js                — DELL_K401_FUNDS array
       added with Dell Technologies 401k plan menu (19 funds) and user's
       current balances ($574k total)
    ⚠ src/components/Dell401kTab.jsx            — new tab with fund menu,
       current holdings, pie chart, weekly price-change tracking via
       underlying ETFs, and WeeklyTrendView for SPY
    ⚠ src/App.jsx                                — new Dell 401k tab
       (positioned below Opportunities), Dell401kTab import + render

Principles previously added at v1.0.0–v1.6.0 (unchanged unless noted):
  I.   Educational, Not Financial Advice (NON-NEGOTIABLE)                 [v1.0.0]
  II.  Pure Engine Layer (NON-NEGOTIABLE)                                   [v1.0.0]
  III. Schema-Validated External Boundaries                                 [v1.0.0]
  IV.  Source-Cited Financial & Legal Logic                                 [v1.0.0]
  V.   Test-First for Financial Math (NON-NEGOTIABLE)                       [v1.0.0]
  VI.  UI Discipline & Accessibility                                        [v1.0.0]
  VII. Capital Preservation & Drawdown Guard (NON-NEGOTIABLE)               [v1.1.0]
  VIII. Data Integrity & Provenance (NON-NEGOTIABLE)                        [v1.2.0, modified v1.4.0, v1.5.0]
  IX.  AI-Assisted Analysis (NON-NEGOTIABLE)                                [v1.4.0, amended v1.4.1]
  X.   Data Source Resilience (NON-NEGOTIABLE)                              [v1.5.0]
  XI.  Daily Refresh & Section Timestamps (NON-NEGOTIABLE)                  [v1.6.0]
  XII. Auto-Refresh on Tab Switch & 12-Week Trend Views (NON-NEGOTIABLE)    [v1.7.0]
  XIII. Market Assistant Full-Data-Access (NON-NEGOTIABLE)                [v1.8.0]
  XIV. Risk & Opportunity Intelligence (NON-NEGOTIABLE)                   [v1.9.0]
  XV.  Dell 401(k) Plan Tracking (NON-NEGOTIABLE)                        [v1.10.0]

Deferred TODOs (new at v1.6.0):
  - TODO(TIMESTAMP-GRANULARITY): some computed sections (Tax, Projections, Retirement, Brokerage) use `new Date()` as fetchedAt since they derive from user inputs, not server fetches; consider tracking input-change timestamps instead for more meaningful staleness
  - TODO(TIMESTAMP-TESTS): add unit tests for SectionTimestamp staleness logic (fresh/recent/stale thresholds at 24h/48h boundaries)

Deferred TODOs (carried forward):
  - TODO(README): Add README.md linking to constitution and Spec-Kit workflow
  - TODO(VITEST): Configure Vitest + add first engine test before next /speckit.implement run
  - TODO(ZOD): Introduce Zod (or equivalent) and add schemas under src/schemas/ for fetchHistory/fetchQuotes responses
  - TODO(DRAWDOWN-UI): Implement a shared <DrawdownWarning /> component
  - TODO(DRAWDOWN-ENGINE): Add pure helper `maxDrawdown(series)` under src/engine/risk.js
  - TODO(BACKFILL-FLAGS): Audit existing wealth-projection views for >15% drawdown flags

Deferred TODOs (carried forward from v1.2.0):
  - TODO(PROVENANCE-API): Server responses MUST include { source, fetchedAt, symbol, range, interval } metadata on every history/quote payload
  - TODO(FRESHNESS-UI): Add a shared <DataSourceBadge /> component displaying source + timestamp + staleness color on every data-driven view
  - TODO(SOURCES-REGISTRY): Create `src/engine/sources.js` enumerating every allowed data source with its freshness SLA, authoritative URL, and license constraints
  - TODO(NO-SYNTHETIC): Audit codebase for any synthesized/mock market data in production paths (e.g., Math.random-based price generators) and remove or clearly quarantine under a `__fixtures__/` directory

Deferred TODOs (carried forward from v1.3.0):
  - TODO(COT-PROVENANCE): /cot/report and /cot/history payloads MUST include explicit `source: 'CFTC'` tag in response metadata (currently has fetchedAt + reportDate but no source string)
  - TODO(COT-SOURCES-REGISTRY): Add CFTC entry to `src/engine/sources.js` once created: { name: 'CFTC', url: 'https://www.cftc.gov/dea/futures/', freshness: 'weekly (Tue OI, Fri 3:30pm ET release)', license: 'public domain' }

Deferred TODOs (carried forward from v1.4.0):
  - TODO(AI-PROVENANCE): /ai/commentary response MUST include { provider: 'Groq', model, cached } metadata in payload (currently returns { commentary, cached } but no provider/model tag)
  - TODO(AI-SOURCES-REGISTRY): Add Groq entry to `src/engine/sources.js` once created: { name: 'Groq', url: 'https://api.groq.com/openai/v1/', model: 'auto-selected (monthly)', freshness: 'real-time (on-demand)', license: 'Groq ToS', type: 'AI inference' }
  - TODO(AI-LABEL-AUDIT): Verify all AI commentary cards across the app display the provider + model label per Principle IX (COT ✓, Momentum ✓, Market Assistant ✓)
  - TODO(AI-ERROR-GRACEFUL): Ensure all AI commentary UIs show a clear non-blocking error state when the AI provider is unavailable (COT ✓, Momentum ✓, Market Assistant ✓)

Deferred TODOs (new at v1.4.1):
  - TODO(AI-MODEL-STATE-PROVENANCE): /ai/model response SHOULD include `provider: 'Groq'` tag alongside model name (currently returns model + displayName but no explicit provider string)
  - TODO(AI-MODEL-SCORING-TUNABLE): modelSelector.js scoring weights are hardcoded; consider making them configurable via a JSON file for easier tuning without code changes

Deferred TODOs (new at v1.7.0):
  - TODO(TREND-VIEW-SERVER-CACHE): WeeklyTrendView fetches /yf/history with 3mo/1wk range directly; consider adding server-side caching for this specific range/interval combo to reduce Yahoo API calls
  - TODO(TREND-VIEW-MULTI-SYMBOL): some tabs could benefit from showing multiple trend views (e.g., Sector Rotation showing top 3 sectors); currently single-symbol per tab
  - TODO(AUTO-REFRESH-DEBOUNCE): tab switch triggers immediate fetch; consider a short debounce (200ms) to avoid unnecessary fetches during rapid tab switching

Deferred TODOs (new at v1.8.0):
  - TODO(ASSISTANT-CONTEXT-LIMIT): briefingContext.js fetches all 10 data sources in parallel; the combined context may exceed LLM token limits for large watchlists; consider truncating or prioritizing context sections based on user query
  - TODO(ASSISTANT-STREAMING): chatWithLLM currently waits for the full response before displaying; consider streaming responses via SSE for a better UX on long answers
  - TODO(ASSISTANT-CONVERSATION-MEMORY): messages are sent as-is to the LLM; consider summarizing older messages to stay within token limits on long conversations
  - TODO(ASSISTANT-OPTIONS-CONTEXT): options chain data is not yet included in briefingContext; add options data (strikes, IV, Greeks) for the selected symbol when available

Deferred TODOs (new at v1.9.0):
  - TODO(CRASH-MULTI-EXPIRY): /crash/scan currently fetches the nearest option expiry chain; for richer analysis, fetch multiple expiries per symbol and let the engine select the best per band
  - TODO(OPTIONS-MULTI-EXPIRY-CHAIN): /options/opportunities fetches only the nearest expiry chain per symbol; the engine needs chains for multiple expiries to fully populate all 3 bands — currently only the nearest expiry is used
  - TODO(CRASH-HISTORY): crash indicator currently shows a point-in-time score; consider storing 12-week history of scores for a trend view
  - TODO(OPTIONS-PORTFOLIO-AWARE): options recommendations do not yet consider existing portfolio positions for hedging (e.g., suggesting protective puts for held stocks)
-->

# Personal Finance Workbench Constitution

A React + Vite + Express application for personal financial planning, investment
strategy experimentation, market data visualization, and cross-border tax/
estate scenarios. The tool is explicitly intended for testing strategies across
**stock options, commodities, international markets (equities, ETFs, forex),
domestic equities, futures, and fixed income**, in addition to household
retirement and cash-flow planning. The principles below are binding on all
changes (human or AI-assisted) made under the Spec-Kit workflow.

## Core Principles

### I. Educational, Not Financial Advice (NON-NEGOTIABLE)

This project produces **educational projections and analysis only** — never personalized
financial, tax, legal, or investment advice.

- Every page or feature that surfaces tax, retirement, estate, withholding, or projection
  numbers MUST display a clear disclaimer (visible without scrolling away).
- Outputs MUST be deterministic given the same inputs and assumptions; "recommendations"
  MUST be framed as options/scenarios, not directives.
- Cross-border, expatriation, and estate-tax features MUST direct users to consult a
  licensed cross-border professional before acting.
- Rationale: the user base is primarily individuals making consequential decisions; legal
  and ethical exposure from misframed advice is unacceptable.

### II. Pure Engine Layer (NON-NEGOTIABLE)

All financial mathematics MUST live in `src/engine/` as **pure, deterministic functions**
with no side effects, no DOM access, no network I/O, and no React imports.

- Examples in scope: tax bracket calculation, FIRE math, Monte Carlo simulation, debt
  payoff schedules, correlation/pattern matching, withholding calculations, estate
  exposure formulas, moving averages.
- Engine functions MUST accept primitives or plain objects and return primitives or plain
  objects. They MUST NOT throw on valid input ranges; invalid input → typed error or
  documented sentinel.
- UI components (`src/components/`) and hooks (`src/hooks/`) consume the engine; the
  reverse direction is forbidden.
- Rationale: pure functions are testable, portable, and AI-refactorable without UI churn.

### III. Schema-Validated External Boundaries

All data crossing a process or network boundary MUST be validated against an explicit
schema before downstream use.

- Yahoo Finance responses (server-side via `yahoo-finance2`) MUST be normalized to a
  documented shape before being returned to the client.
- Client-side fetchers (`src/engine/marketData.js` and similar) MUST validate API
  responses; failure → typed error returned to the caller, never silent NaN/undefined
  propagation.
- User-facing form inputs MUST be range-checked at the boundary, not deep inside
  calculation code.
- Rationale: most real-world bugs in this app trace to upstream shape drift. Schema
  validation surfaces them once, at the boundary, with clear messages.

### IV. Source-Cited Financial & Legal Logic

Any code, comment, or UI text that encodes a tax bracket, treaty rule, withholding rate,
estate exemption, contribution limit, penalty, or jurisdictional threshold MUST cite:

- The **tax year or effective date** the value applies to.
- The **source** (IRS publication number, treaty article, country tax code section, etc.).
- The **filing status / residency status** it depends on, if any.

Citations live next to the constant or in the spec under `specs/<feature>/`. Hardcoding
a number without these three pieces is a constitution violation and MUST be rejected at
review.

- Rationale: tax & treaty values change yearly; without provenance, stale or wrong
  numbers silently mislead users.

### V. Test-First for Financial Math (NON-NEGOTIABLE)

Any new or modified function in `src/engine/` MUST be accompanied by a unit test in the
same PR/commit. Tests MUST be authored *before or alongside* the implementation, not
after.

- Test runner: Vitest (to be configured on first applicable feature; see deferred TODO).
- Test cases MUST cover at least: a representative happy-path, one boundary, and one
  invalid-input case per exported function.
- Tests MUST NOT be deleted or weakened to make a build pass; failing tests indicate a
  regression to fix or a deliberate spec change requiring an updated test.
- UI components are exempt from this rule but encouraged to have smoke tests.
- Rationale: the engine drives every dollar shown to a user. A silent off-by-one in a
  bracket or compounding loop is unacceptable.

### VI. UI Discipline & Accessibility

All user-facing UI MUST follow a consistent stack and minimum accessibility bar:

- Stack: **React function components**, **Tailwind CSS**, **Recharts** for charts,
  **lucide-react** for icons. No new UI libraries without an accepted spec.
- No inline styles except for dynamic values that cannot be expressed in Tailwind
  (e.g., percentage-based positioning of a marker).
- All charts MUST have: a visible title or section heading, axis labels or formatted
  ticks, an accessible tooltip, and a legend when ≥2 series are shown.
- Color MUST NOT be the sole carrier of meaning; pair color cues with text or icons
  (e.g., +/- signs, ↑/↓ icons).
- All interactive elements MUST be keyboard-reachable and have a visible focus state.
- Rationale: consistent UI lowers cognitive load and review time; accessibility is a
  baseline expectation, not a nice-to-have.

### VII. Capital Preservation & Drawdown Guard (NON-NEGOTIABLE)

Every feature that projects, simulates, or recommends changes to total
household wealth MUST bias toward capital preservation and MUST prominently
flag any scenario whose projected peak-to-trough drawdown exceeds 15% of
starting wealth.

- **Scope**: this principle applies to any view, chart, scenario, or
  recommendation that outputs a projected wealth trajectory, retirement
  probability, liquidation cost, tax/penalty haircut, or comparative cost
  outcome. It applies to Monte Carlo cones, FIRE projections, 401(k)
  liquidation / loan comparisons, estate-tax exposures, and historical
  pattern forward returns.
- **The 15% threshold is on *total household wealth, nominal, peak-to-trough,
  over the modeled horizon*** — not on a single asset class. Engines MUST
  expose a `maxDrawdown(series)` helper or equivalent so the threshold is
  computed consistently and testably.
- **Flagging requirements**: any scenario exceeding the threshold MUST
  surface (a) a clearly visible warning badge or banner, (b) the numeric
  drawdown percent and dollar amount, (c) a short plain-language
  explanation of what drives the drawdown, and (d) at least one lower-risk
  alternative scenario that the user can view with one interaction.
- **Default framing**: when a view supports multiple scenarios, the default
  view MUST be the one with the lowest modeled drawdown among reasonable
  options — never the highest-expected-return one that exceeds the
  threshold.
- **Recommendations**: any "strategy" or "comparison" surface that uses
  language like "lower cost", "lower risk", or "preferred" MUST penalize
  options that cross the threshold, even if they have higher expected
  return.
- **Interaction with Principle I**: this is NOT financial advice — it is
  a framing/safety guardrail on an educational tool. The UI MUST avoid
  language that implies certainty of downside protection; warnings are
  "this scenario has modeled a >15% drawdown", not "you will lose 15%".
- **Rationale**: the user population is making consequential long-horizon
  decisions (retirement, expatriation, loans against 401(k), liquidations).
  A tool that projects aggressive strategies without making drawdown risk
  unmissable is complicit in the loss. 15% is chosen because it is
  approximately one standard deviation of annual S&P 500 returns — a
  threshold below which decline is "normal market noise" and above which a
  decision is materially impacted.

### VIII. Data Integrity & Provenance (NON-NEGOTIABLE)

Every number the user sees that purports to represent real-world market,
economic, tax, or regulatory reality MUST be sourced from a known authoritative
provider, be traceable to that provider, be reasonably fresh, and MUST NOT be
fabricated, synthesized, or hallucinated.

- **Allowed sources (v1.5.0)**: Yahoo Finance (via `yahoo-finance2`) for
  equities, ETFs, indices, futures, options chains, and FX; **Interactive
  Brokers (IBKR) Client Portal Web API** for real-time quotes, historical
  bars, options chains, and account positions — connected via the IBKR
  Client Portal Gateway (running locally, paper or live trading); **U.S. CFTC
  (Commodity Futures Trading Commission) for Commitments of Traders (COT)
  reports** — weekly futures positioning data published at
  `https://www.cftc.gov/dea/futures/` (current) and
  `https://www.cftc.gov/sites/default/files/files/dea/cotarchives/` (historical);
  **Groq (api.groq.com) for AI-assisted commentary** — LLM inference for
  generating analysis from market data (model: `llama-3.3-70b-versatile`);
  official IRS publications and Internal Revenue Code for tax values (per
  Principle IV); official treaty text for cross-border rules. Additional
  sources (CBOE, FRED, EIA, IEX, polygon.io, tradingeconomics, etc.) MUST be
  added to a central `src/engine/sources.js` registry via a spec before use.
- **Provenance metadata**: every server endpoint returning market data MUST
  include in its payload `{ source, fetchedAt (ISO 8601 UTC), symbol, range,
  interval }`. Client consumers MUST propagate this metadata to the UI.
- **Visible freshness**: every data-driven view MUST display the source and
  fetchedAt timestamp (minimally via a shared `<DataSourceBadge />` or
  equivalent). Staleness MUST be color-coded (fresh / recent / stale) with
  thresholds documented per data type in the sources registry.
- **No synthesized market data in production paths**: `Math.random()`
  price generators, hand-rolled example candles, or placeholder tickers MUST
  NOT appear in any code path the user can reach. Such fixtures MAY live
  under `tests/fixtures/` or a clearly named `__demo__/` module, never in
  `src/components/` or `src/engine/` consumer paths.
- **No hallucinated numbers in AI-assisted outputs**: AI agents writing code
  or copy MUST NOT invent tax brackets, treaty rates, yields, prices,
  historical returns, or company identifiers. Every such value MUST be
  either (a) fetched at runtime from an allowed source with provenance, or
  (b) encoded as a cited constant per Principle IV.
- **Fail loudly, not silently**: when a data source is unavailable, rate-
  limited, or returns a schema-invalid payload, the UI MUST surface a clear
  error state. Fallback to cached data is allowed only when the cache age is
  within the documented freshness SLA and the UI flags "cached (N minutes
  old)"; fallback to synthesized numbers is forbidden.
- **Strategy backtests MUST use real historical data** from the sources
  registry. Synthetic-return simulations (Monte Carlo) are allowed for
  projection scenarios but MUST be labeled "simulated" and MUST NOT be
  presented alongside real-series charts without a clear visual distinction.
- **Rationale**: the tool exists specifically to help a user make or
  invalidate real investment decisions across options, commodities, and
  international markets. A single hallucinated quote or stale fill can
  cause a materially wrong decision. Provenance and freshness are
  non-negotiable preconditions for the tool to be useful at all.

### IX. AI-Assisted Analysis (NON-NEGOTIABLE)

Any AI/LLM-generated commentary, analysis, or narrative displayed in the
application MUST be clearly labeled as AI-generated, MUST be grounded in
real data fetched from allowed sources (Principle VIII), and MUST NOT
be presented as authoritative financial advice.

- **Labeling**: every UI surface that displays AI-generated text MUST
  include a visible label identifying the AI provider and model (e.g.,
  "Powered by Groq · Llama 3.3 70B"). The label MUST be visible without
  scrolling and MUST use a distinct visual treatment (icon, color, or
  border) that separates AI commentary from human-authored content and
  from raw data displays.
- **Grounding in real data**: AI commentary MUST be generated from actual
  market data fetched at runtime from allowed sources (Principle VIII).
  The server-side prompt MUST include the real data payload (prices,
  positions, momentum scores, etc.) — the LLM MUST NOT be asked to
  generate analysis from its training data alone. Prompts MUST instruct
  the model to reference the provided data, not to recall or fabricate
  numbers.
- **No AI-generated numbers presented as facts**: AI commentary MUST NOT
  introduce specific price targets, position sizes, return estimates, or
  any numeric value that is not present in the input data. If the AI
  references a number, it MUST be traceable to the data payload sent in
  the prompt. Hallucinated numbers violate Principle VIII and Principle I.
- **Server-side key management**: AI provider API keys MUST be stored
  server-side in environment variables (`.env`, gitignored) and NEVER
  exposed to the client. The client calls a server endpoint (e.g.,
  `/ai/commentary`) which adds the API key server-side. Exception: the
  Market Assistant chat tab MAY use a user-provided key stored in
  `localStorage`, since the user explicitly provides their own key and
  it never touches the server.
- **Graceful degradation**: if the AI provider is unavailable, rate-
  limited, or returns an error, the UI MUST show a clear non-blocking
  error state (e.g., "AI commentary unavailable"). The rest of the tab
  (data tables, charts, takeaways) MUST remain fully functional without
  the AI commentary. AI commentary is additive, never load-bearing.
- **Caching**: AI commentary MAY be cached server-side (5-minute TTL
  recommended) keyed by the input data hash or timestamp. Cached
  commentary MUST be flagged as cached in the response payload.
- **Prompt transparency**: the prompt structure (system instructions,
  data inputs, output format) MUST be documented in the server endpoint
  code. Prompts MUST NOT contain hidden instructions that could cause
  the model to produce misleading or biased output.
- **Interaction with Principle I**: AI commentary is educational analysis
  only — NOT financial advice. The AI MUST NOT use directive language
  ("you should buy", "sell now", "this is a good investment"). The
  footer disclaimer on each tab MUST cover AI-generated content.
- **Model auto-selection (v1.4.1)**: the server MUST auto-select the
  latest and most capable AI model available from the provider, rather
  than hardcoding a model ID. On startup and at least every 30 days
  thereafter, the server MUST query the provider's model list, score
  each candidate (version family, parameter count, chat-tuning bonus,
  speed-variant penalty), and select the highest-scoring chat model.
  The selection MUST be persisted to a gitignored state file so it
  survives restarts. A manual refresh endpoint MUST be provided for
  testing or when a new model is announced. The UI MUST display the
  live model name (fetched from the server, not hardcoded) and the
  last-checked date. If the provider API is unreachable, the server
  MUST fall back to the last known good model. Non-chat models (speech,
  safety classifiers, TTS) MUST be excluded from selection.
  Rationale: hardcoding a model ID means the app silently uses an
  outdated or decommissioned model. Auto-selection ensures the app
  always uses the best available model without manual intervention.
- **Contextual delta coloring (v1.4.1)**: when displaying weekly
  position changes (weekDelta) in the COT tab, the color MUST reflect
  the context of the net position, not just the sign of the delta:
  - Net long + delta up → green ("adding longs" — reinforcing bullish)
  - Net long + delta down → yellow ("unwinding longs" — counter-trend)
  - Net short + delta up → yellow ("covering shorts" — counter-trend)
  - Net short + delta down → red ("adding shorts" — reinforcing bearish)
  A small text label ("covering shorts", "adding longs", etc.) MUST
  appear under the delta value for clarity. Rationale: showing green
  for a positive delta on a net-short position misleads users into
  thinking the signal is bullish, when it actually means shorts are
  being covered (less bearish, but still bearish overall).
- **Rationale**: LLMs can produce fluent, confident-sounding analysis
  that may contain hallucinated numbers or biased conclusions. Without
  grounding, labeling, and graceful degradation, AI commentary becomes
  a source of misinformation rather than insight. The non-negotiable
  requirements ensure AI adds value (fast summarization, pattern
  recognition) without becoming a liability.

### X. Data Source Resilience (NON-NEGOTIABLE)

The application MUST remain functional even when a data provider is
unavailable, degraded, or rate-limited. No single data source is a
hard dependency for market data display.

- **Automatic fallback**: when the primary data provider (IBKR, when
  configured) fails or is unreachable, the server MUST automatically fall
  back to the secondary provider (Yahoo Finance) without user intervention.
  The `dataProvider.js` module implements this via `selectProvider()` which
  checks gateway health and routes accordingly.
- **Visible status**: the UI MUST display which data provider is currently
  active (IBKR Live / Yahoo delayed / Offline) in both the sidebar and the
  header bar. A "Reconnect" button MUST be available to force a health
  re-check.
- **Provider field in responses**: every `/ibkr/*` market data endpoint
  MUST include a `provider` field in the response (`'ibkr'` | `'yahoo'` |
  `'none'`) so the client knows which source was used for that specific
  request.
- **Account data is IBKR-only**: account summary and positions endpoints
  (`/ibkr/account/*`) do NOT fall back to Yahoo — they require IBKR. If IBKR
  is unavailable, these endpoints return 503 with a clear error message.
- **Gateway lifecycle**: the IBKR Client Portal Gateway runs locally
  (either natively via `bin/run.sh` or in Docker via `docker-compose.yml`).
  The server MUST call `/tickle` every 60 seconds to keep the session alive.
  Sessions expire after ~6 minutes of inactivity.
- **Self-signed certificates**: the IBKR gateway uses HTTPS with self-signed
  certificates. The server sets `NODE_TLS_REJECT_UNAUTHORIZED=0` for IBKR
  gateway connections only. This does NOT affect outbound connections to
  Yahoo Finance, CFTC, or Groq.
- **Symbol resolution**: Yahoo Finance symbols (e.g. `^GSPC`, `ES=F`,
  `BRK-B`) MUST be mapped to IBKR contract IDs (conids) via
  `ibkrSymbolMap.js`. Known conids are cached statically; unknown symbols
  are resolved via the IBKR search API at runtime and cached in memory.
- **Rationale**: market data is the foundation of every analysis view in
  the tool. A single hard dependency on one provider means an outage or
  rate limit makes the entire tool useless. Automatic fallback ensures the
  tool is always functional, while visible status ensures the user knows
  whether they're seeing real-time or delayed data.

### XI. Daily Refresh & Section Timestamps (NON-NEGOTIABLE)

All data-driven sections across every tab MUST refresh their underlying data
once daily (24-hour TTL) and MUST display a visible timestamp showing when
the data was last fetched. This principle standardizes cache duration and
freshness visibility across the entire application.

- **Server-side cache TTL**: all server-side in-memory caches (COT report,
  COT history, momentum scan, sector rotation, volatility scan, social
  media proxy, AI commentary) MUST use a 24-hour TTL
  (`24 * 60 * 60_000` ms). Manual refresh via `?refresh=1` query parameter
  MUST always bypass the cache and fetch fresh data.
- **Client-side auto-refresh**: all frontend auto-refresh intervals
  (`useMarketData`, `FuturesTab`, `SocialPulseTab`, and any component with
  `setInterval`) MUST default to 24 hours. Users MAY trigger manual refresh
  at any time via the refresh button on each section.
- **Visible section timestamps**: every data-driven section in every tab
  MUST display a `<SectionTimestamp>` component (or equivalent) showing:
  - A human-readable "Updated [date, time]" label
  - The section name (e.g., "COT Report", "Momentum Scan")
  - Staleness color-coding: **green** (fresh, < 24h), **yellow** (recent,
    < 48h), **red** (stale, ≥ 48h)
  - An optional refresh button to trigger manual data refresh
- **Timestamp data source**: for server-fetched data, the timestamp MUST
  use the `fetchedAt` field from the server response. For client-computed
  sections (e.g., Tax Strategy, Projections derived from user inputs), the
  timestamp MUST reflect the last computation time (`new Date()`).
- **Shared component**: the `<SectionTimestamp>` component
  (`src/components/SectionTimestamp.jsx`) is the canonical implementation.
  It MUST be used by all tabs and sections. Custom timestamp displays MAY
  coexist but MUST NOT replace the `SectionTimestamp` component.
- **Manual refresh propagation**: when a user clicks refresh on a section,
  the refresh MUST bypass both the server-side cache (via `?refresh=1`)
  and any client-side caching. For AI commentary, the refresh MUST also
  bypass the commentary cache to ensure the AI analysis reflects the
  latest data.
- **Rationale**: inconsistent cache durations and invisible data freshness
  lead to user confusion about whether they're seeing current or stale
  data. Standardizing to daily refresh with visible timestamps ensures
  the user always knows when their data was last updated and can manually
  refresh at any time. Daily refresh balances data freshness with API
  rate limits and server load.

### XII. Auto-Refresh on Tab Switch & 12-Week Trend Views (NON-NEGOTIABLE)

When a user navigates from one tab or section to another, the destination
tab MUST automatically fetch fresh data from its sources on mount. Manual
refresh buttons MUST immediately bypass all cache layers and fetch the
latest data. Every tab MUST include a visible 12-week price trend chart.

- **Auto-refresh on tab switch**: the tab content container in `App.jsx`
  MUST use a `key` prop tied to the active tab id (e.g. `key={tab}`) so
  that React unmounts the previous tab's component tree and remounts the
  new tab's components from scratch. This ensures all `useEffect` hooks
  re-fire and data is fetched fresh on every tab switch. Components MUST
  NOT persist stale data across tab switches.
- **Cache-bypassing manual refresh**: all refresh buttons (in
  `SectionTimestamp`, tab headers, and inline refresh controls) MUST
  pass `forceRefresh=true` to the underlying fetch function. This bypasses
  both the client-side in-memory cache (in `marketData.js`) and the
  server-side cache (via `?refresh=1` query parameter). The user MUST
  always be able to get the latest data with a single click.
- **forceRefresh propagation**: all fetch functions in `marketData.js`
  (`fetchQuotes`, `fetchHistory`, `fetchOptionsChain`, `fetchAllFutures`,
  `fetchMarketSnapshot`) MUST accept a `forceRefresh` boolean parameter.
  When `true`, the function MUST skip the client-side cache and append
  `&refresh=1` to the server URL. The `useMarketData` hook's `refresh()`
  callback MUST accept and forward this parameter.
- **12-week trend view**: every tab MUST include a `<WeeklyTrendView>`
  component (from `src/components/WeeklyTrendView.jsx`) displaying a
  12-week price trend chart for a representative symbol. The chart MUST
  show:
  - Weekly closing prices as an area/line chart
  - Weekly percentage change as a color-coded bar chart (green = up,
    red = down)
  - Overall 12-week return percentage with trend indicator
  - A `SectionTimestamp` with refresh capability
- **Trend view symbol selection**: each tab SHOULD choose a symbol
  relevant to its domain (e.g., COT → ES=F, Volatility → ^VIX,
  Retirement → VTI, Sector Rotation → XLK). Tabs with user-selectable
  symbols (Options, Spread Finder, Futures, Markets) MUST use the
  currently selected symbol for the trend view.
- **Shared component**: the `<WeeklyTrendView>` component
  (`src/components/WeeklyTrendView.jsx`) is the canonical implementation.
  It fetches 3 months of weekly data (`range=3mo&interval=1wk`) from the
  `/yf/history` endpoint and displays the last 12 weeks.
- **Rationale**: users expect to see current data when they switch tabs,
  not potentially stale cached data. Forcing a remount on tab switch
  ensures fresh fetches without requiring the user to manually refresh.
  Cache-bypassing refresh buttons give users confidence that clicking
  refresh always gets the latest data. 12-week trend views provide
  essential historical context for every data point shown, helping users
  understand whether current values are part of an ongoing trend or a
  reversal.

### XIII. Market Assistant Full-Data-Access (NON-NEGOTIABLE)

The Market Assistant (AI chat tab) MUST have access to all data sources
available in the app. The assistant's context MUST be built from every
data domain the app exposes, not just a subset. This ensures the user
can ask questions about any data in the app and receive grounded,
data-driven answers.

- **Comprehensive context**: the `buildMarketContext()` function in
  `src/engine/briefingContext.js` MUST fetch data from all app sources
  in parallel: global indices, watchlist quotes, futures, world market
  snapshot, COT report, COT 12-week history, momentum scan, sector
  rotation, volatility scan, and social sentiment. Each source MUST be
  formatted as a distinct context section with relevant metrics.
- **Data source visibility**: the AIChatTab UI MUST display which data
  sources are currently synced via badges or a collapsible panel. Users
  MUST be able to see at a glance what data the assistant has access to.
- **Suggested questions**: the AIChatTab MUST provide clickable suggested
  questions covering all major data domains (momentum, sectors,
  volatility, COT, watchlist, world markets, social sentiment). These
  questions MUST be displayed in the empty state before the user sends
  their first message.
- **Markdown rendering**: assistant responses MUST be rendered with
  markdown support — headers (H1-H3), bold, inline code, bullet lists,
  numbered lists, and blockquotes. Plain text rendering of LLM output
  is NOT acceptable.
- **Context refresh**: the user MUST be able to manually re-sync all
  data sources via a visible refresh button in the header. The sync
  status (idle, loading, ready, error) MUST be displayed.
- **Cross-source reasoning**: the system prompt MUST instruct the LLM
  to cross-reference data sources (e.g., relate momentum signals to COT
  positioning, or volatility levels to options strategies). The prompt
  MUST also instruct the LLM to not hallucinate data not present in the
  context.
- **Graceful degradation**: if individual data sources fail to fetch,
  the assistant MUST still function with whatever sources succeeded.
  The context builder MUST catch per-source errors and continue building
  context from available sources.
- **Rationale**: limiting the assistant to only watchlist quotes and
  social sentiment (as in v1.7.0 and earlier) severely limits its
  usefulness. Users should be able to ask about any data in the app —
  COT positioning, sector rotation, volatility regime, momentum signals,
  futures, global markets — and get grounded answers. Full-data-access
  transforms the assistant from a narrow watchlist chatbot into a
  comprehensive market intelligence tool.

### XIV. Risk & Opportunity Intelligence (NON-NEGOTIABLE)

The application MUST provide two intelligence features that help users
understand market risk and discover actionable options opportunities:
a **Market Crash Indicator** ("Crash Radar") and an **Options
Opportunities** tab. Both features MUST be built with pure engines,
Vitest unit tests, cached server endpoints, and Market Assistant
integration.

**Crash Radar (Market Crash Indicator):**

- **Composite score**: a pure engine (`src/engine/crashIndicator.js`)
  MUST compute a 0–100 composite crash risk score from multiple
  normalized, weighted sub-signals. The minimum required factors are:
  VIX level & regime, VIX term structure (backwardation), SPY vs
  200-DMA, sector breadth (% sector ETFs below 200-DMA), momentum
  deterioration, drawdown from 52-week high, and COT net positioning
  shift in equity index futures.
- **Transparency**: every factor MUST be surfaced individually with its
  raw value, normalized score, weight, contribution to the composite,
  and a human-readable note explaining what it means. The composite
  score MUST NOT be a black box.
- **Risk levels**: the score MUST map to at least 5 named levels (e.g.,
  Calm, Watch, Elevated, High, Severe) with distinct colors.
- **Dedicated tab**: a `CrashRadarTab` MUST exist with the radial gauge,
  factor breakdown table, 12-week trend view (`WeeklyTrendView`),
  `SectionTimestamp`, refresh button, and educational disclaimer.
- **Dashboard widget**: a compact `CrashGauge` widget MUST appear on the
  Dashboard, linking to the full Crash Radar tab.
- **Server endpoint**: `GET /crash/scan` MUST be cached 24 hours with
  `?refresh=1` bypass per Principle XI.
- **Tests**: Vitest unit tests MUST verify calm/crisis inputs, score
  monotonicity (worsening inputs never lower the score), boundary
  thresholds, and null-safety.

**Options Opportunities:**

- **Universe**: the engine MUST scan underlyings from the user's
  portfolio holdings + watchlist symbols + a curated set of highly
  liquid optionable names (mega-caps, major ETFs).
- **Scoring**: each underlying MUST be scored by momentum score,
  volume confirmation, and 200-DMA position (reusing
  `momentumEngine.analyzeAsset()`).
- **Three horizon bands**: recommendations MUST be grouped into:
  Short-term (DTE ≤ 365), Medium-term (365 < DTE ≤ 730), and LEAPS
  (DTE > 730).
- **Strategy selection**: Short & Medium bands MUST be signal-driven
  (directional buys for strong signals, income spreads for range-bound
  / high-IV). LEAPS band MUST be bullish only (long calls + bull call
  spreads), prioritizing deep-ITM (~0.70–0.80 delta) stock-replacement.
- **Ranked recommendations**: each band MUST return up to 5 ranked
  recommendations sorted by opportunity score.
- **Structured rationale**: every recommendation MUST include a `why`
  object with `signalSummary`, `strikeReason`, `horizonReason`, and
  `riskNote` fields for clear bullet-text rendering in the UI.
- **Drawdown guard**: recommendations where max loss exceeds 15% of
  the sized allocation MUST be flagged (Principle VII).
- **Portfolio awareness**: the UI MUST show a "Held" tag for symbols
  the user holds, using `PortfolioContext`.
- **Server endpoint**: `POST /options/opportunities` MUST accept the
  client universe + held symbols, be cached 24 hours with `?refresh=1`
  bypass.
- **Tests**: Vitest unit tests MUST verify band bucketing, ranking,
  strategy picks, rationale presence, drawdown guard, monotonicity,
  and null-safety.
- **Cash-flow-specific gates** (v1.12.0): debit structures (bull call,
  bear put, PMCC) MUST clear RoC ≥ 3× and PoP ≥ 30%. Credit structures
  (bull put, bear call) MUST have an out-of-the-money short strike,
  credit ≥ 20% of width (RoC ≥ 0.25) and PoP ≥ 55%. The debit RoC floor
  MUST NOT be applied to credit spreads — doing so selects deep-ITM
  directional bets and mislabels them as income.
- **Quote-quality gate** (v1.12.0): every leg MUST have a live two-sided
  quote; combined leg bid/ask width MUST be ≤ 35% of the strike width;
  and the natural (buy-at-ask / sell-at-bid) price MUST still leave a
  profit. Recommendations MUST expose the natural price alongside mid.
- **Minimum position profit** (v1.12.1): each band has a floor on the
  sized position's max profit — Short-term $1,000, Medium-term $2,000,
  LEAPS $5,000. The engine MUST size the contract count to reach the
  floor and MUST reject the trade when the resulting capital at risk
  exceeds the user-editable per-trade allocation (default $10,000).
  Cards MUST show contract count and position totals.
- **Crash-regime overlay** (v1.12.0): the engine MUST accept the Crash
  Radar result and, at Elevated/High/Severe, de-rate bullish scores and
  lift bearish scores, returning a `regime` summary rendered as a banner.

**Crash Thesis (strategist playbook) (v1.12.0):**

- A pure engine (`src/engine/crashThesis.js`) MAY model a named
  strategist's public market thesis (currently Cem Karsan's post-midterm
  drawdown → V-bottom view) provided it: cites the source; injects
  `asOf` for determinism; shows a live-data scorecard separating entry
  conditions from confirmation signals; prices each structure from live
  quotes that pass a quote-quality check; shows scenario P&L with
  documented spot-vol assumptions; encodes the thesis's own exit rules
  (kill switch, flip-long triggers); and reports hedged vs. unhedged
  portfolio drawdown against the Principle VII 15% threshold.
- A structure whose scenario P&L is negative in the crash the thesis
  predicts (e.g., a same-strike calendar in a fast −20% move) MUST be
  labeled as such in the UI.
- Server endpoint `GET /thesis/karsan` MAY cache market inputs for 1 hour
  (options quotes stale faster than daily scans) with `?refresh=1`
  bypass; sizing parameters MUST be applied per request without refetch.
- The tab MUST include `SectionTimestamp`, `WeeklyTrendView`, the source
  link, and an educational disclaimer; the Market Assistant MUST receive
  the thesis summary (Principle XIII).

**VIX term structure source (v1.12.0):** Yahoo publishes no continuous
VIX futures (`^VX1`/`^VX2` return no data). The term-structure factor
MUST use real futures when available and otherwise the CBOE
constant-maturity indices (`^VIX9D`, `^VIX3M`, `^VIX6M`), with VIX3M as
the forward point.
- **Rationale**: market risk and opportunity discovery are the two most
  valuable intelligence functions for an active investor. A transparent,
  multi-factor crash indicator provides early warning without black-box
  predictions. Options opportunities ranked by momentum/volume/200-DMA
  with clear rationale and horizon bands enable disciplined, thesis-
  driven trading. Both features embody the constitution's emphasis on
  education, transparency, and capital preservation.

### XV. Dell 401(k) Plan Tracking (NON-NEGOTIABLE)

The application MUST provide a dedicated tab for tracking the user's
Dell Technologies 401(k) plan (administered via Fidelity NetBenefits).
The tab MUST display the full plan fund menu, the user's current
holdings with balances, and weekly price-change tracking of each held
fund via its underlying ETF proxy.

- **Fund menu**: the `DELL_K401_FUNDS` array in `src/engine/fundUniverse.js`
  MUST enumerate all funds available in the Dell 401(k) plan, including
  fund name, ticker (or Fidelity plan ID), asset class, and expense ratio.
  Funds MUST be grouped by asset class for display.
- **Current holdings**: each fund the user currently holds MUST include a
  `currentBalance` field. The tab MUST display:
  - Total balance across all held funds
  - Number of funds held vs. total available
  - Weighted expense ratio across held funds
  - Annual fee drag (sum of balance × expense ratio)
  - A pie chart showing allocation by fund
  - A holdings list with ticker, name, balance, % of total, and expense ratio
- **Weekly price-change tracking**: each held fund MUST be mapped to a
  publicly traded ETF proxy that tracks the same index/strategy. The tab
  MUST fetch weekly price history (`range=3mo&interval=1wk`) for each
  proxy ETF and display:
  - Latest weekly close price
  - Week-over-week % change (color-coded green/red)
  - 12-week cumulative % change
  - Estimated balance change = currentBalance × weekly % change
  - Estimated total portfolio change = sum across all held funds
- **ETF proxy mapping**: the mapping from Dell fund IDs to ETF tickers
  MUST be maintained in `src/engine/fundUniverse.js` as
  `DELL_ETF_PROXY_MAP`. Proxies SHOULD use the most liquid ETF for each
  asset class (e.g., SPY for S&P 500, VWO for emerging markets, VNQ for
  real estate, AGG for US bond index).
- **WeeklyTrendView**: the tab MUST include a `<WeeklyTrendView>` component
  per Principle XII, using SPY as the representative benchmark symbol.
- **Tab position**: the Dell 401(k) tab MUST appear immediately below the
  Opportunities tab in the sidebar navigation.
- **Rationale**: the user's 401(k) is their largest retirement asset.
  Tracking weekly price movements via ETF proxies provides visibility into
  portfolio performance without requiring direct account access. The fund
  menu with expense ratios enables ongoing fee awareness and rebalancing
  decisions.

## Technology Stack & Constraints

- **Frontend**: React 19+, Vite 7+, Tailwind CSS, Recharts, lucide-react.
- **Backend**: Node.js (ESM), Express 5+, `yahoo-finance2` for market data; bound to
  `0.0.0.0:3001` for LAN access.
- **IBKR Gateway**: IBKR Client Portal Web API (REST) via local gateway on
  `:5010` (native) or `:5000` (Docker). Auto-fallback to Yahoo Finance when
  unavailable. Gateway credentials in `.env` (gitignored).
- **AI inference**: Groq (`api.groq.com/openai/v1/`) for server-side LLM commentary
  (model: `llama-3.3-70b-versatile`). API key loaded from `.env` at server boot.
- **Dev proxy**: Vite proxies `/yf/*`, `/cot/*`, `/momentum/*`, `/ai/*` to the Express
  server; production deployment strategy is TBD and MUST be specified before first deploy.
- **Spec-Kit**: Spec-driven workflow under `.specify/` and `.windsurf/workflows/`. New
  non-trivial features MUST start with `/speckit.specify`; trivial fixes (typos, copy,
  one-line bug fixes) MAY skip the workflow.
- **No secrets in repo**: API keys, broker credentials, or personal financial data MUST
  NOT be committed. Use environment variables loaded at server boot only.
- **No PII collection**: All inputs are local-only and ephemeral. Persisting user
  financial inputs to disk, cookies, or remote storage requires an explicit spec and
  consent flow.

## Development Workflow & Quality Gates

1. **Specify** — every non-trivial change begins with `/speckit.specify` producing
   `specs/<NNN>-<slug>/spec.md`. Specs MUST include: goal, user stories, inputs/outputs,
   acceptance criteria, out-of-scope items.
2. **Plan** — `/speckit.plan` produces `plan.md` and any contracts/data-model artifacts.
   The Constitution Check gate in the plan template MUST be answered against this file.
3. **Tasks** — `/speckit.tasks` decomposes the plan into ordered, dependency-aware tasks.
4. **Implement** — `/speckit.implement` executes tasks. New engine code MUST land with
   tests (Principle V). New external data MUST land with schema validation (Principle
   III).
5. **Analyze (optional)** — `/speckit.analyze` runs cross-artifact consistency checks.
6. **Commit** — small, focused commits; conventional-commit-style messages preferred
   (`feat:`, `fix:`, `docs:`, `refactor:`, `test:`).

A change MUST NOT merge if it: (a) violates a NON-NEGOTIABLE principle, (b) hardcodes
tax/legal values without citations, (c) removes or weakens existing tests without an
accompanying spec amendment, (d) introduces a new top-level UI library,
(e) adds a wealth-projection view that does not flag >15% modeled drawdown
scenarios per Principle VII, (f) introduces a data source not in the
`src/engine/sources.js` registry, or surfaces market/tax numbers without the
provenance metadata required by Principle VIII, or (g) adds AI-generated
commentary to a UI surface without the provider+model label, real-data
grounding, and graceful error state required by Principle IX, or (h) adds
a data-driven section without a visible `<SectionTimestamp>` or equivalent
per Principle XI, or uses a cache TTL other than 24 hours without an
explicit spec amendment, or (i) adds a new tab without a `<WeeklyTrendView>`
component per Principle XII, or implements a refresh button that does not
bypass both client-side and server-side caches, or (j) modifies the Market
Assistant to not have access to all app data sources per Principle XIII,
or (k) adds a risk or opportunity intelligence feature without the pure
engine, Vitest tests, cached server endpoint, structured rationale, and
educational disclaimer required by Principle XIV, or (l) adds a Dell
401(k) tab without the fund menu, current holdings, weekly price-change
tracking, and WeeklyTrendView required by Principle XV.

## Governance

- This constitution supersedes ad-hoc conventions and individual preferences.
- Amendments are made via `/speckit.constitution`. Each amendment MUST update the
  `Last Amended` date and bump the version per semantic rules:
  - **MAJOR**: removal of a principle, redefinition that breaks existing specs, or change
    that invalidates merged plans.
  - **MINOR**: addition of a principle or section, materially expanded guidance.
  - **PATCH**: clarifications, typos, non-semantic refinements.
- The Sync Impact Report at the top of this file MUST be updated on every amendment.
- Compliance review: every `/speckit.plan` execution evaluates the Constitution Check
  gate; reviewers (human or AI) MUST flag deviations explicitly with justification or
  reject the plan.
- Runtime guidance for AI agents lives in `.windsurf/rules/` and `.windsurf/workflows/`;
  those documents MUST stay consistent with this constitution.

**Version**: 1.12.1 | **Ratified**: 2026-05-09 | **Last Amended**: 2026-09-26
