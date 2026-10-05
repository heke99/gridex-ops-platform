# Successful-retry checkpoint review — completed frozen code pass

## Current verdicts (supersede the paused note below)

**SPEC: Issues found; not yet compliant/qualified. QUALITY: Needs fixes.** Reviewed original BASE `33fc777076a123b2e6c47b2d3f4ef939833883f4` → HEAD `32d441116db7a2d8051cf732e1d967bef4a98ea8`, not the concurrently modified worktree. Two Important issues (one known syntax repair pending), one Minor validator-parity issue, and explicitly separated qualification risks. This is the early checkpoint review, not whole-task/E035 or merge approval.

The approved design remains binding: “Both metering and billing must consume that projection, never rederive write arguments from mutable source, normalized payload, current fallback matching or message totals after persistence.” “A previously reserved non-held outcome never changes.” “Do not backfill a receipt hash or V1 contract from today’s mutable raw or from offset-free legacy SQL periods.”

## Strengths

- **Source race and membership boundary:** new migration `20260923135706_ediel_utilts_consumption_binding_v1.sql:403–440` locks the actual source row, compares original bytes, computes its own UTF-8 hash, checks inbound/family/company/environment/code, parses ordered physical membership, refuses pre-existing unbound results/series, and establishes a private immutable receipt. `:313–330` guards subsequent raw/context changes. No historical receipt or offset-free legacy UTC backfill is implemented.
- **Exact success authority:** migration `:457–480` validates the exact referenced series (without requiring `is_current`), its stored JSON/hash, origin receipt scope, and the immutable stored contract/hash; returns the stored contract. Cross-source equality can reuse content, while environment participates in the insertion/predecessor identity (`:185–207`) and origin validation. New correction versions remain available.
- **Conflict atomicity and reservation preservation:** migration `:128–150` retains the non-held disposition/response/issues reservation gate. Sorted source-transaction and logical-series advisory locks are acquired before the insertion helper (`:441–448`). Content/hash/origin checks happen outside its catch-to-ERR block (`:258–272` versus `:457–480`), so a later conflict aborts the entire RPC transaction, including earlier inserts and the receipt. Genuine insertion failures retain the existing failed/ERR path. Native execution/concurrency remain unqualified.
- **Privilege boundary:** migration `:277–311,487–492` creates private RLS-enabled, immutable storage without service table privileges, revokes private helper execution, grants only the public bound RPC to service role, and both revokes and replaces the old public entry point with a failing implementation. The new service-only API is not an authenticated-client write route.
- **Actual consumer integration:** `consumptionPreparation.ts:22–92`, `transactionPersistence.ts:64–112`, and `consumptionSinks.ts:10–58` separate preparation from durable returned authority and consumption. Private cloned contracts supply metering arguments and billing contributions; normalized diagnostics/public-result mutation cannot change them. Both actual and nonbilling producers supply the changed RPC contract, and actual sink call sites pass returned outcomes. `utiltsDataRequest.part-2.ts:468–585` retains the pre-ACK invalid-result stop and held/rejected early return.
- **Natural dedup:** `inboundStatusUpdater.ts:82–95,423,475` compares existing bytes/scope in ordinary and unique-conflict reuse branches; the SQL source guard is the authoritative bound-source race defense. Tests exercise both branches, not just a new unused helper.

## Issues

### Important 1 — original checkpoint migration does not parse (known repair pending)

**Evidence:** `supabase/migrations/20260923135706_ediel_utilts_consumption_binding_v1.sql:392,401`. The unparenthesized `CASE` operand in the PL/pgSQL `IF ... IS DISTINCT FROM CASE ... END THEN` is the error site observed by root's native replay. The reviewer subsequently read the exact frozen SQL and located the same expression. Root reports the whole migration transaction rolled back before tests/type generation.

**Impact:** the original checkpoint cannot install its binding authority or qualify native behavior. Green unit tests/types do not compensate.

**Status/remedy:** root subsequently reports explicit user approval for a narrow syntax/checksum exception after verifying the migration and binding schema are absent from hosted Gridex and no separate Supabase branches exist. Sole implementer is correcting syntax for rerun. That later correction is **not part of this reviewed snapshot**; no successful rerun is claimed here. No broader rewrite of published semantics is authorized by this review.

### Important 2 — billing accepts changed point/site ownership despite immutable attribution

**Primary location:** `lib/cis/db-data.ts:911–924`.

**Confirmed static path:** `consumptionSinks.ts:43–58` forwards the stored billing context and `immutableAttribution: true`. The new check only compares context customer/company, point/site customer IDs, and the request's recorded tuple. It never compares the current point's `site_id`, `customer_site_id` or `grid_owner_id`, or the site's `grid_owner_id`, to the stored billing context. `db-shared.ts:189–230,253–284` only enforces consistent company IDs; its point/site readers return current rows, not immutable ownership proof. The actual write is a direct `billing_underlays` insert at `db-data.ts:960–964`.

**Concrete counterexample / pseudocode:** bind accepted source with `(company A, customer C, point P, site S, grid owner G, request R)`; persist success and stop before billing. Keep C/A/R unchanged, change `P.grid_owner_id` to another same-company owner G2 (or `S.grid_owner_id` to G2; alternatively move P to another same-customer site). Consume the already returned bound outcomes in the same attempt, or make the change after retry preparation/persistence and before the sink. Every new billing condition still passes, and the insert carries the obsolete G/S context instead of returning an internal conflict/skip. This does not require forged contracts or a changed wire payload.

**False-positive checks:** a full retry that rematches G2 *before* persistence may correctly conflict; that does not protect an ownership change after preparation/persistence. Metering's point-level check can skip a changed point, but `consumptionSinks.ts:36–39` skips that value rather than aborting billing, and billing is independently invoked. The DB customer-chain trigger checks only point company/customer (`supabase/schema.sql:22630–22636`); company/point and company/site FKs (`:86003–86014`) also accept this same-company drift. The remaining billing insert triggers concern energy direction, contract/pricing references and price areas (`:22364–22445,27454–27463,31697–31715,84194–84218`), not the missing grid/site ownership equality. Thus these guards do not close the gap.

**Impact/severity:** Important correctness/attribution defect, not a claim of public-RPC privilege escalation or cross-tenant disclosure. Stale ownership can still create a received billing underlay after an approved contract loses its attribution authority, contrary to the explicit downstream revalidation requirement.

**Targeted fix and proof:** compare the entire intended point/site/grid/request relationship, including explicit nulls, before granting billing write authority; do not rematch or fill it from current fallback. Add real-helper and native tests for each changed dimension with otherwise unchanged company/customer/request, plus unchanged-positive controls. Place the decisive check at the authoritative write boundary, with suitable locking/atomic comparison against concurrently mutable ownership. The present TS reads and subsequent write are separate HTTP transactions; see the race follow-up below. This review did not execute tests or rely on the implementer's separate uncommitted RED tests to establish the static finding.

### Minor — SQL and TypeScript strict-contract validators diverge on null request scope

**Evidence:** migration `:375–383`, especially `:380`, versus `consumptionContract.ts:103–114`. For a billing-write contract with every other field valid but `requestScope: null`, SQL evaluates `a->>'requestScope' <> 'billing_underlay'` as NULL rather than true; the `IF` need not reject it. There is no independent SQL requestScope type/null check. TypeScript explicitly rejects it.

**Impact and calibration:** the normal producer plus pre-RPC TypeScript validator blocks this specific malformed input, so this is **not** an established ordinary-producer authorization bypass. It is an authoritative-service validation/parity gap: a direct service call can accept and freeze a shape that the returned-contract validator refuses. Include explicit null/wrong-type/missing-field probes against the RPC (not only TypeScript); use null-safe comparisons and maintain one documented shape contract. The implementation report already identifies strict-shape parity as unfinished, which does not make this discrepancy disappear but does affect its current reachability/severity.

## Remaining risks and qualification — not counted as confirmed defects

- **Ownership TOCTOU in both sinks:** `normalizeMeteringValues.ts:96–104,180–222` rechecks point attribution in a standalone read, then invokes `gridex_ingest_metering_value_atomic` without an expected immutable-attribution tuple/flag. That RPC checks only company/customer (`schema.sql:28261–28265`) before inserting the passed site/grid/request fields (`:28315–28329`). Billing similarly reads context/request then inserts separately. Add a controlled concurrent change between read and write, and prove authoritative rejection/skip or atomic locking; static review alone is not a concurrency test. A fix limited to adding more TS comparisons should not be represented as this concurrency gate passing.
- **E30 multi-observation resolution projection:** `consumptionPreparation.ts:30–37` normalizes resolution before calling the existing extractor. `utiltsDataRequest.part-1.ts:211–216,331–343` understands only `PT15M`/`PT60M` as ISO durations; `PT1H`, `PT30M` and calendar durations do not advance each quantity. E66 has already been expanded into per-observation periods (`utiltsEngine.ts:384–429`); E30 has not (`:432–433`). A genuinely accepted E30 `1:805` two-hour/two-observation fixture would therefore be an important counterexample: two full-period records with one metering key rather than adjacent hourly intervals. The actual parser/validator acceptance of that concrete fixture has **not** been executed here; do not call it nationally valid or confirmed merely from a fabricated accepted object. Add an actual-runtime accepted fixture with distinguishable quantities and inspect every bound period and sink call.
- **Missing-ID expansion:** the new builder resolves fallback identity using normalized-array index while E66 may expand one physical transaction into multiple normalized entries. However `profiles.ts:63` rejects a missing transaction ID, and `utiltsEngine.part-1.ts:676–677` uses the physical group ID rather than the suggested TN fallback. No accepted-missing-ID write path was established, so this suspicion is **not confirmed**; retain explicit rejected/no-consumption regression tests rather than bypassing validators.
- **Native matrix:** `scripts/ediel-utilts-consumption-native.test.ts:18–22` mocks final metering/billing functions. Its parser/preparation/RPC/stored-contract/sink-adapter tests are useful, but do not exercise the real downstream ownership writers or a full `processInboundUtiltsMessage` retry with observed ACK/completion. Wrong company/direction, malformed/null/missing fields, distinguishable order, equivalent-byte-different formats, concurrency and real downstream ownership remain as disclosed gaps.
- **Native results and artifacts:** original snapshot native replay **FAILED before tests/typegen**. No updated native pass, generated artifact reconciliation, final coverage/build/exact-head gates or whole-task qualification is inferred. Reported local 5931/363 and app/tests/scripts typechecks remain the implementer's execution receipts, not rerun by this reviewer. Existing lint warning is disclosed as pre-existing rather than hidden.

## Scope / verification record

- Completed the task-scoped production/test diff reading, sequentially resuming from package line 2161 through 3231 after root authorization. Large initial output truncated memory-only context, and one later output truncated part of unrelated case-navigation preflight prose; no production/native/SQL hunk was lost. Those ancillary documents are not approved by this review.
- Focused **frozen-HEAD** cross-boundary reads were only for named risks: (1) billing context resolution and insert-time guards; (2) metering ownership checks versus authoritative RPC; (3) E30/E66 normalized expansion and timestamp interpretation; (4) missing physical identity gating; (5) actual processor invalid-result/held stop and billing-to-completion order. No mutable working production files were judged as reviewed HEAD.
- Applied repository code-review, differential-review, fp-check/checklist and task-reviewer guidance. Used the supplied single-commit package/design history instead of a broader blame/audit crawl. No agents, tests, native execution, remote/DB/browser calls, code/index/branch edits or suite reruns. Only this ignored report was edited via `apply_patch`.
- False-positive disposition: **one independently confirmed business-attribution defect**, **one externally observed and code-located native syntax defect**, and **one lower-impact SQL parity defect**. Public-client bypass, cross-tenant disclosure and accepted-missing-ID claims were not established and are not reported as confirmed vulnerabilities. Concurrency and E30 runtime-acceptance proofs remain open, not silently dismissed.

## Assessment

**Task quality: Needs fixes.** The integrated source/contract/sink design is substantially present and closes the old status-only mutable-payload consumption path. The known syntax repair, confirmed downstream billing ownership gap and remaining genuine native/processor/ownership qualification must be addressed before this task can be accepted; the green local unit suite alone cannot grant that acceptance.

---

# Historical paused note — superseded by the completed review above

## Spec Compliance

- **SPEC: NOT QUALIFIED — partial review; implementation and verification remain incomplete.** Frozen BASE `33fc777076a123b2e6c47b2d3f4ef939833883f4`, HEAD `32d441116db7a2d8051cf732e1d967bef4a98ea8`. This is not whole-task/E035 acceptance.
- **QUALITY: NEEDS FIXES / review unfinished.** Root reports native migration replay failed before tests or generated artifacts. The reviewer was explicitly paused before completing the SQL/test portion of the package.
- Binding requirements retained verbatim: “Both metering and billing must consume that projection, never rederive write arguments from mutable source, normalized payload, current fallback matching or message totals after persistence.” “A previously reserved non-held outcome never changes.” “Do not backfill a receipt hash or V1 contract from today’s mutable raw or from offset-free legacy SQL periods.”

## Strengths verified in the frozen diff

- `lib/ediel/utilts/consumptionSinks.ts:10–58`: both adapters obtain stored authority through `storedUtiltsConsumption`; metering arguments and billing contribution totals come from that contract, not the normalized diagnostics. Billing compares frozen contexts rather than silently selecting the first differing context.
- `lib/ediel/utilts/transactionPersistence.ts:64–112`: the adapter checks complete unique outcomes, receipt hash/scope, validated contract shape and equality to preparation; the private WeakMap retains a clone. `__tests__/ediel-utilts-persistence-sideeffects.test.ts:42–50` exercises mutation of both diagnostics and the public returned contract while preserving sink quantity/period.
- `lib/ediel/flows/utiltsDataRequest.part-2.ts:443–469` prepares attribution before persistence; sink call sites pass the returned outcomes. `lib/ediel/flows/utiltsInboundPolicyProcessor.ts:58–64` also supplies explicit no-consumption preparation to the changed RPC boundary.
- `lib/inbound-mail/inboundStatusUpdater.ts:82–95,423,475` adds explicit changed-byte/scope checks to ordinary reuse and unique-conflict recovery. Unit tests cover both branches; authoritative race closure still requires reviewing/qualifying the SQL guard.
- The report accurately labels this an incomplete native checkpoint, discloses historical fail-internal compatibility, and does not use unit-suite success as whole-task approval.

## Issues

### Important — native migration replay blocker (root-observed, not independently rerun)

- `supabase/migrations/20260923135706_ediel_utilts_consumption_binding_v1.sql:392,401`: root supplied native feedback that PostgreSQL rejects the function definition with `syntax error at end of input`, pointing to the bare `CASE` operand in `IS DISTINCT FROM CASE WHEN o->>'readingType'='production' ...`. Root reports the implementer independently located the required parentheses. The migration transaction did not commit; no new native tests or artifact generation qualified this checkpoint.
- Impact: the published checkpoint cannot replay and therefore cannot install or qualify its authoritative source/contract binding boundary. A later forward migration cannot repair an earlier file that prevents replay from reaching it.
- Handling: preserve the published file/checksum unchanged while root requests explicit direction under the immutable-published-migration constraint. This reviewer made no migration or checksum edit and has not independently read the remaining SQL hunk yet.

### Ownership risk — observed omission, full finding pending

- `lib/cis/db-data.ts:909–926` adds customer/company and request equality checks, but the shown point/site context checks do not compare point grid-owner/site or site grid-owner against the frozen attribution. Root separately reports new uncommitted ownership tests are RED for `point.grid_owner_id`, `point.site_id`, and `site.grid_owner_id` drift.
- This review has **not** inspected the exact frozen implementation of `getCustomerExportContext` or the final billing write boundary, and those uncommitted tests are not part of reviewed HEAD. Consequently this is a concrete pending cross-boundary risk, not an independently confirmed security finding or a claim about checkpoint test results. Required continuation: one focused frozen-HEAD check of context resolution and downstream write safeguards, then false-positive analysis and targeted ownership proof.

## Remaining verification — not conflated with proven defects

- Finish SQL review: locked source/raw and physical membership comparison; exact stored/noncurrent series and contract/hash lineage; origin source/environment validation; deterministic lock ordering and mixed-batch rollback outside ERR; immutable reservations, lawful bound held release, historical refusal, service grants/RLS, old RPC retirement and guard race behavior.
- Finish actual producer/sink path review, including explicit timestamp interpretation, missing-ID/expanded normalized transaction alignment, both downstream ownership boundaries and preserved mixed-held early return.
- Finish native-test/package review and obtain successful real native execution after the migration blocker is resolved. Current native run is **FAILED**, not underway or qualified.
- The disclosed full-processor real-RPC ACK/completion matrix, concurrency/ownership probes, malformed/membership/order cases, genuine generated artifacts and final exact-head whole-task gates remain required; local reported 5931/363 and three typechecks do not replace them.

## Scope and method

- Read the brief and approved design/review; read the implementer report as claims rather than acceptance evidence. Applied repository `code-review`, `differential-review`, `fp-check` and task-reviewer guidance. Used the task-specific read-only/frozen-diff constraints instead of broader audit, delegation, testing or mutation workflows.
- Read the supplied diff sequentially through package line 2160 of 3231. Initial large output truncated part of memory-only context; no assertion depends on that missing context. The remaining documentation/native/SQL portion was **not reviewed** before root's explicit pause. No complete diff-review claim is made.
- No tests, remote/DB/browser calls, subagents, mutable changed-file inspection, code/index/branch changes or broader code crawl. No supplemental frozen-file check completed yet. Only this ignored report was written with `apply_patch`.
- False-positive status: no new independently confirmed security finding; no dismissal of the concrete downstream ownership risk without its missing boundary check. The native replay blocker is explicitly attributed to root's actual execution evidence.

## Assessment

**Task quality: Needs fixes; review paused, not complete.** The inspected TypeScript integration materially improves stored-contract consumption, but the native install blocker and unfinished authoritative SQL/downstream review prevent approval. Resume from the remaining frozen diff and focused ownership boundary check only after root authorizes continuation.
