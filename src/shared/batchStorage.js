import { supabase } from "../lib/supabaseClient";

export const BATCH_STATUSES = [
  "draft",
  "open",
  "closed",
  "purchasing",
  "shipped",
  "arrived",
  "completed",
];

export const defaultBatch = {
  id: "",
  batchNumber: "",
  title: "",
  startDate: "",
  endDate: "",
  shipmentType: "both",
  airFreightDays: null,
  seaFreightDays: null,
  status: "draft",
  notes: "",
  createdAt: "",
  updatedAt: "",
};

function text(value) {
  return String(value ?? "").trim();
}

function date(value) {
  return value ? String(value).slice(0, 10) : "";
}

function numberOrNull(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

export function normalizeBatch(value = {}) {
  const safe = value && typeof value === "object" ? value : {};
  return {
    ...defaultBatch,
    id: text(safe.id),
    batchNumber: text(safe.batchNumber ?? safe.batch_number),
    title: text(safe.title),
    startDate: date(safe.startDate ?? safe.start_date),
    endDate: date(safe.endDate ?? safe.end_date),
    shipmentType: text(safe.shipmentType ?? safe.shipment_type).toLowerCase() || "both",
    airFreightDays: numberOrNull(safe.airFreightDays ?? safe.air_freight_days),
    seaFreightDays: numberOrNull(safe.seaFreightDays ?? safe.sea_freight_days),
    status: text(safe.status).toLowerCase() || "draft",
    notes: text(safe.notes),
    createdAt: text(safe.createdAt ?? safe.created_at),
    updatedAt: text(safe.updatedAt ?? safe.updated_at),
  };
}

function mapBatchPayload(batch) {
  const safe = normalizeBatch(batch);
  return {
    id: safe.id || null,
    batch_number: safe.batchNumber,
    title: safe.title || null,
    start_date: safe.startDate || null,
    end_date: safe.endDate || null,
    shipment_type: safe.shipmentType,
    air_freight_days: safe.airFreightDays,
    sea_freight_days: safe.seaFreightDays,
    status: safe.status,
    notes: safe.notes || null,
  };
}

export async function loadAdminBatches() {
  const { data, error } = await supabase
    .from("import_batches")
    .select("id,batch_number,title,start_date,end_date,shipment_type,air_freight_days,sea_freight_days,status,notes,created_at,updated_at")
    .order("start_date", { ascending: false })
    .order("created_at", { ascending: false });

  if (error) throw error;
  return (data ?? []).map(normalizeBatch);
}

export async function loadCurrentBatch() {
  const { data, error } = await supabase.rpc("get_current_import_batch");
  if (error) return null;
  return data ? normalizeBatch(Array.isArray(data) ? data[0] : data) : null;
}

export async function saveBatch(batch) {
  const { data, error } = await supabase.rpc("save_import_batch", {
    payload: mapBatchPayload(batch),
  });
  if (error) return { ok: false, message: error.message || "Unable to save the batch.", error };
  return { ok: true, batch: normalizeBatch(data) };
}

export async function updateBatchStatus(id, status) {
  const { data, error } = await supabase.rpc("set_import_batch_status", {
    p_batch_id: id,
    p_status: status,
  });
  if (error) return { ok: false, message: error.message || "Unable to update the batch.", error };
  return { ok: true, batch: normalizeBatch(data) };
}
