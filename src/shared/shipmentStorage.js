import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "../lib/supabaseClient";

export const SHIPMENT_STEPS = [
  { key: "confirmed", label: "Orders confirmed", status: "preparing" },
  { key: "packed", label: "Orders packed for shipment", status: "shipped_from_china" },
  { key: "departed", label: "Items depart from China port", status: "in_transit" },
  { key: "arrived", label: "Orders arrived at Ghana port", status: "arrived_in_ghana" },
  { key: "delivery", label: "Orders packed for delivery", status: "out_for_delivery" },
];

const SHIPMENT_STATUSES = new Set([
  "preparing",
  "shipped_from_china",
  "in_transit",
  "arrived_in_ghana",
  "out_for_delivery",
  "delivered",
]);

const SHIPMENT_METHODS = new Set(["air", "sea", "both"]);

const STATUS_BY_STEP = SHIPMENT_STEPS.map((step) => step.status);

function clean(value) {
  return String(value ?? "").trim();
}

function normalizeKey(value) {
  return clean(value).toLowerCase();
}

function toNumber(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function clampStepIndex(value) {
  const stepIndex = Math.max(Math.min(Math.round(toNumber(value, 0)), SHIPMENT_STEPS.length - 1), 0);
  return stepIndex;
}

function normalizeShipmentMethod(value) {
  const normalized = normalizeKey(value);

  if (normalized === "sea freight") {
    return "sea";
  }

  if (normalized === "air freight") {
    return "air";
  }

  if (normalized === "sea" || normalized === "air" || normalized === "both") {
    return normalized;
  }

  return "air";
}

function normalizeShipmentStatus(value, fallback = "preparing") {
  const normalized = normalizeKey(value);
  return SHIPMENT_STATUSES.has(normalized) ? normalized : fallback;
}

function getStatusForStep(stepIndex) {
  return STATUS_BY_STEP[clampStepIndex(stepIndex)] ?? "preparing";
}

function getStepLabel(stepIndex) {
  return SHIPMENT_STEPS[clampStepIndex(stepIndex)]?.label ?? SHIPMENT_STEPS[0].label;
}

function getLocationForStatus(status) {
  switch (normalizeShipmentStatus(status)) {
    case "shipped_from_china":
      return "China Port";
    case "in_transit":
      return "In transit";
    case "arrived_in_ghana":
      return "Tema Port";
    case "out_for_delivery":
      return "Local delivery hub";
    case "delivered":
      return "Delivered";
    default:
      return "Warehouse";
  }
}

function getStatusLabel(status) {
  switch (normalizeShipmentStatus(status)) {
    case "shipped_from_china":
      return "Shipped from China";
    case "in_transit":
      return "In transit";
    case "arrived_in_ghana":
      return "Arrived in Ghana";
    case "out_for_delivery":
      return "Out for delivery";
    case "delivered":
      return "Delivered";
    default:
      return "Preparing";
  }
}

function getCurrentStepFromStatus(status) {
  switch (normalizeShipmentStatus(status)) {
    case "delivered":
    case "out_for_delivery":
      return 4;
    case "arrived_in_ghana":
      return 3;
    case "in_transit":
      return 2;
    case "shipped_from_china":
      return 1;
    default:
      return 0;
  }
}

function getStepState(currentStep, index, status = "") {
  const resolvedStatus = normalizeShipmentStatus(status);

  if (resolvedStatus === "delivered") {
    return "done";
  }

  if (index < currentStep) {
    return "done";
  }

  if (index === currentStep) {
    return "active";
  }

  return "pending";
}

function getProgressPercent(currentStep, status = "") {
  if (normalizeShipmentStatus(status) === "delivered") {
    return 100;
  }

  const safeStep = clampStepIndex(currentStep);
  const denominator = Math.max(SHIPMENT_STEPS.length - 1, 1);
  return Math.round((safeStep / denominator) * 100);
}

function getShippingMethodLabel(value) {
  switch (normalizeShipmentMethod(value)) {
    case "sea":
      return "Sea Freight";
    case "both":
      return "Sea & Air";
    default:
      return "Air Freight";
  }
}

function readField(source = {}, camelKey, snakeKey, fallback = null) {
  if (source && Object.prototype.hasOwnProperty.call(source, camelKey)) {
    return source[camelKey];
  }

  if (source && Object.prototype.hasOwnProperty.call(source, snakeKey)) {
    return source[snakeKey];
  }

  return fallback;
}

function mapShipmentEventRow(row = {}) {
  return {
    id: clean(readField(row, "id", "id")),
    shipmentId: clean(readField(row, "shipmentId", "shipment_id")),
    status: normalizeShipmentStatus(readField(row, "status", "status"), "preparing"),
    stepIndex: clampStepIndex(readField(row, "stepIndex", "step_index")),
    title: clean(readField(row, "title", "title")) || "Shipment update",
    message: clean(readField(row, "message", "message")),
    location: clean(readField(row, "location", "location")) || getLocationForStatus(readField(row, "status", "status")),
    eventAt: readField(row, "eventAt", "event_at"),
    createdAt: readField(row, "createdAt", "created_at"),
  };
}

function mapShipmentRow(row = {}, orderRow = null, events = []) {
  const currentStatus = normalizeShipmentStatus(readField(row, "currentStatus", "current_status"), getStatusForStep(readField(row, "currentStep", "current_step")));
  const currentStep = currentStatus === "delivered"
    ? 4
    : clampStepIndex(readField(row, "currentStep", "current_step"));
  const batchNumber = clean(readField(row, "batchNumber", "batch_number"));
  const order = orderRow && typeof orderRow === "object" ? orderRow : null;

  const normalizedEvents = [...(Array.isArray(events) ? events : [])]
    .map(mapShipmentEventRow)
    .sort((left, right) => new Date(right.eventAt ?? right.createdAt ?? 0) - new Date(left.eventAt ?? left.createdAt ?? 0));

  const stepStates = SHIPMENT_STEPS.map((step, index) => ({
    ...step,
    state: getStepState(currentStep, index, currentStatus),
  }));

  const latestEvent = normalizedEvents[0] ?? null;

  return {
    id: clean(readField(row, "id", "id")),
    orderId: clean(readField(row, "orderId", "order_id")),
    orderNumber: clean(order?.order_number ?? order?.orderNumber ?? readField(row, "orderNumber", "order_number")),
    customerId: clean(order?.user_id ?? order?.userId ?? order?.customerId),
    customerName: clean(order?.customer_name ?? order?.customerName),
    customerEmail: clean(order?.customer_email ?? order?.customerEmail),
    batchNumber,
    shippingMethod: normalizeShipmentMethod(readField(row, "shippingMethod", "shipping_method")),
    shippingMethodLabel: getShippingMethodLabel(readField(row, "shippingMethod", "shipping_method")),
    currentStatus,
    currentStatusLabel: getStatusLabel(currentStatus),
    currentStep,
    stepLabel: getStepLabel(currentStep),
    progressPercent: getProgressPercent(currentStep, currentStatus),
    headline: clean(readField(row, "headline", "headline")),
    body: clean(readField(row, "body", "body")),
    shippedAt: readField(row, "shippedAt", "shipped_at"),
    arrivedCountryAt: readField(row, "arrivedCountryAt", "arrived_country_at"),
    outForDeliveryAt: readField(row, "outForDeliveryAt", "out_for_delivery_at"),
    deliveredAt: readField(row, "deliveredAt", "delivered_at"),
    createdAt: readField(row, "createdAt", "created_at"),
    updatedAt: readField(row, "updatedAt", "updated_at"),
    stepStates,
    events: normalizedEvents,
    latestEvent,
    order: order,
  };
}

function buildShipmentBatchSummaries(shipments = []) {
  const groups = new Map();

  for (const shipment of Array.isArray(shipments) ? shipments : []) {
    const batchKey = normalizeKey(shipment.batchNumber || shipment.orderNumber || shipment.orderId || shipment.id);
    const existing = groups.get(batchKey) ?? {
      batchNumber: shipment.batchNumber || shipment.orderNumber || shipment.orderId || shipment.id,
      shippingMethod: shipment.shippingMethod,
      shippingMethodLabel: shipment.shippingMethodLabel,
      currentStatus: shipment.currentStatus,
      currentStatusLabel: shipment.currentStatusLabel,
      currentStep: shipment.currentStep,
      stepLabel: shipment.stepLabel,
      progressPercent: shipment.progressPercent,
      headline: shipment.headline,
      body: shipment.body,
      shippedAt: shipment.shippedAt,
      arrivedCountryAt: shipment.arrivedCountryAt,
      outForDeliveryAt: shipment.outForDeliveryAt,
      deliveredAt: shipment.deliveredAt,
      createdAt: shipment.createdAt,
      updatedAt: shipment.updatedAt,
      stepStates: shipment.stepStates,
      latestEvent: shipment.latestEvent,
      events: [],
      shipments: [],
      orders: [],
      shipmentIds: [],
      orderCount: 0,
      customerCount: 0,
    };

    existing.shipments.push(shipment);
    existing.shipmentIds.push(shipment.id);

    if (shipment.order) {
      existing.orders.push(shipment.order);
    }

    existing.events.push(...shipment.events);

    const currentUpdatedAt = new Date(existing.updatedAt ?? 0).getTime();
    const nextUpdatedAt = new Date(shipment.updatedAt ?? shipment.createdAt ?? 0).getTime();

    if (nextUpdatedAt >= currentUpdatedAt) {
      existing.shippingMethod = shipment.shippingMethod;
      existing.shippingMethodLabel = shipment.shippingMethodLabel;
      existing.currentStatus = shipment.currentStatus;
      existing.currentStatusLabel = shipment.currentStatusLabel;
      existing.currentStep = shipment.currentStep;
      existing.stepLabel = shipment.stepLabel;
      existing.progressPercent = shipment.progressPercent;
      existing.headline = shipment.headline;
      existing.body = shipment.body;
      existing.shippedAt = shipment.shippedAt;
      existing.arrivedCountryAt = shipment.arrivedCountryAt;
      existing.outForDeliveryAt = shipment.outForDeliveryAt;
      existing.deliveredAt = shipment.deliveredAt;
      existing.updatedAt = shipment.updatedAt;
      existing.stepStates = shipment.stepStates;
      existing.latestEvent = shipment.latestEvent ?? existing.latestEvent;
    }

    groups.set(batchKey, existing);
  }

  return [...groups.values()]
    .map((group) => {
      const uniqueOrders = new Map();
      const uniqueCustomers = new Set();

      for (const order of group.orders) {
        if (!order?.id) {
          continue;
        }

        uniqueOrders.set(order.id, order);
        uniqueCustomers.add(
          normalizeKey(
            order.user_id ||
              order.userId ||
              order.customerId ||
              order.customer_email ||
              order.customerEmail ||
              order.customer_name ||
              order.customerName ||
              order.id,
          ),
        );
      }

      const uniqueEvents = [...group.events]
        .filter((event, index, list) => list.findIndex((candidate) => candidate.id === event.id) === index)
        .sort((left, right) => new Date(right.eventAt ?? right.createdAt ?? 0) - new Date(left.eventAt ?? left.createdAt ?? 0));

      return {
        ...group,
        orders: [...uniqueOrders.values()].sort(
          (left, right) =>
            new Date(left.created_at ?? left.createdAt ?? 0) - new Date(right.created_at ?? right.createdAt ?? 0),
        ),
        orderCount: uniqueOrders.size,
        customerCount: uniqueCustomers.size,
        events: uniqueEvents,
        latestEvent: uniqueEvents[0] ?? group.latestEvent ?? null,
      };
    })
    .sort(
      (left, right) =>
        new Date(right.updatedAt ?? right.createdAt ?? 0) - new Date(left.updatedAt ?? left.createdAt ?? 0) ||
        clean(left.batchNumber).localeCompare(clean(right.batchNumber)),
    );
}

async function loadShipmentRows({ orderIds = [] } = {}) {
  const orderIdList = [...new Set((Array.isArray(orderIds) ? orderIds : []).map((value) => clean(value)).filter(Boolean))];

  let query = supabase
    .from("shipments")
    .select(
      [
        "id",
        "order_id",
        "batch_number",
        "shipping_method",
        "current_status",
        "current_step",
        "headline",
        "body",
        "shipped_at",
        "arrived_country_at",
        "out_for_delivery_at",
        "delivered_at",
        "created_at",
        "updated_at",
      ].join(","),
    )
    .order("updated_at", { ascending: false })
    .order("created_at", { ascending: false })
    .order("id", { ascending: false });

  if (orderIdList.length > 0) {
    query = query.in("order_id", orderIdList);
  }

  const { data: shipmentRows, error } = await query;

  if (error) {
    return { ok: false, message: error.message || "Unable to load shipment records.", rows: [], eventsByShipmentId: new Map() };
  }

  const rows = Array.isArray(shipmentRows) ? shipmentRows : [];
  const shipmentIds = rows.map((row) => clean(row.id)).filter(Boolean);
  const eventsByShipmentId = new Map();

  if (shipmentIds.length > 0) {
    const { data: eventRows, error: eventError } = await supabase
      .from("shipment_events")
      .select(
        [
          "id",
          "shipment_id",
          "status",
          "step_index",
          "title",
          "message",
          "location",
          "event_at",
          "created_at",
        ].join(","),
      )
      .in("shipment_id", shipmentIds)
      .order("event_at", { ascending: true })
      .order("created_at", { ascending: true })
      .order("id", { ascending: true });

    if (eventError) {
      return {
        ok: false,
        message: eventError.message || "Unable to load shipment events.",
        rows: [],
        eventsByShipmentId: new Map(),
      };
    }

    for (const event of Array.isArray(eventRows) ? eventRows : []) {
      const shipmentId = clean(event.shipment_id);

      if (!shipmentId) {
        continue;
      }

      const existing = eventsByShipmentId.get(shipmentId) ?? [];
      existing.push(event);
      eventsByShipmentId.set(shipmentId, existing);
    }
  }

  return {
    ok: true,
    rows,
    eventsByShipmentId,
  };
}

async function getCurrentAuthUser() {
  const { data, error } = await supabase.auth.getUser();

  if (error) {
    return { ok: false, message: error.message || "Unable to resolve the signed-in user.", user: null };
  }

  if (!data?.user) {
    return { ok: false, message: "Please sign in to continue.", user: null };
  }

  return { ok: true, user: data.user };
}

async function loadCurrentProfile(userId) {
  const { data, error } = await supabase
    .from("profiles")
    .select("id, full_name, email, role, status")
    .eq("id", userId)
    .maybeSingle();

  if (error) {
    return { ok: false, message: error.message || "Unable to load the profile.", profile: null };
  }

  if (!data) {
    return { ok: false, message: "The active profile could not be found.", profile: null };
  }

  return {
    ok: true,
    profile: {
      id: data.id,
      name: clean(data.full_name) || "Customer",
      email: clean(data.email),
      role: clean(data.role) || "customer",
      status: clean(data.status) || "active",
    },
  };
}

function ensureShipmentPayload(payload = {}) {
  const source = payload && typeof payload === "object" && !Array.isArray(payload) ? payload : {};
  const batchNumber = clean(source.batch_number ?? source.batchNumber);
  const orderId = clean(source.order_id ?? source.orderId);
  const shipmentId = clean(source.shipment_id ?? source.shipmentId);
  const headline = clean(source.headline ?? source.title);
  const body = clean(source.body ?? source.message);
  const shippingMethod = normalizeShipmentMethod(source.shipping_method ?? source.shippingMethod);
  const currentStep = clampStepIndex(source.current_step ?? source.currentStep ?? source.step_index);
  const currentStatus = normalizeShipmentStatus(
    source.current_status ?? source.currentStatus,
    getStatusForStep(currentStep),
  );
  const allowCorrection = Boolean(source.allow_correction ?? source.allowCorrection);
  const location = clean(source.location ?? source.eventLocation);
  const eventTitle = clean(source.event_title ?? source.eventTitle) || headline || SHIPMENT_STEPS[currentStep].label;
  const eventMessage = clean(source.event_message ?? source.eventMessage) || body;

  return {
    batch_number: batchNumber,
    order_id: orderId,
    shipment_id: shipmentId,
    headline,
    body,
    shipping_method: shippingMethod,
    current_step: currentStatus === "delivered" ? 4 : currentStep,
    current_status: currentStatus === "delivered" ? "delivered" : currentStatus,
    allow_correction: allowCorrection,
    location: location || getLocationForStatus(currentStatus),
    event_title: eventTitle,
    event_message: eventMessage,
    event_at: source.event_at ?? source.eventAt ?? null,
  };
}

async function ensureActiveAdmin() {
  const userResult = await getCurrentAuthUser();

  if (!userResult.ok) {
    return userResult;
  }

  const profileResult = await loadCurrentProfile(userResult.user.id);

  if (!profileResult.ok) {
    return profileResult;
  }

  if (profileResult.profile.role !== "admin" || profileResult.profile.status !== "active") {
    return { ok: false, message: "Only active administrators can manage shipments.", user: userResult.user, profile: profileResult.profile };
  }

  return { ok: true, user: userResult.user, profile: profileResult.profile };
}

export async function loadShipmentForOrder(orderId) {
  const normalizedOrderId = clean(orderId);

  if (!normalizedOrderId) {
    return { ok: true, shipment: null };
  }

  const result = await loadShipmentRows({ orderIds: [normalizedOrderId] });

  if (!result.ok) {
    return { ok: false, message: result.message, shipment: null };
  }

  const rawShipment = result.rows.find((row) => clean(row.order_id) === normalizedOrderId) ?? null;

  if (!rawShipment) {
    return { ok: true, shipment: null };
  }

  const shipment = mapShipmentRow(
    rawShipment,
    null,
    result.eventsByShipmentId.get(clean(rawShipment.id)) ?? [],
  );

  return { ok: true, shipment };
}

export async function loadShipmentDashboard({ orders = [] } = {}) {
  const orderLookup = new Map(
    (Array.isArray(orders) ? orders : [])
      .filter((order) => order && typeof order === "object" && order.id)
      .map((order) => [clean(order.id), order]),
  );
  const orderIds = [...orderLookup.keys()];
  const result = await loadShipmentRows({ orderIds });

  if (!result.ok) {
    return {
      ok: false,
      message: result.message,
      shipments: [],
      shipmentRows: [],
      shipmentsByOrderId: new Map(),
      shipmentsByBatchNumber: new Map(),
    };
  }

  const mappedRows = result.rows.map((row) =>
    mapShipmentRow(
      row,
      orderLookup.get(clean(row.order_id)) ?? null,
      result.eventsByShipmentId.get(clean(row.id)) ?? [],
    ),
  );
  const shipmentsByOrderId = new Map(mappedRows.map((shipment) => [shipment.orderId, shipment]));
  const shipmentsByBatchNumber = new Map(mappedRows.map((shipment) => [normalizeKey(shipment.batchNumber), shipment]));
  const shipments = buildShipmentBatchSummaries(mappedRows);

  return {
    ok: true,
    shipments,
    shipmentRows: mappedRows,
    shipmentsByOrderId,
    shipmentsByBatchNumber,
  };
}

export async function createOrUpdateShipment(payload = {}) {
  const adminResult = await ensureActiveAdmin();

  if (!adminResult.ok) {
    return {
      ok: false,
      message: adminResult.message,
      shipment: null,
      shipments: [],
    };
  }

  const normalized = ensureShipmentPayload(payload);

  if (!normalized.batch_number && !normalized.order_id) {
    return {
      ok: false,
      message: "A batch number or order id is required.",
      shipment: null,
      shipments: [],
    };
  }

  const { data, error } = await supabase.rpc("create_or_update_shipment", {
    payload: normalized,
  });

  if (error) {
    return {
      ok: false,
      message: error.message || "Unable to save the shipment progress.",
      shipment: null,
      shipments: [],
    };
  }

  return {
    ok: true,
    shipment: data ?? null,
    shipments: Array.isArray(data?.shipments) ? data.shipments : [],
    raw: data ?? null,
  };
}

export async function addShipmentEvent(payload = {}) {
  const adminResult = await ensureActiveAdmin();

  if (!adminResult.ok) {
    return {
      ok: false,
      message: adminResult.message,
      event: null,
      events: [],
    };
  }

  const normalized = ensureShipmentPayload(payload);

  if (!normalized.batch_number && !normalized.order_id && !clean(payload?.shipment_id)) {
    return {
      ok: false,
      message: "A shipment id, order id, or batch number is required.",
      event: null,
      events: [],
    };
  }

  const { data, error } = await supabase.rpc("add_shipment_event", {
    payload: normalized,
  });

  if (error) {
    return {
      ok: false,
      message: error.message || "Unable to add the shipment event.",
      event: null,
      events: [],
    };
  }

  return {
    ok: true,
    event: data ?? null,
    events: Array.isArray(data?.events) ? data.events : [],
    raw: data ?? null,
  };
}

export function useShipmentBatches({ orders = [] } = {}) {
  const [state, setState] = useState({
    loading: true,
    error: "",
    shipments: [],
    shipmentRows: [],
    shipmentsByOrderId: new Map(),
    shipmentsByBatchNumber: new Map(),
  });
  const [refreshToken, setRefreshToken] = useState(0);
  const requestIdRef = useRef(0);

  const orderKey = useMemo(
    () =>
      (Array.isArray(orders)
        ? orders
            .map(
              (order) =>
                `${clean(order?.id)}:${clean(order?.updatedAt ?? order?.updated_at ?? order?.createdAt ?? order?.created_at)}:${clean(order?.batchNumber ?? order?.batch_number)}`,
            )
            .filter((value) => value.split(":")[0])
            .join("|")
        : ""),
    [orders],
  );

  const refresh = useCallback(() => {
    setRefreshToken((value) => value + 1);
  }, []);

  useEffect(() => {
    let isMounted = true;
    const requestId = ++requestIdRef.current;

    const load = async () => {
      setState((current) => ({
        ...current,
        loading: true,
        error: "",
      }));

      const result = await loadShipmentDashboard({ orders });

      if (!isMounted || requestId !== requestIdRef.current) {
        return;
      }

      if (!result.ok) {
        setState({
          loading: false,
          error: result.message || "Unable to load shipment data.",
          shipments: [],
          shipmentRows: [],
          shipmentsByOrderId: new Map(),
          shipmentsByBatchNumber: new Map(),
        });
        return;
      }

      setState({
        loading: false,
        error: "",
        shipments: result.shipments,
        shipmentRows: result.shipmentRows,
        shipmentsByOrderId: result.shipmentsByOrderId,
        shipmentsByBatchNumber: result.shipmentsByBatchNumber,
      });
    };

    void load();

    return () => {
      isMounted = false;
    };
  }, [orderKey, refreshToken]);

  return {
    ...state,
    refresh,
  };
}

export {
  getProgressPercent as getShipmentProgressPercent,
  getShippingMethodLabel as getShipmentShippingMethodLabel,
  getStatusForStep as getShipmentStatusForStep,
  getStepLabel as getShipmentStepLabel,
  getStepState as getShipmentStepState,
  getCurrentStepFromStatus as getShipmentStepIndexFromStatus,
  getStatusLabel as getShipmentStatusLabel,
  getLocationForStatus as getShipmentLocationLabel,
  mapShipmentRow,
  mapShipmentEventRow,
};
