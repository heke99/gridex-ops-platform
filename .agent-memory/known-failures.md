# Known failures

## KF-001 — Overloaded energy `automation_allowed`

Status: FIXED_VERIFIED

Purpose-specific loaders and capabilities now keep pricing/quote independent
of customer-specific switch/PRODAT readiness.

## KF-002 — Internal IDs in public application payload

Status: FIXED_VERIFIED

The website application route now applies an explicit public DTO sanitizer and
regression coverage.

## KF-003 — Pricing runs exposed as invoices

Status: FIXED_VERIFIED

Portal invoice list/detail load only persisted `customer_invoices`.

## KF-004 — Git provenance unavailable

Status: BLOCKED

The uploaded archive has no `.git`; branch, commit and original dirty-tree state
cannot be verified from this input.

## KF-005 — Database apply unavailable

Status: READY_FOR_AUTHORIZED_OPERATOR

The new forward migration, preflight and post-apply are static-verified but
cannot be applied or transaction-tested because an authorized database
connection is absent.

## KF-006 — Live contract behind release candidate

Status: PENDING_DEPLOY

The live developer page observed on 2026-07-25 exposes an older contract than
local `2026-07-28.1`.

## KF-007 — Noncanonical remote/local migration history

Status: REPAIR_POINT_IMPLEMENTED_BASELINE_PENDING

Only nine remote historical migrations are registered and their
versions/content do not match the current local chain, while later definitions
exist live. The new repair migration safely converges current objects. A clean
baseline still requires the verified post-apply schema.

## KF-008 — Exported active live function failures

Status: FIX_IMPLEMENTED_STATIC_VERIFIED

All 23 lint errors are covered and all 41 exact function patches match the
exported definitions. Production closure requires applying the migration and a
green postflight.

## KF-009 — Reduced compatibility components in signed website snapshot

Status: FIX_IMPLEMENTED_STATIC_VERIFIED

Website onboarding previously wrote
`compatibilitySnapshot.priceComponents` instead of the quote's exact resolved
components. V6 now requires and freezes the quote arrays, and database binding
rejects mismatches.

## KF-010 — Internal catalog contract copied loose scalars

Status: FIX_IMPLEMENTED_STATIC_VERIFIED

Internal customer registration now selects a stable option, verified SE row,
invoice method and allowed components, then commits the customer contract and
immutable price snapshot atomically through a service-only RPC.

## KF-011 — Portal signature evidence contract drift

Status: FIXED_VERIFIED

The portal database projection selected `signature_snapshot_sha256` and the
developer guide documented it, but the public DTO and Customer Portal OpenAPI
omitted it. The final go-live regression exposed the mismatch. DTO, release
generator, OpenAPI and a direct regression now agree.

## KF-012 — Recursive sanitizer removed public legal bundle IDs

Status: FIX_IMPLEMENTED_STATIC_VERIFIED

The external DTO sanitizer removed nested keys ending in `_id`, including documented `legal_bundle_version_id`. Legal output is now rebuilt through an explicit strict serializer with parity coverage.

## KF-013 — Public price-option canonical field drift

Status: FIX_IMPLEMENTED_STATIC_VERIFIED

Database publication rows use `is_default`, while prior public schema logic treated `default` as canonical. The public model now uses `is_default` everywhere and emits `default` only as an identical deprecated alias.

## KF-014 — Uploaded historical price-option migration checksum mismatch

Status: RELEASE_BLOCKER

The trusted checksum for `20260730220000...` remains `0ab350f0...`, but uploaded bytes hash to `978de5e9...`. No historical checksum or bytes were rewritten by PHASE-36. Resolve from authoritative source/ledger.

## 2026-09-04 — FALSE POSITIVE: "no cron job has a lock" (plan Fas 16, §19)

Do not raise this again without reading the handlers.

Grepping the 21 cron route files in `vercel.json` for lock keywords returns
zero hits, which looks like every scheduled job runs unguarded. It is wrong.
The routes are thin: they authenticate and delegate. Concurrency control lives
in the handler and, below it, in the database.

Checked end to end for `/api/ediel/outbox/process`:

    route -> lib/ediel/outbox/processEdielOutbox.ts
          -> lib/ediel/outbox/claimOutboxItems.ts
          -> rpc claim_ediel_outbox_items
             (supabase/migrations/20260618200000_ops_production_hardening_resolver_queues.sql)

That function selects `where status in ('prepared','queued') order by priority,
created_at limit least(p_limit,100) for update skip locked`, flips the claimed
rows to `sending` in the same CTE, and separately recovers rows stranded in
`sending` to `delivery_uncertain`. That is claim-based concurrency with a batch
limit and stale-claim recovery — stronger than a global advisory lock, since it
lets workers run in parallel without starving each other. The migration that
introduced the pattern is even named `..._multitenant_integrity_and_claim_locks`.

Lesson: route-level greps say nothing about this codebase's job semantics.
Any Fas 16 audit must trace route -> handler -> RPC before classifying a job.

## Disproved: "relations, columns, functions, indexes and triggers match canonical exactly"

Recorded earlier in this project from the first production parity attempt. It is
WRONG for triggers, and the mismatch is the tenant guards. Production carries six
BEFORE ROW tenant-attribution guard triggers that the canonical chain does not
build at all. The harness that produced the original claim could not see them.
Evidence and the full register: `quality/audits/GRIDEX-PROD-PARITY-2026-09-04.md`,
finding F-PARITY-4.

## PG17 replay proof pitfalls — verified 2026-09-10

- Internal catalog char concatenation: text concatenated with pg_depend.deptype
  produced ambiguous-function42725 in the new repair catalog. Explicit text cast
  correction07f58c3a verified through actual catalog00000 at a38fbd6d and later heads.
  Apply the same check to new internal-char catalog operands; do not drop dependencies.
- Sequence rows have no composite row type (pg_class.reltype0). Whole-row to_jsonb
  on a sequence produced wrong_object_type42809. Correction96cea061 captures and
  compares last_value/log_cnt/is_called explicitly in snapshot/admission/assertions;
  r/p full-row comparisons remain. Actual called/uncalled controls and complete
  batch/repeat passed at017d47e7/517fdb1a respectively. Never remove sequence checks.
- PL/pgSQL record-variable and SQL whole-row alias collision produced42702 in
  admission. Correction4fc34ae9 uses a distinct qualified role_row alias; actual
  complete batch and repeat passed at517fdb1a. Check ambiguous aliases before hosted
  execution; do not change variable-conflict resolution to hide ambiguity.
- Test assertions using IF NOT(condition) accept NULL. T11-R1 uses IS DISTINCT
  FROM true; actual true/false/NULL/empty-scalar/NULL-scalar controls passed at017d47e7.

These are bounded proof-tool corrections, not full replay or production acceptance.
Current status and remaining gates are exclusively in current-state.md.

## Task15 B0 equal-timestamp oracle reuse — reviewed correction, hosted pending

At3b3b508a OPS34554272047 fixed-target job103123464997 passed12 cases then
failed FULL_PK_FIELD_ORACLE_MISMATCH at reduced_match_tie, exact cleanup PASS.
Original B0 ORDER BY created_at has no tie-breaker; repeat_rollback reused the
winner from a prior rolled-back source execution. A tied candidate may differ
per whole execution. Correction must independently match one complete legal
preimage-derived candidate postimage each time, retain all PK/field/catalog/
sequence/dependent checks and reject hybrid effects; never force a source order.
Native failing substage not disclosed/observed. Author fix1 in progress; no
full SQL acceptance or source selection inferred.

Task15 T15-F1 correction4ed89ff5 independently ADDRESSED with no new findings;
meaningful synthetic four-sequence red/green and full negative controls PASS.
Corrected native acceptance pending, not inferred from old-head receipts.
