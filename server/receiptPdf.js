import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import zlib from "node:zlib";

const ROOT_DIR = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const PAGE_WIDTH = 595;
const PAGE_HEIGHT = 842;
const NAVY = [16, 45, 89];
const BLUE = [22, 119, 210];
const LIGHT_BLUE = [239, 246, 255];
const TEXT = [23, 32, 51];
const MUTED = [100, 116, 139];
const GREEN = [21, 128, 61];
const BORDER = [226, 232, 240];
const CONTENT_BOTTOM = 70;

function clean(value) {
  return String(value ?? "").trim();
}

function formatMoney(value) {
  const amount = Number(value);
  return `GHS ${(Number.isFinite(amount) ? amount : 0).toFixed(2)}`;
}

function escapePdfText(value) {
  return String(value ?? "")
    .normalize("NFKD")
    .replace(/[^\x20-\x7E]/g, "?")
    .replace(/\\/g, "\\\\")
    .replace(/\(/g, "\\(")
    .replace(/\)/g, "\\)")
    .replace(/\r?\n/g, " ");
}

function wrapText(value, maxChars) {
  const text = clean(value);
  if (!text) return [""];
  const words = text.split(/\s+/);
  const lines = [];
  let current = "";
  for (const word of words) {
    if (word.length > maxChars && !current) {
      for (let index = 0; index < word.length; index += maxChars) lines.push(word.slice(index, index + maxChars));
      continue;
    }
    const next = current ? `${current} ${word}` : word;
    if (next.length > maxChars && current) {
      lines.push(current);
      current = word;
    } else {
      current = next;
    }
  }
  if (current) lines.push(current);
  return lines.length ? lines : [""];
}

function colorRgb(color, stroke = false) {
  const values = color.map((value) => (value / 255).toFixed(3)).join(" ");
  return `${values} ${stroke ? "RG" : "rg"}`;
}

function textCommand(text, x, y, size = 9, color = TEXT, font = "F1") {
  return `${colorRgb(color)} BT /${font} ${size} Tf 1 0 0 1 ${x} ${y} Tm (${escapePdfText(text)}) Tj ET`;
}

function rectCommand(x, y, width, height, color, stroke = false, lineWidth = 1) {
  return `${colorRgb(color, stroke)} ${lineWidth} w ${x} ${y} ${width} ${height} re ${stroke ? "S" : "f"}`;
}

function lineCommand(x1, y1, x2, y2, color = BORDER, lineWidth = 1) {
  return `${colorRgb(color, true)} ${lineWidth} w ${x1} ${y1} m ${x2} ${y2} l S`;
}

function parsePng(buffer) {
  if (!buffer || buffer.toString("ascii", 1, 4) !== "PNG") return null;
  const width = buffer.readUInt32BE(16);
  const height = buffer.readUInt32BE(20);
  const bitDepth = buffer[24];
  const colorType = buffer[25];
  const interlace = buffer[28];
  if (bitDepth !== 8 || (colorType !== 6 && colorType !== 2) || interlace !== 0) return null;

  const idat = [];
  let offset = 8;
  while (offset < buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.toString("ascii", offset + 4, offset + 8);
    const data = buffer.subarray(offset + 8, offset + 8 + length);
    if (type === "IDAT") idat.push(data);
    if (type === "IEND") break;
    offset += length + 12;
  }

  const channels = colorType === 6 ? 4 : 3;
  const decoded = zlib.inflateSync(Buffer.concat(idat));
  const stride = width * channels;
  const rows = Buffer.alloc(height * stride);
  let sourceOffset = 0;
  for (let row = 0; row < height; row += 1) {
    const filter = decoded[sourceOffset++];
    const rowOffset = row * stride;
    for (let column = 0; column < stride; column += 1) {
      const left = column >= channels ? rows[rowOffset + column - channels] : 0;
      const above = row > 0 ? rows[rowOffset - stride + column] : 0;
      const upperLeft = row > 0 && column >= channels ? rows[rowOffset - stride + column - channels] : 0;
      const value = decoded[sourceOffset++];
      let result = value;
      if (filter === 1) result = (value + left) & 255;
      if (filter === 2) result = (value + above) & 255;
      if (filter === 3) result = (value + Math.floor((left + above) / 2)) & 255;
      if (filter === 4) {
        const estimate = left + above - upperLeft;
        const distanceLeft = Math.abs(estimate - left);
        const distanceAbove = Math.abs(estimate - above);
        const distanceUpperLeft = Math.abs(estimate - upperLeft);
        const predictor = distanceLeft <= distanceAbove && distanceLeft <= distanceUpperLeft ? left : distanceAbove <= distanceUpperLeft ? above : upperLeft;
        result = (value + predictor) & 255;
      }
      rows[rowOffset + column] = result;
    }
  }

  const rgb = Buffer.alloc(width * height * 3);
  const alpha = colorType === 6 ? Buffer.alloc(width * height) : null;
  for (let index = 0; index < width * height; index += 1) {
    const source = index * channels;
    rgb[index * 3] = rows[source];
    rgb[index * 3 + 1] = rows[source + 1];
    rgb[index * 3 + 2] = rows[source + 2];
    if (alpha) alpha[index] = rows[source + 3];
  }
  return { width, height, rgb: zlib.deflateSync(rgb), alpha: alpha ? zlib.deflateSync(alpha) : null };
}

function loadLogo() {
  try {
    return parsePng(fs.readFileSync(path.join(ROOT_DIR, "src/assets/images/nexusLogomain.png")));
  } catch {
    return null;
  }
}

function formatDate(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return clean(value) || "Not available";
  return new Intl.DateTimeFormat("en-GH", { dateStyle: "medium", timeZone: "Africa/Accra" }).format(date);
}

function addressLines(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return value ? [clean(value)] : ["Not provided"];
  const labels = [
    ["deliveryLocation", "Delivery location"],
    ["location", "Delivery location"],
    ["landmark", "Landmark"],
    ["city", "City"],
    ["region", "Region"],
    ["country", "Country"],
  ];
  const seen = new Set();
  const lines = [];
  for (const [key, label] of labels) {
    const valueText = clean(value[key]);
    if (valueText && !seen.has(label)) {
      lines.push(`${label}: ${valueText}`);
      seen.add(label);
    }
  }
  return lines.length ? lines : ["Not provided"];
}

function variationText(item) {
  const selected = item.selected_options;
  if (selected && typeof selected === "object" && !Array.isArray(selected)) {
    const values = Object.entries(selected).map(([key, value]) => `${key}: ${value}`).filter(Boolean);
    if (values.length) return values.join(" | ");
  }
  return [item.selected_color, item.selected_size].filter(Boolean).join(" | ") || "-";
}

function buildPdfDocument(pageCommands, logo) {
  const objects = [];
  const pageIds = [];
  const contentIds = [];
  const catalogId = 1;
  const pagesId = 2;
  const fontId = 3;
  const boldFontId = 4;
  let nextId = 5;
  let logoId = null;
  let maskId = null;
  if (logo) {
    logoId = nextId++;
    if (logo.alpha) maskId = nextId++;
  }
  const firstPageId = nextId;
  const firstContentId = firstPageId + pageCommands.length;
  for (let index = 0; index < pageCommands.length; index += 1) {
    pageIds.push(firstPageId + index);
    contentIds.push(firstContentId + index);
  }

  objects[catalogId - 1] = `<< /Type /Catalog /Pages ${pagesId} 0 R >>`;
  objects[pagesId - 1] = `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(" ")}] /Count ${pageIds.length} >>`;
  objects[fontId - 1] = "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>";
  objects[boldFontId - 1] = "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>";
  if (logo) {
    const imageDict = `<< /Type /XObject /Subtype /Image /Width ${logo.width} /Height ${logo.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /FlateDecode${maskId ? ` /SMask ${maskId} 0 R` : ""} /Length ${logo.rgb.length} >>\nstream\n`;
    objects[logoId - 1] = { binary: Buffer.concat([Buffer.from(imageDict, "binary"), logo.rgb, Buffer.from("\nendstream", "binary")]) };
    if (maskId) {
      const maskDict = `<< /Type /XObject /Subtype /Image /Width ${logo.width} /Height ${logo.height} /ColorSpace /DeviceGray /BitsPerComponent 8 /Filter /FlateDecode /Length ${logo.alpha.length} >>\nstream\n`;
      objects[maskId - 1] = { binary: Buffer.concat([Buffer.from(maskDict, "binary"), logo.alpha, Buffer.from("\nendstream", "binary")]) };
    }
  }

  pageCommands.forEach((commands, index) => {
    const content = commands.join("\n");
    objects[pageIds[index] - 1] = `<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 ${PAGE_WIDTH} ${PAGE_HEIGHT}] /Resources << /Font << /F1 ${fontId} 0 R /F2 ${boldFontId} 0 R >>${logoId ? ` /XObject << /Im1 ${logoId} 0 R >>` : ""} >> /Contents ${contentIds[index]} 0 R >>`;
    objects[contentIds[index] - 1] = `<< /Length ${Buffer.byteLength(content, "binary")} >>\nstream\n${content}\nendstream`;
  });

  let pdf = Buffer.from("%PDF-1.4\n", "binary");
  const offsets = [0];
  objects.forEach((object, index) => {
    offsets.push(pdf.length);
    const body = object && typeof object === "object" ? object.binary : Buffer.from(String(object), "binary");
    pdf = Buffer.concat([pdf, Buffer.from(`${index + 1} 0 obj\n`, "binary"), body, Buffer.from("\nendobj\n", "binary")]);
  });
  const xrefOffset = pdf.length;
  let xref = `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (let index = 1; index < offsets.length; index += 1) xref += `${String(offsets[index]).padStart(10, "0")} 00000 n \n`;
  xref += `trailer\n<< /Size ${objects.length + 1} /Root ${catalogId} 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`;
  return Buffer.concat([pdf, Buffer.from(xref, "binary")]);
}

function createPage(logo, title, pageNumber, totalPages) {
  const commands = [];
  commands.push(rectCommand(0, 0, PAGE_WIDTH, PAGE_HEIGHT, [255, 255, 255]));
  commands.push(rectCommand(0, PAGE_HEIGHT - 8, PAGE_WIDTH, 8, NAVY));
  if (logo) {
    commands.push("q 168 0 0 56 42 754 cm /Im1 Do Q");
  } else {
    commands.push(textCommand("NEXUS IMPORT HUB", 42, 780, 18, NAVY, "F2"));
  }
  commands.push(textCommand(title, 360, 785, 10, NAVY, "F2"));
  commands.push(textCommand("PAYMENT SUCCESSFUL", 360, 767, 9, GREEN, "F2"));
  commands.push(lineCommand(42, 742, 553, 742, BLUE, 2));
  commands.push(lineCommand(42, 48, 553, 48, BORDER));
  commands.push(textCommand("Nexus Import Hub | Shop Beyond Borders. We Handle the Rest.", 42, 32, 7, MUTED));
  commands.push(textCommand(`Page ${pageNumber} of ${totalPages}`, 490, 32, 7, MUTED));
  return { commands, y: 720 };
}

function addText(page, value, options = {}) {
  const size = options.size ?? 9;
  const leading = options.leading ?? size + 4;
  const lines = wrapText(value, options.maxChars ?? 92);
  for (const line of lines) {
    page = page.ensureSpace(leading + 4);
    page.commands.push(textCommand(line, options.x ?? 42, page.y, size, options.color ?? TEXT, options.font ?? "F1"));
    page.y -= leading;
  }
  return lines.length * leading;
}

function addSection(page, title) {
  page = page.ensureSpace(35);
  page.y -= 6;
  page.commands.push(rectCommand(42, page.y - 5, 511, 20, LIGHT_BLUE));
  page.commands.push(textCommand(title, 52, page.y + 2, 10, NAVY, "F2"));
  page.y -= 27;
}

function addField(page, label, value, x, width) {
  page = page.ensureSpace(32);
  page.commands.push(textCommand(label.toUpperCase(), x, page.y, 6.5, MUTED, "F2"));
  const lines = wrapText(value || "Not available", Math.max(12, Math.floor(width / 5.2)));
  lines.slice(0, 2).forEach((line, index) => page.commands.push(textCommand(line, x, page.y - 11 - index * 10, 8.5, TEXT)));
}

function addTable(page, items, title, shippingOnly = false) {
  addSection(page, title);
  const columns = shippingOnly
    ? [{ label: "Item", x: 52, width: 250 }, { label: "Qty", x: 330, width: 45 }, { label: "Amount", x: 420, width: 110 }]
    : [{ label: "Product / Variation", x: 52, width: 245 }, { label: "Qty", x: 315, width: 35 }, { label: "Unit Price", x: 365, width: 75 }, { label: "Total", x: 470, width: 70 }];
  const header = () => {
    page = page.ensureSpace(30);
    page.commands.push(rectCommand(42, page.y - 5, 511, 19, NAVY));
    columns.forEach((column) => page.commands.push(textCommand(column.label, column.x, page.y + 1, 7.5, [255, 255, 255], "F2")));
    page.y -= 24;
  };
  header();
  const safeItems = Array.isArray(items) ? items : [];
  if (!safeItems.length) {
    addText(page, "No purchased item details were saved with this receipt.", { size: 8.5, maxChars: 90 });
    return;
  }
  safeItems.forEach((item, index) => {
    const name = clean(item.product_name || item.name || "Item");
    const description = shippingOnly ? name : `${name} | ${variationText(item)}`;
    const rows = wrapText(description, shippingOnly ? 45 : 42);
    const height = Math.max(22, rows.length * 10 + 8);
    page = page.ensureSpace(height);
    if (page.y === 720) header();
    if (index % 2 === 0) page.commands.push(rectCommand(42, page.y - height + 4, 511, height, [248, 250, 252]));
    rows.forEach((line, rowIndex) => page.commands.push(textCommand(line, columns[0].x, page.y - rowIndex * 10, 7.8, TEXT)));
    page.commands.push(textCommand(String(Math.max(Number(item.quantity) || 1, 1)), columns[1].x, page.y, 8, TEXT));
    if (shippingOnly) {
      page.commands.push(textCommand(formatMoney(item.line_subtotal || item.total || 0), columns[2].x, page.y, 8, TEXT));
    } else {
      page.commands.push(textCommand(formatMoney(item.unit_price || 0), columns[2].x, page.y, 8, TEXT));
      page.commands.push(textCommand(formatMoney(item.line_subtotal || item.total || 0), columns[3].x, page.y, 8, TEXT));
    }
    page.y -= height;
  });
}

export function buildReceiptPdfBuffer(receipt = {}, items = []) {
  const shipping = clean(receipt.paymentPurpose).toLowerCase() === "shipping";
  const title = shipping ? "OFFICIAL SHIPPING PAYMENT RECEIPT" : "OFFICIAL ORDER PAYMENT RECEIPT";
  const logo = loadLogo();
  const pages = [];
  let page = null;
  const newPage = () => {
    page = createPage(logo, title, pages.length + 1, 1);
    page.newPage = newPage;
    page.ensureSpace = (height) => {
      if (page.y - height < CONTENT_BOTTOM) return newPage();
      return page;
    };
    pages.push(page);
    return page;
  };
  newPage();
  page.commands.push(textCommand(`Receipt No: ${receipt.receiptNumber || receipt.paymentReference || "Not available"}`, 360, 750, 7.5, MUTED));
  page.commands.push(textCommand(`Payment date: ${formatDate(receipt.createdAt)}`, 360, 738, 7.5, MUTED));
  page.commands.push(rectCommand(42, page.y - 5, 511, 48, LIGHT_BLUE));
  page.commands.push(textCommand("AMOUNT PAID IN THIS TRANSACTION", 54, page.y + 27, 8, NAVY, "F2"));
  page.commands.push(textCommand(formatMoney(receipt.amountPaid), 54, page.y + 7, 18, NAVY, "F2"));
  page.y -= 65;

  addSection(page, shipping ? "Shipping payment confirmation" : "Payment confirmation");
  addField(page, "Payment method", receipt.paymentMethod || receipt.paymentNetwork || "Paystack", 52, 150);
  addField(page, "Payment reference", receipt.paymentReference, 220, 180);
  addField(page, "Status", "Successful", 430, 100);
  page.y -= 38;

  addSection(page, shipping ? "Related order and delivery" : "Order and customer details");
  addField(page, "Order number", receipt.orderNumber, 52, 150);
  addField(page, "Order date", formatDate(receipt.orderDate), 220, 150);
  addField(page, "Customer", receipt.customerName || "Customer", 390, 150);
  page.y -= 38;
  addField(page, "Email", receipt.customerEmail, 52, 230);
  addField(page, "Phone", receipt.customerPhone, 310, 200);
  page.y -= 38;
  const delivery = addressLines(receipt.shippingAddress ?? receipt.deliveryLocation);
  addField(page, "Delivery information", delivery.join(" | "), 52, 500);
  page.y -= 38;

  if (shipping) {
    addSection(page, "Shipping charges");
    const rows = [
      ["Total shipping fee charged", formatMoney(receipt.shippingFeeCharged)],
      ["Previous shipping payments", formatMoney(receipt.previousShippingPaid)],
      ["Current shipping payment", formatMoney(receipt.amountPaid)],
      ["Total shipping paid to date", formatMoney(receipt.totalShippingPaid)],
      ["Remaining shipping balance", formatMoney(receipt.outstandingShipping)],
    ];
    rows.forEach(([label, value], index) => {
      page = page.ensureSpace(24);
      if (index % 2 === 0) page.commands.push(rectCommand(42, page.y - 6, 511, 20, [248, 250, 252]));
      page.commands.push(textCommand(label, 54, page.y, 8.5, TEXT));
      page.commands.push(textCommand(value, 455, page.y, 8.5, TEXT, "F2"));
      page.y -= 20;
    });
    page.y -= 8;
    addTable(page, items, "Related purchased items", true);
  } else {
    addTable(page, items, "Purchased products");
    page.y -= 8;
    addSection(page, "Payment summary");
    const rows = [
      ["Product subtotal", formatMoney(receipt.subtotal)],
      ["Order amount due", formatMoney(receipt.orderAmountDue ?? receipt.subtotal)],
      ["Amount paid in this transaction", formatMoney(receipt.amountPaid)],
      ["Remaining order balance", formatMoney(receipt.remainingOrderBalance)],
      ["Shipping fee charged", formatMoney(receipt.shippingFeeCharged)],
      ["Shipping amount paid", formatMoney(receipt.shippingAmountPaid)],
      ["Outstanding shipping balance", formatMoney(receipt.outstandingShipping)],
    ];
    rows.forEach(([label, value], index) => {
      page = page.ensureSpace(24);
      if (index % 2 === 0) page.commands.push(rectCommand(42, page.y - 6, 511, 20, [248, 250, 252]));
      page.commands.push(textCommand(label, 54, page.y, 8.5, TEXT));
      page.commands.push(textCommand(value, 455, page.y, 8.5, TEXT, "F2"));
      page.y -= 20;
    });
  }
  page.y -= 12;
  addText(page, "This receipt confirms a verified payment. It does not by itself confirm delivery or completion of the order.", { size: 7.5, color: MUTED, maxChars: 100 });
  addText(page, "Thank you for choosing Nexus Import Hub.", { size: 8.5, color: NAVY, font: "F2" });
  addText(page, "https://nexuse-commerce.onrender.com/", { size: 7.5, color: BLUE });

  const totalPages = pages.length;
  pages.forEach((entry, index) => {
    entry.commands = entry.commands.map((command) => command.replace(/Page \d+ of 1/g, `Page ${index + 1} of ${totalPages}`));
  });
  return buildPdfDocument(pages.map((entry) => entry.commands), logo);
}
