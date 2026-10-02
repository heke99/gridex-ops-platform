# Customer merge: portal and support lifecycle

## Scope

This change preserves the existing authorized, same-company customer merge model. A merge moves portal accounts, identities, tenant links, history, idempotency records, support attachments, and required site-owned rows to the primary customer. It preserves each subject, provider namespace, status, role, and attachment storage path. It rejects ambiguous active subjects and uniqueness collisions before moving the graph. It does not change the customer portal wire contract.

Verified bindings may follow a bounded, same-company `merged_into` chain. Identifier-only discovery cannot use an archived source as a new binding. Sync keeps a verified existing binding when its historic customer number belongs to a merged source and returns the surviving customer's current number. A blocked account remains blocked.

The migration defers only the fourteen named composite ownership constraints during the merge transaction and validates them before returning. Signed-contract immutability remains enabled. Guards prevent late writes against a merged source. Insert guards wait for the customer lock and recheck; update guards return a controlled conflict instead of creating an inverse-lock deadlock. Atomic and fallback contact updates reject a merged source before any mutation or audit/outbox write.

## Local native evidence

The synthetic PostgreSQL 16 fixture was built from the current canonical schema at base `55bb4e83b58230eb811ba2cc78f9c9ae04604231`, with 54 affected public tables and 213 actual foreign keys. It includes the signed-contract and authorization immutability guards. It is not a full Supabase migration replay: unrelated operational triggers, RLS, and outside-graph dependencies remain the responsibility of the mandatory CI replay.

- The previous merge RPC reproduced `customer_case_attachments_case_owner_fk` failure and transaction rollback.
- The previous contact RPC reproduced a write, audit, domain event, and queued outbox on a merged source even when its post-merge version matched. The proof transaction rolled back.
- The new native lifecycle regression passed: composite support/site ownership, portal mappings/history, disjoint users and preserved roles/statuses, alias ambiguity, cross-company refusal, uniqueness rollback, immutable signed contracts, late-write refusal, and atomic contact rollback.
- The two-session concurrency regression passed: stale identity INSERT and contact update wait/recheck after merge; child UPDATE fails safely without a deadlock; all committed synthetic fixtures are removed.
- No live OPS database or production settings were changed.

## Source checks

- 107 tests across 12 focused files passed, including real resolver/sync route tests, support routes/attachments, identity transitions, assertion, bundle, and controlled-error mapping.
- `typecheck` and `typecheck:tests` passed.
- Scoped ESLint with zero warnings passed.
- Customer portal API docs and both error contract checks passed.
- Migration integrity, legal guards, hardening, and type provenance checks passed; 668 migration files, 572 version groups.
- Tenant-service ratchet passed: 2335 against baseline 2353.
- `git diff --check` passed.

Logs are in `/tmp/gridex-ops-merge-native-final.log`, `/tmp/gridex-ops-merge-concurrency-final.log`, and `/tmp/gridex-ops-merge-targeted-final.log`. Local fixture and concurrency commands use `/workspace/scratch/ea40179ae827/with-local-postgres.sh`; only localhost is accepted by the concurrency script.

## Current-main rebase and identity composition

The candidate is rebased onto `c1fdf06c6735d193a9bb2529811b0f3339ac1360`. Invoice atomicity PR #455 and its canonical generated schema/types are preserved. Its new 224000 migration required renaming only this lifecycle migration to 230000; the SQL body/hash are unchanged. The native proof above used the identical body on the affected 55bb schema. In a separate disposable worktree, the previous candidate composed with identity PR #454 passes all 119 tests in 14 files, both TypeScript checks, scoped lint, and API docs. Its two sync conflicts were additive helpers/imports; both lifecycle and unique-match checks were retained.

## Mandatory exact-head replay

The new migration is `20261002230000_customer_merge_portal_lifecycle.sql`, SHA-256 `836c083fad0f231a145cf4117527057a20bdc2f73d094c3fbaa53fbab525a4c9`. It changes constraint deferrability and function/trigger bodies, without changing RPC signatures or table columns. The type manifest retains the prior generated artifact's provenance and records the new migration tail; it does not claim that a new full generation has already run.

Before merge, run the `ops-hardening` clean Supabase replay at the published candidate head. Its always-uploaded artifact is `gridex-rem-002-clean-replay`, containing `rem002-clean-replay.log`, `rem002-database.types.ts`, and `rem002-schema-snapshot/`. Import the canonical replay snapshot and any generated type changes, update their manifests using the repository tools, and rerun the exact-head checks. The old committed fingerprint is expected to differ until this canonical artifact is imported. Local subset proof does not replace that gate.

The separately published portal identity fix (PR #454) must be composed in a disposable validation worktree before activation. This PR deliberately leaves that independent fix's first-link uniqueness and public-reference changes in its own branch.
