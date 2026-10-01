# Grid-owner agreement canonical provisioning and atomic caller, 2026-10-01

## Outcome and scope

The existing internal platform agreement feature now has a CLI-generated forward migration and an actual save/archive caller routed through a current-session atomic command. Optional grid-owner creation, agreement mutation, standard audit, immutable private audit and idempotency receipt commit together. No market activation, financial/lifecycle write, customer authorization assertion, support-quarantine release, hosted request or external delivery was added.

This is a separate, not-yet-published stage from the independently frozen defensive document route packet in `grid-owner-agreement-document-quarantine-20261001.md`. Those four bytes are unchanged. Root owns workflow wiring, generated adoption, history/checksum registration, service-client registry and publication. No existing historical SQL, generated database types, shared workflow, memory or remote ref was edited by this owner.

Routing used the previously read repository AGENTS/current active memory and debugging/TDD/security/verification/Supabase instructions. Local CLI help was inspected before executing the actual cached Supabase `migration new grid_owner_access_agreement_atomic_provisioning` command. The generated filename is exactly `20261001020409_grid_owner_access_agreement_atomic_provisioning.sql`; no linked project, database reset, authentication or network command was run.

## Grounded old feature and compatibility

Actual consumers are the global guarded agreement page, `GridOwnerAgreementForm`, `GridOwnerAgreementTable`, the existing Action/model, `agreementReferenceResolver`, `routeDecisionEngine` and the inbound-mail table availability diagnostic. The form creates agreements; it has no current edit-row initialization or stable UI revision token. Archive submits only the agreement ID. Current model list/get/date/scope and ambiguity resolver behavior is preserved, including nullable/global company rows and resolver fields. No new tenant restriction was substituted for the legitimate global platform feature.

The bounded 29-column old DDL appears only in immutable noncanonical `20260528_batch_7a_route_inbound_mail_platform_ui.sql`, with old Storage handling in `20260528_batch_7a1_inbound_hardening.sql`. The audited current `schema.sql`/generated database types did not contain this table before this stage. This is an implementable missing-schema gap, not a terminal external dependency. The forward provisions only this feature, its three private ledgers, narrow functions, classification, indexes and default private bucket; it does not replay either old migration wholesale.

Old compatible row values, timestamps, global company NULL and JSON metadata were compared before/after the entire real forward: every old field is unchanged, with only the explicit new `revision=0` column. Existing incompatible column types, missing single-ID primary key, nullable required legacy columns, forced RLS or incompatible pre-existing revision shape abort with `agreement_schema_incompatible`. The forward does not silently relax these installations. Extra unrelated columns/constraints/triggers are not certified by the core fixture and require the actual native/upgrade path.

Service receives SELECT only on the public agreement table and EXECUTE on the two narrowly scoped invoker/private command functions. It receives no raw agreement DML or private ledger table privilege. Anon/authenticated receive no agreement read/write/execute grant. New private tables have RLS and no caller table grants. Results and audit facts reject UPDATE/DELETE even by the table owner through immutable triggers. Existing old policies do not override revoked table ACLs; normal owner bypass for the private definer is retained, while an incompatible FORCE RLS installation aborts.

The default `grid-owner-agreements` bucket is private; new restrictive Storage bucket/object policies deny anon/authenticated access to that exact bucket even under a deliberately permissive controlled inherited fixture policy. Other buckets are unchanged. This synthetic inherited-policy test is not proof of an actual deployed permissive policy. A custom configured bucket must already be private and have independently correct Storage ACLs; these restrictive policies cover only the default bucket. Neither custom-bucket ACL acceptance nor real Storage provisioning/bytes is claimed.

## Current authority and atomic semantics

The actual Action first requires the existing canonical platform gate and calls real `currentSupportSession('ops', guard.userId)`. Successful current Auth and verified claims must agree on subject, user ID and UUID session; populated user plus Auth/claims error, mismatched subject/user/session and a denied gate fail before intent creation or upload. Supplied actor/session fields are ignored. Tests control only the outer gate/Auth/service/Storage/cache boundaries; the exported Action, session helper, command adapter and installed Next control-flow functions execute.

The SQL command reuses the real private profile/session helper and canonical global platform decision. It locks actual profile/Auth session, confirmed-email Auth row, current global admin/user-role rows and referenced role rows. Tenant-scoped platform-looking role names do not grant global authority. Active selected company, exact current agreement and revision, selected global/same-company owner and compatible global/same-company route are separately checked/locked. The final session/clock/authority check runs after all writes and audit/result/unique/resource waits. Replay, including the prepare-upload committed shortcut, checks current company/resource and the final authority clock before returning.

Actor plus caller key serializes the command. The semantic hash binds operation, company, agreement ID, expected revision and full payload; actual session is independently live-checked rather than included in retry identity. A second live session of the same real actor can replay the exact committed command; changed payload with the same key conflicts. Revision conflict rejects fresh mutation. Archive increments once; a fresh already-archived command is a no-change result and cannot create a second business audit.

Optional owner lookup/creation occurs inside the same transaction as the agreement command. Matching names/organization/Ediel IDs use only global or selected-company rows. One match reuses; ambiguous matches conflict; no match creates the same bounded old owner fields without marking Ediel or production readiness. Any denied relation, stale revision, late audit error or final authority/clock failure rolls back the owner, agreement, standard audit, immutable audit and result. Global company-null create preserves global owner/company semantics. Normalization and exact relationship checks deliberately fail closed instead of selecting an arbitrary foreign/ambiguous old owner.

Private immutable audit is used because global company NULL is legitimate here and the tenant-only canonical audit table cannot be assigned an invented company. The standard audit ID links each private audit fact. No reusable ordinary API assertion, caller mandate, billing mandate, canonical production activation flag or scanner approval was manufactured.

## Upload and failure outcome

The actual Action derives bytes SHA-256, safe filename, content type and declared size from the server File. Before Storage it asks the guarded database for a durable exact private upload intent. Intent holds UUID cleanup capability, actor/key/request hash, selected company, private bucket, unique object path and file hash. The supplied bucket/path/token must pass exact receipt and shared canonical object-key checks; reserved support quarantine cannot be registered or uploaded. Upload uses only the returned path and `upsert:false`. Save must bind the same prepared intent/capability/request hash; agreement document attachment and `attached` intent status are atomic.

After a failed/uncertain upload or save, the Action asks the command to reconcile the exact intent before deleting. The cleanup operation can use only the server-held 128-bit capability for that actor/key/hash/exact intent; it cannot authorize a write or return another object. A revoked staff session can still remove its previously issued, never-attached orphan under this narrow server receipt. Attached objects never produce a deletion receipt. A known committed command preserves the saved outcome after transport uncertainty. Only a verified unattached object is removed; cleanup completion is recorded only after Storage reports successful removal.

Unavailable reconciliation produces a constant safe warning and no blind delete. Failed removal leaves durable `cleanup_required` and the original save failure; it cannot report success. Ordinary cache refresh failure after commit keeps the saved result and logs a constant warning. Installed Next redirect/notFound signals are rethrown unchanged. No raw database/Auth/provider error, capability, path, SQL or contact value is included in the newly introduced warnings/error mappings.

Concrete remaining implementation debt: process termination after prepare/upload, unavailable reconciliation, or removal failure can leave a private prepared/cleanup_required intent and an orphan object. This stage implements the actual current Action cleanup and durable evidence, but no scheduled crash-orphan drain, retries UI or background cleanup consumer. This is PARTIAL/IMPLEMENTABLE follow-up, not externally blocked or full orphan-lifecycle acceptance. The current form's automatic create key is stable for exact actor/payload across sessions; editing/revision UI and recovery of no-file uncertain update response are not delivered by this creation-only form stage. Database revision/idempotency is independently proven.

SQL metadata proves intended hash/path and receipt binding; it does not attest actual Storage bytes or a verified physical upload. DB authority does not span the separate Storage operation; a later denied save may require the narrowly authorized cleanup. No real Storage delete/upload/signing, GoTrue session, Next-cookie/browser journey or provider execution occurred locally.

## Executed RED/GREEN and verification

| Evidence | Executed result | Meaning and limits |
| --- | --- | --- |
| Empty actual CLI migration, first real PostgreSQL core | 3 RED, missing function/table (`42883`/`42P01`) | Missing implemented feature reproduced; no canned SQL success |
| Original exported Action, first 10 cases | 8 RED / 2 existing controls PASS | Raw DML, outside-transaction owner, missing intent/current-session binding and committed refresh outcome reproduced with controlled outer boundaries |
| Early SQL branch | 2 PASS / 1 genuine global-null RED (`22P02`) then 3 GREEN | JSONB subtraction parentheses fixed; initial SQL operator mistake acknowledged |
| Controlled inherited permissive default-bucket read | 1 RED then 1 GREEN | Restrictive default-bucket policies; not a deployed policy bypass claim |
| Missing legacy shape guard and removed-resource prepare replay | 2 RED then 2 GREEN | Actual entire forward and actual installed command; stricter fail-closed compatibility and current resource/clock checks |
| Final real SQL core | **22/22 PASS** | Actual new entire forward, canonical global decision and real session helper, actual current grid-owner/audit table definitions on PGlite/PostgreSQL 17.5; synthetic minimal other table scaffolding |
| Final exported Action/session/adapter controls | **22/22 PASS** | Current Auth/claims/gate, exact intent, no raw DML/partial owner, deny/schema/invalid receipt, recovery/cleanup debt, archive row binding, cache/Next controls |
| Exact existing 24 import-failed Ediel suites | **403/403 PASS, 24/24 files** | Compatibility under real installed Next server-only empty marker alias; production marker retained |
| Scoped ESLint and actual Action/model/native import-closure TypeScript | **PASS** | No broad moving-root integrated evidence claim |
| Disposable full-schema native | **0 executed; 5 prepared** | Must run in actual isolated OPS CI; no local Docker/psql/stack |

The core includes actual current public grid-owner and audit column/CHECK definitions and primary keys, real extracted authority function bodies, the new immutable audit/result uniqueness and standard-audit snapshots. Other Auth/companies/roles/routes/Storage table scaffolding is minimal and controlled. It does not load all current FK/index/trigger/default-grant/runtime/provider infrastructure, including the standard audit normalization trigger. The late final-clock case uses an owned in-transaction fault trigger; it is not an observed two-connection lock-wait experiment. No full-schema production duplication/bypass claim is made from an underconstrained synthetic fixture.

Five authored native callbacks construct real SQL without canned successful values; a stop-at-SQL capture executes those exact constructed statements on the core and checks the real JSON `proof_receipt`. They use actual installed command, service/anon/auth role decisions, atomic facts, second actual session rows, revocation/expiry/global-role denial, owned late audit fault rollback and attached/orphan metadata distinction. All fixtures/faults are inside transactions ending ROLLBACK; they never replace real DB grants or authority functions. Captured construction passes remain CORE proof; native remains NOT_EXECUTED. Native sessions are synthetic actual table fixtures, not GoTrue-issued cookies.

## Reproducible local commands and root wiring

Node22 executable: `/tmp/gridex-event-v2-node22-cache/_npx/52027bd8fc0022aa/node_modules/node/bin/node`.

```sh
NODE_PATH=/tmp/ediel-service-check/node_modules /tmp/gridex-event-v2-node22-cache/_npx/52027bd8fc0022aa/node_modules/node/bin/node --test scripts/grid-owner-agreement-atomic-20261001.postgres.test.cjs
/tmp/gridex-event-v2-node22-cache/_npx/52027bd8fc0022aa/node_modules/node/bin/node node_modules/vitest/vitest.mjs run --config scripts/grid-owner-agreement-atomic-20261001.config.ts __tests__/grid-owner-agreement-atomic-caller-20261001.test.ts
/tmp/gridex-event-v2-node22-cache/_npx/52027bd8fc0022aa/node_modules/node/bin/node node_modules/eslint/bin/eslint.js app/admin/agreements/grid-owners/actions.ts lib/routes/gridOwnerAgreements.ts __tests__/grid-owner-agreement-atomic-caller-20261001.test.ts scripts/grid-owner-agreement-atomic-20261001.config.ts scripts/grid-owner-agreement-atomic-20261001.native.config.ts scripts/grid-owner-agreement-atomic-20261001.native.test.ts
/tmp/gridex-event-v2-node22-cache/_npx/52027bd8fc0022aa/node_modules/node/bin/node node_modules/typescript/bin/tsc --project /tmp/grid-agreement-atomic-scope-20261001.json
```

The last temporary TypeScript project extends actual repository tsconfig, disables emit/incremental/Next plugin, and has only the actual new Action/model/unit/native config/test entry files. Exact 24 existing compatibility suite names were parsed from collection-failure rows in root's discarded moving-root log `/tmp/gridex-seventh-source2-unit.log` and passed as explicit Vitest arguments to the unique focused config. The discarded original run is not integrated acceptance. Focused config resolves the exact installed `next/dist/compiled/server-only/empty.js`, with normal repository alias/setup; no fake dependency or server-only mock remains in the new unit. Root adjudicated the same test-only alias for default Vitest when integrating this stage; production source marker is preserved.

Run local core while actual migration source files are present; its file-extraction fixture is not a HOLD-safe native runtime loader. Native code does not read migration files: use the existing private disposable status file, CI=true/RUNNER_TEMP, genuine installed schema and `vitest run --config scripts/grid-owner-agreement-atomic-20261001.native.config.ts`. Config requires exact `http://127.0.0.1:54321`, actual local anon/service keys and forbids named outbound provider credentials. Existing helper requires only the fixed local proof database. No extra proof workflow/ref is proposed.

Root integration prerequisites: register forward checksum/order; adopt real generated schema/types/ACL/function output; add the real Next marker alias to default Node unit context; independently review current service-only model and Action actual platform/session binding with no raw agreement DML; wire five native SQL cases into existing isolated OPS path. Default private bucket ownership/Storage ACL/full-schema triggers, actual Supabase/RLS and upgrade/restore must be genuinely exercised before native acceptance. External custom Storage delivery/provider or GoTrue/browser prerequisites must not be inferred from these unit/core results.

## Frozen source/proof manifest

The following nine source/proof files are frozen for independent review. The report itself is the tenth packet file; its final hash is supplied separately to root.

| Path | Git blob | SHA-256 |
| --- | --- | --- |
| `app/admin/agreements/grid-owners/actions.ts` | `c3aea035ae906ce8ab3a6b397cd2d327e380855d` | `7a773330645d642bdf909437402ed018454ea92bde96c7e22fe1286208b68073` |
| `lib/routes/gridOwnerAgreements.ts` | `dc228471ef7cc0b5758cc19df5df7b7461784ffd` | `6dd2b6806af2a4ff25bde99d3da6e9bb130aeba06789c9ddcf39883c2f22504d` |
| `supabase/migrations/20261001020409_grid_owner_access_agreement_atomic_provisioning.sql` | `b7ba4ff2a5e09c834eb2182eec975845f0ea64b0` | `49a259493aaaca387ce673f714492e36c403acd4375828483c53ab014db66f45` |
| `__tests__/grid-owner-agreement-atomic-caller-20261001.test.ts` | `f6542d300212e189b846ad3e2b2c24126fa881f9` | `5ec296bfd12a6cae3c93e06384e87f96e59e909975f87bdea573b1445b6c2e62` |
| `scripts/grid-owner-agreement-atomic-20261001-core.cjs` | `3aa8f6a1dcfd61b6bad86c2a4a3843ed1b9332f9` | `7025b2d92e5ba6090549d3d9dca3efb588b5f71a2006b528c98ba344c7cfb210` |
| `scripts/grid-owner-agreement-atomic-20261001.postgres.test.cjs` | `4022fcf66970e94df406b733b7d78356da2bbe44` | `3304ee5d05580b4370fc9eb0461ada6aced1ac57c6990fc7875f82e3662dbc3d` |
| `scripts/grid-owner-agreement-atomic-20261001.config.ts` | `8d4a6b8dcc48eb0698a8957617d04c1ee293e591` | `9c64d553e665427cdf608da91147e525ea035176e30be6a7d85969082de0b64d` |
| `scripts/grid-owner-agreement-atomic-20261001.native.config.ts` | `aaf1e6f24a9b1755acf62e095d6d3483cf1d712c` | `61ebaf0ae0139181d7a40508f4c8c31082f298dbcdf812d60538c5874ff225a1` |
| `scripts/grid-owner-agreement-atomic-20261001.native.test.ts` | `5bbf6839d8b48df91cfb637c6cad782107539afa` | `1df5c4162723eef3048450ec06b066c4df34790c39223fc2c3c05b19e5252d06` |
