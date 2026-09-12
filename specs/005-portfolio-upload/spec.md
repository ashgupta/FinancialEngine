# Feature Specification: Portfolio Upload & Evaluation

**Feature Branch**: `005-portfolio-upload`
**Created**: 2026-05-09
**Status**: Draft
**Input**: User description: "Upload portfolio CSV from common brokers and evaluate allocation, concentration, drawdown, and tax-location exposure with privacy-first client-side processing"

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Drag-and-drop a broker CSV and see my portfolio evaluated (Priority: P1)

As a user of this tool, I want to drag a CSV export from my brokerage into a
dedicated Portfolio tab and immediately see my total value, allocation, and
concentration risk — without any of my holdings being uploaded to a server —
so I can evaluate my current portfolio alongside the other planning features
in this app.

**Why this priority**: This is the whole feature. Without it, the tab has no
reason to exist. Implementing only this story delivers a complete MVP.

**Independent Test**: Open the Portfolio tab, drop a Fidelity/Schwab/Vanguard
CSV onto the upload zone, and within a few seconds see a populated holdings
table plus allocation visualization.

**Acceptance Scenarios**:

1. **Given** the Portfolio tab is open, **When** the user drops a supported
   broker CSV onto the upload zone, **Then** within 5 seconds the holdings
   parse, live prices fetch, and a holdings table renders with symbol,
   quantity, current price, current value, and gain/loss per row.
2. **Given** holdings have parsed, **When** the view renders, **Then** a
   summary section shows total portfolio value, total unrealized gain/loss
   (if cost basis was in the file), day-over-day change, and weighted
   dividend yield.
3. **Given** holdings include a symbol the data source does not recognize,
   **When** price enrichment runs, **Then** that row renders with a clear
   "price unavailable" indicator and the row is excluded from totals rather
   than silently zeroed.
4. **Given** a file is dropped, **When** no personal data leaves the browser,
   **Then** the only network call triggered is a price lookup (`/yf/quote/...`)
   sending symbols only. (Verified by inspecting devtools network tab.)

---

### User Story 2 - Auto-detect broker format, offer manual mapping if ambiguous (Priority: P1)

As the same user, when my broker's CSV doesn't match a known format, I want
the app to present a column-mapping step so I can tell it which column is
the symbol, quantity, cost basis, etc. — so I'm never blocked by format
variations.

**Why this priority**: Without this, niche brokers and older exports fail
silently. P1 because the primary user journey breaks otherwise.

**Independent Test**: Drop a generic CSV with nonstandard column headers.
A column-mapping dialog appears with detected columns on the left and
required fields on the right. After the user maps symbol + quantity, the
evaluation proceeds normally.

**Acceptance Scenarios**:

1. **Given** an uploaded CSV whose headers match a known broker format
   (Fidelity, Schwab, Vanguard, E*TRADE, IBKR, Robinhood), **When** parsing
   runs, **Then** the app auto-detects the broker and proceeds without a
   mapping step.
2. **Given** headers do not match any known format, **When** parsing runs,
   **Then** a column-mapping UI appears asking the user to identify at
   minimum `symbol` and `quantity`, with optional mapping for
   `cost_basis`, `current_price`, `description`, `account`.
3. **Given** the user confirms the mapping, **When** they click "Evaluate",
   **Then** parsing proceeds using the user-provided mapping.
4. **Given** the user cancels the mapping step, **When** they return to
   the tab, **Then** the upload zone is reset and no partial state
   remains.

---

### User Story 3 - Concentration, drawdown, and tax-location insights (Priority: P2)

As the same user, I want the evaluation to show concentration risk,
drawdown exposure, and tax-location hints — so I understand risks my raw
holdings table doesn't surface.

**Why this priority**: Materially more insight than a plain holdings list.
Not required for MVP but expected after Story 1.

**Independent Test**: After a portfolio loads, an "Insights" panel shows:
top 5 holdings as % of total, a drawdown warning if applicable per
Principle VII, and a section listing which holdings would be more tax-
efficient in a tax-deferred account vs taxable (bonds/REITs) or vice
versa (growth equities).

**Acceptance Scenarios**:

1. **Given** a loaded portfolio with more than 5 holdings, **When** the
   Insights panel renders, **Then** it shows top 5 holdings as % of total
   and flags any single holding exceeding 20% concentration.
2. **Given** the portfolio's modeled forward drawdown (based on historical
   volatility of its holdings or a proxy) exceeds 15%, **When** the view
   renders, **Then** a `<DrawdownWarning>` badge appears in the Insights
   panel per constitution Principle VII.
3. **Given** holdings include bond ETFs, REITs, or dividend-heavy
   instruments in taxable accounts, **When** tax-location analysis runs,
   **Then** the Insights panel surfaces a suggestion to hold those in a
   tax-deferred account, framed as educational not advice per Principle I.

---

### User Story 4 - US-situs / estate-tax exposure (Priority: P2)

As a user planning cross-border moves (see existing International Investor
Calc feature), I want the portfolio evaluator to flag which portion of my
holdings is US-situs for estate-tax purposes — so I can tie this to the
existing International Investor tab.

**Why this priority**: Directly addresses a real question this user has
been asking in prior sessions. Independently testable from Story 1.

**Independent Test**: A loaded portfolio shows, in the Insights panel, a
breakdown of US-situs (US-listed stocks, US-domiciled ETFs, US real
estate funds) vs. non-US-situs (Irish-domiciled UCITS, foreign ADRs when
identifiable, bank deposits if known).

**Acceptance Scenarios**:

1. **Given** holdings include a mix of US-domiciled and Irish-domiciled
   ETFs, **When** Insights renders, **Then** the US-situs breakdown shows
   both categories with percentages and total USD.
2. **Given** the user's declared tax status is NRA (via a toggle or
   existing state), **When** Insights renders, **Then** the estate-tax
   exposure on US-situs value is computed using the NRA $60K exemption and
   shown.

---

### User Story 5 - Privacy-first: nothing sensitive leaves the browser (Priority: P1)

As any user, I want confidence that my holdings data never leaves my
machine — so I can upload broker CSVs without worrying about leakage.

**Why this priority**: Both a constitutional requirement (§No PII
Collection) and a user-trust precondition. P1.

**Independent Test**: Open devtools → Network. Upload a portfolio file.
The file content never appears in any request body. Only symbol-level
`GET /yf/quote/:symbol` and `GET /yf/history/...` requests occur.

**Acceptance Scenarios**:

1. **Given** a portfolio is uploaded, **When** the user inspects network
   activity, **Then** no request body contains holdings, quantities, cost
   basis, or account names.
2. **Given** the user refreshes or closes the tab, **When** they return,
   **Then** portfolio state is cleared (no auto-persistence in v1).
3. **Given** the user explicitly clicks a "Save to this browser" action,
   **When** they confirm, **Then** the portfolio is stored only in the
   browser's localStorage (still no server upload) and a clear indicator
   shows "saved locally, not synced". (v1 may defer this action as
   out-of-scope; see Assumptions.)

---

### Edge Cases

- **Empty file / wrong file type** → user-friendly error, upload zone reset
- **CSV with only header row** → "no holdings found" message
- **Hundreds of positions** → parsing + price enrichment must complete in ≤
  15 seconds for portfolios up to 500 rows; batch price fetches
- **Symbols in unusual formats** (e.g., mutual fund CUSIPs, foreign
  symbols like `CSPX.L`) → best-effort lookup; unknown ones labeled
  "unavailable"
- **Duplicate symbols** across multiple rows (common when user merges
  multiple accounts) → aggregated by symbol with a note showing row count
- **Cost basis missing for some rows** → gain/loss column shows "—" for
  those rows; aggregate totals exclude them with a footnote
- **Cash / money-market positions** (`SPAXX`, `VMFXX`, `$`, `USD`) →
  treated as cash category with no price lookup
- **Non-equity holdings** (bonds by CUSIP, options with OCC symbols,
  futures contracts) → best-effort handling; non-equity flagged as such
  and excluded from equity-specific metrics
- **Locale formatting** (comma vs period decimal separators, currency
  symbols in numeric columns) → parser must normalize at the boundary

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The system MUST provide a Portfolio tab accessible from the
  main navigation.
- **FR-002**: The tab MUST support drag-and-drop and click-to-select upload
  for `.csv` and `.xlsx` files.
- **FR-003**: The system MUST parse the uploaded file entirely in the
  browser; no portion of the file content MUST be transmitted to any
  server.
- **FR-004**: The parser MUST auto-detect the broker format by inspecting
  column headers, supporting at minimum: Fidelity, Schwab, Vanguard,
  E*TRADE, IBKR, Robinhood, and a generic `symbol,quantity[,cost_basis]`
  format.
- **FR-005**: When auto-detection fails, the system MUST present a column-
  mapping UI requiring at minimum `symbol` and `quantity`, with optional
  mappings.
- **FR-006**: The system MUST fetch current prices for recognized equity
  symbols via the existing `/yf/quote/:symbol` endpoint (or a batch
  equivalent if available).
- **FR-007**: The system MUST display a holdings table with per-row symbol,
  description, quantity, current price, current value, unrealized gain/loss
  (when cost basis is present), and allocation percentage.
- **FR-008**: The system MUST display a summary section with total
  portfolio value, total unrealized gain/loss, day-over-day change, and
  weighted dividend yield.
- **FR-009**: The system MUST display an Insights panel with concentration
  risk (top-5 and any >20% single-holding flag), drawdown exposure flag
  per constitution Principle VII, and tax-location hints.
- **FR-010**: The system MUST display a US-situs breakdown pairing with the
  International Investor Calc feature's $60K NRA exemption logic.
- **FR-011**: All price data MUST show provenance metadata per
  constitution Principle VIII: source, fetchedAt timestamp, and staleness
  color cue.
- **FR-012**: The system MUST NOT auto-persist portfolio data across
  sessions in v1. An explicit "Save to this browser" action is optional
  and out of scope for v1 unless implementation permits with zero extra
  effort.
- **FR-013**: On parser error (malformed file, no parseable rows),
  the system MUST display a clear, user-friendly error and reset the
  upload zone.
- **FR-014**: Symbols not recognized by the price-lookup source MUST be
  rendered with a "price unavailable" indicator and excluded from
  totals; these rows MUST NOT be silently zeroed.
- **FR-015**: All parsing, categorization, and metric math MUST live in
  `src/engine/` per constitution Principle II and be accompanied by unit
  tests per Principle V.
- **FR-016**: The system MUST display a persistent educational-use
  disclaimer consistent with Principle I.
- **FR-017**: The system MUST NOT fabricate prices, returns, or
  classifications when data is missing, per constitution Principle VIII.

### Key Entities

- **UploadedPortfolio**: user-uploaded file parsed into a normalized
  representation. Contains metadata (broker, uploadedAt) and a list of
  `Position` objects.
- **Position**: one holding — `{ symbol, quantity, costBasis?,
  description?, account? }` after normalization.
- **EnrichedPosition**: a `Position` with added runtime fields:
  `currentPrice`, `currentValue`, `unrealizedGain`, `dividendYield?`,
  `dayChangePct`, `classification` (equity | etf | bond | reit | cash |
  unknown), `isUsSitus`.
- **PortfolioMetrics**: aggregate computed metrics — total value,
  allocation breakdowns, concentration stats, US-situs totals,
  modeled drawdown series.
- **BrokerProfile**: the detection profile for each known broker — column
  header patterns and column → field mappings.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: For a 50-row Fidelity CSV on a mid-range laptop, from drop
  to fully-populated holdings table: ≤ 5 seconds end-to-end.
- **SC-002**: For a 500-row CSV, parsing + price enrichment completes in
  ≤ 15 seconds.
- **SC-003**: Auto-detection correctly identifies at least 6 common
  broker formats given their default-export sample files.
- **SC-004**: Zero bytes of holdings data appear in any outbound request
  body (verified via devtools).
- **SC-005**: The Insights panel renders the `<DrawdownWarning>` badge
  when the portfolio's modeled forward drawdown exceeds 15% starting
  value.
- **SC-006**: 100% of hardcoded broker-detection column patterns have
  unit-test coverage.
- **SC-007**: An unrecognized symbol never silently disappears; it is
  always represented with an "unavailable" indicator.
- **SC-008**: Every price cell displays a provenance indicator
  (source + freshness).

## Assumptions

- Spec 003 (Vitest) is merged before implementation, OR Vitest is bundled
  into this spec's implementation to satisfy Principle V.
- Spec 004 (Drawdown Guard) components exist, OR a minimal inline
  drawdown-warning is implemented here with a TODO to migrate to the
  shared component once spec 004 ships.
- Constitution v1.2.0 `src/engine/sources.js` registry exists, OR a
  lightweight provenance badge is implemented inline here.
- CSV parsing uses `papaparse` (lightweight, well-maintained, 45KB
  gzipped); XLSX support uses SheetJS `xlsx` if added, otherwise XLSX
  is OUT of scope for v1.
- The app assumes user-uploaded cost basis is accurate; it does NOT
  independently verify against broker statements.
- The app assumes one portfolio session per tab mount; reuploading
  replaces the prior portfolio. No portfolio history in v1.
- Symbol classification (equity / ETF / bond / REIT / cash) uses a small
  heuristic based on well-known ticker lists and Yahoo Finance
  `quoteType`; not authoritative for every security.
- Currency is assumed USD in v1; multi-currency holdings are OUT of
  scope.

## Out of Scope

- XLSX file support (may be added in a follow-up if PapaParse-only
  proves insufficient).
- Multi-currency holdings / FX conversion.
- Historical portfolio tracking (multiple uploads over time).
- Rebalancing recommendations.
- Trade / transaction history (only current holdings).
- Options Greeks, bond duration/convexity, or any derivative-specific
  analytics (the existing Options and Futures tabs handle those
  independently).
- Broker API direct integration (Plaid, Yodlee, broker OAuth) — explicit
  CSV upload only.
- Importing transaction history to derive cost basis — user-provided
  cost basis only.
- Tax-loss harvesting suggestions (future spec).
- PDF / image-based broker statement parsing.
- Server-side persistence of any kind.

## Dependencies

- Constitution v1.2.0 — binding; specifically Principles I, II, III, V,
  VI, VII, VIII.
- **Soft dependency** on spec 003 (Vitest): tests MUST ship. If 003 has
  not merged, this spec's implementation MUST bundle minimal Vitest
  setup sufficient to test its engine modules.
- **Soft dependency** on spec 004 (Drawdown Guard): `<DrawdownWarning>`
  is used. If 004 has not merged, a minimal inline warning component
  MUST be implemented with a TODO to migrate.
- **Soft dependency** on the eventual `src/engine/sources.js` registry
  from a future spec. Provenance badge is implemented inline here with
  TODO to migrate.
- External library: `papaparse` — adds ~45KB gzipped; MUST be added to
  `package.json`.
- Existing `fetchQuotes` / `fetchQuote` in
  `@/Users/ash/CascadeProjects/windsurf-project/src/engine/marketData.js`
  is reused for price enrichment.
