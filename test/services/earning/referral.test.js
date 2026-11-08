import { beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "../../mocks/db";
import {
  TOKEN_MAX_AGE_MS,
  claimReferral,
  createReferralToken,
  getReferralCode,
  verifyReferralToken,
} from "../../../app/services/earning/referral.server";

const shop = "a.myshopify.com";
const now = Date.parse("2026-11-09T10:00:00Z");
const rule = (type) => ({ type, name: type === "REFERRER" ? "Refer a friend" : "Referred by a friend", active: true, points: 50, config: {} });
const referrer = { id: 40, shopId: 7, referralCode: "ABCDEFGH23", excluded: false, shopifyCreatedAt: new Date("2026-01-01") };

beforeEach(() => {
  vi.stubEnv("SHOPIFY_API_SECRET", "test-secret");
});

describe("getReferralCode", () => {
  it("returns the existing code, or sets one only if still empty", async () => {
    expect(await getReferralCode({ id: 1, referralCode: "XYZXYZXYZ2" })).toBe("XYZXYZXYZ2");

    db.customer.updateMany.mockResolvedValue({ count: 1 });
    db.customer.findUnique.mockResolvedValue({ referralCode: "NEWCODE234" });
    expect(await getReferralCode({ id: 1, referralCode: null })).toBe("NEWCODE234");
    expect(db.customer.updateMany).toHaveBeenCalledWith({
      where: { id: 1, referralCode: null },
      data: { referralCode: expect.stringMatching(/^[A-Z2-9]{10}$/) },
    });
  });
});

describe("referral tokens", () => {
  it("signs a token for a known code and verifies it for the same shop only", async () => {
    db.customer.findFirst.mockResolvedValue(referrer);
    db.earningRule.findFirst.mockImplementation(async ({ where }) => (where.type === "REFERRER" ? rule("REFERRER") : null));

    const token = await createReferralToken(shop, "ABCDEFGH23", now);

    expect(verifyReferralToken(shop, token, now + 1000)).toEqual({ code: "ABCDEFGH23", ts: now });
    expect(verifyReferralToken("other.myshopify.com", token, now)).toBeNull();
    expect(verifyReferralToken(shop, token.replace("ABCDEFGH23", "ZZZZZZZZZZ"), now)).toBeNull();
    expect(verifyReferralToken(shop, token, now + TOKEN_MAX_AGE_MS + 1)).toBeNull();
  });

  it("gives no token for an unknown code or when both referral rules are off", async () => {
    db.customer.findFirst.mockResolvedValue(null);
    expect(await createReferralToken(shop, "ABCDEFGH23", now)).toBeNull();

    db.customer.findFirst.mockResolvedValue(referrer);
    db.earningRule.findFirst.mockResolvedValue(null);
    expect(await createReferralToken(shop, "ABCDEFGH23", now)).toBeNull();
    expect(await createReferralToken(shop, "bad code!", now)).toBeNull();
  });
});

describe("claimReferral", () => {
  const friend = { id: 3, shopId: 7, excluded: false, referredById: null, shopifyCreatedAt: new Date(now + 60_000) };
  let token;

  beforeEach(async () => {
    db.customer.findFirst.mockResolvedValue(referrer);
    db.earningRule.findFirst.mockImplementation(async ({ where }) => rule(where.type));
    token = await createReferralToken(shop, "ABCDEFGH23", now);
  });

  it("links a new account to the referrer and gives the friend their points", async () => {
    db.customer.updateMany.mockResolvedValue({ count: 1 });
    db.storeSettings.findFirst.mockResolvedValue({ programEnabled: true });

    expect(await claimReferral(shop, friend, token, now + 120_000)).toBe("linked");
    expect(db.customer.updateMany).toHaveBeenCalledWith({ where: { id: 3, referredById: null }, data: { referredById: 40 } });
    expect(db.pointHistory.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ customerId: 3, points: 50, earningType: "REFERRED_FRIEND", dedupeKey: "REFERRED_FRIEND" }),
    });
  });

  it("refuses accounts created before the click, the referrer themself and repeat referrals", async () => {
    const later = now + 120_000;
    expect(await claimReferral(shop, { ...friend, shopifyCreatedAt: new Date(now - 1) }, token, later)).toBe("not-new");
    expect(await claimReferral(shop, { ...friend, id: 40 }, token, later)).toBe("self");
    expect(await claimReferral(shop, { ...friend, referredById: 12 }, token, later)).toBe("already-referred");
    expect(await claimReferral(shop, friend, "forged.123.sig", later)).toBe("invalid");
  });

  it("asks to retry until the account's Shopify creation time is known", async () => {
    expect(await claimReferral(shop, { ...friend, shopifyCreatedAt: null }, token, now + 120_000)).toBe("retry");
  });
});
