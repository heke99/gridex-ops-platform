# Task 6 application guard and interval evidence report

Status: ROUND1 FIX IMPLEMENTED; actual-source local verification 40/40 PASS; independent review, supported Node22/Vitest/typecheck/build and native SQL gates PENDING. No claim that BILL-01/BILL-02 are closed in the database or that plan79–82 is complete.

## Scope and routing

Read AGENTS, active memory/continuity, decisions/known failures, plan global constraints/Task6 and supplied task brief; complete current engine, interval resolver, underlay adapter, underlay writer/coverage validation, review preparation, approval/dispatch, Stockholm helpers and relevant frozen component/settlement consumers. Read complete latest original persistence/locking bodies in `20260716010000_contract_billing_end_to_end_completion.sql`, production amendments and `20260901152500_canonicalize_billing_underlay_stockholm_period_semantics.sql`. The latter stores civil dates plus payload original instants. This is authoritative over the TypeScript writer's pre-RPC instant shape.

Activated executing-plans, systematic-debugging, test-driven-development and verification-before-completion; applied direct actual-source false-positive verification and scoped code review. Supabase skill applied for tenant-scoped queries, exact-count pagination and migration identity constraint. Supabase changelog/reference fetches were attempted but unavailable (unsupported Markdown response / timeout); query methods and ordering follow existing installed project source, with synthetic API-cap/count behavior exercised. No dependency/install, new platform API, Next.js API, schema, permission, UI, performance optimization, whole-repository scanners, production or deployment changes. No agents spawned. Parent owns independent review, publication, hosted/native gates and memory. This is a bounded remediation, not a new full baseline audit.

## Owned files

- `lib/billing/underlayEvidence.ts` (new)
- `lib/pricing/engine.ts`
- `lib/pricing/intervalPricing.ts`
- `lib/pricing/priceSourceResolver.ts` (round1 canonical frozen-base helper extraction)
- `lib/pricing/underlayPricingAdapter.ts`
- `lib/billing/invoiceReviewPrepare.ts`
- `lib/billing/invoiceApprovedDispatch.ts`
- `quality/audits/proofs/billing-evidence-regression.mjs` (new)
- `__tests__/billing-evidence-regression.test.ts` (new)
- this report (SDD only)

No commits, index changes, pushes, dependency installation, generated-type edits, workflow edits, migrations or production connections. Existing root-owned receipt and pycache left untouched.

## Implemented behavior

1. Canonical source guard requires validated/ready underlay, empty structured readiness issues, absent billing blocker and zero missing count. Pricing-pending flags and latest failed pricing errors are deliberately not source-validation blockers: the current writer sets a valid unpriced underlay validated/ready. Shared guard retains original blocker messages/codes. Complete item checks reject blocked item status/warnings, missing/duplicate source/item IDs, tenant/customer/meter/contract/area/energy-direction/settlement mismatch, gaps/overlaps/outside-period items, incomplete period, count mismatch and kWh mismatch. Positive whole-period kWh allows zero individual intervals.
2. Input rows, source prices and saved interval evidence use deterministic primary time + unique ID order and inclusive `.range` pages. Every page requires exact total count, consistent total, exactly the requested available size and unique nonempty IDs. Short pages and count changes fail rather than treating the returned page as the expected population. Underlay source count, complete segment coverage and aggregate quantity supply independent completeness checks.
3. Civil boundaries become Europe/Stockholm instants. Payload original instants are used when present, after checking their corresponding canonical civil dates. Contradictions fail; no month fallback silently widens a segment. Valid midmonth segments and original intraday instants remain supported. Pricing fee/contract civil dates remain unchanged; only interval evidence uses the corrected instants. Existing pricing-run timestamptz values produced by legacy SQL date casts are compared by Stockholm civil dates; full metering coverage still uses authoritative original underlay instants.
4. Interval resolver now prices every item. Source numeric priority is preserved; equal-priority selection has explicit stable ID tie order. Saved evidence is revalidated against the canonical item set, exact run/underlay/company/contract/area, interval bounds/resolution, quantity, finite price/amount, source ID and persisted SHA256 shape. Saved per-interval amounts reconcile to frozen spot component weights using the existing rounding convention. No hash recomputation claim: native PostgreSQL persistence builds its own JSONB/run-bound digest.
5. Pricing checks canonical evidence before calculation, including fixed/monthly, production and correction flows. Before success persistence it freshly checks the underlay again and compares identity, snapshot ID, period, quantity and any interval evidence item values. A blocker appearing during source resolution cannot reach a success RPC. This narrows application stale-state exposure but does not close DB TOCTOU.
6. `lockPricingPreview` checks the exact successful/locked run and complete canonical evidence before RPC. Locked adapter loads and returns the entire validated saved interval list. Preparation excludes rows with retained source blockers; existing locked runs are validated through the real adapter. Approval and send freshly validate the exact pricing run and evidence and require the legal invoice snapshot to retain all interval values/identities/hashes. Truncated or mismatching snapshots fail before provider creation.
7. Failed pricing persistence retains the existing failure branch contract. In the inspected SQL branch, only pricing_snapshot latest-failure fields and updated_at change; readiness/status/structured readiness_issues/billing_block_reason are not overwritten. This preservation is source-traced; no native failure-transaction execution occurred here.

## Executed RED/GREEN evidence

All commands ran from `/workspace/scratch/d37bbab32614/gridex-ops-recovery`, Node `v24.19.0` (repository-supported Node22 acceptance remains pending).

Original pre-review candidate GREEN:

```
node --no-warnings --experimental-vm-modules quality/audits/proofs/billing-evidence-regression.mjs
```

Exit 0, **36/36 PASS**.

Fresh complete baseline RED using the same business fixtures and unmodified actual module definitions fetched by `git show` from the published reference:

```
node --no-warnings --experimental-vm-modules quality/audits/proofs/billing-evidence-regression.mjs --source-ref=02577f8ca902cf367f3af64e67a5e4043dbd8099
```

Exit 1, **28 expected requirement failures / 8 existing controls PASS**. No source-shape replacement or reconstructed pricing implementation is used. The initial cases were written/run against unfixed source before implementation; saved-amount and stale-persist cases were additionally observed RED before their guards were implemented. The reference mode makes those red checks reproducible after source edits.

The actual interval resolver plus actual base calculator give baseline **SEK2880 vs required4760**, corrected **4760**, using 2880 quarter rows (first1000 at1, later1880 at2). The full actual pricing engine with canonical civil month also succeeds at4760 and passes2880 evidence records to the persistence boundary. Baseline full-engine case separately fails on the civil-to-UTC bug, matching the prior audit's reachability caveat.

Cases: month, missing item, overlap with no missing gap, duplicate ID, expected-kWh mismatch, foreign item customer, truncated items, truncated prices, later price-page failure, multiple sources/priority, spring DST2972 quarters, autumn DST2980 quarters, zero interval within positive period, complete fixed pricing, production credit, consumption correction credit, blocked preview, blocked lock, blocked preparation, blocked send, saved2880 evidence, saved quantity mismatch, truncated legal snapshot send, midmonth1440-row segment, original intraday96-row segment, contradictory original/civil boundaries, price-source ties, absent saved evidence, saved later-page failure, valid lock including legacy civil-date cast, monthly fee2919=2880+39, valid preparation retaining2880 snapshot rows, valid sent result with one provider boundary call, saved amount mismatch, stale blocker before persistence, and full interval pricing preview/persistence.

`git diff --check`: exit0. No installed tsc/Vitest/dependency tree available locally; no installation retried. New permanent Vitest test imports the actual TS modules with `vi.doMock` only for the listed external I/O boundaries and runs the same36 cases. Its loader uses real dynamic imports and does not require VM flags. The Node VM loader is supplemental local execution only. Hosted command for the narrow gate: `npx vitest run __tests__/billing-evidence-regression.test.ts`; then repository required supported Node22 lint/typechecks/related pricing/billing suites/build under parent control. No hosted results are claimed here.

## Required forward SQL surface and residuals

The genuine CLI scaffold supplied by root is SDD `generated-migrations/20260912052508_billing_underlay_evidence_guards.sql`, currently EMPTY and untouched. Receipt: `quality/audits/MIGRATION_SCAFFOLD_RECEIPT_2026-09-12.json`, pinnedCLI2.101.0 job103504560679. The identity was not invented, but no migration body/native acceptance follows from this receipt.

Necessary next SQL work, independently reviewed and executed only in an exact owned fixture:

- Guard `gridex_persist_pricing_run` under its actual advisory/row locks before accepting success. Validate canonical source blockers/identities/items/full original segment/count/kWh and complete interval evidence; preserve structured source blockers separately from pricing state. Do not clear source-validation issues as a pricing side effect. Preserve existing tenant guards, active-run supersession, pricing lines, energy inheritance and digest construction.
- Guard `gridex_lock_pricing_run`, including its already-locked early return, under the canonical lock order. Validate exact stored evidence and source readiness before ledger/period locks or readiness updates. Retain original grants/service-role restrictions, period-open behavior and immutable run semantics.
- Enforce the same canonical readiness/evidence contract at actual `gridex_create_invoice_export_graph_v1` wrapper/core and canonical reservation entry points, with exact company/reference guards and complete legal snapshots. Other direct RPC callers are NOT protected by these application changes.
- Address the send reservation/fencing boundary transactionally; a JS reread cannot prevent underlay/pricing changes after checks and before external provider calls. Native source/run/evidence mutation/concurrency tests must prove the intended lock/freeze contract rather than assuming our reads are one snapshot.
- Native cases must include overlap+missing_count0 through persist→lock→reserve/send, valid fixed/monthly/production/correction controls, invalid revision/area/contract lineage, 1000/1001/2880+ and DST/segment evidence, direct RPC negatives, retained blocker structures, exact tenant failures and rollback/TOCTOU interleavings. PostgreSQL JSONB digest correctness and production schema/RLS/Data API reachability remain native gates.

Application page totals detect changed counts, duplicate/missing rows and topology/quantity mismatch, but not arbitrary same-count same-value concurrent substitutions across distinct HTTP snapshots. Original source revision eligibility beyond current underlay/item state remains governed by existing SQL lineage/immutability rules, not newly proved here. Existing pricing-preview-line pagination, broad monthly-underlay traversal, full fee/tax rule matrices and provider event BILL-03/lifecycle races are outside this bounded task. Independent review and supported hosted gates must finish before publication; no whole-billing or production readiness claim.


## Independent review fix round1 — TASK6-R1

The independent review rejected the first candidate because the saved-evidence guard interpreted raw snapshot components independently of the calculator. Valid area-specific 100% SE3 + 100% SE4 rows summed to an invalid 200% in the guard; the supported legacy `{pricing_model:'spot', interval_resolution:'quarterly', base_price_components:[]}` shape calculated correctly but bypassed required evidence when the saved rows were absent. Review reference: `task-6-review.md`; original candidate copy: `task-6-round1-base`.

Round1 touched only these implementation/test files plus this report:

- `lib/pricing/priceSourceResolver.ts`: extracted the existing frozen base-component block into exported pure `resolveFrozenBaseComponents(snapshot, underlay)`; `resolvePricingConfiguration` calls that same helper. The exact existing normalization, accepted `_snapshot`/ordinary arrays, legacy frozen shape, midperiod validation, area/period applicability and commercial-leg deduplication remain together. Live-contract/tenant fallback behavior, fee lifecycle handling and tax resolution were not widened or changed.
- `lib/billing/underlayEvidence.ts`: calls the shared helper with the authoritative underlay civil period and area, then derives positive spot usage and contractual weight from resolved commercial legs. Empty unresolved nonproduction bases fail closed. Production without spot evidence keeps its dedicated settlement path. Existing count/identity/period/value/hash-shape/amount checks remain intact.
- `quality/audits/proofs/billing-evidence-regression.mjs`: adds four focused business cases to the automatically discovered permanent Vitest suite. Each case first executes actual preview at4760 with2880 outgoing evidence, then exercises real locking. Supplemental VM loader now constructs the cached modules and calls `link` once on the root module so Node handles shared transitive imports. The prior recursive linking produced a loader-only unlinked-module error after the new shared dependency; fixing the loader does not replace or transform application implementations. Hosted Vitest continues to use real dynamic imports, unchanged.

Before implementation, each new case was run directly against the first candidate and failed for the expected business reason:

```
node --no-warnings --experimental-vm-modules quality/audits/proofs/billing-evidence-regression.mjs --case=canonical_area_components
node --no-warnings --experimental-vm-modules quality/audits/proofs/billing-evidence-regression.mjs --case=canonical_legacy_missing_evidence
node --no-warnings --experimental-vm-modules quality/audits/proofs/billing-evidence-regression.mjs --case=canonical_legacy_saved_evidence
node --no-warnings --experimental-vm-modules quality/audits/proofs/billing-evidence-regression.mjs --case=canonical_period_and_dedup
```

RED results: area valid lock rejected with `billing_evidence_spot_weight_invalid`; legacy missing evidence reached lock (missing expected rejection); valid saved legacy evidence rejected with `billing_evidence_spot_weight_invalid`; duplicated area rows plus a next-period35% row also rejected. **Four meaningful REDs before the shared resolution change.**

After implementation and correcting the supplemental VM graph linking, the same four commands all PASS. The period/dedup case confirms applicability and normalization beyond the two exact reviewer repros: duplicated SE3 commercial rows and an otherwise different35% spot leg valid only from July are not added to June's100% weight.

Fresh affected-suite command:

```
node --no-warnings --experimental-vm-modules quality/audits/proofs/billing-evidence-regression.mjs
```

Exit0, **40/40 PASS**: four new canonical-shape cases and all36 previous cases, including fixed/monthly/production/correction, complete saved evidence, valid prepare/send, and all blocker/truncation checks. No unchanged full published-baseline suite was repeated this round. `git diff --check` and `node --check quality/audits/proofs/billing-evidence-regression.mjs` both exit0. Scoped diff inspected against `task-6-round1-base` and the original resolver block.

Hosted Node22 permanent Vitest, lint/typecheck/build remain PENDING. Add `__tests__/price-source-component-normalization.test.ts` to the narrow hosted verification set for the extracted canonical resolver dependency. Native SQL/direct-RPC/TOCTOU gates above are unchanged. No index, commit, push, memory, workflow, migrations, dependencies or production operations. Stop for independent re-review of TASK6-R1.

## Independent acceptance at application boundary

TASK6-R1 addressed after one fix round; independent specification and quality APPROVED, no new findings. The nine implementation/test files are ready for reviewed branch publication and supported Node22 CI. Native SQL/direct-RPC/concurrency enforcement is still required and is not claimed by this application acceptance.
