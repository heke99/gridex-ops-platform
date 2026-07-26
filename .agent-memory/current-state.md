# Current state

Last updated: 2026-07-26T20:00:00+02:00

- PHASE-00: VERIFIED — permanent memory, Cursor rules and superseded legacy
  task marker are installed.
- PHASE-01: VERIFIED for the P0/P1 release scope — repository, API, billing,
  invoice, switch, cron and event call paths were inventoried against the
  uploaded source.
- PHASE-02: VERIFIED locally — runtime/OpenAPI/docs are synchronized at
  `2026-07-25.1`; all API documentation checks pass.
- PHASE-04–07: VERIFIED locally — resolution capabilities are purpose-specific,
  market/quote inputs are canonical and pricing is independent of PRODAT.
- PHASE-12–13: IMPLEMENTED/STATIC_VERIFIED — switch creation and dispatch are
  separate; confirmed supply uses `activate_customer_supply_v1`.
- PHASE-16–18: IMPLEMENTED/STATIC_VERIFIED — billing readiness uses real tenant,
  profile/provider/payment/address inputs with immutable evidence; portal
  invoices use only `customer_invoices`; canonical paid events are emitted.
- PHASE-22: STATIC_VERIFIED — 302 migration files, 207 version groups and
  manifest checksums pass; the pending migrations are not applied because no Supabase
  CLI/database is present.
- PHASE-23–24: VERIFIED locally — typecheck, 354 tests, API checks, lint and
  production build pass. Lint reports 125 pre-existing warnings and no errors.
- PHASE-25: IMPLEMENTED/STATIC_VERIFIED — contract closure is terminal,
  tenant activation is readiness-gated, tenant closure has explicit
  preconditions, and integration API access now fails closed for non-active
  tenants.
- PHASE-26: IMPLEMENTED/STATIC_VERIFIED — permanent deletion is restricted to
  unused draft/ready offers; quote/FK/backfill dependencies share one preview;
  bulk failures are isolated; terminal list views and pagination are present.

Repository provenance remains unavailable because the uploaded archive excludes
`.git`. The live deployed documentation observed during this task is older than
the local release candidate and requires deployment before parity can be
verified in production.
