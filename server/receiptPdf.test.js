import assert from "node:assert/strict";
import test from "node:test";
import { buildReceiptPdfBuffer } from "./receiptPdf.js";

const baseReceipt = {
  receiptNumber: "PAY-RECEIPT-001",
  orderNumber: "ORD-RECEIPT-001",
  orderDate: "2026-11-17T10:00:00.000Z",
  createdAt: "2026-11-17T10:05:00.000Z",
  paymentReference: "PAY-RECEIPT-001",
  paymentMethod: "mobile-money",
  paymentStatus: "Successful",
  customerName: "Ama Customer",
  customerEmail: "ama@example.invalid",
  customerPhone: "+233 20 000 0000",
  shippingAddress: {
    deliveryLocation: "Amasaman",
    landmark: "Community school",
    region: "Greater Accra",
    country: "Ghana",
  },
  subtotal: 125.5,
  orderAmountDue: 140.5,
  amountPaid: 125.5,
  remainingOrderBalance: 15,
  shippingFeeCharged: 15,
  shippingAmountPaid: 0,
  outstandingShipping: 15,
};

const items = [
  {
    product_name: "Greatness hoodie",
    selected_options: { Color: "Navy", Size: "Large" },
    quantity: 2,
    unit_price: 62.75,
    line_subtotal: 125.5,
  },
];

function asPdfText(buffer) {
  return buffer.toString("latin1");
}

test("order receipt embeds the official logo and formats structured data", () => {
  const pdf = asPdfText(buildReceiptPdfBuffer(baseReceipt, items));

  assert.match(pdf, /^%PDF-1\.4/);
  assert.match(pdf, /\/Subtype \/Image/);
  assert.match(pdf, /\/SMask/);
  assert.match(pdf, /OFFICIAL ORDER PAYMENT RECEIPT/);
  assert.match(pdf, /PAYMENT SUCCESSFUL/);
  assert.match(pdf, /Greatness hoodie/);
  assert.match(pdf, /Amasaman/);
  assert.match(pdf, /Greater Accra/);
  assert.match(pdf, /GHS 125\.50/);
  assert.doesNotMatch(pdf, /shipping_address_snapshot/);
  assert.doesNotMatch(pdf, /\[object Object\]/);
});

test("shipping receipt keeps shipping totals separate from product payments", () => {
  const pdf = asPdfText(buildReceiptPdfBuffer({
    ...baseReceipt,
    paymentPurpose: "shipping",
    amountPaid: 10,
    shippingFeeCharged: 25,
    previousShippingPaid: 5,
    totalShippingPaid: 15,
    outstandingShipping: 10,
  }, items));

  assert.match(pdf, /OFFICIAL SHIPPING PAYMENT RECEIPT/);
  assert.match(pdf, /Total shipping fee charged/);
  assert.match(pdf, /Previous shipping payments/);
  assert.match(pdf, /Current shipping payment/);
  assert.match(pdf, /Total shipping paid to date/);
  assert.match(pdf, /Remaining shipping balance/);
  assert.match(pdf, /GHS 5\.00/);
  assert.match(pdf, /GHS 10\.00/);
});

test("long receipts paginate and repeat page metadata without raw address JSON", () => {
  const manyItems = Array.from({ length: 30 }, (_, index) => ({
    product_name: `Long product name ${index} with additional warehouse description`,
    selected_color: "Navy",
    selected_size: "Large",
    quantity: 1,
    unit_price: 125000,
    line_subtotal: 125000,
  }));
  const pdf = asPdfText(buildReceiptPdfBuffer(baseReceipt, manyItems));

  assert.ok((pdf.match(/\/Type \/Page\b/g) || []).length >= 2);
  assert.match(pdf, /Page 1 of/);
  assert.match(pdf, /Page 2 of/);
  assert.ok((pdf.match(/Product \/ Variation/g) || []).length >= 2);
  assert.doesNotMatch(pdf, /deliveryLocation.*landmark.*region/);
});
