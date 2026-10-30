import assert from "node:assert/strict";
import test from "node:test";
import { resolveAdminNotificationAction } from "../src/pages/Admin/notification/adminNotificationActions.js";

test("successful and updated payments use the admin payment workspace", () => {
  const successful = resolveAdminNotificationAction({
    sourceType: "payment_status",
    title: "Payment successful",
    paymentId: "payment-1",
    paymentStatus: "successful",
    orderId: "order-1",
  });
  const updated = resolveAdminNotificationAction({
    sourceType: "payment_status",
    title: "Payment updated",
    paymentId: "payment-2",
    orderId: "order-2",
  });

  assert.equal(successful.actionLabel, "View Payment");
  assert.equal(successful.actionUrl, "/admin/orders?orderId=order-1&paymentId=payment-1");
  assert.equal(updated.actionLabel, "View Payment");
  assert.equal(updated.actionUrl, "/admin/orders?orderId=order-2&paymentId=payment-2");
});

test("processing payments use status review and shipping requests use the order workspace", () => {
  const processing = resolveAdminNotificationAction({
    sourceType: "payment_status",
    title: "Payment processing",
    paymentId: "payment-1",
    paymentStatus: "processing",
    orderId: "order-1",
  });
  const shipping = resolveAdminNotificationAction({
    sourceType: "payment_status",
    sourceKey: "shipping-payment-request:order-1",
    title: "Shipping Fee Payment Required",
    orderId: "order-1",
  });

  assert.equal(processing.actionLabel, "Check Payment Status");
  assert.equal(shipping.actionLabel, "View Order");
  assert.equal(shipping.actionUrl, "/admin/orders?orderId=order-1");
});

test("orders, shipments, and account notifications use existing admin destinations", () => {
  assert.equal(
    resolveAdminNotificationAction({ sourceType: "order_status", title: "Order placed", orderId: "order-1" }).actionUrl,
    "/admin/orders?orderId=order-1",
  );
  assert.equal(
    resolveAdminNotificationAction({ sourceType: "shipment_event", title: "Shipment updated", shipmentId: "shipment-1" }).actionUrl,
    "/admin/shipment?shipmentId=shipment-1",
  );
  assert.equal(
    resolveAdminNotificationAction({ sourceKey: "account-setup:order-1", title: "Account setup required", userId: "user-1" }).actionUrl,
    "/admin/customers?customerId=user-1",
  );
});

test("missing trusted IDs produce non-clickable actions instead of broken customer links", () => {
  const missingPaymentId = resolveAdminNotificationAction({
    sourceType: "payment_status",
    title: "Payment successful",
    orderId: "order-1",
    paymentStatus: "successful",
  });
  const missingOrderId = resolveAdminNotificationAction({
    sourceType: "order_status",
    title: "Order updated",
  });
  const general = resolveAdminNotificationAction({ title: "General notice", message: "Please review this." });

  assert.equal(missingPaymentId.actionLabel, "View Payment");
  assert.equal(missingPaymentId.actionUrl, "");
  assert.equal(missingOrderId.actionLabel, "View Order");
  assert.equal(missingOrderId.actionUrl, "");
  assert.equal(general.actionLabel, "No action");
  assert.equal(general.actionUrl, "");
});

test("admin resolver ignores customer-facing action metadata", () => {
  const action = resolveAdminNotificationAction({
    sourceType: "order_status",
    title: "Order status updated",
    orderId: "order-1",
    actionUrl: "/payment?purpose=shipping-balance&orderId=order-1",
    actionLabel: "Pay Shipping Fee",
  });

  assert.equal(action.actionLabel, "View Order");
  assert.equal(action.actionUrl, "/admin/orders?orderId=order-1");
});
