# Retained parent-delete fixture repair — 2026-09-15

Status: actual bounded PostgreSQL 17 qualification PASS; the exact qualified candidate is now locally registered as forward seven, pending review and actual seven-source qualification. Historical source hashes and existing acceptance checks remain unchanged.

## Actual failure

[Run 34999483673, job 104484025682](https://github.com/heke99/gridex-ops-platform/actions/runs/34999483673/job/104484025682) checks out PR310 head `01ee1d55e515dea336531a3f8820bdf9eafebaf0`. Its seven offline tests pass, then the owned PostgreSQL fixture rejects `NATIVE_REAL_FUNCTION_BODIES_REQUIRED`. It does not reach the five-table delete behavior matrix or candidate qualification. CLI filename creation and artifact upload are skipped.

## Verified source mismatch

The fixture creates two exact May trigger functions whose declarations set `search_path = public`, then compares `md5(pg_get_functiondef(...))` against retained final catalog hashes. Later source `20260611190000_launch_linter_hardening_security_definer_rls.sql` applies `search_path = public, auth, extensions` to every public function. The fixture omitted that configuration step.

Offline reconstruction of PostgreSQL's function-definition rendering reproduces both retained expected MD5 values exactly when this later configuration is included:

| Function | Original configuration definition MD5 | Retained final configuration MD5 |
| --- | --- | --- |
| `gridex_assert_company_operational_for_write` | `87009076a9749a47238fb784e90355e7` | `fcdd8e61b45af7096cf2654d767e12a0` |
| `gridex_audit_critical_row_change` | `f19fc1247acd96f0f15f9284ebad6ef0` | `0bb25c59cc22963c529f3e7dce21d883` |

This is source/fingerprint evidence, not a new local PostgreSQL execution claim. The old job did not export actual function definitions.

## Change and verification

The harness now pins the complete June11 source at SHA256 `b696379a5e1d26bde5fae150d7c51e9d40df029a9dfd605810ad9051b1fb74d1`, extracts its exact function-search-path DO block, and executes it after the two original CREATE statements. Extracted block SHA256: `035855a2a2dd075d3886886d1efdd0ae315a0908dc25cb1a536c4ec210c2311e`. No function body or expected catalog row is rewritten. The owned fixture contains only the two selected public functions at this point.

Exact function MD5, full function rows, 18 FK definitions, three triggers, both creation orders, candidate delta, paused-tenant errors, rollback, repeated execution and cleanup gates remain in place. The source block's historical exception handling cannot grant acceptance: unchanged post-execution catalog checks still reject a missing configuration effect.

Repository systematic debugging and TDD applied to this bounded fixture repair. The new test first reproduced `NATIVE_REAL_FUNCTION_BODIES_REQUIRED` when configuration was absent, then passed after the exact source block was replayed before catalog comparison.

- `python3 -B scripts/canonical-added-constraint-index-parent-delete-tests.py`: **8 PASS**.
- `python3 -B scripts/canonical-added-constraint-index-parent-delete-selftest.py --selection-only`: **PASS**, 18 FKs, three triggers, two functions, `nativeSqlExecuted=false`.
- `git diff --check`: **PASS**.

Next: run the workflow on the reviewed branch head. Only a successful complete PostgreSQL qualification may permit its genuine CLI filename step. No migration promotion, production change, whole-application graph acceptance, schema acceptance or main merge is inferred from these offline results.

## Actual corrected qualification — PASS

[Run 35000914503, job 104488786469](https://github.com/heke99/gridex-ops-platform/actions/runs/35000914503/job/104488786469), source head `5c1cda15bd0516d1b2741dfdd2ffe22548757219`, completed the actual PostgreSQL 17 qualification, CLI filename creation, artifact upload and container cleanup successfully.

The actual receipt verifies all 20 combinations of five tables, both FK creation orders and original/repaired states. It reproduces four original CASCADE outcomes and both original sync-event tenant-loss outcomes; all ten repaired combinations retain the child row and known tenant. All cases verify rollback. Exact 18 FKs, three original triggers and both unchanged final function fingerprints pass after the source configuration repair.

All six candidate controls are true: exact five-constraint delta, idempotent repeat, missing-last/unknown-shape rejection, post-DDL rollback, simultaneous parent deletion retaining five rows, and preservation of the preexisting null-company journal. `cleanupVerified=true`; whole-application graph, actual public catalog, schema acceptance and production-modified claims remain false.

CLI 2.101.0 created `20260915172543_preserve_retained_customer_history_on_delete.sql` only after qualification. The workflow verified candidate SHA256 `00f8a844fc5c72274d697558d57f216acf56388b6d36f6aad6063ca255283734`. Artifact `10409074848` is advertised as 3181 bytes with ZIP SHA256 `3e974cd5bff2a71a50e55f94999181fbf0505cc7d5bd9180e9904e80a3587a40` in both upload logs and GitHub metadata. An artifact file reference was obtained, but independent local byte download returned HTTP403; the archive digest has **not** been independently recomputed locally.

No migration was promoted or copied into the selected history. Next action belongs to the coordinating review: verify archived bytes before any exact-byte promotion decision, then qualify the full selected/native replay and independent schema effect. This bounded success does not clear the other main-merge gates.

## Authorized seventh forward — local implementation pending actual replay

The coordinating agent authorized promotion using the actual CLI filename and the qualified source candidate hash above. The new migration is byte-identical to `scripts/sql/forward-candidates/preserve-retained-customer-history-on-delete.sql`, SHA256 `00f8a844fc5c72274d697558d57f216acf56388b6d36f6aad6063ca255283734`. This establishes exact source-byte identity; it does not claim a locally recomputed artifact ZIP digest following the HTTP403 boundary.

The source registry now admits exactly seven ordered forward sources, the previous six unchanged. Historical inventory remains 601 entries and historical timestamp selection remains 514 entries with their original aggregate hashes; current totals are 608 inventory entries and 521 timestamp sources. The history manifest adds only the new filename/hash. No existing migration, schema reference or generated application type manifest is changed by this promotion.

Ordinal seven verifies the five exact customer/company foreign keys with customer-only SET NULL deletion, cascading updates, original composite columns and expected nullability, validation, deferrability and ordinary-table properties. CLI transport admits ordinal seven and continues to reject ordinal eight. Receipt cardinality and accounting checks increase to seven without relaxing per-source proof requirements. The parent-delete fixture additionally executes this predicate against the original catalog (must be false) and repaired catalog (must be true); its existing actual behavior and rollback controls remain required. Its workflow watches the two newly imported predicate/source files under the existing narrow event guards.

Offline verification completed:

| Suite | Passing tests |
| --- | ---: |
| Forward source admission | 8 |
| Native forward runtime | 7 |
| Portable forward execution | 5 |
| Parent-delete fixture | 9 |
| Native lifecycle | 15 |
| Timestamp frontier | 16 |
| Residual source admission | 20 |
| Policy actor qualification | 7 |
| Replay accounting | 38 |
| Native final SQL | 10 |
| Native cleanup | 5 |
| Native schema reference | 4 |
| Full schema reference | 25 |

Migration integrity passes for 608 files and 512 version groups. Production-readiness passes for 608 SQL files and 515 ledger-eligible versions with the three original collision aliases retained. Its generated inventory intermediates were restored after verification; no acceptance artifact was refreshed. `git diff --check` passes.

The newly admitted ordinal-seven predicate still requires the next actual parent-delete qualification. Full seven-source portable/native execution, final SQL, independent schema comparison, generated application types and remaining merge gates are not inferred from these offline results.
