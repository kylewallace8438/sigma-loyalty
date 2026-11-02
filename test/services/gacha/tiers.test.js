import { describe, expect, it } from "vitest";
import { buildPool, buildReel, effectiveOdds, pickReward } from "../../../app/services/gacha/tiers";

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
