import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { buildBatchSummaryPdf } from "../src/pages/Admin/batchSummary/batchSummaryPdf.js";

const pageSource = await readFile(new URL("../src/pages/Admin/batchSummary/batchSummary.jsx", import.meta.url), "utf8");

function sampleRow(index) {
  return {
    name: `Product ${index} with a deliberately long procurement name`,
    slug: `SKU-${index}`,
    options: [{ group: "Color", value: "Navy" }, { group: "Size", value: "Large" }],
    availabilityType: index % 2 ? "preorder" : "ready_stock",
    quantity: index + 1,
    unitPrice: 12.5,
    totalValue: (index + 1) * 12.5,
    orders: [{ id: `order-${index}`, orderNumber: `ORD-${index}` }],
  };
}

test("batch summary PDF contains branding, selected batch, financial summary, and procurement headers", () => {
  const pdf = new TextDecoder().decode(buildBatchSummaryPdf({
    batchNumber: "Batch-03",
    rows: [sampleRow(1)],
    metrics: { products: 1, units: 2, orders: 1, value: 25 },
    generatedAt: "2026-10-30T12:00:00.000Z",
    filters: "All availability | No search filter",
  }));

  assert.match(pdf, /^%PDF-1\.4/);
  assert.match(pdf, /NEXUS IMPORT HUB/);
  assert.match(pdf, /Batch-03/);
  assert.match(pdf, /Total Products/);
  assert.match(pdf, /Total Units/);
  assert.match(pdf, /Total Orders/);
  assert.match(pdf, /Total Value/);
  assert.match(pdf, /Product Name/);
  assert.match(pdf, /Order References/);
  assert.match(pdf, /GHS 25\.00/);
});

test("batch summary PDF paginates long procurement reports and repeats table headers", () => {
  const pdf = new TextDecoder().decode(buildBatchSummaryPdf({
    batchNumber: "Batch-03",
    rows: Array.from({ length: 14 }, (_, index) => sampleRow(index)),
    metrics: { products: 14, units: 119, orders: 14, value: 1190 },
    generatedAt: "2026-10-30T12:00:00.000Z",
  }));

  assert.ok((pdf.match(/\/Type \/Page\b/g) || []).length >= 2);
  assert.ok((pdf.match(/Product Name/g) || []).length >= 2);
  assert.match(pdf, /Page 1 of 2/);
  assert.match(pdf, /Page 2 of 2/);
  assert.match(pdf, /Order References/);
});

test("batch summary PDF safely encodes special characters and supports an empty report", () => {
  const specialPdf = new TextDecoder().decode(buildBatchSummaryPdf({
    batchNumber: "Batch-03",
    rows: [{
      name: "Café ₵ (special) \\ inventory",
      sku: "SKU-(03)",
      variant: "Color: Navy (XL)",
      availability: "Ready Stock",
      quantity: 1,
      unitPrice: 20,
      totalValue: 20,
      orders: [{ orderNumber: "ORD-(03)" }],
    }],
    metrics: { products: 1, units: 1, orders: 1, value: 20 },
  }));
  const emptyPdf = new TextDecoder().decode(buildBatchSummaryPdf({ batchNumber: "Batch-03", rows: [] }));

  assert.match(specialPdf, /Caf\?/);
  assert.ok(specialPdf.includes("\\(special\\)"));
  assert.ok(specialPdf.includes("SKU-\\(03\\)"));
  assert.match(emptyPdf, /^%PDF-1\.4/);
  assert.match(emptyPdf, /No batch selected|Selected batch: Batch-03/);
  assert.match(emptyPdf, /Product Name/);
});

test("batch summary PDF keeps long procurement rows instead of silently dropping them", () => {
  const longName = "Industrial generator replacement component with extended warehouse description";
  const longReference = Array.from({ length: 18 }, (_, index) => `ORD-LONG-${index + 1}`).join(", ");
  const pdf = new TextDecoder().decode(buildBatchSummaryPdf({
    batchNumber: "Batch-03",
    rows: [{
      name: longName,
      slug: "GENERATOR-COMPONENT",
      options: [{ group: "Finish", value: "Heavy duty" }],
      availabilityType: "ready_stock",
      quantity: 1,
      unitPrice: 125000,
      totalValue: 125000,
      orders: longReference.split(", ").map((orderNumber, index) => ({ id: index, orderNumber })),
    }],
    metrics: { products: 1, units: 1, orders: 18, value: 125000 },
  }));

  assert.match(pdf, /Industrial/);
  assert.match(pdf, /GENERATOR-COMPO/);
  assert.match(pdf, /ORD-LONG-18/);
  assert.match(pdf, /GHS 125000\.00/);
});

test("the page removed CSV export and passes the selected filtered rows to PDF export", () => {
  assert.doesNotMatch(pageSource, /Export CSV|downloadCsv/);
  assert.match(pageSource, /downloadBatchSummaryPdf\(\{ batchNumber: activeBatch, rows, metrics: exportMetrics, filters: filterDescription \}\)/);
});
