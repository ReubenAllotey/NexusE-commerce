import { supabase } from "../../../lib/supabaseClient";

const REPORT_TABLES = ["orders", "order_items", "payments", "profiles", "import_batches"];

export async function loadMonthlyReportData() {
  const results = await Promise.all(
    REPORT_TABLES.map((table) => supabase.from(table).select("*")),
  );
  const failed = results.find((result) => result.error);

  if (failed) {
    return {
      ok: false,
      message: failed.error?.message || "Unable to load monthly report data.",
      data: null,
    };
  }

  return {
    ok: true,
    message: "",
    data: {
      orders: results[0].data || [],
      orderItems: results[1].data || [],
      payments: results[2].data || [],
      profiles: results[3].data || [],
      batches: results[4].data || [],
    },
  };
}
