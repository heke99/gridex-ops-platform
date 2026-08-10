# Current state

Updated: 2026-08-10

## Source truth

- Repository: `heke99/gridex-ops-platform`.
- Default branch: `main`.
- Remediation base: `e8586c1ba112213a0f11da16ee3a5ae15386dc69`.
- Release candidate: PR #105 on `codex/gridex-canonical-57-remediation`.
- The uploaded archive was byte-equivalent to the remediation base for tracked source content.

## Implemented and verified

- The 57-point canonical architecture remediation is implemented in the existing platform.
- Canonical request-scoped authorization, tenant lifecycle, durable provisioning, worker-owned invitation delivery, verified acceptance, application repair, reconciliation, release receipts and performance budgets are in place.
- Historical applied migrations remain immutable. Recovered database migrations and three new forward migrations are checksum-pinned.
- Connected `gridex-ops-dev` is migrated through `20260810221500_canonical_invitation_delivery_hotfix.sql`.
- Live invariants are green: no roleless memberships, non-ready active clients, due stranded outbox rows, overdue manual reviews, unclassified applications or reconciliation query errors.
- One legacy application is truthfully classified as `awaiting_input` with owner, reason and SLA; missing authoritative identities were not fabricated.
- Hosted run `31435653056` passed clean replay, verify and quality-release gates before the final review hotfixes.
- Code review findings for duplicate invitation delivery and pgcrypto schema resolution are fixed; a fresh required run must pass before merge.

## Release sequence

1. Require all checks on the final PR head to pass.
2. Merge PR #105 without bypassing branch protection.
3. Verify Vercel production is READY for the exact merged SHA and smoke the deployed URL.
4. Check production runtime errors and persist a `platform_release_receipts` row for the exact Git/CI/Vercel/schema identity.
5. Re-run the database invariants.

## External configuration limits

- The connected Supabase account exposes only `gridex-ops-dev`; no separate staging/production database is available for parity comparison.
- Supabase Auth leaked-password protection has no exposed management action in the connected toolset and must be changed in the hosted Auth configuration.

Detailed evidence: `docs/remediation/GRIDEX_57_POINT_CANONICAL_ARCHITECTURE_CLOSURE_2026-08-10.md`.
