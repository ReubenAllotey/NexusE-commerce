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
  if (url === "/api/admin/shipping-fee-adjustment/history") {
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
  document.body.insertAdjacentHTML("beforeend", `<pre id="harness-result">${JSON.stringify({ results: [{ name: "harness completed", passed: false, detail: error.stack || error.message }] })}</pre>`);
});
