import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const serverSource = fs.readFileSync(path.join(root, "server.js"), "utf8");
const appSource = fs.readFileSync(path.join(root, "src/App.jsx"), "utf8");
const notificationPage = fs.readFileSync(path.join(root, "src/pages/Admin/notification/notifications.jsx"), "utf8");
const storageSource = fs.readFileSync(path.join(root, "src/shared/shipmentStorage.js"), "utf8");
const archiveMigration = fs.readFileSync(path.join(root, "supabase/migrations/20261031_0055_admin_notification_archive.sql"), "utf8");
const shipmentRecreationMigration = fs.readFileSync(path.join(root, "supabase/migrations/20261031_0056_recreate_archived_shipment_tracks.sql"), "utf8");
const shipmentDetailsMigration = fs.readFileSync(path.join(root, "supabase/migrations/20261031_0057_update_shipment_track_details.sql"), "utf8");
const shipmentStagesMigration = fs.readFileSync(path.join(root, "supabase/migrations/20261020_0035_sync_shipment_stage_status.sql"), "utf8");
const shipmentPage = fs.readFileSync(path.join(root, "src/pages/Admin/shipment/shipment.jsx"), "utf8");

test("admin notification mutations require active admin routes and preserve history", () => {
  assert.match(serverSource, /handleAdminNotificationStatus/);
  assert.match(serverSource, /handleAdminNotificationArchive/);
  assert.match(serverSource, /isActiveAdminProfile\(profileResult\.profile\)/);
  assert.match(serverSource, /admin_deleted_at: new Date\(\)\.toISOString\(\)/);
  assert.doesNotMatch(serverSource, /from\("notifications"\)\.delete/);
  assert.match(notificationPage, /window\.confirm\("Hide this notification/);
  assert.match(notificationPage, /Mark read/);
  assert.match(notificationPage, /Mark unread/);
});

test("admin notification handlers are declared in App and passed through AppShell", () => {
  assert.match(appSource, /const handleAdminNotificationRead = async/);
  assert.match(appSource, /const handleAdminNotificationArchive = async/);
  assert.match(appSource, /onUpdateNotification,\s*onArchiveNotification,/s);
  assert.match(appSource, /onUpdateNotification=\{handleAdminNotificationRead\}/);
  assert.match(appSource, /onArchiveNotification=\{handleAdminNotificationArchive\}/);
  assert.doesNotMatch(appSource, /onUpdateNotification=\{handleAdminNotificationRead\}[\s\S]*function AppShell/);
});

test("notification archive migration adds an admin-only soft-delete marker", () => {
  assert.match(archiveMigration, /add column if not exists admin_deleted_at timestamptz/i);
  assert.match(archiveMigration, /where admin_deleted_at is null/i);
  assert.match(archiveMigration, /coalesce\(auth\.role\(\), ''\) <> 'service_role'/i);
  assert.match(archiveMigration, /notifications_guard_admin_archive/);
  assert.doesNotMatch(archiveMigration, /delete\s+from/i);
});

test("shipment storage maps common RPC failures to safe admin messages", () => {
  assert.match(storageSource, /Only active administrators/);
  assert.match(storageSource, /This tracking status is not supported/);
  assert.match(storageSource, /A tracking update with these details already exists/);
  assert.match(storageSource, /Unable to connect to the server/);
  assert.match(storageSource, /The tracking update could not be saved/);
  assert.match(storageSource, /Complete shipment stages in order/);
  assert.match(storageSource, /selected shipment stage does not belong/);
});

test("shipment saves remain admin-only RPC operations with duplicate-submit guards in the UI", () => {
  assert.match(storageSource, /supabase\.rpc\("save_shipment_track"/);
  const page = fs.readFileSync(path.join(root, "src/pages/Admin/shipment/shipment.jsx"), "utf8");
  assert.match(page, /disabled=\{saving\}/);
  assert.match(page, /setSaving\(true\)/);
  assert.match(page, /setError\(result\.message\)/);
});

test("shipment recreation isolates archived Air and Sea progress without weakening active rollback checks", () => {
  assert.match(shipmentRecreationMigration, /drop constraint if exists shipment_tracks_batch_freight_unique/i);
  assert.match(shipmentRecreationMigration, /where archived_at is null/i);
  assert.match(shipmentRecreationMigration, /st\.archived_at is null/);
  assert.match(shipmentRecreationMigration, /Backward shipment progress is not allowed/);
  assert.match(shipmentRecreationMigration, /shipment_track_events/);
  assert.match(shipmentRecreationMigration, /grant execute on function public\.save_shipment_track\(jsonb\) to authenticated/);
});

test("existing track metadata edits use a dedicated RPC and preserve stage-derived progress", () => {
  assert.match(storageSource, /supabase\.rpc\("update_shipment_track_details"/);
  assert.match(storageSource, /if \(clean\(payload\.id\)\)/);
  assert.doesNotMatch(storageSource, /update_shipment_track_details[\s\S]{0,500}current_step/);
  assert.match(shipmentDetailsMigration, /create or replace function public\.update_shipment_track_details/);
  assert.match(shipmentDetailsMigration, /archived_at is null/);
  assert.match(shipmentDetailsMigration, /private\.is_admin_user\(\)/);
  assert.match(shipmentDetailsMigration, /grant execute on function public\.update_shipment_track_details/);
});

test("shipment workflows use separate RPCs for creation, metadata, stages, and archival", () => {
  assert.match(storageSource, /supabase\.rpc\("save_shipment_track"/);
  assert.match(storageSource, /supabase\.rpc\("update_shipment_track_details"/);
  assert.match(storageSource, /supabase\.rpc\("save_shipment_track_stages"/);
  assert.match(storageSource, /supabase\.rpc\("archive_shipment_track"/);
  assert.match(shipmentPage, /saveShipmentTrackStages\(stageTrack\.id/);
  assert.match(shipmentPage, /saveShipmentTrackStages\(track\.id/);
  assert.match(shipmentPage, /saveShipmentTrack\(trackDraft\)/);
  assert.match(shipmentPage, /archiveShipmentTrack\(track\.id\)/);
});

test("Manage Steps payload matches the stage RPC contract and preserves forward-only validation", () => {
  assert.match(shipmentPage, /stage_key: clean\(stage\.key\)/);
  assert.match(shipmentPage, /stage_name: clean\(stage\.label\)/);
  assert.match(shipmentPage, /is_completed: Boolean\(stage\.isCompleted\)/);
  assert.match(shipmentPage, /completed_at: stage\.isCompleted \? stage\.completedAt \|\| null : null/);
  assert.match(shipmentStagesMigration, /Completion must remain a contiguous prefix/);
  assert.match(shipmentStagesMigration, /Shipment stages must be completed sequentially/);
  assert.match(shipmentStagesMigration, /where id = p_track_id and archived_at is null/);
  assert.match(shipmentStagesMigration, /insert into public\.shipment_track_events/);
  assert.match(shipmentStagesMigration, /grant execute on function public\.save_shipment_track_stages\(uuid, jsonb\) to authenticated/);
});

test("Air and Sea tracks remain independently selectable and archived history stays excluded", () => {
  assert.match(shipmentPage, /track\.freightType === "air"/);
  assert.match(shipmentPage, /track\.freightType === "sea"/);
  assert.match(shipmentRecreationMigration, /shipment_tracks_active_batch_freight_unique/);
  assert.match(shipmentRecreationMigration, /where archived_at is null/);
  assert.match(shipmentStagesMigration, /archived_at is null/);
});
