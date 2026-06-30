# Gridex OPS — POA UUID validation + idempotency failed-log hotfix

## Fixes

1. `powerOfAttorney.textVersionId` is now validated as a UUID before querying `legal_text_versions`.
   - Invalid values such as `2026-06-12-v1` now return a controlled `422 power_of_attorney_version_invalid`.
   - OPS no longer leaks raw Postgres `22P02 invalid input syntax for type uuid` as a 500.

2. Failed application logging no longer crashes on duplicate `(company_id, idempotency_key)`.
   - `createApplicationRow()` now detects `website_customer_applications_company_idempotency_uidx` duplicate-key errors.
   - When a failed/partial row already exists, OPS updates that row instead of trying to insert a duplicate.
   - This prevents `[website-applications] failed to log failed application ... duplicate key value violates unique constraint`.

3. Regressions updated to lock the behavior.
   - POA regression asserts non-UUID `textVersionId` is rejected before DB lookup.
   - Continuation regression asserts duplicate idempotency logging updates existing rows.

## Changed files

- `lib/website/customerApplications.ts`
- `scripts/gridex-website-api-power-of-attorney-regression.cjs`
- `scripts/gridex-ops-continuation-hardening-regression.cjs`

## Verify

Run from OPS project root:

```bash
npm run gridex:ops-continuation-hardening-regression
npm run gridex:website-api-power-of-attorney-regression
npm run gridex:batch-8-1-live-schema-regression
npm run gridex:batch-7-website-foundation-regression
npm run gridex:customer-portal-multi-site-api-regression
npm run db:migrations:check
npm run build
```
