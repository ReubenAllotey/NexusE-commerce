export const supabase = {
  auth: {
    async getSession() {
      if (new URLSearchParams(window.location.search).get("case") === "unauthorized") {
        return { data: { session: null }, error: null };
      }
      return { data: { session: { access_token: "synthetic-admin-token" } }, error: null };
    },
  },
};
