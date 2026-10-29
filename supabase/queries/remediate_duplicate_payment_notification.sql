-- Review-only remediation for the confirmed duplicate payment notification.
-- Do not execute against production without approval.

BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

LOCK TABLE public.notifications IN SHARE ROW EXCLUSIVE MODE;

DO $$
DECLARE
  v_trigger_enabled boolean;
BEGIN
  SELECT EXISTS (
    SELECT 1
    FROM pg_trigger
    WHERE tgrelid = 'public.notifications'::regclass
      AND tgname = 'notifications_normalize_write'
      AND NOT tgisinternal
      AND tgenabled = 'O'
  ) INTO v_trigger_enabled;

  IF NOT v_trigger_enabled THEN
    RAISE EXCEPTION 'notifications_normalize_write is not enabled as expected';
  END IF;
END
$$;

SELECT id
FROM public.notifications
WHERE id IN (
  '5a595302-c96a-401f-bb5b-fe93135ee0b5'::uuid,
  '97d75746-72ba-4df7-a1ce-d9cc599f272e'::uuid
)
ORDER BY id
FOR UPDATE;

SELECT id
FROM public.notification_email_deliveries
WHERE id IN (
  'd1356d4e-5603-4d2f-9d21-28629ca8bb27'::uuid,
  'a64ecff0-60fc-48a2-8d23-5ef4d7177d1f'::uuid
)
ORDER BY id
FOR UPDATE;

DO $$
DECLARE
  v_source_key text :=
    'payment:48543e91-2da2-49b6-89ef-2ae4fdfa6a22:status:successful';
  v_count integer;
BEGIN
  SELECT count(*) INTO v_count
  FROM public.notifications n
  WHERE n.id IN (
    '5a595302-c96a-401f-bb5b-fe93135ee0b5'::uuid,
    '97d75746-72ba-4df7-a1ce-d9cc599f272e'::uuid
  )
  AND n.source_type = 'payment_status'
  AND n.source_key = v_source_key
  AND n.payment_id = '48543e91-2da2-49b6-89ef-2ae4fdfa6a22'::uuid
  AND EXISTS (
    SELECT 1
    FROM public.orders o
    WHERE o.id = n.order_id
      AND o.order_number = 'ORD-MVSI2PFG-F7A1F2C6'
  );

  IF v_count <> 2 THEN
    RAISE EXCEPTION 'Expected exactly two guarded notifications; found %', v_count;
  END IF;

  SELECT count(*) INTO v_count
  FROM public.notifications
  WHERE source_type = 'payment_status'
    AND source_key = v_source_key;

  IF v_count <> 2 THEN
    RAISE EXCEPTION 'Unexpected payment event group size: %', v_count;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.notification_email_deliveries
    WHERE id = 'd1356d4e-5603-4d2f-9d21-28629ca8bb27'::uuid
      AND notification_id = '5a595302-c96a-401f-bb5b-fe93135ee0b5'::uuid
      AND status = 'pending' AND attempts = 0
      AND sent_at IS NULL AND last_error IS NULL
  ) THEN
    RAISE EXCEPTION 'Canonical delivery is not unchanged and pending';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.notification_email_deliveries
    WHERE id = 'a64ecff0-60fc-48a2-8d23-5ef4d7177d1f'::uuid
      AND notification_id = '97d75746-72ba-4df7-a1ce-d9cc599f272e'::uuid
      AND status = 'pending' AND attempts = 0
      AND sent_at IS NULL AND last_error IS NULL
  ) THEN
    RAISE EXCEPTION 'Duplicate delivery is not in the expected pending state';
  END IF;
END
$$;

ALTER TABLE public.notifications
  DISABLE TRIGGER notifications_normalize_write;

DO $$
DECLARE
  v_source_key text :=
    'payment:48543e91-2da2-49b6-89ef-2ae4fdfa6a22:status:successful';
  v_legacy_source_key text :=
    'payment:48543e91-2da2-49b6-89ef-2ae4fdfa6a22:status:successful:legacy-duplicate:97d75746-72ba-4df7-a1ce-d9cc599f272e';
  v_rows integer;
BEGIN
  UPDATE public.notifications
  SET source_key = v_legacy_source_key,
      updated_at = now()
  WHERE id = '97d75746-72ba-4df7-a1ce-d9cc599f272e'::uuid
    AND source_type = 'payment_status'
    AND source_key = v_source_key
    AND payment_id = '48543e91-2da2-49b6-89ef-2ae4fdfa6a22'::uuid;

  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows <> 1 THEN
    RAISE EXCEPTION 'Duplicate notification update affected % rows', v_rows;
  END IF;
END
$$;

ALTER TABLE public.notifications
  ENABLE TRIGGER notifications_normalize_write;

DO $$
DECLARE
  v_rows integer;
BEGIN
  UPDATE public.notification_email_deliveries
  SET status = 'failed',
      attempts = max_attempts,
      next_attempt_at = now(),
      last_error =
        'Superseded by canonical payment notification 5a595302-c96a-401f-bb5b-fe93135ee0b5',
      updated_at = now()
  WHERE id = 'a64ecff0-60fc-48a2-8d23-5ef4d7177d1f'::uuid
    AND notification_id = '97d75746-72ba-4df7-a1ce-d9cc599f272e'::uuid
    AND status = 'pending'
    AND attempts = 0
    AND sent_at IS NULL
    AND last_error IS NULL;

  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows <> 1 THEN
    RAISE EXCEPTION 'Duplicate delivery suppression affected % rows', v_rows;
  END IF;
END
$$;

DO $$
DECLARE
  v_source_key text :=
    'payment:48543e91-2da2-49b6-89ef-2ae4fdfa6a22:status:successful';
  v_legacy_source_key text :=
    'payment:48543e91-2da2-49b6-89ef-2ae4fdfa6a22:status:successful:legacy-duplicate:97d75746-72ba-4df7-a1ce-d9cc599f272e';
  v_count integer;
BEGIN
  SELECT count(*) INTO v_count
  FROM public.notifications
  WHERE source_type = 'payment_status' AND source_key = v_source_key;
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'Canonical event count is %, expected 1', v_count;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.notifications
    WHERE id = '97d75746-72ba-4df7-a1ce-d9cc599f272e'::uuid
      AND source_key = v_legacy_source_key
  ) THEN
    RAISE EXCEPTION 'Duplicate notification legacy key is missing';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.notification_email_deliveries
    WHERE id = 'd1356d4e-5603-4d2f-9d21-28629ca8bb27'::uuid
      AND notification_id = '5a595302-c96a-401f-bb5b-fe93135ee0b5'::uuid
      AND status = 'pending' AND attempts = 0 AND sent_at IS NULL
  ) THEN
    RAISE EXCEPTION 'Canonical delivery changed unexpectedly';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.notification_email_deliveries
    WHERE id = 'a64ecff0-60fc-48a2-8d23-5ef4d7177d1f'::uuid
      AND status = 'failed' AND attempts = max_attempts AND sent_at IS NULL
  ) THEN
    RAISE EXCEPTION 'Duplicate delivery is not suppressed';
  END IF;
END
$$;

COMMIT;

-- Rollback before migration 0050 only. This intentionally reopens the duplicate event.
-- Do not run after migration 0050, because its event-level unique index rejects the
-- original source key. Restore only after independent state checks and approval.
--
-- BEGIN;
-- SET LOCAL lock_timeout = '5s';
-- LOCK TABLE public.notifications IN SHARE ROW EXCLUSIVE MODE;
-- ALTER TABLE public.notifications DISABLE TRIGGER notifications_normalize_write;
-- UPDATE public.notifications
-- SET source_key = 'payment:48543e91-2da2-49b6-89ef-2ae4fdfa6a22:status',
--     updated_at = now()
-- WHERE id = '97d75746-72ba-4df7-a1ce-d9cc599f272e'::uuid
--   AND source_key = 'payment:48543e91-2da2-49b6-89ef-2ae4fdfa6a22:status:successful:legacy-duplicate:97d75746-72ba-4df7-a1ce-d9cc599f272e';
-- ALTER TABLE public.notifications ENABLE TRIGGER notifications_normalize_write;
-- UPDATE public.notification_email_deliveries
-- SET status = 'pending', attempts = 0, next_attempt_at = now(),
--     last_error = NULL, updated_at = now()
-- WHERE id = 'a64ecff0-60fc-48a2-8d23-5ef4d7177d1f'::uuid
--   AND status = 'failed' AND attempts = max_attempts
--   AND sent_at IS NULL
--   AND last_error = 'Superseded by canonical payment notification 5a595302-c96a-401f-bb5b-fe93135ee0b5';
-- COMMIT;
