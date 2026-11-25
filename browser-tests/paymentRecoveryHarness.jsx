import React, { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import PaymentPage from "../src/pages/payment/payment.jsx";
import Login from "../src/pages/Register/login.jsx";
import { mockAuth, supabase } from "./paymentRecoveryMockSupabase.js";
import "../src/App.css";

const syntheticOrder = {
  id: "synthetic-order-1",
  orderNumber: "SYNTH-ORDER-1",
  customerName: "Synthetic Customer",
  customerEmail: "customer@example.test",
  guestEmail: "guest@example.test",
  shippingAddress: { fullName: "Synthetic Customer", phoneNumber: "0240000000", region: "Greater Accra", city: "Accra" },
  items: [],
};

const results = [];

function record(name, passed, detail = "") {
  results.push({ name, passed, detail });
}

function waitFor(selector, timeout = 6000) {
  return new Promise((resolve, reject) => {
    const started = Date.now();
    const poll = () => {
      const element = document.querySelector(selector);
      if (element) return resolve(element);
      if (Date.now() - started > timeout) return reject(new Error(`Timed out waiting for ${selector}`));
      setTimeout(poll, 50);
    };
    poll();
  });
}

function waitForEnabled(selector, timeout = 6000) {
  return new Promise((resolve, reject) => {
    const started = Date.now();
    const poll = () => {
      const element = document.querySelector(selector);
      if (element && !element.disabled) return resolve(element);
      if (Date.now() - started > timeout) return reject(new Error(`Timed out waiting for enabled ${selector}`));
      setTimeout(poll, 50);
    };
    poll();
  });
}

function waitForInitialization(timeout = 6000) {
  return new Promise((resolve, reject) => {
    const started = Date.now();
    const poll = () => {
      if (window.__paymentHarnessInitialization) return resolve(window.__paymentHarnessInitialization);
      if (Date.now() - started > timeout) return reject(new Error("Timed out waiting for mocked Paystack initialization"));
      setTimeout(poll, 50);
    };
    poll();
  });
}

function setInput(element, value) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set;
  setter.call(element, value);
  element.dispatchEvent(new Event("input", { bubbles: true }));
  element.dispatchEvent(new Event("change", { bubbles: true }));
}

function syntheticFetch(url, options = {}) {
  const request = {
    url,
    headers: options.headers ?? {},
    method: options.method ?? "GET",
    body: options.body ? JSON.parse(options.body) : null,
  };
  window.__paymentHarnessRequests.push(request);

  if (String(url).startsWith("/api/payments/shipping-balance")) {
    if (mockAuth.getScenario() === "expired-guest-token") {
      return Promise.resolve(new Response(JSON.stringify({ ok: false, message: "This shipping payment link is invalid or has expired." }), { status: 401 }));
    }
    if (mockAuth.getScenario() === "incorrect-account") {
      return Promise.resolve(new Response(JSON.stringify({ ok: false, message: "Order not found." }), { status: 404 }));
    }
    if (mockAuth.getScenario() === "repeated-401") {
      return Promise.resolve(new Response(JSON.stringify({ ok: false, message: "Please sign in to continue." }), { status: 401 }));
    }
    if (["already-paid", "pending-payment"].includes(mockAuth.getScenario())) {
      return Promise.resolve(new Response(JSON.stringify({ ok: false, message: mockAuth.getScenario() === "already-paid" ? "This shipping payment has already been completed." : "This shipping payment is already being prepared." }), { status: 409 }));
    }
    return Promise.resolve(new Response(JSON.stringify({
      ok: true,
      order: syntheticOrder,
      accounting: { knownShipping: 0.03, paidShipping: 0, outstandingShipping: 0.03, status: "unpaid" },
      amountDueNow: 0.03,
      paymentPurpose: "shipping-balance",
    }), { status: 200 }));
  }

  if (String(url).startsWith("/api/payments/order-balance")) {
    return Promise.resolve(new Response(JSON.stringify({
      ok: true,
      order: syntheticOrder,
      accounting: { outstanding: 0.05 },
      amountDueNow: 0.05,
      paymentPurpose: "order-balance",
    }), { status: 200 }));
  }

  if (String(url) === "/api/paystack/initialize") {
    const attemptNumber = (window.__paymentHarnessInitializationAttempts || 0) + 1;
    const authorizationKind = request.headers.Authorization?.includes("refreshed") ? "refreshed" : request.headers.Authorization ? "initial" : "missing";
    window.__paymentHarnessInitializationAttempts = attemptNumber;
    window.__paymentHarnessInitializationSequence = [...(window.__paymentHarnessInitializationSequence || []), authorizationKind];
    window.__paymentHarnessInitialization = {
      url: request.url,
      method: request.method,
      headers: request.headers,
      paymentPurpose: request.body?.paymentPurpose,
      orderId: request.body?.orderId,
      paymentTokenPresent: Boolean(request.body?.paymentToken),
      guestCheckout: Boolean(request.body?.guestCheckout),
      refreshedAuthorization: request.headers.Authorization === "Bearer synthetic-access-refreshed-customer-1",
      authorizationKind,
      attempts: attemptNumber,
      sequence: window.__paymentHarnessInitializationSequence,
    };
    if (mockAuth.getScenario() === "authenticated-invalid-bearer" && window.__paymentHarnessInitializationAttempts === 1) {
      return Promise.resolve(new Response(JSON.stringify({ ok: false, message: "Please sign in to continue." }), { status: 401 }));
    }
    if (mockAuth.getScenario() === "duplicate-payment") {
      return Promise.resolve(new Response(JSON.stringify({ ok: false, message: "This shipping payment is already being prepared." }), { status: 409 }));
    }
    sessionStorage.setItem("payment-harness-init", JSON.stringify({
      authorizationPresent: Boolean(request.headers.Authorization),
      method: request.method,
      paymentPurpose: request.body?.paymentPurpose,
      orderId: request.body?.orderId,
      paymentTokenPresent: Boolean(request.body?.paymentToken),
      guestCheckout: Boolean(request.body?.guestCheckout),
      refreshedAuthorization: request.headers.Authorization === "Bearer synthetic-access-refreshed-customer-1",
      authorizationKind,
      attempts: attemptNumber,
      sequence: window.__paymentHarnessInitializationSequence,
      refreshCount: mockAuth.getRefreshCount(),
      sameCustomer: mockAuth.getSession()?.user?.id === "synthetic-customer-1",
    }));
    return Promise.resolve(new Response(JSON.stringify({
      ok: true,
      data: { reference: "synthetic-paystack-reference", authorization_url: "/browser-tests/index.html?harness=complete", access_code: "synthetic-access-code" },
      amountDueNow: 0.03,
    }), { status: 200 }));
  }

  return Promise.resolve(new Response(JSON.stringify({ ok: false, message: "Unexpected synthetic request." }), { status: 500 }));
}

function AuthAwareRoutes() {
  const location = useLocation();
  window.__paymentHarnessLocation = `${location.pathname}${location.search}`;
  const [authVersion, setAuthVersion] = useState(0);
  useEffect(() => {
    const subscription = supabase.auth.onAuthStateChange(() => setAuthVersion((value) => value + 1));
    return () => subscription.data.subscription.unsubscribe();
  }, []);

  const authUser = mockAuth.getSession()?.user
    ? { ...mockAuth.getSession().user, ...syntheticOrder, id: mockAuth.getSession().user.id }
    : null;

  if (location.pathname === "/__payment-harness-complete") {
    return <pre id="harness-result">{JSON.stringify({ results: results.map(({ name, passed }) => ({ name, passed })), authVersion })}</pre>;
  }

  return (
    <Routes>
      <Route path="/register/login" element={<Login />} />
      <Route path="/profile/dashboard" element={<div id="harness-dashboard">Synthetic dashboard</div>} />
      <Route path="/shipping-address" element={<div id="harness-shipping-address">Shipping address required</div>} />
      <Route
        path="/payment"
        element={
          <PaymentPage
            authUser={authUser}
            authReady={Boolean(authVersion >= 0)}
            orders={[]}
            ordersLoading={false}
            siteBanner={null}
          />
        }
      />
    </Routes>
  );
}

async function runJourney() {
  const completedInitialization = sessionStorage.getItem("payment-harness-init");
  if (completedInitialization) {
    sessionStorage.removeItem("payment-harness-init");
    const priorResults = JSON.parse(sessionStorage.getItem("payment-harness-results") || "[]");
    const completedScenario = sessionStorage.getItem("payment-harness-scenario") || "auth-return";
    sessionStorage.removeItem("payment-harness-results");
    sessionStorage.removeItem("payment-harness-scenario");
    const init = JSON.parse(completedInitialization);
    const shippingScenario = ["auth-return", "already-authenticated", "authenticated-invalid-bearer", "valid-guest-token"].includes(completedScenario);
    const orderBalanceScenario = completedScenario === "order-balance";
    const completedResults = [...priorResults, { name: "payment submission reached initialization", passed: true }, { name: shippingScenario ? "initialization used shipping purpose" : orderBalanceScenario ? "initialization used order-balance purpose" : "standard checkout used order purpose", passed: shippingScenario ? init.paymentPurpose === "shipping-balance" : orderBalanceScenario ? init.paymentPurpose === "order-balance" : init.paymentPurpose === "order" }, { name: shippingScenario || orderBalanceScenario ? "initialization used existing order" : "standard checkout remained guest checkout", passed: shippingScenario || orderBalanceScenario ? init.orderId === syntheticOrder.id : init.guestCheckout }, { name: "initialization used authorization", passed: ["valid-guest-token", "standard-guest-valid", "order-balance"].includes(completedScenario) ? !init.authorizationPresent : init.authorizationPresent }, { name: "guest token supplied", passed: ["valid-guest-token", "order-balance"].includes(completedScenario) ? init.paymentTokenPresent : true }, ...(completedScenario === "authenticated-invalid-bearer" ? [{ name: "stale bearer recovered with refreshed session", passed: init.refreshedAuthorization && init.attempts === 2 && init.refreshCount === 1 && init.sameCustomer, detail: JSON.stringify({ authorizationKind: init.authorizationKind, attempts: init.attempts, refreshCount: init.refreshCount, sameCustomer: init.sameCustomer, sequence: init.sequence }) }] : [])];
    document.body.innerHTML = `<pre id="harness-result">${JSON.stringify({ scenario: completedScenario, results: completedResults })}</pre>`;
    return;
  }

  const scenario = new URLSearchParams(window.location.search).get("case") || "auth-return";
  mockAuth.configure(scenario);
  window.__paymentHarnessRequests = [];
  window.__paymentHarnessInitialization = null;
  window.fetch = syntheticFetch;

  const root = createRoot(document.getElementById("root"));
  const initialEntry = scenario === "refresh-login"
    ? "/register/login"
    : scenario === "external-return"
      ? { pathname: "/register/login", state: { returnTo: "https://evil.example/steal" } }
      : scenario === "standard-guest-no-address"
        ? { pathname: "/payment", state: { cartRows: [{ key: "synthetic-row", product: { id: "product-1", name: "Synthetic Product", price: 1 }, quantity: 1, lineSubtotal: 1, lineShipping: 0 }], totals: { subtotal: 1, totalPrice: 1 } } }
        : scenario === "standard-guest-valid"
          ? { pathname: "/payment", state: { guestCheckoutEmail: "guest@example.test", customerName: "Synthetic Guest", customerPhone: "0240000000", cartRows: [{ key: "synthetic-row", product: { id: "product-1", name: "Synthetic Product", price: 1 }, quantity: 1, lineSubtotal: 1, lineShipping: 0 }], shippingAddress: syntheticOrder.shippingAddress, totals: { subtotal: 1, shippingTotal: 0, totalPrice: 1 } } }
          : scenario === "order-balance"
            ? `/payment?purpose=order-balance&orderId=${syntheticOrder.id}&token=synthetic-order-token`
          : `/payment?purpose=shipping-balance&orderId=${syntheticOrder.id}${["valid-guest-token", "duplicate-payment"].includes(scenario) ? "&token=synthetic-guest-token" : ""}`;
  root.render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <AuthAwareRoutes />
    </MemoryRouter>,
  );

  const submitShippingPayment = async () => {
    setInput(document.querySelector("#payment-customerName"), "Synthetic Customer");
    setInput(document.querySelector("#payment-customerPhone"), "0240000000");
    setInput(document.querySelector("#payment-customerEmail"), "customer@example.test");
    document.querySelectorAll(".payment-method-card")[1]?.click();
    document.querySelector('input[type="checkbox"]').click();
    await waitForEnabled(".payment-submit");
    document.querySelector(".payment-form").requestSubmit(document.querySelector(".payment-submit"));
    await waitForInitialization(5000);
    return window.__paymentHarnessInitialization;
  };

  try {
    if (scenario === "auth-return") {
      await waitFor(".payment-auth-recovery button");
      record("recovery panel rendered", true);
      document.querySelector(".payment-auth-recovery button").click();
      await waitFor('input[name="email"]');
      record("sign-in route opened", Boolean(location.pathname === "/" || document.querySelector('input[name="email"]')));
      setInput(document.querySelector('input[name="email"]'), "customer@example.test");
      setInput(document.querySelector('input[name="password"]'), "synthetic-password");
      document.querySelector('form button[type="submit"]').click();
      await waitForEnabled(".payment-submit");
      record("returned to payment route", true);
      record("authoritative context reloaded", window.__paymentHarnessRequests.some((request) => request.url.startsWith("/api/payments/shipping-balance")));
      record("payment was not automatic", !window.__paymentHarnessInitialization);
      sessionStorage.setItem("payment-harness-scenario", "auth-return");
      sessionStorage.setItem("payment-harness-results", JSON.stringify(results));
      await submitShippingPayment();
      await new Promise((resolve) => setTimeout(resolve, 250));
      const init = window.__paymentHarnessInitialization;
      record("payment submission reached initialization", Boolean(init), document.body.innerText.slice(-240));
      record("initialization used current authorization", init?.headers?.Authorization === "Bearer synthetic-access-synthetic-customer-1");
    } else if (scenario === "already-authenticated") {
      await waitForEnabled(".payment-submit");
      record("already-authenticated customer reached payment form", true);
      record("already-authenticated context used authorization", window.__paymentHarnessRequests.some((request) => request.headers.Authorization === "Bearer synthetic-access-synthetic-customer-1"));
      record("already-authenticated customer saw no recovery panel", !document.querySelector(".payment-auth-recovery"));
      sessionStorage.setItem("payment-harness-scenario", "already-authenticated");
      sessionStorage.setItem("payment-harness-results", JSON.stringify(results));
      await submitShippingPayment();
    } else if (scenario === "authenticated-invalid-bearer") {
      await waitForEnabled(".payment-submit");
      record("stale authenticated customer reached payment form", true);
      sessionStorage.setItem("payment-harness-scenario", scenario);
      sessionStorage.setItem("payment-harness-results", JSON.stringify(results));
      await submitShippingPayment();
    } else if (scenario === "valid-guest-token") {
      await waitForEnabled(".payment-submit");
      record("valid guest token reached payment form", true);
      record("guest request omitted authorization", !window.__paymentHarnessRequests.find((request) => request.url.startsWith("/api/payments/shipping-balance"))?.headers?.Authorization);
      sessionStorage.setItem("payment-harness-scenario", "valid-guest-token");
      sessionStorage.setItem("payment-harness-results", JSON.stringify(results));
      await submitShippingPayment();
    } else if (scenario === "expired-guest-token") {
      await waitFor(".payment-link-state");
      record("expired guest token failed closed", !document.body.innerText.includes("Pay GH"));
    } else if (scenario === "already-paid") {
      await waitFor(".payment-link-state");
      record("already-paid shipping balance is blocked", !document.body.innerText.includes("Pay GH"));
    } else if (scenario === "pending-payment") {
      await waitFor(".payment-link-state");
      record("pending shipping payment is blocked", !document.body.innerText.includes("Pay GH"));
    } else if (scenario === "repeated-401") {
      await waitFor(".payment-auth-recovery button");
      record("repeated 401 showed recovery without automatic loop", true);
    } else if (scenario === "incorrect-account") {
      await waitFor(".payment-link-state");
      record("incorrect account did not expose payment form", !document.body.innerText.includes("Pay GH"));
    } else if (scenario === "refresh-login") {
      await waitFor('input[name="email"]');
      record("refreshed sign-in page remains usable", true);
      record("refreshed sign-in page has no unsafe return", window.__paymentHarnessLocation === "/register/login");
    } else if (scenario === "external-return") {
      await waitFor('input[name="email"]');
      setInput(document.querySelector('input[name="email"]'), "customer@example.test");
      setInput(document.querySelector('input[name="password"]'), "synthetic-password");
      document.querySelector('form button[type="submit"]').click();
      await new Promise((resolve) => setTimeout(resolve, 500));
      record("external return destination rejected", window.__paymentHarnessLocation === "/profile/dashboard");
      record("external return did not navigate off-site", !window.__paymentHarnessLocation.includes("evil.example"));
    } else if (scenario === "failed-auth") {
      await waitFor(".payment-auth-recovery button");
      document.querySelector(".payment-auth-recovery button").click();
      await waitFor('input[name="email"]');
      document.querySelector('form button[type="submit"]').click();
      await waitFor(".auth-form__error");
      record("failed authentication remains on sign-in", window.__paymentHarnessLocation === "/register/login");
      record("failed authentication does not loop", !document.querySelector(".payment-auth-recovery"));
    } else if (scenario === "standard-guest-no-address") {
      await waitFor("#harness-shipping-address");
      record("standard guest checkout still requires an address", window.__paymentHarnessLocation === "/shipping-address");
    } else if (scenario === "standard-guest-valid") {
      await waitForEnabled(".payment-submit");
      record("standard guest checkout with address reached payment form", true);
      sessionStorage.setItem("payment-harness-scenario", "standard-guest-valid");
      sessionStorage.setItem("payment-harness-results", JSON.stringify(results));
      await submitShippingPayment();
    } else if (scenario === "order-balance") {
      await waitForEnabled(".payment-submit");
      record("order balance payment reached payment form", true);
      sessionStorage.setItem("payment-harness-scenario", "order-balance");
      sessionStorage.setItem("payment-harness-results", JSON.stringify(results));
      await submitShippingPayment();
    } else if (scenario === "duplicate-payment") {
      await waitForEnabled(".payment-submit");
      record("duplicate shipping payment form rendered", true);
      await submitShippingPayment().catch(() => null);
      await waitFor(".payment-error");
      record("duplicate payment was rejected", document.body.innerText.includes("already being prepared"));
      record("duplicate payment initialization attempted once", window.__paymentHarnessInitializationAttempts === 1);
    }
  } catch (error) {
    record("journey completed", false, `${error.message} | ${document.body.innerText.slice(-600)}`);
  }

  document.body.innerHTML = `<pre id="harness-result">${JSON.stringify({ scenario, results })}</pre>`;
}

runJourney();
