/** Runs an Admin GraphQL query and returns `data`; throws on top-level GraphQL errors. */
export async function adminQuery(admin, query, variables) {
  const response = await admin.graphql(query, { variables });
  const json = await response.json();
  if (json.errors?.length) throw new Error(json.errors[0].message);
  return json.data;
}
