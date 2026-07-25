# Completed verified work

## PHASE-00 — Permanent project memory

Required files, Cursor rules, checkpoint JSON and secret scan are verified.

## P0/P1 canonical lifecycle hardening

Status: VERIFIED LOCALLY

- Decoupled pricing/quote readiness from facility/PRODAT/switch readiness.
- Added resolver capabilities and stable purpose-specific blockers.
- Closed external request schemas and rejected unknown canonical API fields.
- Added explicit sanitized website-application DTO and public-ID policy.
- Split switch request creation from dispatch; deprecated the old alias.
- Replaced billing placeholders with data-backed profile, payment-term,
  provider/environment, recipient, address, OCR/reference and VAT evidence.
- Removed pricing-run/billing-underlay invoice fallbacks.
- Enforced exact hourly versus quarter-hour spot source selection.
- Added missing authenticated reconciliation cron.
- Added idempotent transactional `activate_customer_supply_v1`.
- Added canonical `supply.started` and `invoice.paid` webhook events and
  documented active/internal/planned event names.
- Synchronized OpenAPI, runtime, developer page and guides at `2026-07-25.1`.
- Added an explicit terminal contract-close operation with dependency cleanup,
  immutable closure metadata, audit, domain event and transactional outbox.
- Added canonical tenant lifecycle transitions with structured activation
  blockers and close preconditions.
- Enforced owning-tenant operational status for every integration API client.
- Removed direct company-status writes outside the canonical transition RPC.

## Verification

- Typecheck: pass.
- Full Vitest: 54 files, 354 tests pass.
- Targeted P0/P1 suite: 11 files, 80 tests pass.
- API contract/OpenAPI/docs checks: pass.
- Migration integrity: 300 files, 205 groups, checksums pass.
- Dedicated contract/tenant lifecycle regression: pass.
- ESLint: pass with 125 existing warnings and no errors.
- Next.js production build: pass; `.next/BUILD_ID` generated.
