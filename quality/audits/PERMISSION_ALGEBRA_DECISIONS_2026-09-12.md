# Permission algebra decisions for Task11

2026-09-12. Bounded read-only follow-up to `quality/audits/RLS_PERMISSION_NATIVE_CONTRACT_2026-09-12.md`. No application, SQL, memory, workflow, production or native-database changes. Existing role-deny behavior and override `valid_from`/`valid_to` boundaries remain fixed requirements; session semantics and table-policy permission-key mapping are outside this task.

**Recommendation:** retain the legacy direct-grant relation as a filtered, explicitly scoped allow source; preserve NULL-company grants as a compatibility choice only within an already-authorized company scope; calculate shared permissions by unioning each active company's effective set after applying that company's overrides. Do not introduce a new permission-catalog activation switch incidentally in the override fix: current writers/readers do not establish one. The global-direct recommendation is an explicit inference for compatibility, not an established UI feature.

## Established source facts

| Question | Evidence | What it establishes |
|---|---|---|
| What is a direct grant? | `01_db1_schema_repair_core_helpers_and_canonical_tables.sql:467–479`, equivalent foundation `20260522_db1_schema_repair_backfill_foundation.sql`, and supplemental `supabase/schema.sql:67677` | `user_permissions` has nullable company, UUID/key fields, effect default allow, status default active and is_active default true; current snapshot makes the latter three NOT NULL. No time-window columns on this relation |
| Were activity/effect fields ever interpreted? | Foundation helper `gridex_can(text)`, around lines690–702 in `01_db1...` | Direct rows required `coalesce(status,'active')='active'`, `coalesce(is_active,true)` and `coalesce(effect,'allow')='allow'`. It did not make direct deny a veto. Historical evidence only: September audit records gridex_can as dead code |
| What do current array resolvers do? | `20260902091000_company_scoped_permission_engine.sql::gridex_get_user_permissions_in_company`; `20260902100000_rpc_surface_and_permission_scope_corrections.sql::gridex_get_user_permissions` | Both union direct rows joined by permission_id, but ignore company/status/is_active/effect. Neither reads override rows. Role allows already require active assignment/role and correct membership/global platform scope |
| Does canonical selected context include direct grants? | `20260810193450_canonical_access_provisioning_runtime_v1.sql:649–659`, scoped body later renamed by `20260810224500_canonical_review_remediation_v1.sql`, delegated to by September2 wrapper | No: context currently builds only role allow permissions. Resolver parity therefore requires a conscious decision whether to include filtered direct grants, not an assertion that it already does |
| Current application direct writers? | Complete `user_permissions` reference search in `app/` and `lib/` | Only `app/admin/users/actions.ts::deleteUserCompletelyAction` references that table, as user-id deletion cleanup. No current app/lib create/update/upsert writer, no direct-grant UI, no current application direct reader was found |
| Historical SQL direct writer? | Complete named-relation references in migration directory | Foundation create/alter, permission predicates, RLS/hardening declarations; no supported insertion/update command granting ordinary users NULL-company direct permissions found. This cannot prove the table has no deployed rows or external historical writers |
| What do individual permission forms actually write? | `app/admin/users/[id]/actions.ts`, `app/admin/users/actions.ts::setUserPermissionOverridesAction`, `lib/admin/platformUserAccess.ts`, `20260802203000_canonical_runtime_consistency_hardening.sql::canonical_manage_platform_user_access` | They write `user_permission_overrides`, not user_permissions. SQL validates an authoritative platform actor but target can be any existing nondeleted auth user. NULL-company overrides for ordinary targets are a real supported writer path |
| Is the distinction intentional? | `20260525_debug_step2_code_schema_alignment.sql:62–65` | Explicit comment says admin overrides are stored in user_permission_overrides, not user_permissions |
| Product override meaning | `app/admin/users/[id]/page.tsx:80`; `lib/rbac/getUserPermissions.ts` final merge | Role is base access, individual override is allow/deny beyond it; legacy application comment intends deny to win after role fallback. The current row-order-dependent loop is not a deterministic cross-company algebra |
| Catalog activity contract | Foundation `permissions` table around435 and `supabase/schema.sql:64865` | `permissions.is_active` exists, NOT NULL/default true. Column presence alone does not establish a live deactivation workflow or its effect on authority |
| Current catalog consumers/writers | `lib/rbac/getAllPermissions.ts`; `lib/rbac/getAdminUserById.ts`; admin roles page; override actions; canonical writer at `20260802203000...:637–645,668`; both latest array resolvers and scoped canonical context | Catalog reads and grant validation accept existing keys irrespective of is_active. Current role/context permission joins also do not filter catalog activity. No app/lib catalog activation writer or migration statement setting this field false was found in the bounded scan |
| Shared permissions contract | Complete `20260902100000...` F-18 rationale/body; `quality/audits/TENANT_TARGET_ARCHITECTURE_AND_REGISTER_2026-09-02.md:373` | Shared grid owners/price areas/electricity suppliers must remain available when a permission is held in any active membership. The prior platform-only narrowing broke this and was deliberately corrected |

The admin detail page is the only current caller of `lib/rbac/getUserPermissions.ts` found by function-use search. Its legacy fallback is a display calculation, not proof that canonical target authorization should regain cross-company unions. Do not use that display's all-memberships fallback as the implementation of tenant permission decisions.

## Direct-grant recommendation and decision boundary

**Established:** active/effect filtering is source-backed historical behavior; current unconditional direct union is weaker. Direct `effect='deny'` was historically excluded from the allow source, rather than a veto. Preserve that distinction, just as the task requires preserving the role allow union. Only explicit applicable override deny is a veto in this bounded change.

**Recommended compatibility inference:** retain direct grants instead of dropping the table wholesale. For ordinary user u and already-authorized nonnull company c, include a direct permission only when:

- user matches u;
- `coalesce(status,'active')='active'` and `coalesce(is_active,true)`;
- `coalesce(effect,'allow')='allow'`;
- `company_id=c OR company_id IS NULL`;
- the existing permission-id join resolves a nonnull key/name;
- the user's active membership in c still exists; direct grants do not create membership, identity, a selected company, or platform authority.

This treats a concrete company as a local grant and NULL as the existing legacy global grant shape **inside existing membership authority**. It fixes a B-scoped row granting in A without deleting every possible legacy NULL grant. Ordinary users with no authorized company receive no tenant authority from a NULL grant. This is a deliberately narrowed compatibility rule; current helpers admit even orphan/global direct rows, while current canonical context omits them all.

**Not established:** a current UI or supported command promising global ordinary `user_permissions` grants. Supported global ordinary **overrides** are different and must remain supported. Do not describe the direct-grant recommendation as an existing UI contract, and do not backfill NULL direct rows into every membership. If the parent elects to disallow NULL direct rows entirely, that is a separate compatibility decision requiring a synthetic characterization and eventual approved metadata-only deployment check; this audit does not select or inspect real users.

Keep current permission-id→`coalesce(permission.key,permission.name)` resolution for direct rows in the narrow fix. The older dead helper also accepted the `user_permissions.permission_key` alias, but latest array helpers do not. Adding alias fallback would activate previously ignored rows and is not required for override parity. No expiry rule should be invented for the direct relation.

## Catalog activity: least-changing decision

**Recommendation for Task11: preserve current catalog membership semantics**—an existing resolvable key remains eligible even if permissions.is_active is false. This follows current canonical context, array resolvers, writer admission and dropdown behavior. It avoids silently turning the override migration into a catalog retirement feature.

This is a compatibility recommendation, not a claim that ignoring the flag is an ideal long-term design. Source alone does not establish whether false means “hidden from new assignment”, “retired but honors legacy assignments”, or “must revoke every grant immediately”. Each is materially different. No supported writer or product copy settles it in this bounded pass.

If catalog deactivation is explicitly chosen for the implementation, document that as an additional policy change and apply it consistently to role/direct/override positive sources, catalog-aware assignment validation, and effective-permission display. Preserve deny safety and the independent authoritative platform bypass. An override-only catalog filter would be inconsistent: an inactive key could remain granted by a role even while its deny override disappeared. Missing catalog keys should never create new positive authority; deterministic denies for matching keys should not be dropped merely because a catalog row is inactive. Do not modify role-deny precedence as part of this decision.

## Exact least-changing override algebra

Use a single evaluation timestamp t; override validity remains inclusive:

`active(o,t) = coalesce(o.is_active,true) AND (valid_from IS NULL OR valid_from <= t) AND (valid_to IS NULL OR valid_to >= t)`.

Retain the existing validity columns. `granted_at`/`expires_at` displayed as UI aliases do not add a second authorization clock. Keep the role assignment/role definition/membership activity semantics and global platform-role scope trigger already established by F-2/F-7.

For ordinary u and nonnull company c:

- `R(u,c)`: current active company-role allow union backed by active membership. Role deny rows do not subtract another role's allow.
- `D(u,c)`: direct allow source under the explicitly recommended compatibility rule above. Direct deny rows are not grants and do not subtract another source.
- `O+(u,c,t)`, `O−(u,c,t)`: active/time-valid overrides with exact user and `(company_id IS NULL OR company_id=c)`, separated by allow/deny effect.
- `E(u,c,t) = (R(u,c) ∪ D(u,c) ∪ O+(u,c,t)) \ O−(u,c,t)`.

E is meaningful only within the existing company authority boundary. Canonical context must retain its existing identity/profile/selection/role-admission logic; the calculation does not replace that logic. The array helper's ordinary-company branch must require active membership so direct/override rows cannot become a membership bypass. No change to company lifecycle or operation gates follows merely from having a key in E.

All applicable override denies win: global deny versus local allow, local deny versus global allow, duplicate conflicting rows regardless of insertion order. An unrelated-company override is not applicable. Unknown/null effects grant nothing. Canonical context and company array should obtain the same effective key set after successful ordinary context admission; do not leave context role-only while changing a boolean wrapper.

For shared masterdata, let `C(u)` be the user's active membership companies under the existing F-18 membership criteria. Calculate:

`SharedOrdinary(u,t) = UNION over c in C(u) of E(u,c,t)`.

This must evaluate overrides **before** the company sets are unioned. It is incorrect to union all grants and then subtract every local deny: that would make an A-only deny veto B's independently valid shared-data grant. It is also incorrect to union unfiltered raw roles and apply only global overrides: that would ignore a local deny when it is the user's only applicable company grant.

For authoritative global platform roles/admin_users, retain a separate platform branch with its current role/fallback source and global override handling. A user with no membership must retain legitimate platform/shared permissions through that branch. Company-local overrides do not attach to a nonexistent platform company. The authoritative platform bypass remains a separate predicate and is not revoked by subtracting a key from a permission array; this report does not unify differing platform actor/session predicates.

For ordinary users without any active membership, SharedOrdinary is empty even if a global override/direct row exists. Global ordinary overrides remain useful across each company where the user has authority; they do not manufacture platform access. This scopes positive overrides without undoing the supported writer's ordinary-user target support.

### Required algebra cases

| Input for key k | A target | B target | Shared ordinary |
|---|---|---|---|
| Active memberships A/B, role allows both, local A deny | deny | allow | allow via B |
| Active memberships A/B, role allows A only, local A deny | deny | absent | absent |
| Active memberships A/B, local A allow, no role grant | allow after normal context admission | absent | allow via A |
| Active memberships A/B, global allow + local A deny | deny | allow | allow via B |
| Active memberships A/B, global deny + local A allow | deny | deny | deny |
| Active membership A only, B-local override allow | absent | no membership authority | absent |
| Active A role grant, B membership removed | allow | no membership authority | allow via A; no B contribution |
| Active A membership, direct B allow only | absent | no membership authority | absent |
| Active A membership, valid NULL direct allow | recommended allow after normal context admission | no membership authority | recommended allow via A |
| No memberships, ordinary NULL direct/override allow | no company authority | no company authority | empty under recommendation |
| Single active A role denies key, eligible direct A allow, no override | direct allow retained; role deny is a nongrant | according to B sources | union of effective sets |
| Direct deny plus role allow, no override | role allow retained | according to B sources | union of effective sets |

Native cases must also cover inactive/removed direct rows, inactive role assignment/definition, expired/future/inclusive override boundaries, duplicate conflicting rows in both orders, F-18 ordinary-positive and membership-free platform-positive controls. Catalog-false behavior must be explicitly asserted according to the parent's chosen policy, rather than left untested. These are test requirements, not executed evidence.

## Established, inferred, unresolved summary

**Established:** roles are scoped; role effects form an allow union; direct relation has activity/effect/scope fields; historical direct allow filtering existed; current UI writes ordinary-target global overrides; override time bounds are inclusive; F-18 requires any-active-membership shared access; authoritative platform bypass is separate.

**Recommended inferences:** retain filtered NULL/company direct allow compatibility within existing authority; global ordinary direct/override rows do not supply authority without membership; shared result is union of independently overridden company sets; preserve current catalog activation semantics for this bounded change.

**Unresolved beyond this task:** deployed direct-row usage/external writers, intended product meaning of permissions.is_active=false, permission-key-only legacy direct rows, full session revocation, table-operation permission mappings and complete native/deployed parity. No live access was performed to resolve these.

Verification performed: complete latest September2 resolver files, direct-relation definitions and references, current catalog/override consumers and command branches inspected; `git diff --check` passed for report hygiene. No SQL/app implementation, native DB, Vitest or permission runtime proof was executed in this decision-only subtask. SDD path is ignored by Git; explicit inclusion is needed if publishing.

## Controller implementation decision

2026-09-12: Adopt the bounded recommendation for Task11: preserve catalog membership semantics and role/direct allow-union behavior; retain filtered same-company or NULL-company direct allows only within active membership authority; applicable override deny wins at one timestamp using valid_from/valid_to inclusive bounds; shared ordinary permissions are the union of independently evaluated effective company sets. Canonical selected context retains its existing identity/profile/role/selection admission and platform authority. These are explicit compatibility/security choices based on the source analysis above, not a claim of deployed parity. No data backfill or permission-key alias activation is authorized.

## Controller clarification: ordinary effective-set admission

Before adding direct/override positives, the shared effective-company helper must require the ordinary canonical active identity/profile, active same-company membership, and at least one active same-company user-role assignment joined to an active role definition. Direct/override rows cannot revive authority after the last role or its definition is disabled. Keep original canonical output/selection structure; it may still expose its existing invalid-selection invariant result with empty permissions, but must not gain effective keys. The original August10 selection EXISTS checks user-role assignment activity without joining role-definition activity, while its memberships/roles/role-grant queries do join active definitions; characterize this exact difference in native tests rather than assuming selected_company_id alone proves role eligibility. Use the same eligibility before each ordinary shared-company set. Authoritative platform admission remains the separately preserved predicate and explicit native characterization.

## Native fixture correction: one active ordinary role per company

The existing source-preservation constraint governs fixture admission. Both August10 architecture sources create user_roles_company_user_single_active_uidx on(company_id,user_id) for nonnull company with active status/is_active; schema.sql records the same index. The earlier two-role same-company table example described an algebra hypothesis, not an authorized removal of that invariant. The native fixture must retain the index and assert a second active same-company assignment rejects23505 with unchanged rows. Characterize role-deny as a nongrant using a valid single-role A deny plus eligible direct A allow (which remains allowed), and an A deny/B allow shared-company control. No production role semantics or constraints change; impossible fixture positives are not admitted.
