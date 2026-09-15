# Tenant, legal actor, ESCO grants and UTILTS decision reuse

Evidence base: current checkout `b9f732d2` (PR310 ancestry), 2026-09-15. Main was not substituted. Scope: uploaded `Gridex_Ediel_Mastermasterplan_v2_2026-09-10(1).md`, sections 1, 3, 5, 13. This is a bounded workstream, not complete tenant/RLS certification.

## Routing and boundaries

Read AGENTS, memory README/current-state/checkpoint, tenancy-and-rls, integrations, decisions and known-failures. Applied spec-to-code comparison, full caller/callee tracing, false-positive checks and verification-before-completion. Read using-superpowers (subagent exemption), acquire-codebase-knowledge (no seven-document rewrite during bounded audit), spec-to-code-compliance and fp-check; TDD applied after parent authorized the confirmed bounded fix. No source changes occurred before finding evidence and authorization. No shared memory, migrations, production state or Supabase writes. Full database replay, deployed permissions and actual external contracts remain outside this offline pass. UI, performance, hook installation, supply-chain changes and deployment have no trigger in this bounded change.

## Confirmed defect C-01 — inconsistent UTILTS guide decisions

Severity: high protocol correctness; confirmed before remediation by executed tests. Requirements: §3.3–3.4, CALL-01/CALL-02: selected guide decision must survive execution without local reselection.

Original execution path:

1. `flows/inboundProcessing.ts` resolves tenant before `applyCanonicalRuntimeDecision` and persists its report.
2. `core/runtimeDecision.ts` original `canonicalBusinessDate` selected DTM137, then received timestamp, then created timestamp, then current date; its canonical policy used that date.
3. Its `resolveUtiltsDecision` called `runUtiltsRuntimeForMessage(message)` without the selected policy/date. `utiltsEngine.ts` selected received timestamp or current date instead.
4. The UTILTS dispatcher independently selected received/created date. The actual metering processor (`flows/utiltsDataRequest.part-2.ts`) called runtime once before matching and once after matching, neither with the selected policy. Non-billing dispatch passed its independently selected date.
5. Other low-level callers (decision engine, admin preview/import and ACK testing) also used the wrapper default, so threading only the main path would leave inconsistent defaults.

Reproduction: valid structured E66 fixture with QTY220 readings 10000/11000 but QTY136 energy 500. DTM137 September 30 and receipt October 1 gave a September policy but removed E19; inverse dates gave October policy while retaining E19. The original three focused tests failed: both opposite cutoff cases and dropped policy at dispatch. No database involved.

Remediation implemented:

- Extract the existing date/policy authority unchanged into `core/messagePolicy.ts`; canonical runtime and standalone wrapper now share one date selection algorithm.
- Pass the actual `CanonicalEdielPolicy` through inbound dispatch, actual processing before/after tenant matching and the non-billing branch.
- Consume `policy.utiltsProcessability` directly, with a local blocker for incomplete or mismatched supplied policy; do not derive another processability profile from the clock.
- Preserve explicit low-level `referenceDate` options and preview operation without complete tenant metadata. Those preview defaults use the shared date helper; a preview is not a tenant authorization or an operational execution decision.

Temporal limitation: the existing DTM137-first selection is preserved as repository authority, not newly certified as the legally correct time anchor for every guide/replay case. Source-backed refinement of temporal anchors remains separate. This patch does not implement immutable persisted decision IDs/hashes or process state-version checks.

## Partial requirement C-02 — three-layer cross-tenant ESCO model is not implemented

Requirements: §5.1–5.6, ST-G01/02/03, proposed service_assignment/data_access_grant model. The checked production surface has tenant-owned `metering_permissions`/`metering_permission_sites`, not a provider market permission plus explicit beneficiary assignment plus object/product/period/field/purpose grant distribution pipeline.

Search evidence: case-insensitive `beneficiar|service.assignment|data.access.grant` over `lib`, `app`, `supabase/migrations`, `types` returned no matches. Exact proposed names also had no production matches. Relevant existing path was traced rather than relying solely on absence searches:

- `flows/utiltsDataRequest.part-2.ts` invokes `findActiveMeteringPermissionForUtiltsMessage` only without a matched data request; returned permission can feed tenant customer/site linking and `maybeIngestMeteringValue`.
- `lib/onboarding/inboundEdielLinking.ts:585` resolves permissions within `company_id`; facility matching queries approved/active sites, chooses the first joined permission in accepted statuses; fallback matches case reference, metering point or metadata grid-area/facility. It has no explicit provider/beneficiary distinction or grant version.
- `flows/utiltsDataRequest.part-1.ts` transaction and metering matching require company ID and resolve metering/customer objects inside that tenant.

Verdict: confirmed missing support for the specified cross-tenant service/grant capability. It is not evidence that the current system exposes one tenant's data to another. No legal mandate, retention rule, provider actor or beneficiary can be invented from this code audit. Do not enable this capability merely by adding a tenant relationship. A separate design/schema/permission implementation requires the concrete G04 evidence and should preserve owner-only raw receipts and single market ACK semantics.

Potential additional weakness, not classified as an independently proven authorization vulnerability: the existing permission lookup does not compare requested data interval or legal DSO/ESCO actor against the candidate before returning it; the inspected source alone does not establish an exploitable bypass through all DB and ingestion controls. Tests must cover expired/partially bounded permission and wrong DSO/actor before proposing a correction.

## Refuted / bounded concerns

- No `company_id` on the pure protocol policy is not itself a leak. Main inbound processing resolves tenant and stops ambiguous/not-found routing before runtime/business processing (`inboundProcessing.ts` around 789–810).
- `createEdielExecutionContext` has no production callers and validates shape rather than authority, but this does not mean routing is unguarded. `flows/routeDecisionContext.ts` obtains company/customer/object-scoped `resolveEdielRoute`, rejects blocking reasons, requires active route and sender/receiver IDs, and calls canonical outbound context. The proposed comprehensive execution contract remains partial.
- Multiple tenant candidates are not silently reduced to arbitrary `limit(1)` in the inspected inbound tenant resolution. `core/tenantResolver.ts` explicitly emits tenant_ambiguous. The distinct, intentional multi-beneficiary grant fan-out capability remains absent.
- The existing E66 permission matcher does not require an invented beneficiary ID or internal permission UUID on wire: it uses facility/metering/case correlation. Do not add such wire fields as a shortcut.
- Pretenant UTILTS uses a non-persisted object sentinel solely to avoid claiming an unknown object against an unidentified tenant. Existing targeted tests prove unknown-object rejection returns once company is known; the sentinel is not a persisted business entitlement.

## Verification

- Initial `vitest run __tests__/ediel-utilts-decision-reuse.test.ts`: 3/3 failed for expected cutoff mismatch and dropped decision.
- Additional incomplete-retained-policy test: failed before guard, passed after guard.
- Additional direct-runtime defaults: 2 failed before shared helper, passed after extraction.
- `node_modules/.bin/vitest run __tests__/ediel-utilts*.test.ts __tests__/ediel-canonical-policy-batch-regression.test.ts __tests__/ediel-canonical-runtime-closure.test.ts __tests__/utilts-aperak-contrl-central-engine.test.ts`: 13 files, 70 tests passed at 19:25 UTC.
- Processor tests assert the exact same policy object before/after tenant matching and at non-billing dispatch; mock stop occurs before persistence, so no external writes.
- `node_modules/.bin/tsc --noEmit -p tsconfig.app.json --incremental false`: exit 0, zero diagnostics after final shared-helper extraction. Parent aggregate final-head checks remain separate.
- Tests TypeScript initially reported only sibling `ediel-masterplan-protocol-regression.test.ts` TS2352 casts; informed parent for independent owner repair. This is not recorded as a full tests-typecheck pass.
- `git diff --check` passed after final helper extraction; parent aggregate final-head gate remains separate.

## Remaining PR boundaries

This patch is the independently reviewable C-01 remediation. C-02 needs a separate explicit provider/service/grant implementation and adversarial tenant/period/field/revoke/cache/export tests. Neither current draft grants, live RLS nor full PR310 native replay acceptance is established by these unit tests. No commit or memory update performed by this workstream.
