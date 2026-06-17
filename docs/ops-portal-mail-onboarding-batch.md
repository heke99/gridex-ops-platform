# OPS portal, mail and onboarding hardening batch

## Scope

This batch hardens the OPS side of Mina sidor, mail automation, fullmakt documents, onboarding readiness and customer-card UX.

## Runtime rules

- OPS `/api/v1/customer/portal-bundle` is an API-key protected OPS endpoint.
- Tenant web routes must require a logged-in Supabase session before proxying customer data.
- Anonymous curl/body identity against tenant web must return `401 AUTH_REQUIRED`, not customer data and not a generic `500`.
- OPS bundle returns empty arrays for missing sections, for example `documents: []`, instead of crashing.

## Fullmakt and documents

- A signed `powers_of_attorney` record is valid process evidence even if no PDF file has been generated yet.
- Signed fullmakter are backfilled into `customer_documents` as idempotent `power_of_attorney` snapshot documents.
- Backfill never updates historical `customer_legal_acceptances` rows.
- New legal acceptances must be inserted as new immutable rows.

## Mail automation

- Mail is sent through `communication_logs` + `tenant_email_outbox`.
- If mail does not send, admins must check: event rule, template, sender identity, verified domain/fallback sender, Resend key and email outbox cron.
- The email outbox processor writes `tenant_email_outbox_runs` rows when the table exists.

## Onboarding/readiness

- Missing facility id, metering point, grid owner or facility verification must create/admin-surface work queue tasks.
- Supplier switch/Ediel automation must remain blocked until readiness is green.
- When readiness is green, automatic onboarding creates/reuses a switch request and calls the supplier-switch automation with an idempotency key.

## API clients

- Duplicate Gridex website/Mina sidor API clients are soft-revoked by migration, keeping the most recently used/created active client.
- API clients are not hard-deleted; audit fields are preserved.

## Customer card UI

- The large “Kundens arbetsyta” card is not sticky. The whole workspace should not follow the user while scrolling.
