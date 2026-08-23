# Portal identity match strength incident — 2026-08-23

A production Gridex website application reached `portal_identity_create` and failed with PostgreSQL `23514` because the website runtime emitted legacy `match_strength = medium` while the canonical `customer_portal_identities` constraint permits only `strong`, `weak`, or `manual`.

## Canonical semantics

- `strong`: a verified portal/auth identity is bound to the same legal customer identity.
- `weak`: customer identity is resolved from non-strong factors or a website application without an already verified portal login.
- `manual`: the identity requires explicit/manual handling and must not be treated as an automatic match.

## Remediation

1. `customerApplicationCommunication.ts` now writes `weak` instead of `medium` for the non-authenticated website identity path.
2. `customerResolver.ts` uses a typed `PortalMatchStrength` union and canonicalizes any legacy `medium` input to `weak`; all email/single-factor resolver paths now produce `weak`.
3. The shared customer matching service no longer exposes an unused `medium` strength.
4. Production migration `20260823201059_normalize_customer_portal_identity_match_strength` introduced the compatibility trigger.
5. Production migration `20260823201716_canonical_customer_portal_match_strength_convergence` backfills legacy values, re-locks the DB constraint to exactly `strong | weak | manual`, recreates the compatibility trigger and restricts direct function execution to `service_role`/database owner.
6. Migration history and Supabase type-manifest tails are advanced with the production migrations.
7. `gridex-portal-identity-match-strength-regression.cjs` locks runtime, resolver, shared matching and DB migration vocabulary together.

Live verification used a rollback transaction against `customer_portal_identities`: an insert with `match_strength = medium` returned `weak`, then the transaction was rolled back. The live table had no persisted identity rows requiring backfill at verification time.
