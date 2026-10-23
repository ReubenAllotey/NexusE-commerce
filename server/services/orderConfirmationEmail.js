function clean(value) {
  return String(value ?? "").trim();
}

function formatGhanaCedis(value) {
  const safeValue = Number(value) || 0;
  return new Intl.NumberFormat("en-GH", {
    style: "currency",
    currency: "GHS",
    currencyDisplay: "symbol",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(safeValue);
}

function formatOrderDate(value) {
  if (!value) return "Not available";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Not available";
  return new Intl.DateTimeFormat("en-GH", { dateStyle: "medium", timeZone: "Africa/Accra" }).format(date);
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  })[character]);
}

function normalizeSelectedOptions(value) {
  if (Array.isArray(value)) {
    return value.map((option) => {
      if (!option || typeof option !== "object") return null;
      const groupName = clean(option.groupName ?? option.group_name);
      const valueText = clean(option.value ?? option.label ?? option.optionValue ?? option.option_value);
      return groupName && valueText ? `${groupName}: ${valueText}` : valueText;
    }).filter(Boolean);
  }

  if (value && typeof value === "object") {
    return Object.entries(value).map(([name, optionValue]) => {
      const valueText = clean(optionValue);
      return valueText ? `${clean(name)}: ${valueText}` : "";
    }).filter(Boolean);
  }

  return [];
}

function formatOrderEmailVariation(item) {
  const selectedOptions = normalizeSelectedOptions(item?.selected_options);
  if (selectedOptions.length > 0) return selectedOptions.join(", ");
  return [
    clean(item?.selected_color) ? `Color: ${clean(item.selected_color)}` : "",
    clean(item?.selected_size) ? `Size: ${clean(item.selected_size)}` : "",
  ].filter(Boolean).join(", ");
}

const ADDRESS_LABELS = {
  address: "Address",
  addressLine1: "Address",
  address_line_1: "Address",
  city: "City",
  country: "Country",
  deliveryLocation: "Delivery location",
  delivery_location: "Delivery location",
  landmark: "Landmark",
  region: "Region",
  town: "Town",
  community: "Community",
};

function humanizeAddressKey(key) {
  if (ADDRESS_LABELS[key]) return ADDRESS_LABELS[key];
  return clean(key).replace(/([a-z])([A-Z])/g, "$1 $2").replace(/[_-]+/g, " ").replace(/\b\w/g, (character) => character.toUpperCase());
}

function formatOrderEmailAddress(snapshot) {
  if (!snapshot || typeof snapshot !== "object" || Array.isArray(snapshot)) return "Not provided";
  const preferredKeys = ["country", "region", "city", "town", "deliveryLocation", "delivery_location", "community", "landmark", "address", "addressLine1", "address_line_1"];
  const keys = [...preferredKeys.filter((key) => key in snapshot), ...Object.keys(snapshot).filter((key) => !preferredKeys.includes(key))];
  return keys.map((key) => {
    const value = clean(snapshot[key]);
    return value ? `${humanizeAddressKey(key)}: ${value}` : "";
  }).filter(Boolean).join(" · ") || "Not provided";
}

function firstNumber(entries, keys) {
  for (const entry of entries) {
    for (const key of keys) {
      if (entry?.[key] !== undefined && entry?.[key] !== null && entry?.[key] !== "") return Number(entry[key]) || 0;
    }
  }
  return 0;
}

function isAbsoluteHttpUrl(value) {
  try {
    const parsed = new URL(value);
    return parsed.protocol === "https:";
  } catch {
    return false;
  }
}

export function buildOrderConfirmationEmail(context, customerName, options = {}) {
  const { payment, order, orders = [], items = [] } = context;
  const orderNumber = clean(order.order_number) || clean(order.id);
  const orderDate = formatOrderDate(payment.paid_at || order.created_at);
  const subtotal = orders.reduce((sum, entry) => sum + (Number(entry.subtotal) || 0), 0);
  const shippingTotal = orders.reduce((sum, entry) => sum + (Number(entry.shipping_total) || 0), 0);
  const shippingPaidNow = orders.some((entry) => clean(entry.shipping_payment_mode).toLowerCase() === "pay_now");
  const discount = firstNumber(orders, ["discount_total", "discount", "discount_amount"]);
  const fees = firstNumber(orders, ["fee_total", "fees", "service_fee", "processing_fee", "tax"]);
  const amountPaid = Number(payment.amount) || Number(payment.amount_minor) / 100 || 0;
  const itemLines = items.map((item) => {
    const variation = formatOrderEmailVariation(item);
    const quantity = Number(item.quantity) || 0;
    const unitPrice = Number(item.unit_price) || 0;
    const lineTotal = Number(item.line_subtotal) || unitPrice * quantity;
    return { name: clean(item.product_name) || "Product", variation, quantity, unitPrice, lineTotal };
  });
  const shippingLabel = shippingPaidNow ? formatGhanaCedis(shippingTotal) : "To be communicated separately";
  const itemText = itemLines.length > 0 ? itemLines.map((item) => `${item.name}${item.variation ? ` (${item.variation})` : ""} x${item.quantity} - ${formatGhanaCedis(item.lineTotal)}`).join("\n") : "No item details available.";
  const safeItems = itemLines.length > 0
    ? itemLines.map((item) => `<tr><td style="padding:12px 8px;border-bottom:1px solid #e5e7eb;color:#172033"><strong>${escapeHtml(item.name)}</strong>${item.variation ? `<br><span style="font-size:12px;color:#64748b">${escapeHtml(item.variation)}</span>` : ""}</td><td style="padding:12px 8px;border-bottom:1px solid #e5e7eb;text-align:center;color:#172033">${item.quantity}</td><td style="padding:12px 8px;border-bottom:1px solid #e5e7eb;text-align:right;color:#172033">${escapeHtml(formatGhanaCedis(item.unitPrice))}</td><td style="padding:12px 8px;border-bottom:1px solid #e5e7eb;text-align:right;color:#172033">${escapeHtml(formatGhanaCedis(item.lineTotal))}</td></tr>`).join("")
    : `<tr><td colspan="4" style="padding:14px 8px;color:#64748b">No item details available.</td></tr>`;
  const shippingAddress = formatOrderEmailAddress(order.shipping_address_snapshot);
  const appUrl = clean(options.appUrl || process.env.PUBLIC_APP_URL || process.env.APP_URL) || "https://nexuse-commerce.onrender.com";
  const normalizedAppUrl = appUrl.replace(/\/+$/, "");
  const orderLink = `${normalizedAppUrl}/profile/orders`;
  const isRegisteredCustomer = Boolean(clean(order.user_id));
  const guestConfirmationMessage = "Your order has been confirmed. We will send updates about your order and shipping to this email address.";
  const logoUrl = clean(options.logoUrl || process.env.PUBLIC_LOGO_URL || `${normalizedAppUrl}/nexus-pwa-512.png`);
  const safeLogoUrl = isAbsoluteHttpUrl(logoUrl) ? logoUrl : "";
  const supportEmail = clean(options.supportEmail || process.env.SUPPORT_EMAIL);
  const supportUrl = `${normalizedAppUrl}/contact`;
  const greeting = clean(customerName) || "Customer";
  const subject = `Order confirmation - Nexus Order #${orderNumber}`;
  const summaryRows = [
    `<tr><td style="padding:5px 0;color:#64748b">Subtotal</td><td style="padding:5px 0;text-align:right;color:#172033">${escapeHtml(formatGhanaCedis(subtotal))}</td></tr>`,
    discount > 0 ? `<tr><td style="padding:5px 0;color:#64748b">Discount</td><td style="padding:5px 0;text-align:right;color:#15803d">-${escapeHtml(formatGhanaCedis(discount))}</td></tr>` : "",
    fees > 0 ? `<tr><td style="padding:5px 0;color:#64748b">Fees</td><td style="padding:5px 0;text-align:right;color:#172033">${escapeHtml(formatGhanaCedis(fees))}</td></tr>` : "",
    `<tr><td style="padding:5px 0;color:#64748b">Shipping</td><td style="padding:5px 0;text-align:right;color:#172033">${escapeHtml(shippingLabel)}</td></tr>`,
    `<tr><td style="padding:10px 0 0;color:#172033;font-weight:700;border-top:2px solid #0240CD">Amount paid</td><td style="padding:10px 0 0;text-align:right;color:#0240CD;font-weight:700;border-top:2px solid #0240CD">${escapeHtml(formatGhanaCedis(amountPaid))}</td></tr>`,
  ].filter(Boolean).join("");
  const text = `Dear ${greeting},\n\nYour payment was verified successfully.\n\nOrder: ${orderNumber}\nOrder date: ${orderDate}\nPayment status: Successful\nPayment reference: ${clean(payment.provider_reference)}\n\n${itemText}\n\nSubtotal: ${formatGhanaCedis(subtotal)}${discount > 0 ? `\nDiscount: -${formatGhanaCedis(discount)}` : ""}${fees > 0 ? `\nFees: ${formatGhanaCedis(fees)}` : ""}\nShipping: ${shippingLabel}\nAmount paid: ${formatGhanaCedis(amountPaid)}\n\nDelivery address: ${shippingAddress}\n\n${isRegisteredCustomer ? `View your order: ${orderLink}` : guestConfirmationMessage}\n\n${supportEmail ? `Support: ${supportEmail}` : `Support: ${supportUrl}`}\nShop Beyond Borders. We Handle the Rest.`;
  const logoMarkup = safeLogoUrl
    ? `<img src="${escapeHtml(safeLogoUrl)}" width="64" height="64" alt="Nexus Import Hub" style="display:block;width:64px;height:64px;object-fit:contain;border:0;margin:0 auto 10px">`
    : `<div style="font-size:22px;line-height:1.2;font-weight:700;letter-spacing:.4px;color:#ffffff">NEXUS IMPORT HUB</div>`;
  const supportMarkup = supportEmail ? `<a href="mailto:${escapeHtml(supportEmail)}" style="color:#0240CD;text-decoration:none">${escapeHtml(supportEmail)}</a>` : `<a href="${escapeHtml(supportUrl)}" style="color:#0240CD;text-decoration:none">Contact support</a>`;
  const orderActionMarkup = isRegisteredCustomer
    ? `<tr><td align="center" style="padding:4px 28px 30px"><a href="${escapeHtml(orderLink)}" style="display:inline-block;background:#0240CD;color:#ffffff;text-decoration:none;font-size:14px;font-weight:700;padding:13px 24px;border-radius:6px">View Your Order</a></td></tr>`
    : `<tr><td style="padding:4px 28px 30px;color:#475569;font-size:13px;line-height:1.6;text-align:center">${escapeHtml(guestConfirmationMessage)}</td></tr>`;
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(subject)}</title></head><body style="margin:0;padding:0;background:#f3f6fb;font-family:Arial,Helvetica,sans-serif;color:#172033"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;background:#f3f6fb"><tr><td align="center" style="padding:24px 12px"><table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:600px;background:#ffffff;border:1px solid #e5e7eb;border-radius:10px;overflow:hidden"><tr><td align="center" style="padding:24px 20px;background:#0240CD;border-bottom:5px solid #F74F00">${logoMarkup}<div style="font-size:12px;letter-spacing:2px;color:#dbe7ff;text-transform:uppercase">Official payment confirmation</div></td></tr><tr><td style="padding:28px 28px 8px"><p style="margin:0 0 8px;font-size:16px">Dear ${escapeHtml(greeting)},</p><h1 style="margin:0;color:#0240CD;font-size:25px;line-height:1.25">Payment successful</h1><p style="margin:8px 0 20px;color:#475569;font-size:14px;line-height:1.6">Thank you for shopping with Nexus Import Hub. Your order confirmation is below.</p><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#eff6ff;border-left:4px solid #0240CD"><tr><td style="padding:14px 16px;font-size:14px;line-height:1.7"><strong>Order:</strong> ${escapeHtml(orderNumber)}<br><strong>Order date:</strong> ${escapeHtml(orderDate)}<br><strong>Payment status:</strong> <span style="color:#15803d;font-weight:700">Successful</span><br><strong>Payment reference:</strong> ${escapeHtml(clean(payment.provider_reference))}</td></tr></table></td></tr><tr><td style="padding:18px 28px 0"><h2 style="margin:0 0 10px;font-size:17px;color:#172033">Items purchased</h2><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;border-collapse:collapse;font-size:13px"><thead><tr style="background:#f8fafc;color:#475569"><th align="left" style="padding:10px 8px;font-size:11px;text-transform:uppercase">Product</th><th align="center" style="padding:10px 8px;font-size:11px;text-transform:uppercase">Qty</th><th align="right" style="padding:10px 8px;font-size:11px;text-transform:uppercase">Unit price</th><th align="right" style="padding:10px 8px;font-size:11px;text-transform:uppercase">Total</th></tr></thead><tbody>${safeItems}</tbody></table></td></tr><tr><td style="padding:20px 28px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;font-size:14px">${summaryRows}</table><p style="margin:14px 0 0;padding:10px 12px;background:#fff7ed;border-left:3px solid #F74F00;color:#9a3412;font-size:13px;line-height:1.5">${shippingPaidNow ? "Shipping was included in this payment." : "Shipping costs have not been charged yet and will be communicated separately."}</p></td></tr><tr><td style="padding:0 28px 22px"><h2 style="margin:0 0 8px;font-size:17px;color:#172033">Delivery details</h2><p style="margin:0;color:#475569;font-size:13px;line-height:1.7">${escapeHtml(shippingAddress)}</p></td></tr>${orderActionMarkup}<tr><td align="center" style="padding:20px 28px;background:#f8fafc;border-top:1px solid #e5e7eb"><p style="margin:0 0 8px;color:#64748b;font-size:12px;line-height:1.6">Need help? ${supportMarkup}</p><p style="margin:0;color:#0240CD;font-size:13px;font-weight:700">Shop Beyond Borders. We Handle the Rest.</p><p style="margin:8px 0 0;color:#94a3b8;font-size:11px">Nexus Import Hub</p></td></tr></table></td></tr></table></body></html>`;
  return { subject, text, html };
}
