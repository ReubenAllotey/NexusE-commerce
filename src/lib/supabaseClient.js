import { createClient } from "@supabase/supabase-js";

function normalizeSupabaseBaseUrl(value) {
  const raw = String(value ?? "").trim();

  if (!raw) {
    return "";
  }

  try {
    const parsed = new URL(raw);
    parsed.pathname = "/";
    parsed.search = "";
    parsed.hash = "";
    return parsed.toString().replace(/\/$/, "");
  } catch {
    return raw
      .replace(/\/(rest|auth|storage|functions)\/v1\/?.*$/i, "")
      .replace(/\/+$/, "");
  }
}

const supabaseUrl = normalizeSupabaseBaseUrl(import.meta.env.VITE_SUPABASE_URL);
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;
const hasSupabaseConfig = Boolean(supabaseUrl && supabaseAnonKey);

function createMissingSupabaseQuery(error) {
  const terminalResult = () => Promise.resolve({ data: null, error });

  const query = new Proxy(
    {},
    {
      get(_target, prop) {
        if (prop === "select") {
          return () => query;
        }

        if (
          prop === "eq" ||
          prop === "neq" ||
          prop === "gt" ||
          prop === "gte" ||
          prop === "lt" ||
          prop === "lte" ||
          prop === "like" ||
          prop === "ilike" ||
          prop === "in" ||
          prop === "is" ||
          prop === "contains" ||
          prop === "containedBy" ||
          prop === "overlaps" ||
          prop === "or" ||
          prop === "order" ||
          prop === "limit" ||
          prop === "range" ||
          prop === "rangeLt" ||
          prop === "rangeGt" ||
          prop === "rangeGte" ||
          prop === "rangeLte" ||
          prop === "order" ||
          prop === "not" ||
          prop === "match" ||
          prop === "csv" ||
          prop === "textSearch" ||
          prop === "filter" ||
          prop === "single" ||
          prop === "maybeSingle"
        ) {
          if (prop === "single" || prop === "maybeSingle") {
            return terminalResult;
          }

          return () => query;
        }

        if (prop === "insert" || prop === "update" || prop === "upsert" || prop === "delete" || prop === "rpc") {
          return () => ({
            select() {
              return query;
            },
            single: terminalResult,
            maybeSingle: terminalResult,
          });
        }

        if (prop === "then") {
          return undefined;
        }

        return () => query;
      },
    },
  );

  return query;
}

function createMissingSupabaseClient() {
  const error = new Error(
    "Missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY. Supabase auth is disabled until they are set.",
  );

  console.error(error.message);

  return {
    auth: {
      getSession: async () => ({ data: { session: null }, error }),
      getUser: async () => ({ data: { user: null }, error }),
      onAuthStateChange: () => ({
        data: {
          subscription: {
            unsubscribe() {},
          },
        },
      }),
      signInWithPassword: async () => ({ data: null, error }),
      signOut: async () => ({ error }),
      signUp: async () => ({ data: null, error }),
      updateUser: async () => ({ data: { user: null }, error }),
    },
    from: () => createMissingSupabaseQuery(error),
  };
}

export const supabase = hasSupabaseConfig
  ? createClient(supabaseUrl, supabaseAnonKey, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
      },
    })
  : createMissingSupabaseClient();
