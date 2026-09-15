# Retained parent-delete fixture repair — 2026-09-15

Status: fixture correction offline verified; actual PostgreSQL 17 qualification remains required. Candidate migration and all existing acceptance hashes/checks are unchanged.

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
