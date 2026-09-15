# PR310 schema comparison merge gate — 2026-09-15

Status: BLOCKED. The inherited comparison run did not produce a schema difference. It failed inside removed-policy qualification before catalog comparison. No schema acceptance or merge readiness is established.

## Scope and skill routing

Read AGENTS.md, memory README/current-state/checkpoint/database domain, decision/failure searches, current diff and relevant implementation. Applied systematic-debugging, verification-before-completion and Supabase guidance. using-superpowers explicitly excludes dispatched subagents. The fp-check trigger is absent: this is a CI diagnostic, not a claimed security vulnerability; direct log/source verification supplies the finding boundary. Applied test-driven-development for the diagnostic-only repair described below. No schema, auth, UI, dependency, deployment or production changes are part of this bounded diagnostic, so their implementation/security/performance skill groups do not activate. Parent owns shared memory and publication.

## Actual execution evidence

Repository: heke99/gridex-ops-platform. Run 34989327838, job 104449553330, PR310 source head b9f732d28ceaf090e3b984e71d13a9cbd27f6408.

- GitHub connector returned the decoded actual job log and artifact metadata.
- Timestamp 514 completes at 15:37:57 UTC. All six forward sources and repeats complete; policy actor qualification returns SQLSTATE 00000 at 15:39:12.
- The last query, `removed_policy_metadata`, returns SQLSTATE 00000, exit 0, at 15:39:19.982 UTC.
- At 15:39:20 the owned controller emits `fixed_failure`, state `INTAKE_COMPLETE`, cause `VALUE_ERROR`, privacy `VERIFIED`, disposal `VERIFIED`.
- The following transport summary is `REQUEST_REJECTED`, type `ValueError`.
- Final comparison report: `outcome=BLOCKED`, `phase=ACTUAL_OWNED_SHELL`, `errorType=BoundaryError`, `counts={}`, `ordinaryReplaySucceeded=false`, `schemaAccepted=false`, `productionModified=false`, `referenceRestored=true`, `referenceDisposed=true`.
- Reference document SHA256: e404dd6b8493da3332e15fde7622ef22098157d7933d98c0bc0d3992e3818106. Immutable snapshot source SHA256: b46b90d7ff066d71964c9157044ac70b31b47cab114cfcbce5d270751012dd30.
- Workflow-owned container cleanup subsequently passes.
- Artifact 10405710258, `gridex-full-schema-reference-diff`, size 630 bytes, advertised ZIP SHA256 3c1f4ed87170413821e31eb2ed570c2f59e163a1fda8b8a4269957577012adb5. The connector returned a download reference; retrieving that URL in this environment returned HTTP403. Archive bytes were therefore not locally inspected or hash-verified. The same report fields above were read directly in the decoded job log.

Job: https://github.com/heke99/gridex-ops-platform/actions/runs/34989327838/job/104449553330

## Failure boundary and limits

`canonical_removed_policy_qualification.execute` reads JSON metadata, calls `validate_metadata`, proves fixed register replacements and composes applicable live policies, then performs post-proof state snapshots. No subsequent snapshot query appears in the log. The rejection is bounded to metadata decoding/validation or formula composition after the successful metadata query and before post-proof state preservation.

The exact rejected invariant is UNVERIFIED. `canonical-user-rbac-dedupe-batch._failure_category` intentionally reduces all ordinary ValueError messages to `VALUE_ERROR`; raw policy expressions, helpers and catalog data are correctly not printed. More than one metadata/composition check can raise ValueError. Assigning this run to a policy hash, role, ACL, routine or formula rule would be speculation.

This is distinct from the older known open schema differences: the current comparison has no diff counts and never reaches `compare`. It also differs from the previous private-artifact rejection: this run explicitly verifies privacy and gets through the new metadata SQL transport.

No repair to the reference, historical migrations, validation rules, grants, policy inventory or generated types is justified by these logs. Before the diagnostic-only working-tree patch below, source files in this path were unchanged between inherited b9f732d2 and inspected HEAD.

## Targeted verification executed

| Command | Result |
| --- | --- |
| `python3 -B scripts/test_canonical_removed_policy_qualification.py` | PASS, 8 tests after the diagnostic patch |
| `python3 -B scripts/test_canonical_removed_policy_formulas.py` | PASS, 9 tests |
| `python3 -B scripts/canonical-full-schema-reference-selftest.py` | PASS, 25 tests |
| Direct retained-input admission and expected-policy/routine construction | PASS, 267 expected policies, 12 routines |
| Direct retained register formula proof | PASS, 57 full rows and 75 components |

These offline tests are not live metadata acceptance or native replay evidence. PostgreSQL/Docker executables were not available locally for reproducing the complete owned SQL target.

## Next required evidence

The diagnostic patch now wraps the unchanged qualification execution with a fixed allowlist of invariant names. It emits only `stage=removed_policy_failure` and the exact admitted constant, otherwise `UNCLASSIFIED`, and reraises the original exception. It never renders arbitrary values, accepts prefix matches or alters receipts/SQL. Regression first failed on the absent diagnostic implementation, then passed; it checks exact errors, extra arguments, prefixed private payloads, JSON errors, hostile objects, subclasses, successful return/no-output and a real preservation rejection. Rerun the actual owned PR310 comparison to identify the failed category, then investigate the exact source-backed mismatch before any behavioral change. Preserve independent reference, all source hashes, six-forward receipts, privacy/disposal and schema acceptance gates. Native ledger, genuine generated application types and final-head CI remain separately required.

## Independent review of parent frontier fixture correction

ACCEPT: `canonical-timestamp-frontier-selftest.py` changes current inventory 605→607, timestamp inputs 518→520 and explicitly requires six forwards. This matches the existing `canonical_forward_sources.py` immutable inventory partition (601 historical plus six exact forwards) and timestamp partition (514 historical plus six exact forwards). Historical source length/hash checks, disjointness and ordered partition equality remain intact; this changes a stale fixture expectation, not replay admission or schema acceptance. Fresh `python3 -B scripts/canonical-timestamp-frontier-selftest.py`: PASS, 16 tests.

## Actual diagnostic rerun at 18494974

Run 34998326163, job 104480142628, on published head 1849497413325385b080e33f2bbfffd4073f488f completes 144 foundations, 514 timestamps, all six forwards/repeats and real policy actor qualification. At 2026-09-15 17:03:29 UTC, the metadata SQL succeeds and the new diagnostic reports `REMOVED_POLICY_EXACT_POLICY_SET_REQUIRED`. The exact policy inventory/hash admission fails before relation, principal, ACL, helper and live formula validation. Privacy, disposal and workflow cleanup pass. Independent reference remains restored/disposed with the same hashes; report is still BLOCKED with empty counts and schemaAccepted=false.

Artifact 10409225320, 630 bytes; job log advertises ZIP SHA256 d41b680a65e7239fe320ab185ba03dc27b8bc293f1973d09944b9fe51c8c2d41. This is log evidence, not a locally hash-verified archive.

Job: https://github.com/heke99/gridex-ops-platform/actions/runs/34998326163/job/104480142628

The exact changed/missing/extra policy remains UNVERIFIED: this run narrows the invariant but does not expose actual policy rows or hashes. The 267-member expected inventory and its source-pinned hashes were not changed. There is insufficient evidence to distinguish a missing/extra policy from an expression/hash serialization mismatch.

The next diagnostic-only patch records finite expected/actual/row/missing/extra/changed counts, one-based positions in the sorted retained expected inventory, validated actual SHA256 values for changed positions, and the expected-set SHA256. It emits no raw identities, expressions or unknown names. Expected-set SHA256 is d22964bce2efc5666f574644ae5e3a1fe4d8ec268fcf523f786fa7c75a478217. The original exact-map and row-count rejection remains, including duplicate rows. New regression failed before implementation on missing diagnostic arguments, then qualification tests passed (9 tests). Formula tests passed (9 tests). This patch needs another actual owned run; it is not a schema repair or acceptance.

## Actual 01ee1d55 policy difference and deparser correction

Run 34999483634/job 104484026625, source 01ee1d55e515dea336531a3f8820bdf9eafebaf0, reaches all 144+514+6 and actors, then at 17:15:10 UTC reports exactly 267 policy rows and 267 unique identities, zero missing and zero extra identities, and 29 changed hashes. Expected-set SHA remains d22964bce2efc5666f574644ae5e3a1fe4d8ec268fcf523f786fa7c75a478217. Changed positions map to the unchanged sorted expected inventory:

| Positions | Relation | Changed policies |
| --- | --- | --- |
| 12–19 | auth_email_events | 8 compiled policies |
| 46–52 | company_invitations | 7 compiled policies |
| 118–124 | customer_info_request_events | 7 compiled policies |
| 211–217 | metering_permissions | 7 compiled policies |

The actual schema report remains BLOCKED, counts empty, schemaAccepted=false; privacy/disposal and cleanup pass. Artifact 10409546403 is 630 bytes, advertised ZIP SHA256 b9f2c6cb49f3b991f910e9850397575cfa37c6f891099163b496c45e619200b4 (log evidence, no local archive hash claim).

Job: https://github.com/heke99/gridex-ops-platform/actions/runs/34999483634/job/104484026625

Confirmed harness defect: the removed-policy metadata SQL explicitly includes `auth` in its local search path. That changes the textual decompilation of an existing `auth.role()` call to `role()` in `pg_get_expr`, while the retained hashes bind the qualified spelling. This is a catalog presentation-context mismatch, not evidence of changed authorization predicates. PostgreSQL documents `pg_get_expr` as decompilation rather than original source text and describes schema visibility through the search path: https://www.postgresql.org/docs/17/functions-info.html . Supabase changelog fetch was attempted but its markdown content type was rejected by the web reader; no Supabase feature/API change is involved.

Direct evidence: the retained register includes five complete policy rows in the affected set. Altering only `auth.role()` to `role()` in their expression strings reproduces all five actual hashes exactly:

| Retained policy | Actual unqualified SHA256 |
| --- | --- |
| customer_info_request_events / gridex_mp_5aede207f5fa533f44df | adf46e3835fe29670314b6fe0cb48eb434f5afca77409f853d937978a970730d |
| customer_info_request_events / gridex_mp_73114b6f8226a07cb343 | 84af7d68ace0a292857af0161e1d9659fe0fdce91ec19bef483ccce8255d8d8c |
| customer_info_request_events / gridex_mp_f625bcbc0cffb824de0e | a9df72bf92fa6caae6b1c7e4b602170f5fd5426380190432488ce1f0049387dd |
| metering_permissions / gridex_mp_2ec74ad3e1b0cd7abfb6 | 3c08b913127554c1323c673e87621a87b030094de8d997601a7e8f038253e246 |
| metering_permissions / gridex_mp_59ebea0afaa910af537c | 08b92e39d63ed8f7bb9a7c3a1bdade3264cf51c14fbae2abbd6e721a1681ce88 |

The correction removes only `auth` from this metadata witness's local search path, retaining public/extensions/pg_catalog, read-only transaction and all queried objects/expressions. Its SQL witness binding changes to affa046451bc7aded834cbe37f2457e69f613e5746dbca32472ccf84c07a7138. All 267 expected policy identities/hashes, register hash, immutable schema reference and migration sources stay unchanged. No expression normalization or new accepted hash is introduced. The remaining 24 individual decompilations and full corrected gate require the actual rerun; they are not inferred accepted from the five reproductions.

Regression first reproduced all five hashes and failed on the original witness's auth-visible search path, then passed after correction. Qualification suite: PASS, 10 tests; formula suite: PASS, 9 tests. Reference/disclosure suite: PASS, 25 tests. The regression also pins the unchanged complete expected-set digest.

Parent-authorized workflow extension allows push runs only for the existing closed Ediel continuation branch `codex/ediel-masterplan-v2-alignment-20260915`, with the identical narrow path filter. Same-repository PR310 admission remains; checkout uses the corresponding PR head or push SHA, concurrency separates the branch from PR310, and permissions/owned cleanup/privacy are unchanged. YAML parse, exact branch, identical path filter and contents-read permission checks pass. This enables owned qualification without canceling the long native PR310 run.

Independent parent residual-source-admission fixture review: ACCEPT. The changes 605→607, 518→520, 593→595 and four→six align the existing exact six-forward partition; 601 historical inventory, 514 historical timestamps, original source hash checks and false SQL/type acceptance flags remain. Fresh `python3 -B scripts/canonical-residual-source-admission-selftest.py`: PASS, 20 tests.

## Actual corrected 5c1cda15 execution and next acceptance work

The push workflow runs on the intended continuation branch: run 35000914409/job 104488827297, source 5c1cda15bd0516d1b2741dfdd2ffe22548757219. At 17:28 UTC the corrected metadata query passes all 267 exact policy hashes and all following relation/role/ACL/helper checks. Removed-policy qualification is now actually verified: 23 relations, 59 removed-source/replacement dispositions, 57 reconstructed replacement rows, 75 formula components, 55 live policy compositions, six retained helpers and six canonical RPC metadata definitions. Catalog/rows are preserved; this does not execute the RPC business graph. Composition proof SHA256 is 2b351e796b41fd826d1883aa032ea765e8118eaaa67e32e237c25ad55e5702a8; policy context SHA256 is 1dcf7ce1476b66b73426eab3839706d3fc7ff43e773d131e6b2657bf2a3785b0. All 2496 existing actor cases and all 31 added-view source witnesses pass.

This resolves the deparser defect for the entire exact 267-policy inventory, including the 24 rows beyond the original five-row reproduction. No additional policy hash acceptance change was required.

The next actual failure is the original shell fingerprint gate, after its 18/18 required checks pass: expected c70fa2f017f6ce3af3ff806d948f18b58a3c196e4bf94daa9304629a3926680c versus observed 4943bbb82ced391cf915761bbb9bf14c3b1b70570a4a67922053542782de1598. The independent full diff is now `collectionOutcome=COLLECTED`, rather than an unavailable comparison. Original sources/privacy/disposal/workflow cleanup are verified. Replay document SHA256 edfc8460af0916329f7ce0c8a36865a0f6dbe471e770d4c12560cdbf070fbc3c. Ordinary replay success, schema acceptance, native ledger acceptance and generated-type acceptance remain false.

Artifact 10409837321: 275594 bytes, advertised ZIP SHA256 553fe0249f2645c3312d2a676b1b76ca85a1c7caf6dfe8f21b8af629c09d64f6. Actual decoded log/report inspected; archive bytes not independently hash-verified locally.

Job: https://github.com/heke99/gridex-ops-platform/actions/runs/35000914409/job/104488827297

| Section | Added | Changed | Removed |
| --- | ---: | ---: | ---: |
| columns | 937 | 741 | 0 |
| constraints | 211 | 6 | 9 |
| functions | 34 | 2 | 0 |
| function grants | 110 | 0 | 3 |
| indexes | 451 | 5 | 51 |
| policies | 486 | 128 | 59 |
| relation grants | 1435 | 0 | 31 |
| relations | 62 | 5 | 0 |
| schema grants | 3 | 0 | 2 |
| triggers | 76 | 0 | 0 |

Enums/extensions have no difference. These counts describe source differences; they are not a blanket acceptance list. The 1296-row older coverage register binds four-forward artifact 10399581944 and explicitly says REVIEW_COVERAGE_NOT_ACCEPTANCE_ALLOWLIST. Its static open labels cannot substitute for the new actual receipts, nor may the receipts silently certify unrelated business behavior.

Concrete remaining work, ranked by direct source/caller incompatibility:

1. **Promote the already-qualified auth action correction.** Actual run 34989327890/job 104449552975 succeeds, proving four new source values fail under seven and all eleven succeed after correction, invalid/NULL/client failures, exact CHECK-only delta, repeat/rollback/cleanup. CLI creates `20260915153449_expand_auth_email_event_action_domain.sql`; candidate SHA256 69b8d5693f586209f37950be866e3f3dd8e5d910408c34ed9cb075daab85407c. This closes the documented active `email_action_verified`, `company_invitation_accepted`, `direct_user_created` 23514 incompatibility. The audit's pending-PG17 statement is superseded by this actual log. Artifact 10405440333, advertised ZIP ed80a2cf6182e454c1a96dd0df7bf18a2e538f274762da954c0285eaa776439d. Required next code is exact forward registration plus full native/portable postcondition and repeat proofs; the seven-value historical source remains immutable.
2. **Promote the already-qualified access capability correction.** Actual run 34989327870/job 104449552806 succeeds through PG17 qualification and genuine CLI identity `20260915153458_restrict_access_table_capabilities.sql`, candidate SHA256 ddee41e3266948eef7f9082b331f873823602266448efe7cabcb03fdb3566683. This removes eight authenticated administrative capabilities from company_invitations/user_roles while retaining SELECT, I/U/D denial and canonical service RPCs. These are reference-inherited excess grants, so exact reference matching would not fix the source-contract bypass. Artifact 10405310862, advertised ZIP ca956c058256976b021e1390882b5795eb51f36969945f34f333537d3df9288e. Require exact promotion and full-target catalog/row/role preservation; do not merely refresh the schema.
3. **Execute the five changed-view source witnesses.** `PR310_CHANGED_VIEW_DISPOSITIONS_2026-09-15.json` already contains five full pinned queries and source/caller decisions. No changed-view execution module/wiring was found under scripts/. Add the exact source-query temporary-view/rollback witness protocol used for 31 additions, with historical SELECT-star expansion frozen from pinned sources. This closes missing actual evidence for canonical_internal_contract_offers_v, customer_contract_lifecycle_readiness_v, ediel_active_actor_settings_v, ediel_unresolved_messages and platform_go_live_readiness_v without accepting arbitrary runtime view text. Retain exact relation options, named outputs, service-only grants and the source-authored active-actor ranking semantic difference.
4. **Finish function behavior rather than reverting source differences.** The two changed rows are source-backed: canonical_company_capability_enabled retains predicates with later search_path; gridex_can deliberately delegates to gridex_has_permission. Preserve those definitions and qualify their actual current evaluator semantics, including the separately tracked permission-override gap. The 34-added-function audit reconstructs all rows and 110 grants but explicitly leaves current-user role projection isolation, trigger parent/error rollback and service numbering/event/readiness execution unverified. Six helper and six RPC metadata receipts above do not certify those entire graphs.
5. **Keep other category boundaries explicit.** The 937 added-column rows/62 relation dispositions and fourteen column-attribute differences have source-backed preservation decisions. The 31 added views now have actual witness evidence; this does not prove all new base-table tenant behavior. The 76 trigger attachments and added/removed indexes/constraints retain independent behavior requirements. The seventh parent-delete correction is being promoted by a separate owner. The portable invariant owner separately observed F14 count24 and is identifying exact inert-policy identities; the current schema report does not expose their row mapping, so no policy removal is justified from a count alone.

The removed-policy forward-admission helper now requires exactly seven source receipts: the unchanged five originals, unchanged sixth send-lock source, and the root-authorized seventh `20260915172543_preserve_retained_customer_history_on_delete.sql`, SHA256 00f8a844fc5c72274d697558d57f216acf56388b6d36f6aad6063ca255283734. It reports `fullSevenForwardReceiptsVerified` and admits neither a six-only chain nor changed sixth/seventh bytes. Both native and portable flags, wrong count/hash/order/missing/repeat controls are tested. The seven-source test first failed on the old six-source rule, then qualification10/formula9/reference25 tests passed. This is forward admission wiring, not a claim that the new full seven-source chain executed.
