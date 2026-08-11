import { useMemo, useState } from "react";
import {
  formatMoney,
  formatShortDate,
  getOrderMetrics,
  getRecentOrders,
} from "../adminHelpers";
import { isDeliveredOrder, isInTransitOrder } from "../../Profile/ordersStorage";
import { useShipmentBatches } from "../../../shared/shipmentStorage";
import { useProducts } from "../../Products/productData";

function clean(value) {
  return String(value ?? "").trim();
}

function parseDate(value) {
  if (!value) {
    return null;
  }

  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function getMonthKey(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  return `${year}-${month}`;
}

function getMonthLabel(date) {
  return new Intl.DateTimeFormat("en-US", {
    month: "long",
    year: "numeric",
  }).format(date);
}

function getMonthStart(monthKey) {
  const [year, month] = monthKey.split("-").map((value) => Number(value));
  return new Date(year, (month || 1) - 1, 1);
}

function isSameMonth(value, monthKey) {
  const date = parseDate(value);
  if (!date) {
    return false;
  }

  return getMonthKey(date) === monthKey;
}

function getOrderPaymentStatus(order) {
  const paymentStatus = clean(order?.paymentStatus).toLowerCase();

  if (paymentStatus === "paid" || paymentStatus === "successful") {
    return "paid";
  }

  if (paymentStatus === "failed") {
    return "failed";
  }

  return "pending";
}

function getOrderStatusKey(order) {
  const status = clean(order?.status).toLowerCase();

  if (status === "delivered") {
    return "delivered";
  }

  if (status === "returned" || clean(order?.returnStatus).toLowerCase() === "returned") {
    return "returned";
  }

  if (status === "cancelled" || status === "canceled") {
    return "cancelled";
  }

  if (status === "pending_payment") {
    return "pending_payment";
  }

  return "processing";
}

function getWeekIndex(value) {
  const date = parseDate(value);

  if (!date) {
    return 0;
  }

  return Math.min(Math.ceil(date.getDate() / 7), 4) - 1;
}

function getMonthOrders(orders, monthKey) {
  return (Array.isArray(orders) ? orders : []).filter((order) =>
    isSameMonth(order.createdAt ?? order.updatedAt, monthKey),
  );
}

function getUniqueCustomerCount(orders = [], users = [], monthKey = "") {
  const userKeys = new Set();

  for (const user of Array.isArray(users) ? users : []) {
    if (!isSameMonth(user.createdAt, monthKey)) {
      continue;
    }

    const key = clean(user.email || user.id || user.name).toLowerCase();

    if (key) {
      userKeys.add(key);
    }
  }

  if (userKeys.size > 0) {
    return userKeys.size;
  }

  const orderKeys = new Set();

  for (const order of Array.isArray(orders) ? orders : []) {
    const key = clean(order.customerEmail || order.customerId || order.customerName).toLowerCase();

    if (key) {
      orderKeys.add(key);
    }
  }

  return orderKeys.size;
}

function buildWeeklyTotals(orders = []) {
  const weekly = Array.from({ length: 4 }, (_, index) => ({
    label: `Week ${index + 1}`,
    sales: 0,
    orders: 0,
  }));

  for (const order of orders) {
    const weekIndex = getWeekIndex(order.createdAt ?? order.updatedAt);
    const bucket = weekly[weekIndex];

    if (!bucket) {
      continue;
    }

    bucket.orders += 1;

    if (getOrderPaymentStatus(order) === "paid") {
      bucket.sales += Number(order.total) || 0;
    }
  }

  return weekly;
}

function buildTopProducts(orders = [], catalog = []) {
  const productIndex = new Map(
    (Array.isArray(catalog) ? catalog : []).map((product) => [
      clean(product.slug || product.name).toLowerCase(),
      product,
    ]),
  );
  const productSales = new Map();

  for (const order of Array.isArray(orders) ? orders : []) {
    const items = Array.isArray(order.items) ? order.items : [];

    for (const item of items) {
      const key = clean(item.slug || item.name).toLowerCase();

      if (!key) {
        continue;
      }

      const quantity = Number(item.quantity) || 0;
      const revenue =
        Number(item.lineSubtotal) ||
        (Number(item.price) || 0) * (quantity || 1);
      const existing = productSales.get(key) ?? {
        name: item.name || "Unnamed product",
        image: item.image || "",
        quantity: 0,
        revenue: 0,
      };
      const catalogProduct = productIndex.get(key);

      productSales.set(key, {
        name: catalogProduct?.name ?? existing.name,
        image: catalogProduct?.image ?? existing.image,
        quantity: existing.quantity + (quantity || 1),
        revenue: existing.revenue + revenue,
      });
    }
  }

  return [...productSales.values()]
    .sort((left, right) => right.quantity - left.quantity || right.revenue - left.revenue)
    .slice(0, 5);
}

function getChange(current, previous) {
  if (!previous) {
    return current > 0 ? "+100%" : "0%";
  }

  const delta = ((current - previous) / previous) * 100;
  const prefix = delta > 0 ? "+" : "";
  return `${prefix}${delta.toFixed(1)}%`;
}

function getMoneyChange(current, previous) {
  return getChange(current, previous);
}

function buildDownloadPayload(report) {
  return JSON.stringify(report, null, 2);
}

function MonthlyReports({ orders = [] }) {
  const today = new Date();
  const defaultMonthKey = getMonthKey(today);
  const [selectedMonth, setSelectedMonth] = useState(defaultMonthKey);
  const [chartMetric, setChartMetric] = useState("sales");

  const { products: liveProducts } = useProducts();
  const monthStart = useMemo(() => getMonthStart(selectedMonth), [selectedMonth]);
  const previousMonthKey = useMemo(() => {
    const previous = new Date(monthStart);
    previous.setMonth(previous.getMonth() - 1);
    return getMonthKey(previous);
  }, [monthStart]);
  const selectedMonthLabel = useMemo(() => getMonthLabel(monthStart), [monthStart]);
  const previousMonthLabel = useMemo(() => getMonthLabel(getMonthStart(previousMonthKey)), [previousMonthKey]);

  const monthOrders = useMemo(
    () => getMonthOrders(orders, selectedMonth),
    [orders, selectedMonth],
  );
  const previousMonthOrders = useMemo(
    () => getMonthOrders(orders, previousMonthKey),
    [orders, previousMonthKey],
  );
  const { shipments: monthShipments } = useShipmentBatches({ orders: monthOrders });
  const weeklyTotals = useMemo(() => buildWeeklyTotals(monthOrders), [monthOrders]);
  const topProducts = useMemo(() => buildTopProducts(monthOrders, liveProducts), [monthOrders, liveProducts]);

  const summary = useMemo(() => {
    const totalSales = monthOrders.reduce(
      (sum, order) => (getOrderPaymentStatus(order) === "paid" ? sum + (Number(order.total) || 0) : sum),
      0,
    );
    const totalOrders = monthOrders.length;
    const newCustomers = getUniqueCustomerCount(monthOrders, [], selectedMonth);
    const refunds = monthOrders.reduce((sum, order) => {
      const status = getOrderStatusKey(order);
      const paymentStatus = getOrderPaymentStatus(order);

      if (status === "cancelled" && paymentStatus === "paid") {
        return sum + (Number(order.total) || 0);
      }

      return sum + (Number(order.refundAmount) || 0);
    }, 0);
    const pendingPayments = monthOrders.reduce(
      (sum, order) =>
        getOrderPaymentStatus(order) === "pending"
          ? sum + (Number(order.total) || 0)
          : sum,
      0,
    );
    const outstandingBalance = monthOrders.reduce(
      (sum, order) => sum + (Number(order.shippingBalanceDue) || 0),
      0,
    );
    const netProfit = Math.max(totalSales - refunds - outstandingBalance, 0);

    return {
      totalSales,
      totalOrders,
      newCustomers,
      netProfit,
      successfulPayments: totalSales,
      pendingPayments,
      refunds,
      outstandingBalance,
    };
  }, [monthOrders, selectedMonth]);

  const comparison = useMemo(() => {
    const previousSales = previousMonthOrders.reduce(
      (sum, order) => (getOrderPaymentStatus(order) === "paid" ? sum + (Number(order.total) || 0) : sum),
      0,
    );
    const previousOrders = previousMonthOrders.length;
    const previousCustomers = getUniqueCustomerCount(previousMonthOrders, [], previousMonthKey);

    return [
      {
        metric: "Sales",
        current: formatMoney(summary.totalSales),
        previous: formatMoney(previousSales),
        change: getMoneyChange(summary.totalSales, previousSales),
      },
      {
        metric: "Orders",
        current: String(summary.totalOrders),
        previous: String(previousOrders),
        change: getChange(summary.totalOrders, previousOrders),
      },
      {
        metric: "Customers",
        current: String(summary.newCustomers),
        previous: String(previousCustomers),
        change: getChange(summary.newCustomers, previousCustomers),
      },
    ];
  }, [previousMonthKey, previousMonthOrders, summary.newCustomers, summary.totalOrders, summary.totalSales, users]);

  const orderSummary = useMemo(() => {
    const counts = {
      delivered: 0,
      processing: 0,
      pending_payment: 0,
      cancelled: 0,
      returned: 0,
    };

    for (const order of monthOrders) {
      const statusKey = getOrderStatusKey(order);
      counts[statusKey] = (counts[statusKey] ?? 0) + 1;
    }

    return counts;
  }, [monthOrders]);

  const shipmentSummary = useMemo(() => {
    const deliveredOrders = monthOrders.filter(isDeliveredOrder).length;
    const inTransitOrders = monthOrders.filter(isInTransitOrder).length;
    const awaitingCustoms = monthShipments.filter((batch) => batch.stepIndex === 2).reduce((sum, batch) => sum + batch.orderCount, 0);
    const delayedShipments = monthShipments.filter((batch) => {
      const updatedAt = parseDate(batch.updatedAt ?? batch.createdAt);

      if (!updatedAt || batch.status === "completed") {
        return false;
      }

      const daysElapsed = (Date.now() - updatedAt.getTime()) / (1000 * 60 * 60 * 24);
      return daysElapsed >= 21;
    }).reduce((sum, batch) => sum + batch.orderCount, 0);

    return {
      deliveredOrders,
      inTransitOrders,
      awaitingCustoms,
      delayedShipments,
    };
  }, [monthOrders, monthShipments]);

  const chartSeries = weeklyTotals.map((week) => ({
    label: week.label,
    value: chartMetric === "sales" ? week.sales : week.orders,
  }));
  const chartMax = Math.max(1, ...chartSeries.map((item) => item.value));

  const shipmentBatches = monthShipments.slice(0, 4);

  const handleDownloadReport = () => {
    const report = {
      month: selectedMonthLabel,
      generatedAt: new Date().toISOString(),
      summary,
      orderSummary,
      paymentSummary: {
        successfulPayments: summary.successfulPayments,
        pendingPayments: summary.pendingPayments,
        refunds: summary.refunds,
        outstandingBalance: summary.outstandingBalance,
      },
      salesChart: chartSeries,
      topProducts,
      shipmentSummary,
      shipmentBatches: shipmentBatches.map((batch) => ({
        batchNumber: batch.batchNumber,
        method: batch.shippingMethodLabel,
        status: batch.status === "completed" ? "Delivered" : batch.stepLabel,
        updatedAt: batch.updatedAt,
      })),
      comparison,
    };

    const blob = new Blob([buildDownloadPayload(report)], {
      type: "application/json;charset=utf-8",
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");

    link.href = url;
    link.download = `monthly-report-${selectedMonth}.json`;
    link.click();

    URL.revokeObjectURL(url);
  };

  return (
    <main className="monthly-report-page">
      <section className="monthly-report-shell">
        <header className="monthly-report-header">
          <div>
            <p className="monthly-report-header__eyebrow">Admin report</p>
            <h1>Monthly Report</h1>
            <span>View your business performance for the selected month.</span>
          </div>

          <div className="monthly-report-header__actions">
            <label className="monthly-report-select">
              <span className="sr-only">Select month</span>
              <select value={selectedMonth} onChange={(event) => setSelectedMonth(event.target.value)}>
                {Array.from({ length: 12 }, (_, index) => {
                  const optionDate = new Date(today);
                  optionDate.setMonth(optionDate.getMonth() - index);
                  const key = getMonthKey(optionDate);

                  return (
                    <option key={key} value={key}>
                      {getMonthLabel(optionDate)}
                    </option>
                  );
                })}
              </select>
            </label>

            <button type="button" className="monthly-report-button" onClick={handleDownloadReport}>
              Download Report
            </button>
          </div>
        </header>

        <section className="monthly-report-summary" aria-label="Monthly report summary">
          <article className="monthly-report-card">
            <span>Total Sales</span>
            <strong>{formatMoney(summary.totalSales)}</strong>
          </article>
          <article className="monthly-report-card">
            <span>Total Orders</span>
            <strong>{summary.totalOrders}</strong>
          </article>
          <article className="monthly-report-card">
            <span>New Customers</span>
            <strong>{summary.newCustomers}</strong>
          </article>
          <article className="monthly-report-card">
            <span>Net Profit</span>
            <strong>{formatMoney(summary.netProfit)}</strong>
          </article>
        </section>

        <section className="monthly-report-panel">
          <div className="monthly-report-panel__header">
            <div>
              <p>Sales Overview</p>
              <h2>{selectedMonthLabel}</h2>
            </div>

            <div className="monthly-report-toggle" role="tablist" aria-label="Sales chart metric">
              <button
                type="button"
                className={chartMetric === "sales" ? "is-active" : ""}
                onClick={() => setChartMetric("sales")}
              >
                Sales
              </button>
              <button
                type="button"
                className={chartMetric === "orders" ? "is-active" : ""}
                onClick={() => setChartMetric("orders")}
              >
                Orders
              </button>
            </div>
          </div>

          <div className="monthly-report-chart">
            {chartSeries.map((item) => {
              const width = `${Math.max((item.value / chartMax) * 100, item.value > 0 ? 12 : 6)}%`;

              return (
                <div className="monthly-report-chart__row" key={item.label}>
                  <div className="monthly-report-chart__meta">
                    <strong>{item.label}</strong>
                    <span>
                      {chartMetric === "sales" ? formatMoney(item.value) : item.value}
                    </span>
                  </div>

                  <div className="monthly-report-chart__track" aria-hidden="true">
                    <span className="monthly-report-chart__fill" style={{ width }} />
                  </div>
                </div>
              );
            })}
          </div>
        </section>

        <div className="monthly-report-grid">
          <section className="monthly-report-panel">
            <div className="monthly-report-panel__header">
              <div>
                <p>Order Summary</p>
                <h2>Status snapshot</h2>
              </div>
            </div>

            <div className="monthly-report-key-values">
              <div><span>Delivered</span><strong>{orderSummary.delivered}</strong></div>
              <div><span>Processing</span><strong>{orderSummary.processing}</strong></div>
              <div><span>Pending Payment</span><strong>{orderSummary.pending_payment}</strong></div>
              <div><span>Cancelled</span><strong>{orderSummary.cancelled}</strong></div>
              <div><span>Returned</span><strong>{orderSummary.returned}</strong></div>
            </div>
          </section>

          <section className="monthly-report-panel">
            <div className="monthly-report-panel__header">
              <div>
                <p>Payment Summary</p>
                <h2>Cash flow snapshot</h2>
              </div>
            </div>

            <div className="monthly-report-key-values monthly-report-key-values--money">
              <div><span>Successful Payments</span><strong>{formatMoney(summary.successfulPayments)}</strong></div>
              <div><span>Pending Payments</span><strong>{formatMoney(summary.pendingPayments)}</strong></div>
              <div><span>Refunds</span><strong>{formatMoney(summary.refunds)}</strong></div>
              <div><span>Outstanding Balance</span><strong>{formatMoney(summary.outstandingBalance)}</strong></div>
            </div>
          </section>
        </div>

        <div className="monthly-report-grid monthly-report-grid--wide">
          <section className="monthly-report-panel">
            <div className="monthly-report-panel__header">
              <div>
                <p>Top-Selling Products</p>
                <h2>Best five items</h2>
              </div>
            </div>

            {topProducts.length > 0 ? (
              <div className="monthly-report-table-wrap">
                <table className="monthly-report-table">
                  <thead>
                    <tr>
                      <th>Product</th>
                      <th>Units Sold</th>
                      <th>Revenue</th>
                    </tr>
                  </thead>
                  <tbody>
                    {topProducts.map((product) => (
                      <tr key={`${product.name}-${product.revenue}`}>
                        <td>{product.name}</td>
                        <td>{product.quantity}</td>
                        <td>{formatMoney(product.revenue)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="monthly-report-empty">No sales recorded for this month.</div>
            )}
          </section>

          <section className="monthly-report-panel">
            <div className="monthly-report-panel__header">
              <div>
                <p>Shipment Summary</p>
                <h2>Delivery overview</h2>
              </div>
            </div>

            <div className="monthly-report-key-values monthly-report-key-values--shipment">
              <div><span>Delivered Orders</span><strong>{shipmentSummary.deliveredOrders}</strong></div>
              <div><span>Orders in Transit</span><strong>{shipmentSummary.inTransitOrders}</strong></div>
              <div><span>Awaiting Customs</span><strong>{shipmentSummary.awaitingCustoms}</strong></div>
              <div><span>Delayed Shipments</span><strong>{shipmentSummary.delayedShipments}</strong></div>
            </div>

            {shipmentBatches.length > 0 ? (
              <div className="monthly-report-table-wrap monthly-report-table-wrap--spaced">
                <table className="monthly-report-table">
                  <thead>
                    <tr>
                      <th>Batch</th>
                      <th>Method</th>
                      <th>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {shipmentBatches.map((batch) => (
                      <tr key={batch.id}>
                        <td>{batch.batchNumber}</td>
                        <td>{batch.shippingMethodLabel}</td>
                        <td>{batch.status === "completed" ? "Delivered" : batch.stepLabel}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : null}
          </section>
        </div>

        <section className="monthly-report-panel">
          <div className="monthly-report-panel__header">
            <div>
              <p>Monthly Comparison</p>
              <h2>Current month versus last month</h2>
            </div>
          </div>

          <div className="monthly-report-table-wrap">
            <table className="monthly-report-table monthly-report-table--comparison">
              <thead>
                <tr>
                  <th>Metric</th>
                  <th>This Month</th>
                  <th>Last Month</th>
                  <th>Change</th>
                </tr>
              </thead>
              <tbody>
                {comparison.map((row) => (
                  <tr key={row.metric}>
                    <td>{row.metric}</td>
                    <td>{row.current}</td>
                    <td>{row.previous}</td>
                    <td>{row.change}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </section>
    </main>
  );
}

export default MonthlyReports;

