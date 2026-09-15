# PR310 — canonical send-lock client-write boundary

Status: staged forward candidate independently reviewed; actual PostgreSQL 17 execution pending. No historical migration, selected source registry, schema reference, generated type or acceptance baseline is changed here.

## Finding and scoped decision

**P1, confirmed by source and effective-policy analysis, preexisting in the reference:** ordinary tenant operations users can directly insert/update `public.ediel_send_locks`, although canonical production commands own this projection. The reference and retained 9f replay both grant authenticated all eight PostgreSQL 17 table privileges. The reference has no authenticated permissive DELETE policy; DELETE is currently inert under RLS, whereas TRUNCATE is not governed by RLS. This is not a newly introduced policy-removal regression.

Revoke exactly authenticated `INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN` on this one table; retain SELECT. Retain other principals, column ACLs, policies, functions, triggers, table shape and existing rows. A residual column/PUBLIC/inherited/SET-role grant causes rollback rather than discovery-based revocation. The candidate rejects owner-role membership because ownership retains regrant authority.

The concrete consequence proved from code is bypass of canonical actor permission, readiness, audit and idempotency checks for **direct projection mutation**. The release trigger can requeue blocked, unsent outbox rows only when production state is already live. This review does not establish actual message delivery or a bypass of the remaining send pipeline.

## Source and caller evidence

All migration paths below are under `supabase/migrations/`; the fixture pins complete bytes.

| Contract | Exact source |
| --- | --- |
| Initial platform-only lock writes and explicit production activation | `20260601070000_ediel_production_readiness_hardening.sql:142–144,187–212` |
| Generic tenant policy pass later admits ordinary tenant writes | `20260602093200_ediel_operations_rls_completion.sql:15,51–66` |
| Canonical transition owns lock upsert; command execute restricted to service role | `20260802011000_canonical_ediel_production_state.sql:222–238,308–309` |
| Final transition wrapper validates actor and readiness | `20260902094600_fix_canonical_transition_request_hash_rewrite.sql:23–36,57–80` |
| Platform action refuses direct unlock and calls canonical transition for pause | `app/admin/companies/[id]/ediel-actions.ts:354–369` |
| Other canonical application callers | `app/admin/platform/go-live/approval-actions.ts:82`; `app/admin/platform/actor-testing/actions.ts:108` |
| Original platform-gated restore; final execution is service-only | `20260815114530_restore_pre_engine_live_ediel_approval.sql:4–12,34–36,197–199,219–220`; `20260815210353_restrict_recent_security_definer_rpcs.sql:1–8` |
| Convergence trigger normalizes status from locked; it does not authorize a writer | `20260903160000_ediel_send_lock_state_convergence.sql:64–88` |
| Unlock can requeue blocked unsent rows when canonical state is live | `20260903161000_ediel_send_lock_release_requeues_outbox.sql:10–31` |
| Outbox reads canonical boolean and applies other send guards | `lib/ediel/outbox/sendOutboxItem.ts:20–30,39–51,153–168` |

The initial authenticated restore grant is superseded by the later explicit revoke: the final restore RPC is service-only and checks platform authority. The immutable reference grants only service_role and 9f contains no restore-function grant delta. Revoking ordinary table privileges preserves that final SECURITY DEFINER authority and ACL. The source pin also includes the UUID aggregate hotfix establishing its final body. The bounded fixture verifies this PostgreSQL mechanism with a labelled synthetic platform-gated definer function; the real restore business graph is source-reviewed and pinned, not executed by this fixture. Its synthetic authenticated definer example is a privilege-mechanism control, not a model of the final service-only RPC surface.

## Exact catalog and capability evidence

Retained full portable `144 + 514 + 4` artifact10399581944, run34975955635, ZIP `pr310-schema-9f1ba7ae.zip` SHA256 `0ee862d06ee0e4f33208aa33ceefe8ce5afa8c5e8ca1c9cd186f006c7364f2af`; diff member SHA256 `aaee3685f99130f0d451ba6fe4829134873882ecf0053a38505a4b1005bf9772`.

`supabase/schema.sql` SHA256 `b46b90d7ff066d71964c9157044ac70b31b47cab114cfcbce5d270751012dd30`, lines115422–115423 grants authenticated and service_role ALL. No relation-grant diff for this table exists in 9f. Thus all eight explicit table ACLs persist. Source search finds no separate column write grant for this table, but the retained introspection does not emit `attacl`: absence of live column or role-derived authority must be established by execution, not inferred from this artifact.

`PR310_REMOVED_POLICY_DISPOSITIONS_2026-09-15.json` records exact removed/reference and added/authenticated policy rows. Actual INSERT and UPDATE predicates retain the earlier tenant permission under unchanged restrictive write guards; SELECT is the intended company read consolidation. The candidate does not rewrite these policy identities. Its postcondition checks all seven effective table privileges plus INSERT/UPDATE/REFERENCES on any column for authenticated and every role of which authenticated is a member. It rejects superuser/BYPASSRLS/member-owner authority, including SET-only membership, conservatively. This is a closed finite table repair, not general role-graph acceptance.

PostgreSQL 17 documents comma-separated access checks as an any-privilege test and table privileges as sufficient for column access. See [access privilege inquiry functions](https://www.postgresql.org/docs/17/functions-info.html#FUNCTIONS-INFO-ACCESS-TABLE). Ownership retains regrant authority even after ordinary privileges are revoked; see [privileges](https://www.postgresql.org/docs/17/ddl-priv.html). The candidate uses membership checks and explicit column checks for those reasons.

## Candidate and qualification

`scripts/sql/forward-candidates/restrict-ediel-send-lock-client-writes.sql` SHA256 `411df92fc01f8b84dd9a83600464594e76a4841d48928d52dfadfd97b3177705`:

- Atomic transaction, fixed qualified target, ordinary table with RLS enabled and FORCE disabled; validates identity before and after the table lock.
- Exactly seven privilege revocations, ordinary RESTRICT semantics; no changes to source policies, data or other principals.
- Missing target, wrong kind, disabled/forced RLS, owner membership and residual authority fail closed; errors roll back revocation. Repeat preserves state.

`scripts/canonical-ediel-send-lock-client-writes-selftest.py` uses the existing nonce-owned database helper and fixed local PG17 service at port55440 (`gridex_auth_test` admin database). No external URL, source, artifact, table list or acceptance option is allowed. It installs exact reference policies and then exact reconstructed actual authenticated policies, the original convergence trigger, and explicitly synthetic actor helpers. It proves original operations/platform INSERT/UPDATE admission, member INSERT rejection, original DELETE filtering, and whole-table TRUNCATE despite tenant read filtering. These are bounded privilege/predicate controls, not actual Auth helper or application graph tests.

After correction it requires fixed SQLSTATE42501 for all direct authenticated INSERT/UPDATE/DELETE/TRUNCATE attempts, including platform actors; unchanged SELECT behavior; service DML/TRUNCATE; and authorized synthetic definer write plus unauthorized definer rejection. Full owned schema/catalog/ACL/row snapshots permit exactly the intended seven-grant delta, preserving column privileges, all other roles, out-of-scope and same-name-other-schema tables, function bodies, policies and triggers. Residual PUBLIC grants and INHERIT TRUE/FALSE role edges exercise post-revoke rollback; each direct column write privilege is rejected before revocation to preserve its ACL. The shared role edge must be absent before owned database creation; cleanup never revokes a preexisting edge.

`.github/workflows/gridex-ediel-send-lock-client-writes-qualification.yml` gates genuine CLI2.101.0 `migration new` on successful SQL proof. It requires an empty CLI-created file, copies exact candidate bytes, and uploads the SQL proof, source file and provenance. Promotion is a separate parent-owned step after actual artifact verification.

## Verification and remaining boundary

Five initial offline tests were observed RED because the helper did not exist. The implemented helper passes six focused offline tests (admission, symlink/hash rejection, role-edge refusal before owned target, exact seven-privilege delta and preservation mutations); the shared ownership helper's four tests also pass. Workflow YAML and both embedded Python bodies parse. Independent review found that PostgreSQL table REVOKE also removes corresponding direct column grants; an under-lock `attacl` precheck now rejects those grants before mutation. The fixture already includes all three direct column-grant negatives. No PostgreSQL executable is available locally, so this audit does not mark SQL qualification or cleanup as executed.

Independent reviewer approved SHA256 `411df92fc01f8b84dd9a83600464594e76a4841d48928d52dfadfd97b3177705` after the column ACL correction and an exact SELECT identity correction; the reviewer independently matched all three actual policy rows to the retained artifact. Required next evidence: actual PG17 SQL proof and genuine CLI provenance, then parent-owned full portable/native forward execution with retained RPC/policy/row metadata and exact privilege delta. Actual canonical restore, readiness and message delivery remain outside this isolated fixture. Full schema acceptance stays blocked until the wider disposition registry and native comparison pass.

Skill routing: continuing the existing Supabase, differential/code review, false-positive verification, TDD, and independent review workstream. No UI, performance or generic repository scan was added to this one-table repair. Parent owns publication and shared memory.
