import { useEffect, useMemo, useState } from "react";
import { formatMoney, formatShortDate } from "../adminHelpers";
import { loadMonthlyReportData } from "./monthlyReportStorage";

const money = (value) => formatMoney(Number(value) || 0);
const text = (value) => String(value ?? "").trim();

function monthKey(value) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

function monthStart(key) {
  const [year, month] = key.split("-").map(Number);
  return new Date(year, (month || 1) - 1, 1);
}

function inMonth(value, key) {
  return monthKey(value) === key;
}

function labelForMonth(key) {
  return new Intl.DateTimeFormat("en-US", { month: "long", year: "numeric" }).format(monthStart(key));
}

function isSuccessful(payment) {
  return ["successful", "paid"].includes(text(payment?.status).toLowerCase());
}

function isCancelled(order) {
  return ["cancelled", "canceled"].includes(text(order?.status).toLowerCase());
}

function isAdmin(profile) {
  return text(profile?.role).toLowerCase() === "admin";
}

function customerKey(order) {
  return text(order?.user_id || order?.customer_email).toLowerCase();
}

function customerName(order, profilesById) {
  const profile = profilesById.get(order?.user_id);
  return text(profile?.full_name) || text(order?.customer_name) || text(order?.customer_email) || "Unknown customer";
}

function formatType(value) {
  const key = text(value).toLowerCase();
  if (key === "preorder") return "Pre-order";
  if (key === "ready_stock") return "Ready Stock";
  return key ? key.replaceAll("_", " ") : "Unknown";
}

function formatStatus(value) {
  const key = text(value).toLowerCase();
  if (key === "pending_payment") return "Pending Payment";
  if (key === "in_transit") return "In Transit";
  if (key === "cancelled" || key === "canceled") return "Cancelled";
  return key ? key.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase()) : "Unknown";
}

function getUniqueSuccessfulPayments(payments, ordersById) {
  const unique = new Map();
  for (const payment of payments.filter(isSuccessful)) {
    const order = ordersById.get(payment.order_id);
    const groupKey = text(order?.checkout_group_id) || `payment:${payment.id}`;
    if (!unique.has(groupKey)) unique.set(groupKey, payment);
  }
  return [...unique.values()];
}

function buildReport(data, key) {
  const orders = Array.isArray(data?.orders) ? data.orders : [];
  const items = Array.isArray(data?.orderItems) ? data.orderItems : [];
  const profiles = Array.isArray(data?.profiles) ? data.profiles : [];
  const batches = Array.isArray(data?.batches) ? data.batches : [];
  const ordersById = new Map(orders.map((order) => [order.id, order]));
  const profilesById = new Map(profiles.map((profile) => [profile.id, profile]));
  const itemsByOrder = new Map();

  for (const item of items) {
    const rows = itemsByOrder.get(item.order_id) || [];
    rows.push(item);
    itemsByOrder.set(item.order_id, rows);
  }

  const monthOrders = orders.filter((order) => inMonth(order.created_at, key));
  const monthPayments = (data?.payments || []).filter((payment) => inMonth(payment.paid_at || payment.created_at, key));
  const successfulPayments = getUniqueSuccessfulPayments(monthPayments, ordersById);
  const paidOrderIds = new Set();

  for (const payment of successfulPayments) {
    const order = ordersById.get(payment.order_id);
    if (!order) continue;
    const group = text(order.checkout_group_id);
    for (const sibling of orders) {
      if (sibling.id === order.id || (group && sibling.checkout_group_id === group)) paidOrderIds.add(sibling.id);
    }
  }

  const paidMonthOrders = monthOrders.filter((order) => paidOrderIds.has(order.id));
  const eligiblePaidOrders = paidMonthOrders.filter((order) => !isCancelled(order));
  const paidItemRows = eligiblePaidOrders.flatMap((order) => itemsByOrder.get(order.id) || []);
  const typeCount = (type) => monthOrders.filter((order) => text(order.order_type).toLowerCase() === type).length;
  const customers = profiles.filter((profile) => !isAdmin(profile) && text(profile.role).toLowerCase() === "customer");
  const customerKeys = new Set(paidMonthOrders.map(customerKey).filter(Boolean));
  const start = monthStart(key);
  const previousKey = monthKey(new Date(start.getFullYear(), start.getMonth() - 1, 1));
  const totalSales = successfulPayments.reduce((sum, payment) => sum + (Number(payment.amount) || 0), 0);
  const productSubtotal = eligiblePaidOrders.reduce((sum, order) => sum + (Number(order.subtotal) || 0), 0);
  const shippingCollected = eligiblePaidOrders.reduce((sum, order) => sum + (Number(order.shipping_total) || 0), 0);
  const statusCounts = {};
  for (const order of monthOrders) {
    const status = formatStatus(order.status);
    statusCounts[status] = (statusCounts[status] || 0) + 1;
  }

  const productMap = new Map();
  for (const item of paidItemRows) {
    const id = item.product_id || item.product_slug || item.product_name;
    const current = productMap.get(id) || { name: item.product_name || "Unnamed product", units: 0, sales: 0 };
    productMap.set(id, {
      ...current,
      units: current.units + (Number(item.quantity) || 0),
      sales: current.sales + (Number(item.line_subtotal) || (Number(item.unit_price) || 0) * (Number(item.quantity) || 0)),
    });
  }

  const dailyMap = new Map();
  for (const payment of successfulPayments) {
    const date = new Date(payment.paid_at || payment.created_at);
    dailyMap.set(date.getDate(), (dailyMap.get(date.getDate()) || 0) + (Number(payment.amount) || 0));
  }
  const daysInMonth = new Date(start.getFullYear(), start.getMonth() + 1, 0).getDate();
  const dailySales = Array.from({ length: daysInMonth }, (_, index) => ({ day: index + 1, sales: dailyMap.get(index + 1) || 0 }));
  const batchMap = new Map(batches.map((batch) => [batch.batch_number, batch]));
  const batchRows = [...new Set(monthOrders.map((order) => order.batch_number).filter(Boolean))].map((batchNumber) => {
    const batchOrders = paidMonthOrders.filter((order) => order.batch_number === batchNumber);
    const batchItems = batchOrders.flatMap((order) => itemsByOrder.get(order.id) || []);
    return {
      batch: batchNumber,
      status: batchMap.get(batchNumber)?.status || "historical",
      orders: batchOrders.length,
      units: batchItems.reduce((sum, item) => sum + (Number(item.quantity) || 0), 0),
      sales: batchOrders.reduce((sum, order) => sum + (Number(order.total) || 0), 0),
      air: batchItems.filter((item) => item.freight_type === "air").reduce((sum, item) => sum + (Number(item.quantity) || 0), 0),
      sea: batchItems.filter((item) => item.freight_type === "sea").reduce((sum, item) => sum + (Number(item.quantity) || 0), 0),
    };
  });
  const customerSpend = new Map();
  for (const order of eligiblePaidOrders) {
    const id = customerKey(order);
    if (id) customerSpend.set(id, (customerSpend.get(id) || 0) + (Number(order.total) || 0));
  }
  const topCustomers = [...customerSpend.entries()].map(([id, spend]) => {
    const order = orders.find((candidate) => customerKey(candidate) === id) || {};
    return { id, name: customerName(order, profilesById), spend };
  }).sort((a, b) => b.spend - a.spend).slice(0, 5);
  const newCustomers = customers.filter((profile) => inMonth(profile.created_at, key)).length;
  const orderedCustomers = customers.filter((profile) => customerKeys.has(text(profile.id).toLowerCase())).length;
  const returningCustomers = [...customerKeys].filter((id) => orders.some((order) => customerKey(order) === id && !inMonth(order.created_at, key))).length;
  const paymentBreakdown = ["successful", "pending", "failed"].map((status) => ({
    status,
    count: monthPayments.filter((payment) => text(payment.status).toLowerCase() === status).length,
    amount: monthPayments.filter((payment) => text(payment.status).toLowerCase() === status).reduce((sum, payment) => sum + (Number(payment.amount) || 0), 0),
  }));
  const topOrders = [...monthOrders].sort((a, b) => (Number(b.total) || 0) - (Number(a.total) || 0)).slice(0, 10);
  const previousOrders = orders.filter((order) => inMonth(order.created_at, previousKey));
  const previousPayments = (data?.payments || []).filter((payment) => inMonth(payment.paid_at || payment.created_at, previousKey));
  const previousSuccessfulPayments = getUniqueSuccessfulPayments(previousPayments, ordersById);
  const previousCustomers = customers.filter((profile) => inMonth(profile.created_at, previousKey)).length;

  return {
    key,
    summary: {
      totalSales,
      paidOrders: paidMonthOrders.length,
      totalOrders: monthOrders.length,
      newCustomers,
      readyOrders: typeCount("ready_stock"),
      preorderOrders: typeCount("preorder"),
      productSubtotal,
      shippingCollected,
      pendingPayments: paymentBreakdown.find((row) => row.status === "pending")?.amount || 0,
      averageOrderValue: paidMonthOrders.length ? totalSales / paidMonthOrders.length : 0,
    },
    statusCounts,
    dailySales,
    topProducts: [...productMap.values()].sort((a, b) => b.units - a.units || b.sales - a.sales).slice(0, 10),
    batchRows,
    customerActivity: { newCustomers, returningCustomers, orderedCustomers, topCustomers },
    paymentBreakdown,
    topOrders,
    comparison: {
      sales: { current: totalSales, previous: previousSuccessfulPayments.reduce((sum, payment) => sum + (Number(payment.amount) || 0), 0) },
      orders: { current: monthOrders.length, previous: previousOrders.length },
      customers: { current: newCustomers, previous: previousCustomers },
    },
  };
}

function change(current, previous) {
  if (!previous) return current ? "+100%" : "0%";
  const value = ((current - previous) / previous) * 100;
  return `${value >= 0 ? "+" : ""}${value.toFixed(1)}%`;
}

function csvCell(value) {
  return `"${String(value ?? "").replaceAll('"', '""')}"`;
}

function downloadCsv(report) {
  const rows = [["Monthly Report", labelForMonth(report.key)], [], ["Summary", "Value"], ...Object.entries(report.summary), [], ["Top Products", "Units", "Sales"], ...report.topProducts.map((row) => [row.name, row.units, row.sales]), [], ["Batches", "Status", "Orders", "Units", "Sales", "Air Units", "Sea Units"], ...report.batchRows.map((row) => [row.batch, row.status, row.orders, row.units, row.sales, row.air, row.sea]), [], ["Orders", "Order", "Customer", "Type", "Status", "Total", "Created"], ...report.topOrders.map((order) => [order.order_number, order.customer_name, formatType(order.order_type), formatStatus(order.status), order.total, order.created_at])];
  const csv = rows.map((row) => row.map(csvCell).join(",")).join("\r\n");
  const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = `nexus-monthly-report-${report.key}.csv`;
  link.click();
  URL.revokeObjectURL(url);
}

function MonthlyReports() {
  const [selectedMonth, setSelectedMonth] = useState(monthKey(new Date()));
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    loadMonthlyReportData().then((result) => {
      if (!active) return;
      if (!result.ok) setError(result.message);
      else setData(result.data);
      setLoading(false);
    });
    return () => { active = false; };
  }, []);

  const report = useMemo(() => data ? buildReport(data, selectedMonth) : null, [data, selectedMonth]);
  const maxDailySales = Math.max(1, ...(report?.dailySales || []).map((day) => day.sales));
  const cards = report ? [["Total Sales", money(report.summary.totalSales)], ["Paid Orders", report.summary.paidOrders], ["Total Orders", report.summary.totalOrders], ["New Customers", report.summary.newCustomers], ["Ready Stock Orders", report.summary.readyOrders], ["Pre-orders", report.summary.preorderOrders], ["Product Subtotal", money(report.summary.productSubtotal)], ["Shipping Collected", money(report.summary.shippingCollected)], ["Pending Payments", money(report.summary.pendingPayments)], ["Average Order Value", money(report.summary.averageOrderValue)]] : [];

  return <main className="monthly-report-page"><section className="monthly-report-shell">
    <header className="monthly-report-header"><div><p className="monthly-report-header__eyebrow">Admin report</p><h1>Monthly Report</h1><span>Review sales, customers, products, payments, and batch performance.</span></div><div className="monthly-report-header__actions"><label className="monthly-report-select"><span className="sr-only">Select month</span><input type="month" value={selectedMonth} onChange={(event) => setSelectedMonth(event.target.value)} /></label><button type="button" className="monthly-report-button" disabled={!report} onClick={() => report && downloadCsv(report)}>Export CSV</button><button type="button" className="monthly-report-button monthly-report-button--secondary" onClick={() => window.print()}>Print</button></div></header>
    {loading ? <section className="monthly-report-panel monthly-report-empty">Loading report data...</section> : null}
    {error ? <section className="monthly-report-panel monthly-report-empty">{error}</section> : null}
    {report ? <>
      <section className="monthly-report-summary" aria-label="Monthly report summary">{cards.map(([label, value]) => <article className="monthly-report-card" key={label}><span>{label}</span><strong>{value}</strong><small>{label === "Total Sales" ? "Successful payment revenue" : "Selected month"}</small></article>)}</section>
      <section className="monthly-report-panel"><div className="monthly-report-panel__header"><div><p>Sales Trend</p><h2>{labelForMonth(selectedMonth)}</h2></div><span className="monthly-report-panel__hint">Successful payments by day</span></div><div className="monthly-report-daily-chart">{report.dailySales.map((day) => <div className="monthly-report-daily-chart__bar" key={day.day} title={`${day.day}: ${money(day.sales)}`}><span style={{ height: `${Math.max((day.sales / maxDailySales) * 100, day.sales ? 7 : 2)}%` }} /><small>{day.day}</small></div>)}</div></section>
      <div className="monthly-report-grid"><section className="monthly-report-panel"><div className="monthly-report-panel__header"><div><p>Order Breakdown</p><h2>Status</h2></div></div><div className="monthly-report-key-values">{Object.entries(report.statusCounts).map(([status, count]) => <div key={status}><span>{status}</span><strong>{count}</strong></div>)}</div></section><section className="monthly-report-panel"><div className="monthly-report-panel__header"><div><p>Payment Breakdown</p><h2>Payment activity</h2></div></div><div className="monthly-report-table-wrap"><table className="monthly-report-table"><thead><tr><th>Status</th><th>Count</th><th>Amount</th></tr></thead><tbody>{report.paymentBreakdown.map((row) => <tr key={row.status}><td>{formatStatus(row.status)}</td><td>{row.count}</td><td>{money(row.amount)}</td></tr>)}</tbody></table></div></section></div>
      <div className="monthly-report-grid monthly-report-grid--wide"><section className="monthly-report-panel"><div className="monthly-report-panel__header"><div><p>Top Selling Products</p><h2>Historical order items</h2></div></div><div className="monthly-report-table-wrap"><table className="monthly-report-table"><thead><tr><th>Product</th><th>Units</th><th>Sales</th></tr></thead><tbody>{report.topProducts.map((row) => <tr key={row.name}><td>{row.name}</td><td>{row.units}</td><td>{money(row.sales)}</td></tr>)}</tbody></table></div>{!report.topProducts.length ? <div className="monthly-report-empty">No paid product sales recorded for this month.</div> : null}</section><section className="monthly-report-panel"><div className="monthly-report-panel__header"><div><p>Customer Activity</p><h2>Customer health</h2></div></div><div className="monthly-report-key-values"><div><span>New Customers</span><strong>{report.customerActivity.newCustomers}</strong></div><div><span>Returning</span><strong>{report.customerActivity.returningCustomers}</strong></div><div><span>Customers Who Ordered</span><strong>{report.customerActivity.orderedCustomers}</strong></div></div>{report.customerActivity.topCustomers.length ? <div className="monthly-report-table-wrap monthly-report-table-wrap--spaced"><table className="monthly-report-table"><thead><tr><th>Top Customer</th><th>Spend</th></tr></thead><tbody>{report.customerActivity.topCustomers.map((row) => <tr key={row.id}><td>{row.name}</td><td>{money(row.spend)}</td></tr>)}</tbody></table></div> : null}</section></div>
      <section className="monthly-report-panel"><div className="monthly-report-panel__header"><div><p>Batch Performance</p><h2>Orders and freight by batch</h2></div></div><div className="monthly-report-table-wrap"><table className="monthly-report-table"><thead><tr><th>Batch</th><th>Status</th><th>Orders</th><th>Units</th><th>Sales</th><th>Air Units</th><th>Sea Units</th></tr></thead><tbody>{report.batchRows.map((row) => <tr key={row.batch}><td>{row.batch}</td><td>{formatStatus(row.status)}</td><td>{row.orders}</td><td>{row.units}</td><td>{money(row.sales)}</td><td>{row.air}</td><td>{row.sea}</td></tr>)}</tbody></table></div>{!report.batchRows.length ? <div className="monthly-report-empty">No batch activity recorded for this month.</div> : null}</section>
      <section className="monthly-report-panel"><div className="monthly-report-panel__header"><div><p>Top Orders</p><h2>Highest-value orders</h2></div></div><div className="monthly-report-table-wrap"><table className="monthly-report-table"><thead><tr><th>Order</th><th>Customer</th><th>Type</th><th>Status</th><th>Total</th><th>Date</th></tr></thead><tbody>{report.topOrders.map((order) => <tr key={order.id}><td>{order.order_number}</td><td>{order.customer_name}</td><td>{formatType(order.order_type)}</td><td>{formatStatus(order.status)}</td><td>{money(order.total)}</td><td>{formatShortDate(order.created_at)}</td></tr>)}</tbody></table></div>{!report.topOrders.length ? <div className="monthly-report-empty">No orders recorded for this month.</div> : null}</section>
      <section className="monthly-report-panel"><div className="monthly-report-panel__header"><div><p>Month-over-Month</p><h2>Compared with the previous month</h2></div></div><div className="monthly-report-table-wrap"><table className="monthly-report-table"><thead><tr><th>Metric</th><th>This Month</th><th>Last Month</th><th>Change</th></tr></thead><tbody><tr><td>Sales</td><td>{money(report.comparison.sales.current)}</td><td>{money(report.comparison.sales.previous)}</td><td>{change(report.comparison.sales.current, report.comparison.sales.previous)}</td></tr><tr><td>Orders</td><td>{report.comparison.orders.current}</td><td>{report.comparison.orders.previous}</td><td>{change(report.comparison.orders.current, report.comparison.orders.previous)}</td></tr><tr><td>New Customers</td><td>{report.comparison.customers.current}</td><td>{report.comparison.customers.previous}</td><td>{change(report.comparison.customers.current, report.comparison.customers.previous)}</td></tr></tbody></table></div></section>
    </> : null}
  </section></main>;
}

export default MonthlyReports;
