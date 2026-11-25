console.info("HARNESS_MOCK_LOADED");

const state = {
  session: null,
  scenario: "auth-return",
  listeners: new Set(),
};

const customer = {
  id: "synthetic-customer-1",
  email: "customer@example.test",
  full_name: "Synthetic Customer",
  phone_number: "0240000000",
  role: "customer",
  status: "active",
  account_type: "registered",
};

function sessionFor(user = customer) {
  return {
    access_token: `synthetic-access-${user.id}`,
    user: { id: user.id, email: user.email, user_metadata: {} },
  };
}
export const mockAuth = {
  configure(nextScenario) {
    state.scenario = nextScenario;
    state.session = nextScenario === "already-authenticated" ? sessionFor() : null;
  },
  getSession() {
    return state.session;
  },
  getScenario() {
    return state.scenario;
  },
};

const profileQuery = {
  select() { return profileQuery; },
  eq() { return profileQuery; },
  maybeSingle: async () => ({
    data: state.scenario === "incorrect-account" ? { ...customer, id: "wrong-customer" } : customer,
    error: null,
  }),
};

export const supabase = {
  auth: {
    getSession: async () => ({ data: { session: state.session }, error: null }),
    onAuthStateChange: (callback) => {
      state.listeners.add(callback);
      return { data: { subscription: { unsubscribe: () => state.listeners.delete(callback) } } };
    },
    signInWithPassword: async () => {
      console.info("HARNESS_SIGN_IN_CALLED");
      if (["repeated-401", "failed-auth"].includes(state.scenario)) {
        return { data: null, error: new Error("Synthetic authentication failure.") };
      }
      state.session = sessionFor();
      console.info("HARNESS_SIGN_IN_SUCCEEDED");
      for (const listener of state.listeners) listener("SIGNED_IN", state.session);
      return { data: { session: state.session }, error: null };
    },
  },
  from: () => profileQuery,
};

export function resetMockAuth() {
  state.session = null;
  state.scenario = "auth-return";
  state.listeners.clear();
}
