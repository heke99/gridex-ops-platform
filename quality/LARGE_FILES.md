# Gridex OPS — Large Files Review

## Method

A file is included when its source was verified beyond 2,000 lines on the exact audit branch. A complete automated line-count scan could not be executed because this session has GitHub/Supabase connectors but no authenticated local checkout. GitHub code-search results are not used as line-count evidence because they can reference older indexed commits.

## Verified files over 2,000 lines

### `lib/website/customerApplications.ts`

- Verified size: more than 8,400 lines.
- Main responsibilities observed:
  - public request field allowlisting and Zod validation
  - tenant/API context handling
  - idempotency and replay behavior
  - customer and customer-number creation
  - customer-site and metering-point resolution
  - contract and pricing snapshot binding
  - legal bundle acceptance/evidence
  - power-of-attorney creation and document storage
  - PDF generation inputs
  - email/notification side effects
  - domain/audit events
  - compensating/saga behavior
- Coupling: Supabase service role, website contracts/pricing, customer identity, legal, storage, mail, document generation and events.
- Risk: High change surface. A change to validation, status transitions or side effects can affect tenant scoping and partially persisted applications.
- Test coverage: multiple static and targeted regression scripts exist, including website application, legal/POA, customer number and multi-site flows. Full test execution was blocked in this session.
- Recommended split:
  1. `applicationRequestContract.ts`
  2. `applicationIdentityResolution.ts`
  3. `applicationPricingBinding.ts`
  4. `applicationLegalEvidence.ts`
  5. `applicationPersistence.ts`
  6. `applicationSideEffects.ts`
  7. thin orchestration facade preserving current exports
- Behavior-change risk: High.
- Recommendation: split later through characterization tests and one responsibility at a time. Do not combine the refactor with pricing, legal or tenant behavior changes.

## Other large-file observations

- `lib/billing/providerWebhooks.ts` is substantial but the inspected range did not verify it above 2,000 lines.
- Several admin page/component files and launch regression scripts are likely large; they remain `unverified` until an exact line-count scan runs from a clean checkout.

## Required follow-up command

Run from repository root after dependencies/files are available:

```bash
find app components lib scripts tests -type f \
  \( -name '*.ts' -o -name '*.tsx' -o -name '*.js' -o -name '*.cjs' -o -name '*.mjs' \) \
  -print0 | xargs -0 wc -l | sort -nr
```

Every result above 2,000 lines must be added here with ownership, dependency, test and split analysis before the audit can claim complete large-file coverage.
