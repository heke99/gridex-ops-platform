# AT-Z14N-ESCO: unapplied observation request to the retained SC-021 owner

Reviewed 2026-10-05, checkout `b564db4c5832ad7477bd388a3c0bb3ef08e1353d`. This is a bounded source/interface review, not a test execution, claim, source change, coverage promotion, or approval of AT-Z14N-ESCO. Only this report was added. No new harness, fixture export, native stack, or CI attempt was created.

The simplest implementation is for the retained SC-021 writer to add the missing profile cases **inside the existing SC-021 suite**, retaining its private processing/PGlite port. That writer is Codex `/root/tr06_spec_review`, PR #552, merged revision `eacb6c7c`, claim `5305985947570`; root coordinator #503 retains the production source and intake chain. This request does not transfer either ownership. The suite bytes at current HEAD, merged `eacb6c7c`, and published #503 `5be3a902a61309e295d1f3b82f5ceb0996edb1dd` independently hash to the same `0375ff5a…` value below.

Skill routing: continuation of the previously read `spec-to-code-compliance`, `code-review`, and `verification-before-completion` instructions, with direct refutation of proposed false positives. This is one contract and its existing directly invoked interfaces; broader audits, native execution, new test generation, delegation, source remediation, and shared memory changes are outside the authorized scope.

## Full frozen contract and interpretation

`acceptance_tests.json:3304–3320` says:

> **Given:** ESCO; A13 aktivt nekat; A76 passivt nekat; många positiva-Z14-fält ska utelämnas. Förväxla inte negativt affärssvar med syntaktiskt fel.
>
> **When:** Aktivt eller passivt nekat tillstånd.
>
> **Expected:** 23-DGI-PRODAT; BGM=Z14; fält223=Z96; CONTRL och APERAK på själva Z14N om korrekt; ingen datarapportering.; Neka berörd begäran; lägg ingen market_permission för åtkomst.
>
> **Prohibited:** Fel roll, fel riktning, saknade R/D-fält, felaktig korrelation eller mutation ska inte verkställas.

It associates TEN-05, P-01, and ENV-06 and remains `Inte körd mot systemet` in that frozen register. `prodat_message_cases.json:633–648` explicitly identifies inbound PRODAT/Z14/N, Z96, ESCO, `23-DGI-PRODAT`, and the complete field/conditional/parent/register profile. The AT is not merely a durable denial-state check.

A13 and A76 are valid business denials. A correct negative business response may have positive syntax and processing acknowledgements. A malformed, unqualified, miscorrelated, or mutated source must not establish the denial effect; its technical acknowledgement or internal hold is a separate outcome. The contract does not prescribe an invented national ERC code for those faults.

## What the existing port actually exercises

All suite line references below refer to [the unchanged SC-021 suite](/workspace/gridex-sc010-sc071/__tests__/ediel-sc-021-denial-state-ack-effects.test.ts).

| Interface | Actual behavior and proof boundary |
|---|---|
| Processing and construction | `processInboundEdielMessage` is called at line 239. `explicitWire` at 172–180 uses the existing fixture parts, tokenizer, and production `EdifactEnvelopeCodec.encode`; real decision, domain/ACK construction, event, and outbox code run. |
| Original/current domain data | The private `Probe.db` is an actual PGlite database, acquired through the **existing** script hook at 182–204. `receive` inserts actual inbound/outbound original rows and the affected pending request, then reads actual SQL state at 230–246. |
| Permission mutation and receipt | The private RPC interception at 139–140 calls actual `public.ediel_apply_permission_source_v1`, under `service_role`, rather than returning a fixture-created denial. The script installs the entire current `20261001044351` migration at line 59. Its partition/executor/receipt functions and database mutations are real. |
| Canonical facets | Actual processing-produced validation/application/response facts are captured with their own source hashes into PGlite at 117–126. The persistence adapter and registry resolution are finite IO; it does not call the production database validation-recording RPC implementation. Do not handbuild accepted facets for fault cases. |
| Final response | The public current SQL reader is extracted and installed at 203–204. The composition script installs the actual committed-domain structural materializer at 39–42; the SQL committed-effect getter is real. Its original guide and national response witness interfaces are declared fixture IO. |
| ACK persistence | At 152–163 the finite RPC transport stores the **actual constructed draft** and returns its actual physical scopes. The ACK payload is real builder output. ACK database transaction durability, native grants/RLS, and SMTP are not exercised. |
| Other persistence/authority | The Supabase query adapter at 22–84 uses finite JS tables and records writes/RPCs. Role/configuration, communication permission, legal basis, provider-accepted original, and guide witnesses are finite boundaries. PGlite uses fixture SQL predicates for legal/application/provider authority. |
| Protected intake | `withProdatFixtureInsertContext` explicitly **models** a prospective protected INSERT context (`prodatInboundSourceFixture.ts:22–34`). The source-byte RPC at suite 134–137 only checks the source and truthy payload. The real new protected source-birth/admission path is not executed here. |

The generic `prodatFixtureSourceRpc` permission-apply branch at helper 106–110 intentionally returns `applied:false` with native effects out of scope. SC-021 avoids that branch through its private real-SQL interception. Copying only the generic helper would lose the central durable-effect witness.

## Whole-profile effect matrix

“Existing assertion” below means the assertion is present in the reviewed source; it does **not** mean a fresh execution happened in this review. Additions are requests, not promised results.

| Literal effect | Existing assertion/source witness | Minimum additive owner-controlled proof |
|---|---|---|
| ESCO; inbound valid Z14N; exact application/BGM/223 | ESCO role/settings are seeded at 217–218; valid encoded inbound Z14/Z96/`23-DGI-PRODAT` at 172–180. Accepted validation is asserted at 253. | Read actual decoded wire and accepted canonical profile for **both** A13/A76; assert actual app reference, BGM=Z14, own field 223=Z96, and local receiving role/direction. Construction constants alone are not the new AT assertion. |
| Positive-only fields absent without syntax rejection | Negative fixture at `prodat-energy-product.ts:6–15` omits installation 209, positive dates, product/purpose/frequency, permission ID, NAD IT/UD, while retaining negative reason/status and LI. Both existing cases assert accepted syntax/application. | Assert those actual omissions and keep complete valid controls. Do not classify omitted UD/IT or positive approval fields as a missing-required-field failure. |
| A13 denies the affected request | Suite 251–257 asserts `rejected_active`, source linkage, no approved interval/site, actual apply once; 267–270 binds the real receipt and final facet to the source/assessment. | Preserve these exact checks; strengthen the complete target row delta and untouched other request/site snapshots. |
| A76 denies the affected request | Same assertions, `rejected_passive_timeout`, actual SQL and own receipt. | Same complete delta/scope assertions, independently for A76. |
| Physical CONTRL on the Z14N | Suite 258 checks positive CONTRL family/outcome; finite outbox family is asserted at 271. | Reuse the already imported physical correlation reader for CONTRL; assert actual UCI/UNB reference equals the inbound Z14N interchange, positive classification, and own persisted ACK/outbox source linkage. The reader's CONTRL branch at `sourceCorrelation.ts:127–129` extracts UCI but does **not** compare it to `actualSource`; explicitly compare the actual source reference. |
| Physical APERAK on the Z14N | Suite 260–266 reads actual APERAK wire against the real source; positive own object with absent installation and exact LI; actual final response source/hash. 270–273 binds receipt and outbox pointer. | Retain these assertions and additionally check the physical BGM/ACW/source reference, source linkage, and exact target scope. No synthetic ERC42 to represent a valid A13/A76. |
| No market permission **for access** | Actual SQL denial status, zero approved sites, and null approved interval are asserted. SQL 133–148 only creates approved sites for A74 and clears approval fields for a denial. | Assert all approval dates/times, product/frequency, and access permission ID/reference are not newly granted; compare every relevant existing grant/permission row through the owner-confirmed authority surface. Ask #503 whether access authority here is the denied request/site state or also a distinct TEN grant sink. Do not create an empty placeholder table to claim that sink is unchanged. |
| No data reporting | Existing output assertions are exactly CONTRL+APERAK; four finite business tables are compared unchanged at 237–246. | Observe complete recorded calls/writes/output rows, not only expected ACKs; assert no reporting/export/data-message production and unchanged applicable real SQL/business rows. Identify any retained reporting sink with #503 before claiming durable absence there. |
| Wrong role refused | The existing suite has only the ESCO positive role; real apply SQL requires frozen ESCO legal basis at migration line 250. | Same valid wire/current source with a wrong local market role and coherent owner-controlled role/legal fixture facts. Assert no target/access/report effect and unchanged own/other business rows. Permission loss alone tests execution RBAC, not the wrong-market-role prohibition. |
| Wrong direction refused | Actual apply SQL line 234 refuses non-inbound/non-PRODAT sources. | Change the source direction only in the relevant declared input, keeping valid wire/correlation; observe real processing refusal and/or actual SQL refusal if reached. No business/access/report effect. Do not require positive APERAK for an invalid source. |
| Missing required/active-dependent field refused | Current controls prove valid omission of positive-only fields. They do not provide a missing-R or active-D fault. | Owner names the exact applicable R and active D cell/parent/register condition from the current retained profile, with a valid-present countercontrol, then removes only that actual wire field and re-encodes valid envelope counts. RFF LI or status is a concrete candidate **only after** owner confirms its profile obligation. No active D obligation has been established by this bounded read; do not relabel inactive N fields as D-required. If a D condition is inactive, assert that omission remains legal; use a genuine N context satisfying an active condition if one exists. |
| Wrong correlation refused | Valid flow links current physical LI to a sealed/sent outbound Z13 and the pending request. Actual SQL lines 93–101, 113, 261–266 guard actor/original/request scope. | Modify the actual inbound LI/original legal pairing or exact expected permission scope, leaving a valid envelope and unrelated requests untouched. Observe refusal/held scope and no business/access/report mutation. Do not target only the unrelated cached transaction reference or fabricate an application error. |
| Mutation refused | Existing script line 74 contains real source-byte tamper/replay and committed-effect hash-conflict checks; it is a source witness, not a fresh whole-AT execution. New birth immutability is a different retained interface. | Within the same suite, preserve valid control and captured facets/receipt; inject a scoped actual DB byte fault and assert the genuine replay/receipt guard, no new target/committed permission effect/accepted processing ACK/report mutation, and restoration in `finally`/rollback. A post-commit replay reaches production `permission_partition_replay_conflict` (migration 244) rather than a handbuilt denial. Request the separate protected-intake prerequisite and its owner evidence; mutable fixture tables do not prove production INSERT/UPDATE immutability. |

Two misleading absence assertions must be excluded. First, the real SQL deliberately stores denial provenance in `metering_permissions.metadata.marketPermission` (migration 149) and increments the state version. Second, its actual effect receipt has `effectKind:'metering_permission'`. Neither is an approved access grant. The permitted denial effect must remain present. Conversely, a default empty JS array or a nonexistent PGlite table is not an observation of a real TEN grant/report sink.

For profile faults, refuse the prohibited business/access/report effect. Preserve the owner-defined validation, audit, technical ACK, or held/rejected partition record where the real runtime legitimately produces one. Do not demand zero writes everywhere or confuse a held partition receipt with a committed permission grant. Assert the exact failure decision and unaffected business rows instead.

## Smallest private seam request

Keep `Probe`, `port`, `rpc`, `captureActualFacets`, the existing script hook, temporary-file lifecycle, and setup/cleanup inside their present owner-controlled file. Do not export them, copy them, or create another PGlite harness.

1. **Private wire/seed variation.** Let the owner add narrowly typed options to private `receive`, or split its private seed/process steps. Apply raw fixture-part variations before `withProdatFixtureInsertContext`, and use the existing codec to regenerate envelope counts. A wrong-role/legal/context fixture option can be applied after seed and before the pre-consumer snapshots. Preserve actual processing-produced facets.
2. **Private immutable observations.** Return cloned pre/post target, other-request/site, partition/effect-receipt rows, calls, writes, original rows, final reader output, ACKs and outbox entries from the existing helper. Use scoped IDs, plus untouched-row snapshots. The PGlite database persists across cases while the JS port resets; retain `caseNumber` uniqueness and do not erase other cases' rows.
3. **Scoped mutation/replay case.** Reuse the current real apply interception at 139–140 and, only if needed, a one-use owner-controlled fault callback there. Prefer the existing actual post-commit replay-hash guard for a SQL provenance assertion. Keep the deliberately damaged row and any SQL exception inside rollback/finally, followed by unchanged permission/site/receipt and output snapshots. Do not update canonical facts/hashes to make corrupted bytes appear accepted, and do not replace the apply RPC with a mocked `{applied:false}`.
4. **Same-suite additive cases.** Keep the two A13/A76 controls and guide-fault cases intact. Add profile-specific role, direction, required/active-dependent field, correlation and mutation cases to this same suite. An AT tag/coverage promotion is a later owned decision after the whole literal has actual green, independently reviewed behavior evidence; the present request supplies none.

The existing guide-negative cases at 275–287 are useful controls but do not stand in for those profile faults. They preserve the actual denial and hold only APERAK when the original guide is unavailable; they are not evidence that a wrong-role or malformed source was refused before a domain mutation.

## Exact request parent should send to retained #503

Ask #503 to route an **additive observation/case request to the original #552 Codex SC-021 writer**, or expressly delegate that one old test path. Do not ask for transfer of production intake, SQL, fixtures, renderer, shared schema/capture, or coverage. Request these concrete answers before implementation:

- Confirm the unchanged private SC-021 PGlite hook remains the intended whole processing/permission/ACK component port, and authorize same-file additive profile cases rather than a duplicated fixture or exported harness.
- Supply the exact current N-profile R and active-D obligations and their valid countercontexts. Confirm that positive-only installation, UD/IT, permission ID and approval fields remain legally absent for N. If no conditional obligation is active in the given N context, explicitly distinguish that inactive control from an active-D negative; do not invent a requirement.
- Name the authoritative access-grant and reporting observation surfaces for this consumer. Confirm which real SQL denial fields/sites and which recorded producer effects satisfy “no market_permission for access / no reporting”; if another retained sink participates, provide its minimal existing observer instead of an empty simulated table.
- Identify the owner/pin and genuine evidence for the **new protected inbound admission/source-birth prerequisite**. Confirm how the prospective context fixture is kept current without treating it as execution of that SQL path. Any intake prerequisite defect or required production modification remains with the retained owner.
- Agree on the fault timing and refusal oracle for mutation: actual original/canonical hash or partition replay conflict, exact scopes, no additional effects, and rollback/cleanup. Agree on role-vs-RBAC and wrong-direction dimensions without substituting permission-denied infrastructure failures for domain qualification.
- Retain separate declarations for real PGlite domain SQL, finite source/legal/registry/ACK persistence/SMTP boundaries, and any separately executed native evidence. Fresh proof must identify actual source hashes and assertions; no future green or whole-card approval is implied by this handoff.

**Verdict:** the existing suite is a viable noncompeting reuse point and already contains strong positive denial/physical APERAK/real SQL receipt assertions. Same-suite owner additions are simpler than a new fixture. The full AT cannot be inferred from the existing SC-021 tag or four case definitions: its profile-negative effects, physical CONTRL reference, exact access/report observations, and protected-intake attribution need the concrete owner responses and resulting executed assertions above. No production defect or future test result is classified by this read-only request.

## Exact reviewed byte pins

SHA-256 of current local files; paths are repository-relative to `/workspace/gridex-sc010-sc071`.

| File | SHA-256 |
|---|---|
| `__tests__/ediel-sc-021-denial-state-ack-effects.test.ts` | `0375ff5aa01b41b94b481100d1840332b15b92d20a9133daaea085989f0e965e` |
| `__tests__/fixtures/prodat-permission-ack.ts` | `7fba884dbaeceefb2cf56f3fc0475c14bae7afed0d1fe1b075ccf72ea6dc9ce7` |
| `__tests__/fixtures/prodat-energy-product.ts` | `cea6d2038dd33cdce19312d0227761229c7af3855964a63a389e2119a526adb0` |
| `__tests__/fixtures/prodat-register.ts` | `14ee8729c0a2c020182791f0ef8aab3a1f7c6936313c39f6fd7556887a4ecec2` |
| `__tests__/fixtures/prodat-identity.ts` | `d590eeb86518b472943b70b4a09bc29a7c376e2aadf52c52e40ad6e46121fe9c` |
| `__tests__/helpers/sourceOwnerFixtures.ts` | `bbe5f5f5b60976aa8eefedf0196557f6d5a13cdc58e49e859e7d7a6c763f8620` |
| `__tests__/helpers/prodatInboundSourceFixture.ts` | `d3511b00699147c05baf0ff725c8289ce541cf0819ea4c633f0b64a038ab3878` |
| `scripts/ediel-partial-permission-source-sql-regression.mjs` | `26660b53d3480c5b7b353a8e2e0f073c32ba344bff04b5dd84e1fa29f8b0066f` |
| `scripts/ediel-prodat-permission-final-response-composition.mjs` | `b3ea441613d0a73d8ba29c6708f12f1828e77980ed61817a3d9ccc4bd6bfe1a2` |
| `supabase/migrations/20261001044351_ediel_partial_permission_source_effects.sql` | `842cf2a8342f4164dd61e7d7ca2e2eb577b7cbb844e978c49be141ad5720a3af` |
| `supabase/migrations/20261001013700_ediel_prodat_structural_final_response_receipts.sql` | `b031039094620dad96db2a93295826468c8c877164bca1a05a81c57d2c19ee7b` |
| `supabase/migrations/20261001043602_ediel_committed_domain_prodat_final_responses.sql` | `8afd34ae3247b74970d80c28f246b4fb67a2e4301eb1ff4a55db06bbdc84e712` |
| `supabase/migrations/20260930144205_ediel_permission_source_atomic_transitions.sql` | `99b0d6fda03afe1ecb9a8b3814a18d3127e657f1aaa3fbfd76543da7473124fa` |
| `supabase/migrations/20261001010321_ediel_complete_prodat_own_application_facets.sql` | `839feb43b8b2f4bc2b9147e654a3150fe1ce3de3ade495b470a982132e4c5675` |
| `supabase/migrations/20261001034855_ediel_prodat_aperak_unused_document_fields.sql` | `39f17d689e9facffd7ff92e7aef75d8f74f690f164404f16b2768226e813a555` |
| `docs/ediel/masterplan-v2/registers/acceptance_tests.json` | `e9aa623c8b54fabaedca1096fe1516a29a11569b65ee6e95736c82748c541a10` |
| `docs/ediel/masterplan-v2/registers/prodat_message_cases.json` | `77c5023457d8e405d6a560b2d2515679c2d7b59bf968800f35c16070e5f8eeee` |
| `lib/ediel/ack/sourceCorrelation.ts` | `bb7802b824ee632e2244ac916fde0cd0282cdcb6f964b54a71d26b96af571653` |

Published-root carry qualification: parent independently compared all 18 listed local pins against #503 revision `c5afbda9519aa4d0db1ea3f339fddbb8f95f16f4` and reported all equal. This reviewer then repeated the bounded read-only Git-object SHA-256 comparison for those same 18 paths: all equal, zero mismatches. Thus this interface request also describes the published c5 source bytes; it does not assert execution on that revision or approval of its intake/capture/native gates.

Checks performed: bounded reads of the listed contract/suite/direct fixture and SQL interfaces; local SHA-256; read-only Git object comparison of the original/current/published suite and the 18 published c5 pins; report whitespace check. All behavioral test execution statuses in this request are **NOT_RUN**. Existing preserved execution receipts were not refreshed or promoted.
