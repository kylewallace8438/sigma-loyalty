import { describe, expect, it } from "vitest";
import { buildPool, buildReel, effectiveOdds, pickReward, rollWithPity, validatePity } from "../../../app/services/gacha/tiers";

const rule = (id, tier) => ({ id, title: `Rule ${id}`, tier });
const pool = buildPool([rule(1, "WHITE"), rule(2, "WHITE"), rule(3, "PURPLE"), rule(4, "GOLD"), rule(5, "")]);
// Deterministic `random` returning the given values in turn.
const seq = (...values) => () => values.shift();

describe("buildPool", () => {
  it("groups rules by tier and leaves out rules without one", () => {
    expect(pool.WHITE.map((r) => r.id)).toEqual([1, 2]);
    expect(pool.PURPLE.map((r) => r.id)).toEqual([3]);
    expect(pool.GOLD.map((r) => r.id)).toEqual([4]);
  });
});

describe("effectiveOdds", () => {
  it("uses the configured odds when every tier has rules", () => {
    expect(effectiveOdds(pool)).toEqual({ WHITE: 80, PURPLE: 16, GOLD: 4 });
  });

  it("gives an empty tier's share to the others", () => {
    const odds = effectiveOdds(buildPool([rule(1, "WHITE"), rule(4, "GOLD")]));
    expect(odds.PURPLE).toBe(0);
    expect(odds.WHITE).toBeCloseTo(95.24, 2);
    expect(odds.GOLD).toBeCloseTo(4.76, 2);
  });

  it("is all zero for an empty pool", () => {
    expect(effectiveOdds(buildPool([]))).toEqual({ WHITE: 0, PURPLE: 0, GOLD: 0 });
  });
});

describe("pickReward", () => {
  it("rolls the tier by odds, then a rule within it", () => {
    expect(pickReward(pool, seq(0.79, 0.5))).toEqual({ tier: "WHITE", rule: pool.WHITE[1] });
    expect(pickReward(pool, seq(0.8, 0))).toEqual({ tier: "PURPLE", rule: pool.PURPLE[0] });
    expect(pickReward(pool, seq(0.96, 0))).toEqual({ tier: "GOLD", rule: pool.GOLD[0] });
  });

  it("skips empty tiers", () => {
    const goldOnly = buildPool([rule(4, "GOLD")]);
    expect(pickReward(goldOnly, seq(0, 0)).tier).toBe("GOLD");
  });

  it("returns null for an empty pool", () => {
    expect(pickReward(buildPool([]))).toBeNull();
  });
});

describe("buildReel", () => {
  it("puts the winner at winnerIndex among random cards", () => {
    const winner = { tier: "GOLD", rule: pool.GOLD[0] };
    const reel = buildReel(pool, winner, { length: 10, winnerIndex: 7 });

    expect(reel).toHaveLength(10);
    expect(reel[7]).toBe(winner);
    expect(reel.every((card) => card.rule && card.tier)).toBe(true);
  });
});

describe("pickReward with minTier", () => {
  it("rolls only that tier and the ones above, by their relative odds", () => {
    // PURPLE 16 + GOLD 4 = 20: 0.79 * 20 = 15.8 is Purple, 0.8 * 20 = 16 is Gold.
    expect(pickReward(pool, seq(0.79, 0), "PURPLE").tier).toBe("PURPLE");
    expect(pickReward(pool, seq(0.8, 0), "PURPLE").tier).toBe("GOLD");
    expect(pickReward(pool, seq(0, 0), "GOLD").tier).toBe("GOLD");
  });
});

describe("rollWithPity", () => {
  const pity = { gold: 10, purple: 3 };
  const white = () => 0; // always rolls White when nothing is due

  it("rolls normally and counts the rolls when nothing is due", () => {
    const roll = rollWithPity(pool, pity, { sinceGold: 0, sincePurple: 0 }, white);
    expect(roll).toMatchObject({ reward: { tier: "WHITE" }, guaranteed: false, counters: { sinceGold: 1, sincePurple: 1 } });
  });

  it("gives Purple or better on the last roll of the Purple guarantee", () => {
    const roll = rollWithPity(pool, pity, { sinceGold: 2, sincePurple: 2 }, white);
    expect(roll).toMatchObject({ reward: { tier: "PURPLE" }, guaranteed: true, counters: { sinceGold: 3, sincePurple: 0 } });
  });

  it("gives Gold on the last roll of the Gold guarantee, resetting both counts", () => {
    const roll = rollWithPity(pool, pity, { sinceGold: 9, sincePurple: 2 }, white);
    expect(roll).toMatchObject({ reward: { tier: "GOLD" }, guaranteed: true, counters: { sinceGold: 0, sincePurple: 0 } });
  });

  it("never goes past the guarantees over many rolls", () => {
    let counters = { sinceGold: 0, sincePurple: 0 };
    let maxGold = 0;
    let maxPurple = 0;
    for (let i = 0; i < 500; i++) {
      ({ counters } = rollWithPity(pool, pity, counters, white));
      maxGold = Math.max(maxGold, counters.sinceGold);
      maxPurple = Math.max(maxPurple, counters.sincePurple);
    }
    expect(maxGold).toBe(9);
    expect(maxPurple).toBe(2);
  });

  it("skips a guarantee whose tiers have no rules", () => {
    const whiteOnly = buildPool([rule(1, "WHITE")]);
    const roll = rollWithPity(whiteOnly, pity, { sinceGold: 9, sincePurple: 2 }, white);
    expect(roll).toMatchObject({ reward: { tier: "WHITE" }, guaranteed: false });
  });

  it("rolls normally without guarantees", () => {
    expect(rollWithPity(pool, {}, undefined, white)).toMatchObject({ reward: { tier: "WHITE" }, guaranteed: false });
  });

  it("returns a null reward and unchanged counters for an empty pool", () => {
    const counters = { sinceGold: 4, sincePurple: 1 };
    expect(rollWithPity(buildPool([]), pity, counters)).toEqual({ reward: null, counters, guaranteed: false });
  });
});

describe("validatePity", () => {
  it("reads whole numbers, with empty meaning no guarantee", () => {
    expect(validatePity({ goldPity: "90", purplePity: "" })).toEqual({ pity: { gold: 90, purple: null }, errors: {} });
    expect(validatePity({ goldPity: " ", purplePity: "10" })).toEqual({ pity: { gold: null, purple: 10 }, errors: {} });
  });

  it("rejects values that aren't whole numbers from 2 to the maximum", () => {
    for (const bad of ["1", "0", "-5", "2.5", "abc", "1001"]) {
      const { pity, errors } = validatePity({ goldPity: bad, purplePity: "" });
      expect(pity.gold).toBeNull();
      expect(errors.goldPity).toMatch(/whole number/);
    }
  });

  it("needs the Purple guarantee to be shorter than the Gold one", () => {
    const { pity, errors } = validatePity({ goldPity: "10", purplePity: "10" });
    expect(pity).toEqual({ gold: 10, purple: null });
    expect(errors.purplePity).toMatch(/fewer rolls/);
  });
});
