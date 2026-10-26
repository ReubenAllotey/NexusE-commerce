function clean(value) {
  return String(value ?? "").trim();
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

export function buildGuestAccountSetupNotification(order = {}) {
  const orderId = clean(order.id);
  const userId = clean(order.user_id);
  if (!orderId || !userId) return null;

  return {
    user_id: userId,
    category: "orders",
    title: "Set up your Nexus Import Hub account",
    message: "Your order was confirmed. Use the secure email link to create your account password and access your order details.",
    order_id: orderId,
    action_url: "/account/set-password",
    action_label: "Set up account",
    action_description: "Create a password for your Nexus Import Hub account.",
    source_type: "account_setup",
    source_key: `account-setup:${orderId}`,
    is_read: false,
    read_at: null,
  };
}

export function buildAccountSetupEmail({ customerName, actionLink, appUrl }) {
  const name = clean(customerName) || "Customer";
  const link = clean(actionLink);
  const baseUrl = clean(appUrl).replace(/\/+$/, "") || "https://nexuse-commerce.onrender.com";
  const safeLink = link || `${baseUrl}/account/set-password`;
  const subject = "Set up your Nexus Import Hub account";
  const text = `Dear ${name},\n\nYour Nexus Import Hub order was confirmed. Use the secure link below to set your account password and access your order details:\n\n${safeLink}\n\nThis link is for your account only and will expire. If you did not place this order, please contact support.\n\nNexus Import Hub\nShop Beyond Borders. We Handle the Rest.`;
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(subject)}</title></head><body style="margin:0;padding:0;background:#f3f6fb;font-family:Arial,Helvetica,sans-serif;color:#172033"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;background:#f3f6fb"><tr><td align="center" style="padding:24px 12px"><table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:600px;background:#ffffff;border:1px solid #e5e7eb;border-radius:10px;overflow:hidden"><tr><td style="padding:24px 28px;background:#0240CD;border-bottom:5px solid #F74F00;text-align:center"><div style="font-size:22px;line-height:1.2;font-weight:700;letter-spacing:.4px;color:#ffffff">NEXUS IMPORT HUB</div><div style="margin-top:8px;font-size:12px;letter-spacing:1px;color:#dbe7ff;text-transform:uppercase">Secure account setup</div></td></tr><tr><td style="padding:30px 28px"><p style="margin:0 0 10px;font-size:16px">Dear ${escapeHtml(name)},</p><h1 style="margin:0 0 12px;color:#0240CD;font-size:24px;line-height:1.25">Set your account password</h1><p style="margin:0;color:#475569;font-size:14px;line-height:1.7">Your order was confirmed successfully. Use the secure button below to create your password and access your Nexus Import Hub account.</p><p style="margin:24px 0;text-align:center"><a href="${escapeHtml(safeLink)}" style="display:inline-block;background:#0240CD;color:#ffffff;text-decoration:none;font-size:14px;font-weight:700;padding:13px 24px;border-radius:6px">Set Up My Account</a></p><p style="margin:0;color:#64748b;font-size:13px;line-height:1.6">This secure link expires. If you did not place this order, please contact support and do not use the link.</p></td></tr><tr><td style="padding:20px 28px;background:#f8fafc;border-top:1px solid #e5e7eb;text-align:center"><p style="margin:0;color:#0240CD;font-size:13px;font-weight:700">Shop Beyond Borders. We Handle the Rest.</p><p style="margin:8px 0 0;color:#94a3b8;font-size:11px">Nexus Import Hub</p></td></tr></table></td></tr></table></body></html>`;
  return { subject, text, html };
}
