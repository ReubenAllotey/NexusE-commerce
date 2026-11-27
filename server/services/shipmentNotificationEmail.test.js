import assert from "node:assert/strict";
import test from "node:test";
import {
  buildShippingPaymentConfirmationEmail,
  buildShippingPaymentRequiredEmail,
  buildShippingFeeAdjustmentEmail,
  buildShipmentUpdateEmail,
} from "./shipmentNotificationEmail.js";

test("shipping payment reminder is branded, item-payment separate, and escaped", () => {
  const email = buildShippingPaymentRequiredEmail({
    customerName: "<Guest Customer>",
    orderNumber: "NX-SHIP-001",
    items: [{ productName: "<Phone>", quantity: 2 }],
    outstanding: 125.5,
    appUrl: "https://example.invalid",
    actionUrl: "/payment?purpose=shipping-balance&orderId=fictional-order",
  });

  assert.match(email.subject, /shipping payment required/i);
  assert.match(email.text, /GH₵125\.50/);
  assert.match(email.html, /&lt;Guest Customer&gt;/);
  assert.match(email.html, /\/payment\?purpose=shipping-balance&amp;orderId=fictional-order/);
  assert.match(email.text, /Pay Shipping Balance Now/);
  assert.match(email.html, /Pay Shipping Balance Now/);
  assert.match(email.text, /valid for 48 hours/i);
  assert.match(email.html, /valid for 48 hours/i);
  assert.match(email.html, /&lt;Phone&gt; \(Qty 2\)/);
  assert.doesNotMatch(email.html, /Paystack/);
});

test("shipping payment confirmation includes the verified amount and reference", () => {
  const email = buildShippingPaymentConfirmationEmail({
    customerName: "Test Customer",
    orderNumber: "NX-SHIP-002",
    amount: 80,
    paymentReference: "pay-fictional-002",
    appUrl: "https://example.invalid",
  });

  assert.match(email.subject, /confirmed/i);
  assert.match(email.text, /GH₵80\.00/);
  assert.match(email.text, /pay-fictional-002/);
  assert.match(email.html, /Shipping payment confirmed/);
});

test("shipment update includes order, tracking reference, status, and safe link", () => {
  const email = buildShipmentUpdateEmail({
    customerName: "Test Customer",
    orderNumber: "NX-SHIP-003",
    trackingReference: "Batch 42 Air freight",
    statusLabel: "Shipment arrived in Ghana",
    message: "Your shipment has arrived at Ghana's airport.",
    actionUrl: "/profile/shipments?batch=42&freight=air",
    appUrl: "https://example.invalid",
  });

  assert.match(email.text, /NX-SHIP-003/);
  assert.match(email.text, /Batch 42 Air freight/);
  assert.match(email.text, /Shipment arrived in Ghana/);
  assert.match(email.html, /https:\/\/example\.invalid\/profile\/shipments\?batch=42&amp;freight=air/);
});

test("guest shipment update omits an inaccessible tracking action", () => {
  const email = buildShipmentUpdateEmail({
    customerName: "Guest Customer",
    orderNumber: "NX-SHIP-004",
    trackingReference: "Batch 43 Sea freight",
    statusLabel: "Shipment dispatched from China",
    message: "Your shipment has departed China.",
    appUrl: "https://example.invalid",
  });

  assert.doesNotMatch(email.text, /View shipment tracking/);
  assert.doesNotMatch(email.html, /View Shipment Tracking/);
  assert.doesNotMatch(email.html, /profile\/shipments/);
});

test("shipping adjustment email includes financial context and a fresh-payment action", () => {
  const email = buildShippingFeeAdjustmentEmail({
    customerName: "Test Customer",
    title: "Shipping Fee Increased",
    message: "Order NX-ADJ-001: shipping fee changed from GHS 0.03 to GHS 0.05 for product Test 2. Amount already paid: GHS 0.03. Credit applied: GHS 0.00.",
    outstanding: 0.02,
    appUrl: "https://example.invalid",
    actionUrl: "/payment?purpose=shipping-balance&orderId=order-1&token=fresh-token",
  });
  assert.match(email.subject, /Shipping Fee Increased/);
  assert.match(email.text, /Amount already paid/);
  assert.match(email.text, /Pay Shipping Balance/);
  assert.match(email.html, /valid for 48 hours/);
});

test("shipping adjustment credit email does not request payment", () => {
  const email = buildShippingFeeAdjustmentEmail({
    customerName: "Test Customer",
    title: "Shipping Credit Added",
    message: "GHS 30.00 shipping credit was added.",
    outstanding: 0,
    appUrl: "https://example.invalid",
  });
  assert.match(email.subject, /Shipping Credit Added/);
  assert.match(email.text, /deducted automatically from the next eligible shipping fee/);
  assert.doesNotMatch(email.text, /Pay Shipping Balance:/);
  assert.doesNotMatch(email.html, /Pay Shipping Balance<\/a>/);
});
