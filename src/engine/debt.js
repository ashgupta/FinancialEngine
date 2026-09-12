/**
 * Debt payoff optimizer — Avalanche vs Snowball comparison.
 *
 * Avalanche: pay minimums on all, extra goes to highest-interest debt first.
 * Snowball: pay minimums on all, extra goes to smallest-balance debt first.
 */

/**
 * @param {Array<{name:string, balance:number, rate:number, minimum:number}>} debts
 * @param {number} extraPayment - Monthly extra payment beyond minimums
 * @returns {{ avalanche: {months:number, totalInterest:number, schedule:object[]}, snowball: {months:number, totalInterest:number, schedule:object[]} }}
 */
export function compareDebtStrategies(debts, extraPayment) {
  function simulate(debtsInput, sortFn) {
    let active = debtsInput.map((d) => ({ ...d, remaining: d.balance }));
    const schedule = [];
    let totalInterest = 0;
    let month = 0;
    const maxMonths = 600; // safety cap

    while (active.some((d) => d.remaining > 0) && month < maxMonths) {
      month++;
      let extraLeft = extraPayment;

      // Accrue interest
      for (const d of active) {
        if (d.remaining > 0) {
          const interest = d.remaining * (d.rate / 12);
          d.remaining += interest;
          totalInterest += interest;
        }
      }

      // Pay minimums
      for (const d of active) {
        if (d.remaining > 0) {
          const payment = Math.min(d.minimum, d.remaining);
          d.remaining -= payment;
        }
      }

      // Sort and apply extra
      const sorted = active.filter((d) => d.remaining > 0).sort(sortFn);
      for (const d of sorted) {
        if (extraLeft <= 0) break;
        const payment = Math.min(extraLeft, d.remaining);
        d.remaining -= payment;
        extraLeft -= payment;
      }

      const totalRemaining = active.reduce((s, d) => s + Math.max(0, d.remaining), 0);
      schedule.push({ month, totalRemaining: Math.round(totalRemaining) });
    }

    return { months: month, totalInterest: Math.round(totalInterest), schedule };
  }

  const avalanche = simulate(debts, (a, b) => b.rate - a.rate);
  const snowball = simulate(debts, (a, b) => a.remaining - b.remaining);

  return { avalanche, snowball };
}
