import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import test from "node:test";

const migrationPath = new URL("../supabase/migrations/20261126_0065_shipping_fee_adjustments_and_credits.sql", import.meta.url);
const serverPath = new URL("../server.js", import.meta.url);
const shipmentPath = new URL("../src/pages/Admin/shipment/shipment.jsx", import.meta.url);
const overpaymentMigrationPath = new URL("../supabase/migrations/20261128_0067_reconcile_shipping_payment_overpayments.sql", import.meta.url);
const checkoutCreditMigrationPath = new URL("../supabase/migrations/20261128_0068_apply_shipping_credit_on_order_creation.sql", import.meta.url);

const [migration, server, shipment, overpaymentMigration, checkoutCreditMigration] = await Promise.all([
  readFile(migrationPath, "utf8"),
  readFile(serverPath, "utf8"),
  readFile(shipmentPath, "utf8"),
  readFile(overpaymentMigrationPath, "utf8"),
  readFile(checkoutCreditMigrationPath, "utf8"),
]);

test("shipping adjustment migration uses forward-only audited objects", () => {
  assert.match(migration, /create table if not exists public\.shipping_fee_adjustments/);
  assert.match(migration, /operation_id uuid not null unique/);
  assert.match(migration, /create table if not exists public\.shipping_fee_adjustment_orders/);
  assert.match(migration, /unique \(adjustment_id, order_item_id\)/);
  assert.match(migration, /create table if not exists public\.shipping_credit_ledger/);
  assert.match(migration, /source_key text not null unique/);
  assert.match(migration, /entry_type text not null check \(entry_type in \('issue', 'consume', 'reversal'\)\)/);
  assert.match(migration, /create or replace function public\.reverse_shipping_credit/);
});

test("preview and apply are restricted to active administrators and service role", () => {
  assert.match(migration, /Only active administrators can preview shipping fee adjustments/);
  assert.match(migration, /Only active administrators can apply shipping fee adjustments/);
  assert.match(migration, /grant execute on function public\.preview_shipping_fee_adjustment\([^\n]+\) to service_role/);
  assert.match(migration, /grant execute on function public\.apply_shipping_fee_adjustment\([^\n]+\) to service_role/);
  assert.match(migration, /grant execute on function public\.get_my_shipping_credit_ledger\(\) to authenticated/);
});

test("only open-batch, non-finalized orders enter preview and apply", () => {
  const openBatchChecks = (migration.match(/ib\.status = 'open'/g) || []).length;
  assert.ok(openBatchChecks >= 2);
  assert.match(migration, /not in \('cancelled', 'completed', 'delivered'\)/);
});

test("direct product fee changes are fenced when an existing open-batch obligation exists", () => {
  assert.match(migration, /nexus\.shipping_fee_adjustment_write/);
  assert.match(migration, /Existing shipping obligations require an audited shipping fee adjustment/);
  assert.match(migration, /perform set_config\('nexus\.shipping_fee_adjustment_write', 'on', true\)/);
});

test("apply operation is idempotent and records immutable credit movements", () => {
  assert.match(migration, /where operation_id = p_operation_id for update/);
  assert.match(migration, /alreadyApplied/);
  assert.match(migration, /shipping-adjustment:issue:/);
  assert.match(migration, /shipping-adjustment:consume:/);
  assert.match(migration, /credit_issued_minor bigint not null default 0/);
  assert.match(migration, /shipping_payment_status = case when v_order_credit_issued > 0/);
});

test("backend uses authoritative admin session and existing shipping notice queue", () => {
  assert.match(server, /handleAdminShippingFeeAdjustment/);
  assert.match(server, /getActiveAdminForRequest\(req\)/);
  assert.match(server, /preview_shipping_fee_adjustment/);
  assert.match(server, /apply_shipping_fee_adjustment/);
  assert.match(server, /processShippingFeeAdjustmentNotifications/);
  assert.match(server, /create_shipping_fee_adjustment_notification/);
  assert.match(server, /notificationsRecoverable: true/);
});

test("admin UI previews before applying and submits product UUIDs", () => {
  assert.match(shipment, /Preview Adjustment/);
  assert.match(shipment, /Confirm Update Fee/);
  assert.match(shipment, /productId: selectedFeeProduct\.id/);
  assert.match(shipment, /expectedOldShippingFee/);
});

test("credit history is exposed only through the authenticated account endpoint", () => {
  assert.match(server, /handleMyShippingCredits/);
  assert.match(server, /get_my_shipping_credit_ledger/);
  assert.match(server, /\/api\/account\/shipping-credits/);
  assert.match(migration, /where l\.user_id = auth\.uid\(\)/);
});

test("guest shipping notifications skip authenticated-only push delivery", () => {
  const pushGuard = readFileSync("supabase/migrations/20261127_0066_guest_notification_push_guard.sql", "utf8");
  assert.match(pushGuard, /if new\.user_id is null then/);
  assert.match(pushGuard, /insert into public\.push_delivery_queue/);
  assert.match(pushGuard, /returns trigger[\s\S]*security definer/i);
});

test("apply rechecks and locks the batch after waiting for the order lock", () => {
  assert.match(migration, /select \* into v_batch[\s\S]*?from public\.import_batches[\s\S]*?for update/);
  assert.match(migration, /if not found or lower\(coalesce\(v_batch\.status, ''\)\) <> 'open' then/);
});

test("verified shipping overpayments settle obligations and issue idempotent credit", () => {
  assert.match(overpaymentMigration, /payment_events pe/);
  assert.match(overpaymentMigration, /lower\(coalesce\(pe\.status, ''\)\) = 'successful'/);
  assert.match(overpaymentMigration, /shipping-credit:payment:/);
  assert.match(overpaymentMigration, /on conflict \(source_key\) do nothing/);
  assert.match(overpaymentMigration, /Shipping credit available/);
  assert.match(overpaymentMigration, /v_payment\.user_id is distinct from v_order\.user_id/);
  assert.match(overpaymentMigration, /v_verified_amount > v_outstanding_shipping[\s\S]*not v_provider_verified/);
});

test("checkout applies registered customer credit before returning the order bundle", () => {
  assert.match(checkoutCreditMigration, /create or replace function private\.apply_shipping_credit_to_order\(\)/);
  assert.match(checkoutCreditMigration, /create constraint trigger order_items_apply_shipping_credit[\s\S]*after insert on public\.order_items[\s\S]*for each row/);
  assert.doesNotMatch(checkoutCreditMigration, /deferrable initially deferred[\s\S]*order_items_apply_shipping_credit/);
  assert.match(checkoutCreditMigration, /shipping-credit:order:/);
  assert.match(checkoutCreditMigration, /on conflict \(source_key\) do nothing/);
  assert.match(checkoutCreditMigration, /set shipping_payment_status = case[\s\S]*when v_has_pending_shipping then 'pending'/);
  assert.match(checkoutCreditMigration, /v_order\.user_id is null/);
});

test("confirmed shipping fees retain the existing backend reminder integration", () => {
  assert.match(server, /apply_shipping_fee_adjustment/);
  assert.match(server, /shipping_fee_adjustment_notification_intents/);
  assert.match(server, /shipping-fee-adjustment:/);
  assert.match(server, /notifications\/recover/);
  assert.doesNotMatch(checkoutCreditMigration, /queue_shipping_notice_after_adjustment/);
});

test("adjustment notification migration is durable, idempotent, and service-role-only", () => {
  const notificationMigration = readFileSync("supabase/migrations/20261129_0070_shipping_fee_adjustment_notifications.sql", "utf8");
  assert.match(notificationMigration, /unique \(adjustment_id, order_id\)/);
  assert.match(notificationMigration, /shipping_fee_adjustment_notification_intent_trigger/);
  assert.match(notificationMigration, /create constraint trigger/);
  assert.match(notificationMigration, /create_shipping_fee_adjustment_notification\(p_intent_id uuid\)/);
  assert.match(notificationMigration, /coalesce\(auth\.role\(\), ''\) <> 'service_role'/);
  assert.match(notificationMigration, /grant execute on function public\.create_shipping_fee_adjustment_notification\(uuid\) to service_role/);
  assert.match(notificationMigration, /get_shipping_notice_credit_summary\(p_order_ids uuid\[\]\)/);
  assert.match(notificationMigration, /grant execute on function public\.get_shipping_notice_credit_summary\(uuid\[\]\) to service_role/);
  assert.match(notificationMigration, /shipping-fee-adjustment:/);
  assert.match(notificationMigration, /v_product public\.products%rowtype/);
  assert.match(notificationMigration, /coalesce\(v_product\.name, v_intent\.product_id::text\)/);
});

test("order details expose automatic shipping-credit deductions", () => {
  const ordersPage = readFileSync("src/pages/Profile/MyOrders.jsx", "utf8");
  assert.match(ordersPage, /Shipping paid \{formatMoney\(item\.shippingPaidAmount\)\}/);
  assert.match(ordersPage, /Shipping remaining \{formatMoney\(/);
});

test("shipping adjustment history enriches persisted records and fails closed on detail errors", () => {
  assert.match(server, /shipping_fee_adjustment_orders/);
  assert.match(server, /product_name:/);
  assert.match(server, /administrator_name:/);
  assert.match(server, /affected_order_items:/);
  assert.match(server, /affected_orders_count:/);
  assert.match(server, /total_additional_shipping:/);
  assert.match(server, /total_credit_issued_minor:/);
  assert.match(server, /Unable to load shipping adjustment history details/);
  assert.match(server, /history\/details/);
  assert.match(server, /pathname === "\/api\/admin\/shipping-fee-adjustment\/history\/details" && req\.method === "GET"/);
  assert.match(server, /async function handleAdminShippingFeeAdjustment\(req, res\) \{\s+const admin = await getActiveAdminForRequest\(req\)/);
  assert.match(server, /requestUrl\.pathname\.endsWith\("\/history\/details"\)/);
  assert.match(server, /total_pages/);
  assert.match(server, /notification_status:/);
});

test("admin history distinguishes loading, errors, empty state, and persisted records", () => {
  assert.match(shipment, /feeHistoryLoading/);
  assert.match(shipment, /feeHistoryError/);
  assert.match(shipment, /Unable to load shipping adjustment history/);
  assert.match(shipment, /View details/);
  assert.match(shipment, /await refresh\(\)/);
  assert.match(shipment, /total_additional_shipping/);
  assert.match(shipment, /total_credit_issued_minor/);
  assert.match(shipment, /Recover All Eligible Notices/);
  assert.match(shipment, /This queues one notice per eligible affected order/);
  assert.match(shipment, /feeHistoryFilters/);
  assert.match(shipment, /admin-shipment-history-table/);
  assert.match(shipment, /notification_summary/);
  assert.match(shipment, /order\.order_reference/);
});

test("shipping fee preview uses a responsive, paginated table without changing calculations", () => {
  assert.match(shipment, /admin-shipment-fee-table/);
  assert.match(shipment, /Previous balance/);
  assert.match(shipment, /Updated balance/);
  assert.match(shipment, /Credit generated/);
  assert.match(shipment, /feePreviewPage/);
  assert.match(shipment, /previewExcluded/);
  assert.match(shipment, /Confirm Update Fee/);
});
