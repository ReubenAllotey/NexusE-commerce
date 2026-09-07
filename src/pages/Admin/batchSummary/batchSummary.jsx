import { useEffect, useMemo, useState } from "react";
import { Navigate } from "react-router-dom";
import { loadAdminSession } from "../Auth/adminAuthStorage";
import { formatMoney, formatShortDate } from "../adminHelpers";
import { loadAdminBatches } from "../../../shared/batchStorage";

function normalize(value) {
  return String(value ?? "").trim().toLowerCase();
}

function availabilityLabel(value) {
  const type = normalize(value);
  if (type === "preorder") return "Pre-order";
  if (type === "coming_soon") return "Coming Soon";
  return "Ready Stock";
}

function availabilityTone(value) {
  return normalize(value) === "preorder" ? "amber" : "blue";
}

function isEligibleOrder(order) {
  const paymentStatus = normalize(order?.paymentStatus ?? order?.payment_status);
  const status = normalize(order?.status);
  return ["paid", "successful"].includes(paymentStatus) && !["cancelled", "canceled", "failed"].includes(status);
}

function getItemOptions(item = {}) {
  const selected = Array.isArray(item.selectedOptions) ? item.selectedOptions : [];
  if (selected.length > 0) {
    return selected
      .map((option) => ({
        group: String(option?.groupName ?? option?.group_name ?? option?.group ?? "Option").trim(),
        value: String(option?.label ?? option?.value ?? "").trim(),
      }))
      .filter((option) => option.group && option.value);
  }

  return [
    { group: "Color", value: String(item?.variant?.color ?? item?.selectedColor ?? "").trim() },
    { group: "Size", value: String(item?.variant?.size ?? item?.selectedSize ?? "").trim() },
  ].filter((option) => option.value);
}

function optionKey(options) {
  return options
    .map((option) => `${normalize(option.group)}=${normalize(option.value)}`)
    .sort()
    .join("|");
}

function formatVariantDetails(options) {
  if (options.length === 0) return "Base product";
  return options.map((option) => `${option.group}: ${option.value}`).join(" • ");
}

function getOrderNumber(order) {
  return order?.orderNumber || order?.id || "Order";
}

function downloadCsv(rows, batchNumber) {
  const headings = ["Batch", "Product Name", "SKU/Slug", "Variant Details", "Availability", "Quantity", "Unit Price", "Total Value", "Orders"];
  const lines = rows.map((row) => [
    batchNumber,
    row.name,
    row.slug,
    formatVariantDetails(row.options),
    availabilityLabel(row.availabilityType),
    row.quantity,
    row.unitPrice == null ? "Mixed historical prices" : row.unitPrice.toFixed(2),
    row.totalValue.toFixed(2),
    row.orders.map((order) => getOrderNumber(order)).join("; "),
  ]);
  const csv = [headings, ...lines]
    .map((line) => line.map((value) => `"${String(value ?? "").replaceAll('"', '""')}"`).join(","))
    .join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `nexus-batch-${String(batchNumber).replace(/[^a-z0-9-_]/gi, "-")}-summary.csv`;
  link.click();
  URL.revokeObjectURL(url);
}

function BatchSummaryPage({ orders = [] }) {
  const session = loadAdminSession();
  const [selectedBatch, setSelectedBatch] = useState("");
  const [query, setQuery] = useState("");
  const [availabilityFilter, setAvailabilityFilter] = useState("all");
  const [traceRow, setTraceRow] = useState(null);
  const [managedBatches, setManagedBatches] = useState([]);

  useEffect(() => {
    let active = true;
    loadAdminBatches().then((items) => {
      if (active) setManagedBatches(items);
    }).catch(() => {
      if (active) setManagedBatches([]);
    });
    return () => { active = false; };
  }, []);

  const eligibleOrders = useMemo(() => orders.filter(isEligibleOrder), [orders]);
  const batches = useMemo(
    () => {
      const managed = managedBatches.map((batch) => batch.batchNumber).filter(Boolean);
      const historical = eligibleOrders.map((order) => String(order.batchNumber ?? order.batch_number ?? "").trim()).filter(Boolean);
      return [...new Set([...managed, ...historical])];
    },
    [eligibleOrders, managedBatches],
  );
  const activeBatch = selectedBatch || batches[0] || "";

  const allRows = useMemo(() => {
    const grouped = new Map();
    eligibleOrders
      .filter((order) => String(order.batchNumber ?? order.batch_number ?? "").trim() === activeBatch)
      .forEach((order) => {
        (Array.isArray(order.items) ? order.items : []).forEach((item) => {
          const availabilityType = normalize(item.availabilityType ?? item.availability_type);
          if (availabilityType === "coming_soon") return;

          const options = getItemOptions(item);
          const key = [
            item.productId ?? item.product_id ?? item.slug ?? item.productSlug ?? item.name,
            optionKey(options),
            availabilityType,
          ].map(normalize).join("::");
          const quantity = Math.max(Number(item.quantity) || 1, 1);
          const unitPrice = Number(item.price ?? item.unitPrice ?? item.unit_price) || 0;
          const lineValue = Number(item.lineSubtotal ?? item.line_subtotal);
          const totalValue = Number.isFinite(lineValue) && lineValue >= 0 ? lineValue : unitPrice * quantity;
          const current = grouped.get(key) ?? {
            key,
            name: item.name || "Unnamed product",
            slug: item.slug || "",
            image: item.image || item.imageUrl || item.image_url || "",
            options,
            availabilityType: availabilityType || "ready_stock",
            quantity: 0,
            totalValue: 0,
            unitPrices: [],
            orders: [],
            contributions: [],
          };

          current.quantity += quantity;
          current.totalValue += totalValue;
          if (!current.unitPrices.some((value) => value === unitPrice)) current.unitPrices.push(unitPrice);
          if (!current.image && (item.image || item.imageUrl || item.image_url)) {
            current.image = item.image || item.imageUrl || item.image_url;
          }
          if (!current.orders.some((entry) => entry.id === order.id)) current.orders.push(order);
          const contribution = current.contributions.find((entry) => entry.order.id === order.id);
          if (contribution) {
            contribution.quantity += quantity;
          } else {
            current.contributions.push({ order, quantity });
          }
          grouped.set(key, current);
        });
      });

    return [...grouped.values()]
      .map((row) => ({
        ...row,
        unitPrice: row.unitPrices.length === 1 ? row.unitPrices[0] : null,
      }))
      .sort((left, right) => left.name.localeCompare(right.name) || formatVariantDetails(left.options).localeCompare(formatVariantDetails(right.options)));
  }, [activeBatch, eligibleOrders]);

  const rows = useMemo(
    () => allRows.filter((row) => {
      const matchesAvailability = availabilityFilter === "all" || row.availabilityType === availabilityFilter;
      const blob = `${row.name} ${row.slug} ${formatVariantDetails(row.options)}`.toLowerCase();
      return matchesAvailability && (!query.trim() || blob.includes(query.trim().toLowerCase()));
    }),
    [allRows, availabilityFilter, query],
  );

  const batchOrders = useMemo(
    () => eligibleOrders.filter((order) => String(order.batchNumber ?? order.batch_number ?? "").trim() === activeBatch),
    [activeBatch, eligibleOrders],
  );
  const metrics = useMemo(() => ({
    products: allRows.length,
    units: allRows.reduce((sum, row) => sum + row.quantity, 0),
    orders: batchOrders.length,
    value: allRows.reduce((sum, row) => sum + row.totalValue, 0),
  }), [allRows, batchOrders.length]);

  if (!session) return <Navigate to="/admin/login" replace />;

  return (
    <main className="admin-orders-page admin-batch-summary-page">
      <section className="admin-orders-shell admin-batch-summary-shell">
        <header className="admin-orders-header">
          <div>
            <p>Admin fulfillment</p>
            <h1>Batch Summary</h1>
            <span>See exactly what needs to be sourced for the selected order batch.</span>
          </div>
          <button type="button" className="admin-orders-header__button" onClick={() => downloadCsv(rows, activeBatch || "unselected")} disabled={!activeBatch || rows.length === 0}>
            Export CSV
          </button>
        </header>

        <section className="admin-orders-panel admin-batch-summary-panel">
          <div className="admin-batch-summary-toolbar">
            <label>
              <span>Batch</span>
              <select value={activeBatch} onChange={(event) => setSelectedBatch(event.target.value)}>
                {batches.length === 0 ? <option value="">No batches available</option> : null}
                {batches.map((batch) => <option key={batch} value={batch}>{batch}</option>)}
              </select>
            </label>
            <label>
              <span>Search product</span>
              <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Product or variant" />
            </label>
            <label>
              <span>Availability</span>
              <select value={availabilityFilter} onChange={(event) => setAvailabilityFilter(event.target.value)}>
                <option value="all">All types</option>
                <option value="ready_stock">Ready Stock</option>
                <option value="preorder">Pre-order</option>
              </select>
            </label>
          </div>
        </section>

        <section className="admin-orders-summary admin-batch-summary-cards">
          <article className="admin-orders-stat admin-orders-stat--indigo"><span>Total Products</span><strong>{metrics.products}</strong><small>Unique product configurations.</small></article>
          <article className="admin-orders-stat admin-orders-stat--blue"><span>Total Units</span><strong>{metrics.units}</strong><small>Units across eligible orders.</small></article>
          <article className="admin-orders-stat admin-orders-stat--amber"><span>Total Orders</span><strong>{metrics.orders}</strong><small>Paid orders in this batch.</small></article>
          <article className="admin-orders-stat admin-orders-stat--green"><span>Total Value</span><strong>{formatMoney(metrics.value)}</strong><small>Historical line-item value.</small></article>
        </section>

        <section className="admin-orders-panel admin-batch-summary-table-panel">
          <div className="admin-batch-summary-section-heading">
            <div><p>Procurement list</p><h2>{activeBatch || "No batch selected"}</h2></div>
            <small>{rows.length} aggregated configuration{rows.length === 1 ? "" : "s"}</small>
          </div>
          <div className="admin-batch-summary-table-wrap">
            <table className="admin-batch-summary-table">
              <thead><tr><th>Image</th><th>Product</th><th>Variant Details</th><th>Availability</th><th>Quantity</th><th>Unit Price</th><th>Total Value</th><th>Orders</th></tr></thead>
              <tbody>
                {rows.length === 0 ? (
                  <tr><td colSpan="8"><div className="admin-batch-summary-empty"><h2>No eligible order items found.</h2><p>Choose another batch or adjust the filters.</p></div></td></tr>
                ) : rows.map((row) => (
                  <tr key={row.key}>
                    <td>{row.image ? <img className="admin-batch-summary-image" src={row.image} alt="" /> : <span className="admin-batch-summary-image admin-batch-summary-image--empty" />}</td>
                    <td><strong>{row.name}</strong><small>{row.slug || "No SKU snapshot"}</small></td>
                    <td>{formatVariantDetails(row.options)}</td>
                    <td><span className={`admin-orders-pill admin-orders-pill--${availabilityTone(row.availabilityType)}`}>{availabilityLabel(row.availabilityType)}</span></td>
                    <td><strong>{row.quantity}</strong></td>
                    <td>{row.unitPrice == null ? "Mixed" : formatMoney(row.unitPrice)}</td>
                    <td>{formatMoney(row.totalValue)}</td>
                    <td><button type="button" className="admin-batch-summary-orders-button" onClick={() => setTraceRow(row)}>{row.orders.length} orders</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </section>

      {traceRow ? <div className="admin-batch-summary-modal" role="dialog" aria-modal="true" aria-labelledby="batch-trace-title">
        <button type="button" className="admin-batch-summary-modal__scrim" aria-label="Close order trace" onClick={() => setTraceRow(null)} />
        <section className="admin-batch-summary-modal__panel">
          <header><div><p>Order traceability</p><h2 id="batch-trace-title">{traceRow.name}</h2><span>{formatVariantDetails(traceRow.options)}</span></div><button type="button" onClick={() => setTraceRow(null)}>Close</button></header>
          <div className="admin-batch-summary-trace-list">
            {traceRow.contributions.map(({ order, quantity }) => <article key={order.id}><strong>{getOrderNumber(order)}</strong><span>{order.customerName || "Customer"}</span><small>{quantity} units · {formatShortDate(order.createdAt)} · Order: {order.status || "Unknown"} · Payment: {order.paymentStatus || "Unknown"}</small></article>)}
          </div>
        </section>
      </div> : null}
    </main>
  );
}

export default BatchSummaryPage;
