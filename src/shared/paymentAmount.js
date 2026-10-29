export function getPaymentAmountCedis(payment = {}) {
  const minor = Number(payment?.amount_minor);
  if (Number.isSafeInteger(minor) && payment?.amount_minor !== null && payment?.amount_minor !== undefined && String(payment.amount_minor).trim() !== "") {
    return minor / 100;
  }

  const amount = Number(payment?.amount);
  return Number.isFinite(amount) ? amount : 0;
}
