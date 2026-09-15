# PR310 function and schema privilege dispositions — 2026-09-15

Status: source-backed preservation decisions for the bounded scope below; no
new migration requested. This is not schema acceptance, a native actor execution
receipt, or a claim of whole-schema equivalence. The existing strict gates and
reference remain authoritative.

## Evidence and scope

Artifact `pr310-schema-335f987f.zip`, artifact10394485748, ZIP SHA256
`4009f365e8b7e255611992a12c031df159da2e16a4e46875af25593668d4aecb`:
reference document `e404dd6b8493da3332e15fde7622ef22098157d7933d98c0bc0d3992e3818106`,
replay document `4b5d003fea640f0f2f52a3e410fc07a01988e92f5bc6cfc8b3055ec9c2709755`.
The artifact describes full144+514, before the separately promoted forward fixes.
Reference source is `supabase/schema.sql`, SHA256
`b46b90d7ff066d71964c9157044ac70b31b47cab114cfcbce5d270751012dd30`.

This review covers all three removed authenticated EXECUTE entries, all twelve
added PUBLIC EXECUTE entries and seven added anon EXECUTE entries, all five
schema-ACL deltas, and both changed function rows. The other91 added function
ACL entries are outside this bounded review. All22 scoped function-grant row
hashes were independently reconstructed from their five identity fields plus
`is_grantable=false`; there are no grant options in this scope.

## Three removed authenticated EXECUTE entries: preserve the removals

All three functions are SECURITY DEFINER and lack an internal authenticated
caller/tenant authorization test. Their historical authenticated grants are
therefore not an appropriate restoration target. No direct call to these three
names was found in `app/`, `lib/`, or `components/`; generated TypeScript RPC
catalog entries are declarations, not callers. External consumers were not
inventoried, so this is a repository application compatibility conclusion.

| Function | Body and application path | Concrete disposition |
|---|---|---|
| `gridex_db4b_archive_customer_registry_row(text,text,boolean,text)` | Final body in `20260728170000_live_schema_code_canonical_sync.sql:1000` counts, archives and updates customers by supplied identity/email across companies. `auth.uid()` supplies audit attribution, not authorization. Earlier body at `20260525_db4b_customer_registry_ediel_test_cleanup.sql:44` also removed portal shadow rows; the later body already fixes that behavior. | Preserve service-role-only direct invocation. Restoring authenticated EXECUTE would expose a privileged archive helper without a tenant check. No repository caller needs that grant. |
| `gridex_default_customer_number_prefix(uuid)` | `20260612203000_company_customer_number_prefix_hardening.sql:73` reads company configuration and sequence state for arbitrary supplied company UUID under definer rights. Called by the privileged number generator. | Preserve removal. Prefix calculation remains reachable internally through the authorized definer chain; authenticated RPC is unnecessary. |
| `gridex_next_customer_number(uuid)` | Same migration:106 reserves/increments the supplied company's number sequence; no membership authorization. `20260719120000_canonical_customer_number_assignment.sql:25` installs a SECURITY DEFINER insert trigger calling it; `20260801143000_canonical_multitenant_platform_hardening.sql:33` wraps it in service-only `canonical_next_customer_number`. | Preserve removal. Customer INSERT authorization remains at the table/RLS boundary; the definer trigger assigns the number without requiring callers to hold direct EXECUTE on the generator. |

The concrete removal source is the SECURITY DEFINER sweep in
`20260611190000_launch_linter_hardening_security_definer_rls.sql:212–233`:
it revokes PUBLIC/anon/authenticated and retains service_role for remaining
definers. Later CREATE OR REPLACE definitions retain existing ACLs.
`20260904120000_canonical_tenant_invariant_convergence.sql:76–86` explicitly
reinforces PUBLIC/anon denial and service-role access; it does **not** itself
revoke authenticated. This corrects the less precise attribution in the earlier
grant audit. Its comment about two service-client application callers covers
the broader migration's function set, not evidence of callers for these three.
Reference grants being removed are at `schema.sql:110709–110719,111613–111615`.

## Twelve PUBLIC and seven anon additions: bounded preservation

PUBLIC grants apply to every role, so the four DB2 helpers and event emitter are
also effectively executable by anon despite no additional explicit anon row.
That effective reachability is included in these decisions. The functions below
are all invokers; none acquires its owner's table privileges.

| Function | PUBLIC / explicit anon additions | Source, behavior and decision |
|---|---|---|
| `gridex_assert_same_company(uuid,uuid,text,text)` | yes / yes | `20260905141608_canonical_tenant_relationship_guards.sql:12–32`: compares only supplied values and raises23514 on two non-null unequal UUIDs. No table reads, writes or dynamic SQL. Preserve callable assertion; it cannot reveal or modify another tenant's data. |
| `gridex_customer_sites_company_guard()` | yes / yes | Same source:34–49; trigger returning NEW, checks the parent customer visible under the invoking principal. Preserve trigger/helper restoration. |
| `gridex_metering_points_company_guard()` | yes / yes | Same source:51–72; trigger checks customer and site. Preserve. |
| `gridex_customer_contracts_company_guard()` | yes / yes | Same source:74–105; trigger checks customer, both site links and metering point. Preserve. |
| `gridex_customer_legal_acceptances_company_guard()` | yes / yes | Same source:107–126; trigger checks customer and contract. Preserve. |
| `gridex_powers_of_attorney_company_guard()` | yes / yes | Same source:128–151; trigger checks customer and site. Preserve. |
| `gridex_billing_underlays_company_guard()` | yes / yes | Same source:153–181; trigger checks customer/site/metering point and deliberately prioritizes customer_contract_id over contract_id. Preserve authored precedence. |
| `gridex_db2_v4_table_exists(text)` | yes / no | `01_db2_full_view_preflight_schema_and_functions.sql:35–41`: public-schema `to_regclass` existence lookup. No elevated catalog rights or dynamic command execution. Preserve this bounded metadata helper. |
| `gridex_db2_v4_col_exists(text,text)` | yes / no | Same source:43–55: reads caller-visible `information_schema.columns`. Preserve metadata helper; it does not disclose row contents. |
| `gridex_db2_v4_text_has_value(text)` | yes / no | Same source:75–81: immutable null/blank normalization of caller input. Preserve. |
| `gridex_db2_v4_normalize_membership_role(text)` | yes / no | Same source:83–100: immutable fixed string mapping, with unknown inputs becoming member. It does not assign any role or update memberships. Preserve. |
| `gridex_emit_domain_event(uuid,text,text,text,uuid,uuid,text,jsonb,text)` | yes / no | `20260531111600_system_readiness_foundation.sql:467–533`: invoker reads an existing idempotency match or inserts a domain event and an outbox row. Preserve invoker definition and ACL; the function does not grant table access. Detailed reachability below. |

The six guard functions return PostgreSQL's `trigger` pseudo-type and require a
trigger context; granting EXECUTE does not make them ordinary callable RPCs.
Creating a new trigger also requires the table's TRIGGER privilege. Their
invoker reads remain subject to the firing principal's table permissions/RLS;
these checks supplement foreign keys and RLS and do not prove that an invisible
or missing parent is rejected by this guard alone. The source explicitly keeps
nullable/missing-parent behavior (`20260905141608...:1–8`). Existing attachment
statements are at:183–229. No app RPC callers of these twelve names were found.
The DB2 helpers have actual SQL consumers within their source, including role
backfill and diagnostic views; removing them solely because the reference lacks
them would break retained source effects.

For the event emitter, the underlying boundary is concrete:
`20260804121000_multitenant_website_application_flow_completion.sql:223–226`
revokes all event_outbox privileges from anon/authenticated and retains
service_role. Reference `schema.sql:115594–115597` records the same boundary;
the artifact has no grant delta for that table. `domain_events` likewise has no
grant delta: its reference ACL at:114550–114554 has authenticated/service_role,
not anon. Authenticated may inspect only domain events admitted by table RLS;
an idempotency hit returns the UUID of such a visible row. A new-event call
cannot complete its outbox insert as authenticated, and an error rolls back the
prior event insert. Service-role execution remains valid. This grants no new
anonymous event creation, arbitrary queue insertion or SECURITY DEFINER bypass.
Other roles can succeed only with their own underlying privileges.

These are preservation decisions, not a recommendation to enlarge grants.
They do not excuse the independently identified excess authenticated table
TRIGGER/TRUNCATE privileges addressed by the separate forward migration.

## Effective roles and schema ACLs

The compatible bootstrap creates anon/authenticated/service_role as NOINHERIT
roles (`scripts/sql/gridex-supabase-compatible-bootstrap.sql:17–26`); its
membership grants:49–50 grant those roles **to** authenticator/postgres, not the
reverse. It provides no membership from anon/authenticated into service_role.
PUBLIC still applies independently of NOINHERIT. The artifact projects explicit
ACLs, not role memberships or default ACLs, so this conclusion is scoped to the
reviewed fresh bootstrap and named application roles. A future inherited role
grant must be evaluated with `has_function_privilege`/`has_table_privilege`; this
audit does not assert a hosted project's unobserved role graph.

| Schema delta | Disposition |
|---|---|
| Removed postgres CREATE and USAGE; added pg_database_owner CREATE and USAGE | Preserve the fresh native/portable ownership model. `pg_database_owner` is the implicit role of the current database owner and initially owns public; replacing these ACL identities to match a dump emitted without ownership would manufacture ownership equivalence. No CREATE grant to anon/authenticated is added. |
| Added PUBLIC USAGE on public | Preserve for the named API-role scope: anon/authenticated/service_role already have explicit USAGE in both projections (`schema.sql:108956–108959`; bootstrap:86). This supplies neither table access nor function EXECUTE nor schema CREATE. It broadens name resolution for other roles, so it is not universal role-graph equality or blanket schema-ACL normalization. |

PostgreSQL documents [PUBLIC and privilege boundaries](https://www.postgresql.org/docs/17/ddl-priv.html),
[the database-owner role](https://www.postgresql.org/docs/17/predefined-roles.html),
and [function execution and security modes](https://www.postgresql.org/docs/17/sql-createfunction.html).
Trigger context and creation permissions are documented in
[trigger behavior](https://www.postgresql.org/docs/17/trigger-definition.html)
and [CREATE TRIGGER](https://www.postgresql.org/docs/17/sql-createtrigger.html).

## Both changed function rows, with exact hash reconstruction

The comparator's `body_md5` is actually `md5(pg_get_functiondef(oid))`
(`scripts/sql/gridex-db-parity-introspect.sql:65`), so it includes function
settings, not only executable body text. Both rows retain identity, arguments,
boolean return type, invoker security mode, STABLE volatility and function kind.

| Function | Exact reconstruction | Decision |
|---|---|---|
| `canonical_company_capability_enabled(uuid,text)` | Identical body at `schema.sql:2777`, `20260801143000_canonical_multitenant_platform_hardening.sql:137`, and `bootstrap/20260801_company_capabilities_foundation.sql:70`. Reference search_path public,auth,extensions gives body_md5 `01f133c86205b8b749e88364ce5c5a21`; replay public,pg_temp gives `eb2202c2400cb886e4c07485125ff1fa`. These reconstruct row SHA256 `d0eefa1c185c314d4be901f7d078558d51e1b178325daa8c54cc2c3e99297b2c` and `57d302862488cd06fc2e824055907c9e86d910df5947a5f04620b000413f7c46`. | Preserve replay source setting. Fully qualified company_capabilities lookup and identical predicates require company UUID, capability code, enabled and ready. No changed authorization predicate or definer elevation is evidenced. |
| `gridex_can(text)` | Reference inline body uniquely matches the common body in `01_db1_schema_repair_core_helpers_and_canonical_tables.sql:660` / `20260522_db1_schema_repair_backfill_foundation.sql:656` and `schema.sql:13385`; body_md5 `67602cc5720ebcac27281b4466a0d744`, row SHA256 `f46ab7dd1f81f7277cba046358e56f3ae4d0283cda300f84312029d8f170eeb0`. Replay uniquely matches `20260523_db3_tenant_isolation_rbac_enforcement.sql:114–136`; body_md5 `4492e24fb6777ba8c4ef045f78135218`, row SHA256 `7ba39f7eb46226646c8a02696cdfc89f9363d74cf6e6eb858121936360473695`. Both have public,auth,extensions. | Preserve the later source's delegation to gridex_has_permission rather than restore the obsolete inline evaluator. This is a functional change, not equivalence. Treat the shared evaluator's separately tracked permission-override repair as the repair boundary. |

`gridex_can` still rejects null input/identity, honors the separately guarded
platform-admin predicate and fails closed on errors. The old inline body checks
an allow override directly and independently scans permission/role rows; the
replay delegates to the current shared evaluator. The unchanged current
`gridex_get_user_permissions` body (`schema.sql:25790–25848`, source
`20260902100000_rpc_surface_and_permission_scope_corrections.sql:40`) imposes
active role and company-membership predicates absent from the old inline scan.
`gridex_has_permission` is a definer wrapper around that helper
(`schema.sql:26645–26657`), with authenticated EXECUTE retained at:111255.
Restoring the old body would sidestep that shared path.

The two implementations are not equivalent for direct overrides, role activity,
membership status and case handling. In particular, the current shared
permissions helper does not yet incorporate user_permission_overrides; the
existing staged `20260912052507_canonical_permission_overrides_and_storage_write_guards.sql`
repairs shared evaluators and is not silently treated as selected by this audit.
This is an already tracked authorization issue, not justification to restore
the old gridex_can body, which also lacks deny precedence and the later role
membership filtering. No direct app or remaining reference policy invocation
of gridex_can was found; its authenticated RPC grant remains a real supported
surface, so eventual actor verification must exercise the shared repair.

## Verification limits and required continuation

Executed locally: exact22 grant-row hash reconstruction; exact four changed-row
hash matches from independently rendered PostgreSQL function definitions;
source/body/ACL/caller inspection. No database or production query was executed
for this audit. No runtime, migration, reference, acceptance flag or shared
memory file was changed.

The concrete continuation is to preserve the reviewed source definitions and
grant removals, qualify effective named-role permissions on the actual native
result, and complete the existing shared-permission repair separately. Native
actor controls should verify direct RPC restrictions for the three
definers, trigger dispatch versus direct calls for the six guards, and emitter
outbox denial/rollback. These are execution gates for the scoped decisions,
not a remaining request to choose which schema version to keep.

## Exact scoped function-grant row hashes

All privileges below are EXECUTE and all rows have is_grantable=false.

| Delta | Function | Grantee | Row SHA256 |
|---|---|---|---|
| removed | `gridex_db4b_archive_customer_registry_row` | authenticated | `3b337d8b509908f9bae936d1ec9bae8fc51c85bdbdf9c0c3e40b0e0cf8af789d` |
| removed | `gridex_default_customer_number_prefix` | authenticated | `a2d0958bd2e24ba4b5fa4a66c929ab201acd3338bc137e894bb32594a052d53b` |
| removed | `gridex_next_customer_number` | authenticated | `8883eb2d1253ccb07343759234ab9c2dea3cd98bec6abc2ef210ea20ea4d0a1d` |
| added | `gridex_assert_same_company` | PUBLIC | `d3858e385f8226002d69d8f986216780f6f878b196bc18e236871cb4fd81746a` |
| added | `gridex_assert_same_company` | anon | `25961afb3e5527b046799d8d951a3c1923f5023692c4f996b8c279aea4ab6741` |
| added | `gridex_billing_underlays_company_guard` | PUBLIC | `ca6bfa4abe373bcddd49b8312241d88876ac2e424813cd081d70f25c67fc18cb` |
| added | `gridex_billing_underlays_company_guard` | anon | `e77aba4a2b20ab7a3752e86c98a1e217f6d8224c2dc8e44b8155630ffef519dd` |
| added | `gridex_customer_contracts_company_guard` | PUBLIC | `c6324726cc0c809966e7a23edd8ae96f7060bde395a0d5b8b4ee7c6925917b6c` |
| added | `gridex_customer_contracts_company_guard` | anon | `9d1ea1bae70452cfa7d8a5a94c93394e334a1d92e321aa4d059264c1975c0b8b` |
| added | `gridex_customer_legal_acceptances_company_guard` | PUBLIC | `62929463e31da80d84da5cb512dd374b2a9865a46b5b58760ca4920ca8c212cd` |
| added | `gridex_customer_legal_acceptances_company_guard` | anon | `4df0fad8eb040ae8d01dd0f1f311ae4cbbba65668f60dd79bb97ff018a82aeb2` |
| added | `gridex_customer_sites_company_guard` | PUBLIC | `002c2a7c712868159fe931993ac1280596966c4f4923561fb05fa276f48bdbd3` |
| added | `gridex_customer_sites_company_guard` | anon | `4b2906f8f97a6330367961281e040f93ac1b6a314ad6f3453babf3ddc821f99c` |
| added | `gridex_db2_v4_col_exists` | PUBLIC | `4f4039abbaacb759500b36f79fb30316f96ca4c714aeeb5e50d1574f5b35ae74` |
| added | `gridex_db2_v4_normalize_membership_role` | PUBLIC | `5d524f63f28bb531058fdff0c699a6cdb0df3f63461db7d828756d2f94bb0727` |
| added | `gridex_db2_v4_table_exists` | PUBLIC | `389ac53713b90f0069f7355b4ba6e5803222578da8472b37bfe57c3436bd2737` |
| added | `gridex_db2_v4_text_has_value` | PUBLIC | `2f132efe766ec1de05de6a5496160239e89c3715405aceea745b18a3ff52f47f` |
| added | `gridex_emit_domain_event` | PUBLIC | `c751693f4ab318954e67ff3b3297a226a441ef009da1755b42b7dc27f84ed748` |
| added | `gridex_metering_points_company_guard` | PUBLIC | `e6692dbb1d41ba0dcf09d6c4e7c95a132b0081eac684480826d69f8634fa607b` |
| added | `gridex_metering_points_company_guard` | anon | `bde01e9bc86973e0c8661c2fb8759d13b5d9b2b2455b86919940085ecb34d41c` |
| added | `gridex_powers_of_attorney_company_guard` | PUBLIC | `69e6572148a7390bb436626658007430b10cf5883b8d29ccf17a788b0fe48196` |
| added | `gridex_powers_of_attorney_company_guard` | anon | `474afbf9b59d005de3e662b166d26812e495f73ee061da4c0c6fb9c1452644c6` |

## Source file pins

All paths below are under `supabase/migrations/`.

| Source | SHA256 |
|---|---|
| `20260611190000_launch_linter_hardening_security_definer_rls.sql` | `b696379a5e1d26bde5fae150d7c51e9d40df029a9dfd605810ad9051b1fb74d1` |
| `20260904120000_canonical_tenant_invariant_convergence.sql` | `3e40f894ec109a45e4dd7842edd819509caadac1e8d5e89a45d244224d0c77e1` |
| `20260612203000_company_customer_number_prefix_hardening.sql` | `39f6c82ca05f6876e347c58f2b60a24c358c9a72fe856e42d7474f03f9f66065` |
| `20260728170000_live_schema_code_canonical_sync.sql` | `4b1af824f75423faa393d60b845d3b39a3998bcfc7d7ea1cec2a54aa8d3bd400` |
| `20260905141608_canonical_tenant_relationship_guards.sql` | `8e1ec819b7775072ff04370e2ce7327793e094acf248a971968565e643bfe8f5` |
| `01_db2_full_view_preflight_schema_and_functions.sql` | `4de50050384d6892612c16484de8b198785c59cbb5d2ff03e7cea7e600d36cc9` |
| `20260531111600_system_readiness_foundation.sql` | `e6ef68b18ede5729da067ce59a86cfca0db083d9d54a35ae0ed3a6c0968b96f2` |
| `20260804121000_multitenant_website_application_flow_completion.sql` | `88bf5a6b7e0dc4d89b1621f1e3d551a6cd407135950f48ff05a37022df653b2f` |
| `20260523_db3_tenant_isolation_rbac_enforcement.sql` | `ac4d51086e0d6865de6012cc5e84ca524a59c094daccf987261afa2580a9f450` |
| `20260801143000_canonical_multitenant_platform_hardening.sql` | `4de56322077ea89f72596bd9cd2de9f2bdae67c2b74c4721779410553b3326b0` |
| `20260902100000_rpc_surface_and_permission_scope_corrections.sql` | `9753cd0f10a120a32826286a0eeb08d6f7e2b51704014decf60243e5eaa1a919` |
