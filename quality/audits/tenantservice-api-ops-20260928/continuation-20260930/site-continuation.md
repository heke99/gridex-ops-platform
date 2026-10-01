# Site customer-data and readiness continuation — 2026-09-30

Status: **LOCAL_TARGETED_VERIFIED; NATIVE_NOT_EXECUTED**. Parent integrator owns
publication, workflows, generated artifacts and
global checkpoint. This package does not accept a whole T/U requirement or
activate supplier switching or market delivery.

## Routing and ownership

Read AGENTS, current active memory, API domain memory, decisions, failures and
the original masteruppdrag. Applied systematic-debugging, TDD (including
writing-good-tests), verification-before-completion, Supabase and the relevant
fp-check evidence principles. Current Supabase/API conventions come from the
installed implementations and types. No schema or platform API changes.
Independent worker boundaries and the existing isolated checkout are managed
by root. UI, security-tool orchestration, publishing and broader migrations
remain root/other-worker tasks; performance optimization and skill editing have
no trigger in these bounded correctness changes.

Owned source: `lib/customer-operations/automation.part-2.ts` (one line).
Owned proof: `__tests__/customer-site-continuation-20260930.test.ts` and
`scripts/customer-site-continuation-20260930.native.{config,test}.ts`.
After the authentic clean replay failure below, root separately assigned the
two-line grammar repair in the never-successfully-applied candidate
`supabase/migrations/20260930192831_customer_site_registry_atomic_command.sql`.
No shared contract/workflow, checksum, baseline migration, index, reference or
publication state was edited by this worker.

## Actual execution path

1. OPS site action authenticates the current actor/session and calls
   `saveCustomerSiteCommand`.
2. `gridex_save_customer_site_v1` locks exact tenant/customer/site, rechecks
   current permission/session, validates/revises site/address evidence, and
   commits command/result/audit/event/outbox and customer-data job/snapshot
   atomically.
3. `gridex_claim_customer_operation_jobs` claims existing durable intent.
4. `processJob` checks the exact site/address snapshot before selecting
   `processCustomerDataRequest`.
5. Missing facility identity routes to `resumeCustomerIntake`; missing
   canonical contract/POA returns a persisted, explicit review blocker.
   A facility-ready request must pass grid-owner verification and the existing
   Z01 authorization/route/send guards. Prepared Z01 is not sent.
6. The existing atomic Z02 consumer verifies persisted core/message/metering
   evidence before enqueueing the separately guarded supplier-switch worker.
   Unified supplier readiness checks exact contract/POA/metering/route/legal,
   lifecycle and scheduling gates. This package adds no automatic switch entry.

## Confirmed finding and minimal repair

**SITE-CONT-01 — Moderate: a prepared Z01 was presented as waiting for a reply.**
`processCustomerDataRequest` returned `needs_review` with
`z01_prepared_pending_send_guard`, but emitted `customer_data.z01_prepared`
without explicit status. The real operational event emitter derives
`waiting_response` from `prepared`, with info severity and no required action.
Operators therefore saw an incorrect waiting state before dispatch approval.

The executable RED reproduced the persisted event row: expected
`needs_review`/warning/action-required, observed
`waiting_response`/info/no-action. The repair supplies the same explicit status
as the worker outcome. Dispatch-approved waiting states remain waiting; blocked
states remain review. The change does not affect routing, RLS, authority,
send guards, idempotency or external delivery.

**SITE-CONT-02 — Blocking: the candidate site function failed PL/pgSQL compilation.**
Authentic OPS run `36780003023`, clean job `110107571193`, failed at
`2026-09-30T21:34:24.2140944Z` on this migration, file line 285 / function
line 109, with `syntax error at end of input`, immediately
after the postal-code regular-expression condition. Requested head was
`0d81465617d11f099502832385d976fdedf3cc6d`; actual checkout was
`45a09811bbbba42f287c6778de76f27dbe13b9ec`, tree
`e86c110e64e7fa494a68a7dc6010aea39c2c7394`. Clean evidence artifact
`11127404106` contains only `rem002-clean-replay.log` (ZIP SHA256
`185297d24d5f7058ee5e0b95ceee9c037edf571587c4c9e43b6fe1f344e18d0d`).
The earlier profile grammar repair passed; schema/types capture and subsequent
native proofs were not reached in that run.

The validation IF compared postal code with an unparenthesized `CASE … END`.
The PL/pgSQL expression reader terminated at that CASE's `THEN`, leaving an
incomplete SQL expression. A real PostgreSQL parser (cached PGlite, with no
repository dependency added) reproduced SQLSTATE 42601 from the literal
production guard before repair. Parenthesizing only that CASE expression fixes
compilation and preserves normalization and validation semantics. The repaired
literal guard compiled and passed five executed cases: valid normalized postal
code, invalid/incomplete postal code, null postal code, forged postal code
rejection, and inconsistent completeness rejection. The entire actual function
body also compiled with schema rowtype stubs; this is grammar evidence only,
not qualification of its database statements or a Supabase replay.

A native regression now extracts and compiles the literal production IF block
via disposable PostgreSQL `psql`, and executes those same five outcomes before
the existing real RPC/worker cases. It would fail compilation on the observed
unparenthesized original; it does not merely match source text or duplicate the
expression. Full replay and native acceptance remain **NOT_EXECUTED** locally.

## Suspected terminal unique-key suppression

Schema review refutes the proposed all-status unique-key suppression. The
customer-data key is covered by
`customer_operation_jobs_active_idempotency_uidx` only while queued, running or
waiting_response (`20260618110000`, recreated unchanged in `20260618213000`).
Other unique job indexes cover application continuation, lifecycle notification
or `contract-signed:` supplier jobs, not terminal customer-data jobs. No index
was changed. The prepared native test checks completed, needs_review, failed,
skipped and cancelled history against the real final schema before this result
is promoted to a native acceptance claim.

Active intent reuse is intentionally different: the save command can reuse one
active job whose older address snapshot then fails the worker freshness gate.
The honest outcome is `needs_review` plus
`refresh_site_address_and_restart_operation`, without external effects. A new
authorized save after terminalizing that stale intent can create a fresh one.
Native assertions cover this exact sequence; it is not reported as successful
downstream dispatch or as an automatically recovered switch.

## Executed verification

All commands used Node22.23.3 except initial RED (default Node24.19.0).

| Command | Actual result |
|---|---|
| `node node_modules/vitest/vitest.mjs run __tests__/customer-site-continuation-20260930.test.ts` before repair | RED: 1 failed, 5 passed; actual event status/severity/action mismatch |
| Same targeted suite after repair under Node22 | GREEN: 6/6 |
| Same new suite plus customer-site-command, ops-customer-site-action, customer-site-form, z02-atomic-worker-convergence and automation-config | 55/55 in 6 files |
| `node node_modules/typescript/bin/tsc --noEmit -p tsconfig.tests.json --incremental false` after concurrent UI test correction | PASS |
| Scoped ESLint on source/new test/new native config/new native test | PASS, 0 errors; existing unused `priceArea` import warning in automation.part-2 |
| Literal site candidate guard, real PostgreSQL PL/pgSQL parser, before grammar repair | RED: SQLSTATE 42601, syntax error at end of input |
| Same literal guard after grammar repair, including five semantic cases | GREEN: compilation and 5/5 outcomes |
| Entire actual site function body, real PL/pgSQL parser with schema rowtype stubs | PASS for grammar; SQL runtime/schema qualification not claimed |
| Node22 test TypeScript and scoped native-test ESLint after parser regression | PASS |
| `git diff --check` | PASS |
| `node node_modules/vitest/vitest.mjs run --config scripts/customer-site-continuation-20260930.native.config.ts` | NOT_EXECUTED: local Docker/psql absent; root must use disposable CI |

The unit proof runs the actual consumer and operational event emitter with
controlled database/dispatch boundaries. It is complementary to real database
and HTTP/browser verification, never a substitute.

## Prepared native evidence and exact remaining boundary

Nine real-server/database cases cover literal production guard compilation and
five postal validation outcomes; five terminal statuses; real site
producer/claim/worker/persisted missing-contract outcome; one active intent,
stale blocking and explicit restart; wrong-resource and expired-session replay;
and actual supplier-readiness contract/POA/metering blockers. Runtime fetches
are limited to the disposable local Supabase endpoint; every case checks zero
customer-info/grid-owner/outbound/switch/Ediel delivery resources. No dispatch
provider is replaced with a success stub. Only the Next.js server-only import
marker is replaced for Node test execution. Root wires the suite before other
due-job fixture consumers so the synthetic priority claim is deterministic.

Relevant original requirement slices: T01/T09/T20/T21/T22/T23/T25/T38/T39/T50,
U04/U06/U18. Their full original meanings remain open to the shared acceptance
matrix; browser, whole-system tenant and migration/restore evidence belong to
the integrated candidate. Full positive post-Z02 supplier readiness still
requires the exact canonical signed agreement/PDF/legal accepts, a site-bound
POA and scope, verified market object/grid-owner and an isolated approved route
fixture on the final replay. No missing real/provider/pilot evidence is claimed
verified or replaced with weaker requirements.

Next: publish the root-frozen candidate, execute this native suite on its
disposable replay, inspect its explicit markers and final rows, then reconcile
the exact-head requirement matrix. This local package is frozen for independent
review; no commit, push, hosted write, merge or market activation was performed
by this worker.
