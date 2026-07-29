# Current task

Last updated: 2026-07-29T15:56:55+02:00  
Branch: UNVERIFIED (uploaded archive excludes `.git`)  
Last verified commit: null

## Active phase

PHASE-31 — canonical contract commercial selection, snapshot and billing completion.

## Completed locally

- Replaced free-text fixed-area and optional-fee authoring with structured, type-driven price-option/component editing and stable references.
- Added one validated `gridex_contract_pricing_v6_selection` model for admin, public feed, quote, internal customer selection, signed snapshots and billing.
- Added exact quote identity/hash fields for option, area row, invoice method and mandatory/customer/conditional components.
- Removed the website onboarding compatibility-snapshot reduction. V6 contracts freeze the quote's exact base and price components.
- Added an atomic internal customer-contract command using the same selection resolver and immutable contract-price snapshot.
- Extended billing lifecycle semantics and fail-closed v6 snapshot identity.
- Added forward migration `20260729200000...`, deterministic fixed-price backfill, review queue, RLS, tenant/version guards and trace columns.
- Synchronized runtime/OpenAPI/docs to `2026-07-29.1`.
- Verified TypeScript, lint, 365 tests, API docs, focused commercial regressions and a clean production build.

## Exact next action

Recover `20260728170000_live_schema_code_canonical_sync.sql` byte-for-byte from the trusted applied source so its SHA-256 is `881e1bc552b6a6295b6bc993cec82e55a25c56f0d5cdf525a784e33d2222d482`. Then require a green migration check, apply pending forward migrations through `20260729200000...` in staging, run both channel and commercial post-apply SQL, and execute website plus internal option/component/invoice parity scenarios.

## Blockers

- The exact trusted bytes for historical migration `20260728170000...` are not present in the supplied or previously available archives.
- No authorized PostgreSQL staging/live connection is available.
- The new migration could not be applied to clean and upgraded databases in this workspace.
- Provider sandbox/credentials, deployment target and Git metadata are absent.

## Do not repeat

Do not change the historical manifest checksum, use `db push`, replay the noncanonical history, claim a database apply from static verification, or permit v6 billing to fall back to loose offer scalars.
