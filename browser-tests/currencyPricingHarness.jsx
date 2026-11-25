import React, { useEffect } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import ExchangeRatesPage from "../src/pages/Admin/exchangeRates/exchangeRates.jsx";
import ProductEditorForm from "../src/pages/Admin/products/ProductEditorForm.jsx";
import "../src/App.css";

const settings = { activePricingMode: "manual", manualRate: 10, liveRate: 10, liveRateProvider: "synthetic", lastSuccessfulFetchAt: "2026-11-25T00:00:00Z", cnyProductCount: 1 };
const product = { id: "synthetic-product", name: "Synthetic CNY Product", price: 1000, compareAt: 1200, pricingCurrency: "CNY", originalCnyPrice: 100, originalCnyCompareAt: 120, variationGroups: [] };
const results = [];
function record(name, passed, detail = "") { results.push({ name, passed, detail }); }
function waitFor(selector, timeout = 5000) { return new Promise((resolve, reject) => { const start = Date.now(); const poll = () => { const element = document.querySelector(selector); if (element) return resolve(element); if (Date.now() - start > timeout) return reject(new Error(`Timed out waiting for ${selector}`)); setTimeout(poll, 25); }; poll(); }); }
function waitForText(text, timeout = 5000) { return new Promise((resolve, reject) => { const start = Date.now(); const poll = () => { if (document.body.textContent.includes(text)) return resolve(); if (Date.now() - start > timeout) return reject(new Error(`Timed out waiting for text: ${text}`)); setTimeout(poll, 25); }; poll(); }); }
function inputValue(selector, value) { const input = document.querySelector(selector); const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set; setter.call(input, value); input.dispatchEvent(new Event("input", { bubbles: true })); input.dispatchEvent(new Event("change", { bubbles: true })); }

function syntheticFetch(url, options = {}) {
  window.__currencyRequests.push({ url, method: options.method || "GET", body: options.body ? JSON.parse(options.body) : null });
  if (url === "/api/admin/exchange-rates" && (!options.method || options.method === "GET")) return Promise.resolve(new Response(JSON.stringify({ ok: true, settings }), { status: 200 }));
  if (url === "/api/admin/exchange-rates/history") return Promise.resolve(new Response(JSON.stringify({ ok: true, history: [] }), { status: 200 }));
  if (url === "/api/admin/exchange-rates/refresh") return Promise.resolve(new Response(JSON.stringify({ ok: true, settings, attributionRequired: true }), { status: 200 }));
  if (url === "/api/admin/exchange-rates/manual" || url === "/api/admin/exchange-rates/mode") return Promise.resolve(new Response(JSON.stringify({ ok: true, settings }), { status: 200 }));
  if (url === "/api/admin/exchange-rates/reprice/preview") return Promise.resolve(new Response(JSON.stringify({ ok: true, rate: 12, rateSource: "manual", approvalToken: "synthetic-approval", total: 1, rows: [{ productId: product.id, name: product.name, currentGhsPrice: 1000, proposedGhsPrice: 1200, productUpdatedAt: "2026-11-25T00:00:00Z" }] }), { status: 200 }));
  if (url === "/api/admin/exchange-rates/reprice/apply") return Promise.resolve(new Response(JSON.stringify({ ok: true, status: "completed", updatedCount: 1 }), { status: 200 }));
  return Promise.resolve(new Response(JSON.stringify({ ok: false, message: "Unexpected synthetic request." }), { status: 500 }));
}

async function run() {
  const scenario = new URLSearchParams(location.search).get("case") || "exchange-page";
  window.__currencyRequests = [];
  window.fetch = syntheticFetch;
  window.confirm = () => true;
  const root = createRoot(document.getElementById("root"));
  if (scenario === "exchange-page" || scenario === "bulk-repricing") {
    root.render(<MemoryRouter><ExchangeRatesPage /></MemoryRouter>);
    await waitForText("Exchange Rates");
    record("exchange rates page renders", Boolean(document.querySelector("h1")?.textContent.includes("Exchange Rates")));
    record("active rate is visible", document.body.textContent.includes("10.000000"));
    if (scenario === "exchange-page") {
      document.querySelector('.admin-exchange-rates__header button')?.click();
      await waitForText("Rates are provided by ExchangeRate-API", 8000);
      record("provider attribution is visible after open refresh", document.body.textContent.includes("ExchangeRate-API"));
    } else {
      [...document.querySelectorAll("button")].find((button) => button.textContent.includes("Preview repricing"))?.click();
      await waitForText(product.name);
      record("bulk preview renders synthetic product", document.body.textContent.includes(product.name));
      [...document.querySelectorAll("button")].find((button) => button.textContent.includes("Apply selected repricing"))?.click();
      await new Promise((resolve) => setTimeout(resolve, 250));
      const applyRequest = window.__currencyRequests.find((request) => request.url === "/api/admin/exchange-rates/reprice/apply");
      record("bulk apply sends the approval token", Boolean(applyRequest?.body?.approvalToken));
    }
  } else {
    root.render(<ProductEditorForm title="Synthetic product" initialProduct={scenario === "edit-product" ? product : {}} onSubmit={async () => ({ ok: true })} onCancel={() => {}} />);
    await waitFor('select[name="pricingCurrency"]');
    record("product editor exposes currency selector", Boolean(document.querySelector('select[name="pricingCurrency"]')));
    const currency = document.querySelector('select[name="pricingCurrency"]');
    currency.value = "CNY"; currency.dispatchEvent(new Event("change", { bubbles: true }));
    inputValue('input[name="originalCnyPrice"]', "250");
    await new Promise((resolve) => setTimeout(resolve, 100));
    record("CNY input shows GHS preview", document.body.textContent.includes("2500.00"));
    record("legacy edit retains currency mode", scenario !== "edit-product" || currency.value === "CNY");
  }
  document.body.insertAdjacentHTML("beforeend", `<pre id="harness-result">${JSON.stringify({ scenario, results })}</pre>`);
}
run().catch((error) => { document.body.insertAdjacentHTML("beforeend", `<pre id="harness-result">${JSON.stringify({ results: [{ name: "harness completed", passed: false, detail: error.message }] })}</pre>`); });
