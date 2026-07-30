# Current task

Last updated: 2026-07-30T13:05:00+02:00  
Branch: UNVERIFIED (uploaded archive excludes `.git`)  
Last verified commit: null

## Active phase

PHASE-33 — immutable migration recovery, exact OpenAPI release bytes and canonical public envelopes.

## Completed locally

- Restored the immutable historical migration to its registered trusted bytes.
- Added and registered the forward-only repair migration.
- Fixed exact served-byte release-manifest hashing and disabled manifest caching.
- Canonicalized public error, integration-context, quote and webhook envelopes.
- Regenerated both OpenAPI documents and added regression coverage for byte hashes, error normalization and internal-ID-free webhook projection.
- Verified all TypeScript profiles, 373 tests, API/docs/parity, migration/error/tenant gates, zero-error lint and production build.

## Exact next action

Review the three allowlisted duplicate migration version groups against the actual staging/production migration ledger. Do not rename any applied migration without that proof. Then use Node 22, run a clean-database and upgraded-database apply through `20260730130000`, deploy OPS, verify the live release manifest against the two served files, synchronize the separate Gridex Web repository and execute two-tenant, quote concurrency, webhook replay/idempotency and provider delivery scenarios.

## Blockers

- No authorized PostgreSQL clean/staging/live connection or Supabase CLI is available.
- The immutable historical file contains an intermediate text-rewrite sequence that appears unsafe on a clean replay; this must be proved with a real clean apply rather than declared passed.
- Duplicate version groups `20260612193000`, `20260616123000` and `20260727150000` are allowlisted; safe resolution requires authoritative applied-ledger provenance.
- Gridex Web source was not supplied, so its runtime sync/build cannot be changed or verified.
- Staging API keys, isolated tenant fixtures, webhook receiver/secret and provider sandbox credentials are unavailable.
- The live deployment is still the previous release and its manifest hashes do not match served OpenAPI bytes.

## Do not repeat

Do not modify trusted historical migration bytes or manifest checksums, rename applied duplicate migrations without ledger proof, claim database/staging/Web/provider verification from static checks, or mark production `GO` until exact deployed manifest and full environment gates pass.
