# Current task

Last updated: 2026-08-02T12:45:00+02:00
Branch: UNVERIFIED (uploaded archive excludes `.git`)
Last verified commit: null

## Active phase

PHASE-38 — Canonical production hardening, Ediel evidence v2 and migration-ledger reconciliation.

## Verified locally

- Repaired the Ediel evidence migration against the actual `gridex-ops-dev` schema and transaction-compiled it with a confirmed rollback.
- Evidence pass/fail is server-derived from run, definition, snapshot, messages, portal identity, correlation, ACK outcome, transport and rulebook data.
- Replaced GUC-only pass protection with matching immutable attempt/evidence and approved two-person attestation checks.
- Added tenant-qualified child relations, fail-closed quarantine access, explicit actor-role mapping and service-role-resistant tenant constraints.
- Added atomic `WEBSITE_APPLICATION_COMMITTED` audit/domain/outbox projection from the durable workflow commit.
- Fixed all five TypeScript failures and upgraded vulnerable production dependencies.
- Clean Node 22 install, all TypeScript targets, 417 tests, static hardening regressions, migration integrity, production audit and full Next.js build pass.
- Lint remains 0 errors/126 warnings; all warnings are `@typescript-eslint/no-unused-vars` and none are security rules.

## Exact next action

Do not run `supabase db push`. First reconcile the remote migration ledger with exact schema-definition comparisons for `20260802010000`–`20260802012000`. Then apply D–F and `20260802160000` in an isolated staging branch, execute preflight/quarantine review, validate eligible constraints, run the supplied DB/RLS regressions with real two-tenant JWT fixtures, and repeat all Node 22 gates.

## Blockers

- Remote ledger contains only nine recorded versions while parts of A–C exist in schema; exact definition/ledger parity is not yet proven.
- 153 legacy `ediel_test_runs` have no deterministic tenant owner and must remain quarantined/manual-review candidates.
- D–F and the website canonical-event migration are not applied to staging.
- Authenticated two-tenant RLS, service-role cross-tenant, concurrency and full evidence-chain fixtures have not run after apply.
- External Gridex Web/portal/partner repositories and deployment targets were not supplied.
- Git provenance is absent.

## Release decision

NO-GO until ledger reconciliation, controlled staging apply and environment regressions are green.

