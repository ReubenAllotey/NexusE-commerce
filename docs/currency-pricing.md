# Currency Pricing

Nexus stores customer-facing product prices in GHS. Products entered in CNY are converted server-side before the existing product-save RPC persists the public GHS price. Private pricing metadata is kept in the service-role-only currency tables created by migration `20261125_0063_currency_exchange_pricing.sql`.

## Provider and rate policy

The implementation uses ExchangeRate-API. If `EXCHANGE_RATE_API_KEY` is configured, the standard keyed endpoint is used. If it is empty, the provider's open endpoint is used and the admin UI reports that attribution is required. Live rates are accepted only when the last successful fetch is no more than 24 hours old. Manual mode is available as a fail-closed fallback.

Required server configuration:

- `EXCHANGE_RATE_API_KEY` is optional; configure it when the provider account requires the keyed endpoint.
- `EXCHANGE_RATE_MAX_LIVE_AGE_HOURS` documents the intended freshness policy; the current service policy is 24 hours.
- `EXCHANGE_RATE_REFRESH_SECRET` authenticates the scheduled Supabase Edge Function.
- `EXCHANGE_RATE_SYSTEM_ADMIN_ID` identifies an active admin profile used for the audited scheduled update.

The provider is queried only by an authenticated active administrator action or the separately authenticated scheduled Edge Function. Provider failures preserve the last successful stored rate and do not silently reprice products.

The prepared `supabase/functions/refresh-exchange-rate` function is not automatically active. Configure its secrets, deploy the function, and schedule it with the reviewed `docs/exchange-rate-scheduling.sql` script. The function honors the provider next-update timestamp and does not reprice products.

## Product workflow

The admin product editor defaults new products to CNY and shows the current GHS preview. Existing products remain GHS unless their private metadata identifies them as CNY-priced. Saving a CNY product requires an active, fresh live rate or a configured manual rate, converts the base and variation prices on the server, and records the original CNY values privately.

Bulk repricing is preview-first, admin-only, explicitly selected, and guarded by product `updated_at` checks. Each operation records an audit row and does not change payment records, shipping fees, order totals, or checkout authorization.
