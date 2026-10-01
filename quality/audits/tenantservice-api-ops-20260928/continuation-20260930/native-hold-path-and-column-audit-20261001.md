# Wired native HOLD-path and literal column audit — 2026-10-01

Status: bounded read-only source inventory and actual filesystem failure reproduction **VERIFIED**. No Supabase/native case ran in this audit; no native PASS, complete schema compatibility or whole API/tenantservice/OPS acceptance is claimed. No frozen source, workflow, registry, migration, generated artifact or canonical memory was edited. Root owns publication; this unique report records the audited snapshot before the independently owned urgent site fixture repair.

Audited workflow: `.github/workflows/ops-hardening.yml` Git blob **5a59fe324954893e7522e974b6259153ca70dcc0**. Clean replay: `scripts/gridex-aud-003-clean-replay.sh` blob73c1156539ad0b0ee7a700c9a10fcd4c669e66e5. Current generated public schema: `supabase/database.types.ts` blobb4b33d6f33c25c9636dedf72eeed5383707b9c06. The pre-repair site test blob is e46e68cbdf43a785b2ba64f9bba14c13c699ee70. These are inspected working-tree bytes, not an invented native CI receipt or automatic acceptance of a later workflow.

## Exact bounded inventory

| Inventory boundary | Count / method |
| --- | --- |
| Unique currently wired native configurations | **34**; literal `--config scripts/*native*config.ts` references in the audited workflow |
| Native test files included by those configurations | **40** unique literal `scripts/*.test.ts` include paths; the six-source-owner batch and two partner tests count separately |
| Reachable local import paths | **642** unique repository files through literal static import/export/require/dynamic-import strings, resolving relative and `@/` modules plus standard source/index extensions |
| Reachable script/SQL/process files | **101**; script subset, directly invoked workflow psql files, recursively referenced psql `\\ir` files and `\\!` Python/Node/Bash subprocess paths |
| Parsed literal public INSERT column lists | **662**, across **96** distinct tables; identifier-only column lists compared with actual current generated public Row fields |
| Confirmed missing public INSERT columns | **0** within that exact parsed boundary |

This importer is a bounded literal-source inventory, not a complete runtime dependency resolver. Computed imports, comments inside import expressions, interpolated filenames/table names and external package internals are not certified. INSERT scan excludes dynamic lists, Auth/private schemas, data values, enum/check/foreign-key/trigger/authority behavior and all SELECT/UPDATE semantic correctness. Current generated columns may not certify a future unexecuted forward migration. Zero column mismatches is static evidence only.

## Confirmed source acquisition failure

The audited workflow invokes `scripts/customer-site-continuation-20260930.native.config.ts`, which includes `scripts/customer-site-continuation-20260930.native.test.ts`. Its first named case, **compiles the literal production candidate guard and preserves complete/incomplete postal validation**, reads at the then-current line101:

```ts
readFileSync(new URL('../supabase/migrations/20260930192831_customer_site_registry_atomic_command.sql', import.meta.url), 'utf8')
```

The actual sourced clean replay copies all original migration bytes into `HOLD`, removes all `supabase/migrations/*.sql`, and repopulates that directory with no-op markers from the exact official ledger. The original ledger's maximum version is20260806152004; it has no marker named20260930192831_customer_site_registry_atomic_command.sql. Original sources are restored only by the sourced shell's EXIT cleanup, after the native suites.

Actual reproduction used a new private temporary directory, copied the genuine site migration bytes into its `hold/`, and recreated `supabase/migrations/` using every actual official-ledger filename and the actual no-op marker body. A Node child evaluated the exact native `new URL('../supabase/migrations/...', nativeUrl)` / `readFileSync(..., 'utf8')` operation with the mirrored native source URL. Result: **exit1, ENOENT**, while the original file still existed in `hold/`. No real checkout migration was moved/removed, no source function or database process was mocked as successful, and no full native suite ran. This establishes the concrete filesystem acquisition failure before the first case can compile its real SQL guard; it does not claim a new live CI execution of that case.

The exact deployed source function is **public.gridex_save_customer_site_v1(jsonb)**, declared in the actual original migration. The first suggestion of an illustrative private function name was corrected after reading this declaration; no source edit used that suggestion. Owner's authorized repair should obtain the actual applied function through `pg_get_functiondef('public.gridex_save_customer_site_v1(jsonb)'::regprocedure)` or an independently checksum-verified explicit HOLD path, preserving the five existing complete/incomplete/null/forged-mismatch compiled guard checks. The source owner is implementing and separately qualifying the deployed-function acquisition. This report does not prematurely accept that repair or its Supabase runtime.

## Other migration/source references traced

| Actual current reference | Qualification in the audited snapshot |
| --- | --- |
| `scripts/ediel-case-view-native.test.ts` / GRIDEX_EDIEL_CASE_RESTORATION_SQL | Workflow explicitly exports absolute HOLD path to20260923180557_restore_customer_case_events_atomic_status.sql and checks it exists. Test independently checks absolute path, exact filename, canonical manifest registration and exact byte checksum. This is a valid current source location; no fallback to marker bytes. |
| `scripts/ediel-correction-context-native.test.ts` registry and direct-scope repair sources | Actual helper resolves current Git HEAD and reads original committed migration/manifest bytes with `git show`, checking SHA256 and transaction boundaries. Both referenced Git migration objects were actually present. HOLD does not remove committed objects. |
| `scripts/ediel-document-reference-native.test.ts` two registry repeat cases | Read original HEAD migration bytes for20260924021718_customer_read_permission_registry_completion.sql and20260924013820_document_reference_context.sql; both objects actually present. Cases execute only extracted registry statements and retain original assignment/metadata assertions. No current filesystem marker dependency. |
| `scripts/ediel-received-context-upgrade-regression.py` through manual native SQL | Reads current runtime manifest under scripts/, then original source bytes with checksum-bound `git show HEAD:supabase/migrations/...`; old seal object actually present. Its historic narrowly named uncommitted preparation fallback is not active on this delivery branch and is not used as a new exception. |
| `scripts/residual-tenant-queues-20260930-native.test.ts` current applied lease source | Already obtains the actual private queue function with `pg_get_functiondef`; no current migration-file read remained. Earlier genuine residual ENOENT belongs to the root-owned existing correction, not a newly duplicated finding. |
| Billing recipient/redelivery suites | Read `scripts/invoice-redelivery-decision-20260930-native.sql`; this script is outside the moved migrations directory. Its actual native fixture dependency remains present. |
| PRODAT dependent-condition source path | `lib/ediel/prodat/prodatDependentConditionEngine.ts` stores the field-matrix migration path as source attribution metadata. Traced execution uses imported field-matrix values; it does not read that path from disk. Not a HOLD acquisition failure. |
| psql include/Python concurrency fixtures | Actual `\\ir` dependencies stay under scripts/. The object concurrency Python reads its adjacent script SQL fixture; no new original-migration filesystem read was found. |

At the audited snapshot the site parser was the sole identified direct original-migration filesystem read among these bounded wired paths. No blanket source/runtime PASS is inferred for the other cases. Next: independently review the owner's exact site fixture acquisition/core/report packet, then require the existing isolated OPS job to execute the actual affected native suite and all subsequent acceptance gates. Missing or failing runtime evidence remains NOT_EXECUTED/FAILED.
