# Metering, readiness and outbound source characterization

Status: standalone native source proof PASS ondb517370.
OPS34656370070/job103449573876 SUCCESS23:02:43Z.
Complete M/E/Z inputs are registered atfoundation72–74 as INPUT_SELECTION_ONLY.
Actual74 native acceptance and production readiness remain unproved.
Predecessor actual71 passed its original-child native gate on335c950f:
OPS34655243791/job103446101233 SUCCESS22:58:08Z. Source analysis does not establish native acceptance.

The existing P0-C skill routing continues: executing-plans, systematic-debugging,
TDD, Supabase/PostgreSQL, requesting-code-review and verification-before-completion.
No application UI, new product design or skill implementation is involved.

## Exact complete source inputs

| Key | Source | Lines | SHA256 |
|---|---|---:|---|
| M | 20260519_batch_6c_metering_billing_readiness.sql | 154 | c44153ba502ab32f543f649d9001bfcc9685d90be054747520c2b11d67bfcb24 |
| E | 20260520_batch_1_2_saas_ediel_control_center.sql | 123 | 7a198e941bbd735c0f56191d5ecf41cc85de03bbd89cea4f0b3369981127cdc8 |
| Z | 20260520_final_z01_outbound_and_platform_guard.sql | 54 | 987fd23b93dac930007da4c47cbd20d11120ab2bd9afa10b9865d545938b71b6 |

All331lines and relevant first71 predecessors independently reviewed. Original
bytes and manifest pins are unchanged. First1/2 supply operational tables,
first15/39/40 company metadata and first37 operational write guards.

M backfills only NULL company ownership on five tables using customers. It does
not derive ownership from site or meter relations and preserves preexisting
nonnull owners even when they differ from the customer's tenant. Those writes
fire the operational guard; paused/blocked owners rejectP0001. A subsequent
key-only metering UPDATE does not fire UPDATE OF company_id.

Canonical metering keys fill only when currently NULL and company/meter/read_at
are present, including historical rows. concat_ws skips null reading_type.
Timestamp text is independently modeled under explicit UTC and ISO,MDY settings.
Existing keys, timestamps and every other field remain unchanged. Duplicate
current keys reject23505; historical false rows do not participate in uniqueness.

E normalizes branding/billing JSON and operating environment before replacing
the validated CHECK. Its oracle applies literal values from the independent row
model before constraint DDL, so dirty environment success is not compared to a
DDL oracle that would reject the unnormalized input. No source UPDATE body is
used as the expected transformation.

Z replaces only table-local CHECKs matched by the source ILIKE patterns. The
underscore in route_scope/request_type is a SQL wildcard; the independent
matcher includes this behavior. A routeXscope literal CHECK regression was
observed RED then GREEN. Both final partial indexes are unconditional, so the
preceding optional-table guards do not make missing route/outbound tables safe.

IF NOT EXISTS preserves baseline nullable value_status/readiness_status, actor
company FK delete behavior, and the existing four-column
partner_exports_company_batch_idx from first18; the new two-column declaration
must be skipped. Static expected normal delta:14indexes/2views/2Zchecks, replaced
company environment CHECK, no new columns. Native catalog equality must verify
these effects. Neither view is a tenant authorization guarantee; actual ACLs and
historical branch behavior are characterized, with later canonical hardening
still required for production convergence.

## Owned characterization boundary

The new standalone proof admits only an owned SUCCEEDED operations71 handle.
It mirrors frozen operations/alignment run-release consistency and fixed
reservation/reference links before its first snapshot and every query. Shared
closed AcceptedInputs and closed_staging retain identity after successful original
child release; no live-input rearm is allowed. The complete operations catalog
and row multiset must equal the exact accepted release before fresh private
native/oracle clones. Failed clone admission disposes only the created clone.

The source-only DDL path resolves presence and CHECK matches separately from
whole DO bodies. An independent complete-row model supplies backfills, timestamp
key strings and company normalization. Full immutable source bytes run in one
private PIPE transaction. Catalog/comments/global names/full rows are checked
before COMMIT and again after, with exact rollback for expected failures.
Original database, unrelated canary, original files/HOLD and private collectors
are preserved or cleaned through the existing owned boundary.

Candidate native cases: baseline+repeat and view ACL/branch probes; populated
two-tenant backfills, unmatched customer and mismatched existing owner; duplicate
current key; blocked backfill versus allowed key-only change; dirty/null/production
environment; invalid route and request separately; multiple/wildcard/unrelated
CHECKs; same-name nonmatching constraint rejection; optional relation absence;
required-column and route/outbound absence; fault after each complete source.

Ten local constructors PASS. Missing predecessor/corrupt reservation tests were
observed RED then GREEN. Independent final code/model/native-matrix review APPROVED publication after
actual71 acceptance. Added active actor and enabled/disabled route-profile view
branches as requested by review. Hosted native results remain required before
selection or actual74 integration.


## Native result and actual74 integration candidate

All19prepared source cases and the view ACL/branch probes passed, including
actor/profile alternatives, dirty environment normalization, ILIKE wildcard,
current-key uniqueness and exact rollback. Original/canary/files/privacy/cleanup
passed. This closes the standalone source gate.

A separate actual74 runtime now consumes the exact linked actual71 snapshot,
held full M/E/Z inputs and independent source-only oracle, under one private
transaction with UTC/ISOcontext and fullpre/postcommit comparison. Foundation
72–74 selection is INPUT_SELECTION_ONLY; actual74 native acceptance is pending.
The complete first71 and old41tail order and all source pins remain unchanged.

Independent actual74 runtime/native-matrix/scope-order review APPROVED publication.
Seven constructors and exact first71+inserted3+old41tail/foundationhash verified.
Hosted actual74 gate remains pending; no production action is authorized by
these local checks alone. Existing user delivery authorization applies after gates.
