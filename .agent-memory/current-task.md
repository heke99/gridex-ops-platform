# Current task

Last updated: 2026-07-30T23:59:00+02:00
Branch: UNVERIFIED (uploaded archive excludes `.git`)
Last verified commit: null

## Active phase

PHASE-35 — canonical publication-bound price options, immutable website commercial selection and OpenAPI release completion.

## Completed locally

- Bound canonical price options to exact publication versions and added default/selection/customer-type rules.
- Materialized deterministic publication copies, review-backed backfill and publish-time validation.
- Exposed top-level `price_options` and bound quote, validate and application assertions end to end.
- Harmonized legal document identity and closed public request/response schemas.
- Regenerated both OpenAPI documents at `2026-07-30.3` and strengthened reachability, fixture and documentation checks.
- Restored portal contract signature evidence parity found by the final go-live regression.
- Verified all TypeScript profiles, 376 tests, API/docs/parity/compatibility/release, migration/error/tenant gates, zero-error lint and production build.

## Exact next action

Review the three allowlisted duplicate migration version groups against the actual staging/production migration ledger. Do not rename any applied migration without that proof. Then use Node 22, run clean-database and upgraded-database applies through `20260730220000`, execute the canonical price-option post-apply SQL, deploy OPS, verify the live release manifest against the two served files, synchronize the separate Gridex Web repository and execute two-tenant, quote concurrency, application replay, webhook replay/idempotency and provider delivery scenarios.

## Blockers

- No authorized PostgreSQL clean/staging/live connection or Supabase CLI is available.
- The immutable historical file contains an intermediate text-rewrite sequence that appears unsafe on a clean replay; this must be proved with a real clean apply rather than declared passed.
- Duplicate version groups `20260612193000`, `20260616123000` and `20260727150000` are allowlisted; safe resolution requires authoritative applied-ledger provenance.
- Gridex Web source was not supplied, so its runtime sync/build cannot be changed or verified.
- Staging API keys, isolated tenant fixtures, webhook receiver/secret and provider sandbox credentials are unavailable.
- The `2026-07-30.3` deployment and exact live manifest hash parity are unverified.

## Do not repeat

Do not modify trusted historical migration bytes or manifest checksums, rename applied duplicate migrations without ledger proof, claim database/staging/Web/provider verification from static checks, or mark production `GO` until the price-option migration, post-apply, exact deployed manifest and full environment gates pass.
