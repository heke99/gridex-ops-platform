# Current state

Updated: 2026-09-12.
Status: PARTIAL

## User scope and current action

The remediation scope is masterplan points 77–86, including point86 STARVATION (old backlog must not block new work, completed rows must not consume batch windows, and one tenant must not block others). This is not migration ordinal86.

Latest user instruction: save/publish the completed work now and defer further API development. No new API implementation is active. Preserve existing work, record verification accurately, and leave the unresolved release gates in place. Existing authorization to commit/push and eventually merge remains subject to verification; it does not authorize bypassing failed gates.

## Published application work

The application baseline is commit52b2de4d81cae370bf250e5a80f12c300bbddd16, tree76e633e2c7189807ae8b7de297a6d2e6e2343234, on PR310 / codex/gridex-parity-remediation-20260905. It includes the seven selected-company JSON routes, six invoice/Ediel JSON routes, and five platform JSON routes, plus the preceding accepted body/auth/company-authority fixes. The platform batch is recorded in quality/audits/ADMIN_JSON_PLATFORM_REMEDIATION_2026-09-12.md.

On that exact application head, OPS34708688278 / quality-release-gates103593343733 passed tests, lint, script/test types, API contracts, RBAC, build and budgets. The full local application suite has212files/2080tests on that baseline. These results do not close the full replay, RLS, billing or job plan; independent review of the JSON increments remains open.

## Paused API work, not activated

The three modified partner-price source/contract files and the 63-case test file are preserved byte-for-byte in quality/paused/2026-09-12-partner-price-wip.patch, with hashes and restoration instructions next to it. The patch is not applied to the application source in this publication. It preserves the candidate idempotency/schema work without introducing its new required header into the currently published application code.

The paused candidate passed a fresh local suite of213files/2143tests with exit0 before capture. That is local mocked/application evidence only, not independent review, native-database concurrency, contract-release acceptance or production acceptance. Resume it deliberately, not through automatic patch application in CI. The move-out contract has not been changed.

## Replay accounting and safety

Working-tree accounting is 600 inputs: 558 `FULL_FILE_SELECTED`, 23 `SUBSTITUTED`, 14 `UNCLASSIFIED`, and 5 `EXPLICITLY_EXCLUDED`.
The focused group contains 346 inputs: 311 selected, 20 substituted, 10 unclassified, and 5 excluded.

No production mutation has been performed in this replay-verification batch.
Push reviewed, coherent batches stepwise as requested.

The condensed state previously omitted these truthful markers and had a trailing period on Status, causing canonical-auth-membership-group-selftest.py to fail before the older schema/type gate. This publication restores the markers and matching status pointer; no test or safety guard is weakened.

## Remaining merge blockers

1. Full clean replay rejects its unsupported CLI/native target; complete source effects and reviewed ownership/reference/private logging remain incomplete. Keep the fail-closed guard.
2. Generated-types manifest tail check remains unsatisfied at20260911114443. Regenerate only from the complete accepted canonical replay, never from an arbitrary live or partial database to make CI green.
3. Accounting still has37global/30focused unresolved dispositions. Bounded native acceptance of migration prefix77 does not prove the complete600-input replay.
4. Remaining API work and independent review are deferred, including partner-price release and move-out compatibility.
5. Complete two-tenant CRUD/RLS/ACL, atomic invoice events, native billing evidence and dispatch reservation, ownership/scale/recovery/native job tests and starvation remain open. Preserve the existing Task11b/12/15/16–18 contracts and source pins.
6. Full E2E on the application head is not green and must be diagnosed before release. Do not treat a green application job as full CI acceptance.

Current-observed Task12 inputs (53relations/105functions) and Task11b dependency inputs are retained for bounded fixture authoring, separately from historical source authority. Task15's21-relation/33-function observation still needs dependency assessment. No native transaction fixture, registered migration, main merge or production rollout is accepted by this checkpoint.

## Runtime observations retained

The last inspected Vercel production deployment was dpl_6qevcw57wT7X2p5yd5rQA7hzRq8c for projectprj_xA3EDI1xztkkyx21e3LY4UhgYrWt. Supabase projectpiidsfebjqjmnepdpnas is named gridex-ops-dev. Names alone do not prove deployment/database binding.

Previously confirmed but not fixed by this publication: platform market/geodata events omit event_scope and violate canonical_energy_flow_events_scope_check; the DQ metering_points to customers embed is ambiguous between two tenant-composite foreign keys. Keep the constraints and tenant checks intact.

## Continuity and receipts

See quality/audits/SAVE_AND_API_PAUSE_2026-09-12.md for this publication and quality/paused/README.md for the preserved candidate. Continue the existing quality/plans/2026-09-12-current-and-plan77-85.md with the explicit point86 scope above only when implementation resumes. Older detailed receipts remain in .agent-memory/archive/pre-api-json-20260912/current-state.md and existing audit files; do not restart accepted work.

The local workspace is an exact-tree offline snapshot with synthetic local Git history. Upstream commits are created against the actual GitHub parent, never by pushing synthetic history. The original dirty candidate remains preserved locally. No production secrets, customer rows, new migration or deployment are included in this publication.
