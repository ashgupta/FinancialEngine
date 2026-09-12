/**
 * 401(k) Allocation Planner.
 *
 * Given a user's editable fund menu and a target asset-class allocation
 * (typically from engine/portfolio.js::getRecommendedAllocation), produce an
 * optimal allocation across the available funds with these properties:
 *
 *  1. Asset-class weights match the target as closely as possible.
 *  2. When multiple funds map to the same asset class, pick the LOWEST-cost one.
 *  3. If a target asset class is missing from the menu, redistribute its weight
 *     to the nearest available substitute (defined in FALLBACK_MAP).
 *  4. Returns a per-fund recommended %, the weighted expense ratio, and
 *     diagnostic info about substitutions made.
 */

import { getRecommendedAllocation } from './portfolio.js';

// When a target asset class is unavailable in the 401(k) menu, redirect its
// weight to the first available substitute in this list.
const FALLBACK_MAP = {
  us_equity:    ['us_equity'],
  intl_equity:  ['intl_equity', 'us_equity'],
  us_bonds:     ['us_bonds', 'tips', 'cash'],
  intl_bonds:   ['intl_bonds', 'us_bonds', 'tips', 'cash'],
  tips:         ['tips', 'us_bonds', 'cash'],
  real_estate:  ['real_estate', 'us_equity'],
  commodities:  ['commodities', 'real_estate', 'us_equity'],
  cash:         ['cash', 'us_bonds'],
};

/**
 * @param {Array<{ticker:string,name:string,assetClass:string,expenseRatio:number}>} fundMenu
 * @param {number} riskTolerance 1–10
 * @returns {{
 *   allocation: Array<{ticker,name,assetClass,expenseRatio,weight,targetClassWeight}>,
 *   weightedExpenseRatio: number,
 *   targetClassWeights: Record<string,number>,
 *   realizedClassWeights: Record<string,number>,
 *   substitutions: Array<{from:string,to:string,weight:number}>,
 *   missingClasses: string[],
 * }}
 */
export function buildK401Allocation(fundMenu, riskTolerance) {
  if (!Array.isArray(fundMenu) || fundMenu.length === 0) {
    return {
      allocation: [], weightedExpenseRatio: 0,
      targetClassWeights: {}, realizedClassWeights: {},
      substitutions: [], missingClasses: [],
    };
  }

  // Target asset-class weights from the existing MPT model
  const target = getRecommendedAllocation(riskTolerance);
  const targetClassWeights = target.allocation.reduce((acc, a) => {
    acc[a.id] = (acc[a.id] ?? 0) + a.weight;
    return acc;
  }, {});

  // Group funds by asset class
  const byClass = fundMenu.reduce((acc, f) => {
    (acc[f.assetClass] = acc[f.assetClass] ?? []).push(f);
    return acc;
  }, {});

  // For each available class, pick the cheapest fund
  const cheapestByClass = {};
  for (const [cls, funds] of Object.entries(byClass)) {
    cheapestByClass[cls] = [...funds].sort((a, b) => a.expenseRatio - b.expenseRatio)[0];
  }

  // Resolve each target class into the menu (with fallback if missing)
  const finalWeights = {}; // ticker -> { fund, weight }
  const substitutions = [];
  const missingClasses = [];

  for (const [targetClass, weight] of Object.entries(targetClassWeights)) {
    if (weight <= 0) continue;
    const fallbackChain = FALLBACK_MAP[targetClass] ?? [targetClass];
    let resolvedClass = null;
    for (const candidate of fallbackChain) {
      if (cheapestByClass[candidate]) { resolvedClass = candidate; break; }
    }
    if (!resolvedClass) {
      missingClasses.push(targetClass);
      continue;
    }
    if (resolvedClass !== targetClass) {
      substitutions.push({ from: targetClass, to: resolvedClass, weight });
    }
    const fund = cheapestByClass[resolvedClass];
    if (!finalWeights[fund.ticker]) {
      finalWeights[fund.ticker] = { fund, weight: 0 };
    }
    finalWeights[fund.ticker].weight += weight;
  }

  // Re-normalize if we lost weight to truly-missing classes
  const totalAssigned = Object.values(finalWeights).reduce((s, x) => s + x.weight, 0);
  if (totalAssigned > 0 && Math.abs(totalAssigned - 1) > 0.001) {
    for (const k of Object.keys(finalWeights)) {
      finalWeights[k].weight = finalWeights[k].weight / totalAssigned;
    }
  }

  const allocation = Object.values(finalWeights).map(({ fund, weight }) => ({
    ...fund,
    weight,
  })).sort((a, b) => b.weight - a.weight);

  const weightedExpenseRatio = allocation.reduce((s, a) => s + a.weight * a.expenseRatio, 0);

  const realizedClassWeights = allocation.reduce((acc, a) => {
    acc[a.assetClass] = (acc[a.assetClass] ?? 0) + a.weight;
    return acc;
  }, {});

  return {
    allocation,
    weightedExpenseRatio,
    targetClassWeights,
    realizedClassWeights,
    substitutions,
    missingClasses,
  };
}

/**
 * Compute rebalance trades given a target allocation and current dollar holdings.
 * @param {Array<{ticker,weight}>} targetAllocation - weights 0–1
 * @param {Record<string, number>} currentHoldings  - ticker → $ value
 * @param {number} totalValue - total account value
 */
export function computeRebalance(targetAllocation, currentHoldings, totalValue) {
  const trades = [];
  for (const a of targetAllocation) {
    const targetDollars = totalValue * a.weight;
    const currentDollars = currentHoldings[a.ticker] ?? 0;
    const delta = targetDollars - currentDollars;
    trades.push({
      ticker: a.ticker,
      name: a.name,
      action: delta > 0 ? 'BUY' : delta < 0 ? 'SELL' : 'HOLD',
      amount: Math.abs(delta),
      currentDollars,
      targetDollars,
    });
  }
  // Tickers held but not in target → sell entirely
  for (const [ticker, amount] of Object.entries(currentHoldings)) {
    if (!targetAllocation.some(t => t.ticker === ticker)) {
      trades.push({
        ticker, name: ticker, action: 'SELL',
        amount, currentDollars: amount, targetDollars: 0,
      });
    }
  }
  return trades.sort((a, b) => b.amount - a.amount);
}
