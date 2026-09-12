# Tasks: Portfolio Upload & Evaluation

## Phase 1: Dependencies & Test Infra

- [x] T001 Add `papaparse` + dev deps `vitest`, `@vitest/coverage-v8` to package.json
- [x] T002 Create `vitest.config.js` (Node environment, tests/**/*.test.js)
- [x] T003 Add `test`, `test:watch`, `test:coverage` scripts
- [x] T004 Update `.gitignore` to exclude `coverage/`

## Phase 2: Pure Engine (Test-First)

- [x] T010 Write `tests/engine/portfolioParser.test.js` (detectBroker, parseCsv, classify, isUsSitus cases)
- [x] T011 Implement `src/engine/brokerProfiles.js` (6 broker profiles + generic)
- [x] T012 Implement `src/engine/portfolioParser.js` (parse + classify + isUsSitus)
- [x] T013 Write `tests/engine/portfolioMetrics.test.js` (enrich, computeMetrics)
- [x] T014 Implement `src/engine/portfolioMetrics.js`
- [x] T015 Run `npm test` → all green

## Phase 3: UI

- [x] T020 Implement `src/components/DataSourceBadge.jsx`
- [x] T021 Implement `src/components/PortfolioTab.jsx` (upload + table + summary + insights)
- [x] T022 Register `portfolio` tab in `src/App.jsx`

## Phase 4: Verify

- [x] T030 Manual smoke: drop a generic CSV, verify parse + price fetch + table
- [x] T031 Confirm no holdings data in network tab (only symbol quote calls)
