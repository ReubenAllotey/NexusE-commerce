import React from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import ShipmentPage from "../src/pages/Admin/shipment/shipment.jsx";
import "../src/App.css";

const products = [
  { id: "synthetic-product-1", name: "Synthetic Shipping Product", slug: "synthetic-shipping-product", shippingFee: 100 },
  { id: "synthetic-product-2", name: "Second Product", slug: "second-product", shippingFee: 50 },
];
const results = [];

function record(name, passed, detail = "") {
  results.push({ name, passed, detail });
}

function waitForText(text, timeout = 5000) {
  return new Promise((resolve, reject) => {
    const started = Date.now();
    const poll = () => {
      if (document.body.textContent.includes(text)) return resolve();
      if (Date.now() - started > timeout) return reject(new Error(`Timed out waiting for ${text}`));
      setTimeout(poll, 25);
    };
    poll();
  });
}

function inputValue(input, value) {
  input.value = value;
  input.dispatchEvent(new Event("input", { bubbles: true }));
  input.dispatchEvent(new Event("change", { bubbles: true }));
}

function labelControl(text) {
  return [...document.querySelectorAll("label")]
    .find((label) => label.textContent.includes(text))
    ?.querySelector("input, select");
}

function syntheticFetch(url, options = {}) {
  window.__shippingRequests.push({ url, method: options.method || "GET", body: options.body ? JSON.parse(options.body) : null });
  const harnessCase = new URLSearchParams(window.location.search).get("case");
  if (harnessCase === "history" && url.startsWith("/api/admin/shipping-fee-adjustment/history/details")) {
    const affectedOrders = Array.from({ length: 120 }, (_, index) => ({
      order_id: `synthetic-order-id-${index + 1}`,
      order_reference: `SYN-${String(index + 1).padStart(3, "0")}`,
      customer_name: index % 3 === 0 ? `Guest Customer ${index + 1}` : `Registered Customer ${index + 1}`,
      customer_type: index % 3 === 0 ? "guest" : "registered",
      previous_shipping_fee: 0.03,
      updated_shipping_fee: 0.05,
      amount_paid: 0.01,
      outstanding_balance: 0.04,
      credit_generated: 0,
      notification_status: ["sent", "queued", "failed", "skipped"][index % 4],
      notification_reason: index % 4 === 3 ? "Synthetic recipient review." : null,
    }));
    return Promise.resolve(new Response(JSON.stringify({ ok: true, adjustment: {
      id: "synthetic-adjustment-1",
      product_name: "Synthetic Shipping Product",
      old_shipping_fee: 0.03,
      new_shipping_fee: 0.05,
      created_at: "2026-11-27T10:00:00.000Z",
      notification_summary: { pending: 1, queued: 1, processing: 1, sent: 114, failed: 1, skipped: 2 },
      affected_orders: affectedOrders,
    } }), { status: 200 }));
  }
  if (harnessCase === "history" && url.startsWith("/api/admin/shipping-fee-adjustment/history")) {
    const history = Array.from({ length: 10 }, (_, index) => ({
      id: `synthetic-adjustment-${index + 1}`,
      product_name: index % 2 ? "Second Product" : "Synthetic Shipping Product",
      old_shipping_fee: 0.03,
      new_shipping_fee: index % 2 ? 0.02 : 0.05,
      affected_orders_count: 12,
      affected_order_items: 14,
      total_additional_shipping: index % 2 ? 0 : 0.57,
      total_credit_issued_minor: index % 2 ? 12 : 0,
      created_at: "2026-11-27T10:00:00.000Z",
      administrator_name: "Synthetic Administrator",
      notification_total: 12,
      notification_summary: index % 2 ? { sent: 12 } : { pending: 1, queued: 1, processing: 1, sent: 8, failed: 1 },
      status: "applied",
    }));
    return Promise.resolve(new Response(JSON.stringify({ ok: true, history, page: 1, page_size: 10, total: 12, total_pages: 2 }), { status: 200 }));
  }
  if (url.startsWith("/api/admin/shipping-fee-adjustment/history")) {
    return Promise.resolve(new Response(JSON.stringify({ ok: true, history: [] }), { status: 200 }));
  }
  if (url === "/api/admin/shipping-fee-adjustment/preview") {
    return Promise.resolve(new Response(JSON.stringify({
      ok: true,
      preview: {
        productId: products[0].id,
        productName: products[0].name,
        currentShippingFee: 100,
        newShippingFee: 130,
        orders: [{ orderId: "synthetic-order", orderItemId: "synthetic-item", orderNumber: "SYNTH-001", additionalDue: 30, creditIssuedMinor: 0 }],
      },
    }), { status: 200 }));
  }
  if (url === "/api/admin/shipping-fee-adjustment/apply") {
    return Promise.resolve(new Response(JSON.stringify({ ok: true, result: { status: "applied", affectedOrders: 1 } }), { status: 200 }));
  }
  return Promise.resolve(new Response(JSON.stringify({ ok: false, message: "Unexpected synthetic request." }), { status: 500 }));
}

async function run() {
  window.__shippingRequests = [];
  window.fetch = syntheticFetch;
  window.confirm = () => true;
  const root = createRoot(document.getElementById("root"));
  root.render(<MemoryRouter><ShipmentPage authUser={{ id: "synthetic-admin" }} /></MemoryRouter>);

  await waitForText("Shipment Management");
  record("shipment page renders", document.body.textContent.includes("Shipment Management"));
  if (new URLSearchParams(window.location.search).get("case") === "history") {
    await waitForText("Shipping fee adjustment history");
    await waitForText("Synthetic Shipping Product");
    record("history table renders compact adjustment rows", document.querySelectorAll(".admin-shipment-history-table tbody tr").length === 10);
    record("history avoids raw order UUIDs", !document.body.textContent.includes("synthetic-order-id-"));
    record("history shows notification counts and recovery", document.body.textContent.includes("pending 1") && document.body.textContent.includes("Recover all"));
    record("history pagination is bounded", document.body.textContent.includes("Page 1 of 2"));
    const viewDetails = [...document.querySelectorAll("button")].find((button) => button.textContent.includes("View details"));
    viewDetails?.click();
    await waitForText("SYN-001");
    record("details modal shows customer-facing order references", document.body.textContent.includes("SYN-001") && !document.body.textContent.includes("synthetic-order-id-1"));
    record("details modal caps rendered affected orders", document.querySelectorAll(".admin-shipment-history-detail-table tbody tr").length === 25);
    record("details modal exposes status counts and recovery", document.body.textContent.includes("processing: 1") && document.body.textContent.includes("Recover All Eligible Notices"));
    const detailSearch = [...document.querySelectorAll("input")].find((input) => input.placeholder === "Order reference or customer");
    record("details modal has order search and status filter", Boolean(detailSearch && [...document.querySelectorAll("select")].some((select) => select.textContent.includes("processing"))));
    const nextDetails = document.querySelector(".admin-shipment-history-modal .admin-shipment-history-pagination button:last-child");
    nextDetails?.click();
    await new Promise((resolve) => setTimeout(resolve, 100));
    record("details modal pagination advances", document.body.textContent.includes("Page 2 of 5"));
    document.body.insertAdjacentHTML("beforeend", `<pre id="harness-result">${JSON.stringify({ results })}</pre>`);
    return;
  }
  document.querySelector("button") && [...document.querySelectorAll("button")].find((button) => button.textContent.includes("Update Shipping Fee"))?.click();
  await waitForText("Search product");
  record("adjustment modal opens", document.body.textContent.includes("Preview eligible open-batch orders"));

  const search = labelControl("Search product");
  inputValue(search, "Synthetic");
  const productSelect = labelControl("Product");
  productSelect.value = products[0].id;
  productSelect.dispatchEvent(new Event("change", { bubbles: true }));
  const newFee = labelControl("New shipping fee");
  inputValue(newFee, "130");
  record("product and fee controls are available", Boolean(search && productSelect && newFee));
  [...document.querySelectorAll("button")].find((button) => button.textContent.includes("Preview Adjustment"))?.click();
  await waitForText("eligible order items");
  record("preview displays authoritative synthetic result", document.body.textContent.includes("due GHS 30.00"));
  [...document.querySelectorAll("button")].find((button) => button.textContent.includes("Confirm Update Fee"))?.click();
  await new Promise((resolve) => setTimeout(resolve, 300));
  const applyRequest = window.__shippingRequests.find((request) => request.url === "/api/admin/shipping-fee-adjustment/apply");
  record("confirmation sends product and expected fee", applyRequest?.body?.productId === products[0].id && applyRequest?.body?.expectedOldShippingFee === 100, JSON.stringify(applyRequest?.body || null));
  record("no payment or email endpoint was called", window.__shippingRequests.every((request) => request.url.includes("shipping-fee-adjustment") || request.url.includes("history")));
  document.body.insertAdjacentHTML("beforeend", `<pre id="harness-result">${JSON.stringify({ results })}</pre>`);
}

run().catch((error) => {
  document.body.insertAdjacentHTML("beforeend", `<pre id="harness-result">${JSON.stringify({ results: [{ name: "harness completed", passed: false, detail: `${error.stack || error.message}; requests=${JSON.stringify(window.__shippingRequests || [])}` }] })}</pre>`);
});
