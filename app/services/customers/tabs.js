// Shared by server code and route components (no `.server` suffix so it can reach the browser bundle).

// Customer list tabs, as in the original app: members have a customer account, guests don't,
// excluded customers are left out of the program by the merchant (and out of the other tabs).
export const CUSTOMER_TABS = {
  all: { label: "All", where: {} },
  members: { label: "Members", where: { state: "ENABLED", excluded: false } },
  guests: { label: "Guests", where: { state: { not: "ENABLED" }, excluded: false } },
  excluded: { label: "Excluded", where: { excluded: true } },
};
