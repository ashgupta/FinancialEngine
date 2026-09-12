# Barbell Strategy Analysis — SPY vs QQQ

## Source Videos

- **SPY Barbell (67 years, 38 windows):** https://www.youtube.com/watch?v=[spy-barbell]
- **QQQ Barbell (2 windows):** https://www.youtube.com/watch?v=zjV3Mq3Bct4
- **Blog post:** https://www.foolishtrader.com/backtesting-leaps-on-spy-and-qqq/

---

## Strategy Overview

### Structure
- **Treasury sleeve:** Short/intermediate duration, quarterly rotation based on yield curve
- **LEAPS sleeve:** Deep ITM (90∆, 10% in-the-money), ~2.5 years DTE on SPY, ~1 year DTE on QQQ, rolled annually
- **Rebalancing:** Every January
- **Dial settings:** 50/50 (aggressive) through 90/10 (conservative) in 5% increments
  - First number = Treasury %, second number = LEAPS %

### Key Mechanics
- LEAPS capture more upside than their allocation size (options convexity)
- Treasury sleeve cushions downside in normal equity crashes
- Annual roll creates taxable events (short-term capital gains)

---

## SPY Barbell Performance (67 years, 38 rolling 30-year windows, 1958–2024)

Covers: Stagflation (1968–1982), Dot-com bust (2000), GFC (2008), COVID (2020), 2022 dual crash

| Setting | Median CAGR | Median Max DD | MAR | vs 100% SPY |
|:---|:---:|:---:|:---:|:---|
| 50/50 | 12.6% | −57% (GFC) | 0.22 | +2.1% return, +16% deeper DD |
| 60/40 | 12.3% | −45% (GFC) | 0.27 | +1.8% return, +4% deeper DD |
| **65/35** | **12.1%** | **−38% (GFC)** | **0.32** | **+1.6% return, −3% shallower DD** |
| **70/30** | **11.6%** | **−31% (GFC)** | **0.37** | **+1.1% return, −10% shallower DD** |
| 75/25 | 11.1% | −26% (GFC) | 0.43 | +0.6% return, −15% shallower DD |
| 80/20 | 10.4% | −22% (1987 crash) | 0.47 | −0.1% return, −19% shallower DD |
| 100% SPY | 10.5% | −41% (GFC) | 0.26 | — |

### Crisis Performance (SPY Barbell)

| Crisis | 65/35 | 70/30 | 75/25 | 80/20 | 100% SPY |
|:---|:---:|:---:|:---:|:---:|:---:|
| GFC 2008 | −43% | −36% | −29% | −21% | −49% |
| Dot-com | −38% | −31% | −26% | −14% | −41% |
| Stagflation | −37% | −31% | −26% | −19% | −39% |
| 1987 Crash | — | — | — | −22% | −24% |

### Key Findings (SPY)
1. **65/35 and 70/30 beat SPY on BOTH return AND drawdown** — the geometric free lunch
2. 80/20's worst drawdown (22%) came from 1987 crash, not any multi-year bear
3. 75/25 is the creator's planned retirement setting
4. Creator (age 50) runs 50/50 now, plans to glide to 75/25 at retirement

---

## QQQ Barbell Performance (2 windows only)

### Window 1: Dot-Com Dead Money (2000–2014)
Worst 15-year stretch for QQQ. Dot-com crash day 1, GFC in the middle.

| Setting | CAGR | Max DD | MAR |
|:---|:---:|:---:|:---:|
| 50/50 | 5.85% | −81% | 0.07 |
| 65/35 | ~7.6% | −63% | 0.12 |
| 75/25 | 7.93% | −45% | 0.18 |
| 80/20 | 7.90% | −34% | 0.23 |
| 90/10 | 7.27% | −10% | 0.73 |
| 100% QQQ | 1.21% | −81% | 0.01 |

**Critical finding:** Conservative rungs (80/20, 90/10) produced HIGHER CAGR than aggressive rungs — MAR inversion. Protection became the return engine.

### Window 2: Modern Bull (2015–2024)
Post-GFC, zero rates, 2022 bear market included.

| Setting | CAGR | Max DD | MAR |
|:---|:---:|:---:|:---:|
| 50/50 | 30.4% | −44% | 0.69 |
| 75/25 | 17.0% | −27% | 0.63 |
| 80/20 | 14.0% | −24% | 0.58 |
| 100% QQQ | 18.2% | −33% | 0.55 |

### Key Findings (QQQ)
1. QQQ barbell beat SPY barbell at every allocation in both windows
2. 2022 was nearly as bad as GFC for the barbell — bonds and equities fell together
3. Only 2 windows tested vs 38 for SPY — data is suggestive, not proven
4. No stagflation data available for QQQ (index didn't exist)
5. Creator runs QQQ barbell alongside SPY barbell, not instead of it

---

## Managed Futures — The Missing Piece

### Top Funds

| Ticker | Name | Expense | Strategy | MAR (since inception) |
|:---|:---|:---:|:---|:---:|
| **CTA** | Simplify Managed Futures | 0.75% | Multi-strategy (trend, carry, mean reversion, risk-off) | **0.48** |
| **DBMF** | iMGP DBi Managed Futures | 0.85% | Replicates pre-fee CTA hedge fund returns | **0.45** |
| **KMLM** | KFA Mount Lucas Managed Futures | 0.90% | Pure trend, no equities, 200-300% gross exposure | **0.26** |

Benchmarks: SG Trend Index MAR = 0.27, S&P 500 MAR = ~0.16

### Why Managed Futures
- Provides negative correlation during equity crashes (crisis alpha)
- 2022 lesson: bonds and equities can fall together — MF were up
- 2026 tariff selloff: KMLM +7%, DBMF +8% while S&P fell
- Recommended: ensemble approach — 5% each DBMF/KMLM/CTA

---

## Recommendation for Age 45, $100K Lump Sum

### Core Portfolio: 65/35 SPY Barbell + 15% Managed Futures

| Sleeve | Amount | What |
|:---|:---:|:---|
| Treasuries | $50,000 | Short/intermediate, quarterly rotation |
| SPY LEAPS | $35,000 | 90∆, ~2.5yr DTE, rolled annually |
| Managed Futures | $15,000 | DBMF 5% + KMLM 5% + CTA 5% |

### Expected Profile
- 20-year CAGR: 11–13%
- Worst-case drawdown: 30–38%
- MAR: 0.32–0.37
- $100K → 20 years: ~$800K–$1.1M

### Glide Path
| Age | Setting |
|:---|:---|
| 45–50 | 65/35 SPY |
| 50–55 | 70/30 SPY |
| 55–60 | 75/25 SPY |
| 60–65 | 80/20 SPY |
| 65+ | 75/25 or 80/20 |

### Optional QQQ Exposure
Take $10K from Treasury sleeve: $8K Treasuries + $2K QQQ LEAPS at 80/20. Small enough that being wrong doesn't matter, large enough that being right compounds.

---

## Why Not QQQ-Only
- Only 2 windows of data vs 38 for SPY
- No stagflation test
- 50/50 QQQ in dot-com window: MAR 0.07 (worse than cash)
- 0.95 correlation with SPY — not true diversification
- At 45 with lump sum, can't afford to be wrong about regime

---

## Geometric Health Assessment

### SPY 65/35 Barbell: 78/100
- Drawdown protection: 22/25
- Crisis alpha: 10/25 (bonds help but 2022 exposed weakness)
- Tax efficiency: 12/20 (annual rolls at short-term rates)
- Regime robustness: 20/20 (67 years, 38 windows, all crises)
- Structural integrity: 14/10 (convexity is real)

### With 15% Managed Futures: 85/100
- Crisis alpha improves to 18/25
- Drawdown protection improves to 24/25

---

## Implementation Notes for WealthEngine

### Engine Modules Already Built
- `src/engine/geometric.js` — MAR, volatility tax, drawdown, crisis alpha, health score
- `src/engine/portfolio.js` — Managed futures asset class, MAR/geometric return
- `src/engine/monteCarlo.js` — Per-path drawdown, MAR distribution, ruin probability
- `src/engine/recommendations.js` — Geometric category recommendations

### Pending UI Work
- Geometric metrics row on dashboard (MAR, volatility tax, median DD, ruin probability)
- Portfolio tab subtitle with MAR and geometric return
- Efficient frontier tooltip with MAR data

### Future Modules to Build
- Barbell backtest engine (run dial across historical data)
- Retirement withdrawal model (38 windows with actual withdrawals)
- Managed futures ensemble optimizer
- Tax-aware return calculator (after-tax CAGR vs pre-tax)
