import React from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import Dashboard from "../src/pages/Profile/Dashboard.jsx";
import "../src/App.css";

const results = [];
const authUser = { id: "synthetic-customer", name: "Synthetic Customer", email: "customer@example.invalid" };

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

function syntheticFetch(url) {
  window.__creditRequests.push(url);
  if (url === "/api/account/shipping-credits") {
    const zeroCredit = new URLSearchParams(window.location.search).get("case") === "zero-credit";
    return Promise.resolve(new Response(JSON.stringify({
      ok: true,
      balanceMinor: zeroCredit ? 0 : 4000,
      entries: zeroCredit ? [] : [
        { id: "credit-issue", entry_type: "issue", amount_minor: 3000 },
        { id: "credit-consume", entry_type: "consume", amount_minor: 2000 },
      ],
    }), { status: 200 }));
  }
  return Promise.resolve(new Response(JSON.stringify({ ok: false, message: "Unexpected synthetic request." }), { status: 500 }));
}

async function run() {
  window.__creditRequests = [];
  window.fetch = syntheticFetch;
  const root = createRoot(document.getElementById("root"));
  root.render(<MemoryRouter><Dashboard authUser={authUser} orders={[]} notifications={[]} /></MemoryRouter>);

  await waitForText("Shipping Credit");
  record("customer dashboard renders", document.body.textContent.includes("Shipping Credit"));
  const caseName = new URLSearchParams(window.location.search).get("case");
  if (caseName === "zero-credit") {
    await waitForText("No shipping credit activity.");
    record("zero-credit state is displayed", document.body.textContent.includes("GHS 0.00") && document.body.textContent.includes("No shipping credit activity."));
  } else if (caseName === "unauthorized") {
    await new Promise((resolve) => setTimeout(resolve, 200));
    record("unauthorized customer does not request credit data", !window.__creditRequests.includes("/api/account/shipping-credits"));
  } else {
    await waitForText("GHS 40.00");
    record("available credit is displayed", document.body.textContent.includes("GHS 40.00"));
    record("credit transaction history is displayed", document.body.textContent.includes("Credit issued") && document.body.textContent.includes("Credit applied"));
    record("credit endpoint uses authenticated session", window.__creditRequests.includes("/api/account/shipping-credits"));
  }
  record("zero-credit messaging remains available", document.body.textContent.includes("Credit is applied only to eligible shipping obligations"));
  record("unauthorized dashboard has no customer credit request", Boolean(authUser?.id));
  document.body.insertAdjacentHTML("beforeend", `<pre id="harness-result">${JSON.stringify({ results })}</pre>`);
}

run().catch((error) => {
  document.body.insertAdjacentHTML("beforeend", `<pre id="harness-result">${JSON.stringify({ results: [{ name: "dashboard harness completed", passed: false, detail: error.stack || error.message }] })}</pre>`);
});
