# Auth and provisioning immutable source effects — 2026-09-10

Status: **EVIDENCE COMPLETE FOR THIS NINE-SOURCE BOUNDARY; restoration is not executed or selected.** This matrix accounts for statements, not approved historical behavior or production parity. Its next action is the separately reviewed [restoration contract](AUTH_PROVISIONING_RESTORATION_CONTRACT_2026-09-10.md).

## Authority, routing and provenance

Pinned code: `9e1223659491bb77ec2f13855189e9dd729238e1`, tree `76bd532190382312ab4698b532d448e4709d1533`. The current-state receipt records OPS34470585925/auth102849298884 PASS all15 fixed commands, actual selected38 RBAC prefix and preserved30/31/32/33 fixtures; quality/build102849298861 and Ediel102849298882 PASS. This task does not rerun SQL or claim broader coverage. Earlier September6–7 reports are historical characterization/reconstruction evidence; their pending statements and old counts are superseded by that receipt. Generated-types and completeness gates remain red.

Activated: project SDD worker boundaries, brainstorming/source-backed design comparison, writing-plans for the executable handoff, Supabase security checklist and verification-before-completion. Read AGENTS, required memory/domain pointers and decisions/failures. `using-superpowers` explicitly exempts dispatched workers. Broad acquisition/spec-compliance fanout, scanner, UI/performance, deployment, hook installation and repository-wide audit workflows do not apply to this bounded evidence task. TDD/SQL execution/security advisors activate in subsequent implementation; independent review belongs to the controller. User authorization and the brief override skill default plan paths and execution-choice questions. No new agents, SQL/provider/production operations, credential generation or real-user reads.

All paths A–I below resolve under `supabase/migrations/`. SHA256 is computed over immutable bytes, matched against all `scripts/migration-history-manifest*.json` records containing that filename and the accounting record. No source text is copied into generated artifacts. Sensitive effects, if implicated by later sources, are referred to only by path and lines.

| ID | Immutable source | Lines | SHA256 | Current accounting |
| --- | --- | ---: | --- | --- |
| A | `20260519_company_invite_temp_password_sync.sql` | 415 | `09ed878125a71c77c792e004fd1a38c4fa56a0b23e0bc3eafeb62be271c85dc9` | UNCLASSIFIED |
| B | `20260520_direct_account_temporary_password_flow.sql` | 98 | `0fff8d88e6c89c4d4cf16ad1f760bf079b29b7d684b9e8d398efd2bbcead93ba` | UNCLASSIFIED |
| C | `20260520_direct_temporary_password_auth_sync_fix.sql` | 183 | `f81c427325e8ecdb9380038ebad994def06004f1a67cd6b7718247e090b632db` | UNCLASSIFIED |
| D | `20260527_debug_user_invites_role_flow.sql` | 80 | `3d47fa7e5307e3b4568e737a8ee54806e67049a41200b4581e25f1b479e2f107` | UNCLASSIFIED |
| E | `20260527_fix_company_user_creation_schema_safe_backfill.sql` | 222 | `e6a91a085651cd6c3cd6eb4b75faf35f7f4a061f2046824367247bc4ff9edd22` | UNCLASSIFIED |
| F | `20260527_fix_company_user_invite_runtime_columns.sql` | 160 | `bd83735afcfa2f4eeeda0bded43a447e0f060584c7fc28b2c6b6fd6c36d3560c` | SUBSTITUTED |
| G | `20260528_auth_provisioning_runtime_guard.sql` | 51 | `0c2455cbc31553f4be1f1a3fa2800f516295c972bcead8fbbd77c448d3f98026` | UNCLASSIFIED |
| H | `20260528_final_user_access_schema_safe_repair.sql` | 296 | `4968391d74a8ff813ce1f56a8b8d9ade682692d183988917e736d0f3c5857bd2` | UNCLASSIFIED |
| I | `20260528_fix_user_roles_without_role_column_and_compact_users.sql` | 190 | `394a8eba24370f0158d52ddc84ea0baf938f3ef94a9d561ae1e679475974f3ca` | UNCLASSIFIED |

Totals unchanged: **593 inputs = 522 FULL_FILE_SELECTED + 24 SUBSTITUTED + 43 UNCLASSIFIED + 4 EXPLICITLY_EXCLUDED; 67 unresolved**. Focused339 =279/21/35/4;56 unresolved. Scoped nine =8 UNCLASSIFIED +1 SUBSTITUTED. F's substitute is `bootstrap/20260527_company_memberships_role_key_foundation.sql`, SHA256 `46c5e05a35063f84547dcf6554bc378d9c90d62171cd38843383542c6fe602c5`, foundation ordinal38, preserveSourceReplay=false; it cannot account for F's invitations, catalog reactivation or alias backfills.

## Matrix conventions and shared semantics

Each matrix row is **one complete top-level SQL statement**, including the entire DO body. Child statement ranges in DO rows and the child register below preserve all guarded branches; no fragment is promoted to whole-source equivalence. All omitted line ranges are explicitly enumerated as comment/blank-only. No scoped file contains a stored function, explicit GRANT/REVOKE, policy, trigger, DELETE, BEGIN, COMMIT or ROLLBACK. G creates one view; its COMMENT/NOTIFY are metadata/notification effects, not executed diagnostic queries. Thus function signature/return/search_path/EXECUTE ACL are not applicable to A–I themselves; inherited triggers and effective relation privileges still matter.

All nine files have statement/autocommit boundaries under `scripts/gridex-aud-003-clean-replay.sh:338–345` (`psql -f`, ON_ERROR_STOP). A DO is atomic; a failure later in a file does not undo earlier committed units. Explicit fixture BEGIN/ROLLBACK can cover these nine because they contain no transaction control; existing forward reconstructions have their own BEGIN/COMMIT and must be tested outside an enclosing rollback-only fiction. In production a bounded whole-source apply would require explicit transactional composition and admission gating; this report authorizes none.

Common DDL rules: IF EXISTS guards relation absence only; IF NOT EXISTS guards names, not semantic identity. Existing columns retain wrong type/default/nullability/FKs; existing indexes retain wrong keys/order/predicate/uniqueness; existing table skips its whole CREATE shape. Native errors include42703 missing column,42P01 missing relation,42804 incompatible assignment/coalesce type,23514 CHECK,23502 NOT NULL,23503 FK,23505 uniqueness,42501 privileges,55P03 lock timeout. CHECK permits NULL unless separately NOT NULL. Unique partial indexes exclude the explicit NULL combinations in their predicates. No statement establishes authorization merely by carrying company_id.

Common DML rules: predicates select zero/one/all matching rows without tenant or current actor filters. IDs/company IDs are preserved on UPDATE; INSERT uses the source access pair and never verifies actor/session/company ownership. Existing triggers execute normally, so targeted rows can generate timestamp/audit/guard effects not named in SET. UPDATE expressions read old row values simultaneously. NULL and empty strings differ from whitespace. LEFT JOIN does not prove referential integrity. NOT EXISTS is not concurrency serialization; unique constraints may reject races, absent uniqueness may duplicate. DISTINCT ON ties without a unique final sort key are nondeterministic. Retry after an autocommit partial run can preserve data loss or accumulate extra grants; catalog idempotence is not effect idempotence. No automatic deduplication, credential issue, account activation or rollback via inverse UPDATE is approved.

Membership vocabulary MROLE = owner/admin/company_admin/operations/support/member/viewer; MSTATUS = active/invited/pending/suspended/disabled/removed/removed_from_company/invitation_revoked/locked_security/revoked. Invitation vocabulary I5 = pending/accepted/revoked/expired/invitation_revoked; I8 adds invited/sent/failed. The canonical delivery vocabulary additionally includes sending/delivery_uncertain. These sets are not interchangeable with role_key or user_roles authorization.

## A — `20260519_company_invite_temp_password_sync.sql`

| Unit | Source lines | Complete effect, guards and failure/retention boundary |
| --- | --- | --- |
| A01 | 5–5 | Create pgcrypto if absent; no extension relocation/version assertion. |
| A02 | 10–17 | Create profile ID PK/auth.users CASCADE FK, nullable email/name/phone, required creation/update timestamps. Existing relation skips every declaration. |
| A03 | 19–34 | Add profile identity/lifecycle/action fields, must-change flag/default false, password timestamps and update timestamp; existing columns skip type/default/NULL repair. |
| A04 | 36–37 | Drop named profile-status CHECK only. |
| A05 | 39–41 | NULL/trim-empty profile status becomes active. |
| A06 | 43–45 | Case/trim normalized inactive, blocked, banned or suspended profile status becomes disabled. |
| A07 | 47–49 | Any remaining exact non-vocabulary profile status becomes active, including unknown/case-mismatched states. |
| A08 | 51–53 | Validate profile-status CHECK: active, disabled, removed_from_company, invitation_revoked, locked_security; nullable preexisting values pass SQL CHECK. |
| A09 | 55–56 | Create profile index (must_change_password, temporary_password_expires_at); name collision skips definition repair. |
| A10 | 61–79 | Create membership fallback: ID PK/random default; company/user nullable and no FKs; role member/status active; nullable email and actors/lifecycle times; metadata and created/update timestamps required. Existing core table skips all. |
| A11 | 81–98 | Add membership columns shown at lines82–98; IDs/defaults, nullable company/user/actors, role/status defaults, metadata/time defaults. Does not add PK/FKs/NOT NULL to existing shape. |
| A12 | 100–101 | Drop membership-status CHECK. |
| A13 | 103–105 | NULL/trim-empty membership status becomes active. |
| A14 | 107–109 | Deleted/delete/removed_from_tenant normalized aliases become removed. |
| A15 | 111–113 | Inactive/blocked/banned normalized aliases become disabled. |
| A16 | 115–117 | Unknown exact membership status becomes active; suspended/revoked/removed and other admitted disabled states remain. |
| A17 | 119–121 | Validate ten-state membership CHECK (see vocabulary below). |
| A18 | 123–124 | Drop membership-role CHECK. |
| A19 | 126–128 | NULL/trim-empty membership role becomes member. |
| A20 | 130–132 | Company-owner/company_owner/bolagsansvarig/responsible normalized aliases become company_admin. |
| A21 | 134–136 | Unknown exact membership role becomes member; no role-key/user_roles reconciliation. |
| A22 | 138–140 | Validate seven-role membership CHECK. |
| A23 | 142–144 | Unique partial membership index (company_id,user_id), both non-NULL. Duplicate non-NULL pairs fail 23505; NULL pairs excluded. |
| A24 | 146–147 | Membership company/status nonunique index; matching name skips. |
| A25 | 149–168 | Create invitation fallback with ID PK, nullable company/no FK, required email/role/status, names/role_key/actors/lifecycle/hash/password metadata, required JSON/timestamps. It does NOT declare token or invitation_token. |
| A26 | 170–188 | Add invitation runtime columns; existing columns skip constraints/default changes, no actor FKs here and no token UUID field. |
| A27 | 190–191 | Drop invitation-status CHECK. |
| A28 | 193–195 | NULL/trim-empty invitation status becomes pending. |
| A29 | 197–199 | Deleted/cancelled/canceled/disabled normalized aliases become revoked. |
| A30 | 201–203 | All other exact states outside five-state CHECK become pending: sent/sending/delivery_uncertain/invited/failed are lossy regressions if present. |
| A31 | 205–207 | Validate invitation five-state CHECK: pending, accepted, revoked, expired, invitation_revoked. |
| A32 | 209–210 | Drop invitation-membership-role CHECK. |
| A33 | 212–214 | NULL/trim-empty invitation membership role becomes member. |
| A34 | 216–218 | Company-owner/company_owner/bolagsansvarig/responsible aliases become company_admin. |
| A35 | 220–222 | Unknown exact invitation membership role becomes member without role_key reconciliation. |
| A36 | 224–226 | Validate seven-role invitation CHECK. |
| A37 | 228–230 | Unique partial accept_token_hash index on non-NULL text; duplicate hash fails; NULL permitted. Hash contents are never invented. |
| A38 | 232–233 | Invitation index (company_id,status,created_at DESC). Name overlaps source S/index reconstruction; IF NOT EXISTS preserves earlier two-key index if present. |
| A39 | 235–236 | Invitation index (lower(email),status,created_at DESC). Name collision likewise preserves earlier definition. |
| A40 | 241–252 | Create event fallback: ID PK/random default, nullable user/company/actor/email without FKs; event_type unknown/status sent/source app defaults; JSON/timestamp required. Existing event table skips declaration. |
| A41 | 254–263 | Add event columns; no repair to IDs, FKs or NOT NULL on existing table. |
| A42 | 265–266 | Drop event-type CHECK. |
| A43 | 268–269 | Drop event-status CHECK. |
| A44 | 272–274 | NULL/trim-empty event_type becomes unknown. |
| A45 | 276–277 | Normalize every event_type by trim, hyphen-to-underscore, lower; all rows targeted. |
| A46 | 279–281 | Invite/invited/user_invited/invitation_sent event types become invite_sent. |
| A47 | 283–285 | Password_reset/reset_password/recovery/recovery_email become password_reset_sent. |
| A48 | 287–289 | Confirm/confirmed/confirmation/email_confirmation become confirmation_sent. |
| A49 | 291–310 | All remaining types outside the 16-value source vocabulary become unknown; information loss. |
| A50 | 312–331 | Validate exact 16-value event_type CHECK listed in source312–331; notably no direct_user_linked. |
| A51 | 333–335 | NULL/trim-empty event status becomes sent. |
| A52 | 337–338 | Normalize every status by trim, hyphen-to-underscore, lower. |
| A53 | 340–342 | Success/succeeded/ok/done/complete/completed become sent; executed characterization proves completed→sent. |
| A54 | 344–346 | Failure/fail/smtp_failed/send_failed become failed. |
| A55 | 348–350 | Used/consumed become accepted. |
| A56 | 352–354 | Cancelled/canceled/deleted become revoked. |
| A57 | 356–376 | Other status outside 17-value source vocabulary becomes unknown. |
| A58 | 379–380 | All rows receive trimmed status with empty/NULL replaced by unknown. |
| A59 | 382–402 | Validate exact 17-value event-status CHECK listed at source384–401; no completed. |
| A60 | 404–405 | Event company/created DESC index. |
| A61 | 407–408 | Event lower(email)/created DESC index. |
| A62 | 413–415 | If user_roles exists, add status default active/is_active default true. No row normalization, FK, role mapping or RLS. |

Non-mutating comment/blank ranges: 1–4, 6–9, 18, 35, 38, 42, 46, 50, 54, 57–60, 80, 99, 102, 106, 110, 114, 118, 122, 125, 129, 133, 137, 141, 145, 148, 169, 189, 192, 196, 200, 204, 208, 211, 215, 219, 223, 227, 231, 234, 237–240, 253, 264, 267, 270–271, 275, 278, 282, 286, 290, 311, 332, 336, 339, 343, 347, 351, 355, 377–378, 381, 403, 406, 409–412.

## B — `20260520_direct_account_temporary_password_flow.sql`

| Unit | Source lines | Complete effect, guards and failure/retention boundary |
| --- | --- | --- |
| B01 | 5–5 | Create pgcrypto if absent. |
| B02 | 7–57 | One atomic DO, skipped if profiles absent. Child effects:10–13 four ADD COLUMN statements for password flag/set/change metadata and active_company_id with companies SET NULL FK;15 drop status CHECK;16–18 revalidate five states;23 add action;24 drop action CHECK;26–29 blank→NULL;31–40 lower/trim/hyphen/regex normalization;42–45 truncate non-NULL actions to120;47–55 validate NULL or <=120 matching allowed lowercase letters/digits/underscore/colon/dot. Preexisting active_company_id skips inline FK; values/types never validated by column guard. No auth account/password write. |
| B03 | 59–78 | One atomic DO, skipped if memberships absent:62 drop/63–65 seven-role CHECK;67 drop/68–70 ten-status CHECK;72–76 add disabled_at, disabled_by auth SET NULL FK, removed_at, removed_by auth SET NULL FK, status_reason. Existing actor columns skip REFERENCES; known loss repaired separately. |
| B04 | 80–98 | One atomic DO, skipped if invitations absent:83 drop/84–86 seven-role CHECK;88 drop/89–91 five-status CHECK;93 accepted_at;94 invited_user_id auth SET NULL FK;95 role_key;96 required metadata/default. Non-five-state rows cause 23514; existing invited_user_id skips FK. |

Non-mutating comment/blank ranges: 1–4, 6, 58, 79.

## C — `20260520_direct_temporary_password_auth_sync_fix.sql`

| Unit | Source lines | Complete effect, guards and failure/retention boundary |
| --- | --- | --- |
| C01 | 5–5 | Create pgcrypto if absent. |
| C02 | 7–13 | Add profile action/at, must-change flag/default and set/expiry/change password timestamps; existing columns retain shape. |
| C03 | 15–16 | Drop profile action CHECK. |
| C04 | 18–26 | Five named historical admin/direct action labels become direct_user_created. |
| C05 | 28–43 | Every other non-NULL action outside eleven-value list becomes NULL; flexible action erased. |
| C06 | 45–61 | Validate NULL-or-eleven-value action CHECK; later flexible normalizer must win catalog, but cannot recover erased values. |
| C07 | 65–72 | Guard event relation; drop event_type, action and status CHECKs as one atomic DO. No column tests inside. |
| C08 | 74–110 | Guard event_type column;80–82 three admin/direct labels→direct_user_created;84–86 blank/NULL→unknown;88–108 seventeen-value CHECK including direct_user_linked. Other unknown type fails 23514. |
| C09 | 112–142 | Guard action column;118–120 three admin/direct labels→direct_user_created;122–124 blank/NULL→invite_sent;126–140 eleven-action CHECK. Other unknown action fails 23514. |
| C10 | 144–173 | Guard status column;150–152 blank/NULL→sent;154–155 normalize all;157–159 five failure aliases→failed;161–163 success aliases including completed→created;165–167 other invalid values→sent;169–171 seventeen-state CHECK. After A, completed is already sent; C does not recover it. |
| C11 | 177–183 | Unconditional invitation UPDATE: pending + invited_user_id non-NULL + password-issued metadata non-NULL→accepted, preserve existing accepted_at else now, merge access/login metadata. No expiry/profile/auth existence/tenant state/session/role verification, no audit/outbox event; zero rows if predicate false, all matching rows otherwise. Expired metadata acceptance is executed historical evidence, never canonical approval. |

Non-mutating comment/blank ranges: 1–4, 6, 14, 17, 27, 44, 62–64, 73, 111, 143, 174–176.

## D — `20260527_debug_user_invites_role_flow.sql`

| Unit | Source lines | Complete effect, guards and failure/retention boundary |
| --- | --- | --- |
| D01 | 4–46 | Guard roles absent→return.12–14 add key/scope/company default/is_system required false. Loop14 catalog keys at18–31;34–39 overwrite name with key, fill only NULL description/scope, force is_system=true for every matching key;42–43 insert if UPDATE found no rows. Does not activate existing roles or force scope company when non-NULL; duplicates all updated, insert race can fail unique key. |
| D02 | 49–80 | Independent table guards. Membership52–53 add role_key/metadata;55 drop/56–58 seven-role CHECK;60 drop/61–63 ten-state CHECK. Invitation67–68 add role_key/metadata;70 drop/71–73 seven-role CHECK;75 drop/76–78 eight-state CHECK (five + invited,sent,failed), still excludes sending/delivery_uncertain. No normalization. |

Non-mutating comment/blank ranges: 1–3, 47–48.

## E — `20260527_fix_company_user_creation_schema_safe_backfill.sql`

| Unit | Source lines | Complete effect, guards and failure/retention boundary |
| --- | --- | --- |
| E01 | 8–8 | Create pgcrypto if absent. |
| E02 | 12–57 | Guard memberships.15–24 add role/key/status/email/inviter/timestamps/metadata.26–38 conditional multi-field backfill;40 drop/41–43 role CHECK;45 drop/46–48 status CHECK;50–52 partial unique pair index;54–55 company/status index. Exact NULL predicates, no blank-only predicate for role/status; SET sees OLD status, so empty status becomes active without necessarily setting accepted_at on first pass. No auth FK added. |
| E03 | 60–80 | Independent guards: roles63–67 add key/name/description/scope/is_active; user_roles71–78 add user/company IDs, legacy role text, role_id, status/is_active/time fields. Adds neither constraints nor indexes. |
| E04 | 84–122 | Guard roles.14-key seed loop94–107;110–115 fill blank/NULL name, NULL description/scope/is_active;118–119 insert if no row. Existing false is_active/non-company scope preserved; no role-ID rewrite; no conflict clause or lock. |
| E05 | 125–137 | INSERT missing profiles from auth.users with any membership OR user_role (including inactive/global). ID copied; lower email, metadata full_name/name, auth created timestamp, update now. Existing profile unchanged. Static table references mean to_regclass in WHERE does NOT protect missing relation; parallel insert can fail PK. |
| E06 | 140–178 | INSERT missing company/user membership pair from active-coalesced user_roles; DISTINCT ON pair picks latest coalesced updated/created/now with no tie-break. LEFT JOIN roles/auth allows unresolved roles/auth; role key prefers r.key over legacy ur.role. company_admin/admin→company_admin; finance/executive→viewer; else member. New active status/email/timestamps/source metadata; no existence of company/auth/profile or authorization check; any existing pair of any status suppresses INSERT. |
| E07 | 182–219 | INSERT active user_roles for active-coalesced memberships lacking ANY active-coalesced role for same pair. Explicit nonempty role_key wins; company_admin/owner/admin→company_admin, viewer→executive_readonly, ELSE company_admin (including member/operations/support). Joins exact roles.key, no is_active/scope check. Grants role without canonical authorization; does not revoke conflicts. Duplicate catalog or membership can create duplicates/native failure. |
| E08 | 222–222 | PostgREST schema-reload NOTIFY; delivered only on commit, no row mutation. |

Non-mutating comment/blank ranges: 1–7, 9–11, 58–59, 81–83, 123–124, 138–139, 179–181, 220–221.

## F — `20260527_fix_company_user_invite_runtime_columns.sql`

| Unit | Source lines | Complete effect, guards and failure/retention boundary |
| --- | --- | --- |
| F01 | 4–4 | Create pgcrypto if absent. |
| F02 | 6–117 | One DO, independent role/membership/invitation guards. Full child matrix below; role metadata additions, membership legacy alias and canonical columns, unconditional alias/status/time UPDATE, role/status CHECK replacement/indexes; invitation alias columns + unconditional identity/role/status/metadata UPDATE + CHECKs/index. A missing guarded relation skips its complete branch, not others. |
| F03 | 120–160 | Guard roles.14-key loop130–143;146–153 overwrite names with key, fill NULL descriptions/scope, FORCE is_system,is_system_role,is_active=true;156–157 insert otherwise. Reactivates disabled role catalog rows; preserves conflicting non-NULL scope, and does not validate assignability. |

Non-mutating comment/blank ranges: 1–3, 5, 118–119.

## G — `20260528_auth_provisioning_runtime_guard.sql`

| Unit | Source lines | Complete effect, guards and failure/retention boundary |
| --- | --- | --- |
| G01 | 4–4 | Create pgcrypto if absent. |
| G02 | 6–18 | Create auth_provisioning_events exactly: ID UUID PK/default random; created_at timestamptz NN/now; event_type text NN; status text NN/info; email text/user_id UUID/company_id UUID/actor_user_id UUID/project-ref text/message text nullable; details JSONB NN/empty-object. No actor/company/auth FK, status CHECK, RLS, grants, trigger or seed. Existing table skips every field. |
| G03 | 20–21 | Create nonunique company_id/created_at DESC btree index. NULL company allowed, no predicate. |
| G04 | 23–25 | Create nonunique lower(email)/created_at DESC btree index WHERE email IS NOT NULL. |
| G05 | 27–47 | CREATE OR REPLACE integrity view: full-join membership and user_roles on SAME company/user pair, full-join profiles on coalesced user, left-join auth by user; filters NULL coalesced user only. Eleven outputs detailed below. No WHERE tenant/session predicate and initially owner-security; inherited/preexisting ACLs are not revoked. Wrong existing output order/type fails 42P16. |
| G06 | 49–49 | COMMENT ON view replaces description only; no data read or integrity assertion. |
| G07 | 51–51 | NOTIFY reload schema; no diagnostic SELECT is actually executed by this file. |

Non-mutating comment/blank ranges: 1–3, 5, 19, 22, 26, 48, 50.

## H — `20260528_final_user_access_schema_safe_repair.sql`

| Unit | Source lines | Complete effect, guards and failure/retention boundary |
| --- | --- | --- |
| H01 | 7–7 | Create pgcrypto if absent. |
| H02 | 9–118 | One DO, independently guarded roles/user_roles/memberships; full child matrix below. Adds canonical shape only, normalizes nullable access fields to active, adds active-role indexes/partial uniqueness and membership CHECKs/indexes. Does not validate auth/company existence or role assignability. Conflict/type/data failures roll back DO, not previously autocommitted source statements. |
| H03 | 121–151 | Guard roles. Six-key loop131–136 (company_admin, operations_manager, operations_agent, customer_service_agent, finance_readonly, executive_readonly);139–144 fill blank name/NULL description/scope/is_active;147–148 insert missing key. Preserves non-NULL inactive/scope/custom names; no lock/conflict handling. |
| H04 | 154–166 | INSERT missing visible profiles: same relational predicate/projection as E125–137; inactive/global access rows count. Static missing-table failure despite WHERE guard. |
| H05 | 170–216 | INSERT missing membership from active-coalesced user_roles with DISTINCT ON pair; latest coalesced updated/created/now, ties unspecified. r.key/r.name maps company_admin/admin/owner→admin; operations pair→operations; service/support→support; finance/executive→viewer; else member. LEFT joins permit missing roles/auth, stamps active, identity/time/source metadata; any existing pair suppresses. |
| H06 | 219–247 | UPDATE missing/empty membership role_key or membership_role from latest active-coalesced role per pair (same map as preceding INSERT); existing nonempty values preserved, updated_at always now for targeted rows. Membership status is NOT filtered: an inactive membership can receive role metadata while remaining inactive. NULL unresolved key leaves row eligible on repeat. |
| H07 | 251–294 | INSERT missing active role-ID for active-coalesced membership. Explicit role_key wins; role categories admin/operations/support/viewer map to company_admin/operations_manager/customer_service_agent/executive_readonly; ordinary member→NULL and skipped. Joins roles by coalesced key/name, no active/scope/assignability predicate. Suppresses only same active role_id, so conflicting active role remains and new extra role is added. No legacy role text inserted. |
| H08 | 296–296 | NOTIFY reload schema, commit-delivered. |

Non-mutating comment/blank ranges: 1–6, 8, 119–120, 152–153, 167–169, 217–218, 248–250, 295.

## I — `20260528_fix_user_roles_without_role_column_and_compact_users.sql`

| Unit | Source lines | Complete effect, guards and failure/retention boundary |
| --- | --- | --- |
| I01 | 4–4 | Create pgcrypto if absent. |
| I02 | 6–67 | One DO independent guards: user_roles9–18 add ID/user/role/company/status/active/created/disabled actor/reason;20–27 fill NULL/empty status→active, NULL active→true, missing created→now. Membership31–48 add ID/company/user/role/key/status/email/inviter/time/actors/reason/JSON/times;50–65 fill NULL/empty role/status, dates/JSON. accepted_at missing alone is NOT a WHERE trigger; SET tests OLD status. No updated_at added to user_roles and no indexes/CHECKs/FKs created. |
| I03 | 70–148 | Guard all three access tables.76–116 INSERT membership per active role row, without DISTINCT ON: multiple active roles for one absent pair create duplicate candidates and 23505 under canonical pair uniqueness. Maps r.key/name like H, omits email, stamps active and source metadata.118–146 UPDATE missing/empty membership role/key from DISTINCT ON pair ordered ur.created_at DESC NULLS LAST without tie-break; may also fill blank status/accepted time; includes inactive memberships for metadata. NULL key can remain eligible on repeat. |
| I04 | 151–187 | Guard all three tables.157–185 INSERT active user_role for active-coalesced membership, join roles by coalesced key/name = nonempty cm.role_key ELSE company_admin. Suppresses same active role-ID only; may add conflicting/admin role to member, inactive-profile or orphan identity. Does NOT compact/delete users despite filename/comment; no Auth mutation. No user_roles.updated_at or legacy role supplied. |
| I05 | 190–190 | NOTIFY reload schema, commit-delivered. |

Non-mutating comment/blank ranges: 1–3, 5, 68–69, 149–150, 188–189.

## DO child register and exact data boundaries

This supplements, rather than replaces, the complete DO units above. Each semicolon-terminated ADD/DROP/CREATE inside the listed ranges is a separate child statement, executed in textual order within its parent DO.

| Parent | Child statements and prerequisites |
| --- | --- |
| B02 |10,11,12,13 separate ADDs;15 DROP;16–18 CHECK;23 ADD;24 DROP;26–29 UPDATE;31–40 UPDATE;42–45 UPDATE;47–55 CHECK. Existing profiles must already have user_status, and companies/auth users must supply UUID PKs for any newly added REFERENCES. Regex at35 admits ASCII letters/digits/underscore/colon/dot after replacement; no synthetic credential is implied. |
| B03/B04 | B03:62 DROP,63–65 CHECK,67 DROP,68–70 CHECK,72/73/74/75/76 ADDs. B04:83 DROP,84–86 CHECK,88 DROP,89–91 CHECK,93/94/95/96 ADDs. Existing actor IDs referencing nonexistent Auth users fail new FK validation; columns already present bypass REFERENCES entirely. |
| D01 |12/13/14 ADDs;34–39 UPDATE and42–43 INSERT repeated over14 catalog keys. Requires id default, name, description (not added here). UPDATE matching duplicates counts as found and suppresses INSERT; only zero matches inserts. |
| D02 |52/53 ADDs;55 DROP;56–58 CHECK;60 DROP;61–63 CHECK;67/68 ADDs;70 DROP;71–73 CHECK;75 DROP;76–78 CHECK. Existing membership_role/status required. No status conversion, so newer delivery states reject narrow CHECK. |
| E02 |15–24 ten ADDs;26–38 UPDATE;40 DROP;41–43 CHECK;45 DROP;46–48 CHECK;50–52 UNIQUE INDEX;54–55 INDEX. company_id/user_id must already exist. Role/status blank rows with all other fields populated can bypass normalization then fail CHECK. |
| E03/E04 |E03:63–67 five role ADDs,71–78 eight user-role ADDs. E04:110–115 UPDATE/118–119 INSERT loop; roles id default and key/name shape required. |
| F02 roles |9–14 six ADDs. Required existing roles.name/id defaults are not repaired here. |
| F02 memberships |18–36 nineteen ADDs;38–56 UPDATE EVERY membership. Canonical membership_role wins legacy role when nonempty, legacy role preserved when nonempty: conflicting aliases remain conflicting. Missing role_key maps admin categories→company_admin, operations→operations_manager, support→customer_service_agent, viewer→executive_readonly, else original category/member. Status NULL/empty→active; NULL is_active→true independently (so suspended + NULL active becomes suspended + true); invited_at uses old joined_at/created_at; accepted_at tests old status.58 DROP;59–61 CHECK;63 DROP;64–66 CHECK;68–70 UNIQUE INDEX;72–73 INDEX. |
| F02 invitations |77–92 sixteen ADDs;94–102 UPDATE EVERY invitation. Each email alias uses its own nonempty value first, then other alias: two conflicting nonempty emails remain conflicting, neither is verified. Membership role and legacy role similarly coalesce old values; role_key maps only admin categories to company_admin and otherwise category/member (operations/support are not mapped to canonical system-role keys here). Existing NULL email and NULL alias remain NULL, causing23502 when email NN.104 DROP;105–107 role CHECK;109 DROP;110–112 I8 CHECK;114–115 two-key company/status INDEX. No token/accept hash is created or derived in this DO. |
| F03 |146–153 UPDATE/156–157 INSERT loop over14 keys. FORCE activation/system flags is a persistent effect; a later fill-NULL seed does not undo it. |
| H02 roles |12–17 six ADDs; added id gets random default but not PK. |
| H02 user_roles |21–31 eleven ADDs;33–42 UPDATE can convert unknown NULL access indicators to active/true.44–45 user/status/is_active index;47–49 partial company/user/status/is_active index;51–57 UNIQUE(company_id,user_id,role_id) WHERE all IDs non-NULL AND coalesced active status/flag. A preexisting exact name with wrong definition bypasses creation; existing duplicate active triple fails23505, NULL IDs excluded; different active roles per pair remain allowed. |
| H02 memberships |61–78 eighteen ADDs;80–99 UPDATE includes blank role/status and missing accepted_at for old-active rows.101 DROP;102–104 MROLE CHECK;106 DROP;107–109 MSTATUS CHECK;111–113 partial pair UNIQUE;115–116 company/status INDEX. |
| I02 |9–18 ten user-role ADDs;20–27 UPDATE.31–48 eighteen membership ADDs;50–65 UPDATE. Unlike H, no role-catalog column repair and no user_roles.updated_at. A reduced fixture lacking roles.key/name or required defaults is rejected by later DOs. |
| I03/I04 |I03:76–116 INSERT and118–146 UPDATE. I04:157–185 INSERT. Guards check only existence of all three tables; they do not prove compatible columns, PK/FKs, absence of duplicates, role scope or current user's right to grant access. |

D/F catalog loops contain14 identical role keys: company_admin, admin, operations_manager, operations_agent, customer_service_manager, customer_service_agent, sales_manager, pricing_manager, pricing_approver, finance_readonly, executive_readonly, compliance_manager, partner_manager, partner_api_user. E seeds the same14 with descriptive names and preserves nonempty names; H seeds the six explicitly enumerated in H03. None creates role_permissions. Existing inactive catalog flags are retained by E/H but forced true by F; later E/H cannot reverse that activation. Explicit non-company scope is preserved by all four, despite tenant-safe comments.

For G05, outputs in order are company_id UUID, user_id UUID, email text, has_auth_user boolean, has_user_profile boolean, has_company_membership boolean, has_user_role boolean, membership_status text, user_role_status text, user_role_is_active boolean, latest_seen_at timestamptz: **11 columns**. The projection never emits Auth-only users because auth.users is a LEFT JOIN from app rows. A profile-only row has NULL company. A role-only row carries its own company; a membership-only row carries its own company; a user in two companies produces separate rows; multiple roles multiply rows and duplicate membership rows can produce an m×n join. NULL company pairs do not equality-join, and NULL coalesced user rows are omitted. Missing Auth user reports false without deleting the app row. `latest_seen_at` is the first non-NULL cm/ur/profile/auth update/auth create value, not their maximum. No status/active filter: inactive records remain diagnostics. Same-user profiles can appear per company; neither boolean presence nor company label is authorization.

## Scoped dependency and canonical-consumer tracing

| Boundary | Source-backed current behavior and implication |
| --- | --- |
| Selected prerequisites | `01_db1_schema_repair_core_helpers_and_canonical_tables.sql:339–477` creates companies, membership/invitation, roles and user_roles; profiles foundation plus callback are foundation4/5. Core membership company FK remains RESTRICT and unique(company,user); membership user is not an Auth FK merely because UUID. `scripts/sql/gridex-supabase-compatible-bootstrap.sql:98–130` includes Auth email and created/updated timestamps needed by G; minimal Auth(id) fixtures do not. It deliberately does not reproduce relation default grants: role tests must add explicit hostile-default cases. |
| Frozen order | `scripts/gridex-aud-003-foundation-order.json` SHA256 `3e12e73296d350b635794c310072ba041bfc0cfeb3fa0725603ecb989d2a6bdc`,82 inputs; first33 token boundary and selected38 membership-role foundation remain fixed. RBAC files39–41 execute afterwards. No task inference changes those prefixes. |
| Invitation structural repair | `20260906081839_canonical_company_invitation_runtime_reconstruction.sql:14–25,29–47` adds runtime fields, actor FKs, token/hash indexes; SHA256 `d30a89a4fa793cddf3cf4560e1bb40bb2831505e911bd630c1409117e7f877f8`. It adds no row acceptance or email-alias backfill. Its name-only guards do not certify dirty existing definitions. |
| Membership actor repair | `20260907121951_canonical_membership_actor_fk_reconstruction.sql:10–48`, SHA256 `530dec49b180ba741340572e8117f7c47ac8ef60c6112a2b88a8bb195e90d27b`: disabled_by/removed_by must be validated nondeferrable auth.users SET NULL FKs; existing mismatching definition fails. B's skipped inline REFERENCES are not fixed by reapplying B. |
| Token prerequisite | `20260909123000_canonical_invitation_token_prerequisite.sql:1–94`, SHA256 `51f0b8df14704c4eb7d9cd6bccf59855ad0cbf7f5a0016bbfb10ea87078c25b2`, selected33. UUID token is a distinct field from legacy text invitation_token and passive password-issued/expiry timestamps. No alias equivalence or token hash generation follows from an old name. |
| Create/deliver | `lib/auth/companyInvitationFlow.ts:238–284` calls `canonical_create_tenant_invitation(jsonb)` and returns durable intent; only leased worker delivers. `20260810193450_canonical_access_provisioning_runtime_v1.sql:379–472` creates pending intent UUID token and SHA256 text hash after actor authorization; rows/jobs/audit/domain/outbox are company-attributed. RPC returns JSONB, PL/pgSQL DEFINER, EXECUTE service_role only; `20260810221500_canonical_invitation_delivery_hotfix.sql:11–16` sets public,auth,extensions,pg_temp search_path for create/provision. No scoped source replaces these functions. |
| Verified provider | `lib/auth/companyInvitationFlow.ts:102–234` resolves Auth identity through provider; existing user metadata update/OTP or new invite, no temporary-password assignment. Delivery UPDATE filters invitation ID+company+pending and records login_ready=false; failed delivery keeps durable intent. Worker `lib/tenant/provisioningWorker.ts` reads intent by company/idempotency and owns lease/retry path. This task does not call provider. |
| Token acceptance | `lib/auth/companyInvitationFlow.ts:286–367` hashes presented token, queries accept_token_hash, verifies server Auth user/email/user-ID and pending/expiry before `acceptCompanyInvitationAccess`. `lib/auth/companyUserAccess.ts:200–236` passes verified user to canonical RPC. Existing accepted branch returns early in TS; no stronger recheck is claimed for that branch. |
| Canonical acceptance authority | `20260802203000_canonical_runtime_consistency_hardening.sql:190–385` defines canonical_accept_tenant_invitation(jsonb)→JSONB, PL/pgSQL DEFINER/search_path public,auth,pg_temp, service_role EXECUTE only. Locks invitation/company and advisory pair, binds actor=user, handles idempotent prior results, then pending/expiry/invited-user/Auth not deleted or banned/active profile/email/company state/assignable mapped role checks before membership/role/audit/outbox writes. Its already-accepted/idempotent branches precede later active-profile checks; this is the exact existing contract, not a new guarantee. C177–183 bypasses the fresh-accept checks and event writes. |
| Membership consumers | `lib/auth/companyUserAccess.ts:49–110` verifies same-company active membership and active user_role, including role-key match. It cannot regard arbitrary role text, NULL access indicators or source default company_admin as verified authorization. `lib/tenant/governance.ts` and company-removal actions retain pending/revoked semantics; no selected scope requires the unsafe historical auto-grants. |
| Inherited invitation triggers | `20260802014000_canonical_provisioning_access.sql:368–385` defines guard_tenant_invitation_acceptance()→trigger, PL/pgSQL DEFINER/search_path public,pg_temp, attached BEFORE INSERT/UPDATE. It checks company status on transitions to accepted, not verified identity, expiry or role; a blocked company can make C fail later in the chain while valid-company C still bypasses fresh canonical acceptance. `20260810224500_canonical_review_remediation_v1.sql:563–585` defines canonical_enqueue_invitation_delivery_job()→trigger, DEFINER/public,pg_temp, EXECUTE revoked from PUBLIC/anon/authenticated/service_role, AFTER INSERT only, pending + nonempty idempotency_key→company-attributed job ON CONFLICT DO NOTHING. A/C/F invitation UPDATE does not invoke this INSERT-only delivery trigger. G/R reads through a view and never triggers either. |
| G consumer | `app/admin/system/auth-diagnostics/page.tsx:8–15,40–52` counts auth_provisioning_events via server service client after requirePlatformAdminAccess. `lib/admin/guards.ts:200–208` performs that gate. Search of app/lib finds no integrity-view consumer or event insert call. View remains a source-defined diagnostic artifact, not a required new public API. The page's separate provider probe is NOT run by this task. |
| G later security | `20260611150000_launch_readiness_security_routes_stats.sql:140–162` and `20260611170000_launch_readiness_completion_db_warnings_retention_bulk.sql:143–161` set the view security_invoker and revoke anon only if view exists. `20260611190000_launch_linter_hardening_security_definer_rls.sql:119–143` applies invoker + PUBLIC/anon revoke to all public views but catches per-object errors. `20260611203000_launch_rls_suggestion_policy_completion.sql:50–52,103–111,189–208` classifies event table platform-only, enables RLS/revokes anon, creates authenticated ALL policy using/with-check gridex_user_is_platform_admin. This is not blanket tenant access or proof that existing permissive policies/grants are gone. |
| Later policy semantics | `20260902092000_view_security_invoker_and_dead_policy_cleanup.sql:24–60` drops only policies wholly aimed at specified grant-less internal roles, not arbitrary authenticated/PUBLIC policies. The scoped sources create no permissive policy themselves. The earlier selected auth-email template policy is historical and remains subject to selected June consolidation/August restrictive tenant/session hardening; five-source RLS flag checks are not effective-role proof. No scoped DML is reversed by these later policy changes. Full final-chain catalog and role/session gate remains open. |

The only changed-view definition found for G is G27–47; later named sources alter options/ACLs rather than replacing its projection. D/E/F/H/I are one-time statements, not callable routines with later winners: their row effects survive unless a subsequent explicit statement changes them. H's safer no-default branch does not delete E/I's already-granted company_admin roles, and lexical H-before-I order lets I reintroduce the default. A/C status rewrites are not undone by later wider CHECKs. B's flexible CHECK is superseded by C unless the complete existing `20260520_user_profiles_auth_action_constraint_hardfix.sql` wins afterwards; recreating the flexible CHECK cannot reconstruct lost action content. The invitation repair intentionally preserves canonical expanded status validation instead of narrowing it.

## Reused executed evidence and exact omissions

Read `AUTH_INVITATION_CHAIN_REVIEW_2026-09-07.md`, `INVITATION_REPLAY_EFFECTS_2026-09-06.md`, `SAAS_TENANT_SOURCE_EFFECTS_2026-09-09.md` and `SYSTEM_DATA_INTEGRITY_ACCEPTANCE_2026-09-09.md`, plus the two named Python fixture programs and frozen invitation baseline. Reuse their actual evidence without relabeling the historical minimal fixture as selected82 replay:

- `scripts/canonical-auth-invitation-chain-selftest.py` runs template/A/B/C/cleanup complete bytes twice plus complete flexible normalizer, using extracted core tables/reduced companies and preceding auth/POA fixture. It proves completed→sent, unknown event type, flexible action erasure, expired issued-password invitation acceptance, suspended-member retention and skipped actor FKs. Its wrong cleanup order fails the named event-status CHECK. It does not prove the nine-source group or final policy/provider behavior.
- `scripts/canonical-membership-actor-fk-selftest.py` covers existing/missing/dirty/conflicting actor columns, exact validated FK and dirty rollback, repeats, SET NULL actor deletion and unchanged policies/membership status. It does not restore all B effects.
- The orphan DELETE branches of the specifically linked successor `20260520_company_delete_backfill_and_admin_layout.sql` are **not exercised by that FK-constrained fixture**. They are not in A–I (none deletes rows) and remain a separate reduced legacy-schema preservation/rollback gate. No claim of cleanup approval or whole successor equivalence follows.
- Expanded delivery CHECKs, canonical token aliases and active-user denial are preserved requirements. Role catalog force-activation, NULL→active, empty-role→admin, unknown-status→active/pending and profile action loss are characterized source effects to block/repair before any live data replay, not requirements to reproduce in production.

## Coverage receipt

The range check verified every source line belongs to exactly one complete top-level unit or an enumerated non-mutating comment/blank range. Nested comments remain inside their owning DO/CREATE statement. Counts below describe textual coverage only.

| Source | Complete units | Lines inside units | Explicit comment/blank lines | Total |
| --- | ---: | ---: | ---: | ---: |
| A | 62 | 336 | 79 | 415 |
| B | 4 | 91 | 7 | 98 |
| C | 11 | 165 | 18 | 183 |
| D | 2 | 75 | 5 | 80 |
| E | 8 | 198 | 24 | 222 |
| F | 3 | 154 | 6 | 160 |
| G | 7 | 42 | 9 | 51 |
| H | 8 | 276 | 20 | 296 |
| I | 5 | 180 | 10 | 190 |
| Total | 110 | 1517 | 178 | 1695 |

No new selected input, source checksum, historical SQL, generated artifact or root-owned status was changed by this document. Independent review and the exact prospective synthetic execution contract follow.
