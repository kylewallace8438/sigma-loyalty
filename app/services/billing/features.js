// Plan feature codes (shared by the server and the admin Plan page). The Free plan's values are seeded
// by the migration prisma/migrations/*_free_plan: every feature on, no order limit.

export const FEATURES = {
  "orders.monthly_limit": { label: "Rewarded orders per 30 days", resetDays: 30 },
  "earning.newsletter": { label: "Newsletter earning rule" },
  "earning.birthday": { label: "Birthday earning rule" },
  "earning.referral": { label: "Referral earning rules" },
  "earning.social": { label: "Social earning rules" },
  "earning.complete_profile": { label: "Complete profile earning rule" },
  "redeem.free_product": { label: "Free product rewards" },
  "tier.vip_tiers": { label: "VIP tiers" },
  "tier.manual_change": { label: "Change a customer's VIP tier" },
  "points.expiration": { label: "Point expiration" },
};

export const FREE_PLAN_NAME = "Free";

// Values that mean "on, no limit" (as in the original app's billing config).
export const POSITIVE_WORDS = ["Y", "YES", "TRUE", "UNLIMITED"];

/** The feature an earning rule type needs, or null when it's always available. */
export function earningFeature(type, kind) {
  if (type === "NEWSLETTER") return "earning.newsletter";
  if (type === "BIRTHDAY") return "earning.birthday";
  if (type === "COMPLETE_PROFILE") return "earning.complete_profile";
  if (type === "REFERRER" || type === "REFERRED_FRIEND") return "earning.referral";
  if (kind === "social") return "earning.social";
  return null;
}
