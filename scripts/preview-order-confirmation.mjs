import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildOrderConfirmationEmail } from "../server/services/orderConfirmationEmail.js";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const previewDir = path.join(rootDir, "previews");

const context = {
  payment: {
    provider_reference: "TEST-PAYMENT-NX-001",
    status: "successful",
    amount: 3800,
    currency: "GHS",
    paid_at: "2026-10-23T12:00:00.000Z",
  },
  order: {
    id: "00000000-0000-0000-0000-000000000001",
    order_number: "NX-TEST-001",
    user_id: null,
    created_at: "2026-10-23T11:55:00.000Z",
    subtotal: 3800,
    shipping_total: 0,
    shipping_payment_mode: "pay_later",
    shipping_address_snapshot: {
      country: "Ghana",
      region: "Greater Accra",
      deliveryLocation: "Test Community",
    },
  },
  orders: [],
  items: [
    {
      product_name: "iPhone 13",
      selected_options: [
        { groupName: "Storage", value: "128GB" },
        { groupName: "Color", value: "Midnight" },
      ],
      quantity: 1,
      unit_price: 3500,
      line_subtotal: 3500,
    },
    {
      product_name: "Wireless Earbuds",
      quantity: 2,
      unit_price: 150,
      line_subtotal: 300,
    },
  ],
};
context.orders = [context.order];
const previewOptions = { appUrl: "https://nexuse-commerce.onrender.com" };

const registered = buildOrderConfirmationEmail(
  { ...context, order: { ...context.order, user_id: "00000000-0000-0000-0000-000000000002" } },
  "Test Customer",
  previewOptions,
);
const guest = buildOrderConfirmationEmail(context, "Test Customer", previewOptions);
const malicious = buildOrderConfirmationEmail(
  {
    ...context,
    items: [...context.items, {
      product_name: '<img src=x onerror="alert(1)">',
      quantity: 1,
      unit_price: 0,
      line_subtotal: 0,
    }],
  },
  "Test Customer",
  previewOptions,
);

assert.match(registered.html, /iPhone 13/);
assert.match(registered.html, /128GB/);
assert.match(registered.html, /Midnight/);
assert.match(registered.html, /Wireless Earbuds/);
assert.match(registered.text, /x2 - GH₵300\.00/);
assert.match(registered.html, /GH₵3,500\.00/);
assert.match(registered.html, /GH₵150\.00/);
assert.match(registered.html, /GH₵3,800\.00/);
assert.match(registered.html, /Payment reference:<\/strong> TEST-PAYMENT-NX-001/);
assert.match(registered.html, /To be communicated separately/);
assert.match(registered.html, /Successful/);
assert.match(registered.html, /https:\/\/nexuse-commerce\.onrender\.com\/profile\/orders/);
assert.match(registered.html, /View Your Order/);
assert.doesNotMatch(guest.html, /View Your Order/);
assert.match(guest.html, /Your order has been confirmed\. We will send updates about your order and shipping to this email address\./);
assert.match(guest.text, /Your order has been confirmed\. We will send updates about your order and shipping to this email address\./);
assert.doesNotMatch(guest.html, /payment\?reference=/);
assert.doesNotMatch(guest.html, /deliveryLocation/);
assert.doesNotMatch(malicious.html, /<img src=x onerror/);
assert.match(malicious.html, /&lt;img src=x onerror=&quot;alert\(1\)&quot;&gt;/);

await fs.mkdir(previewDir, { recursive: true });
await fs.writeFile(
  path.join(previewDir, "order-confirmation-test.html"),
  `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${registered.subject}</title></head><body>${registered.html}</body></html>\n`,
  "utf8",
);
await fs.writeFile(path.join(previewDir, "order-confirmation-test.txt"), registered.text + "\n", "utf8");

console.log(`HTML preview: ${path.join(previewDir, "order-confirmation-test.html")}`);
console.log(`Plain-text preview: ${path.join(previewDir, "order-confirmation-test.txt")}`);
console.log("Receipt preview assertions: PASS");
