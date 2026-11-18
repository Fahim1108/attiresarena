# Checkout security model (Phase 2.5)

Status: local verification only. Nothing has been applied to Staging or Production.

## Trust model

| Caller | Can call checkout RPCs | How it is identified |
| --- | --- | --- |
| Anonymous REST client (publishable key) | No | Not granted EXECUTE on any checkout RPC |
| Guest browser | Only through the Next.js server actions | HttpOnly cookie holds the raw token; the database stores its SHA-256 hash |
| Trusted Next.js server | Yes | `service_role` JWT from the server-only `SUPABASE_SERVICE_ROLE_KEY`, plus a hashed client key |
| Signed-in customer | Yes (database path only; the app has no customer sign-in yet) | `auth.uid()`; rate limits keyed by user id |

The database enforces: credential checks, rate limits, the ordering gate (`private.checkout_settings.orders_enabled`, default `false`), eligibility (published, verified thrift garments, matching the storefront feed), the district/division authority table, the per-phone daily cap, the units cap, stock, and idempotency.

## Rate limits (database-enforced)

| Limit | Default | Subject |
| --- | --- | --- |
| New checkout sessions | 20 per hour | client key or user id |
| Cart and contact writes | 60 per minute | client key or user id |
| New order placements | 5 per hour | client key or user id |
| Orders per mobile number | 2 per day | normalised phone |
| Units per order | 10 | order |

Retries of an existing order are not rate-limited. A refused or failed placement does not consume the placement allowance, because the allowance is recorded only when an order is created. This means probing for stock is not limited, but hoarding stock is.

## Idempotency

A checkout session produces at most one order (unique `checkout_sessions.order_id`, unique `orders.checkout_session_id`, and a row lock). A retry with the same items returns the original order at any later time. A retry with different items returns `CK004`, and the server then starts a new checkout. There is no time window.

## Risks and mitigations

**S3. Raw checkout token in API and database logs.** The raw token is sent as an RPC argument over HTTPS, so it can appear in request logs that record bodies, and in Postgres statement logs if parameter logging is enabled. It is not stored anywhere in the database.
- Impact: a log reader can replay a guest checkout credential until it expires (7 days) or is completed.
- Mitigations available now: restrict who can read API and database logs, and keep Postgres `log_parameter_max_length` and `log_statement` at defaults on Staging and Production.
- Not verified: the real log content of the hosted Supabase project. This must be checked during authorised Staging testing.
- Residual: moving to a server-held hash does not help, because the database compares the value it receives. A structural fix would make the cookie itself unusable for placement after first use, which is out of scope here.

**S6. `service_role` privileges.**
- Table privileges on the checkout tables are revoked from `service_role` explicitly, so Supabase default privileges cannot give the server direct table access. The trusted server can only call the RPCs.
- EXECUTE on the five checkout RPCs is granted to `service_role` on purpose. The key is a server-only super-credential: anyone holding it can place orders, bypassing the browser and the per-client limit. Its per-IP limit still applies only when the server supplies the client key.
- The key must never appear in `NEXT_PUBLIC_*`, client bundles, logs, or screenshots. Rotate it if exposure is suspected.
- Not verified on the hosted project: the real default privileges for `service_role`. Check with `has_table_privilege` and `has_function_privilege` during authorised Staging testing.

**S1 residual. Automated COD orders.** The per-client, per-phone, and units caps reduce hoarding, but an attacker who rotates IP addresses and mobile numbers can still place orders within each cap. Before exposing ordering to the public, add bot protection (CAPTCHA) and phone verification. The database cannot provide these.

**S2 residual. Client identity is best-effort.** The client key is a hash of a platform-set address header (`x-vercel-forwarded-for`, then `x-real-ip`, then `x-forwarded-for`). A caller who can set those headers arbitrarily is not stopped by the limit. Requests without any address share one bucket, which is strict. Anonymous direct RPC calls are no longer possible at all, so the remaining bypass requires the server credential.

**Duplicate orders after cookie loss.** The idempotency key is the checkout cookie. A customer who clears cookies, switches browser, or retries on another device and submits the same cart creates a second order. The per-phone daily cap limits the damage to two orders per mobile number per day. An account-level or client-generated idempotency key would close this gap and is not implemented.

**Authenticated checkout.** The database path (`auth.uid()`) is verified locally. The Next.js app has no customer sign-in, so the server never forwards a customer token. This path is untested through the app.

## Recovery capture (C2)

A checkout session exists only after a valid name and mobile number are entered and the cart is non-empty. The session is written when the phone field loses focus, and again when the delivery step is completed. A customer who abandons before entering contact details has no record, by design, so there is nothing to recover and no personal data is stored.

## Eligibility parity (C4)

`private.orderable_variant` applies the same conditions as `public.published_thrift_catalogue` (published product, verified intake, matching size and colour, active variant, in stock) and additionally requires a positive price. Non-thrift products are never orderable because the storefront never shows them. The parity test compares every fixture variant against the storefront feed.

Known difference: the application-layer feed additionally requires the image path to match the thrift inventory pattern, and the database does not check it. Intake records always store that path, so the practical effect is nil, but the two layers are not identical.

## Production ordering gate

Ordering opens only on exactly one of two paths. Each path requires its own explicit flag, the pinned project URL, and the server-only service key — plus the database flag:

- Staging/Preview: `STAGING_CHECKOUT_ORDERS=1` with the verified Staging project URL.
- Production: `PRODUCTION_CHECKOUT_ORDERS=1` (Production scope only) with the verified Production project URL.

Neither flag enables the other path, and neither flag can enable ordering against the wrong project. The database gate stands independently on both paths: `private.checkout_settings.orders_enabled` must be `true`, or the checkout RPCs refuse with CK008. Production migrations leave the database flag `false`, so ordering stays off until the owner explicitly flips it — the code alone can never enable ordering.
