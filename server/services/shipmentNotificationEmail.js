function clean(value) {
  return String(value ?? "").trim();
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>\"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "\"": "&quot;",
    "'": "&#39;",
  })[character]);
}

function formatCedis(value) {
  return `GH₵${(Number(value) || 0).toFixed(2)}`;
}

function resolveAppUrl(appUrl) {
  return clean(appUrl).replace(/\/+$/, "") || "https://nexuse-commerce.onrender.com";
}

export function buildShippingPaymentRequiredEmail({
  customerName,
  orderNumber,
  items = [],
  outstanding,
  appUrl,
  actionUrl,
}) {
  const name = clean(customerName) || "Customer";
  const number = clean(orderNumber) || "your order";
  const amount = formatCedis(outstanding);
  const itemLines = (Array.isArray(items) ? items : [])
    .map((item) => {
      const name = clean(item?.productName || item?.product_name) || "Product";
      const quantity = Number(item?.quantity) > 0 ? Number(item.quantity) : null;
      return quantity ? `${name} (Qty ${quantity})` : name;
    })
    .filter(Boolean);
  const products = itemLines.length > 0 ? itemLines.join(", ") : "Your order items";
  const orderUrl = clean(actionUrl).startsWith("http")
    ? clean(actionUrl)
    : `${resolveAppUrl(appUrl)}${clean(actionUrl) || "/profile/orders"}`;
  const subject = `Shipping payment required for order ${number}`;
  const text = `Dear ${name},\n\nYour order ${number} has an outstanding shipping balance of ${amount}.\n\nOrder details:\nProducts: ${products}\nOrder ID: ${number}\nOutstanding shipping balance: ${amount}\n\nPlease complete your shipping payment so we can continue processing your delivery.\n\nPay Shipping Balance Now: ${orderUrl}\n\nNexus Import Hub\nShop Beyond Borders. We Handle the Rest.`;
  const htmlItems = itemLines.map((item) => `<li>${escapeHtml(item)}</li>`).join("");
  const html = `<div style="font-family:Arial,sans-serif;line-height:1.6;color:#172033;max-width:640px"><h2 style="color:#0240CD">Nexus Import Hub</h2><p>Dear ${escapeHtml(name)},</p><h1 style="color:#0240CD;font-size:22px">Shipping payment required</h1><p>Your order <strong>${escapeHtml(number)}</strong> has an outstanding shipping balance of <strong style="color:#F74F00">${escapeHtml(amount)}</strong>.</p><h3 style="color:#172033;margin-bottom:6px">Order details</h3><p style="margin-top:0"><strong>Order ID:</strong> ${escapeHtml(number)}<br><strong>Outstanding shipping balance:</strong> ${escapeHtml(amount)}</p><ul style="margin-top:0;padding-left:20px">${htmlItems || `<li>${escapeHtml(products)}</li>`}</ul><p>Please complete your shipping payment so we can continue processing your delivery.</p><p><a href="${escapeHtml(orderUrl)}" style="display:inline-block;background:#0240CD;color:#fff;padding:11px 18px;text-decoration:none;border-radius:6px">Pay Shipping Balance Now</a></p><p style="color:#64748b">Shop Beyond Borders. We Handle the Rest.</p></div>`;
  return { subject, text, html };
}

export function buildShippingPaymentConfirmationEmail({
  customerName,
  orderNumber,
  amount,
  paymentReference,
  appUrl,
}) {
  const name = clean(customerName) || "Customer";
  const number = clean(orderNumber) || "your order";
  const paid = formatCedis(amount);
  const reference = clean(paymentReference);
  const orderUrl = `${resolveAppUrl(appUrl)}/profile/orders`;
  const subject = `Shipping payment confirmed for order ${number}`;
  const referenceLine = reference ? `\nPayment reference: ${reference}` : "";
  const referenceHtml = reference ? `<p style="color:#64748b;font-size:13px">Payment reference: ${escapeHtml(reference)}</p>` : "";
  const text = `Dear ${name},\n\nYour shipping payment of ${paid} for order ${number} was verified successfully.${referenceLine}\n\nView your order: ${orderUrl}\n\nNexus Import Hub\nShop Beyond Borders. We Handle the Rest.`;
  const html = `<div style="font-family:Arial,sans-serif;line-height:1.6;color:#172033;max-width:640px"><h2 style="color:#0240CD">Nexus Import Hub</h2><p>Dear ${escapeHtml(name)},</p><h1 style="color:#0240CD;font-size:22px">Shipping payment confirmed</h1><p>Your shipping payment of <strong style="color:#F74F00">${escapeHtml(paid)}</strong> for order <strong>${escapeHtml(number)}</strong> was verified successfully.</p>${referenceHtml}<p><a href="${escapeHtml(orderUrl)}" style="display:inline-block;background:#0240CD;color:#fff;padding:11px 18px;text-decoration:none;border-radius:6px">View Your Order</a></p><p style="color:#64748b">Shop Beyond Borders. We Handle the Rest.</p></div>`;
  return { subject, text, html };
}

export function buildShipmentUpdateEmail({
  customerName,
  orderNumber,
  trackingReference,
  statusLabel,
  message,
  actionUrl,
  appUrl,
}) {
  const name = clean(customerName) || "Customer";
  const number = clean(orderNumber) || "your order";
  const reference = clean(trackingReference) || "shipment";
  const status = clean(statusLabel) || "Shipment update";
  const update = clean(message) || `Your shipment ${reference} has a new update.`;
  const resolvedAction = clean(actionUrl).startsWith("http")
    ? clean(actionUrl)
    : `${resolveAppUrl(appUrl)}${clean(actionUrl) || "/profile/shipments"}`;
  const hasAction = Boolean(clean(actionUrl));
  const subject = `${status} - Nexus Import Hub`;
  const textAction = hasAction ? `\nView shipment tracking: ${resolvedAction}\n` : "";
  const htmlAction = hasAction ? `<p><a href="${escapeHtml(resolvedAction)}" style="display:inline-block;background:#0240CD;color:#fff;padding:11px 18px;text-decoration:none;border-radius:6px">View Shipment Tracking</a></p>` : "";
  const text = `Dear ${name},\n\n${update}\n\nOrder: ${number}\nShipment: ${reference}\nStatus: ${status}${textAction}\nNexus Import Hub\nShop Beyond Borders. We Handle the Rest.`;
  const html = `<div style="font-family:Arial,sans-serif;line-height:1.6;color:#172033;max-width:640px"><h2 style="color:#0240CD">Nexus Import Hub</h2><p>Dear ${escapeHtml(name)},</p><h1 style="color:#0240CD;font-size:22px">${escapeHtml(status)}</h1><p>${escapeHtml(update)}</p><table role="presentation" cellpadding="0" cellspacing="0" style="margin:18px 0;color:#334155"><tr><td style="padding:4px 18px 4px 0;font-weight:700">Order</td><td style="padding:4px 0">${escapeHtml(number)}</td></tr><tr><td style="padding:4px 18px 4px 0;font-weight:700">Shipment</td><td style="padding:4px 0">${escapeHtml(reference)}</td></tr><tr><td style="padding:4px 18px 4px 0;font-weight:700">Status</td><td style="padding:4px 0;color:#F74F00;font-weight:700">${escapeHtml(status)}</td></tr></table>${htmlAction}<p style="color:#64748b">Shop Beyond Borders. We Handle the Rest.</p></div>`;
  return { subject, text, html };
}
