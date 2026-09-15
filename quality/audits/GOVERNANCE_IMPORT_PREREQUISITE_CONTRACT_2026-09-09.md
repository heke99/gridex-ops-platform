# Governance import prerequisite contract — 2026-09-09

Status: proposed design for independent review; no source selection or runtime closure.
Baseline: `aad37fc15e5db4e81113bf43d469c757011c5545` on
`codex/gridex-parity-remediation-20260905`.

## Scope, routing and authority

Task4's independently and integrally reviewed implementation passed hosted PG17
at this baseline: complete operations source after actual first31, 19 targets,
28 indexes, journal/preservation/repeat, late 42703, real 55P03 and five reduced
cases; all twelve runner commands passed. This is supplied prerequisite evidence,
not a test rerun or a systemwide claim.

Reuse [Task3's complete effects matrix](GOVERNANCE_SYNC_IMPORT_PREREQUISITE_EFFECTS_2026-09-09.md)
for all 1321 source lines and transaction units. I, F, D and O below are its exact
immutable source aliases. Its old O selection status is superseded by Task4.
This document resolves bounded Step B design, not the full customer lifecycle.
The [system integrity acceptance contract](SYSTEM_DATA_INTEGRITY_ACCEPTANCE_2026-09-09.md)
carries the masterplan sections 69/83/120, P0-C/P1-A structural requirements and
P1-C deletion correction. The older production-masterplan execution report is
historical evidence, not authority to override current unresolved parity.
The connected [catalog](GOVERNANCE_SYNC_IMPORT_CATALOG_2026-09-09.json) is metadata;
it proves neither intended policy nor actual production runtime binding.

Applied skills: Supabase and Postgres schema/FK/index guidance; bounded
source/spec comparison, direct false-positive refutation and
verification-before-completion. Read AGENTS, implementer template, task brief,
active memory and domain memory; searched decisions/known failures; inspected
status/diff and scoped consumers. using-superpowers explicitly exempts dispatched
subagents. No new implementation, bug reproduction, repository-wide audit,
performance measurement, UI change, dependency, hook or deployment is requested:
full baseline scanners/Council, TDD, browser, optimization and branch-finishing
workflows are outside this bounded design. Existing SDD plan supplies orchestration;
root owns separate review and memory/receipts. No subordinate agent was spawned.

## Decisions and exact boundaries

1. Proposed empty canonical reconstruction: keep the actual selected prefix through
   full6D and O, then reviewed prerequisite(s), complete I, complete F, complete D,
   complete `20260519_batch_6d2_runtime_governance_completion.sql`, then resume the
   unchanged current next membership role-key foundation and subsequent selected
   chain including 6E and later hardening. Retain all early bootstrap sources,
   especially versions, and all current identity/helper/index repairs. Never move
   late runtime reconstruction wholesale early or append F after final hardening.
2. I first is proposed because it gives mandatory batch/company/number fields and
   existing source nonnegative counters; D adds required consumer vocabulary.
   F-first nullable company and D-first nullable parent/number are not equivalent.
   This selects a reproducible **replay shape**, not physical-company CASCADE policy.
   Independent review must explicitly approve that limited interpretation before
   any selector changes. If review requires final retention before selecting,
   keep I/F/D/6D2 unselected while independent prerequisites proceed.
3. Existing-row compatibility is a distinct, fail-closed lane. Preserve stable IDs,
   legitimate keys, all row values, FK actions and object identities. No conversion
   of F company SET NULL into I CASCADE, no nullable-to-required conversion from
   guesses, no fabricated parent/number/token, no silent counter/JSON cleanup.
   An admitted variant is documented by its exact catalog, never called identical
   to the empty reconstruction. Final runtime acceptance requires convergence
   under a separately reviewed forward contract.
4. No selected prefix alone satisfies final runtime acceptance. Ownership,
   effective access, history/deletion, invitation delivery, error recovery and
   full replay/types/ledger/actual production parity remain gates.

## Proposed exact empty-replay table contract

`NN` means SQL NOT NULL; omitted default means no default. UUID IDs retain their
source primary keys and `gen_random_uuid()` defaults. All times are timestamptz.
JSON defaults below do not impose JSON structure checks. Tables are I-created,
then F CREATE-skipped, then D-aligned; version table remains early F-shaped.

| Table / columns | Type, nullability, default after I/F/D | Meaning / boundary |
| --- | --- | --- |
| batches.id | UUID PK | Stable batch identity; never replacement IDs |
| batches.company_id | UUID NN; companies(id), CASCADE | Tenant owner; action is I replay provenance only |
| batches.source_type; source_kind; file_name | TEXT NN default manual; TEXT nullable; TEXT nullable | Consumer writes both source names; no inferred alias rewrite |
| batches.status | TEXT NN default previewed | D check: previewed, imported, partially_imported, completed, failed |
| batches.rows_total, rows_created, rows_failed | INTEGER NN default 0; each >=0 | Retain I checks |
| batches.total_rows, created_rows, failed_rows | INTEGER NN default 0 | D additions; no source nonnegative/equality checks |
| batches.warnings, issues; metadata | JSONB NN default []; JSONB NN default {} for metadata | Consumer writes arrays/metadata; preserve existing JSON |
| batches.created_by | UUID nullable; auth.users(id), SET NULL | Actor existence does not establish tenant authority |
| batches.created_at, updated_at; imported_at | NN default now(), NN default now(); nullable | No automatic updated_at trigger supplied by these sources |
| rows.id | UUID PK | Stable import event identity |
| rows.import_batch_id | UUID NN; batches(id), CASCADE | Required known parent; do not synthesize batches |
| rows.company_id | UUID NN; companies(id), CASCADE | Must agree with batch owner at final gate |
| rows.row_number | INTEGER NN | No positivity or UNIQUE(batch,number) invented |
| rows.status | TEXT NN default pending | D check: pending, ready_to_create, requires_review, duplicate_warning, missing_fields, created, rejected, failed, skipped, linked_existing_customer |
| rows.normalized_payload, raw_payload | JSONB NN default {} | raw added by D |
| rows.issues; warnings, duplicate_match_payload | JSONB NN default []; JSONB NN default [] | I issues array default survives D object ADD; current writer explicitly writes object issues. This is compatibility, not JSON convergence |
| rows.customer_id | UUID nullable; customers(id), SET NULL, D adds NOT VALID | Validate existing references in acceptance; no orphan admission |
| rows.possible_existing_customer_id | UUID nullable, no FK on I-first path | D ADD lacks fresh-CREATE FK; existence/owner preflight required; final relation correction remains open |
| rows.error_message, resolution | TEXT nullable | Preserve recorded history |
| rows.parser_confidence | INTEGER nullable; NULL or 0–100 check | No rounding/clamping dirty values |
| rows.reviewed_by; reviewed_at | UUID nullable, auth.users(id) SET NULL; time nullable | D adds reviewer FK NOT VALID; validate before acceptance |
| rows.created_at, updated_at | NN default now() | Source defaults only, no update trigger |
| versions.id | UUID PK default random | Retain early identity and OID |
| versions.company_id | UUID nullable; companies(id) SET NULL | Retain early action; missing owner is not final acceptance |
| versions.contract_offer_id | UUID NN, no offer FK | Preserve early shape; explicit offer/owner preflight |
| versions.version_number | INTEGER NN default 1 | No positive check or unique offer/version pair from skipped I CREATE |
| versions.snapshot | JSONB NN default {} | Historical pricing snapshot preserved |
| versions.created_by; created_at | UUID nullable auth.users SET NULL; time NN default now() | Existing history/actor actions preserved |

Batches have 19 columns; rows have 19 columns; versions have seven. Existing
additional columns are retained and inventoried. Existing legitimate composite
keys must not be replaced with generic UUIDs simply to resemble this matrix.
A non-UUID or non-single-ID legacy shape incompatible with these consumers is a
reported prerequisite failure requiring its own mapping contract, not an automatic
key migration.

## Immediate ownership, retention and index matrix

| Edge / query | Proposed prerequisite and final obligation | Retention / index |
| --- | --- | --- |
| batch → company | Compatible stable companies UUID PK; owner nonnull for final consumer; company must exist | Preserve existing action; empty I CASCADE is provisional replay semantics. customer_import_batches_company_created_idx(company_id,created_at DESC), customer_import_batches_company_status_created_idx(company_id,status,created_at DESC) |
| row → batch → company | Known mandatory batch/number; row owner equals batch owner; no unrelated tenant linkage | Preserve parent CASCADE; customer_import_rows_batch_idx(import_batch_id,row_number), customer_import_rows_company_batch_idx(company_id,import_batch_id,row_number) |
| row → company | Compatible UUID identity and same-owner proof independent of parent FK | Empty I CASCADE; existing actions preserved. customer_import_rows_company_status_idx(company_id,status), customer_import_rows_company_idx(company_id), customer_import_rows_company_status_created_idx(company_id,status,created_at DESC) |
| row → customer / possible match | Each nonnull ID exists and belongs to row company; candidate is not guessed from payload | customer SET NULL from D; possible-match FK missing on this replay path. customer_import_rows_customer_idx(company_id,customer_id); no inferred possible-match index |
| batch creator / row reviewer → auth.users | Nonnull actors exist; authority at action time established by caller and audit context, not inferred from present membership | SET NULL preserves row; no new actor index mandated without workload evidence |
| version → offer → company | Offer ID exists; known version owner agrees with offer; retain snapshot/actor/IDs | Early no offer FK, nullable company SET NULL. contract_offer_versions_company_offer_idx(company_id,contract_offer_id,created_at DESC), not I version_number DESC |

All listed index names are literal source names; all are nonunique B-tree
without predicates. Assert exact keys/order/direction, not name
presence; retain PK backing indexes. D adds no unique row-number contract. The
row batch-only F index is skipped because I's two-key index already exists.
Do not add redundant indexes from a blanket FK rule. Final workload tests include
queue company/created order, batch row retrieval and lifecycle reference joins;
actor, possible-match and version-offer coverage require measured assessment.

Current company action is terminal tombstone (`actions.ts:407–545`,
`lib/tenant/lifecycle.ts`): company row remains and hardDeletePerformed is false.
Thus this flow supports retained attribution but cannot choose physical company
CASCADE versus SET NULL. Customer hard deletion is a different contract in
SYSTEM_DATA_INTEGRITY_ACCEPTANCE. Connected row.customer single SET NULL plus
composite CASCADE cannot decide intended row retention. Do not infer that one wins
or remove composite tenant integrity to permit deletion.

Unresolved decisions, with exact impact:

- Physical company purge: remove import history, detach it with durable retained
  attribution, or disallow purge? Requirements do not select one. Blocks final
  action reconciliation and physical-delete acceptance, not token preparation.
- Customer/possible-match history: retain and detach only customer identity,
  anonymize selected content, or delete import rows? Requires policy covering
  payload/review/audit data and shared/other-tenant preservation. Blocks final FK
  correction (including missing possible FK) and customer lifecycle closure.
- Version history: known offer ownership is required, but duplicate version numbers,
  historical snapshots and offer deletion have no approved stronger key/action
  here. Selected `20260726140000` deletes by company and offer (385–388); this
  requires owner completeness, not automatic CASCADE or invented uniqueness.
- JSON/counter alias consistency and historical invitation credentials need explicit
  lineage/reconciliation if dirty. No mutation to make old values look current.

## Invitation token prerequisite before F

F65 creates `company_invitations_token_key(token)`; actual early core invitations
has invitation_token TEXT, not token. Late
`20260906081839_canonical_company_invitation_runtime_reconstruction.sql:18,45–48`
is too late to satisfy F. Propose a narrow new forward prerequisite, independently
reviewed and transactional, for this column/index admission only:

| Input | Admission/action | Acceptance boundary |
| --- | --- | --- |
| token absent, invitations empty | Add UUID NN default gen_random_uuid(); F creates exact unique index | Empty source-required token shape; no historical credentials created |
| token absent, invitations nonempty | Add UUID nullable with no default and no backfill, only in explicitly named compatibility lane | Existing rows remain NULL. F later sets future-insert default. Cannot satisfy mandatory delivery-token contract |
| token exists | Require exact UUID type; retain every value/nullability; no casts or cross-column copies | Nullable/all-nonnull still not catalog NOT NULL convergence |
| existing default absent | Admit absent default; F explicitly sets gen_random_uuid for future inserts | Assert source-defined default effect separately from row preservation |
| existing default present | Admit only semantically verified source gen_random_uuid(); reject other expressions/defaults pending review | No silent replacement of custom credential-generation policy |
| existing values | Reject duplicate nonnull UUID tokens; preserve NULLs only in compatibility lane | No generation, replacement, hash inversion or credential repair |
| index name absent | Check collisions and admit F creation of unique B-tree token index, unpredicated, token only | Ordinary NULL-distinct source semantics; no invented NULLS NOT DISTINCT |
| index name present | Require correct owning relation, unique, valid/ready/live, exact token key, no expression/predicate/extra keys | Same name is not proof; reject incompatible objects without dropping them |

Do not derive token from invitation_token or accept_token_hash. Do not emit token
values in diagnostics; report counts and synthetic case names. Preflight under
appropriate bounded locks in the same transaction as any prerequisite DDL so
concurrent writes cannot invalidate emptiness/duplicate checks. Repeat must be
value/OID preserving; lock timeout must roll back this prerequisite as a whole.

The later runtime source's ADD IF NOT EXISTS skips an existing nullable token:
it will NOT set NOT NULL or fill existing NULLs. Its unique index likewise skips
an existing exact index. Therefore nullable compatibility persists through that
source, even after F sets the default. Worker
`lib/tenant/provisioningWorker.ts:101,132–148` fails delivery without token;
`lib/auth/companyInvitationFlow.ts:287–292` accepts by independent SHA256 hash.
Non-null delivery token alone proves neither valid acceptance hash nor pending
intent. Final invitation gate requires mandatory shape and provenance-backed
active delivery/acceptance/revocation tests; historical missing credentials remain
an explicit internal reconciliation decision. No random historical minting.

## Admission before whole I/F/D execution

Admission checks run before any whole-source invocation, fail with named safe
categories and no sensitive values, and cover both tenants. They are not hidden
cleanup. Until reviewed, the following are a specification, not executed tests.

| Gate | Reject or characterize precisely |
| --- | --- |
| Shape/identity | Wrong relation kind/schema, missing/ambiguous PK, wrong ID/reference types, incompatible defaults, invalid/unready indexes, same-name wrong constraint, foreign relation conname collision suppressing D, incompatible checks. Inventory all extra constraints/policies/triggers |
| Competing import shapes | Absent both is empty reconstruction. Existing I/F/D/union variants receive exact per-column/default/check/FK/index receipts. Missing parent/number stays blocked for mandatory acceptance. If only batch_id exists, prove UUID/FK/value identity before F rename; both names or incompatible legacy type fail instead of merging |
| Parent/row data | NULL mandatory owner/parent/number; orphan batch/company/customer/candidate/actor IDs; cross-company row/batch/customer/candidate; missing numbering cannot be inferred. Duplicate row numbers alone are not failure under this proposed source contract |
| Versions | Missing offer parent, NULL required offer/version/snapshot, incompatible IDs or known-owner mismatch; missing owner blocks final ownership gate. Existing duplicate/nonpositive versions are preserved and reported for stronger-contract review, not silently deduplicated |
| I/F ownership DML | Enumerate every would-change child company NULL with nonnull parent owner, any nonnull mismatch, or orphan parent for I54–136/F121–203. Preserve-values lane requires zero changes; reduced characterization alone may exercise historical attribution using known synthetic IDs. Include I-only powers_of_attorney and F-only billing_underlays |
| I/F join/DDL branches | Existing guarded tables must have all referenced join/index columns; company PK and FK targets compatible. Inspect 6D operational update triggers and final lock ordering, not only table existence |
| D status/check additions | Reject unsupported batch/row statuses, invalid parser confidence and incompatible existing named/differently named checks before DROP. Preserve old values and checks on preflight failure; do not silently widen unrelated constraints |
| F role/permission seed | Require actual roles/permissions/role_permissions, stable UUID PKs/defaults, unique key arbiters and mandatory unique role/permission pair. No duplicate keys/null/orphan pair or guessed UUIDs. Existing company_admin and super_admin resolve unambiguously; missing super_admin is an explicit reduced branch, not complete seed coverage |

F299–377 is an intentional one-DO seed mutation: existing company_admin ID remains;
name/description become source literals and is_system becomes true where present;
three tenants.read/write/invite IDs survive existing-key upsert, their metadata
becomes source literals; missing source-defined entities may be inserted with their
normal ID defaults. Preserve super_admin and unrelated roles/grants. Assert the
six resolved role/permission pairs exist, adding only missing pairs, and no
user assignment or scope change. Source metadata/grant effects require explicit
approval in the selection review; they are not a read-only no-op claim.

## Transaction, rollback and required evidence

The actual runner invokes psql ON_ERROR_STOP per source without a surrounding
transaction. I's FK DO7–51 is committed before ownership DO54–136; failure in the
latter rolls back that DO only. F token-index65 failure leaves preceding CREATEs
committed; F ownership121–203 and seed299–377 each roll back their own unit only.
F generic policy DO470–524 is atomic; six later policy DROP/CREATE pairs527–568
are individual statements and can leave a named policy absent. D18+18 alignment
ALTERs51–87 commit individually; named check DROP90/95/111 commits before
ADD91–93/96–109/112–114. D FK117–154 and policy175–236 are separate atomic DOs;
view239–275 is its own statement. A new atomic prerequisite does not make these
historical files atomic. Preserve Task3's remaining complete effect matrix,
including F functions/customer filter, grants and overwritten helpers.

Required implementation verification must include:

- Complete actual selected prefix with all retained bootstraps and O, then proposed
  prerequisites and whole I/F/D/6D2 in reviewed order; assert every Task3 effect,
  intentional skips, seed metadata/grants and exact index/check/FK definitions.
  Reapply whole sources and compare stable IDs, values, OIDs, constraints/actions,
  ownership and audit/history counts. NOT VALID FKs require a separate explicit
  validation/postflight contract; merely installing them does not pass acceptance.
- Two synthetic tenants with known batch/row/customer/offer/auth identities;
  preserve existing actions including SET NULL/NO ACTION variants without action
  conversion. Test no-op ownership backfills, cross-owner/null/orphan failures,
  retained snapshots and differing valid row numbers. Verify expected policy/ACL,
  service bypass and later helper composition separately from table shape.
- Each dirty admission category above: fail before whole-source effects, compare
  unchanged rows/catalog. For source failure characterizations, inject a late
  missing-column 42703, duplicate-key 23505, FK 23503, check 23514 or mandatory
  23502 at the actual unit that imposes it; assert earlier committed effects remain
  and failing-unit effects roll back. Do not claim all those codes occur from the
  design's own fail-closed diagnostic, whose implementation must define its code.
- Real concurrent lock contention/55P03 on new prerequisite; concurrent inserts
  around token emptiness and duplicate admission; repeat no new credentials.
  Empty, absent-with-existing-rows, nullable preexisting, duplicate nonnull,
  wrong-type/default/index, exact existing index and later runtime-source cases.
  Token compatibility cases must assert NULL remains and mandatory gate remains
  false; never present reduced fixtures as the complete selected-prefix lane.
- Preserve later 6E, launch linter, lifecycle, composite tenant constraints,
  invitation runtime and final role-helper behavior. Final table grants, RLS
  enabled/forced state, all policies including unmatched names, helper bodies/
  security/search_path/ACL and caller roles must be recorded. Historical F/D/6D2
  policy existence is not final access acceptance.

Final import consumer acceptance also covers error-aware journaling and retry:
`actions.part-3.ts:280–315` ignores returned row insert error; part-4 tolerates a
missing batch relation and later ignores final update error; recalculation561–615
updates aliases separately from customer work. These are static recovery concerns,
not production incident claims. No widening to the full lifecycle implementation
is authorized here. Alias agreement, required journals, actor audit and failure
recovery require a later focused implementation before runtime readiness.

## Bounded next implementation brief

After independent review of this audit, implement only a new narrow invitation
prerequisite and explicit admission/test harness contract. Assign new files and
source registration separately; preserve every historical byte, checksum and
existing artifact. Use atomic bounded-lock DDL and the two empty/existing-row
lanes above. First prove token prerequisite and import/ownership/seed admission
against actual prefix plus reduced dirty cases. Do not select I/F/D/6D2 in that
independent token batch. It must report nullable compatibility as partial.

A subsequent independently reviewed selection batch may apply the exact proposed
I/F/D/6D2 order only with explicit approval of empty-replay retention semantics,
seed effects, existing-shape admission and complete-source tests. Resolve missing
possible-customer FK validation, final owner constraints and stronger version
requirements in separately scoped forward contracts that preserve existing
history/actions until policy is approved. Do not broaden the token prerequisite
into a table convergence migration or guess a timestamp/file registration here.

No phase/parity/access/deletion closes until full replay, generated schema/types,
bidirectional migration ledger and proven actual production binding/parity pass.
Current failures in those gates remain internal work; no new external blocker is
asserted by this design.

## Bounded source verification receipt

Read-only inspection at baseline confirmed immediate writers/readers in
`app/admin/customers/actions.part-3.ts:280–315,561–644`,
`actions.part-4.ts:29–92,283–305`, `imports/page.tsx:134–174`, invitation worker/
flow and late runtime source named above; scoped original I139–189, D6–48 and
F299–377 corroborate the proposed shapes/seeds. Reused Task3 for other complete
source effects and Task4 hosted verification; did not rerun either audit or SQL.
An initial path lookup for lib/tenant/companyInvitationFlow.ts was corrected to
lib/auth/companyInvitationFlow.ts before drawing conclusions.

Verification executed for this documentation change: `git diff --check` and
scoped file/status review. No SQL, tests, selectors, historical migrations,
checksums, manifest, generated artifact or production mutation was performed.
Root's pre-existing dirty memory/receipt files and scratch cache were preserved.
