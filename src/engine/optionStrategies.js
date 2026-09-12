/**
 * Option-strategy detection engine.
 *
 * Groups raw positions into recognised multi-leg strategies based on
 * strike / expiry / option-type / sign-of-quantity patterns.
 *
 * Constitution Principle II: pure functions, no React, no I/O, no DOM.
 *
 * Detected strategies (priority order — most specific first):
 *   - Iron Condor             (4 legs: short put + long lower put + short call + long higher call)
 *   - Iron Butterfly          (4 legs: long put + short ATM put + short ATM call + long call)
 *   - Long / Short Butterfly  (3 legs same type, 1:-2:1)
 *   - Long / Short Straddle   (call + put, same strike, same expiry)
 *   - Long / Short Strangle   (call + put, different strikes, same expiry)
 *   - Vertical Spread         (2 legs same type, same expiry, different strikes)
 *   - Calendar Spread         (2 legs same type, same strike, different expiries)
 *   - Diagonal Spread         (2 legs same type, different strikes AND expiries)
 *   - Covered Call            (long stock + short call same underlying)
 *   - Collar                  (long stock + long protective put + short call)
 *   - Custom multi-leg        (anything else with ≥2 legs)
 *   - Singleton               (1 orphan option leg)
 */

/**
 * @typedef {Object} StrategyGroup
 * @property {string}  id
 * @property {string}  type           machine label e.g. 'bull_call_spread'
 * @property {string}  label          human label e.g. 'Bull Call Spread'
 * @property {string}  underlying
 * @property {string|null} expiry     ISO date (or null for multi-expiry strategies)
 * @property {Position[]} legs
 * @property {number}  netCost        total cost-basis (positive = debit, negative = credit)
 * @property {number}  contractCount  total contracts in absolute value
 *
 * @typedef {Object} StrategyResult
 * @property {StrategyGroup[]} groups       detected strategies, including singletons + non-options
 * @property {number}          optionGroups count of multi-leg option strategies
 */

const sgn = (n) => (n > 0 ? 1 : n < 0 ? -1 : 0);

let _idCounter = 0;
const newId = (prefix) => `${prefix}_${++_idCounter}`;

function makeGroup(type, label, underlying, expiry, legs) {
  const netCost = legs.reduce((s, p) => s + (p.costBasis ?? 0), 0);
  const contractCount = legs.reduce((s, p) => s + Math.abs(p.quantity), 0);
  return {
    id: newId(type),
    type,
    label,
    underlying,
    expiry,
    legs,
    netCost,
    contractCount,
  };
}

// ── Strategy matchers ─────────────────────────────────────────────────────

/** 2 legs, same expiry → straddle / strangle / vertical spread */
function classify2Leg(legs, underlying, expiry) {
  const [a, b] = [...legs].sort((x, y) => (x.strike ?? 0) - (y.strike ?? 0));
  const sameStrike = a.strike === b.strike;
  const sameType = a.optionType === b.optionType;
  const sameSignDir = sgn(a.quantity) === sgn(b.quantity);

  // Straddle / Strangle: call + put combination
  if (!sameType) {
    if (sameStrike) {
      const label = sameSignDir
        ? (a.quantity > 0 ? 'Long Straddle'  : 'Short Straddle')
        : 'Custom Straddle';
      return makeGroup(
        sameSignDir && a.quantity > 0 ? 'long_straddle' :
        sameSignDir && a.quantity < 0 ? 'short_straddle' : 'custom_straddle',
        label, underlying, expiry, legs
      );
    }
    const label = sameSignDir
      ? (a.quantity > 0 ? 'Long Strangle' : 'Short Strangle')
      : 'Custom Strangle';
    return makeGroup(
      sameSignDir && a.quantity > 0 ? 'long_strangle' :
      sameSignDir && a.quantity < 0 ? 'short_strangle' : 'custom_strangle',
      label, underlying, expiry, legs
    );
  }

  // Vertical spread: same type, different strikes, opposite signs
  if (sameType && !sameStrike && !sameSignDir) {
    const lowSign = sgn(a.quantity);
    const highSign = sgn(b.quantity);
    const isCall = a.optionType === 'call';
    let type, label;
    if (isCall) {
      if (lowSign > 0 && highSign < 0) { type = 'bull_call_spread'; label = 'Bull Call Spread'; }
      else                              { type = 'bear_call_spread'; label = 'Bear Call Spread'; }
    } else {
      if (lowSign > 0 && highSign < 0) { type = 'bull_put_spread';  label = 'Bull Put Spread';  }
      else                              { type = 'bear_put_spread';  label = 'Bear Put Spread';  }
    }
    return makeGroup(type, label, underlying, expiry, legs);
  }

  return makeGroup('multi_leg', 'Custom Multi-Leg', underlying, expiry, legs);
}

/** 3 legs, same expiry, all same type → butterfly */
function classify3Leg(legs, underlying, expiry) {
  const types = new Set(legs.map(l => l.optionType));
  if (types.size !== 1) {
    return makeGroup('multi_leg', 'Custom Multi-Leg', underlying, expiry, legs);
  }

  const sorted = [...legs].sort((a, b) => a.strike - b.strike);
  const qty = sorted.map(l => l.quantity);

  // Butterfly: ratio 1:-2:1 (long) or -1:2:-1 (short), strikes equidistant
  const ratio = Math.abs(qty[1]) / Math.max(Math.abs(qty[0]), Math.abs(qty[2]));
  const wingsEqual = Math.abs(qty[0]) === Math.abs(qty[2]);
  const equidistant = Math.abs((sorted[1].strike - sorted[0].strike) -
                               (sorted[2].strike - sorted[1].strike)) < 0.01;

  if (wingsEqual && equidistant && ratio === 2 && sgn(qty[0]) === sgn(qty[2]) && sgn(qty[1]) !== sgn(qty[0])) {
    const isLong = qty[0] > 0; // wings long, body short
    const optKind = sorted[0].optionType === 'call' ? 'Call' : 'Put';
    return makeGroup(
      isLong ? `long_${sorted[0].optionType}_butterfly` : `short_${sorted[0].optionType}_butterfly`,
      `${isLong ? 'Long' : 'Short'} ${optKind} Butterfly`,
      underlying, expiry, legs
    );
  }

  return makeGroup('multi_leg', 'Custom Multi-Leg', underlying, expiry, legs);
}

/** 4 legs, same expiry, 2 calls + 2 puts → iron condor / iron butterfly */
function classify4Leg(legs, underlying, expiry) {
  const calls = legs.filter(l => l.optionType === 'call').sort((a, b) => a.strike - b.strike);
  const puts  = legs.filter(l => l.optionType === 'put').sort((a, b) => a.strike - b.strike);

  if (calls.length !== 2 || puts.length !== 2) {
    return makeGroup('multi_leg', 'Custom Multi-Leg', underlying, expiry, legs);
  }

  // Iron condor: short put (high strike) + long put (low strike) + short call (low strike) + long call (high strike)
  // Iron butterfly: same as condor but the short put strike == short call strike (ATM)
  const [putLow, putHigh] = puts;
  const [callLow, callHigh] = calls;

  const ironPattern =
    putLow.quantity > 0 && putHigh.quantity < 0 &&
    callLow.quantity < 0 && callHigh.quantity > 0 &&
    putHigh.strike <= callLow.strike;

  const reverseIron =
    putLow.quantity < 0 && putHigh.quantity > 0 &&
    callLow.quantity > 0 && callHigh.quantity < 0;

  if (ironPattern || reverseIron) {
    const isButterfly = Math.abs(putHigh.strike - callLow.strike) < 0.01;
    const direction = reverseIron ? 'Reverse ' : '';
    const label = isButterfly ? `${direction}Iron Butterfly` : `${direction}Iron Condor`;
    const type = (reverseIron ? 'reverse_' : '') + (isButterfly ? 'iron_butterfly' : 'iron_condor');
    return makeGroup(type, label, underlying, expiry, legs);
  }

  return makeGroup('multi_leg', 'Custom Multi-Leg', underlying, expiry, legs);
}

/** Calendar / diagonal spread: same type, different expiries */
function classifyCalendar(legs, underlying) {
  if (legs.length !== 2) {
    return makeGroup('multi_leg', 'Multi-Expiry Position', underlying, null, legs);
  }
  const [a, b] = legs;
  if (a.optionType !== b.optionType) {
    return makeGroup('multi_leg', 'Multi-Expiry Position', underlying, null, legs);
  }
  const sameStrike = a.strike === b.strike;
  if (sameStrike) {
    return makeGroup('calendar_spread', 'Calendar Spread', underlying, null, legs);
  }
  return makeGroup('diagonal_spread', 'Diagonal Spread', underlying, null, legs);
}

// ── Main entry point ──────────────────────────────────────────────────────

/**
 * Detect option strategies from a flat list of positions.
 *
 * @param {Position[]} positions
 * @returns {StrategyResult}
 */
export function detectStrategies(positions) {
  _idCounter = 0;
  if (!Array.isArray(positions) || positions.length === 0) {
    return { groups: [], optionGroups: 0 };
  }

  const groups = [];
  const used = new Set();   // indexes consumed by a strategy
  let optionGroupCount = 0;

  // Index positions by underlying
  const byUnderlying = new Map();
  positions.forEach((p, idx) => {
    const key = p.isOption ? (p.underlying || p.symbol) : p.symbol;
    if (!byUnderlying.has(key)) byUnderlying.set(key, []);
    byUnderlying.get(key).push({ pos: p, idx });
  });

  for (const [underlying, entries] of byUnderlying) {
    const stockLegs = entries.filter(e => !e.pos.isOption && e.pos.classification !== 'cash');
    const optionLegs = entries.filter(e => e.pos.isOption);

    // ── Stock + option combinations ──────────────────────────────────────
    if (stockLegs.length > 0 && optionLegs.length > 0) {
      const longStock = stockLegs.find(e => e.pos.quantity > 0);
      if (longStock) {
        const shortCalls = optionLegs.filter(e => e.pos.optionType === 'call' && e.pos.quantity < 0);
        const longPuts   = optionLegs.filter(e => e.pos.optionType === 'put'  && e.pos.quantity > 0);

        // Collar = long stock + long put + short call (same expiry pair)
        for (const sc of shortCalls) {
          const lp = longPuts.find(e => e.pos.expiry === sc.pos.expiry && !used.has(e.idx));
          if (lp && !used.has(sc.idx)) {
            const legs = [longStock.pos, lp.pos, sc.pos];
            groups.push(makeGroup('collar', 'Collar', underlying, sc.pos.expiry, legs));
            used.add(longStock.idx); used.add(lp.idx); used.add(sc.idx);
            optionGroupCount++;
            break;
          }
        }

        // Covered call = long stock + short call (no put pairing left)
        if (!used.has(longStock.idx)) {
          const sc = shortCalls.find(e => !used.has(e.idx));
          if (sc) {
            groups.push(makeGroup('covered_call', 'Covered Call', underlying, sc.pos.expiry, [longStock.pos, sc.pos]));
            used.add(longStock.idx); used.add(sc.idx);
            optionGroupCount++;
          }
        }
      }
    }

    // ── Pure option strategies, grouped by expiry ────────────────────────
    const remainingOpts = optionLegs.filter(e => !used.has(e.idx));
    const byExpiry = new Map();
    for (const e of remainingOpts) {
      const k = e.pos.expiry || '_no_expiry';
      if (!byExpiry.has(k)) byExpiry.set(k, []);
      byExpiry.get(k).push(e);
    }

    for (const [expiry, expiryLegs] of byExpiry) {
      const legs = expiryLegs.map(e => e.pos);
      const exp = expiry === '_no_expiry' ? null : expiry;

      let group = null;
      if (legs.length === 4)      group = classify4Leg(legs, underlying, exp);
      else if (legs.length === 3) group = classify3Leg(legs, underlying, exp);
      else if (legs.length === 2) group = classify2Leg(legs, underlying, exp);

      if (group) {
        groups.push(group);
        expiryLegs.forEach(e => used.add(e.idx));
        if (legs.length >= 2) optionGroupCount++;
      }
    }

    // ── Cross-expiry pairs (calendars / diagonals) ───────────────────────
    const stillRemaining = optionLegs.filter(e => !used.has(e.idx));
    if (stillRemaining.length === 2) {
      const grp = classifyCalendar(stillRemaining.map(e => e.pos), underlying);
      groups.push(grp);
      stillRemaining.forEach(e => used.add(e.idx));
      optionGroupCount++;
    }
  }

  // ── Singletons (everything not consumed) ────────────────────────────────
  positions.forEach((p, idx) => {
    if (used.has(idx)) return;
    const key = p.isOption ? (p.underlying || p.symbol) : p.symbol;
    const exp = p.isOption ? p.expiry : null;
    const isLong = p.quantity >= 0;
    let label, type;
    if (p.isOption) {
      label = `${isLong ? 'Long' : 'Short'} ${p.optionType === 'call' ? 'Call' : 'Put'}`;
      type = `single_${p.optionType}`;
    } else if (p.classification === 'cash') {
      label = 'Cash'; type = 'cash';
    } else {
      label = isLong ? 'Long Stock' : 'Short Stock';
      type = `single_${p.classification}`;
    }
    groups.push(makeGroup(type, label, key, exp, [p]));
  });

  return { groups, optionGroups: optionGroupCount };
}
