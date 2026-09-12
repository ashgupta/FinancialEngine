/**
 * 401(k) Early Withdrawal Calculator.
 *
 * Models federal tax + 10% early withdrawal penalty when withdrawing from
 * a 401(k) before age 59½, accounting for:
 *  - Traditional vs Roth split
 *  - Roth contributions (already taxed) vs earnings (taxable + penalty)
 *  - Pro-rated YTD wage income added to ordinary income
 *  - Progressive federal tax brackets (NOT a flat effective rate)
 *  - Optional state income tax
 *  - Mandatory 20% federal withholding on traditional distributions
 *
 * NOT TAX ADVICE. Consult a CPA before acting.
 */
import { estimateFederalTax, marginalRate } from './tax.js';

export function proRateSalary(annualSalary, asOf = new Date()) {
  const start = new Date(asOf.getFullYear(), 0, 1);
  const end = new Date(asOf.getFullYear() + 1, 0, 1);
  const daysIntoYear = Math.floor((asOf - start) / 86400000);
  const totalDays = Math.round((end - start) / 86400000);
  return Math.round((annualSalary * daysIntoYear) / totalDays);
}

export function calculate401kEarlyWithdrawal({
  totalBalance,
  rothPct,
  rothEarningsPct,
  age,
  ytdSalary,
  filingStatus = 'single',
  stateRate = 0,
}) {
  const rothBalance  = totalBalance * (rothPct / 100);
  const tradBalance  = totalBalance - rothBalance;
  const rothEarnings = rothBalance * (rothEarningsPct / 100);
  const rothContrib  = rothBalance - rothEarnings;

  const isEarly = age < 59.5;
  const penaltyRate = isEarly ? 0.10 : 0;

  // Only traditional + Roth-earnings are taxable; Roth contributions are not.
  const taxableFromWithdrawal = tradBalance + rothEarnings;

  // Progressive bracket math: incremental tax caused by the withdrawal
  const fedTaxSalaryOnly  = estimateFederalTax(ytdSalary, filingStatus);
  const fedTaxWithW       = estimateFederalTax(ytdSalary + taxableFromWithdrawal, filingStatus);
  const incrementalFedTax = fedTaxWithW - fedTaxSalaryOnly;

  const penalty  = isEarly ? taxableFromWithdrawal * penaltyRate : 0;
  const stateTax = taxableFromWithdrawal * stateRate;
  const mandatoryWithholding = tradBalance * 0.20; // reconciled at filing

  const totalDeductions = incrementalFedTax + penalty + stateTax;
  const netReceived     = totalBalance - totalDeductions;

  return {
    breakdown: {
      rothBalance:  Math.round(rothBalance),
      tradBalance:  Math.round(tradBalance),
      rothContrib:  Math.round(rothContrib),
      rothEarnings: Math.round(rothEarnings),
      taxableFromWithdrawal: Math.round(taxableFromWithdrawal),
    },
    federal: {
      taxOnSalaryOnly:      fedTaxSalaryOnly,
      taxOnTotalIncome:     fedTaxWithW,
      incrementalFedTax:    Math.round(incrementalFedTax),
      penalty:              Math.round(penalty),
      mandatoryWithholding: Math.round(mandatoryWithholding),
      marginalRate:         marginalRate(ytdSalary + taxableFromWithdrawal, filingStatus),
    },
    state: { stateTax: Math.round(stateTax), stateRate },
    summary: {
      grossWithdrawal: totalBalance,
      totalDeductions: Math.round(totalDeductions),
      netReceived:     Math.round(netReceived),
      effectiveRate:   +(totalDeductions / totalBalance).toFixed(4),
      taxableIncomeForYear: Math.round(ytdSalary + taxableFromWithdrawal),
      isEarly,
    },
  };
}
