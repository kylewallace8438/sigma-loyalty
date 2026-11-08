import db from "../../db.server";
import logger from "../../logger.server";
import { ensureShop } from "../shops/shops.server";
import { ENTRY_METHODS, MILESTONES, TIER_ICONS } from "./icons";

// The VIP tier program and its tiers, as in the original app: settings per shop, an entry tier
// (threshold 0, can't be deleted) and any number of tiers above it, ordered by threshold.

export const DEFAULT_PROGRAM = { enabled: false, entryMethod: "POINTS_EARNED", milestone: "LIFETIME", startDate: null };
const MAX_THRESHOLD = 100_000_000;
const MAX_PERKS = 10;

/** The shop's program settings (defaults if never saved), by shop id. */
export async function getProgram(shopId) {
  const row = await db.tierProgram.findUnique({ where: { shopId } });
  return row ?? { ...DEFAULT_PROGRAM, shopId };
}

/** Whether tiers are being tracked now: on, and past the start date. */
export function isProgramActive(program, now = new Date()) {
  return Boolean(program.enabled && (!program.startDate || program.startDate <= now));
}

/** Jan 1 / Dec 31 (end of day) of `now`'s year, UTC. */
export const yearStart = (now = new Date()) => new Date(Date.UTC(now.getUTCFullYear(), 0, 1));
export const yearEnd = (now = new Date()) => new Date(Date.UTC(now.getUTCFullYear(), 11, 31, 23, 59, 59));

/** Creates the entry tier when the shop has none. Returns the shop's tiers, lowest first. */
export async function ensureTiers(shopId) {
  let tiers = await db.tier.findMany({ where: { shopId }, orderBy: { threshold: "asc" } });
  if (!tiers.some((t) => t.isDefault)) {
    await db.tier.create({ data: { shopId, title: "Entry tier", icon: "STAR", threshold: 0, isDefault: true } });
    tiers = await db.tier.findMany({ where: { shopId }, orderBy: { threshold: "asc" } });
  }
  return tiers;
}

/** Program settings and tiers for the admin page. */
export async function loadTierProgram(shopDomain) {
  const shop = await ensureShop(shopDomain);
  const [program, tiers] = await Promise.all([getProgram(shop.id), ensureTiers(shop.id)]);
  const counts = await db.customer.groupBy({ by: ["tierId"], where: { shopId: shop.id, tierId: { not: null } }, _count: true });
  const members = Object.fromEntries(counts.map((c) => [c.tierId, c._count]));
  return { shop, program, tiers: tiers.map((t) => ({ ...t, members: members[t.id] ?? 0 })) };
}

/** Parses the program settings form. Returns { data, values, errors }. */
export function parseProgramForm(formData) {
  const values = {
    enabled: formData.get("enabled") !== null,
    entryMethod: String(formData.get("entryMethod") ?? ""),
    milestone: String(formData.get("milestone") ?? ""),
    startDate: String(formData.get("startDate") ?? "").trim(),
  };
  const errors = {};
  if (!ENTRY_METHODS[values.entryMethod]) errors.entryMethod = "Choose what customers qualify by.";
  if (!MILESTONES[values.milestone]) errors.milestone = "Choose the period.";
  let startDate = null;
  if (values.startDate) {
    startDate = /^\d{4}-\d{2}-\d{2}$/.test(values.startDate) ? new Date(`${values.startDate}T00:00:00Z`) : null;
    if (!startDate || Number.isNaN(startDate.getTime())) errors.startDate = "Enter a valid date.";
  }
  return {
    data: { enabled: values.enabled, entryMethod: values.entryMethod, milestone: values.milestone, startDate: startDate ?? new Date() },
    values,
    errors,
  };
}

/**
 * Saves the program settings. As in the original app, changing what customers qualify by deletes
 * every tier except the entry tier (thresholds no longer mean the same thing) and resets everyone's
 * tier and manual top-ups; changing the period resets when customers' tiers are next re-evaluated.
 */
export async function saveProgram(shopDomain, data, now = new Date()) {
  const shop = await ensureShop(shopDomain);
  const before = await getProgram(shop.id);
  await db.tierProgram.upsert({ where: { shopId: shop.id }, create: { shopId: shop.id, ...data }, update: data });

  if (before.id && before.entryMethod !== data.entryMethod) {
    await db.tier.deleteMany({ where: { shopId: shop.id, isDefault: false } });
    await db.customer.updateMany({ where: { shopId: shop.id }, data: { tierId: null, tierAchievedAt: null, tierExpiresAt: null } });
    await db.tierCredit.deleteMany({ where: { shopId: shop.id, kind: "MANUAL" } });
    logger.info({ shop: shopDomain, entryMethod: data.entryMethod }, "Tier entry method changed: tiers reset");
  } else if (before.milestone !== data.milestone) {
    await db.customer.updateMany({
      where: { shopId: shop.id, tierId: { not: null } },
      data: { tierExpiresAt: data.milestone === "CALENDAR_YEAR" ? yearEnd(now) : null },
    });
  }
  logger.info({ shop: shopDomain, enabled: data.enabled }, "Tier program saved");
}

export function getTier(shopDomain, id) {
  return db.tier.findFirst({ where: { id, shop: { domain: shopDomain } }, include: { rewards: true } });
}

/** A tier as form values. */
export function toTierFormValues(tier) {
  return {
    title: tier?.title ?? "",
    icon: tier?.icon ?? "",
    threshold: tier ? String(Number(tier.threshold)) : "",
    multiplier: tier?.multiplier != null ? String(Number(tier.multiplier)) : "",
    perks: (tier?.perks ?? []).join("\n"),
    tagEnabled: tier?.tagEnabled ?? false,
    rewardIds: (tier?.rewards ?? []).map((r) => String(r.discountRuleId)),
    isDefault: tier?.isDefault ?? false,
  };
}

/**
 * Parses the tier form. The entry tier's threshold stays 0. Returns { data, rewardIds, values, errors }.
 * Threshold uniqueness is checked in saveTier.
 */
export function parseTierForm(formData, { isDefault = false } = {}) {
  const text = (k) => String(formData.get(k) ?? "").trim();
  const values = {
    title: text("title"),
    icon: text("icon"),
    threshold: text("threshold"),
    multiplier: text("multiplier"),
    perks: String(formData.get("perks") ?? ""),
    tagEnabled: formData.get("tagEnabled") !== null,
    rewardIds: formData.getAll("rewardIds").map(String),
    isDefault,
  };
  const errors = {};
  if (!values.title) errors.title = "Enter a name.";
  else if (values.title.length > 100) errors.title = "Use 100 characters or fewer.";
  if (values.icon && !TIER_ICONS[values.icon]) errors.icon = "Choose an icon from the list.";

  let threshold = 0;
  if (!isDefault) {
    threshold = Number(values.threshold);
    if (!(threshold > 0) || threshold > MAX_THRESHOLD || Math.round(threshold * 100) !== threshold * 100) {
      errors.threshold = "Enter a number greater than 0 (the entry tier starts at 0), with at most 2 decimals.";
    }
  }

  let multiplier = null;
  if (values.multiplier) {
    multiplier = Number(values.multiplier);
    if (!(multiplier > 1) || multiplier > 100 || Math.round(multiplier * 100) !== multiplier * 100) {
      errors.multiplier = "Enter a number greater than 1 (e.g. 1.5), or leave empty for no bonus.";
    }
  }

  const perks = values.perks.split(/\r?\n/).map((p) => p.trim().slice(0, 100)).filter(Boolean);
  if (perks.length > MAX_PERKS) errors.perks = `List up to ${MAX_PERKS} benefits.`;
  const rewardIds = [...new Set(values.rewardIds.map(Number).filter((n) => Number.isInteger(n) && n > 0))];

  return {
    data: {
      title: values.title,
      icon: values.icon || null,
      threshold: threshold.toFixed(2),
      multiplier: multiplier === null ? null : multiplier.toFixed(2),
      perks,
      tagEnabled: values.tagEnabled,
    },
    rewardIds,
    values,
    errors,
  };
}

/**
 * Creates (id = null) or updates a tier with its entry rewards (ids of the shop's discount rules).
 * Returns { tier } or { errors } (a threshold another tier already uses).
 */
export async function saveTier(shopDomain, id, data, rewardIds) {
  const shop = await ensureShop(shopDomain);
  const existing = id ? await getTier(shopDomain, id) : null;
  if (id && !existing) return { errors: { form: "This tier no longer exists." } };
  const fields = existing?.isDefault ? { ...data, threshold: "0.00" } : data;

  const clash = await db.tier.findFirst({ where: { shopId: shop.id, threshold: fields.threshold, ...(id && { NOT: { id } }) } });
  if (clash) return { errors: { threshold: `"${clash.title}" already starts at this value. Each tier needs its own.` } };

  const rules = await db.discountRule.findMany({ where: { shopId: shop.id, id: { in: rewardIds } }, select: { id: true } });
  const rewards = rules.map((r) => ({ discountRuleId: r.id }));
  const tier = await db.$transaction(async (tx) => {
    if (existing) {
      await tx.tierReward.deleteMany({ where: { tierId: id } });
      return tx.tier.update({ where: { id }, data: { ...fields, rewards: { create: rewards } } });
    }
    return tx.tier.create({ data: { ...fields, shopId: shop.id, rewards: { create: rewards } } });
  });
  logger.info({ shop: shopDomain, tierId: tier.id, created: !id }, "Tier saved");
  return { tier };
}

/**
 * Deletes a tier (not the entry tier). Its customers lose their tier (SetNull) and are placed again
 * in the best tier they qualify for by `resync` (sync.server.js), as in the original app.
 * Returns { ok, customerIds } or { errors }.
 */
export async function deleteTier(shopDomain, id) {
  const tier = await getTier(shopDomain, id);
  if (!tier) return { ok: true, customerIds: [] };
  if (tier.isDefault) return { errors: { form: "The entry tier can't be deleted." } };
  const customers = await db.customer.findMany({ where: { tierId: id }, select: { id: true } });
  await db.tier.delete({ where: { id } });
  logger.info({ shop: shopDomain, tierId: id, customers: customers.length }, "Tier deleted");
  return { ok: true, customerIds: customers.map((c) => c.id) };
}
