import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const sqlPath = new URL("../supabase/queries/remediate_duplicate_payment_notification.sql", import.meta.url);
const sql = fs.readFileSync(sqlPath, "utf8");
const serverSource = fs.readFileSync(new URL("../server.js", import.meta.url), "utf8");

const sourceKey = "payment:48543e91-2da2-49b6-89ef-2ae4fdfa6a22:status:successful";
const legacyKey = "payment:48543e91-2da2-49b6-89ef-2ae4fdfa6a22:status:successful:legacy-duplicate:97d75746-72ba-4df7-a1ce-d9cc599f272e";

test("remediation uses the complete production source key everywhere", () => {
  const declarations = [...sql.matchAll(/v_source_key\s+text\s*:=\s*'([^']+)'\s*;/g)]
    .map((match) => match[1]);
  assert.equal(declarations.length, 3);
  assert.deepEqual(declarations, [sourceKey, sourceKey, sourceKey]);
  assert.ok(sql.includes(`v_legacy_source_key text :=\n    '${legacyKey}'`));
  assert.ok(sql.includes(`source_key = '${legacyKey}'`));
  assert.match(sql, /source_key = v_source_key/);
  assert.doesNotMatch(sql, /payment:48543e91-2da2-49b6-89ef-2ae4fdfa6a22(?:['"]|\s|;|\))/);
});

test("remediation preserves the canonical delivery and suppresses only the duplicate", () => {
  assert.match(sql, /d1356d4e-5603-4d2f-9d21-28629ca8bb27[\s\S]*status = 'pending'/);
  assert.match(sql, /a64ecff0-60fc-48a2-8d23-5ef4d7177d1f[\s\S]*status = 'failed'/);
  assert.match(sql, /attempts = max_attempts/);
});

test("remediation keeps trigger management transactional and guarded", () => {
  assert.match(sql, /ALTER TABLE public\.notifications\s+DISABLE TRIGGER notifications_normalize_write/);
  assert.match(sql, /ALTER TABLE public\.notifications\s+ENABLE TRIGGER notifications_normalize_write/);
  assert.match(sql, /tgenabled = 'O'/);
  assert.match(sql, /LOCK TABLE public\.notifications IN SHARE ROW EXCLUSIVE MODE/);
});

test("manual notification retry rejects permanently suppressed deliveries", () => {
  assert.match(serverSource, /last_error"\)\s*\n\s*\.eq\("notification_id", notificationId\)/);
  assert.match(serverSource, /code: "delivery_suppressed"/);
  assert.match(serverSource, /attempts\) >= Number\(existing\.max_attempts\)/);
});
