/* eslint-disable react/prop-types -- the project doesn't use PropTypes */

const STATUS = {
  member: { label: "Member", tone: "success" },
  guest: { label: "Guest", tone: "neutral" },
  excluded: { label: "Excluded", tone: "critical" },
};

/** "member" (has a customer account), "guest", or "excluded" (left out of the program by the merchant). */
export const customerStatus = (customer) =>
  customer.excluded ? "excluded" : customer.state === "ENABLED" ? "member" : "guest";

export function StatusBadge({ status }) {
  return <s-badge tone={STATUS[status].tone}>{STATUS[status].label}</s-badge>;
}
