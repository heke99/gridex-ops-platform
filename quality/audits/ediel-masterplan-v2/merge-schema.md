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
