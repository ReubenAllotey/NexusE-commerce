function clean(value) {
  return String(value ?? "").trim();
}

function isValidEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

export function resolvePaymentNoticeRecipient(order) {
  const userId = clean(order?.user_id);
  const email = clean(order?.customer_email).toLowerCase();

  return {
    eligible: isValidEmail(email),
    userId: userId || null,
    email,
  };
}
