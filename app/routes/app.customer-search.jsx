import { authenticate } from "../shopify.server";
import { searchCustomers } from "../services/shopify/customers.server";

// GET /app/customer-search?q=… — JSON used by the customer picker on the discount code form.
export const loader = async ({ request }) => {
  const { admin } = await authenticate.admin(request);
  const term = new URL(request.url).searchParams.get("q") ?? "";

  try {
    return { customers: await searchCustomers(admin, term) };
  } catch (error) {
    return { customers: [], error: error.message };
  }
};
