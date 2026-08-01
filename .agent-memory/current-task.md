# Current task

Last updated: 2026-08-01T01:25:00+02:00
Branch: UNVERIFIED (uploaded archive excludes `.git`)
Last verified commit: null

## Active phase

PHASE-36 — Public Contracts runtime/OpenAPI/legal parity and complete customer-portal developer documentation.

## Implemented locally

- Added strict canonical Public Contract price-option and legal serializers.
- Made `is_default` canonical and `default` an identical deprecated alias.
- Preserved and validated the exact locked legal bundle version at both public legal levels.
- Added one forward migration with exact-relation legal snapshot generation and idempotent audited backfill.
- Unified Website/API DTO mapping, safe route diagnostics, version/request headers and structured public failures.
- Regenerated both OpenAPI files, release hashes and canonical production-like fixture at `2026-08-01.1`.
- Added route-to-served-OpenAPI, serializer, fixture, docs, version, checksum and migration safety gates.
- Rebuilt `/developers/customer-portal-api` as the complete human-readable integration guide.

## Exact next action

Restore or reconcile the inherited `20260730220000...` migration bytes from authoritative Git/applied-ledger evidence without changing its trusted manifest checksum. Then install dependencies under Node 22, run all project typechecks/Vitest/lint/build, apply `20260801003000...` in isolated staging, run preview/apply/second-dry-run, deploy and verify exact served response/OpenAPI/manifest/docs parity. Synchronize Gridex Web only from its current source repository.

## Blockers

- Uploaded historical migration `20260730220000...` hashes to `978de5e9...`, while its trusted manifest entry remains `0ab350f0...`.
- No authorized PostgreSQL connection or Supabase deployment environment.
- DNS cannot resolve `registry.npmjs.org`, so dependencies cannot be installed here.
- No staging base URL, API key, isolated tenant fixture or deployment target.
- No Gridex Web source was supplied.
- Uploaded archive excludes Git metadata.

## Do not repeat

Do not bless the historical migration drift by changing its checksum, infer a legal bundle by first/latest ordering, use recursive DTO spreads, make OpenAPI permissive, claim full build/database/staging success, or use `default` as new business logic.
