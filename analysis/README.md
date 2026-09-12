# Analysis Directory

Financial analysis and strategy research for WealthEngine. These files are designed to be consumed by AI agents (Devin, Cascade) as well as humans.

## Files

### Strategy Analysis
- **`barbell-strategy-analysis.md`** — Complete SPY vs QQQ barbell comparison with MAR ratios, managed futures integration, and age-45 recommendation. Based on 67 years of SPY data (38 windows) and 2 QQQ windows.

### Personal Finance
- **`mortgage-analysis.md`** — Mortgage calculations for a $725K home purchased Dec 2022 at 2.5%. Includes 20% and 10% down payment scenarios, sale-at-loss projections.

## Related Directories
- `../geometry-of-wealth/` — Full Geometry of Wealth episode transcripts and summaries
- `../src/engine/` — WealthEngine implementation (geometric.js, portfolio.js, monteCarlo.js, etc.)

## Key Principles Applied
1. **MAR Ratio** (CAGR / Max Drawdown) as the primary performance metric — superior to Sharpe for real-world compounding
2. **Volatility Tax** (½σ²) — the gap between arithmetic and geometric returns
3. **Crisis Alpha** — negative correlation during equity crashes (managed futures)
4. **Convexity** — options-based strategies capture asymmetric upside
5. **Regime Robustness** — strategies must survive stagflation, deflation, and inflation
