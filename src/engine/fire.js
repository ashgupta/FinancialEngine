/**
 * FIRE (Financial Independence, Retire Early) calculator.
 * Uses the 4% safe withdrawal rate (Trinity Study) and builds a year-by-year
 * projection toward financial independence.
 */

/**
 * @param {object} params
 * @param {number} params.currentAge
 * @param {number} params.annualExpenses - Current annual living expenses
 * @param {number} params.currentSavings - Current invested assets
 * @param {number} params.annualSavings - How much you save/invest per year
 * @param {number} params.realReturn - Expected real (after-inflation) return (decimal)
 * @param {number} params.withdrawalRate - Safe withdrawal rate (default 0.04)
 * @param {number} params.maxAge - Project until this age (default 90)
 * @returns {{ fireNumber:number, fireAge:number|null, yearByYear:object[], coastFireAge:number|null, coastFireNumber:number }}
 */
export function calculateFIRE({
  currentAge,
  annualExpenses,
  currentSavings,
  annualSavings,
  realReturn = 0.05,
  withdrawalRate = 0.04,
  maxAge = 90,
}) {
  const fireNumber = annualExpenses / withdrawalRate;
  const years = maxAge - currentAge;

  const yearByYear = [];
  let balance = currentSavings;
  let fireAge = null;

  for (let y = 0; y <= years; y++) {
    const age = currentAge + y;
    if (y > 0) {
      balance = balance * (1 + realReturn) + annualSavings;
    }
    const progress = Math.min(100, (balance / fireNumber) * 100);
    yearByYear.push({
      age,
      year: y,
      balance: Math.round(balance),
      fireNumber: Math.round(fireNumber),
      progress: +progress.toFixed(1),
    });
    if (balance >= fireNumber && fireAge === null) {
      fireAge = age;
    }
  }

  // Coast FIRE: the age at which, if you stop saving entirely, your current
  // balance will grow to the FIRE number by age 65
  const targetRetireAge = 65;
  let coastFireAge = null;
  let coastFireNumber = 0;
  {
    let bal = currentSavings;
    for (let y = 0; y <= targetRetireAge - currentAge; y++) {
      const age = currentAge + y;
      const yearsLeft = targetRetireAge - age;
      const needed = fireNumber / Math.pow(1 + realReturn, yearsLeft);
      if (bal >= needed && coastFireAge === null) {
        coastFireAge = age;
        coastFireNumber = Math.round(needed);
      }
      bal = bal * (1 + realReturn) + annualSavings;
    }
  }

  return { fireNumber: Math.round(fireNumber), fireAge, yearByYear, coastFireAge, coastFireNumber };
}

/**
 * Calculate savings rate.
 */
export function savingsRate(annualIncome, annualSavings) {
  if (annualIncome <= 0) return 0;
  return +(annualSavings / annualIncome * 100).toFixed(1);
}
