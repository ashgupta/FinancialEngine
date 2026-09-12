/**
 * Tax-optimization recommendation engine.
 * Provides actionable strategies based on income, filing status, and account types.
 */

const BRACKETS_2024_SINGLE = [
  { min: 0,       max: 11600,   rate: 0.10 },
  { min: 11600,   max: 47150,   rate: 0.12 },
  { min: 47150,   max: 100525,  rate: 0.22 },
  { min: 100525,  max: 191950,  rate: 0.24 },
  { min: 191950,  max: 243725,  rate: 0.32 },
  { min: 243725,  max: 609350,  rate: 0.35 },
  { min: 609350,  max: Infinity, rate: 0.37 },
];

const BRACKETS_2024_MARRIED = [
  { min: 0,       max: 23200,   rate: 0.10 },
  { min: 23200,   max: 94300,   rate: 0.12 },
  { min: 94300,   max: 201050,  rate: 0.22 },
  { min: 201050,  max: 383900,  rate: 0.24 },
  { min: 383900,  max: 487450,  rate: 0.32 },
  { min: 487450,  max: 731200,  rate: 0.35 },
  { min: 731200,  max: Infinity, rate: 0.37 },
];

export function estimateFederalTax(income, filingStatus = 'single') {
  const brackets = filingStatus === 'married' ? BRACKETS_2024_MARRIED : BRACKETS_2024_SINGLE;
  let tax = 0;
  let remaining = income;
  for (const b of brackets) {
    const taxable = Math.min(remaining, b.max - b.min);
    if (taxable <= 0) break;
    tax += taxable * b.rate;
    remaining -= taxable;
  }
  return Math.round(tax);
}

export function marginalRate(income, filingStatus = 'single') {
  const brackets = filingStatus === 'married' ? BRACKETS_2024_MARRIED : BRACKETS_2024_SINGLE;
  for (const b of brackets) {
    if (income <= b.max) return b.rate;
  }
  return 0.37;
}

/**
 * Generate personalized tax optimization strategies.
 */
export function getTaxStrategies(income, filingStatus, age, has401k, hasHSA, hasIRA) {
  const strategies = [];
  const rate = marginalRate(income, filingStatus);

  // 401k
  const max401k = age >= 50 ? 30500 : 23000;
  if (has401k) {
    const savings = Math.round(max401k * rate);
    strategies.push({
      title: 'Max out 401(k) contributions',
      description: `Contribute $${max401k.toLocaleString()}/yr (${age >= 50 ? 'incl. catch-up' : 'under 50'}) to reduce taxable income by up to $${savings.toLocaleString()} in taxes at your ${(rate*100).toFixed(0)}% marginal rate.`,
      impact: savings,
      priority: 'high',
    });
  }

  // IRA / Roth IRA
  const maxIRA = age >= 50 ? 8000 : 7000;
  if (hasIRA) {
    if (income > 161000) {
      strategies.push({
        title: 'Backdoor Roth IRA',
        description: `Your income exceeds Roth IRA limits. Contribute $${maxIRA.toLocaleString()} to a traditional IRA then convert to Roth for tax-free growth.`,
        impact: Math.round(maxIRA * 0.05 * 30), // rough 30-yr compounding benefit
        priority: 'high',
      });
    } else {
      strategies.push({
        title: 'Contribute to Roth IRA',
        description: `Max out $${maxIRA.toLocaleString()}/yr for tax-free growth and withdrawals in retirement.`,
        impact: Math.round(maxIRA * 0.05 * 30),
        priority: 'high',
      });
    }
  }

  // HSA
  if (hasHSA) {
    const maxHSA = filingStatus === 'married' ? 8300 : 4150;
    const hsaSavings = Math.round(maxHSA * rate);
    strategies.push({
      title: 'Max out HSA (triple tax advantage)',
      description: `Contribute $${maxHSA.toLocaleString()}/yr — deductible going in, grows tax-free, and withdrawals for medical are tax-free. Save ~$${hsaSavings.toLocaleString()}/yr.`,
      impact: hsaSavings,
      priority: 'high',
    });
  }

  // Tax-loss harvesting
  strategies.push({
    title: 'Tax-loss harvesting',
    description: `Sell losing positions to offset gains. Up to $3,000/yr of excess losses can offset ordinary income, saving ~$${Math.round(3000 * rate).toLocaleString()}.`,
    impact: Math.round(3000 * rate),
    priority: 'medium',
  });

  // Asset location
  strategies.push({
    title: 'Asset location optimization',
    description: 'Hold bonds and REITs in tax-deferred accounts; keep equities and growth assets in taxable accounts for lower capital gains rates.',
    impact: 0,
    priority: 'medium',
  });

  // Charitable
  if (income > 200000) {
    strategies.push({
      title: 'Donor-Advised Fund (DAF)',
      description: 'Bunch multiple years of charitable giving into one year to exceed the standard deduction and itemize, then distribute grants over time.',
      impact: Math.round(10000 * rate),
      priority: 'low',
    });
  }

  return strategies.sort((a, b) => {
    const pri = { high: 0, medium: 1, low: 2 };
    return pri[a.priority] - pri[b.priority] || b.impact - a.impact;
  });
}
