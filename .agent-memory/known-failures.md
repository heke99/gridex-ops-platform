## 2026-09-24 — Resolved document native prerequisites and supply aliases

Task2b initial native228/261 failed33 seeds because customers.read existed in catalog/legacy eight-digit INSERT files but not canonical fourteen-digit clean replay. Resolved by published forward20260924021718 materializing only the established key, ON CONFLICT DO NOTHING, no assignments; repeat/metadata/assignment preservation qualified. Do not infer DB registry presence from catalog or role arrays.

Next native261/262 failed one purported unlinked-supply negative: published gridex_sync_supply_customer_contract_v1 restored customer_contract_id from contract_id. Fixture now clears both aliases atomically, asserts persisted null/null and no Storage reads. Runtime graph was correct; no production SQL changed for that defect. Final accepted7581966b native262 and all same-head gates PASS. See task-2b-fix2-report-20260924.md, task-2b-fix3-report-20260924.md and document-reference-acceptance-20260924.md under E035 source-ledger audit.

## 2026-09-18 — PR330 recovery and review correction (current snapshot)

Original exact candidate0a89e102 published;four ordinary workflows green.
Independent reviews5730637320/5730659831 identified row-code suppression of
wire-requiredZ09:216. Refined33-case red baseline32fail/1pass;34 review cases
now pass (one additional list regression reproduced and repaired). Fresh2474
application/851retained-source cases and all3types/coverage/quality gates pass.
New-head CI/build/replay and substantive rereview are still required before
merge. See `current-state.md` and f3-d-review-remediation-20260918 audit.
Existing main70/73 certificate and automatic Vercel Git deployment are recorded,
not hidden or certified by this PR. PR310 paused;other104D/full plan unverified.

---

## Older entries below are historical

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

## 2026-09-18 — D-subtype scoping and local build resource limitations

Status: PARTIAL (local corrections verified; publication/ordinary CI/review pending).

Per-object narrowing initially hid selected DTM fields in the message header.
Four negative tests reproduced that introduced regression; shared global date
placement checks now execute before object narrowing. Keep those tests.

The first local full build exceeded the 4 GiB container's aggregate memory and
was SIGKILLed; a 2304 MiB heap retry exhausted V8 during type checking. The same
full build passed with a local 3072 MiB process cap, followed by the unchanged
bundle budget. Do not mark earlier failures as passes or copy the memory cap
into committed configuration to suppress an acceptance gate. Read the separate
three-attempt audit. GitHub write/CI capability was unavailable in this session.

## Resolved PR338 R1 and local command mismatch
Padded Z14 DTM90/354/693 qualifiers bypassed protected checks;108red then115regressions green, independent original9escapes nowblocked. Minimal recognition-plus-exact-spelling rejection. Full certificate must use workflow NODE_OPTIONS preload; omitting it yields9legacy source-string failures (64/73), correct invocation73/73.

## Still open positive reporting/customer authority
Ten archived RED probe cases remain, fourcells unaccepted. Missing per-object verified producer; do not enable blocked stubs or promote arbitrary portalData. NarrowNexclusions repaired locally pendingreview. Audit f3-reporting-context-20260919.md contains actualsource/callpaths,redcounts and separate producerdesign.

## PR350 independent probe output preservation incident
Original author reran unchanged independent probes with a new reporter path, but probe-owned fs writes replaced four observation JSONs (registry, mixed-registry, missing-component, invalid-occurrence). Original test files, SHA manifest and three test result receipts remain hash-identical. Reviewer read-only search found no complete original observation backups; do not claim byte recovery. Original review and captured wire corroborate the findings. Preserve original manifest, label regenerated observations as rerun evidence and redirect future observation writes outside original paths without modifying assertions.
