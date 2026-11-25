-- Manual setup only. Do not run until the Edge Function is deployed and its
-- secrets are configured. This uses Supabase pg_cron + pg_net, not Render memory.
-- Store the refresh secret in a Supabase Vault secret named exchange_rate_refresh_secret.
-- Replace the project URL and function URL with the deployed project values.

create extension if not exists pg_cron;
create extension if not exists pg_net;

select cron.schedule(
  'nexus-exchange-rate-refresh',
  '15 * * * *',
  $$
  select net.http_post(
    url := 'https://YOUR_PROJECT_REF.supabase.co/functions/v1/refresh-exchange-rate',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-exchange-rate-refresh-secret',
      (select decrypted_secret from vault.decrypted_secrets where name = 'exchange_rate_refresh_secret' limit 1)
    ),
    body := '{}'::jsonb
  );
  $$
);

-- Rollback rehearsal / removal only:
-- select cron.unschedule('nexus-exchange-rate-refresh');
