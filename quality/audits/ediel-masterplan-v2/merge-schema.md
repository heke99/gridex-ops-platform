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
