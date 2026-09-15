# PR310 remaining non-physical column dispositions — 2026-09-15

Status: SOURCE DISPOSITIONS COMPLETE for these 14 columns; no schema, reference,
generated-type, native-lifecycle or release acceptance.

## Scope, method and boundaries

Independent bounded review at repository head `70ce549fa9facdec9add63f91db224ee4c2bc2bb`.
Final targeted seven-column follow-up reviewed at `fd4fb9077d206ed2165fec0687ffb8f6b9a4ed87`.
This is the remaining 14 columns with changes beyond physical ordinal in the
335f987f portable 144-foundation/514-timestamp diff. The four changed types are
covered separately in `PR310_SCHEMA_COLUMN_DISPOSITIONS_2026-09-15.md`.
Historical SQL, accepted reference, migrations, code and shared memory are unchanged.

Skill routing: repository code-review/differential-review evidence workflow and
fp-check-equivalent source-to-consumer verification apply. SQL/database integrity
is in scope; UI styling, performance optimization, dependency/security scanning,
implementation and broad runtime testing are outside this read-only domain.
The only created repository file is this report.

Artifact: `pr310-schema-335f987f.zip`, full-schema run34963346325/artifact10394485748.
Verified ZIP SHA256 `4009f365e8b7e255611992a12c031df159da2e16a4e46875af25593668d4aecb`.
Reference public projection SHA256 `e404dd6b8493da3332e15fde7622ef22098157d7933d98c0bc0d3992e3818106`;
replay SHA256 `4b5d003fea640f0f2f52a3e410fc07a01988e92f5bc6cfc8b3055ec9c2709755`.

All 28 reference/replay column-row hashes were reconstructed exactly, using the
fields in `scripts/sql/gridex-db-parity-introspect.sql:22-34` and the sorted compact
JSON/ensure_ascii SHA256 algorithm in `scripts/canonical-full-schema-reference.py:41-43`.
Candidate row values came from schema/source declarations; physical ordinals were
searched from 1 through 149. Every target had exactly one matching row. This is
catalog-artifact evidence, not a fresh database query or executed app transaction.
All these rows have `nspname=public`, empty `identity` and `generated`, and
`udt_name` equal to the displayed data type.

At the original review boundary, the existing input selector was also executed through the read-only
`gridex-replay-input-accounting.py.account()` interface: 144 foundation and 514
timestamp inputs. This is the historical 601-input/514-timestamp receipt, not the later
603-input/516-timestamp forward promotion. It validates selection/pins only. Its SUBSTITUTED label for
June1 is preserved below; separate residual execution evidence is not relabeled
as an ordinary selector row. No whole-replay acceptance follows from this check.

## Reconstructed catalog differences

`NULL` means nullable; `NOT NULL` means required. A dash means no column default.
Ordinals are reported solely to make the observed hashes reproducible.

| Column | Type | Reference: ordinal; nullability; default | Replay: ordinal; nullability; default |
| --- | --- | --- | --- |
| `auth_email_events.event_type` | `text` | 6; NOT NULL; — | 11; NULL; — |
| `auth_email_events.source` | `text` | 8; NOT NULL; `'application'::text` | 12; NULL; `'app'::text` |
| `auth_email_events.status` | `text` | 7; NOT NULL; — | 5; NOT NULL; `'sent'::text` |
| `billing_underlays.pricing_snapshot` | `jsonb` | 40; NOT NULL; `'{}'::jsonb` | 34; NULL; `'{}'::jsonb` |
| `customer_documents.status` | `text` | 31; NOT NULL; `'available'::text` | 23; NOT NULL; `'uploaded'::text` |
| `customer_portal_identities.match_strength` | `text` | 10; NOT NULL; `'weak'::text` | 10; NOT NULL; `'manual'::text` |
| `customers.intake_status` | `text` | 39; NULL; — | 30; NOT NULL; `'draft'::text` |
| `ediel_mailboxes.mailbox_type` | `text` | 19; NOT NULL; `'shared'::text` | 19; NULL; — |
| `ediel_send_locks.lock_key` | `text` | 4; NOT NULL; — | 13; NULL; — |
| `ediel_tgt_test_data.data_key` | `text` | 6; NOT NULL; — | 6; NULL; `'portal_payload'::text` |
| `integration_api_requests.method` | `text` | 5; NULL; — | 5; NOT NULL; — |
| `integration_api_requests.route` | `text` | 6; NULL; — | 6; NOT NULL; — |
| `role_permissions.permission_id` | `uuid` | 4; NULL; — | 4; NOT NULL; — |
| `role_permissions.role_id` | `uuid` | 2; NULL; — | 2; NOT NULL; — |

## Source-causal dispositions and consumer evidence

### 1. Auth email events: event_type, source and status

**PRESERVE the selected legacy-compatible event shape and defaults.**
Foundation F5 `20260519_auth_callback_email_reset_sync.sql:47-57` creates the older
`action` event shape, with status NOT NULL DEFAULT sent. F7
`20260519_auth_email_templates_invite_reset_sync.sql:106-141` has a stronger
CREATE definition, but its effective ALTER adds `event_type text` and
`source text DEFAULT app`, both nullable, and retains the existing status default.
The final relevant declaration, T97
`20260617203000_simplified_customer_ops_events_and_mail_architecture.sql:83-105`,
requests required event_type/source, application source default, and no status
default only in CREATE TABLE IF NOT EXISTS. Its additive ALTER does not strengthen
existing columns or replace defaults. It cannot produce the reference attributes
on this selected predecessor.

`lib/auth/authEmailFlow.ts:80-102` explicitly writes event_type, source (app by
default), and status (sent by default). `lib/tenant/passwordResetEmail.ts:96-118`
also supplies all three. Thus changing only these database defaults does not fix
an observed omission on those paths. The older exported writer at
`lib/auth/userSync.ts:74-99` writes action/status and omits event_type/source; no
current app/lib import of that module was found in this bounded search, so its
reachability is NOT proved and is not used to assert a live failure.

The explicit preservation contract in
`AUTH_PROVISIONING_LEGACY_ADMISSION_CONTRACT_2026-09-10.md:74,91` retains
historical action/event_type/status/source, including NULL/unknown/extended events,
and restores exact pre-batch event CHECKs rather than normalizing audit history.
Its selected-predecessor authority is template7 and its complete predecessors,
which are exactly the sources responsible for these attributes. This is positive
compatibility authority, not merely an absence of observed failures.

Decision: retain nullable event_type/source, source DEFAULT app and status
NOT NULL DEFAULT sent. The current canonical writer independently uses app/sent;
changing the source label to application would create divergent provenance for
otherwise identical omitted-field events. The status default is an existing
admission convention, not proof of delivery; explicit failed/other allowed states
must remain intact. This does not authorize new incomplete canonical events:
current canonical callers continue to supply event_type explicitly. No forward
attribute repair or historical row rewrite is warranted for parity. The stronger
reference CREATE branch is a different contract, not equivalent catalog text.
Whole-table action/CHECK/grant qualification remains outside these three attributes.

### 2. billing_underlays.pricing_snapshot

**PRESERVE nullable compatibility JSONB; enforce billing evidence through its actual contract.**
F126 `20260521_batch3_pricing_billing_audit_roles_completion.sql:66-70` first adds
nullable JSONB DEFAULT {}. T27 `20260608120000_metering_billing_pricing_engine.sql:133`
requests NOT NULL only with ADD COLUMN IF NOT EXISTS. The last relevant column
addition, T29 `20260608152000_billing_source_normalized_fix.sql:63`, again declares
nullable JSONB DEFAULT {}; neither later source performs SET NOT NULL.

`lib/billing/underlayEngine.ts:432-434,601,689,957` constructs an object snapshot
and explicitly writes it in both underlay paths. `lib/billing/underlayEvidence.ts:12-14,149-166`
normalizes non-object input to {}, then rejects missing frozen base components
for non-production energy. `lib/billing/invoiceReadiness.ts:392` separately checks
snapshot identity IDs; those are distinct from this JSONB column.

The final storage RPC in
`20260901152500_canonicalize_billing_underlay_stockholm_period_semantics.sql:36-65`
explicitly stores pending/blocked underlays and coalesces an omitted snapshot to
{}. The documented exact binding chain
(`docs/contract-platform-109-remediation.md:11,101,113-115`) concerns immutable
contract/pricing identities and successful evidence, not mandatory nonempty JSONB
on every pending diagnostic row. `gridex_guard_billing_underlay_exact_refs` in
`20260716010000_contract_billing_end_to_end_completion.sql:984-996` checks contract
and snapshot IDs when the row reaches billable states. That guard does not certify
JSON contents, and is not presented as a universal invoice acceptance proof.

Decision: retain the nullable JSONB/default {} compatibility shape. SQL NULL, JSON
null and {} are distinct stored values; none establishes complete frozen pricing.
NOT NULL would still admit JSON null and {}, so this column difference is not the
missing completeness rule. Current app evidence validation treats absent/nonobject
payload as missing evidence, and normal producers construct explicit snapshots.
No concrete pricing failure attributable to SQL nullability was established; no
forward NOT NULL/backfill is justified. Existing invoice/evidence defects and gates
remain separately tracked in BILLING_EVIDENCE_APPLICATION_GUARDS and the billing
native evidence contract; this disposition does not close or weaken them.

### 3. customer_documents.status

**PRESERVE DEFAULT uploaded; explicit available snapshots keep their own status.**
F138 `20260526_batch_3a_3b_customer_intake_blockers_documents.sql:61` adds required
status DEFAULT uploaded. The final relevant declaration T95
`20260617183000_portal_documents_mail_onboarding_batch.sql:20-27` requests DEFAULT
available through ADD COLUMN IF NOT EXISTS; no ALTER SET DEFAULT follows.

Both values are used deliberately in current application writes:
`lib/customer-portal/tenantSync.ts:520-543` explicitly chooses uploaded unless
provided; `lib/customer-portal/powerOfAttorneyDocuments.ts:29-53` and
`lib/website/customerApplicationLegal.ts:1320-1339` explicitly write available for
POA snapshot records. The tenantSync minimal schema-fallback payload at545-565
omits status; that fallback requires an earlier missing-schema error, whose
occurrence on this full replay was not established. `listPortalDocuments` at
`lib/customer-portal/apiData.ts:498-558` does not filter customer_documents to
available status. Its archived filter is on customer_authorization_documents,
a different relation.

The operational snapshot documentation
(`docs/customer-card-operational-snapshot-followup.md:7-9`) requires a signed POA
or an available POA document. The actual predicate
`lib/customers/customerCardSnapshot.ts:126-149` defines document availability to
include both uploaded and available (plus active/signed/suggested/completed).
Thus the omission/fallback default does not lose this specific readiness signal;
this is direct predicate evidence, beyond portal list visibility.

Decision: keep DEFAULT uploaded, matching the general upload producer. Keep
available explicit for completed internal legal snapshots. The default difference
is real for raw stored status, but it does not justify changing the upload contract
or rewriting rows. No normal producer or inspected readiness/list consumer requires
available-by-default. This finding does not equate every future consumer of the
literal strings; it fixes the reviewed default contract and needs no forward DDL.

### 4. customer_portal_identities.match_strength

**SOURCE-QUALIFIED explicit default change; not a defect to undo for parity.**
T33 `20260609113000_batch_2_3_4_6_period_onboarding_ediel_portal.sql:135` initially
defines weak. T37 `20260609150000_batch_6_sync_status_origin_fix.sql:24-38` explicitly
ALTERs the default to manual and documents the intended strong/weak/manual contract.
The later T424 `20260823201716_canonical_customer_portal_match_strength_convergence.sql:1-32`
normalizes medium to weak and replaces the CHECK/trigger; it does not change the
manual default.

`app/api/v1/customer-portal/sync/route.ts:198-219` writes explicit input.matchStrength;
`lib/website/customerApplicationCommunication.ts:715-742` explicitly chooses strong
or weak; `lib/customer-portal/customerResolver.ts:405,622,761` also resolves/writes
explicit canonical strengths. The weak reference default is not evidence to undo
an explicit selected ALTER. Omission behavior differs by design in the source;
full SQL/API and identity security qualification remain separate.

### 5. customers.intake_status

**PRESERVE NOT NULL DEFAULT draft as the compact initial intake state.**
F77 `20260521_batch_customer_intake_debug_hardening.sql:9` and the later foundation
batch2 source declare NOT NULL DEFAULT draft. May26 and June10 additions request
nullable text only if the column is absent. The last relevant column declaration
is T44 `20260610171000_customer_application_status_hardening.sql:11`; it does not
drop NOT NULL/default. `20260705110000_gridex_intake_status_contract_alignment.sql:52-75`
replaces the CHECK and includes draft (and nullable cases) without changing column
nullability/default. A CHECK allowing NULL does not override NOT NULL.

Current onboarding/review writes explicitly use customerIntakeStatusForReadiness:
`lib/website/customerApplicationOnboarding.ts:194`,
`lib/website/customerApplicationShared.ts:241`, and
`app/admin/website-applications/actions.ts:412`. Nullable reads at
`lib/customers/getCustomers.ts:190` accommodate either representation. The mapper itself
(`lib/website/applicationReview.ts:180-207`) explicitly returns draft when no more
specific readiness state applies. The final SQL process-summary repair
`20260823185028_fix_customer_process_summary_intake_status.sql:4-6,48-54`
documents the compact vocabulary and replaces incompatible projection strings
with concrete needs_admin_review/blocked/pending_information/active_supply states;
its CASE never writes NULL. This closes the previously deferred SQL-writer check.

Decision: keep required draft on omission. Draft represents the initial compact
state; nullable reads and a NULL-tolerant CHECK provide compatibility, not a command
to erase that initial state or drop its constraint. The migration contains no such
ALTER, and current app/SQL writers preserve a concrete compact status. No forward
DROP NOT NULL/DROP DEFAULT or row normalization is warranted for parity.

### 6. ediel_mailboxes.mailbox_type

**PRESERVE nullable, unclassified mailbox metadata with no default.**
The whole June1 residual source
`20260601070000_ediel_production_readiness_hardening.sql:55-56` adds nullable text
without default. Its ordinary selector accounting remains SUBSTITUTED; the separate
residual path executes the original before the June2 keyed-lock successor, as
specified in `scripts/canonical-residual-readiness-transitions.py:1-18` and
`scripts/canonical-residual-readiness-native.py:41-80`.
T18 `20260602101500_ediel_shared_mailbox_subaddress_security.sql:54-55` requests
NOT NULL DEFAULT shared through ADD COLUMN IF NOT EXISTS, so it does not change
the inherited column. The last addition T499
`20260903160000_ediel_send_lock_state_convergence.sql:12-14` again says nullable text.

`app/admin/ediel/system-tests/actions.part-1.ts:321-340` supplies platform_shared;
`app/admin/ediel/mailboxes/page.tsx:13,116` accepts nullable mailbox_type and falls
back to shared for display. `lib/inbound-mail/edielMailboxPoller.part-1.ts:21` and
`lib/ediel/productionReadiness.part-1.ts:227` declare it optional/nullable.
`20260903162000_ediel_tenant_readiness_revalidation.sql:96` includes it as snapshot
metadata; this is not proof that a null and shared snapshot are identical.

The latest convergence source explicitly says these classification fields are
retained for evidence-v3 without overwriting existing values
(`20260903160000_ediel_send_lock_state_convergence.sql:8-14`). The poller's actual
shared selector, `isPlatformSharedMailbox` at
`lib/inbound-mail/edielMailboxPoller.part-1.ts:199-206`, uses company_id,
environment and metadata.scope; it does not inspect mailbox_type.
`listConfiguredEdielMailboxes:847-881` filters activity/company/environment/ID and
that predicate. Manual-operations mailbox-type filters belong to the separate
manual_communication_mailboxes table and do not contradict this trace.

Decision: keep NULL to mean unclassified metadata and no synthetic shared default.
The current explicit platform_shared writer remains explicit. Null and shared
remain distinct in evidence-v3 snapshots; forcing shared would change attribution
and snapshot input without classifying the row. No missing transport-routing
requirement warrants NOT NULL/default shared. This is a concrete preservation
contract, not a claim that the two serialized snapshots are equal.

### 7. ediel_send_locks.lock_key

**SOURCE-QUALIFIED compatibility addition; restoring reference NOT NULL would
break the known canonical insert shape for a previously absent lock row.**
June1's original production lock table has no lock_key. F101
`20260602090000_ediel_operations_platform_core.sql:63-86` has a required key in its
CREATE branch, but the effective ALTER adds a nullable lock_key to the existing
production table. The active-key partial unique index is retained.
`scripts/canonical-residual-readiness-native.py:66-74` expressly checks nullable
lock_key and preserved production identity/state after the successor.

`20260802011000_canonical_ediel_production_state.sql:223-237` inserts/upserts a
company/environment production lock without lock_key. Its app callers include
`app/admin/companies/[id]/ediel-actions.ts:360` and
`app/admin/platform/actor-testing/actions.ts:108`. A new-row insert with no key and
no default cannot satisfy reference NOT NULL. This is source-level proof of the
need to qualify/reconcile the reference, not a newly executed SQL failure.
The outbox reader at `lib/ediel/outbox/sendOutboxItem.ts:14-51` uses canonical
locked/environment/expiry and only falls back to lock_key for error text.
Do not SET NOT NULL merely to reduce the diff or invent keys for production rows.

### 8. ediel_tgt_test_data.data_key

**SOURCE-QUALIFIED explicit compatibility repair; preserve the authored default.**
F65 `20260525_debug_step2_code_schema_alignment.sql:4-25` documents the migration
from key/value rows to parsed portal payload per suite/role/case, sets default
portal_payload, and explicitly drops NOT NULL. The final attribute writer F141
`20260528_debug_post_repair_schema_guardrails.sql:170-189` repeats those changes
and backfills missing keys on existing rows. Its exception block around DROP NOT
NULL does not prove success by itself; the artifact row hash confirms the resulting
nullable column.

`lib/ediel/testing/tgtTestDataStore.ts:1088-1105` upserts parsed_payload by
(test_suite,role_code,test_case_code), omitting data_key; reads at1052-1067 also use
that case identity. Removing the default while restoring NOT NULL would reject
the known new-row payload. Explicit-NULL acceptance is broader than that writer
requires, but is directly authored; no requirement to reverse it is established.

### 9. integration_api_requests.method and route

**SOURCE-QUALIFIED required request metadata; current logging supplies both.**
T8 `20260531111600_system_readiness_foundation.sql:164-180` creates both columns
NOT NULL. T33 `20260609113000_batch_2_3_4_6_period_onboarding_ediel_portal.sql:207-222`
has nullable declarations in CREATE TABLE IF NOT EXISTS only; no DROP NOT NULL
exists in the relevant source chain. `lib/integrations/apiAuth.ts:455-477` supplies
request.method and request.nextUrl.pathname on every persisted request payload.
`app/admin/platform/api-clients/page.tsx:224-232` reads those fields.
No nullable producer was established; do not weaken request metadata integrity
solely to match the reference. Error handling for request logging is separate from
whether this schema difference violates a current payload contract.

### 10. role_permissions.role_id and permission_id

**SOURCE-QUALIFIED deliberate identity correction; do not revert NOT NULL.**
F29 `20260909120200_canonical_role_permission_identity_reconstruction.sql:105-149`
rejects NULL/orphan/duplicate UUID identity and conflicting compatibility-key
resolution, then explicitly SETs NOT NULL on both columns. This is a new reviewed
identity repair, not an accidental ADD IF NOT EXISTS outcome. It preserves the
existing FK actions and has separate parent-lifecycle boundaries.

`app/admin/roles/page.tsx:57-82` reads/maps grants by both UUIDs. The current SQL
permission engine `20260902091000_company_scoped_permission_engine.sql:105-117`
joins both role and permission parents by ID. The older OR-key fallback remains
compatibility, not proof that NULL identity is a supported final grant model.
See the existing independent `ROLE_PERMISSION_IDENTITY_OWNERSHIP_EVIDENCE_2026-09-09.md`
for broader identity proof and unresolved deletion semantics. No grants, FK actions,
parent rows or permissions were altered in this review.

## Classification and narrow next actions

All 14 reviewed column attributes now have a concrete source disposition:
**preserve the observed replay shape; no attribute correction is justified by this
review.** The seven previously unresolved attributes were resolved through legacy
audit preservation, explicit upload/readiness semantics, final compact-status SQL,
nonclassifying mailbox convergence, and the actual billing-evidence contract above.
These decisions are narrower than claiming all original author intent is known:
some IF NOT EXISTS CREATE branches describe a different new-table shape. The
selected predecessor and documented/current compatibility behavior determine the
reviewed contract; the reference does not automatically override them.

This is not a difference allowlist and does not change accepted hashes. It makes
future reference reconciliation reviewable once final replay evidence is available.
No newly confirmed application regression or new forward migration arises from
these 14 fields. Native SQL/API execution, complete table/constraint/policy/grant
behavior, live schema comparison, actual generated types, and whole-PR acceptance
remain unverified by this report. No runtime/default normalization or gate bypass
is introduced. The original exact 28 hash matches below remain unchanged.

## Follow-up immutable source evidence

Additional complete source bytes read for the seven-column decision at fd4fb907;
these hashes identify evidence, not a new selection or execution receipt.

| Migration | SHA256 |
| --- | --- |
| `20260823185028_fix_customer_process_summary_intake_status.sql` | `f4ab87439782e875a86d207c5317ee16579603e58feb7e91bb6d05ec79e44d13` |
| `20260901152500_canonicalize_billing_underlay_stockholm_period_semantics.sql` | `1722e8bda642ca12c2ca2f337aaaf929bde83ecf82955979d4c671554c2abcbd` |
| `20260903160000_ediel_send_lock_state_convergence.sql` | `1f368f4a36e9ac93d09289c4538d142f7489746793aff110d9f593eaa0c7bafd` |

## Exact column-row hash evidence

| Column | Reference SHA256 | Replay SHA256 |
| --- | --- | --- |
| `auth_email_events.event_type` | `1ff6840820f0755b224a0b8adf7c882042f01d5f14b7ff760f33daf3a709f64f` | `73e5a25f16cc2222ee8ae7ef64a0a6b326aaf2ecf4e1854c86b72c697d526cc7` |
| `auth_email_events.source` | `5699aa29811b4081c3787e11cb901a86d9d3e1cffee8a403e450de3e7a12489a` | `9117c9ddf0287469239a93d3dbac51408df16806c68a6401240a7d6f6dc59d8a` |
| `auth_email_events.status` | `71dd22e997638b751f8b42fde6e294ac6477b78e0073c40f9aca517f9b48a228` | `0411fd450e703275499ce9189973aa506c1cf650ff98d37147fb5a217c1854be` |
| `billing_underlays.pricing_snapshot` | `828de06de9255f7afb5354561a46bb6172248d12fe21f3641cf100e0e3bb177f` | `8f5987375b4998db50483329436eee7dc58eb1bd3a9b50f2bd0a2a5eff2b812f` |
| `customer_documents.status` | `2848f9ecc6e44ea0ee1170a3c65bb843bad05424abfae68c86c27e3e68cbc127` | `34d78e3506d0ce4ed2acbbc1c6c6901f80d2a2c6f54d665ec7c8c3ab5b25fc84` |
| `customer_portal_identities.match_strength` | `5261630f8d4ce5b678fb91e442bf46089e38b6db9aa5abfb3f9a614ecddafe9c` | `6cc133483595897efed4ee03a1d0b63a7ac657c662f33712f468b7c29b4e7510` |
| `customers.intake_status` | `a95311166c98c2cd0cc0e3affe7e5881622aa07977f1b238fd272d71e73191de` | `4a44e95d2a1ec06f349667f6bb2d8b46649381eaf39420b80c4a8bc5583bd145` |
| `ediel_mailboxes.mailbox_type` | `249c18efde6a84c22e4a428d1ef6b910ed1ce14f8b662277612d6b1c187aefa1` | `a8c4f5f0e11a8c44202b3d4aa1da38b9e68a076fcbb2f75aca4f23ad7e319c79` |
| `ediel_send_locks.lock_key` | `6197e06ad9f2ae51a5b472739cf5da196a70b1d3ea08ddfdf884cef36521093e` | `964976609327bb0eab50016c68b82a52c5462364acc0dcf317fce0f2844a6de0` |
| `ediel_tgt_test_data.data_key` | `01e0cee85730e28ae7e09efc2f162483261e84632f8c4d603f1ab48ebcc82184` | `a2c4251a2fcdf4f0a0771417c69f0212c98c60c39243c6c3955aae90b701a7c3` |
| `integration_api_requests.method` | `3ba0668e4ba49ab63683bf0907cc2ade0e8891017041b098380bd01c2ce56abb` | `a3f2ee41d804dde5fd6fdbe3bab04d46bffed865f367b7a93652c3ef291d6e8c` |
| `integration_api_requests.route` | `1e343c38b01d85a0f91d02cb8d5b7bf7495069b64d206f487e1df0beab780e19` | `bcd87c947af6c37e44c30c25e4056d6a64dad2865db32570970317989ce01c66` |
| `role_permissions.permission_id` | `43066f21eebe12d16b401e7b15c56b73fb2ce3840416c0b4a5ae081b5fac4580` | `5e1e7029875a29959fdbb9757548c02599ab29a5e685c6a70eaad10d6d4ad2cf` |
| `role_permissions.role_id` | `63ee05c9fb42127f925643f1f7be9f38bc3c9cc6e485d0da78577409f27ab9da` | `e17802d324b7b5e92ed14ff67a7bb5822c2aceb73269df9078cb56077a2ae315` |

## Selected source bytes and positions

These hashes were checked by the existing selector/accounting implementation.
F/T ordinals are actual selector output, not chronological filename rank.
S means ordinary-selector SUBSTITUTED; June1's separately proved residual execution
must be cited independently. A selected source is not proof of successful execution
or final surviving semantics; the supplied catalog hashes provide the observed result.

| Migration file (under supabase/migrations) | Selection | SHA256 |
| --- | --- | --- |
| `20260519_auth_callback_email_reset_sync.sql` | F5 | `59efbf233d314558f8cc7ffbb2b15788cadaaf7ba476e0f80fa1e820299419a9` |
| `20260519_auth_email_templates_invite_reset_sync.sql` | F7 | `afd045b61276b1c40993bac59c7b94646a8c9e721d80c8f32dfdb3c471a0c137` |
| `20260521_batch3_pricing_billing_audit_roles_completion.sql` | F126 | `109ddeee3b532c70fc65ac5f920d4eae250a10037afd304ed5d14144cc30e27f` |
| `20260521_batch_customer_intake_debug_hardening.sql` | F77 | `562c2447554c43a3aef96bbbcd88a9f36ad1cc884ba97268ca96bc455ec54e80` |
| `20260525_debug_step2_code_schema_alignment.sql` | F65 | `e7be5cf935817846dcbe65e64c3b3d558d5e442c9bf7f7af5863f2180f108f04` |
| `20260526_batch_3a_3b_customer_intake_blockers_documents.sql` | F138 | `fad2a3336c1bab86cd67d05d5f965643589864c259b500eb67bbafbcaa78cba8` |
| `20260528_debug_post_repair_schema_guardrails.sql` | F141 | `41e63220e564c6efee26011e65055b95d5f5ca9e60a7c36811ec00e8f69579e6` |
| `20260531111600_system_readiness_foundation.sql` | T8 | `e6ef68b18ede5729da067ce59a86cfca0db083d9d54a35ae0ed3a6c0968b96f2` |
| `20260601070000_ediel_production_readiness_hardening.sql` | S | `7a73e59f559ebb5291d3e7df74545e6918011ec9764e5c512df19fbaa5bdbc12` |
| `20260602090000_ediel_operations_platform_core.sql` | F101 | `949bad4ed31e526954e59676c308b5953f128363b21d94821725c0dc3f4681b3` |
| `20260602101500_ediel_shared_mailbox_subaddress_security.sql` | T18 | `624ceaf487bf1f701acec62168b4ee90ad1c9b3251a5597ffd55a8f24739fad3` |
| `20260608120000_metering_billing_pricing_engine.sql` | T27 | `762c7612f75b0b9cba7dfdf3de6984ea03cc9e9da966586a081711ebd31dfa24` |
| `20260608152000_billing_source_normalized_fix.sql` | T29 | `58bdb510a7fc4f574dbf7f30a36b97c716ce6ced75d63b9c240d5416b88a93d8` |
| `20260609113000_batch_2_3_4_6_period_onboarding_ediel_portal.sql` | T33 | `822fa054543dc5d5b45188a060742ac50465177338fc4e262c60205c3177cc7b` |
| `20260609150000_batch_6_sync_status_origin_fix.sql` | T37 | `6e5bfb34d0d3676f10870a2dc2115104ddfb9945cf05bd67a2eb8d3c78eb88cd` |
| `20260610171000_customer_application_status_hardening.sql` | T44 | `92c3c134200a9efa9279cf93e76522f55109e7801a6da331c29c057492ddd69f` |
| `20260617183000_portal_documents_mail_onboarding_batch.sql` | T95 | `bafb2437bd50d1f38dd41a34511f10a9c87651004eedc7b3769ecd981b4dd9ee` |
| `20260617203000_simplified_customer_ops_events_and_mail_architecture.sql` | T97 | `6d1cc78eb22420adb539716562cf79f8789bff26c88756c6a0480044b92f22dd` |
| `20260823201716_canonical_customer_portal_match_strength_convergence.sql` | T424 | `525a8f3a2587cb4c0375c01caa5868cd84036b635618c5bd048d2dd8f98dd819` |
| `20260903160000_ediel_send_lock_state_convergence.sql` | T499 | `1f368f4a36e9ac93d09289c4538d142f7489746793aff110d9f593eaa0c7bafd` |
| `20260909120200_canonical_role_permission_identity_reconstruction.sql` | F29 | `03bec0a08fb0852bf7cdad8c96f01fe509bd6a7c970793a6db2fd4230c49dca1` |

## Verification record

- ZIP digest verification: PASS, exact supplied SHA256.
- Original diff selection: exactly 14 changed columns after excluding ordinal-only
  changes and the four previously reviewed type changes.
- Hash reconstruction: PASS, 28 of 28 exact unique reference/replay row matches.
- Pure existing selector/accounting call: PASS, 144 foundation / 514 timestamp;
  input-selection scope only, all source pins validated by the existing code.
- Source/app searches and targeted reads: completed for all ten groups above.
- PostgreSQL, PostgREST, native lifecycle, live data and end-to-end tests: NOT RUN.
- Production mutation, migration/source changes, baseline refresh, publication and
  shared-memory writes: NOT PERFORMED by this review.
