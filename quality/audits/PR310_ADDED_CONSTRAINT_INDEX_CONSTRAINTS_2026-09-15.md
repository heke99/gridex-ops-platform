# PR310 added constraint dispositions — 2026-09-15

All 211 added constraint rows were reconstructed exactly against the retained
9f1ba7ae artifact. One active application compatibility defect is confirmed;
a tenant-journal parent-delete concern and four mixed foreign-key delete-action
cases require bounded behavior qualification. This is a source disposition
register, not an acceptance allowlist, fresh PostgreSQL execution, or permission
to replace the canonical schema.

The companion JSON contains every identity, complete six-field catalog row,
matching SHA256, immutable source-file hash, declaration line, explicit effect,
and qualification boundary. The 211 rows cover 62 tables: 49 CHECK, 123 foreign
key, 31 primary key and 8 UNIQUE constraints. All 211 are validated in the
retained replay. Authorship anchors cover 41 migration files. Sources are not
ordered by filename to infer a winning definition. Equivalent source occurrences
are retained as alternatives; dynamic names are bound to their actual generator.

Skill routing: differential-review traces the exact schema difference to source
and application contracts; Supabase Postgres schema guidance applies to composite
keys, NULL behavior and referential actions. The fp-check method distinguishes
an active producer counterexample from dormant code or an unexecuted delete
scenario. The coordinating review owns broader repository, actor, supply-chain,
performance and publication gates; this bounded task makes no UI, runtime or
historical SQL changes. Existing changed/removed-constraint decisions are not
reopened.

## Evidence and reconstruction

Artifact `pr310-schema-9f1ba7ae.zip`, run34975955635/artifact10399581944:
`0ee862d06ee0e4f33208aa33ceefe8ce5afa8c5e8ca1c9cd186f006c7364f2af`.
Its `full-schema-reference-diff.json` member:
`aaee3685f99130f0d451ba6fe4829134873882ecf0053a38505a4b1005bf9772`.
The artifact records 144 foundation, 514 timestamp and four forward sources.
It remains a portable comparison with schema acceptance false, not native
lifecycle or application acceptance.

The six row fields are `nspname`, `relname`, `conname`, `contype`, `definition`,
`convalidated`, matching `scripts/sql/gridex-db-parity-introspect.sql:43–49`.
SHA256 hashes use sorted compact JSON with ensure_ascii=true. Candidate full
rows were derived from inline/named DDL and explicit dynamic generators, with
PostgreSQL deparse spelling recovered until the entire independently retained
row hash matched. No expression was accepted from name resemblance alone.

The helper `scripts/canonical-added-constraint-index-constraints.py` verifies
exact closed identity coverage, every full-row hash, kind counts, validated
flags, source bytes and declaration lines, context-source pins, the immutable
reference, and false acceptance flags. It executes no SQL. Literal application
`.from(table)` locators are supplied separately for follow-up; they are not an
exhaustive call graph or proof of actor identity or successful writes.

## AC-001 — active auth event action mismatch (P1)

Actual `auth_email_events_action_check`, row hash
`b14da2bb4421f49b889f1e5c740f1a1cd376392401ec863a89a787d067ab9083`,
is the validated seven-action CHECK authored by
`20260519_auth_callback_email_reset_sync.sql:59–71`:
invite_sent, password_reset_sent, confirmation_sent, email_confirmed,
password_updated, auth_callback_completed, auth_callback_failed.

The apparent later eleven-action authority is not the final replay authority.
`20260520_direct_temporary_password_auth_sync_fix.sql:127–141` temporarily
broadens the domain, but the reviewed Q boundary
`20260910140053_canonical_auth_provisioning_legacy_boundary.sql:31–37` restores
exact captured first43 event checks. The capture is at
`scripts/sql/canonical-auth-provisioning-legacy-admission.sql:73`. The complete
observed hash proves that the seven-action predecessor survives. Preserve that
historical restoration contract; correct the final application schema separately.

Current `lib/auth/authEmailFlow.ts:90–103` explicitly writes
`action=input.eventType` and propagates CHECK violation errors. Active callers
supply three values outside the actual domain:

| Value | Active path and consequence |
|---|---|
| email_action_verified | `authEmailFlow.ts:245–255`, called after successful session/OTP verification in `app/auth/callback/route.ts:50` and `app/auth/action/actions.ts:65`; the awaited audit failure prevents the normal redirect. |
| company_invitation_accepted | `lib/auth/companyInvitationFlow.ts:350–366` awaits the event after canonical membership acceptance; the audit error follows durable access work. |
| direct_user_created | `app/admin/users/actions.ts:237–252` awaits the event after account/profile/role work, then reports the caught error rather than success. |

An otherwise valid payload with any of those actions makes the exact CHECK
FALSE. Service role bypass of RLS does not bypass CHECK constraints. This is a
confirmed source/catalog counterexample; no PostgreSQL or end-to-end execution
was performed by this reviewer, and another earlier failure on an invalid
fixture is not excluded.

Decision: separately qualify a narrow forward CHECK widening to the explicit
May20 eleven-value domain, preserving all seven old values and adding
email_action_verified, company_invitation_accepted, direct_user_created and
source-authored direct_user_linked. Do not edit Q, original SQL, or relabel the
seven-value observed row as compatible. The coordinating agent owns that fix.

The actual status CHECK admits all status values used by these active callers.
It omits `completed`, which is accepted by the exported legacy
`lib/auth/userSync.ts:74–101` helper, but repository app/lib search found no
imports of that helper. That is a dormant contract mismatch, not a confirmed
active failure and not justification for an additional status widening.

## Tenant constraints and referential actions

The August1 multitenant source authors 58 additions: 16 required-company CHECKs
and 42 composite FKs. The exact dynamic table/column/parent tuples are at
`20260801143000_canonical_multitenant_platform_hardening.sql:272–315`; name
construction truncates at 63 bytes, and the actual rows preserve that result.
Each FK is `(company_id, linked_id) -> parent(company_id, id)` with NO ACTION
for both parent update and deletion. Required-company CHECKs close the NULL
company escape; an optional NULL linked id still passes MATCH SIMPLE.

Decision: retain these explicit tenant guards and restrictive linked-history
behavior. Do not call their NO ACTION semantics equivalent to an older CASCADE
or SET NULL FK. The separate existing removed/changed audits own those replaced
relationships. This review additionally confirms every one of the 58 full rows.
The general validation sweep
`20260809181153_validate_pending_public_constraints.sql:13–22` supplies the
source path from NOT VALID construction to validation; the observed complete
row hashes independently prove validated=true for this replay.

The September2 customer-chain generator adds eight further composites here.
Seven use ON UPDATE CASCADE / ON DELETE CASCADE; one uses ON UPDATE CASCADE /
ON DELETE SET NULL. Their exact column order is customer_id, company_id.
The source deliberately supplies tenant-qualified parent existence for tables
that previously had only a simple FK or none. Retain that tenant check. Do not
infer the complete parent-delete result from one constraint in isolation.

Four of the seven CASCADE composites coexist with a simple customer FK using
SET NULL: billing_disputes, customer_import_rows, data_quality_findings and
document_parse_jobs. Both constraints remain in the replay. A native fixture
must qualify final trigger ordering and the supported customer-delete operation
before asserting row retention or deletion. No claim that CASCADE automatically
dominates SET NULL is made, and no speculative FK rewrite is proposed.

### AC-002 — sync journal tenant attribution concern (P2, unexecuted)

`customer_sync_events_customer_company_fk`, full-row hash
`81ccd65a6947960b1b6523582cc9542dba375e17e454a21ba97892da3e1d6980`,
uses `ON DELETE SET NULL` without a column list. Its two referencing columns
are customer_id and company_id, so that action targets both. The original table
at `20260519_operations_core_saas_sync.sql:104–140` describes a durable,
tenant-safe matching journal and identifies company_id as its tenant owner.
Both columns are nullable. Its added operational trigger uses
`gridex_assert_company_operational_for_write`, whose source returns NEW when
company_id is NULL (`20260519_batch_6d2_runtime_governance_completion.sql:337–339`);
the later trigger expansion to every UPDATE does not change that NULL branch.

If a referenced customer deletion reaches this FK action, tenant attribution
can be cleared from the retained journal row. The inspected current literal
consumer is `lib/tenant/controlTower.ts:113`; no active journal writer or full
application customer-delete reachability was proved here. This is a concrete
source-contract concern requiring a bounded parent-delete characterization,
not an asserted exploitable access path. Select tenant-preserving behavior
only after that characterization; historical SQL remains unchanged.

The remaining 73 FKs preserve source-authored single-column links. They bind
company, Auth actor, dataset, API client or other business identities; the JSON
records exact referenced columns and actions. Across all 123 FKs there are
45 SET NULL, 36 CASCADE and 42 NO ACTION delete actions. Id-only references
establish parent existence; they do not certify same-company ownership by
themselves. Actor SET NULL links preserve the business row when an Auth identity
is removed, whereas membership/session user CASCADE links remove dependent
identity state. Company and dataset CASCADE links follow those owning parents.
Native combined-trigger and tenant-actor behavior remains a separate gate.

## Primary keys, unique keys and value checks

Retain the 31 primary keys for stable, non-NULL row identity. Most use id; the
archive uses archived_id. Their presence does not establish idempotency of an
arbitrary application command or safe tenant authorization.

Retain these eight source-authored UNIQUE constraints with their exact columns:

| Table | Unique tuple | Intended contract |
|---|---|---|
| data_quality_findings | company_id, entity_type, entity_id, issue_key | Deduplicate one finding identity within a company. |
| ediel_agt_readiness | company_id, actor_role, message_family | One readiness record for an actor/family scope. |
| role_permissions | role_id, permission_id | One permission assignment per role/permission pair. |
| status_transition_rules | entity_type, from_status, to_status | One configured transition edge; this alone does not execute a state machine. |
| tenant_email_domains | company_id, domain | Deduplicate a domain within a company, not globally. |
| white_label_platform_memberships | white_label_platform_id, user_id | One user membership per white-label platform. |
| page_performance_budgets | route_key | One budget configuration for each route key. |
| white_label_platforms | slug | Distinct non-NULL slugs; repeated NULL is permitted. |

These ordinary UNIQUE constraints use NULL-distinct semantics. The parent index
review owns exact backing-index definitions and ON CONFLICT callers. This
register does not infer a duplicate-data cleanup, query speedup or concurrency
receipt from uniqueness metadata.

Of 49 CHECKs, 16 require company_id and 33 constrain status/action/role values,
nonnegative counters, parser confidence, VAT fractions, email/prefix syntax,
mailbox reference syntax or positive budget bounds. Preserve each exact
source-authored domain except the confirmed action-domain defect. The complete
predicates and accepted value sequences are machine-readable in the JSON.
CHECK permits NULL when its expression evaluates UNKNOWN; separate column
nullability still governs required fields.

The VAT contract explicitly permits NULL or a fraction between zero and one;
parser confidence permits NULL or zero through 100. Budget targets must be
positive and full-data time cannot be less than first-content time. Prefix and
sender-email regular expressions are syntactic checks, not uniqueness or domain
verification. The mailbox regex rejects the two specified obvious credential
forms; its name is not proof that all possible plaintext secrets are prevented.
Status/role vocabulary checks constrain stored tokens, not legal transition
ordering or membership authorization. No unsupported broad security claim is
made from these checks.

## Verification and remaining gates

- Exact artifact/member pins and all 211 full-row hashes: PASS.
- Exact closed added identity set, kind counts, validated flags and 41 authored
  source-file pins with declaration lines: PASS.
- Offline checker mutation controls reject missing/duplicate identities, modified
  definitions, false validation, changed source pins and false acceptance: PASS.
- Source, schema, types and existing runtime files: unchanged by this subtask.
- Fresh PostgreSQL, native ledger/lifecycle, live business rows, all actor access,
  application deletion graphs and end-to-end flows: not executed here.

Final schema qualification must consume the corrected auth CHECK, resolve the
explicit parent-delete characterization cases and verify the complete native
catalog plus relevant runtime flows. Neither this register nor its checker
changes an existing acceptance gate.
