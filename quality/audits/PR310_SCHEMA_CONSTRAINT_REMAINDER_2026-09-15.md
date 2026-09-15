# PR310 remaining constraint dispositions — 2026-09-15

Status: SOURCE DISPOSITIONS COMPLETE for this scope. No reference refresh,
difference allowlist, migration approval,
native SQL/API proof or release acceptance.

## Scope and evidence

Independent source/application review of the six changed constraints and two
specified removed FKs in the full portable 335f987f 144+514 schema diff. The seven
customer composite replacements and the two separately identified missing inline
FKs are excluded. Review completed against source tree at `fd4fb9077d206ed2165fec0687ffb8f6b9a4ed87`; this report
is the only new file created by this subtask. Other agents' pending files were
left untouched. No historical SQL, schema/types, source code or memory changed.

Skill routing: repository code-review, differential-review evidence tracing and
fp-check-equivalent counterexample review. Database ownership/deletion semantics
apply; unrelated UI/performance/supply-chain scans and implementation are absent.

Artifact `pr310-schema-335f987f.zip` SHA256 verified:
`4009f365e8b7e255611992a12c031df159da2e16a4e46875af25593668d4aecb`.
The existing complete comparison is run34963346325/artifact10394485748, not a new
SQL run by this reviewer. Its reference/replay public projection hashes are
`e404dd6b8493da3332e15fde7622ef22098157d7933d98c0bc0d3992e3818106` and
`4b5d003fea640f0f2f52a3e410fc07a01988e92f5bc6cfc8b3055ec9c2709755`.

Exactly 16 catalog rows were reconstructed and matched to the artifact hashes:
12 for the six changed constraints, two removed FK reference rows, and the added
POA contract composite plus its required-company CHECK. All have
`convalidated=true`. Row fields are `nspname`, `relname`, `conname`, `contype`,
`definition`, `convalidated`, following
`scripts/sql/gridex-db-parity-introspect.sql:43-49`. Hashing uses compact sorted
JSON with ensure_ascii=true, then SHA256, exactly as
`scripts/canonical-full-schema-reference.py:41-43`. Candidate definitions came
from exact source/reference expressions with PostgreSQL deparse spelling; matching
the entire row hash proves the recovered value, without a fresh catalog query.

At the original review boundary, the input-accounting selector passed: 144
foundation / 514 timestamp, with source pins checked. This is the historical
601-input receipt, not the later 603-input/516-timestamp forward promotion.
It establishes the reviewed historical selection and immutable bytes,
not native execution, ledger provenance, source-effect completeness or approval.

## Findings at a glance

| Constraint/domain | Proven observed difference | Disposition |
| --- | --- | --- |
| company_memberships role CHECK | Same seven values, different ARRAY order | Semantically equal predicate; do not rewrite SQL just for text parity |
| company_memberships status CHECK | Adds deleted_test_only, plus order changes | Source-explicit widening; lifecycle acceptance remains qualified |
| customer_info_requests status CHECK | Adds seven values; removes none | Source-explicit runtime vocabulary, including current z01_prepared writer |
| customer_lifecycle_decisions type CHECK | Adds cancelled | Current case-to-decision write/read contract needs this value |
| user_profiles auth-action CHECK | Enumerated seven values becomes bounded safe-token syntax | Preserve reviewed flexible-action boundary and current app metadata |
| ediel_message_intents customer/company FK | SET NULL now targets customer_id only | Existing intentional forward repair preserves tenant company |
| ediel_test_run_messages company FK absent | Direct company CASCADE absent; required run/composite path retained | Referential existence and final cascade result are transitively covered; full operational equivalence not executed |
| powers_of_attorney contract FK absent | Reference single SET NULL replaced by validated tenant composite NO ACTION | Preserve tenant composite NO ACTION under retained-history contract; deliberately not SET NULL equivalence |

## Changed CHECK constraints

### Membership role: semantic equality

Reference `schema.sql:52612` enumerates owner, admin, company_admin, operations,
support, member, viewer. Replay enumerates company_admin, member, viewer, owner,
admin, operations, support. Set comparison confirmed exact equality, with no
NULL array elements or duplicates. Both definitions are validated CHECKs over
`membership_role = ANY (ARRAY[...])` using text values. Reordering this finite
membership list does not change TRUE/FALSE/NULL outcomes; independent column
nullability is unchanged by this finding.

F50 `20260528_final_user_access_schema_safe_repair.sql:101-104` defines the replay
ordering. The reviewed auth boundary retains those CHECK authorities
(`scripts/canonical-auth-provisioning-legacy-batch.py:342-355`). F63
`20260911095505_canonical_user_rbac_fixed_target_restoration.sql:96-105` restores
the exact captured predecessor role CHECK after the bounded legacy seed, rather
than introducing a new role domain. Hash reconstruction confirms the final form.
Consumers use role values, not array order: e.g.
`lib/auth/companyUserAccess.ts:104-108` compares membership_role to mapped identity.
No correction or constraint drop/recreation is needed for this predicate alone.
This is a scoped semantic conclusion, not permission to suppress other differences.

### Membership status: deleted_test_only is an additional value

This is NOT solely a reordered domain. The ten reference values at
`schema.sql:52613` all survive, but replay also permits deleted_test_only.
F76 `20260520_company_delete_backfill_and_admin_layout.sql:24-31` explicitly
replaces the status CHECK with the eleven-value lifecycle list. It executes after
F50 and its intermediate restored CHECKs; chronological filename order is not
the selected execution order.

The source calls this widening of lifecycle statuses. Current company lifecycle
code uses deleted_test_only for companies, but that alone is not evidence that a
membership should acquire this status. No current inspected writer assigning that
value to a membership was established. Actual membership access selectors
`lib/tenant/scope.ts:111-117` and `lib/auth/companyUserAccess.ts:51-61` require
status=active (the latter also requires is_active=true), so merely admitting this
inactive token is not an authorization bypass on those paths. This is not a
repository-wide access-control equivalence claim.

Disposition: preserve source-authored widening while qualifying final lifecycle
requirements. Do not describe it as textual-only parity or silently remove the
value. Any narrowing requires all membership writers, existing values, and cleanup
semantics to be checked in a separate forward-change decision.

### Customer information request status: seven runtime states added

The replay domain contains all 17 reference values (`schema.sql:25447`) and adds:
`sent`, `waiting_response`, `received`, `partially_received`, `failed`,
`z01_prepared`, `route_missing`. Direct finite-set comparison verified this exact
seven-value addition, with no removed values. Both CHECKs are validated.

F17 `20260521_final_customer_info_request_status_check.sql:19-44` already includes
z01_prepared and route_missing. The final named CHECK writer F84
`20260526_batch_3c_3d_fullmakt_data_requests.sql:8-35` explicitly installs the full
24-value union. This is intentional source vocabulary; original SQL is unchanged.
A current concrete consumer proves at least one added value is necessary:
`lib/customer-operations/z01Finalizer.ts:438-439,473-478` sets z01_prepared on
customer_info_requests when the outbound request is prepared. Reference narrowing
would reject that update with CHECK violation. Other request tables also use
similar words; they were not treated as evidence for this table.

Disposition: source-qualified runtime extension. Preserve it; do not rebuild the
17-value reference CHECK. Exact broader state transitions and all seven producers
are not certified by this bounded review.

### Customer lifecycle decision: cancelled is required by the current case path

Reference `schema.sql:54507` accepts withdrawal/rejected only. T164
`20260710190000_customer_card_pricing_portfolio_hardening.sql:131-145` explicitly
replaces it with withdrawal/cancelled/rejected.

`app/admin/customers/[id]/actions.part-4.ts:380-390,515-528` accepts cancelled and
maps it to onboarding_aborted. The case engine calls
createLifecycleDecisionFromCase at `lib/customer-cases/engine.ts:429-433`.
`lib/operations/switchLifecycleBlocks.ts:111-126` maps onboarding_aborted and
supplier_switch_aborted to cancelled; lines157-181 write decision_type to this
table. The blocking reader at195-200 includes cancelled. Thus this is a complete
source/app write/read vocabulary match, not an inferred label correspondence.

Disposition: keep the source-authored extension. Replacing it with the reference
would break the known cancellation-decision insert. No new executed PostgreSQL
or end-to-end cancellation receipt is claimed.

### Auth profile action: preserve the reviewed flexible-action repair

Reference `schema.sql:67711` accepts NULL or only seven enum-like text values.
Replay accepts NULL or a token of length <=120 matching `^[a-z0-9_:.]+$`.
F6 `20260520_user_profiles_auth_action_constraint_hardfix.sql:38-45` authors this
flexible metadata rule. F52
`20260910140053_canonical_auth_provisioning_legacy_boundary.sql:23-26` reinstates
that exact rule without the hardfix's lossy normalization DML. The independent
oracle binds the authority source in
`scripts/canonical-auth-provisioning-legacy-batch.py:342-355`.
This review does not recreate or alter the previously approved auth correction.

Current actual callers supply safe tokens beyond the reference seven:
`lib/auth/authEmailFlow.ts:231-242` writes verified_ followed by the action type;
`app/admin/users/actions.ts:141-147,217-223` supplies
invite_existing_user_matched, role_assigned and direct_user_created.
`lib/auth/authEmailFlow.ts:126-144` writes the action, but on23514 retries after
removing the action/timestamp; a narrow CHECK can therefore discard the metadata
rather than proving that the overall user creation necessarily fails.

Disposition: source-qualified broader metadata contract. Preserve bounded token
validation, the approved source boundary and retained evidence. Do not restore
the old enumerated reference or normalize historical values to force acceptance.

## Changed intent FK

Reference (`schema.sql:87205`):

```sql
FOREIGN KEY (customer_id, company_id) REFERENCES customers(id, company_id)
ON UPDATE CASCADE ON DELETE SET NULL
```

Observed replay adds the targeted delete-column list:

```sql
FOREIGN KEY (customer_id, company_id) REFERENCES customers(id, company_id)
ON UPDATE CASCADE ON DELETE SET NULL (customer_id)
```

T514 `20260913211625_ediel_intent_customer_company_integrity.sql:28-42,45-70`
is the already selected forward source. It admits only the absent key or exact
historical predecessor, preserves update cascade, requires nullable customer_id
and NOT NULL company_id, and validates the relationship. It preserves the prior
constraint comment when replacing it. The hash proves targeted SET NULL and a
validated final FK.

The parent-delete distinction matters: unrestricted composite SET NULL attempts
to clear both customer_id and tenant company_id; the targeted action preserves
company ownership. `schema.sql:57183,57198` agrees with required company/optional
customer. `lib/ediel/intent/intentEngine.ts:288-300` resolves idempotent intents by
company/environment/key, demonstrating why detaching a customer must retain the
tenant identity.

Disposition: retain this explicit forward correction. The old reference FK is
not a desired replacement; do not fold this already-fixed source into the separate
seven-composite repair or replace its tenant-safe targeted action. This report
proves observed shape/source meaning, not full customer deletion success in the
presence of all other relationships.

## Removed ediel_test_run_messages_company_id_fkey

Reference direct FK (`schema.sql:87835`) is validated company_id → companies.id,
ON DELETE CASCADE. The missing inline relationship is source-causal: foundation
`20260519_ediel_tenant_profile_runtime_sync.sql:9-26` adds company_id without an
FK before T247 `20260802013000_ediel_test_evidence_v2.sql:21` requests it with
ADD COLUMN IF NOT EXISTS ... REFERENCES. The latter skips the existing column.
F75 `20260513_ediel_agt_saas_runtime_safe.sql:13-39` is another conditional naked
company addition, not a later FK recreation.

Unlike a missing ownership edge with no replacement, the complete diff shows
these reference objects unchanged (absent from added/removed/changed lists):

- `ediel_test_run_messages_company_run_fk_v2`: validated
  (company_id,test_run_id) → ediel_test_runs(company_id,id), ON DELETE CASCADE.
- `ediel_test_run_messages_company_message_fk_v2`: validated
  (company_id,ediel_message_id) → ediel_messages(company_id,id), ON DELETE CASCADE.
- `ediel_test_runs_company_id_fkey`: validated company_id → companies.id,
  ON DELETE CASCADE.
- The link's company_id, test_run_id and ediel_message_id column rows are unchanged
  and NOT NULL (`schema.sql:58472-58482`). No MATCH SIMPLE null escape exists on
  the required company/run pair.

The corresponding reference definitions are at `schema.sql:87843-87851,87898`.
T247 installs the composite CASCADE paths at123-131; T249
`20260802015000_canonical_backfill_constraints.sql:153-200` validates the keys and
promotes company NOT NULL for clean data. That source tolerates dirty validation
failures, so its presence alone is insufficient; unchanged full-diff comparison
to validated reference objects establishes this artifact's resulting state.

Relational proof: every retained link must reference a same-company run; every
run must reference an existing company. Therefore an orphan company link cannot
pass these constraints. If a company deletion succeeds, its runs cascade away,
and those runs cascade their links away. The missing direct edge adds no new
allowed orphan or retained-link outcome under these observed non-null, validated
relationships. The message composite supplies an additional same-tenant path.

App evidence is consistent: `lib/ediel/db.ts:1412-1459` resolves both run and message
within the required company, rejects absent/wrong-tenant parents and non-test
messages, then writes company_id/test_run_id/ediel_message_id together. Existing
evidence guards apply on INSERT/UPDATE (`schema.sql:82822`); no new delete behavior
was executed here.

Disposition: qualified transitive coverage for referential existence and final
cascade row result. Do not report an exposed orphan gap from the missing direct
FK alone. This does NOT prove equality of every trigger ordering, lock pattern,
statement observation, failure timing or complete company-deletion workflow.
An isolated company/run/link deletion and cross-tenant/NULL negative matrix is
still required before claiming operational equivalence or accepting the diff.
No automatic FK recreation is justified solely by its missing name.

## Removed powers_of_attorney_contract_id_fkey

**PRESERVE tenant-qualified NO ACTION for a retained POA contract link.
This is a deliberate restrictive disposition, not SET NULL equivalence.**

The reference (`schema.sql:89669`) is validated contract_id → customer_contracts.id,
ON DELETE SET NULL. F141
`20260528_debug_post_repair_schema_guardrails.sql:238-243` supplies contract_id uuid
without an FK. T64 `20260613090000_batch_m_ops_master_legal_readiness.sql:181-183`
requests the inline SET NULL FK only through ADD COLUMN IF NOT EXISTS. It therefore
never creates the reference relationship on the selected predecessor.

T243 `20260801143000_canonical_multitenant_platform_hardening.sql:284,348-363`
then creates `mt_powers_of_attorney_contract_id_tenant_fk` on
(company_id,contract_id) → customer_contracts(company_id,id), with no ON DELETE or
ON UPDATE clause. The entire added-row hash reconstructs this FK as validated
and NO ACTION, without a NOT VALID suffix. Its required-company CHECK also
reconstructs validated, preventing a NULL company bypass even if physical column
nullability is weaker. Source creation initially says NOT VALID; the observed
validated end state is from the artifact, not assumed from source alone.

At the FK level these are not equivalent. With a referencing POA retained, a
parent contract delete can detach contract_id under the reference single FK;
NO ACTION under replay requires the reference to be removed/nullified before its
check can succeed. The composite improves same-tenant matching, but that does
not settle the intended retention/detachment policy.

Counterexamples to claiming a blanket app failure:

- The final function source
  `20260818170828_signed_contract_document_hash_binding.sql:31-38` preserves the
  earlier July27 rule rejecting deletion of signed/active/terminated/cancelled/
  expired, signed_at or locked_at contracts with55000. Many realistic rows fail
  before this FK distinction can decide their outcome.
- The inspected customer-deletion path explicitly deletes POAs before customer
  contracts (`app/admin/customers/[id]/profile-actions.part-2.ts:749-756`), so it
  does not establish reliance on implicit contract-only detachment.
- POA updates have scope-materialization/snapshot triggers
  (`schema.sql:83050-83068`); parent deletion and detachment must preserve these
  downstream invariants. Presence of a SET NULL FK alone cannot certify that.
- Current POA lookup/writes use company/customer and optional contract references,
  e.g. `lib/website/customerApplicationLegal.ts:953-964` and
  `lib/customer-portal/tenantSync.ts:684-693`. No supported contract-only hard-delete
  flow retaining a linked POA was established by this bounded search.

The follow-up resolves the policy choice against documented retention and the
actual customer-contract path:

- `docs/testing/production-certification-e2e.md:20` explicitly preserves real
  customers, POAs, contracts and legal/market history; synthetic cleanup uses its
  own lifecycle. `docs/ai-context/26_OPS_PLATFORM_GOVERNANCE_AUDIT_CLEANUP.md:54-67`
  prescribes archive/lifecycle-close for real customers and treats any customer
  contract as protected history. This is positive retention authority, not proof
  from a missing delete call alone.
- The actual deletion action checks test identity and protected history before
  deletion (`profile-actions.part-2.ts:607-619`). Its predicate at554-578
  explicitly blocks any contractIds OR powerOfAttorneyIds OR POA events/documents.
  Thus a draft contract with a linked POA cannot reach this cleanup, even when
  marked test data. The later POA-before-contract delete order is defensive code,
  not evidence of an admitted referenced-parent deletion path.
- The unused-offer deletion documents describe contract-product/public-offer
  graphs. Their permission to delete empty draft/ready offers is not permission
  to detach a `powers_of_attorney.contract_id` from a customer contract. In any
  event their stated rule retains legal/business history
  (`docs/canonical-contract-deletion-graph-2026-07-26.md:8-16`).
- Optional contract_id supports an originally contract-less customer POA; it does
  not imply that an established legal relation should be silently erased when its
  parent is deleted. The snapshot/event contract explicitly preserves POA evidence
  (`docs/ops-api-customer-intake-facility.md:220-232`).

Decision: retain the validated tenant composite with NO ACTION and the validated
required-company CHECK. A draft customer contract with a retained, non-NULL POA
link is referenced legal/business history and should not be treated as unused;
reject its deletion until a separately authorized retention/cleanup operation
handles that relationship. Signed/locked contracts remain independently protected.
Contract-less POAs remain supported by nullable contract_id and MATCH SIMPLE;
wrong-tenant non-NULL references remain prohibited. This is the final recommended
schema contract for this scope, inferred from the cited retention policy and
implemented source behavior, not a claim that the generic August1 author expressly
reviewed every POA delete action.

No forward SET NULL repair is warranted by the evidence. Restoring the reference
single FK or changing the composite to SET NULL(contract_id) would introduce
implicit detachment without a supported current operation requiring it. Keep
historical SQL and the reference unchanged here. A future explicit contract-only
detachment feature would require its own forward design and trigger/evidence
qualification; it is not a remaining decision required for this bounded review.

Native limitation: no live delete or cross-tenant transaction was run. The exact
catalog hashes prove the relation shape; PostgreSQL referential semantics predict
23503 for the otherwise-unblocked referenced draft deletion and preserve the parent
and POA when that statement fails. No claim is made about the first error where
other guards reject earlier, full application cleanup success, or trigger ordering.
Final native schema acceptance must test the chosen restrictive behavior, rather
than assert SET NULL equivalence or merely accept a differing FK hash.

The absent contract-leading index is separately tracked in
`PR310_SCHEMA_INDEX_DISPOSITIONS_2026-09-15.md`; no performance conclusion or index
change follows from this constraint review.

## Exact reconstructed row hashes

All rows below have `nspname=public` and `convalidated=true`. C/F in the object
kind denotes CHECK/foreign key. Removed rows describe the reference only.

| Side | Constraint | Kind | SHA256 |
| --- | --- | --- | --- |
| reference | `company_memberships.company_memberships_role_check` | c | `beebb842056999b909f14d9ebe80e04ff8978744e06de1eebf10f622a18ae58b` |
| replay | `company_memberships.company_memberships_role_check` | c | `7c0ad95cc7dcdd620eeb4a8bb883cb53aca0fc8bffcd691990e3ac23420a1c00` |
| reference | `company_memberships.company_memberships_status_check` | c | `2ce7af58a5d9fa71f72bba2698ffb6ea65cec537af2973727633d2c2d05b4125` |
| replay | `company_memberships.company_memberships_status_check` | c | `2ab7d6cb36a0a3236a71a8217e8dc0f449ecea97d0276a9dbd277916fb9046f8` |
| reference | `customer_info_requests.customer_info_requests_status_check` | c | `55628b4ce0249e5fdaa68258e0546a6e50dc7aea309aa64cf198891f797a5059` |
| replay | `customer_info_requests.customer_info_requests_status_check` | c | `449d09ec56d5aa2ad24704654f36da108bed2f4f55e87c0a811fe3e1e51b6ffa` |
| reference | `customer_lifecycle_decisions.customer_lifecycle_decisions_decision_type_check` | c | `2af093ab6b91dd1e244110db3934178c4eecc41bf76005c98ace0bd83f246338` |
| replay | `customer_lifecycle_decisions.customer_lifecycle_decisions_decision_type_check` | c | `a322745b089505284628cf2789a8a8e3b7927218bd028cafcbb6f86353cb4778` |
| reference | `ediel_message_intents.ediel_message_intents_customer_company_fk` | f | `7c93cbe17fb74cd13aa47c2adede3bf777a668e1b45f32504dac51b265214f69` |
| replay | `ediel_message_intents.ediel_message_intents_customer_company_fk` | f | `6ba72d1db54c6562f99c79cb49af9fdfa54deca0eda5b656471cea8f259bce96` |
| reference | `user_profiles.user_profiles_last_auth_email_action_check` | c | `fb13fff9121d65ed080f0bcd4b21bfb8b047f2e9279fadb95914e48a13563890` |
| replay | `user_profiles.user_profiles_last_auth_email_action_check` | c | `eefbd493efee01508b6ddf3030e972c7b00124f59e073906ce773a49e7024412` |
| removed | `ediel_test_run_messages.ediel_test_run_messages_company_id_fkey` | f | `82ae78eea6d355e2ebb2a57e39be05dbe11a466b128b32b9ccc73eee3c518627` |
| removed | `powers_of_attorney.powers_of_attorney_contract_id_fkey` | f | `c25d2d807c0f74de5744d64b2dc94cd86a4c16f0c32134dffc4ad5f511165579` |
| added | `powers_of_attorney.mt_powers_of_attorney_contract_id_tenant_fk` | f | `d8b578054b97029649d6d3b65efed89bf683b5860e8810020fbb6ba3e3073684` |
| added | `powers_of_attorney.mt_powers_of_attorney_company_id_required` | c | `ee1244056980b7cac5f4c296aa0def68d131fc9e1e315f63bd84b5744918b332` |

The POA added composite reconstructs exactly as
`FOREIGN KEY (company_id, contract_id) REFERENCES customer_contracts(company_id, id)`;
the required-company row is exactly `CHECK (company_id IS NOT NULL)`.
For the changed checks the precise value sequences are captured in the domains
above and immutable source below; the exact full-row hashes distinguish the
reference/replay definitions even when their predicates are semantically equal.

## Selected source identity

F/T positions come from the actual existing selector, not filename chronology.
All rows here are FULL_FILE_SELECTED, which is input authority rather than
native execution/ledger/source-effect acceptance.

| Migration under supabase/migrations | Position | SHA256 |
| --- | --- | --- |
| `20260513_ediel_agt_saas_runtime_safe.sql` | F75 | `152e4e573bde3b50eda8c7e5bfdca6fe4a54115e4ed1d7bcfc8e1b946ed1c15b` |
| `20260519_ediel_tenant_profile_runtime_sync.sql` | F70 | `b5c475b7419c824b4d1c8ec713131d48c41c2be6f5607890bda42f238548426e` |
| `20260520_company_delete_backfill_and_admin_layout.sql` | F76 | `72aef3d5609bd6a508299bccf1eed849b58a4f925844b097d44bb8bdca667d1f` |
| `20260520_user_profiles_auth_action_constraint_hardfix.sql` | F6 | `2132d4c424ea992725f249d1c99149cc4c45dd35256992781d9ab138c4c86928` |
| `20260521_final_customer_info_request_status_check.sql` | F17 | `fbd0a547a13e5da8358dc2108ac508d09bef8667ecb0c196c2986059dead5f9c` |
| `20260526_batch_3c_3d_fullmakt_data_requests.sql` | F84 | `20b9beb1536e870b922b455ee1afa53c36797aa6d211e06c75070a3c5eab3b92` |
| `20260528_debug_post_repair_schema_guardrails.sql` | F141 | `41e63220e564c6efee26011e65055b95d5f5ca9e60a7c36811ec00e8f69579e6` |
| `20260528_final_user_access_schema_safe_repair.sql` | F50 | `4968391d74a8ff813ce1f56a8b8d9ade682692d183988917e736d0f3c5857bd2` |
| `20260613090000_batch_m_ops_master_legal_readiness.sql` | T64 | `599b707e9f979727fcf39843d88ee376c15409731a780befb01d2ed436ec842d` |
| `20260710190000_customer_card_pricing_portfolio_hardening.sql` | T164 | `6aef48fee0227e8c5a076a9f0f93d82a01cc4bf23a7e682fac0d0e24015e46d2` |
| `20260801143000_canonical_multitenant_platform_hardening.sql` | T243 | `4de56322077ea89f72596bd9cd2de9f2bdae67c2b74c4721779410553b3326b0` |
| `20260802013000_ediel_test_evidence_v2.sql` | T247 | `96f058911d2499fdf2f540e7b2db541cbbc0ffd5ba798858b349779497ecf46d` |
| `20260802015000_canonical_backfill_constraints.sql` | T249 | `03be13ac213573978894b2261452c098ee0f082245e2387e60a0068ffffd9049` |
| `20260910140053_canonical_auth_provisioning_legacy_boundary.sql` | F52 | `fcc6594b1b312e139ac094b811fee9395ee6ab780144d14d1c19e0c178a28983` |
| `20260911095505_canonical_user_rbac_fixed_target_restoration.sql` | F63 | `f6fbfd30b62e9529539c27c00722c89446e6ed5dd7cbed9217594f7202025ee7` |
| `20260913211625_ediel_intent_customer_company_integrity.sql` | T514 | `2b9cc5e9cb7fad14aa4b30e0bc98274a4a957f47379f456ed0d3c9663ef5f39b` |

## Verification and remaining boundary

- Artifact ZIP hash: PASS.
- Six changed constraint identities: exact coverage, all12 side hashes PASS.
- Two removed FK hashes and two POA added constraint hashes: all4 PASS.
- Role domains: exact set equality PASS. Membership status: exactly one additional
  value PASS. Information-request statuses: exactly seven additional values and
  no removals PASS.
- Transitive Ediel prerequisite constraints/columns: confirmed unchanged in the
  complete artifact diff against the committed reference definitions.
- Existing selector/pins: PASS,144 foundation/514 timestamp; no SQL or shell replay.
- PostgreSQL/PostgREST/native lifecycle/live data/end-to-end: NOT RUN in this review.
- Sources, schema/types, memory, DB and publication: NOT MODIFIED by this review.

POA contract parent-delete behavior now has a concrete restrictive disposition:
retain NO ACTION under the documented retention contract. Its difference from
SET NULL remains explicit and is not waived as equivalent. Membership
deleted_test_only remains a real authored extension whose final lifecycle usage
is qualified, not a reordered-domain equality claim. Known auth and intent repairs
remain intact. Keep the reference unchanged until residual domains and final
native/app qualification gates have been completed; this report changes neither
those gates nor any runtime assertion.
