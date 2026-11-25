-- Disposable/local PostgreSQL rollback rehearsal for migration 0063.
-- Do not run against production. This script intentionally does not commit.
-- Execute the migration body between BEGIN and ROLLBACK, omitting its own
-- BEGIN and COMMIT lines.

begin;
set local lock_timeout = '5s';
set local statement_timeout = '60s';

-- Paste the body of:
-- supabase/migrations/20261125_0063_currency_exchange_pricing.sql
-- here, excluding its first BEGIN and final COMMIT.

rollback;

-- Run these checks after the rollback in a separate statement batch:
-- select to_regclass('public.exchange_rate_settings');
-- select to_regclass('public.product_pricing_metadata');
-- select to_regprocedure('public.save_priced_product_bundle(jsonb,jsonb,uuid)');
-- Expected result: all values are null in a disposable database.
