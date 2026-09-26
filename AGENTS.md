# WealthEngine / FinancialEngine — agent notes

- Governing rules: `.specify/memory/constitution.md` (pure engines in `src/engine/`, tests for every engine change, disclaimers, 15% drawdown guard).
- Run: `npm run server` (Express API, :3001) + `npm run dev` (Vite, :5173). New API path prefixes must be added to the proxy in `vite.config.js`.
- Verify: `npx vitest run` and `npx vite build`.
- Known pre-existing failure: `tests/engine/socialAggregator.test.js > DEFAULT_SOCIAL_WATCHLIST` (list has 8 entries, test expects > 10).
- Yahoo has no `^VX1`/`^VX2`; use `^VIX9D`, `^VIX3M`, `^VIX6M` for the VIX curve.
- Options spreads: always pass the quote-quality gate (`requireTwoSidedQuotes`, `maxLegSpreadToWidth`) — deep-ITM/LEAPS mids are often phantom prices.
