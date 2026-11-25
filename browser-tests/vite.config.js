import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";

const root = path.resolve(process.cwd());
const mockSupabase = path.resolve(root, "browser-tests/paymentRecoveryMockSupabase.js");

export default defineConfig({
  root,
  resolve: {
    alias: [
      { find: "/src/lib/supabaseClient.js", replacement: mockSupabase },
    ],
  },
  plugins: [
    react(),
    {
      name: "mock-supabase-client",
      enforce: "pre",
      resolveId(source) {
        return source.includes("lib/supabaseClient") ? mockSupabase : null;
      },
    },
  ],
  server: { port: 4174, host: "127.0.0.1" },
});
