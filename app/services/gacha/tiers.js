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

/** Rolls a tier by odds, then a rule in it. Returns { tier, rule }, or null when the pool is empty. `random` returns [0, 1). */
export function pickReward(pool, random = Math.random) {
  const tiers = Object.keys(GACHA_TIERS).filter((tier) => pool[tier]?.length);
  if (!tiers.length) return null;
  let roll = random() * tiers.reduce((sum, tier) => sum + GACHA_TIERS[tier].odds, 0);
  const tier = tiers.find((t) => (roll -= GACHA_TIERS[t].odds) < 0) ?? tiers.at(-1);
  const rules = pool[tier];
  return { tier, rule: rules[Math.floor(random() * rules.length)] };
}

/** The cards on the reel: random rewards, with `winner` at `winnerIndex`. */
export function buildReel(pool, winner, { length = 50, winnerIndex = 42, random = Math.random } = {}) {
  return Array.from({ length }, (_, i) => (i === winnerIndex ? winner : pickReward(pool, random)));
}
