import db from "../db.server";

/** Returns the Shop row for a myshopify domain, creating it (or clearing uninstalledAt) as needed. */
export function ensureShop(domain) {
  return db.shop.upsert({
    where: { domain },
    create: { domain },
    update: { uninstalledAt: null },
  });
}

export function markUninstalled(domain) {
  return db.shop.updateMany({ where: { domain }, data: { uninstalledAt: new Date() } });
}

/** Deletes the shop and, via cascade, all of its loyalty data. */
export function deleteShopData(domain) {
  return db.shop.deleteMany({ where: { domain } });
}
