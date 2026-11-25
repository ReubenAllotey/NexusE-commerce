const session = { access_token: "synthetic-admin-token", user: { id: "synthetic-admin-id", email: "admin@example.test" } };

const categories = [{ id: "synthetic-category", name: "Synthetic", slug: "synthetic", status: "active", deleted_at: null, parent_id: null, display_order: 1 }];
const categoryQuery = {
  select() { return categoryQuery; },
  order() { return categoryQuery; },
  then(resolve, reject) { return Promise.resolve({ data: categories, error: null }).then(resolve, reject); },
};

export const supabase = {
  auth: { getSession: async () => ({ data: { session }, error: null }) },
  from(table) { return table === "categories" ? categoryQuery : categoryQuery; },
};
