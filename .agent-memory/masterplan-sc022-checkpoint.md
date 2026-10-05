# SC-022 overdue task and tracking checkpoint

State: whole SC-022 code-contract APPROVE after parent complete-literal review
and independent exact-source execution. Only this scenario is promoted; related
rule/AT rows remain unchanged. Root owns publication, final-head CI and merge.

Reservation #530 comment5985947570; sole SC-022 lane alongside peer SC-021.
Source-owner reconciliation request #491 comment5985994137; no existing-file
edit was needed or made. Worktree `/workspace/gridex-masterplan-sc022`, branch
`codex/ediel-sc022-overdue-contact-effects-20261005`, immutable tested base
`56192d16d1eac7fb0e716a3e2770bac8e58be115`. Fresh later main
`9dc4a783a0c5e926596e3054a958c64e43efd490` has byte-identical relevant consumers,
migrations and fixtures (bounded `git diff --exit-code` returned 0). No rebase.
Current #491 head at comparison was `3a22fbf6d74fa4d9974b9b60ef1a3671d3d20713`;
its overdue monitor is byte-identical to main. No pending source repair or
ownership transfer was inferred. Old IMP05/OPS03/SC058/SC069 packets stay frozen.

Owned files:

- `__tests__/ediel-sc-022-overdue-contact-effects.test.ts`
- `.agent-memory/masterplan-sc022-checkpoint.md`

## Complete literal and applicable source

Read complete frozen SC-022, ESCO-06 and OPS-02 in
`quality/audits/ediel-masterplan-v2/masterplan-v2-reconciliation-20260930.json`.
SC-022 is “21dagar utan svar”: given outgoing Z13 has no Z14/N after the watch
deadline; when its timer expires; expected “Overdue-uppgift och kontakt/spårning”;
prohibited “Inget lokalt fabricerat Z14N eller auto-godkännande”; Integration/E2E.
CALL-15 forbids generic timeout→resend→active behavior. Linked rule cards are
context, not promoted or fully approved by this scenario packet.

Actual canonical TM-ESCO21 in `lib/ediel/rulebook/deadlinePolicy.ts` uses 21 calendar
days, HB26A section 11.3/p207, effective 2026-04-01. The test reads actual policy
with explicit 2026-09-30 reference date and asserts source/version, offset,
unit, rule and remoteReceiptKnown:false. SQL due time is independently asserted
as 21 Stockholm local calendar dates with the same local wall-clock time. The
original HB PDF was not newly authenticated or executed by this packet.

Prepare/register deliberately anchor an uncertain internal sender watch to
accepted SMTP observedAt, not a fabricated remote-receipt timestamp. Independent
24h acknowledged-request monitoring is proactive operator follow-up, not assumed
to be a 21-day deadline defect. ESCO-06 concerns contextual new requests and
additional objects and forbids a blanket ban on all repeat Z13 before 21 days.

## Entire expected/prohibited effect matrix

| Literal effect/control | Actual executed consumer and assertions | Qualification |
| --- | --- | --- |
| Outgoing Z13, no Z14/N, deadline reached | Existing physical fixture/parser; canonical policy/plan; current installed SQL register/read/expire; sealed hash/attempt/plan binding; empty received-source ledger; exact21-local-day deadline | Physical LI CASE:A+B?C read from bytes rather than unrelated cached transaction_reference; finite journal/auth ports |
| Timer expires | Real sweep and next-action reader: manual_review 1, fulfilled/rejected 0, exact source-bound overdue cause, tenant_operator, waitingFor Z14, read_source only | Sweep is display-only and creates no task |
| Overdue task | Real monitor persists one open/high ediel_z14_overdue task and waiting_attention request; replay creates none | Same actual message.outbound_request_id/company/customer/site/point tuple; accepted/positive-ACK request projection is finite |
| Contact/tracking | Real listAllOperationTasks returns request/sourceId, customer/site/point, time/reason/title/description; foreign company yields none; real task-resolution consumer does not auto-resolve | Production UI task/customer/status links traced below; no direct external contact or renderer execution |
| No fabricated Z14N/approval/resend | Complete source, requested-permission, received ledger, private binding, journal and outbox before/after snapshots equal; no fulfilled_by_message_id; no provider/resend allowed actions | Backend port allows only actual monitor task insert/request update; no native market grant or sender |
| Recent nonexpired | Actual chain leaves pending watch, source/request snapshots and empty task list unchanged | 0-day accepted/ACK projection |
| Earlier proactive follow-up |2-day monitor creates task while 21-day watch stays exactly pending; sweep neither fulfills/rejects/expires nor changes source/domain/outbox | Refutes blanket24h-vs21day defect; no invented early-warning prohibition |
| Missing acceptance/foreign scope | Register refuses unknown SMTP acceptance; owner read rejects foreign company; no expectation/protected effect | Real owner guard against finite active profile/membership/exact permission facts |

## Production provenance: two writers and two schedulers

Actual Z13 service command `lib/ediel/flows/prodatServicePermission.ts` creates
an outbound request and passes outboundRequestId to rendering. Real relation:
`ediel_messages.outbound_request_id`, equal company/customer/site/metering point.
Final fixture uses this exact tuple. Earlier unused synthetic reverse
`outbound_requests.ediel_message_id` column/assertion was removed before freeze.

SMTP producer: `lib/ediel/outbox/sendOutboxItem.ts` calls actual
`projectSentEdielSourceState` after accepted dispatch/repair. Real SQL
`ediel_project_accepted_source_state_v1` reads sealed payload hash, actual journal
receipt, frozen observedAt and plan, registers Z13 through the same watch owner,
checks full message→request tuple and sets sent_at. It preserves progressed
ACK/final statuses; it does not supply positive ACK status or acknowledged_at.

ACK producer: `lib/inbound-mail/edielInboundProcessor.ts` reaches actual
`applyCanonicalInboundAckStatusUpdate` after transport correlation. Actual
canonical ACK writer updates safely matched same-company outbound_request to
syntax_accepted/application_accepted and acknowledged_at for a positive ACK,
then updates outbound messages through outbound_request_id. This technical or
application acknowledgment does not count as a Z14/N business answer.

`runInboundEdielMailEngine` in `edielMailboxPoller.part-3.ts` processes queued
inbound jobs before calling actual overdue monitoring, so ACK projection can
precede task evaluation. It does not call the business expectation sweep.
Customer-operations cron independently calls that actual sweep. Test couples
both actual consumers over the same consistent declared state; no sweep→task
production call is invented.

Accepted journal receipt and positive-ACK request projection are separate finite
inputs. Their fixture timestamps equal by choice; no identity between real
events is inferred. Accepted projector definition is loaded installed but not
invoked. ACK writer, renderer, outbox sender and mailbox orchestration are
statically traced, not executed by this suite. No alternative producer written.

Actual `listAllOperationTasks` is used by `app/admin/operations/tasks/page.tsx`.
Page shows title/description/customer, customer link and explicit
Open/InProgress/Blocked/Done actions. `app/admin/work-queue/page.tsx` reads open
rows and links the same customer. Real `isTaskLikelyResolved` returns false for
this task, so unrelated data cannot silently resolve it. These production
consumers support operator tracking, the literal contact/tracking alternative;
direct external contact is neither required by this literal nor claimed.

## Actual code versus declared finite ports

Actual policy/plan/parser, register/read caller, sweep, next-action/tenant reader,
monitor/task insert/request update, task-list and task-resolution consumers run
normally. Only external `@/lib/supabase/service` transport is replaced.
PGlite executes whole installed definitions: original watch/public API,
applied-scope guard, current accepted-source mutate, complete national Z08 watch
amendment/reconcile wrapper and final sealed Z08 amendment; existing wire decoder
is unchanged. Definition extraction copies no matching/clock/owner logic.
RPCs SET ROLE service_role; per-call savepoints model independent backend error
transactions inside rolled-back fixture transactions.

Finite ports: minimal schema, active profile/membership/exact actor/company
permission facts, sealed source/journal/frozen plan, accepted/positive-ACK tuple,
requested native-permission row and empty outbox/received ledgers. Separate Z09
owner returns [] because no Z09 watches exist. Shared Z08 signature is fail-closed
and throws if executed; it grants nothing. Closed parameterized table transport
preserves actual predicates/counts/reads and writes only tasks/request projection;
no message/native permission/received ledger/outbox write is allowed. Complete
row snapshots include immutable private source evidence.

Bounded local behavior/persistence proof only: no full native schema/RLS/grant
model, concurrency, staging, real tenant, market mandate, SMTP, automatic route
or materializer, direct external contact or UI renderer claim.

## Verification and failure qualification

Initial setup failures were not product RED. Outer fixture transaction cleanup
masked SQL error; per-RPC savepoint/rollback exposed missing unrelated Z08
signature, solved by a fail-closed declared signature. Four unchanged-source
cases then passed. Parent corrected fixture to real linkage; first correction
run found only a UUID/text SQL parameter reused inconsistently, corrected with
separate bind parameters. No product implementation changed or RED fabricated.

Final test SHA256:
`f23bb66d61dfb3684df5f154951c21552b22cb69dc0d87ea77a16678b18b506a`.
Final focused execution 2026-10-05 00:39:44 UTC, exit 0, 4/4 PASS, 2.34s:

```sh
env PATH=/tmp/masterplan-tr06-node-cache/_npx/d18f28baf1132559/node_modules/node/bin:$PATH NODE_OPTIONS='--max-old-space-size=6144 --require=./scripts/lib/unit-loopback-network-boundary.cjs' node node_modules/vitest/vitest.mjs run __tests__/ediel-sc-022-overdue-contact-effects.test.ts --maxWorkers=1 --reporter=verbose > /tmp/masterplan-sc022-frozen-four.log 2>&1
```

Log SHA256 `6e9a155d7e19f7e4ed2283496ef5ee0e9d213b4349ec33039b15449cb7dc673d`.
Permitted local network execution context resolves worker wrapper boundary;
existing CI preload blocks nonloopback network. No traffic issued.

```sh
env PATH=/tmp/masterplan-tr06-node-cache/_npx/d18f28baf1132559/node_modules/node/bin:$PATH node node_modules/typescript/bin/tsc --project tsconfig.tests.json --noEmit --incremental false > /tmp/masterplan-sc022-frozen-test-types.log 2>&1
env PATH=/tmp/masterplan-tr06-node-cache/_npx/d18f28baf1132559/node_modules/node/bin:$PATH node node_modules/eslint/bin/eslint.js __tests__/ediel-sc-022-overdue-contact-effects.test.ts > /tmp/masterplan-sc022-frozen-eslint.log 2>&1
```

Tests types exit 0; scoped lint exit 0, no errors/warnings. Both logs empty, SHA256
`e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855`.
Only four new cases executed; no broad/native/staging/full run.

## Immutable dependency byte receipts

| Path | SHA256 |
| --- | --- |
| quality/audits/ediel-masterplan-v2/masterplan-v2-reconciliation-20260930.json |43a298b56f33bc192bd9c539175e025c6899cd4506dcd8fd00cc1f724e025afa |
| lib/ediel/rulebook/deadlinePolicy.ts |5fe8333f61a4460a979fc62f15f9b15ffafb2faa3702b09392a5042eb08b2f34 |
| lib/ediel/businessExpectations.ts |22e6c99c085507ebb78db13c06d161f970a96d97d7518dc92e11e6808ccaa945 |
| lib/ediel/operations/businessExpectationSweep.ts |bb8b005ec18a37140d69ba9e5840f96ff611c5a2155a6adbece63d9998c4f08e |
| lib/ediel/operations/processNextAction.ts |b486a4edaf34fd8906a94c9d62f28b4980a23069b847bc1f0d4582ee82aafbfc |
| lib/inbound-mail/inboundOverdueMonitor.ts |094629eea908951716cd73c3a32451ea6b4078e4fc3668e2c85993a4adabf33b |
| lib/operations/db.part-1.ts |831d39cc446d6c113b0b5b5263194236f57ea5ee33943573ac8177fe6004c4ff |
| lib/operations/taskResolution.ts |dc1ce364cd424b30246cffa637f42dbb38a9562e31ef5e27f418d8455d110224 |
| lib/ediel/outbox/projectSentSources.ts |74e8572cafba80fad39bb5d4341305d40b8bc3f89805b339674ca90b8309227d |
| lib/inbound-mail/canonicalInboundAckStatusUpdater.ts |9f9c432b72080ae0c235d4e4c08c827b491b3a8b891d633f057fe92fc4c12aeb |
| lib/inbound-mail/edielMailboxPoller.part-3.ts |a74090c31e69ed0e1fbeac3d4b8ec4011f1e7e8fc3f123af8438a9209c4cc07e |
| app/admin/operations/tasks/page.tsx |756cf6b24927e0eebd91f04b19478cfaa0aa754f1371b5c8fe37c7d633e5a89d |
| app/admin/work-queue/page.tsx |e554e09140e44e915db0d8c2100722e2c00e11ff68d8de43f753aafed929be17 |
| __tests__/fixtures/prodat-permission-ack.ts |7fba884dbaeceefb2cf56f3fc0475c14bae7afed0d1fe1b075ccf72ea6dc9ce7 |
| supabase/migrations/20260930144205_ediel_permission_source_atomic_transitions.sql |99b0d6fda03afe1ecb9a8b3814a18d3127e657f1aaa3fbfd76543da7473124fa |
| supabase/migrations/20260930154712_ediel_source_bound_business_expectations_v1.sql |1ccf24aa7120990dcf45639f8b525977d9c14ba8f3c9032008e4dd100df040e1 |
| supabase/migrations/20260930170258_ediel_business_expectation_applied_scope_v2.sql |c1846d047b83e34b46c7f556cdecf2a9ae7cedbb3fb8f44216d3962a443ca8b0 |
| supabase/migrations/20260930223407_ediel_atomic_accepted_source_projection.sql |008772e5270b73edd157ec4b139ebc37fbf06b19960c11b82250dff3a18a0720 |
| supabase/migrations/20261001115200_ediel_national_supply_rescission_business_watch.sql |aa0e3eac87ad19c49ceaaf4461ce780680cb7ec03ab13a74ea34f79b7aa7022b |
| supabase/migrations/20261002234300_ediel_expectation_sealed_z08_acceptance.sql |bafc28f8db3f585520e0b7e7a9476bdfc134557268a8236190035edeb144365f |

Skill routing retained: using-superpowers/worktree/acquire-codebase-knowledge,
code-review, test-driven-development/writing-good-tests, verification, Supabase
finite SQL/RPC boundary. Parent explicitly permits correct unchanged behavior
without fabricated RED. Broad spec fan-out/native/bootstrap/SMTP/renderer,
performance/scanner/shared memory/publication are outside the two-file scope.
No new delegation.

Next: parent independently executes exact frozen two-file commit in detached
checkout, reviews full SC-022 and latest main 9dc byte qualification, then decides
approval/tag/coverage/publication. Until then leave all packet bytes unchanged.


## Root independent approval — 2026-10-05

Frozen two-file `ac23157f6a95f3c533052302a92d94e43d0859c1`, tree `4508759f369162a192c92c1e5a1a45372423dc97`, was inspected against the complete given/when/expected/prohibited and the actual separate SMTP/ACK writers, two scheduler entrypoints and task/customer/status reader. Detached exact-commit reviewer ran only the four focused cases once: **4/4 PASS**, no skips. Original test/checkpoint SHA256 values remained unchanged before/after; review checkout clean. Independent log `/tmp/masterplan-sc022-independent-four.log`, SHA256 `9e34b831468831a9ec218bb75df45a539d38dd9292593f661abd137deca7ead3`.

Whole SC022 code APPROVE: actual source watch expires at its qualified calendar deadline; real task writer/reader persists and exposes exact source/request/customer/site/point tracing, distinct from the display-only sweep. No fabrication/approval/resend or permission/source/outbox rewrite. A recent request has no task; earlier permitted proactive tracking retains the pending business watch; missing actual acceptance and foreign reader scope refuse. Explicit contact/tracking is satisfied by the asserted persisted operator tracking; no external contact/send or UI renderer is asserted. Accepted SMTP and positive-ACK source projections/auth/schema remain declared finite inputs, not claimed native authority.

Promotion adds only the first-line SC-022 tag, this scenario's PASSED evidence row and this owned checkpoint receipt; all assertions and every other row byte stay unchanged. No whole ESCO06/OPS02/AT promotion, monthly variant, foreign coverage, new source/helper or alternate workflow. Next: supported tag/spec checks, isolate publication on actual current main with byte-identical relevant source, then all nine actual-head gates and retained common merge window.


## Actual merged-main composition — 2026-10-05

Adopted actual merged main `507e8bfa20606be31933eea1582066267ff2577a`, tree `20b492198c7b4bdbb5bec1634a42ee5cec978d47`, after GitHub confirms primary#491 merge `b83b19753af6d4722adeb11e3d1fdca65a60b534` and#500 merge507e. Local no-ff composition has no conflicts. All main changes, current calendar consumer/grammar, original capture provenance and every other approval row are retained. The complete branch diff against507e is exactly the owned test, owned checkpoint and only SC-022's PASSED evidence row. Production/helper/SQL bytes are exactly merged main; no unmerged#556 or peer patch is imported.

A necessary focused composition execution on these actual merged bytes passes **4/4 coupled cases**, zero skips. Log `/tmp/masterplan-sc022-merged-main-four.log` SHA256 `35ac0b076fea763610cdc0ef3caf5519e2706e5940f76037278372dbef496d1e`. Removing only the first-line tag still reproduces original independently reviewed test SHA256 `f23bb66d61dfb3684df5f154951c21552b22cb69dc0d87ea77a16678b18b506a`; every assertion is retained. Earlier immutable owner/reviewer logs remain historical and are not relabeled as this composition.

Finite external ports and original custody/native/RLS/SMTP/market/AT limitations above remain unchanged. This dependency adoption does not requalify old native captures or authorize any other card. Required supported tag/spec/type/lint composition checks follow; actual final-head CI and integrator's shared merge window still control main merge.

Actual507e composition gates PASS: supported tag check352IDs/184branch-approved/194tagged-green/0failing, SHA256 `91aa8c47a513075a13146fe8238072659c221637cdf5272693dbf18815f57c68`; specification integrity33/121/231, SHA256 `50d989fcc0602b49768d22523164a361c42975fe7b8545af249c9445cb9f2157`; tests-config TypeScript retry and scoped ESLint exit0 with empty logs; diff whitespace check exit0. First composition type invocation exited137 under overlapping heavy compilations/tag jobs; cgroup recorded one OOM kill. That resource failure is retained, not a code RED. The same unchanged types command was rerun after resource coordination and passed; no source or assertion was changed to repair it. No later source changes occurred. Final composition head/tree belongs to root publication receipt and actual GitHub; merge remains integrator-owned.
