// The earning rules, as in the original app. Shared by the server and the admin pages (no server imports).
// `kind` decides which settings a rule has and what triggers it:
//   order    - points per order (webhook)
//   account  - once per customer, triggered by a webhook or the storefront widget
//   birthday - once a year (scheduled job), after the customer enters their birthday in the widget
//   referral - the two sides of a referral
//   social   - once per customer, the customer clicks through from the widget (not verified)

export const EARNING_GROUPS = [
  { key: "purchase", heading: "Purchases" },
  { key: "account", heading: "Account" },
  { key: "referral", heading: "Referrals" },
  { key: "social", heading: "Social" },
];

const social = (type, defaultName, action, urlLabel) => ({
  type,
  group: "social",
  kind: "social",
  defaultName,
  action,
  urlLabel,
  description: `Customers get points once, after clicking ${action} in the rewards widget. Shopify can't confirm they actually did it.`,
});

export const EARNING_TYPES = [
  {
    type: "PLACE_ORDER",
    group: "purchase",
    kind: "order",
    defaultName: "Complete an order",
    description: "A fixed number of points per order, or points for every amount spent.",
  },
  {
    type: "CREATE_ACCOUNT",
    group: "account",
    kind: "account",
    defaultName: "Create an account",
    description: "Given once, when the customer is created in Shopify.",
  },
  {
    type: "NEWSLETTER",
    group: "account",
    kind: "account",
    defaultName: "Subscribe to newsletter",
    action: "Subscribe",
    description: "The customer subscribes to email marketing from the rewards widget and gets points once.",
  },
  {
    type: "BIRTHDAY",
    group: "account",
    kind: "birthday",
    defaultName: "Happy birthday",
    description: "Customers enter their birthday in the rewards widget and get points on it each year.",
  },
  {
    type: "COMPLETE_PROFILE",
    group: "account",
    kind: "account",
    defaultName: "Complete profile",
    description: "Given once, when the customer has a first name, last name and default address.",
  },
  {
    type: "REFERRER",
    group: "referral",
    kind: "referral",
    defaultName: "Refer a friend",
    description: "Given to the customer who shared their referral link, when the friend places their first order.",
  },
  {
    type: "REFERRED_FRIEND",
    group: "referral",
    kind: "referral",
    defaultName: "Referred by a friend",
    description: "Given to the friend when they create an account through a referral link.",
  },
  social("FOLLOW_INSTAGRAM", "Follow on Instagram", "Follow", "Instagram profile URL"),
  social("FOLLOW_X", "Follow on X", "Follow", "X profile URL"),
  social("SHARE_ON_X", "Share on X", "Share", "Page to share"),
  social("RETWEET", "Retweet", "Repost", "Post URL"),
  social("LIKE_ON_FACEBOOK", "Like on Facebook", "Like", "Facebook page URL"),
  social("SHARE_ON_FACEBOOK", "Share on Facebook", "Share", "Page to share"),
  social("JOIN_FACEBOOK_GROUP", "Join a Facebook group", "Join", "Facebook group URL"),
  social("FOLLOW_TIKTOK", "Follow on TikTok", "Follow", "TikTok profile URL"),
  social("FOLLOW_LINKEDIN", "Follow on LinkedIn", "Follow", "LinkedIn page URL"),
  social("SHARE_ON_LINKEDIN", "Share on LinkedIn", "Share", "Page to share"),
  social("SUBSCRIBE_YOUTUBE", "Subscribe on YouTube", "Subscribe", "YouTube channel URL"),
  social("FOLLOW_PINTEREST", "Follow on Pinterest", "Follow", "Pinterest profile URL"),
];

export const EARNING_TYPE = Object.fromEntries(EARNING_TYPES.map((t) => [t.type, t]));

// Social "share" rules open the platform's share dialog for the URL instead of the URL itself.
const SHARE_URLS = {
  SHARE_ON_X: (url) => `https://x.com/intent/post?url=${encodeURIComponent(url)}`,
  SHARE_ON_FACEBOOK: (url) => `https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(url)}`,
  SHARE_ON_LINKEDIN: (url) => `https://www.linkedin.com/sharing/share-offsite/?url=${encodeURIComponent(url)}`,
};

/** The link the widget opens for a social rule. */
export function socialLink(type, url) {
  return SHARE_URLS[type] ? SHARE_URLS[type](url) : url;
}

// Place order: how points are counted.
export const ORDER_METHODS = {
  FIXED: "FIXED", // `points` per order
  PER_AMOUNT: "PER_AMOUNT", // `points` for every `spent` of the order amount
};

// Place order: which items count toward the amount.
export const ITEM_SCOPES = {
  ALL: "ALL",
  INCLUDE: "INCLUDE", // only the selected products and collections
  EXCLUDE: "EXCLUDE", // everything except the selected products and collections
};

// URL segment of a rule's edit page: PLACE_ORDER <-> place-order.
export const earningSlug = (type) => type.toLowerCase().replaceAll("_", "-");
export function typeFromSlug(slug) {
  const type = String(slug ?? "").toUpperCase().replaceAll("-", "_");
  return EARNING_TYPE[type] ? type : null;
}

/** One-line summary of what a rule gives, e.g. "10 points per order" or "5 points for every $1.00 spent". */
export function describeEarning(rule, { pointsName = "points", formatMoney = String } = {}) {
  const points = `${rule.points.toLocaleString("en-US")} ${pointsName.toLowerCase()}`;
  const { kind } = EARNING_TYPE[rule.type];
  if (kind === "order") {
    if (rule.config.method === ORDER_METHODS.PER_AMOUNT) {
      const scope = rule.config.itemScope === ITEM_SCOPES.ALL ? "" : " on selected items";
      return `${points} for every ${formatMoney(rule.config.spent)} spent${scope}`;
    }
    return `${points} per order`;
  }
  if (kind === "birthday") return `${points} every birthday`;
  if (rule.config?.rewardType === "COUPON") return "A discount code, once";
  return `${points} once`;
}
