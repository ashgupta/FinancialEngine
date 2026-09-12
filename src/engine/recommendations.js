/**
 * Master recommendation engine.
 * Takes all user inputs and produces a prioritized list of actionable recommendations
 * across saving, investing, debt, tax, and protection.
 */

export function generateRecommendations({
  age,
  income,
  expenses,
  savings,
  annualSavings,
  debts,
  riskTolerance,
  has401k,
  hasHSA,
  hasIRA,
  hasEmergencyFund,
  emergencyFundMonths,
  filingStatus,
}) {
  const recs = [];

  // Emergency fund check
  const monthlyExpenses = expenses / 12;
  const idealEmergency = monthlyExpenses * 6;
  if (!hasEmergencyFund || emergencyFundMonths < 3) {
    recs.push({
      category: 'Foundation',
      title: 'Build emergency fund',
      description: `Aim for 3-6 months of expenses ($${Math.round(monthlyExpenses * 3).toLocaleString()}–$${Math.round(idealEmergency).toLocaleString()}) in a high-yield savings account before aggressive investing.`,
      priority: 1,
      icon: 'Shield',
    });
  } else if (emergencyFundMonths < 6) {
    recs.push({
      category: 'Foundation',
      title: 'Top up emergency fund',
      description: `You have ${emergencyFundMonths} months saved. Consider building to 6 months ($${Math.round(idealEmergency).toLocaleString()}).`,
      priority: 3,
      icon: 'Shield',
    });
  }

  // High-interest debt
  const highInterestDebts = (debts || []).filter((d) => d.rate > 0.07);
  if (highInterestDebts.length > 0) {
    const total = highInterestDebts.reduce((s, d) => s + d.balance, 0);
    recs.push({
      category: 'Debt',
      title: 'Eliminate high-interest debt',
      description: `You have $${total.toLocaleString()} in high-interest debt (>${7}% APR). Pay this off before investing — guaranteed "return" equal to the interest rate.`,
      priority: 1,
      icon: 'TrendingDown',
    });
  }

  // Savings rate
  const savingsRate = income > 0 ? (annualSavings / income) * 100 : 0;
  if (savingsRate < 15) {
    recs.push({
      category: 'Saving',
      title: 'Increase savings rate',
      description: `Your savings rate is ${savingsRate.toFixed(1)}%. Target at least 15-20% for standard retirement; 50%+ for early retirement (FIRE).`,
      priority: 2,
      icon: 'PiggyBank',
    });
  } else if (savingsRate >= 50) {
    recs.push({
      category: 'Saving',
      title: 'Excellent savings rate!',
      description: `At ${savingsRate.toFixed(1)}%, you're on track for early financial independence. Ensure it's deployed efficiently across tax-advantaged accounts.`,
      priority: 5,
      icon: 'Sparkles',
    });
  }

  // 401k employer match
  if (has401k) {
    recs.push({
      category: 'Investing',
      title: 'Capture full 401(k) employer match',
      description: 'Always contribute enough to get 100% of any employer match — it\'s an immediate 50-100% return on your money.',
      priority: 1,
      icon: 'Gift',
    });
  }

  // Diversification based on age
  if (age < 35 && riskTolerance < 5) {
    recs.push({
      category: 'Investing',
      title: 'Consider higher equity allocation',
      description: `At age ${age} with 30+ years to retirement, you can tolerate more volatility for higher long-term returns. Consider increasing risk tolerance.`,
      priority: 3,
      icon: 'TrendingUp',
    });
  }
  if (age > 55 && riskTolerance > 7) {
    recs.push({
      category: 'Investing',
      title: 'Consider de-risking portfolio',
      description: `At age ${age}, consider shifting toward bonds and stable assets to protect your accumulated wealth as you approach withdrawal phase.`,
      priority: 2,
      icon: 'ShieldCheck',
    });
  }

  // Roth conversion ladder
  if (age > 40 && income < 100000) {
    recs.push({
      category: 'Tax',
      title: 'Plan Roth conversion ladder',
      description: 'If planning early retirement, start converting traditional IRA/401(k) to Roth in low-income years to minimize future tax burden.',
      priority: 4,
      icon: 'ArrowUpRight',
    });
  }

  // Insurance / protection
  if (income > 75000) {
    recs.push({
      category: 'Protection',
      title: 'Review insurance coverage',
      description: 'Ensure you have adequate term life insurance (10-12x income), disability insurance (60-70% income replacement), and umbrella liability coverage.',
      priority: 4,
      icon: 'Umbrella',
    });
  }

  // Estate planning
  if (savings > 500000 || age > 45) {
    recs.push({
      category: 'Protection',
      title: 'Estate planning',
      description: 'Create or update your will, establish beneficiary designations, and consider a revocable living trust to avoid probate.',
      priority: 5,
      icon: 'FileText',
    });
  }

  // I-bonds / TIPS for near-term savings
  if (savings < 100000 && age > 50) {
    recs.push({
      category: 'Investing',
      title: 'Consider I-Bonds / TIPS for stability',
      description: 'Allocate a portion to inflation-protected securities for capital preservation while still beating inflation.',
      priority: 3,
      icon: 'Lock',
    });
  }

  // ── Geometry of Wealth: Drawdown Protection ──────────────────
  // Warn if portfolio is 100% equities (no crisis alpha source)
  if (riskTolerance >= 7 && age > 40) {
    recs.push({
      category: 'Geometric',
      title: 'Add crisis alpha to your portfolio',
      description: 'A 50% drawdown destroys 54% of terminal wealth (not 50% — it also destroys future compounding). Allocate 15-40% to Managed Futures / Trend Following (DBMF) for negative equity correlation and crisis alpha. The blend produces MORE terminal wealth than either component alone.',
      priority: 2,
      icon: 'Shield',
    });
  }

  // Drawdown awareness for aggressive portfolios
  if (riskTolerance >= 8) {
    recs.push({
      category: 'Geometric',
      title: 'Monitor your MAR ratio, not just Sharpe',
      description: 'Sharpe ratio treats upside and downside volatility equally and cannot distinguish a -21% drawdown from a -51% drawdown. Track MAR (CAGR ÷ Max Drawdown). S&P 500 MAR: 0.157. A portfolio with MAR >0.25 and positive skew is geometrically efficient.',
      priority: 3,
      icon: 'BarChart3',
    });
  }

  // Volatility tax warning for high-vol portfolios
  if (riskTolerance >= 9) {
    recs.push({
      category: 'Geometric',
      title: 'Watch the volatility tax',
      description: 'At high volatility, the gap between arithmetic and geometric returns widens dramatically. The tax ≈ ½σ² — at 30% vol, you lose 4.5%/yr to geometric drag. Never use leverage to manufacture returns: doubling leverage quadruples the tax and MAR actually falls.',
      priority: 3,
      icon: 'TrendingDown',
    });
  }

  // Patience cost warning
  if (riskTolerance >= 6) {
    recs.push({
      category: 'Geometric',
      title: 'Prepare for the patience cost',
      description: 'Any strategy that protects during crises will underperform during bull markets. Trend following underperforms in 68.7% of rolling 3-year windows. This is the insurance premium — not evidence the strategy is broken. Set your allocation and maintain it mechanically. Never abandon during underperformance.',
      priority: 4,
      icon: 'Clock',
    });
  }

  // Diversification: wide net
  const hasCommoditiesOrTF = false; // simplified — in real implementation check actual allocation
  if (riskTolerance >= 5 && !hasCommoditiesOrTF) {
    recs.push({
      category: 'Geometric',
      title: 'Cast a wider net across asset classes',
      description: 'The best 10% of months account for ~91% of terminal wealth. You cannot predict where the next outlier will be. Diversify across equities, bonds, currencies, commodities, and managed futures. A narrow portfolio catches twigs. A broad portfolio catches trunks.',
      priority: 3,
      icon: 'Globe',
    });
  }

  // Position sizing for self-directed investors
  if (riskTolerance >= 7) {
    recs.push({
      category: 'Geometric',
      title: 'Keep position sizes small — survival is the architecture of wealth',
      description: 'Risk no more than 0.5-1% of capital per trade. 61.5% of trend following terminal wealth comes from just 20% of months (crisis periods). The only way to capture those months is to still be alive when they arrive. Small bets. No single trade can end the game.',
      priority: 3,
      icon: 'Layers',
    });
  }

  // Automation
  recs.push({
    category: 'Behavior',
    title: 'Automate investing',
    description: 'Set up automatic monthly transfers to investment accounts on payday. Automation removes emotion and ensures consistency.',
    priority: 4,
    icon: 'Repeat',
  });

  return recs.sort((a, b) => a.priority - b.priority);
}
