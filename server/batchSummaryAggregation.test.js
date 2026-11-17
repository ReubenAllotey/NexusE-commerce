import assert from "node:assert/strict";
import test from "node:test";
import { aggregateBatchRows, formatVariantDetails } from "../src/pages/Admin/batchSummary/batchSummaryUtils.js";

function item(overrides = {}) {
  return {
    productId: "product-1",
    name: "T-shirt",
    selectedOptions: [
      { groupName: "Color", label: "Red" },
      { groupName: "Size", label: "L" },
    ],
    availabilityType: "ready_stock",
    quantity: 1,
    price: 10,
    lineSubtotal: 10,
    ...overrides,
  };
}

test("batch aggregation sums identical configurations and displays the total quantity", () => {
  const rows = aggregateBatchRows([
    { id: "order-a", batchNumber: "Batch-03", items: [item({ quantity: 2, lineSubtotal: 20 })] },
    { id: "order-b", batchNumber: "Batch-03", items: [item({ quantity: 3, lineSubtotal: 30 })] },
  ], "Batch-03");

  assert.equal(rows.length, 1);
  assert.equal(rows[0].quantity, 5);
  assert.equal(rows[0].totalValue, 50);
  assert.equal(rows[0].orders.length, 2);
  assert.equal(formatVariantDetails(rows[0].options, rows[0].quantity), "Red / L (5)");
});

test("different configurations remain separate and base products use their own quantity", () => {
  const rows = aggregateBatchRows([{
    id: "order-a",
    batchNumber: "Batch-03",
    items: [
      item({ quantity: 4, lineSubtotal: 40 }),
      item({ selectedOptions: [{ groupName: "Color", label: "Blue" }, { groupName: "Size", label: "M" }], quantity: 3, lineSubtotal: 36 }),
      item({ productId: "product-2", name: "Mug", selectedOptions: [], quantity: 5, price: 4, lineSubtotal: 20 }),
    ],
  }], "Batch-03");

  assert.equal(rows.length, 3);
  assert.deepEqual(rows.map((row) => row.quantity).sort((a, b) => a - b), [3, 4, 5]);
  assert.ok(rows.some((row) => formatVariantDetails(row.options, row.quantity) === "Red / L (4)"));
  assert.ok(rows.some((row) => formatVariantDetails(row.options, row.quantity) === "Blue / M (3)"));
  assert.ok(rows.some((row) => formatVariantDetails(row.options, row.quantity) === "Base product (5)"));
});

test("different prices remain visible as mixed pricing while quantities stay accurate", () => {
  const rows = aggregateBatchRows([
    { id: "order-a", batchNumber: "Batch-03", items: [item({ quantity: 2, price: 10, lineSubtotal: 20 })] },
    { id: "order-b", batchNumber: "Batch-03", items: [item({ quantity: 1, price: 12, lineSubtotal: 12 })] },
  ], "Batch-03");

  assert.equal(rows[0].quantity, 3);
  assert.equal(rows[0].unitPrice, null);
  assert.equal(rows[0].totalValue, 32);
});
