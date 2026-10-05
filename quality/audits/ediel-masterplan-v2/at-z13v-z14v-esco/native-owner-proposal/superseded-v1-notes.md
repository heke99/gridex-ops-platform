# Proposed existing-owner Z14 native proof

PROPOSAL ONLY. Native execution: NOT_RUN. Full typecheck, lint and native CI: NOT_RUN. No implementation claim, repository edit, PR, external comment, workflow/schema/validator change or new source authority.

Target: scripts/ediel-service-evidence-native.test.ts
Repository basis: 95d706a216623ae08dec0de53ebbe56eaaaa5449
Base file SHA256: a54442e1b89ac3e8ea7058ba6fab10b42114ff3630bb4e768d3fb9d95ca821ee
Base Git blob: 9435a5e2c9cc3d7477a5455068236ed3a669cda1
Candidate SHA256: e56c0a8cc22f476fa908244e3553b01ec716573bda0651634508739ce320410d
Patch SHA256: bc70a3ab315ff0272a960959db04e95143c1eb84e0fe455f20b37656150f951b
Patch: /tmp/gridex-z14-native-owner-proof.patch
Temporary candidate: /tmp/gridex-z14-native-owner-proof/scripts/ediel-service-evidence-native.test.ts
One target file; 84 added / 2 replaced lines; 116-line unified diff.

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

It records decision states/issues/application facet, validation receipt, capture outcome, consumer outcome and source hash. It exercises the actual protected consumer even if admission/capture holds. A returned non-applied result or actual PostgreSQL P0001 refusal is acceptable only alongside unchanged business state. Capture errors wrapped with a genuine P0001 cause are recorded; unrelated connection, parser, wrapper-shape and other errors propagate and fail. Owner must inspect the exact refusal messages; a recorded refusal is not a national-error-code claim. A fresh source must not be classified historical.

Snapshots compare full ordered rows, including:
- metering_permissions: status, market_state_version, source IDs, scope/metadata and remaining row fields;
- metering_permission_sites;
- permission_effect_receipts and permission_effect_transitions_v1 (legacy + current effects);
- ediel_data_access_grants;
- customer_supply_periods, supply_source_transitions, supply_object_effect_receipts, normal_supply_activations, customer_contracts and supplier_switch_requests.

New source rows, validation assessments/facets, rule-pack capture, permission_partition_receipts, and normal source/audit evidence are intentionally outside the zero-business-effect assertion. The proof does not falsely require zero all receipts/messages/events.

The normative malformed assertion requires the pending business snapshot unchanged, consumer.applied false and no applied manifest entry. It uses soft assertions to retain the snapshot and consumer observations on a real RED. It does not require a specific application rejection/ERC, negative APERAK or final ACK outcome.

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

