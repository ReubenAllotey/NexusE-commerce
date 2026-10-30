const PAGE_WIDTH = 841.89;
const PAGE_HEIGHT = 595.28;
const MARGIN = 32;
const CONTENT_WIDTH = PAGE_WIDTH - MARGIN * 2;
const CURRENCY = "GHS";

function clean(value) {
  return String(value ?? "").replace(/[\r\n]+/g, " ").trim();
}

function ascii(value) {
  return clean(value).replace(/[^\x20-\x7E]/g, "?");
}

function escapePdfText(value) {
  return ascii(value).replaceAll("\\", "\\\\").replaceAll("(", "\\(").replaceAll(")", "\\)");
}

function formatMoney(value) {
  return `${CURRENCY} ${Number(value || 0).toFixed(2)}`;
}

function formatOptions(options) {
  const safeOptions = Array.isArray(options) ? options : [];
  if (safeOptions.length === 0) return "Base product";
  return safeOptions
    .map((option) => `${clean(option?.group || option?.groupName || "Option")}: ${clean(option?.value || option?.label)}`)
    .filter((option) => !option.endsWith(":"))
    .join("; ") || "Base product";
}

function wrapText(value, width, fontSize = 8) {
  const text = ascii(value) || "-";
  const maxChars = Math.max(1, Math.floor(width / (fontSize * 0.52)));
  const words = text.split(/\s+/);
  const lines = [];
  let current = "";

  for (const word of words) {
    if (word.length > maxChars) {
      if (current) {
        lines.push(current);
        current = "";
      }
      for (let index = 0; index < word.length; index += maxChars) {
        lines.push(word.slice(index, index + maxChars));
      }
      continue;
    }

    const next = current ? `${current} ${word}` : word;
    if (next.length > maxChars) {
      lines.push(current);
      current = word;
    } else {
      current = next;
    }
  }

  if (current) lines.push(current);
  return lines.length > 0 ? lines : ["-"];
}

function textOp(text, x, top, size = 8, color = "0.12 0.18 0.27") {
  const baseline = PAGE_HEIGHT - top - size;
  return `${color} rg BT /F1 ${size} Tf 1 0 0 1 ${x.toFixed(2)} ${baseline.toFixed(2)} Tm (${escapePdfText(text)}) Tj ET`;
}

function rectOp(x, top, width, height, color) {
  const y = PAGE_HEIGHT - top - height;
  return `${color} rg ${x.toFixed(2)} ${y.toFixed(2)} ${width.toFixed(2)} ${height.toFixed(2)} re f`;
}

function lineOp(x1, top, x2, color = "0.84 0.87 0.91") {
  const y = PAGE_HEIGHT - top;
  return `${color} RG 0.5 w ${x1.toFixed(2)} ${y.toFixed(2)} m ${x2.toFixed(2)} ${y.toFixed(2)} l S`;
}

function normalizeRow(row = {}) {
  const orders = Array.isArray(row.orders) ? row.orders : [];
  return {
    name: clean(row.name) || "Unnamed product",
    sku: clean(row.sku || row.slug) || "No SKU snapshot",
    variant: clean(row.variant || row.variantDetails) || formatOptions(row.options),
    availability: clean(row.availability || row.availabilityLabel) || (clean(row.availabilityType) === "preorder" ? "Pre-order" : "Ready Stock"),
    quantity: Number(row.quantity) || 0,
    unitPrice: row.unitPrice == null ? "Mixed" : formatMoney(row.unitPrice),
    totalValue: formatMoney(row.totalValue),
    orders: orders.map((order) => clean(order.orderNumber || order.order_number || order.id)).filter(Boolean).join(", ") || "-",
  };
}

const TABLE_COLUMNS = [
  ["Product Name", 130],
  ["SKU", 75],
  ["Variant Details", 100],
  ["Availability", 62],
  ["Quantity", 40],
  ["Unit Price", 75],
  ["Total Value", 75],
  ["Order References", 220],
];

function wrapRow(row) {
  const values = normalizeRow(row);
  const wrapped = TABLE_COLUMNS.map(([label, width]) => wrapText(
    values[label === "Product Name" ? "name" : label === "Variant Details" ? "variant" : label === "Order References" ? "orders" : label === "Unit Price" ? "unitPrice" : label === "Total Value" ? "totalValue" : label.toLowerCase()],
    width - 10,
  ));
  return { wrapped, height: Math.max(...wrapped.map((lines) => lines.length)) * 10 + 8 };
}

function paginateRows(rows) {
  const firstPageCapacity = PAGE_HEIGHT - 38 - (78 + 36 + 56 + 22) - 28;
  const followingPageCapacity = PAGE_HEIGHT - 38 - (78 + 22) - 28;
  const pages = [];
  let current = [];
  let used = 0;

  rows.forEach((row) => {
    const height = wrapRow(row).height;
    const capacity = pages.length === 0 ? firstPageCapacity : followingPageCapacity;
    if (current.length > 0 && used + height > capacity) {
      pages.push(current);
      current = [];
      used = 0;
    }
    current.push(row);
    used += height;
  });
  if (current.length > 0 || pages.length === 0) pages.push(current);
  return pages;
}

function buildPageContent({ batchNumber, rows, metrics, generatedAt, filters, pageNumber, totalPages }) {
  const operations = [];
  const title = `Nexus Import Hub | Batch ${batchNumber || "Unselected"}`;
  const dateLabel = new Intl.DateTimeFormat("en-GH", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(generatedAt));

  operations.push(rectOp(0, 0, PAGE_WIDTH, 58, "0.04 0.12 0.24"));
  operations.push(textOp("NEXUS IMPORT HUB", MARGIN, 14, 13, "1 1 1"));
  operations.push(textOp("PROCUREMENT SUMMARY", MARGIN, 34, 7, "0.76 0.84 0.94"));
  operations.push(textOp(title, PAGE_WIDTH - MARGIN - Math.min(390, title.length * 5.2), 18, 11, "1 1 1"));
  operations.push(textOp(`Generated ${dateLabel}`, PAGE_WIDTH - MARGIN - 180, 37, 7, "0.76 0.84 0.94"));

  let top = 78;
  if (pageNumber === 1) {
    operations.push(textOp(`Selected batch: ${batchNumber || "None"}`, MARGIN, top, 10, "0.04 0.12 0.24"));
    operations.push(textOp(`Filters: ${filters || "All availability | No search filter"}`, MARGIN, top + 16, 7, "0.34 0.40 0.48"));
    top += 36;

    const cards = [
      ["Total Products", metrics.products],
      ["Total Units", metrics.units],
      ["Total Orders", metrics.orders],
      ["Total Value", formatMoney(metrics.value)],
    ];
    const cardGap = 8;
    const cardWidth = (CONTENT_WIDTH - cardGap * 3) / 4;
    cards.forEach(([label, value], index) => {
      const left = MARGIN + index * (cardWidth + cardGap);
      operations.push(rectOp(left, top, cardWidth, 42, index === 3 ? "0.89 0.95 0.91" : "0.93 0.96 0.99"));
      operations.push(textOp(label, left + 10, top + 8, 7, "0.34 0.40 0.48"));
      operations.push(textOp(value, left + 10, top + 21, 12, "0.04 0.12 0.24"));
    });
    top += 56;
  }

  const headerHeight = 22;
  operations.push(rectOp(MARGIN, top, CONTENT_WIDTH, headerHeight, "0.04 0.12 0.24"));
  let left = MARGIN;
  TABLE_COLUMNS.forEach(([label, width]) => {
    operations.push(textOp(label, left + 5, top + 7, 7, "1 1 1"));
    left += width;
  });
  top += headerHeight;

  rows.forEach((row, index) => {
    const { wrapped, height: rowHeight } = wrapRow(row);
    if (index % 2 === 0) operations.push(rectOp(MARGIN, top, CONTENT_WIDTH, rowHeight, "0.97 0.98 0.99"));
    left = MARGIN;
    wrapped.forEach((lines, columnIndex) => {
      lines.forEach((line, lineIndex) => operations.push(textOp(line, left + 5, top + 5 + lineIndex * 10, 7, "0.12 0.18 0.27")));
      left += TABLE_COLUMNS[columnIndex][1];
    });
    operations.push(lineOp(MARGIN, top + rowHeight, MARGIN + CONTENT_WIDTH));
    top += rowHeight;
  });

  if (pageNumber === totalPages) {
    operations.push(textOp("Grand Total", MARGIN + 500, top + 14, 8, "0.04 0.12 0.24"));
    operations.push(textOp(formatMoney(metrics.value), MARGIN + 650, top + 14, 9, "0.04 0.12 0.24"));
  }

  operations.push(lineOp(MARGIN, PAGE_HEIGHT - 28, PAGE_WIDTH - MARGIN, "0.72 0.77 0.83"));
  operations.push(textOp("Internal procurement report - authorized batch data only", MARGIN, PAGE_HEIGHT - 22, 7, "0.42 0.47 0.54"));
  operations.push(textOp(`Page ${pageNumber} of ${totalPages}`, PAGE_WIDTH - MARGIN - 70, PAGE_HEIGHT - 22, 7, "0.42 0.47 0.54"));
  return operations.join("\n");
}

function createPdf(contents) {
  const objects = [];
  const addObject = (value) => {
    objects.push(value);
    return objects.length;
  };
  const catalogId = addObject("<< /Type /Catalog /Pages 2 0 R >>");
  const pagesId = addObject(null);
  const fontId = addObject("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>");
  const contentIds = contents.map((content) => addObject(`<< /Length ${content.length} >>\nstream\n${content}\nendstream`));
  const pageIds = contents.map((_, index) => addObject(`<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 ${PAGE_WIDTH} ${PAGE_HEIGHT}] /Resources << /Font << /F1 ${fontId} 0 R >> >> /Contents ${contentIds[index]} 0 R >>`));
  objects[pagesId - 1] = `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(" ")}] /Count ${pageIds.length} >>`;

  let pdf = "%PDF-1.4\n% Nexus Import Hub\n";
  const offsets = [0];
  objects.forEach((object, index) => {
    offsets.push(pdf.length);
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xrefOffset = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  offsets.slice(1).forEach((offset) => { pdf += `${String(offset).padStart(10, "0")} 00000 n \n`; });
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root ${catalogId} 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`;
  return new TextEncoder().encode(pdf);
}

export function buildBatchSummaryPdf({ batchNumber = "", rows = [], metrics = {}, generatedAt = new Date(), filters = "" } = {}) {
  const normalizedRows = Array.isArray(rows) ? rows : [];
  const safeMetrics = {
    products: Number(metrics.products) || normalizedRows.length,
    units: Number(metrics.units) || normalizedRows.reduce((sum, row) => sum + (Number(row.quantity) || 0), 0),
    orders: Number(metrics.orders) || new Set(normalizedRows.flatMap((row) => row.orders ?? [])).size,
    value: Number(metrics.value) || normalizedRows.reduce((sum, row) => sum + (Number(row.totalValue) || 0), 0),
  };
  const rowPages = paginateRows(normalizedRows);
  const pageCount = rowPages.length;
  const pages = rowPages.map((pageRows, pageIndex) => {
    return buildPageContent({
      batchNumber,
      rows: pageRows,
      metrics: safeMetrics,
      generatedAt,
      filters,
      pageNumber: pageIndex + 1,
      totalPages: pageCount,
    });
  });
  return createPdf(pages);
}

export function downloadBatchSummaryPdf(options = {}) {
  if (typeof window === "undefined" || typeof document === "undefined") return false;
  const bytes = buildBatchSummaryPdf(options);
  const blob = new Blob([bytes], { type: "application/pdf" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  const batch = String(options.batchNumber || "unselected").replace(/[^a-z0-9-_]/gi, "-");
  link.href = url;
  link.download = `Nexus-${batch}-Summary.pdf`;
  link.click();
  URL.revokeObjectURL(url);
  return true;
}
