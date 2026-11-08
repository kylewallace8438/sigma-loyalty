import db from "../../db.server";
import logger from "../../logger.server";
import { getSettings } from "../settings/settings.server";
import { earnPoints } from "./award.server";
import { getActiveRule } from "./rules.server";

const DAY_MS = 24 * 60 * 60 * 1000;
// With "requireNotice", a birthday entered less than this many days ahead is rewarded next year
// instead (stops customers entering tomorrow's date for quick points), as in the original app.
export const NOTICE_DAYS = 30;
const BATCH_SIZE = 500;

/** Parses "YYYY-MM-DD" into a UTC date. Returns null unless it is a real past date after 1900. */
export function parseBirthday(value, now = new Date()) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value ?? ""));
  if (!match) return null;
  const [year, month, day] = match.slice(1).map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  if (year < 1900 || date > now) return null;
  return date;
}

/**
 * When the birthday points are next due: the birthday in the current year, or the next year when it
 * has passed (or, with requireNotice, is less than NOTICE_DAYS away).
 */
export function nextBirthdayRewardAt(birthday, now = new Date(), requireNotice = true) {
  const thisYear = new Date(Date.UTC(now.getUTCFullYear(), birthday.getUTCMonth(), birthday.getUTCDate()));
  const cutoff = requireNotice ? new Date(now.getTime() + NOTICE_DAYS * DAY_MS) : now;
  if (thisYear >= cutoff) return thisYear;
  return new Date(Date.UTC(now.getUTCFullYear() + 1, birthday.getUTCMonth(), birthday.getUTCDate()));
}

/** Saves the birthday the customer entered in the widget and schedules their next birthday points. */
export async function setBirthday(customer, birthday, now = new Date()) {
  const rule = await getActiveRule(customer.shopId, "BIRTHDAY");
  const requireNotice = rule?.config.requireNotice ?? true;
  await db.customer.update({
    where: { id: customer.id },
    data: { birthday, birthdayRewardAt: nextBirthdayRewardAt(birthday, now, requireNotice) },
  });
  logger.info({ shopId: customer.shopId, customerId: customer.id }, "Birthday saved");
}

const addYear = (date) =>
  new Date(Date.UTC(date.getUTCFullYear() + 1, date.getUTCMonth(), date.getUTCDate()));

/**
 * Gives birthday points to every customer whose birthday points are due, then moves their next date
 * on a year (also when nothing was given: rule off, program off, excluded). At most once per customer
 * per year. Returns the number of customers processed.
 */
export async function rewardDueBirthdays(now = new Date()) {
  let processed = 0;
  for (;;) {
    const due = await db.customer.findMany({
      where: { birthdayRewardAt: { lte: now } },
      include: { shop: true },
      orderBy: { birthdayRewardAt: "asc" },
      take: BATCH_SIZE,
    });
    let batchProcessed = 0;
    for (const customer of due) {
      try {
        await rewardBirthday(customer);
      } catch (err) {
        // Leave the date as it is, so the next run tries this customer again.
        logger.error({ err, customerId: customer.id }, "Birthday reward failed");
        continue;
      }
      batchProcessed++;
    }
    processed += batchProcessed;
    // A full batch that failed entirely would be fetched again forever; leave it for the next run.
    if (due.length < BATCH_SIZE || !batchProcessed) break;
  }
  return processed;
}

async function rewardBirthday(customer) {
  const dueAt = customer.birthdayRewardAt;
  if (!customer.shop.uninstalledAt) {
    const rule = await getActiveRule(customer.shopId, "BIRTHDAY");
    if (rule) {
      const settings = await getSettings(customer.shop.domain);
      const result = await earnPoints(settings, customer, {
        type: "BIRTHDAY",
        points: rule.points,
        reason: rule.name,
        dedupeKey: `BIRTHDAY:${dueAt.getUTCFullYear()}`,
      });
      logger.info({ shopId: customer.shopId, customerId: customer.id, result }, "Birthday points processed");
    }
  }
  await db.customer.update({ where: { id: customer.id }, data: { birthdayRewardAt: addYear(dueAt) } });
}
