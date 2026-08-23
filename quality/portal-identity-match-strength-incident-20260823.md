# Portal identity match strength incident — 2026-08-23

A production Gridex website application reached `portal_identity_create` and failed with PostgreSQL `23514` because `customerApplicationCommunication.ts` emits legacy `match_strength = medium` for post-auth onboarding while the canonical database constraint permits only `strong`, `weak`, or `manual`.

The production forward migration `20260823201059_normalize_customer_portal_identity_match_strength` adds a narrow BEFORE trigger that canonicalizes legacy `medium` to `weak` before check-constraint validation. It does not widen the canonical enum and leaves `strong`/`manual` unchanged.

Live verification used a rollback transaction against `customer_portal_identities`: an insert with `match_strength = medium` returned `weak`, then the transaction was rolled back.
