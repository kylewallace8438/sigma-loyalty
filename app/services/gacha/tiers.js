// Shared by server code and route components (no `.server` suffix so it can reach the browser bundle).

// Rarity tiers, from most to least common. `odds` are relative weights (they add up to 100 here).
// A tier with no rules is skipped and its share goes to the others; see effectiveOdds.
export const GACHA_TIERS = {
  WHITE: { label: "White", odds: 80, color: "#b0c3d9" },
  PURPLE: { label: "Purple", odds: 16, color: "#8847ff" },
  GOLD: { label: "Gold", odds: 4, color: "#e4ae39" },
};

/** Groups rules into { WHITE: [...], PURPLE: [...], GOLD: [...] } by their `tier`. */
export function buildPool(rules) {
  const pool = Object.fromEntries(Object.keys(GACHA_TIERS).map((tier) => [tier, []]));
  for (const rule of rules) if (pool[rule.tier]) pool[rule.tier].push(rule);
  return pool;
}

/** Chance of each tier in percent (0 for a tier with no rules). */
export function effectiveOdds(pool) {
  const total = Object.keys(GACHA_TIERS)
    .filter((tier) => pool[tier]?.length)
    .reduce((sum, tier) => sum + GACHA_TIERS[tier].odds, 0);
  return Object.fromEntries(
    Object.entries(GACHA_TIERS).map(([tier, { odds }]) => [
      tier,
      total && pool[tier]?.length ? (odds / total) * 100 : 0,
    ]),
  );
}

/**
 * Rolls a tier by odds, then a rule in it. Returns { tier, rule }, or null when the pool is empty. `random` returns [0, 1).
 * With `minTier`, only that tier and the ones above it are rolled (by their odds relative to each other).
 */
export function pickReward(pool, random = Math.random, minTier = "WHITE") {
  const tiers = Object.keys(GACHA_TIERS)
    .slice(Object.keys(GACHA_TIERS).indexOf(minTier))
    .filter((tier) => pool[tier]?.length);
  if (!tiers.length) return null;
  let roll = random() * tiers.reduce((sum, tier) => sum + GACHA_TIERS[tier].odds, 0);
  const tier = tiers.find((t) => (roll -= GACHA_TIERS[t].odds) < 0) ?? tiers.at(-1);
  const rules = pool[tier];
  return { tier, rule: rules[Math.floor(random() * rules.length)] };
}

export const MAX_PITY = 1000;

/** Rolls since the last Gold item and since the last Purple-or-better item. */
export const NO_ROLLS = { sinceGold: 0, sincePurple: 0 };

/**
 * One roll with guarantees. `pity` is { gold, purple }: the most rolls it may take to get that tier
 * (Purple: or better), null for no guarantee. When the next roll is the last one allowed, it is
 * rolled from that tier up. A guarantee whose tiers have no rules is skipped.
 * Returns { reward, counters, guaranteed } (reward null for an empty pool).
 */
export function rollWithPity(pool, pity = {}, counters = NO_ROLLS, random = Math.random) {
  const due = (limit, since) => Boolean(limit) && since + 1 >= limit;
  let minTier = "WHITE";
  if (due(pity.gold, counters.sinceGold) && pool.GOLD?.length) minTier = "GOLD";
  else if (due(pity.purple, counters.sincePurple) && (pool.PURPLE?.length || pool.GOLD?.length)) minTier = "PURPLE";

  const reward = pickReward(pool, random, minTier);
  if (!reward) return { reward, counters, guaranteed: false };
  return {
    reward,
    guaranteed: minTier !== "WHITE",
    counters: {
      sinceGold: reward.tier === "GOLD" ? 0 : counters.sinceGold + 1,
      sincePurple: reward.tier === "WHITE" ? counters.sincePurple + 1 : 0,
    },
  };
}

/**
 * Checks the guarantee fields as typed ({ goldPity, purplePity } strings; empty = no guarantee).
 * Returns { pity: { gold, purple }, errors } where invalid fields are null in `pity`.
 */
export function validatePity(values) {
  const pity = { gold: null, purple: null };
  const errors = {};
  for (const [field, key] of [["goldPity", "gold"], ["purplePity", "purple"]]) {
    const raw = String(values[field] ?? "").trim();
    if (!raw) continue;
    const n = Number(raw);
    if (!Number.isInteger(n) || n < 2 || n > MAX_PITY) {
      errors[field] = `Enter a whole number from 2 to ${MAX_PITY}, or leave empty.`;
    } else pity[key] = n;
  }
  if (pity.gold && pity.purple && pity.purple >= pity.gold) {
    errors.purplePity = "Must be fewer rolls than the Gold guarantee.";
    pity.purple = null;
  }
  return { pity, errors };
}

/** The cards on the reel: random rewards, with `winner` at `winnerIndex`. */
export function buildReel(pool, winner, { length = 50, winnerIndex = 42, random = Math.random } = {}) {
  return Array.from({ length }, (_, i) => (i === winnerIndex ? winner : pickReward(pool, random)));
}
