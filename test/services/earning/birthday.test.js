import { describe, expect, it } from "vitest";
import { db } from "../../mocks/db";
import {
  nextBirthdayRewardAt,
  parseBirthday,
  rewardDueBirthdays,
  setBirthday,
} from "../../../app/services/earning/birthday.server";

const now = new Date("2026-11-09T10:00:00Z");
const utc = (s) => new Date(`${s}T00:00:00Z`);

describe("parseBirthday", () => {
  it("accepts real past dates only", () => {
    expect(parseBirthday("1990-02-28", now)).toEqual(utc("1990-02-28"));
    expect(parseBirthday("1990-02-30", now)).toBeNull();
    expect(parseBirthday("2027-01-01", now)).toBeNull();
    expect(parseBirthday("1850-01-01", now)).toBeNull();
    expect(parseBirthday("01/02/1990", now)).toBeNull();
  });
});

describe("nextBirthdayRewardAt", () => {
  it("is this year's birthday when it's far enough ahead", () => {
    expect(nextBirthdayRewardAt(utc("1990-12-25"), now, true)).toEqual(utc("2026-12-25"));
  });

  it("moves to next year when less than 30 days ahead, with requireNotice", () => {
    expect(nextBirthdayRewardAt(utc("1990-11-20"), now, true)).toEqual(utc("2027-11-20"));
    expect(nextBirthdayRewardAt(utc("1990-11-20"), now, false)).toEqual(utc("2026-11-20"));
  });

  it("moves to next year once the birthday has passed", () => {
    expect(nextBirthdayRewardAt(utc("1990-03-01"), now, false)).toEqual(utc("2027-03-01"));
  });
});

describe("setBirthday", () => {
  it("saves the birthday and schedules the reward with the rule's notice option", async () => {
    db.earningRule.findFirst.mockResolvedValue({ type: "BIRTHDAY", name: "Bday", active: true, points: 10, config: { requireNotice: false } });

    await setBirthday({ id: 3, shopId: 7 }, utc("1990-11-20"), now);

    expect(db.customer.update).toHaveBeenCalledWith({
      where: { id: 3 },
      data: { birthday: utc("1990-11-20"), birthdayRewardAt: utc("2026-11-20") },
    });
  });
});

describe("rewardDueBirthdays", () => {
  const due = (over = {}) => ({
    id: 3,
    shopId: 7,
    excluded: false,
    birthdayRewardAt: utc("2026-11-09"),
    shop: { domain: "a.myshopify.com", uninstalledAt: null },
    ...over,
  });

  it("gives the points once for that year and moves the date on a year", async () => {
    db.customer.findMany.mockResolvedValue([due()]);
    db.earningRule.findFirst.mockResolvedValue({ type: "BIRTHDAY", name: "Happy birthday", active: true, points: 25, config: {} });
    db.storeSettings.findFirst.mockResolvedValue({ programEnabled: true });
    db.customer.updateMany.mockResolvedValue({ count: 1 });

    expect(await rewardDueBirthdays(now)).toBe(1);
    expect(db.pointHistory.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ customerId: 3, points: 25, earningType: "BIRTHDAY", dedupeKey: "BIRTHDAY:2026" }),
    });
    expect(db.customer.update).toHaveBeenCalledWith({ where: { id: 3 }, data: { birthdayRewardAt: utc("2027-11-09") } });
  });

  it("still moves the date on when the rule is off or the shop uninstalled", async () => {
    db.customer.findMany.mockResolvedValue([due(), due({ id: 4, shop: { domain: "b", uninstalledAt: now } })]);
    db.earningRule.findFirst.mockResolvedValue(null);

    expect(await rewardDueBirthdays(now)).toBe(2);
    expect(db.pointHistory.create).not.toHaveBeenCalled();
    expect(db.customer.update).toHaveBeenCalledTimes(2);
  });
});
