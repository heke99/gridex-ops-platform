# Current task

Last updated: 2026-07-30T18:08:00+02:00  
Branch: UNVERIFIED (uploaded archive excludes `.git`)  
Last verified commit: null

## Active phase

PHASE-34 — canonical Customer Portal sync, public references, atomic move-out and OpenAPI release completion.

## Completed locally

- Added strict customer sync parsing and tenant-safe identity normalization.
- Added stable public references and removed internal IDs from portal/application DTOs.
- Added the atomic, idempotent external-reference move-out database command.
- Added portal pagination/completeness handling and repaired v3 quote onboarding compatibility.
- Regenerated both OpenAPI documents at `2026-07-30.2` and added compatibility/release verification scripts.
- Verified all TypeScript profiles, 373 tests, API/docs/parity/compatibility/release, migration/error/tenant gates, zero-error lint and production build.

## Exact next action

Review the three allowlisted duplicate migration version groups against the actual staging/production migration ledger. Do not rename any applied migration without that proof. Then use Node 22, run clean-database and upgraded-database applies through `20260730153000`, deploy OPS, verify the live release manifest against the two served files, synchronize the separate Gridex Web repository and execute two-tenant, move-out replay, quote concurrency, webhook replay/idempotency and provider delivery scenarios.

## Blockers

- No authorized PostgreSQL clean/staging/live connection or Supabase CLI is available.
- The immutable historical file contains an intermediate text-rewrite sequence that appears unsafe on a clean replay; this must be proved with a real clean apply rather than declared passed.
- Duplicate version groups `20260612193000`, `20260616123000` and `20260727150000` are allowlisted; safe resolution requires authoritative applied-ledger provenance.
- Gridex Web source was not supplied, so its runtime sync/build cannot be changed or verified.
- Staging API keys, isolated tenant fixtures, webhook receiver/secret and provider sandbox credentials are unavailable.
- The `2026-07-30.2` deployment and exact live manifest hash parity are unverified.

## Do not repeat

Do not modify trusted historical migration bytes or manifest checksums, rename applied duplicate migrations without ledger proof, claim database/staging/Web/provider verification from static checks, or mark production `GO` until the new migration, exact deployed manifest and full environment gates pass.
