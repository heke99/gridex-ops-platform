# DB2 controlled-reconciliation source effects — Task 23

Status: independent static characterization only. This document does not select a source, authorize replay, change accounting, propose a migration filename, or grant runtime access. Historical SQL remains immutable. The neighboring DB2B apply source remains independently excluded operational repair and was not opened or reclassified.

## Evidence boundary and identity

All five bodies were read completely once in bounded, line-numbered chunks. Local byte pins and `scripts/migration-history-manifest.json` agree:

| Source | Lines | SHA-256 | Whole-source class established here |
|---|---:|---|---|
| `01_db2_full_view_preflight_schema_and_functions.sql` | 1,079 | `4de50050384d6892612c16484de8b198785c59cbb5d2ff03e7cea7e600d36cc9` | Mixed schema, privileged executable repair engine, normalization DML, persistent diagnostics, and durable “dry-run” logging. It cannot be excluded wholesale. |
| `01_db2b_preflight_views.sql` | 106 | `884cc115dee1b169eae11ef37a2b319d894a85cff5971ebf050ad2be026e39d7` | Fixed-target assertion plus persistent diagnostic views. No row DML, but schema and identity exposure are real effects. |
| `02_db2_execute_controlled_reconciliation.sql` | 31 | `fcdc75e660f157a58e742f64b3e8f7a1c6801565ef16023bd0c9a317982744c9` | Operational reconciliation: metadata DML and nested membership/customer/audit effects. No direct DDL. |
| `03_db2_validation_and_finish.sql` | 127 | `74579e9fb883c1aba60933b1c82460164534d6bf171a7fb094b528f5bbb7224e` | Persistent validation views plus closeout DML that serializes diagnostic and personal data. |
| `03_db2b_validation_views.sql` | 163 | `f84d355c54d20bd0fcd3f86426bcd0e56435a1e8713fad3ec7a239f480a2b5e5` | Three persistent, fixed-target/broad-RBAC diagnostic views plus terminal reads. No row DML. |

`quality/audits/AUTH_GROUP_INPUT_INVENTORY_2026-09-07.json:21-119` records all five as `UNCLASSIFIED`, with empty derived artifacts/execution. Its lexical hints are candidate metadata, not effect authority. `quality/audits/LEGACY_REPLAY_CLASSIFICATION_2026-09-05.md:19-24` correctly prevents blanket exclusion but leaves helper, trigger, and prerequisite effects open. `quality/audits/OPERATIONAL_REPAIR_CLASSIFICATION_2026-09-06.md:28-42` keeps the 31-line DB2 execution source unresolved and keeps schema-bearing dependencies independent. The accepted context supplied by the brief is published `6c9e05d2`, actual 63/foundation 104; no prior native proof was rerun.

## Actual prerequisite boundary at selected foundation 104

The accepted foundation order supplies `pgcrypto`, DB1 repair/run/item/link tables, `companies`, membership/invitation/RBAC tables, `user_profiles`, `customers`, the operational tables used by counts, `audit_logs`, the DB1 readiness view, and the five called DB1 helpers. Representative definitions are `01_db1_schema_repair_core_helpers_and_canonical_tables.sql:21-87,339-421,727-753`, `02_db1_operations_ediel_billing_dedupe_and_storage.sql:751-762`, and `03_db1_backfill_functions_rls_reports_and_finish.sql:8-77,877`.

A bounded exact-symbol scan of the 104 ordered foundation inputs checked ordinary SQL and quoted/dynamic SQL text for `CREATE TABLE [IF NOT EXISTS] [public.]<symbol>`. It found references and conditional alterations, but no creation statement for these concrete DB2 prerequisites. This establishes lack of a **source-backed selected-prefix supplier**; it does not claim that an unprobed native catalog lacks the relations:

| Missing relation | Where the DB2 source requires it | Consequence |
|---|---|---|
| `customer_profiles` | required array `01:121`; inventory view `01:383`; candidate/mapping functions and views `01:577-643,798-1001,1003-1035` | `CREATE VIEW` at `01:378-397` cannot resolve its body; `assert_ready` would also block. The relation and all referenced column/FK semantics remain unknown. |
| `customer_delivery_points` | required array `01:123`; inventory view `01:385` | Same unresolved-relation failure and readiness block. |
| `contract_agreements` | required array `01:126`; inventory view `01:388` | Same unresolved-relation failure and readiness block. |
| `document_ai_extractions` | inventory view `01:392`, but omitted from `assert_ready` | The inventory view can fail before readiness; the assertion is incomplete for its own downstream DDL. |

For `customer_profiles`, `customer_delivery_points`, and `contract_agreements`, no `CREATE TABLE` source was found anywhere else under the repository’s SQL files. `document_ai_extractions` does have concrete definitions outside the selected prefix: `supabase/migrations/20260522_batch4c_billing_export_audit_quality_ai.sql:119`, its derived prerequisite `supabase/bootstrap/20260809_batch4c_write_policy_tables_prerequisite.sql:18`, and the non-execution snapshot `supabase/schema.sql:55437`. None supplies the relation at foundation 104.

If no out-of-band/native relation exists, `customer_profiles` is the earliest unresolved relation in `gridex_db2_v4_source_inventory_v`, so the first failure is the view statement beginning at `01:378`, after many earlier top-level DDL/DML statements. Whether those earlier statements remain depends on the outer runner transaction; the files contain no top-level transaction wrapper. Actual native presence was not probed.

Of the 40 company columns added at `01:201-240`, 22 have selected-prefix source definitions and 18 do not: `market_role`, the test/production identity/mailbox/application/counterparty field family, `white_label_platform_id`, the four BRP/eSett fields, and the two technical-contact fields. All ten membership columns (`01:261-270`), all nine invitation columns (`01:311-319`), and all five user-profile columns (`01:360-364`) have selected-prefix source definitions. This is source availability only, not a native-catalog assertion: `ADD COLUMN IF NOT EXISTS` does not reconcile an existing column’s type, nullability, default, FK, or ownership.

All four exact index names passed through dynamic SQL at `01:366-373` already occur in foundation 104, including the partial company/user unique index and the two company/status indexes. Re-executing their `CREATE ... IF NOT EXISTS` strings is therefore normally a name-only no-op and does not prove definition equality. The source’s four named checks also already exist at the prefix. Because the source checks only constraint names (`01:285-358`), it silently accepts a different definition. The effective membership-role definition at this prefix is reconstructed dynamically from a prior catalog envelope; Task 23 did not rerun native catalog capture and does not invent that shape.

No literal selected-prefix `CREATE TRIGGER ... ON` statement was found for the direct mutation tables. That bounded static result does not prove the actual native catalog. Company cardinality, the presence or uniqueness of the fixed tenant/operator, DB1 completion/readiness rows, customer/profile data, grants/default privileges/RLS, and all live catalog/data/provider state remain unknown.

## Complete whole-source unit and effect map

Line references below use `01` for the 1,079-line DB2 preflight, `01B` for the 106-line DB2B preflight, `02` for execution, `03` for DB2 closeout, and `03B` for DB2B validation.

### `01_db2_full_view_preflight_schema_and_functions.sql`

Top-level statements:

| Lines | Unit | Prerequisite and complete direct effect |
|---|---|---|
| `12` | `CREATE EXTENSION IF NOT EXISTS pgcrypto` | Catalog/extension DDL; may be a no-op. Requires extension-install authority and takes catalog locks. It supplies `digest`/`gen_random_uuid` dependencies used by DB1. |
| `14-33` | repair-run upsert | Inserts or resets one fixed repair key to `prepared`, refreshes timestamps, clears completion, and replaces summary. This is durable operational metadata, not a diagnostic read. |
| `35-196` | seven small helpers | Creates two catalog predicates plus finding insertion, nonblank text, role normalization, readiness assertion, and sole-company resolution. The finding/default helpers write repair findings on ambiguity. |
| `201-240` | 40 company column additions | Persistent schema. New columns receive the written defaults/nullability; pre-existing columns keep their old definitions. No FK is defined for `white_label_platform_id`. |
| `242-259` | company normalization | Row-locking broad update. Fills only selected null/blank-compatible fields, writes `updated_at`, and can change slug/environment/country/industry/JSON values. Its `WHERE` tests null only, so rows containing only empty strings can escape normalization. |
| `261-270`, `311-319`, `360-364` | membership, invitation, profile column additions | Persistent schema/defaults. Actor-like UUID fields are added without FKs here; selected-prefix definitions may already differ. |
| `272-283` | membership normalization | Updates every membership and its timestamp. Unknown roles become `member`; unknown statuses become `active`; nullable `is_active` becomes true. Existing `membership_role` added earlier with default `member` can mask an authoritative legacy `role`, leaving `role` and `membership_role` inconsistent. |
| `285-309` | membership checks | Adds role/status checks only when the names are absent; validates existing rows immediately. Same-name, different-definition constraints win silently. |
| `321-332` | invitation normalization | Updates every invitation. Unknown statuses become `pending`; cancelled variants become `revoked`; prior default `membership_role='member'` can mask legacy `role`; all timestamps change. |
| `334-358` | invitation checks | Same name-only/idempotency and immediate-validation behavior as membership checks. |
| `366-373` | four fixed dynamic index branches | Calls public `gridex_db1_try_exec(area, object, SQL text)`. Each branch attempts one fixed index; any error is swallowed and logged by DB1 (`01_db1...sql:141-162`), so the attempted index's uniqueness/performance is not established before later repair. The selected DB1 prerequisite independently defines full `UNIQUE (company_id,user_id)` (`01_db1...sql:387-403`); failure of DB2's redundant partial index does not remove that constraint. If no inferable arbiter exists in an actual shape, membership `ON CONFLICT` fails rather than performing an unprotected insert. The DB2 call strings are fixed and not injection-controlled; the generic SECURITY DEFINER helper itself accepts arbitrary caller SQL. |
| `378-590` | five views | Creates inventory, schema-contract, company overview, company reconciliation, and membership-candidate views. They span tenants and expose counts, role state, email/name/details. The membership view calls the side-effecting sole-company function for review-only branches; selecting it can insert warnings when company count is not one. Candidate sources are existing memberships, explicit profile company, accepted invitation, explicit active user-role company, then review-only platform-admin/profile rows. The explicit `user_profiles.active_company_id` branch uses `coalesce(up.user_id,up.id)` as principal, assigns `admin`/`company_admin`, carries `coalesce(user_status,'active')`, and checks only that the company exists and the pair lacks a membership; it proves no invitation, authorized administrator assignment, or authoritative legacy role. The engine's lexical `source_table` order puts an accepted-invitation candidate first, then this profile candidate before `user_roles.company_id`, so absent the invitation a lower-privilege user-role candidate for the same pair cannot replace the synthesized administrator values after the first insert. |
| `592-624` | signal/decision helpers | Nonblank contract/billing/external or selected metadata fields establish “customer signal”; account type/role matching is lowercased but not trimmed. Any nonblank symbolic reference qualifies, without proving provider or tenant authority. |
| `626-643` | customer-profile candidates view | Exposes personal/profile fields, decision, source hash, and timestamps across all rows. |
| `645-677` | item logger | SECURITY DEFINER insertion of arbitrary supplied source/target/status/message/hash/details into `backfill_run_items`. |
| `679-796` | membership reconciler | Always asserts readiness and starts/resets a durable run. Iterates a view snapshot in deterministic `should_insert/source_table/source_id` order, but checks the table again per row. Missing IDs and review-only rows log durable items. Explicit `false` still logs every candidate and finishes the run without membership/profile writes. The function is not `STRICT` and does not reject NULL: NULL selects the dry-run key, skips the existing-membership update while counting/logging it as a would-update, but a missing insertable candidate bypasses `IF NOT p_apply`, inserts/upserts the membership, fills a null profile `active_company_id`, and logs `inserted`. Apply mode performs those writes normally. Each row’s inner block catches all errors and rolls back that row’s database writes before logging failure; PL/pgSQL counters changed before a late error are not rolled back. |
| `798-1001` | customer-profile reconciler | Always asserts and starts/resets a durable run, then chooses a tenant only when company count is exactly one. A null default finishes `blocked`. For each profile, an active canonical link wins first; otherwise eligibility is checked, then normalized email, then customer number. Explicit `false` stores personal details in items without customer/link/audit writes. The non-`STRICT`, non-rejecting NULL branch selects the dry-run key but bypasses `IF NOT p_apply`, so eligible rows insert/update customers, activate/upsert a canonical link, log an item whose details hard-code `apply=true`, and insert an audit row; its final run summary records `apply` as NULL. Row database writes are rolled back on a caught error, but counters already incremented remain changed. |
| `1003-1070` | three result/review views | Creates mapping, current-run items, and profile-review surfaces. They expose emails/names/phones, mapping/link state, log details, and run metadata without tenant predicates. Unlike the engine's active-link-only lookup, the mapping join has no link-status predicate and reports `linked` whenever its target customer exists. An inactive link can therefore hide an eligible profile from the final eligible-unlinked count. |
| `1073-1079` | terminal calls | `assert_ready` is an assertion. Both calls at `1074-1075` mutate run/item/finding metadata despite `false`. Reads at `1076-1077,1079` are diagnostic only. The membership-candidate read at `1078` can write ambiguity findings through its nested function. |

The 12 function bodies are therefore: two catalog predicates (`35-55`), two write/log helpers (`57-73,645-677`), text/role helpers (`75-97`), readiness (`99-163`), sole-company resolution with warning write (`165-196`), signal/decision (`592-624`), and the two reconciliation engines (`679-1001`). Six are `SECURITY DEFINER`: finding log, readiness, default company, item log, membership reconciliation, and customer reconciliation.

Membership winner/tie semantics are explicit. In one serial run, the candidate view can return more than one source for the same pair because every `NOT EXISTS` sees the pre-loop table state. Lexical source order makes an accepted invitation precede the synthesized administrator profile branch, which in turn precedes the explicit user-role branch; the first insert wins substantive values and later existing-row updates fill blanks only. Metrics call any pre-existing candidate “updated” even when no update executes, and call an insert-path conflict “inserted.” DB1 start-run first performs `INSERT ... ON CONFLICT (run_key) DO UPDATE ... RETURNING id` against a unique run key (`03_db1...sql:8-37`; `01_db1...sql:42-57`). A second ordinary transaction using the same key therefore waits on the first transaction's run-row conflict through the engine body and outer transaction, then resets the run after the first ends; stricter isolation can instead fail the conflicting transaction. Same-key bodies do not ordinarily interleave. Because `now()` is transaction-start time, a waiter that began before the first commit can reset `started_at` to a time preceding the first call's items, making timestamp-filtered “current” items include them. Different-key engines and independent writers remain concurrent and retain candidate/table-check conflict risks.

Customer winner/tie semantics are also explicit. An active canonical link wins without checking that its target customer belongs to the selected company (`01:843-855`); apply can therefore update a customer in another tenant and then rewrite the link’s `company_id` to the sole default (`01:950-974`). The mapping view accepts inactive links (`01:1029-1035`) and calls an existing target `linked` (`01:1021-1025`), while the engine accepts only active links. A dry run or skipped ambiguous match can leave this false-green discrepancy, and closeout then excludes it from `eligible_customer_profiles_unlinked` (`03:71-77`). Without an engine-accepted link, unique email is tested before customer number, and a unique email match prevents detecting that a different unique customer number points elsewhere (`01:873-913`). Multiple matches are skipped. Profile metadata is appended last on insert (`01:943`), so it can overwrite DB2 provenance keys and later trigger-routing metadata. Existing nonblank customer values win on update; no source row/PK is deleted, but new customer UUIDs, links, logs, and audit rows are allocated.

### `01_db2b_preflight_views.sql`

| Lines | Unit | Effect |
|---|---|---|
| `15-31` | fixed-tenant assertion | Resolves the earliest exact-case match among three tenant labels and raises only when none exists. Duplicate matches are not rejected. No rows change. |
| `33-83` | target view | Persists a view embedding `[fixed_user]`, `[fixed_email]`, and `[fixed_tenant]`, joining platform-admin and tenant-membership state. It exposes identity/role/status and selects the earliest matching company. |
| `85-106` | preflight view | Persists three rows. Company existence/activity are actual checks; the “user known or ready” row is hard-coded to zero issues and proves nothing. |

This file requires base tables and fixed tenant data, not the excluded repair body. The fixed data’s presence, authority, and uniqueness are unknown. Labels do not confer platform or tenant authority.

### `02_db2_execute_controlled_reconciliation.sql`

| Lines | Unit | Effect |
|---|---|---|
| `8` | readiness call | Assertion only unless nested view evaluation fails; no intended row mutation. |
| `10-22` | repair-run update | Marks the fixed repair key `running` and replaces its summary. If the row is absent, zero rows change and no error is raised. |
| `24` | membership apply | Invokes all effects at `01:679-796` with mutation enabled. |
| `25` | customer apply | Invokes all effects at `01:798-1001` with mutation enabled. |
| `27-31` | output reads | Company reconciliation, inventory, profile review, and item reads are diagnostic. The membership-candidate read at `29` can insert ambiguity findings because its view calls the sole-company function. |

The source does not create companies and has no direct provider/Auth API call. It does create or change membership/profile/customer/link/audit/run/item rows through nested functions. Its header is not a safety proof.

### `03_db2_validation_and_finish.sql`

| Lines | Unit | Effect |
|---|---|---|
| `5` | readiness call | Actual assertion. |
| `7-33` | run-summary view | Persistent aggregation across four fixed run keys. It distinguishes item statuses but depends on mutable run start times and accumulated items. |
| `35-87` | final-readiness view | Persistent checks for schema columns, exactly one company, one named tenant, failures, and eligible unlinked profiles. Three rows are constant zero assertions and do not validate their descriptions. Exactly-one-company is a historical dataset rule, not a general multitenant invariant. |
| `89-110` | closeout update | Marks repair complete/warnings and replaces its summary with full JSON aggregates of readiness, company inventory/reconciliation, membership candidates, and profile review. This can duplicate personal/tenant data into repair metadata. Evaluating membership candidates can also insert ambiguity findings. Missing repair key again causes a silent zero-row update. |
| `112-127` | terminal reads | Output only except the membership-candidate read at `125`, which can write ambiguity findings. |

### `03_db2b_validation_views.sql`

| Lines | Unit | Effect |
|---|---|---|
| `5-57` | fixed membership view | Persists the same symbolic fixed identity/tenant lookup with company/admin/membership state. No row mutation. |
| `59-125` | fixed readiness view | Persists five target checks plus one global backfill-item check. It expects the independently excluded operational repair to have created an active platform superadmin and tenant membership. The “no profile conversion” branch scans all matching items since a fixed date, without run key or tenant scope, and flags legitimate eligible DB2 customer outcomes and even non-skipped dry-run outcomes. It therefore contradicts the DB2 signal-only conversion contract. |
| `127-159` | RBAC snapshot view | Persists a cross-tenant union of every platform admin and membership, including invitation email and role/status details. |
| `161-163` | terminal reads | Diagnostic reads only. |

The five in-scope sources never create or update the fixed platform-admin row. A green DB2B readiness result is therefore a data dependency on independently excluded historical action or some separately authoritative current workflow; it is not a prerequisite to restore by replay.

## Transaction, locks, rollback, and repeat behavior

None of the five files contains a **top-level transaction-control** `BEGIN`/`COMMIT`, a procedure, an autonomous transaction, or an internal commit. Function and anonymous-block bodies do contain PL/pgSQL `BEGIN ... END` blocks; those delimit code blocks, not independent transactions. PostgreSQL functions execute in the caller transaction. The two per-row `EXCEPTION` blocks form subtransactions: an error rolls back the current row block's database writes, then the handler attempts a durable failure item. PL/pgSQL local variables are not restored by that rollback: for example, a customer row can increment `v_inserted` or `v_updated`, fail during link/item/audit work, then also increment `v_failed`, so the summary can count the row in both categories even though its row writes rolled back. An error in the logger, readiness, run start/finish, or outside those row blocks aborts the surrounding statement.

Atomicity is therefore runner-dependent. With statement autocommit, prior top-level DDL/DML survives a later statement failure and `02:24` can commit before `02:25` fails. With a whole-file outer transaction, an uncaught failure rolls the file back. Any future oracle must specify and assert the wrapper rather than infer it from SQL text.

DDL takes relation/catalog locks; broad updates take row locks; unique-index creation can scan/lock the relation. There are no advisory locks or explicit row locks. The DB1 start-run upsert implicitly locks the unique run row and serializes an ordinary same-key engine call until the first outer transaction ends; stricter isolation may fail the waiter. `default_company_id` performs count then select without a lock, so a concurrent insert/delete can change the premise. Candidate generation and later table checks are TOCTOU windows for different-key calls and independent writers. Atomic unique upserts protect key uniqueness when an inferable arbiter exists, but not deterministic provenance/winner choice across those paths. The selected prerequisite's full membership unique constraint remains an arbiter if the redundant DB2 partial index soft-fails; without any inferable arbiter, `ON CONFLICT` fails and the row handler records failure. Same-key reuse still resets summaries, accumulates items, and can include earlier-call items through transaction-start timestamp filtering, but it does not imply body interleaving.

Repeat execution is only partially convergent. Structural `IF NOT EXISTS` statements are name-idempotent. Membership/customer/link rows usually converge by unique keys and links, while timestamps/metadata are refreshed. Run items, ambiguity findings, and audit rows accumulate; dry runs accumulate too. Run rows are reset in place. Repeated company/membership/invitation normalization rewrites timestamps, and later triggers can produce additional downstream events.

## Security, tenant, actor, provider, and later-trigger boundary

The source creates public-schema SECURITY DEFINER functions with no in-source `REVOKE`/`GRANT`, no `auth.uid()` or service-role check, no explicit tenant/actor argument for the two engines, and `search_path = public, extensions`. PostgreSQL normally grants function execution to `PUBLIC` unless default privileges or later revokes say otherwise; actual ACL/default-privilege state is unknown. The prerequisite `gridex_db1_try_exec` is also a public SECURITY DEFINER accepting arbitrary SQL text. A safe restoration cannot expose that capability or either reconciliation engine as a public RPC.

The nine DB2 views, two DB2B preflight views, two DB2 closeout views, and three DB2B validation views omit `security_invoker`, tenant predicates, and explicit ACLs. Several expose cross-tenant personal identity, contact, membership, invitation, customer/profile, audit-item, or metadata content. Actual Data API exposure and RLS/grants are unknown; omission is a confirmed unsafe contract for a proposed public restoration, not proof of live exploitability.

The DB2 customer audit insert records a null actor (`01:978-979`); run/findings/items also have no authenticated actor/session binding. No source calls an Auth API, generates a password, reads a provider credential, sends email/webhooks, or invokes an external provider. It reads/writes local rows only. Profile signals, labels, email verification fields, and fixed identifiers do not establish provider or ownership authority.

A bounded repository search found no later definition of any `gridex_db2_v4_*` or `gridex_db2b_*` object and no app/lib consumer. Thus there is no concrete later winner for these function/view contracts. The timestamped DB1 source later recreates the called DB1 helpers with materially identical bodies (`20260522_db1_schema_repair_backfill_foundation.sql:137-158,211-227,2125-2190`), but that is not a DB2 runtime hardening winner.

Repository-defined post-prefix triggers would materially enlarge effects if an operator manually ran the historical files after the later chain. Their actual native/live presence remains unknown:

| Source mutation | Conditional later trigger effect |
|---|---|
| company normalization `01:242-259` | Legal validation normalizes country/postal/org data and legal-profile sync rebuilds/upserts `tenant_legal_profiles` (`20260717233000...sql:833-883`; rebuild upsert `554-643`). Canonical Ediel projection overwrites DB2-written production/environment fields from `ediel_production_state` (`20260822224708...sql:77-135`). The catalog-revision trigger fires because DB2’s `SET` names slug/metadata fields, bumps website/API revisions, inserts domain events, and queues webhook deliveries; it can fail when external tenant reference is absent (`20260818121500...sql:8-73,109-113`; `20260722133000...sql:235-328`). |
| membership update/upsert `01:719-767` | The later deferred/immediate constraint trigger guards removal/downgrade of the last functioning owner/admin using auth/profile state (`20260802170000...sql:1101-1162`). Inserts are not covered by that trigger. |
| invitation normalization `01:321-332` | The later acceptance guard checks tenant lifecycle when a value newly becomes exact `accepted` (`20260802014000...sql:368-385`). Case normalization can activate that branch. |
| customer insert/update `01:927-964` | Insert without a usable supplied number calls the tenant counter allocator and mutates `company_customer_number_sequences`; updates invoke number permanence because the column is named in `SET` (`20260719120000...sql:24-69`; allocator `20260612203000...sql:106-149`). Partner-origin metadata conditionally inserts domain events and queued webhook deliveries (`20260816170000...sql:135-280,285-309,443-448`). Because profile metadata wins on insert, it can accidentally select that route. No send/provider call occurs inside these triggers. |
| audit insert `01:978-979` | Later audit normalization reads request headers when present, otherwise generates request/correlation IDs and labels null actor as an unspecified system actor (`20260727040000...sql:657-730`). |

No later trigger was found on canonical links, backfill runs/items, or repair runs/findings in the bounded target scan. The customer process-summary trigger watches fields DB2 does not name and therefore is not reached by these customer updates.

## Confirmed source defects and explicit unknowns

Confirmed from immutable text:

1. Selected foundation 104 lacks four relation definitions required by the first file; readiness also omits one relation used by its own inventory view.
2. Prior defaulted `membership_role` can mask legacy `role`; unknown roles/statuses are coerced to ordinary active access rather than reviewed (`01:272-283,321-332`).
3. Name-only constraint/index idempotency can accept incompatible definitions; index failures are warnings while apply continues (`01:285-373`).
4. Diagnostics are not read-only: default-company resolution, dry runs, terminal membership reads, and closeout aggregation write findings/run items (`01:165-196,679-1001,1074-1078`; `02:29`; `03:89-110,125`).
5. An active canonical link wins without tenant equality, enabling cross-tenant target update/link reassignment under the sole-company assumption (`01:843-855,950-974`).
6. Email wins before customer number without checking conflicting unique matches; arbitrary nonblank profile signals are treated as sufficient authority (`01:592-624,873-913`).
7. Profile metadata can overwrite DB2 provenance fields; dry/apply logs and final summary replicate personal data (`01:868,923,943,976-979`; `03:95-109`).
8. Public privileged functions/views have no in-source caller, tenant, actor, or ACL boundary. Counters can diverge from rolled-back rows, and winner choice remains nondeterministic across different run keys or independent writers; the prerequisite run-row upsert serializes ordinary same-key calls.
9. Several readiness rows are constants, the DB2 rule requires one company, fixed-target resolution ignores duplicates, and DB2B’s conversion check contradicts DB2’s eligible conversion behavior (`01B:15-31,85-106`; `03:35-87`; `03B:59-125`).
10. NULL `p_apply` selects each dry-run run key but bypasses `IF NOT p_apply`; insertable memberships and eligible customers/links/audits are written under that identity. Existing-membership updates remain skipped, customer item details say `apply=true`, and summaries retain NULL (`01:697-742,783-793,824-829,915-998`).
11. An explicit profile company synthesizes administrator membership from `coalesce(user_id,id)` without invitation or authoritative role evidence and can precede a lower-privilege user-role candidate (`01:507-522,700,744-767`).
12. Mapping/readiness treats an inactive canonical link with an existing target as linked even though the engine accepts only active links, producing a possible false-green eligible-unlinked result (`01:843-855,1021-1035`; `03:71-77`).
13. Caught row faults roll back database writes but not already changed PL/pgSQL counters, so a late fault can be counted as both inserted/updated and failed (`01:947-982`). Same-key calls are implicitly serialized by the prerequisite run-row upsert; remaining concurrency defects concern mutable reset/accumulated items, transaction-start timestamp filtering, different keys, and independent writers.

Unknown and not upgraded to claims: actual native/live relation and column shapes; effective constraint/index definitions; DB1 readiness data; fixed tenant/operator authority; real row cardinalities; RLS/default ACL/function grants; live triggers and trigger order; whether any historical run executed; provider/auth state; queued-delivery workers; current generated types; remaining-chain/native-genesis/live parity.

## Minimal coherent future characterization and private runtime contract

The minimum defensible source grouping/order is:

1. **DB2 mixed definition unit:** characterize all of `01` together because its DDL, functions, views, normalization, and automatic dry-run writes are inseparable historical effects. Any authorized private historical restoration/proof must preserve and exercise the whole pinned file, including terminal calls and DML, under synthetic data and an explicit transaction wrapper. For a production forward convergence, independently dispose the four unsupplied relations and every existing column/check/index definition; ADR006 bars replaying the historical operational calls against production data. This is a production/runtime disposition, not excerpt selection from the historical unit.
2. **DB2 operational execution unit:** `02` follows the complete `01` contract and is operator-only data repair. Historical behavior is evidence, not a clean-replay feature.
3. **DB2 closeout definition unit:** `03` follows `01/02`. An authorized private historical proof exercises the entire pinned file, including both views, metadata closeout, and terminal reads. A production forward convergence must give the two views and closeout DML explicit retain/replace/retire dispositions while preserving their complete historical characterization; the single-company/constants/PII summary is not a general readiness contract.
4. **DB2B fixed-target diagnostic unit:** `01B` precedes the independently excluded repair and `03B` historically follows it. The excluded repair stays excluded. These views need explicit restricted retention/parameterized replacement/retirement; a green result must never recreate or legitimize the fixed identity.

No current app/lib consumer justifies a new operator API, workflow, or application grant. The default boundary is owner-private historical capability and diagnostics in the controlled synthetic proof harness, with no new runtime service role or production caller. If a later, separately scoped product need establishes an operator workflow, its optional design should use a non-exposed private schema, explicit tenant/actor/reason/idempotency/ownership inputs, deterministic locking, link-company validation, and privacy-minimized evidence; this is not a Task 23 prerequisite and requires no fresh approval merely to complete this characterization. Provider credentials and calls remain outside this database contract.

Diagnostic replacements must be private/security-invoker or explicitly ACL-restricted, tenant-scoped, parameterized, and privacy-minimized. Fixed symbolic target data belongs in approved operator input, not persistent public view text. Separate assertions from reports: assertions raise/fail; reports return state; neither should mutate.

## Independent before/after oracle

No SQL or tests were run in Task 23. Review must keep two different oracles separate.

### Mandatory whole-source historical characterization oracle

This private, synthetic oracle proves what each immutable file actually does, including unsafe effects; it does not silently substitute corrected behavior.

| Scenario | Historical expected effect/failure to prove |
|---|---|
| selected prefix dependencies | With no out-of-band supplier, whole `01` executes its earlier statements and fails when the inventory view resolves `customer_profiles`; the exact surviving/rolled-back state must match the explicitly chosen outer transaction wrapper. With synthetic definitions for all four relations, the same whole file reaches its later assertions/calls. |
| dirty schema and normalization | Same-name wrong-shape objects demonstrate name-only `IF NOT EXISTS` behavior. Populated null/blank/mixed-case/unknown role and status rows demonstrate broad timestamp rewrites, defaulted-role masking, unknown-role-to-member, unknown-status-to-active/pending, and immediate check validation. |
| historical dry run | Whole `01` creates/resets repair/run rows and appends findings/items while changing no membership/customer business rows through the two `false` calls. Personal details appear in historical item/summary payloads where the source writes them. Ambiguous company diagnostic reads append findings. |
| NULL function contract | After whole `01` installs both complete function bodies, call each with NULL separately inside the same private whole-source fixture. Both use the dry-run run key. Membership proves existing rows are counted/logged without update while a missing explicit candidate is inserted/upserted and can fill profile company. Customer proves eligible customer/link/audit writes, hard-coded `apply=true` item details, and a NULL run-summary flag. This unsafe branch is characterized without normalizing NULL. |
| historical apply | Whole `02` marks running, mutates eligible membership/profile/customer/link/audit rows, records skipped/failed items, preserves existing rows/PKs, allocates new customer IDs when its rules choose insertion, and exhibits canonical-link, email-before-number, and metadata-precedence semantics exactly as written. A profile-company candidate paired with a lower-privilege user-role candidate and no earlier invitation proves principal fallback, synthesized active `company_admin`, and lexical precedence. |
| fixed-target lifecycle | Whole `01B` blocks only when its symbolic tenant cannot be resolved and persists its two fixed-target views when it can. Whole `03B` persists all three views and reports the excluded-repair dependency and global fixed-date conversion check without performing that repair. |
| closeout | Whole `03` creates both views, may append ambiguity findings during candidate evaluation, replaces repair summary with full aggregates, sets completed/warnings, and emits terminal result sets. Constant checks and exactly-one-company behavior remain observable. An eligible profile with an inactive canonical link to an existing customer reports mapping `linked`, contributes zero to eligible-unlinked, and can therefore leave final readiness false-green even though the engine would not accept that link. |
| repeat/concurrency/fault | Repeats accumulate run items/findings/audit rows and refresh timestamps while structural names converge. Two ordinary same-key transactions demonstrate run-row blocking then serialization/reset, or a stricter-isolation failure; a waiter begun before the first commit also checks whether transaction-start `now()` includes first-call items. Different-key calls or a named independent writer exercise remaining conflict windows. A fault after customer insert/update counter increment but during later link/item/audit work proves row-write rollback, durable failure logging, and both inserted/updated plus failed summary counts; faults outside handlers follow the outer wrapper. |
| later-trigger overlay | In a separate later-schema fixture, historical DML triggers the repository-defined legal/profile/catalog/event/queue, membership/invitation guard, number allocation/protection, partner-event, and audit-context paths when their predicates hold. Assert local rows/queues only and zero external provider execution. |
| privacy/cleanup | Use symbolic synthetic identities only, observe every historical PII replication sink, then remove only synthetic rows/catalog objects. No real customer/provider/credential data is read or changed. |

### Conditional production forward-policy oracle

This second oracle applies only if reviewers later authorize a forward production disposition; it is not a requirement to create a new operator service or API.

| Scenario | Forward policy to prove |
|---|---|
| dependency and schema equivalence | Every historical statement has a retain/replace/retire disposition; retained objects have exact dependencies and detect wrong type/default/nullability/FK/check/index definitions rather than accepting names. |
| row/tenant integrity | Existing rows and PKs remain; no default-tenant inference, label-based authority, cross-tenant link, conflicting identifier merge, status reactivation, or unowned partial graph occurs. |
| runtime/security/privacy | Default is no application/runtime grant. Any separately justified private caller is tenant/actor/reason bound, public roles cannot invoke/read it, preview policy is explicit, and new diagnostics/logs omit raw personal payloads. |
| concurrency/repeat/rollback | Approved forward behavior has deterministic winner/locking/run identity, documented transaction boundaries, correct counters, and explicit idempotency for audits/events/items. |

Independent review must first compare the mandatory whole-source effects to the pinned files, then assess any separately proposed forward disposition. Native/live unknowns stay open until independently evidenced.

## Skill routing

- Activated statically: `supabase` for SECURITY DEFINER/public-view/RLS/Data API boundaries; `supabase-postgres-best-practices` for constraints, upserts, locks, transactions, and concurrency; `code-security` for privilege, tenant, actor, and personal-data flow.
- Inspected but not activated as a workflow: `fp-check`, because there was no supplied discrete exploitability claim and runtime reproduction was forbidden. Direct source contradictions are marked confirmed; reachability/exploitability is unknown. `security-threat-model` was not activated because no full AppSec threat model was requested; the brief-specific trust/caller boundary is included above.
- Skipped by explicit Task 23 scope: Supabase docs/network/CLI/native verification, scanners, secret scans, code generation, implementation/debug/TDD, broad codebase acquisition, performance work, delegation, Git/worktree/branch workflows, and completion tests.
