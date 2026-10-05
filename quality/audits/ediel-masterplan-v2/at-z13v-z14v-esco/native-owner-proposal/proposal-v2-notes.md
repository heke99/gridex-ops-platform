# Proposed existing-owner Z14 native proof — revision 2

PROPOSAL ONLY. Native execution: NOT_RUN. Full typecheck, lint and native CI: NOT_RUN. No implementation claim, repository edit, PR, external comment, workflow/schema/validator change or new source authority.

Target: scripts/ediel-service-evidence-native.test.ts
Repository basis: 95d706a216623ae08dec0de53ebbe56eaaaa5449
Base file SHA256: a54442e1b89ac3e8ea7058ba6fab10b42114ff3630bb4e768d3fb9d95ca821ee
Base Git blob: 9435a5e2c9cc3d7477a5455068236ed3a669cda1
Candidate SHA256: b7f01003fdff96b28964c6c511b79b9c7d4b913e01c3d4b72fc33f1f0f035b8f
Patch SHA256: f9367af5dbaf5f83eb5c8c2266efad27121770426169eef2d2c825795ffc6238
Patch: /tmp/gridex-z14-native-owner-proof.patch
Temporary candidate: /tmp/gridex-z14-native-owner-proof/scripts/ediel-service-evidence-native.test.ts
One target file; 82 added / 2 replaced lines; 114-line unified diff.

Existing owner retains this native test and the exported shared fixture. This is a concrete suggested change for that owner to review/apply on their own current branch. The exported fixture, other owners' tests and the registered native configuration are untouched.

Minimal private-helper hook

The existing private qualify() receives an optional fourth argument:
- beforeEncode(segments,permissionId) runs after an actual fresh V assignment/request_access, queued+provider-accepted Z13 and exact pending permission lookup, before encoding/inserting/admitting the first Z14.
- onReceived({permissionId,z13,z14,decision}) receives the actual newly inserted source and genuine resolveCanonicalRuntimeDecisionWithRegistry result. When present, qualify() awaits this callback and returns BEFORE existing create_grant/publish_grant.
- Existing callers and the normal positive qualify path retain the original strict accepted/recorded/applied checks and grant publication. Overloads preserve their original grant-bearing return type.
- A hook with shared permission is rejected before archive/request work, preventing reuse of an already approved shared source.

Three independent new native cases

Each it.each case calls seed('V') and the existing archive/separate-review/approval/request/send chain independently. No positive qualify call precedes a malformed case.

1. baseline: unchanged body; ordinary qualify() positively applies the source and explicitly creates/publishes its grant. Snapshot occurs while permission is pending. Checks active status, exactly one market-state-version increment, one approved site/effect/transition and active grant; supply state remains unchanged.
2. missing222: existing tokenizer identifies exactly one CCI++Z12 followed by CAV+:::D and removes only that pair.
3. missing326: identifies exactly one DTM+693 and removes only that segment.

The unchanged EdifactEnvelopeCodec.encode generates the envelope/UNT from the mutated business segments. After insertion the malformed cases verify the actual stored raw source has the intended field absent, the other retained and a correct physical UNT count. Its payload SHA256 is included in the observation.

Genuine admission and consumer

The malformed observer calls the existing recordReceivedSourceValidation, captureFreshEdielSourceRulePackEvidence and applyPermissionMarketSource APIs with the real registry decision/new source/exact pending permission. No APP facet, receipt, private owner token or authority is manufactured.

It requires the genuine validation receipt status recorded, then a successful fresh capture with status captured. Unconfirmed validation, historical capture and every exception (including P0001) fail. The current capture source guards concern identity/profile/committed witness, rather than a qualified missing222/326 refusal; none may be treated as a passing field hold. Only a returned non-applied application refusal qualified below is acceptable alongside unchanged business state. The actual protected consumer is called with the recorded real decision, including a genuinely recorded rejected/held application decision. The observer logs decision states/issues/facet, validation, capture, consumer and source hash. It makes no national-error-code claim.

Snapshots compare full ordered rows, including:
- metering_permissions: status, market_state_version, source IDs, scope/metadata and remaining row fields;
- metering_permission_sites;
- permission_effect_receipts and permission_effect_transitions_v1 (legacy + current effects);
- ediel_data_access_grants;
- customer_supply_periods, supply_source_transitions, supply_object_effect_receipts, normal_supply_activations, customer_contracts and supplier_switch_requests.

New source rows, validation assessments/facets, rule-pack capture, permission_partition_receipts, and normal source/audit evidence are intentionally outside the zero-business-effect assertion. The proof does not falsely require zero all receipts/messages/events.

The normative malformed assertion requires the pending business snapshot unchanged, consumer.applied false, no applied manifest entry and a source-qualified structured refusal reason. It uses soft assertions to retain the snapshot and consumer observations on a real RED. It does not require a specific application rejection/ERC, negative APERAK or final ACK outcome.

Checks completed without native execution

- Python generation pins the exact base SHA and emits the diff from a temporary copy.
- git apply --check /tmp/gridex-z14-native-owner-proof.patch: PASS; read-only applicability check, not applied.
- TypeScript createSourceFile + transpileModule: zero parse/transpile diagnostics.
- node --check on the temporary emitted ES module: PASS; module not executed.
- Base repository source SHA unchanged after these operations.

Limits and owner continuation

No native pass is claimed. No test module, native config, source consumer, database, SMTP call or CI job was executed. Parse/transpile checks do not establish full type correctness or SQL/query behavior.

The qualified P26.A r3 original establishes white D-except-N for 222/326; this proposed test uses positive V/S17/A74. It may expose a real RED if current admitted source application still produces forbidden effects. Do not relax that oracle or mark PASSED from the pure canonical observation.

This small matrix covers fresh V first-response business effects. It does not cover VH, already-established response replay, foreign-tenant sentinels, all forbidden-role/correlation inputs, storage/projection execution or a genuine Z14 CONTRL/APERAK send. The existing positive baseline deliberately retains normal grant publication; malformed callbacks never create or publish a grant. The owner can subsequently extend their current source/ACK chain if whole-profile acceptance requires it, without a duplicate harness.

The historical selected native33 receipt remains pinned to its original head. Four production-source files subsequently changed; therefore this proposal and the current source owner require current-head native CI under the existing registered source-owner suite. An earlier native receipt cannot promote this proposal. Existing legal/issuer/registry inputs and SMTP substitution remain explicitly synthetic; no external market admission is claimed.


Revision 2 guard classification and superseded review

The independent source reviewer found that v1 allowed any P0001 after an unconfirmed ledger result, so a broken ledger could falsely pass unchanged snapshots. The v1 patch, notes, candidate, generator and exact requests-changes message are preserved under /tmp/gridex-z14-native-owner-proof-superseded-v1/. Do not apply v1. Revision 2 is submitted for re-review, with no approval or execution claim.

The allowed exception set is EMPTY. Every thrown capture or consumer P0001 fails. Relevant actual source reads:
- lib/ediel/core/receivedSourceValidationLedger.ts49–57: catches/mismatch become unconfirmed; the proposal now requires recorded before proceeding.
- supabase/migrations/20260930203322_ediel_z08_same_observed_stockholm_guide_date.sql170–181: current inbound capture requires committed named assessment/profile/pack; generic ediel_source_rule_pack_basis_required can signal unrelated broken custody and is not accepted.
- supabase/migrations/20261001010321_ediel_complete_prodat_own_application_facets.sql61–73: prodat_application_original_owner_unavailable / rule-witness mismatch are custody/facet failures and are not accepted as field refusals.
- supabase/migrations/20261001044351_ediel_partial_permission_source_effects.sql253: permission_own_application_and_global_function_required is allowed only when the actual recorded application header is non-accepted or the actual functional decision is non-accepted.
- Same current executor260–266: expected_permission_source_scope_unavailable is allowed only when the actual recorded application header/object is non-accepted. This excludes an all-accepted source that fails independent original discovery for unrelated reasons.

No other structured return reason is silently accepted. permission_no_qualified_object and permission_approved_object_evidence_invalid are not accepted by this revision: the inspected current business guard does not independently check missing222/326, so treating those broad reasons as an intended field rejection would require new exact source qualification. If the owner introduces or encounters a separately qualified intentional admission hold, they must review its real source and add that narrow case explicitly; an unconfirmed receipt or unknown P0001 cannot establish this proof.

The classifier demands a source-qualified application hold, not a guessed ERC or a mandatory negative national ACK. Captured/recorded real rejected or held application decisions remain supported. Full business-state preservation and absence of applied manifest entries remain necessary; refusal labels alone never prove zero effects.
