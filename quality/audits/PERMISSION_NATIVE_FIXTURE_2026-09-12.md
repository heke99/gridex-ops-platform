# Canonical permission and Storage native fixture — construction receipt

Task11a candidate; independent spec and quality review APPROVED,0findings (PERMISSION_NATIVE_REVIEW_2026-09-12.md). Native execution NOT_RUN. This is the exact author report preserved for review/publication; acceptance requires the separate hosted receipt.

# Task11a recovered candidate — author report

2026-09-12; author finish on repository baseline fe257657. Status: IMPLEMENTED_NOT_VERIFIED; ready for independent spec/quality review. Native execution NOT_RUN. No production call, historical migration edit, migration registration, dependency installation, canonical memory/index edit, commit, push or subagent was performed by this author.

## Recovery and scope

Preserved the recovered implementation rather than rewriting it. Existing canonical candidate remains byte-for-byte SHA256 `22572cc31819a52fe577dbaa654dbe84cd6ebc0dd7564ab6f9c4f340cbd5a4fe` in both generated SDD and CI paths. The older recovered snapshot SHA77cb5369… is a preservation artifact, not the current candidate or acceptance evidence. CLI2.101.0/job103504560679 scaffold receipt and exact basename `20260912052507_canonical_permission_overrides_and_storage_write_guards.sql` are checked. No new timestamp was generated.

Recovered source admissions and102 named cases were present. Added the dedicated runner, construction/orchestration tests and one OPS native job. Corrected a demonstrated composition gap: the seed assumed a customer-documents bucket, but its admitted predecessor only defined policies. A failing construction test showed missing `storage_bucket_foundation`; the complete original seven-bucket foundation INSERT from02_db1 is now separately parent/slice-hash admitted and executed. This adds no fabricated source authority. Candidate SQL itself is unchanged by this finishing author.

Skill routing: Supabase for source RLS/ACL/Storage constraints (root's recorded official-doc preflight retained), executing-plans for the existing bounded task, TDD for construction gaps, verification-before-completion for exact fresh receipts. Existing domain findings/contract supply the evidence phase. Independent spec/quality review is delegated to root's separate reviewer. No broad audit restart, UI, performance optimization, hook, dependency, skill-writing or additional subagent work applies to this scope.

## Runtime contract

The unchanged `canonical-auth-provisioning-legacy-batch.py::OwnedPostgres` creates a new labelled network-disabled postgres:17 container with private SQL/client/server streams and exact name+label cleanup. The runner accepts only --check, --native or --cleanup-owned, with no database URL, custom source or target argument. It narrows supplied container names to the permissions prefix and only uses existing allowlisted native/atomic databases. It never invokes prefix/replay or attaches to an active controller.

All source and candidate admission finishes before container creation. In native DB: execute source composition, labelled fixture assertions/grants/seeds, capture catalog and all fixture relation rows, execute9 original-source characterization cases in separate BEGIN/ROLLBACK transactions and require unchanged catalog/rows. Clone this own source fixture to the atomic DB, poison prior private function grants with service_role and a test-only custom non-superuser/non-bypass role, apply exact candidate, assert owner-only internals and callable Storage helper, and prove no row changes. Repeat the candidate and require exact catalog/ACL/row equality. Poison all five internal functions including the new ones, reapply and require restoration of the same catalog. Run102 candidate cases with per-case rollback and terminal marker; require final exact equality and private logging settings before owned cleanup.

Catalog covers function definitions/owners/ACLs, policy definitions, table RLS/ACLs, all column ACLs, schema ACLs, indexes, triggers and all24 admitted fixture relation row multisets. It is fixture-relative preservation, not whole deployed-schema parity. Private SQL results stay captured; public receipts contain fixed stage names, SQLSTATE/status/timing and finite summary labels. At root's requested diagnostic seam, the runner additionally maps an exact private psql error location to an admitted source slice ID plus bounded generated-SQL line number, or a fixture-derived whitelisted assertion label. Unknown messages, malformed paths, out-of-range lines and raw payload suffixes are not emitted. OwnedPostgres is unchanged; original failure propagation and cleanup remain. First hosted failure is diagnosed from its stage/SQLSTATE and these coordinates against the admitted composition, without uploading private output or blind reruns.

Fixture-only authenticated SELECT grants are explicit for the F16 staged policy subset and invoker dependencies; access-table writes and column writes receive no fixture grants. Fixture-only Storage metadata DML is explicit and paired with exact policies and non-bypass actor assertions. It is not evidence of original Data API grants. All original role scope triggers and the actual single-active-role unique index are retained.

## Finite case expectations

102 named candidate cases;935 inline `fixture.assert_true` call sites in constructed case SQL, counted separately from exact SQLSTATE assertion calls and setup/ACL assertions. These are constructed expectations, not executed assertions.

| IDs | Expected behavior |
|---|---|
| P01–P04 | U_AB A masterdata allowed/B absent; reverse B switching allowed/A absent; company array, wrapper, context agree and context has7 operation entries. |
| P05–P08 | Actual global ordinary-target override command: deny removes role grant; allow adds absent key; replace restores allow; clear restores base. Actual audit/result/global rows proved. |
| P09–P12 | Exact-company allow/deny applies; foreign-company allow/deny excluded. |
| P13–P16 | Global/local conflicting decisions and both duplicate global insertion orders deny. |
| P17–P20 | Inactive/future/expired denies ignored; inclusive now-to-now deny applies. |
| P21–P24 | Removed membership, inactive assignment, inactive definition, missing memberships yield no override key. Definition-only inactivity preserves original selected-company difference. |
| P25 | Command overlap23514 and unknown permission22023, unchanged complete rows, paired admitted writer. |
| P26 | Ordinary command actor42501 with unchanged rows, paired admitted platform writer. |
| P27 | Global platform assignment and admin_users fallback preserve independent authority/shared positive controls. |
| P28 | Company-bound platform and global ordinary role scope insertions23514; unchanged rows. |
| C01–C03 | Same-company direct allow accepted; other-company direct excluded; NULL-company direct accepted inside authority. |
| C04–C08 | Inactive/removed/direct-deny/key-alias-only/unknown-effect direct rows are nongrants. |
| C09–C10 | Direct deny does not veto role allow; valid single-role deny does not veto direct allow. |
| C11–C12 | Catalog false retains legacy role/override grants; applicable deny still removes inactive catalog key. |
| C13 | A-only local deny removes sole shared grant. |
| C14–C15 | A deny/B local or global allow produces A absent, B allowed, shared allowed through B. |
| C16 | Global deny defeats A allow in shared set. |
| C17 | No membership plus direct/override global allows yields empty company/shared authority. |
| C18 | Inactive A membership excludes A while eligible B retains global override in shared set. |
| C19–C20 | Direct cannot revive inactive assignment/definition; exact original selection/empty-role distinction asserted. |
| C21–C24 | Disabled profile, unconfirmed identity, banned identity, absent profile block direct+override/company/shared keys. |
| C25 | Second active same-company assignment rejects23505 with unchanged rows; valid first role remains allowed. |
| C26–C28 | Inactive platform definition preserves original authority but array empty; inactive assignment loses authority; platform override deny removes array key without removing authoritative bypass/original platform context. |
| C29–C32 | Unknown override nongrant; inclusive allow applies; unknown explicit company has no fallback; global deny defeats NULL direct grant. |
| F01–F04 | Companies: A/B own-read/foreign-zero controls, then direct INSERT/UPDATE/DELETE42501 and zero table/column write privileges for A/B/platform JWT. |
| F05–F08 | Memberships: same four controls. |
| F09–F12 | User roles: same four controls. |
| F13–F16 | Invitations: same four controls. |
| S01–S04 | Own active read/insert/update/delete succeed with exact row and metadata assertions. |
| S05–S08 | Foreign SELECT zero, INSERT42501, UPDATE/DELETE zero, unchanged rows; reverse tenant own read control. |
| S09–S10 | Rename existing A path to B and upsert existing foreign object reject42501 without row changes. |
| S11–S12 | A write key cannot grant B and reverse; both tenant reads are positive controls. |
| S13–S16 | Paused company read allowed; INSERT42501 and UPDATE/DELETE zero with unchanged rows. |
| S17–S19 | Suspended company/inactive membership/removed membership deny reads and writes. |
| S20 | Profile-disabled and disabled_at each make actual source session guard false and deny Storage; no managed revoked-token claim. |
| S21 | Anon read/update/delete zero and insert42501. |
| S22 | Platform paused read allowed but writes denied; active-company platform insert positive. |
| S23 | Valid site path positive;14 malformed UUID/slash/type/file/ownership/scope paths plus invalid access rejected. |
| S24 | Other bucket denied42501 with unchanged rows. |
| S_VIEWER | Viewer retains write key/read but write42501 through membership-operation guard. |
| S_UPSERT_OWN | Own upsert succeeds with INSERT/SELECT/UPDATE policies and updated metadata. |

Original-source characterization9: P05 still allows despite stored global deny; P06 still omits stored global allow; S13 paused read succeeds; S14/S15/S16 paused insert/update/delete succeed; S20 source-session-disabled still permits old-helper read/update; S22 old helper permits paused platform write; S_VIEWER old helper permits viewer write. These cases must succeed in proving the old defect before candidate acceptance. Baseline and candidate branches are visibly separate; no setup error counts as a denial.

## Fresh local verification

- `python3 -B scripts/test-canonical-permission-native-admission.py`:21 PASS, including source/slice/path/signature/body/uniqueness/composition negatives.
- `python3 -B scripts/test-canonical-permission-native-fixture.py`:5 PASS, including exact admitted bucket foundation and preserved original context/path body with only intended substitutions.
- `python3 -B scripts/test-canonical-permission-native-runner.py`:11 PASS, including candidate tamper/copy drift, finite database/container rejection, terminal marker, mocked exact orchestration/rollback drift, finite private-error diagnostics and always-cleanup lane.
- `python3 -B scripts/canonical-permission-native-admission.py --check`:PASS,33 sources/82 slices/28 function slices, source composition constructed, native NOT_RUN.
- `python3 -B scripts/canonical-permission-native-runner.py --check`:PASS,102 cases/935 inline checks/9baseline cases. Composed SQL SHA256 `c45021afb4b8e92415166d27ce4852d792bc190c1ac2adec3a37d3a03c1597ce`.
- AST parsing of all6 owned Python files:PASS. `git diff --check`:PASS. Initial missing-bucket test failed with missing slice; runner test first failed with missing runner file; both pass after implementation. A diagnostic test also failed before its helper existed and passes now, including full-source slice coordinate checks and rejection of raw messages. These are construction RED/GREEN, not native SQL RED/GREEN.

No Docker/psql/CLI/dependencies were installed or invoked locally. Existing SDD copy is compared when present; hosted CI admission always validates the reviewed manifest candidate hash and genuine scaffold receipt, so it does not require ignored SDD artifacts. The new OPS job `canonical-permission-native-proof` runs the three construction suites, --check, then --native; its always step runs --cleanup-owned. No secrets/service/database URL/network configuration was added.

## Remaining gates / exact next action

Root: independently review candidate, all33source admissions/order, fixture/matrix, runner and20-line dedicated workflow addition before publishing runnable SQL. After reviewed publication, execute/read actual `canonical-permission-native-proof` hosted job using `python3 -B scripts/canonical-permission-native-runner.py --native` with the workflow-owned permissions container name. Route exact failing stage if native fails; do not accept from construction tests or weaken source guards.

Only actual hosted success can accept Task11a native P28/C32/F16/S24/SX2 and baseline/repeat/ACL/cleanup evidence. Task11b still must close actual full prior policy composition (June12 consolidation, August12 normalization, August26 performance), critical CRUD100 and relationship18. Managed Storage bytes/API/upsert/rename/URL and real revoked JWT/session enforcement, complete replay/types/parity, candidate migration registration among600inputs, and production acceptance remain OPEN. F16 is only the explicitly approved finite SELECT-policy/ACL subset. Unexercised operation-metadata Ediel production evidence branch remains explicit. No full77 or whole-schema claim.

Stop point: all author edits complete; root owns independent review/publication/native execution. Preserve unrelated dirty memory/audits and prior untracked pycache; none is owned by this finishing author.

## Exact owned implementation files at stop

| Path | SHA256 |
|---|---|
| `scripts/canonical-permission-native-admission.py` | `515ddf6365f1c8a220f3f4ed5a5372f92c41ed702af70f0a57f3147acd20a216` |
| `scripts/canonical-permission-native-fixture.py` | `e5000c9e5428ad7fa5091099f2b6d560fb2f392a389ade26b153b3b8b567cf8e` |
| `scripts/canonical-permission-native-runner.py` | `4a9ae3e0529708aa9daafe87a48b84f152915c152a4eb0f731c57ceaefc82ae1` |
| `scripts/test-canonical-permission-native-admission.py` | `22713e2d66f3427179b54591adbd7c2ddcd19807f357d1bfd803c69ce6f3e38d` |
| `scripts/test-canonical-permission-native-fixture.py` | `3e0ccdde323cbe0b12dddb01e65d0235357952a5b5c98ef208b08f884cbdd3ce` |
| `scripts/test-canonical-permission-native-runner.py` | `9b23daf16050ec5e68443eb336636c311ebad15734f6a1b0206b78caedbabaac` |
| `scripts/sql/canonical-permission-native-sources.json` | `9b83148258710aa34534943a996066f156da03d73c258156fd253ea09a6bfb36` |
| `scripts/sql/forward-candidates/20260912052507_canonical_permission_overrides_and_storage_write_guards.sql` | `22572cc31819a52fe577dbaa654dbe84cd6ebc0dd7564ab6f9c4f340cbd5a4fe` |
| `.github/workflows/ops-hardening.yml` | `efaf0d318b9d9d8927118858d897f014b3de3b729871aea7e2a15fc0cfef9938` |
| `.superpowers/sdd/2026-09-12-current-and-plan77-85/generated-migrations/20260912052507_canonical_permission_overrides_and_storage_write_guards.sql` | `22572cc31819a52fe577dbaa654dbe84cd6ebc0dd7564ab6f9c4f340cbd5a4fe` |

This report is the11th owned file. Existing recovered scripts/candidate are owned as the Task11a batch; this finishing author changed admission test expected counts, fixture/catalog/seed comment, manifest bucket admission, fixture tests and added runner/tests/workflow/report. Existing generated candidate bytes and admission Python are preserved. The recovered-candidate snapshot is not an implementation input.

## Exact parent-source hashes

All82 slice offsets/hashes/signatures and78-original-plus-bucket executable ordering are in the manifest; witnesses are admitted read-only and cannot enter composition.

| Repository source | SHA256 |
|---|---|
| `scripts/sql/gridex-supabase-compatible-bootstrap.sql` | `209b0c391bcfa957ec8b30cfc338622b4bda776e6976d3624fdd2d04779b8914` |
| `supabase/bootstrap/20260522_admin_users_foundation.sql` | `674d462d96078fea9cde165312fbac89698c4be6437a55fffe14ecc262c9b827` |
| `supabase/migrations/01_db1_schema_repair_core_helpers_and_canonical_tables.sql` | `85f3561be4d91cee063bbf626302de7726a09c5ce08743b250e62cee959bb5f2` |
| `supabase/migrations/01_db2_full_view_preflight_schema_and_functions.sql` | `4de50050384d6892612c16484de8b198785c59cbb5d2ff03e7cea7e600d36cc9` |
| `supabase/migrations/02_db1_operations_ediel_billing_dedupe_and_storage.sql` | `0413f4dca84aca387297954b900a163aa63d0f84552570c372c12e8f8abdd693` |
| `supabase/migrations/20260519_auth_callback_email_reset_sync.sql` | `59efbf233d314558f8cc7ffbb2b15788cadaaf7ba476e0f80fa1e820299419a9` |
| `supabase/migrations/20260519_batch_6d2_runtime_governance_completion.sql` | `b7d9d48b9cd3093b5546b04225f9c6151b0f674d2ae73441d8086f51922de9ab` |
| `supabase/migrations/20260519_final_saas_hardening.sql` | `2037dbc535d18d7575820d7f40d2a8ef4848b67060161e6851a01eb15990105e` |
| `supabase/migrations/20260526_debug_step1_2c_full_schema_code_alignment.sql` | `5a4a2326232ab847d23fed32af2be13a046ee3e3a2dae41dead6f5b4eba16472` |
| `supabase/migrations/20260528_final_user_access_schema_safe_repair.sql` | `4968391d74a8ff813ce1f56a8b8d9ade682692d183988917e736d0f3c5857bd2` |
| `supabase/migrations/20260531111600_system_readiness_foundation.sql` | `e6ef68b18ede5729da067ce59a86cfca0db083d9d54a35ae0ed3a6c0968b96f2` |
| `supabase/migrations/20260601070000_ediel_production_readiness_hardening.sql` | `7a73e59f559ebb5291d3e7df74545e6918011ec9764e5c512df19fbaa5bdbc12` |
| `supabase/migrations/20260611190000_launch_linter_hardening_security_definer_rls.sql` | `b696379a5e1d26bde5fae150d7c51e9d40df029a9dfd605810ad9051b1fb74d1` |
| `supabase/migrations/20260614140000_ops_production_multitenant_readiness.sql` | `08795f0c7bb3564fb7929100c2fc99bd0f30351348d1c5f2b6be4e82320bb2b7` |
| `supabase/migrations/20260727010000_contract_flow_integrity_completion.sql` | `392d9e90c4fcec6752644fb75721ed7a113c3dcd2cb68d3185e3bfd44a065c4f` |
| `supabase/migrations/20260730130000_historical_sync_forward_repair.sql` | `3e204b00fa33badbfdc7a11c0304df3bc5385b16e0854e40af2df1c06b32b50b` |
| `supabase/migrations/20260801143000_canonical_multitenant_platform_hardening.sql` | `4de56322077ea89f72596bd9cd2de9f2bdae67c2b74c4721779410553b3326b0` |
| `supabase/migrations/20260802010000_canonical_tenant_operation_policy_lifecycle.sql` | `257ff7b6e84466c0f90103116e94f18e0f2e56b4e381cb0c15e4ad5008307082` |
| `supabase/migrations/20260802014000_canonical_provisioning_access.sql` | `4fd103508d86a85ee41c168af90a25fdbbd546d17efea7ebcec91935c3c790fc` |
| `supabase/migrations/20260802170000_canonical_security_convergence.sql` | `e34618a9cb0c780f3fd75034ab113e48d99a27d8983e5d0fcbfc4a53ee27370a` |
| `supabase/migrations/20260802190000_canonical_emergency_access_lockdown.sql` | `9f5071e87c0689feb84f8701cbbeef72f65fb1c227862fb1ba628da47bb40d43` |
| `supabase/migrations/20260802203000_canonical_runtime_consistency_hardening.sql` | `96a4402e5b642453a7358f55f9a5c93b2559a707df66b958a770318d10412930` |
| `supabase/migrations/20260806151106_gridex_aud_001_customer_document_storage_isolation.sql` | `0d51528c3d7dcb8e2bd2c92cb8d83eea9212438232d25bb5422158be43d46d16` |
| `supabase/migrations/20260806152004_gridex_aud_001_storage_helper_private_schema.sql` | `ae8274a9a37a1ecf672ae1257ee225619fbc48369aaf929af5f07f63e8241d5f` |
| `supabase/migrations/20260810190410_gridex_canonical_architecture_p0.sql` | `68b259983310c0930601b8b0e2456a00137688840bbbaa44dd46347018e93685` |
| `supabase/migrations/20260810193450_canonical_access_provisioning_runtime_v1.sql` | `390b0223a8fbafb633795f1ad0116d6cf8ebbddea056226be84711e7d878a4b8` |
| `supabase/migrations/20260810224500_canonical_review_remediation_v1.sql` | `12fb80b8c13f7e105e4c5b63a6145e863872874fd4a2caaea9f669df5a80010d` |
| `supabase/migrations/20260812210800_gridex_rls_policy_normalization_v1.sql` | `2d9609109928967f571401864893a47bee1598bce8b115b5f26f3fadc236643a` |
| `supabase/migrations/20260814162500_tenant_rls_lifecycle_hardening.sql` | `e2eee5be4e4c795380782248683bfd32b682a66b2e2882a1fd241c9acc7498b2` |
| `supabase/migrations/20260826093000_platform_dashboard_and_rls_read_performance.sql` | `f9084068f4eead62330b1b394b6b4cab5f47ff68b411bdb144009314c2b85a2c` |
| `supabase/migrations/20260902091000_company_scoped_permission_engine.sql` | `dc72cc26cbb53ab814fcf214dc9324f27bfac9f4bf77940b9e9a0527428f359a` |
| `supabase/migrations/20260902094500_decouple_contract_sales_from_ediel_send_state.sql` | `88831015a6f70723b647bc9e6b5091a3c56c40f16ce48ee824456577b10c8c9a` |
| `supabase/migrations/20260902100000_rpc_surface_and_permission_scope_corrections.sql` | `9753cd0f10a120a32826286a0eeb08d6f7e2b51704014decf60243e5eaa1a919` |
