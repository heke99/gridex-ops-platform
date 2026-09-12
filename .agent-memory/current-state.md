# Current state

Updated: 2026-09-12.
Status: PARTIAL

## User scope and active task

Continue masterplan points 77–86 in this order: database reconstruction and generated types; the two confirmed runtime faults; full RLS/permissions; native billing transactions; background jobs including point86 STARVATION; resume the paused API remainder; final review, merge and deployment. Point86 is fairness/backlog isolation, not a migration ordinal.

The sole active task is database reconstruction. The latest instruction supersedes the earlier publication-only/API-pause next action, but does not authorize redoing completed API work or bypassing release gates. Existing API code remains unchanged; the unfinished partner-price patch stays unapplied until its scheduled turn.

## Published implementation and exact native evidence

PR310 / codex/gridex-parity-remediation-20260905 contains two database-test commits on d94e1f0b7aa2b6d98d133a039261ec0d2e2aeae1:

- 1ba0f7b1c4fe41da7ab379a7ac2244def49dd3da extends the existing 118-input foundation diagnostic through the exact source-pinned 508-input timestamp/interleaved selection and its five prerequisite boundaries.
- eacc6d404f229f91b13e9eb60c301f0b4ac148ef supplies an explicit real PostGIS profile for this owned, network-disabled diagnostic. Default legacy proofs still use postgres:17. The diagnostic verifies image identity, owner, network isolation and PG17/PostGIS availability before executing sources.

At 1ba0f7b, native run34714610111/job103609490437 passed all118 foundation inputs and44 timestamp inputs, then stopped with SQLSTATE0A000 at timestamp45, migrations/20260611100000_energy_resolver_grid_area_operations.sql. Its CREATE EXTENSION postgis requirement was absent from the plain PostgreSQL image.

At eacc6d4, native run34715245340/job103611207798 passed the PostGIS migration, all118 foundation inputs and228 timestamp inputs. It stopped with SQLSTATE42601 at timestamp229, migrations/20260728170000_live_schema_code_canonical_sync.sql. Source SHA256 is 4b1af824f75423faa393d60b845d3b39a3998bcfc7d7ea1cec2a54aa8d3bd400. All21 local and hosted constructor/selection/privacy tests passed; owned-container cleanup passed. This is a BLOCKED diagnostic, not a complete accepted replay.

The real diagnostic runtime was PostgreSQL170005 with PostGIS3.5.2, image postgis/postgis:17-3.5, imageId sha256:2ed748fc602dd3031c6724db8cb289e1578c2deb552a4f6e291f6f7e5e6e4f69. This is not claimed to be the exact managed Supabase runtime. The mutable tag is read back, not represented as an immutable image-input pin.

## Exact next database action

Resolve the invalid intermediate session-guard definition in the historical live-schema sync without rewriting applied history or skipping source effects. Its four text-repair calls remove v_disabled_at before removing the SELECT INTO target and other references. The existing later 20260730130000_historical_sync_forward_repair.sql explicitly documents this defect and installs a complete guard atomically; the current chronological replay cannot reach it. A new reconstruction solution needs source-bound native failure/rollback, final function/ACL/behavior and continuation evidence before acceptance. No such solution has been implemented by this checkpoint.

Do not merely disable validation, catch-and-ignore SQL errors, reorder arbitrary migrations, alter history hashes, mark missing effects complete or generate types from the partial database. Continue from this exact blocker rather than reopening API work.

## Preserved application work and verification

The accepted application baseline remains52b2de4d81cae370bf250e5a80f12c300bbddd16/tree76e633e2c7189807ae8b7de297a6d2e6e2343234. It includes seven selected-company JSON routes, six invoice/Ediel routes, five platform routes and the preceding body/auth/company-authority fixes. The API sources, quality/paused/2026-09-12-partner-price-wip.patch, migration files, migration manifests and generated types are byte-identical to the starting head of this database batch. The move-out contract is unchanged.

On eacc6d4, OPS34715245359/quality-release-gates103611207992 passed lint, script/test types, mechanical checks, tests, API docs/compatibility/release checks, RBAC, budgets and build. This is not full CI: verify103611207917 failed at db:migrations:check, and clean-migration-replay103611208029 failed its clean replay/types step. Full E2E acceptance remains open. Independent review of this database diagnostic and the outstanding JSON increments has not been performed in this session.

The paused candidate previously had213files/2143tests locally; it is not active or newly accepted. Retain its separate release/header/idempotency and native concurrency review.

## Replay accounting and safety

Working-tree accounting is 600 inputs: 558 `FULL_FILE_SELECTED`, 23 `SUBSTITUTED`, 14 `UNCLASSIFIED`, and 5 `EXPLICITLY_EXCLUDED`.
The focused group contains 346 inputs: 311 selected, 20 substituted, 10 unclassified, and 5 excluded.

No production mutation has been performed in this replay-verification batch.
Push reviewed, coherent batches stepwise as requested.

The complete accounting report is unchanged from the starting head. --require-full-effects still exits1, with no input-contract errors and37 unresolved global dispositions. Selection and partial native execution do not prove their missing effects. The original clean-replay/full-effects/ownership/private-logging gates are unchanged. No ledger provenance, schema baseline, generated types, main merge or production deployment is accepted.

## Remaining plan and runtime observations

After full database reconstruction and types, fix the previously confirmed missing event_scope in platform market/geodata events and the ambiguous metering_points-to-customers embed between two tenant-composite foreign keys. Preserve canonical_energy_flow_events_scope_check and tenant constraints.

Then finish complete two-tenant CRUD/RLS/ACL, native invoice/event/evidence/dispatch transactions, job ownership/scale/recovery and point86 starvation tests, the paused API remainder and final independent review/E2E/deployment. Preserve the existing Task11b/12/15/16–18 source and admission contracts. Generated-types tail20260911114443 remains unresolved.

Supabase projectpiidsfebjqjmnepdpnas is named gridex-ops-dev. The earlier recorded Vercel deployment is dpl_6qevcw57wT7X2p5yd5rQA7hzRq8c for projectprj_xA3EDI1xztkkyx21e3LY4UhgYrWt. Neither the name nor this offline diagnostic proves deployment/database binding. No managed database SQL or Vercel deployment was performed in this session.

## Continuity

Evidence: quality/audits/DB_SELECTED_CHAIN_FRONTIER_2026-09-12.md and DB_SELECTED_CHAIN_RECEIPT_2026-09-12.json. Continue quality/plans/2026-09-12-current-and-plan77-85.md with the explicit point86 scope and the database-first order above. Older evidence logs are preserved byte-for-byte under .agent-memory/archive/pre-db-frontier-20260912/ and linked from the current append logs; they are historical evidence, not the active status.

The local workspace was reconstructed from a GitHub source artifact and matched by complete Git tree. Published commits use the real upstream parent and non-force ref updates; no synthetic local history is pushed. All successful/blocked receipts remain scoped to their exact code SHA.
