// Built-in tier icons (shared by the admin pages and the server; the widget gets the symbol).
export const TIER_ICONS = {
  STAR: { label: "Star", symbol: "★" },
  CROWN: { label: "Crown", symbol: "♛" },
  DIAMOND: { label: "Diamond", symbol: "◆" },
  MEDAL: { label: "Medal", symbol: "✪" },
  HEART: { label: "Heart", symbol: "♥" },
  FLOWER: { label: "Flower", symbol: "✿" },
};

export const ENTRY_METHODS = {
  POINTS_EARNED: "Points earned",
  MONEY_SPENT: "Amount spent",
};

export const MILESTONES = {
  LIFETIME: "Lifetime",
  CALENDAR_YEAR: "Calendar year (resets every Jan 1)",
};

/** "500 points" or "500.00 spent" for a tier threshold. */
export function describeThreshold(threshold, entryMethod, pointsName = "points") {
  const n = Number(threshold);
  return entryMethod === "MONEY_SPENT" ? `${n.toFixed(2)} spent` : `${n.toLocaleString("en-US")} ${pointsName.toLowerCase()}`;
}
