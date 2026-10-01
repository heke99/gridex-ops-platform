# P8/T55 local aggregate alarm and incident recovery packet — 2026-10-01

Status: bounded source implemented and locally verified; real Supabase/PostgREST/GoTrue/Next HTTP/browser incident proof **NOT_EXECUTED**. This is not full P8 or T55 acceptance. Root alone owns publication, existing isolated OPS pipeline wiring, generated contracts, migration manifests and canonical memory. No commit, push, hosted probe, external communication, provider verdict or Ediel activation occurred in this packet.

## Skill routing and source truth

The ongoing masterplan's baseline audit routing remains inherited. This bounded continuation applies systematic-debugging, fp-check, test-driven-development, spec-to-code-compliance, code-review, requesting/receiving-code-review, verification-before-completion and observability-and-instrumentation. The new operational question is whether repeated company aggregate observations produce one open alarm, and whether an interrupted tenant email remains held until a current operator authorizes recovery. No measured performance change is asserted; no new UI design, public API contract, trust root, role/grant or migration is introduced. Full shared security/static-analysis/publication gates remain root-owned. External monitor/provider/pilot enrollment is distinguished from implementable local proof.

Reviewed actual paths: `lib/analytics/alerts.ts` → `lib/analytics/dataQuality.ts` and `app/api/cron/analytics/daily/route.ts`; original analytics DDL `20260531160000_analytics_forecasting_module.sql` and current generated schema; `app/api/internal/system/health/route.ts` → `getOpsHealth()` → actual health RPC v5/v4/v3; `app/admin/system-health/actions.ts` → actual current platform guard/Auth user → tenant/manual recovery helpers → audit logger; tenant email enqueue, stale fair claim, uncertain-send denial and exact provider-key behavior; actual platform API-client status forms/action and authentication RPC readiness policy.

The daily global cron would refresh other tenants. The native alarm proof deliberately invokes the same actual scoped refresh function on its new tenant A, while comparing an independently seeded quiet tenant B. This does not certify the cron scheduler or delivery of an alert to an external monitor.

## Confirmed findings and bounded fixes

| Finding | Severity and reproduced evidence | Fix and limits |
| --- | --- | --- |
| P8-ALARM-1 | Medium: actual exported adapter writes NULL entity type/id for all seven refresh aggregates and the direct data-quality summary. Original exact UNIQUE(company, alert type, entity type, entity id, status) permits distinct NULL keys. Actual adapter against the original table DDL produced two open aggregate rows on rerun. | Only both absent entity fields default to `company_aggregate` plus the current company UUID. Complete conflict identity makes rerun update one open row. Explicit and partial caller identities remain unchanged. Historical NULL rows are neither deleted nor reclassified. |
| P8-AUDIT-1 | Medium: actual exported tenant and manual recovery action omitted companyId from audit input after a successful scoped recovery; legal audit ownership became NULL. Exact action RED received the correct actor/entity/action but no company. No recovery cross-tenant bypass was established: existing helpers already condition their update on company, id and uncertain status. | Before recovery, a fixed allowed outbox table is read with both target id and selected company. Current returned id/company/status are checked. The same independently scoped conditional recovery writer is preserved, and audit receives this actual current row company. No fabricated actor, current session, verified flag or transport mandate is accepted. |
| P8-OUTCOME-1 | Medium: actual exported action after a successful writer receipt rejected when revalidatePath threw. Unit RED explicitly injected a cache exception after the saved receipt. | Cache refresh is isolated after save/audit. Installed Next `unstable_rethrow` preserves framework control-flow exceptions; an ordinary refresh failure logs a constant safe warning and preserves the saved recovery outcome. This does not prove an actual production cache outage or make the separate recovery/audit calls atomic. |
| P8-ACTOR-1 | Medium: independent review identified that the platform guard result was discarded and the second actual Auth read ignored both error and identity equality. Two actual exported Action RED cases accepted a different Auth user or a populated user together with an Auth error before the target read. This bounded regression establishes a missing consistency check; it does not claim a demonstrated production Auth race or cross-tenant mutation. | Actual guard.userId is passed to the actual Auth helper. Any Auth error, missing user or different user.id is denied before the service target read/writer. No cached authority or caller-supplied actor is introduced. |
| P8-CONTROL-1 | Medium: the initial cache catch swallowed the real installed Next redirect and notFound exceptions after the saved receipt. Both actual public Next functions produced genuine RED in the exported Action test. | Installed Next `unstable_rethrow(error)` runs before the ordinary safe warning. The exact framework exception propagates; the existing ordinary cache-error saved outcome remains tested. |

The existing recovery and audit are separate transactions; existing best-effort audit catch remains. Native positive audit attribution is prepared, but atomic rollback of recovery on audit failure is **not** claimed. The existing provider idempotency key is retained; external provider acceptance/deduplication duration is **not** proved by local key equality.

## Actual local verification

| Command / scope | Outcome |
| --- | --- |
| Node22 Vitest `__tests__/analytics-aggregate-incident-20261001.test.ts` before source fix | genuine RED: 2 failed / 2 passed, expected stable aggregate identity but received NULL pair |
| `NODE_PATH=/tmp/ediel-service-check/node_modules node --test scripts/analytics-aggregate-incident-20261001.postgres.test.cjs` before source fix | genuine actual exported adapter + original DDL PostgreSQL-core RED: 2 failed / 1 passed; aggregate rerun count2, explicit+aggregate count3 instead of2 |
| Actual exported recovery action before source fix, focused company/cache tests | genuine RED: both tenant/manual company audit missing and saved recovery rejected by private cache exception (3 focused failures); no native DB claim |
| Initial recovery follow-up before actor/control fix | genuine RED: 4 failed / 8 passed; Auth mismatch, populated-user Auth error, installed Next redirect and notFound exceptions |
| Node22 Vitest both new unit files after all fixes | 16/16 PASS; original12 retained plus4 regression cases |
| Same PostgreSQL-core command after aggregate fix | 3/3 PASS, PGlite0.3.14/PostgreSQL17.5; actual adapter, actual original DDL, SQL uniqueness/upsert; PostgREST transport adapted solely to the in-memory engine |
| Node22 ESLint exact two source, two unit and two native TypeScript files | PASS, no warnings/errors |
| Node22 `tsc --project /tmp/gridex-analytics-incident-tsconfig.json --noEmit` | PASS; exact six-file import closure, no broad concurrent app check |
| Node syntax checks new core CJS and browser MJS | PASS |
| Actual `node scripts/check-large-source-file-budget.cjs` | PASS; existing 1800-line gate unchanged |
| Exact-path `git diff --check` | PASS |
| Six literal native INSERT column lists compared with current generated canonical schema | all match; static qualification only, no SQL/native execution |

The original NULL-key witness remains a passing diagnostic test that explicitly observes two historical NULL rows. GREEN does not imply a historical backfill. The earlier mistyped source-budget command found no file; the actual existing budget command above subsequently ran and passed.

## Prepared actual isolated native / HTTP journey

Existing OPS isolated pipeline only; no new proof workflow/ref. Exact CI=true, literal localhost Supabase API/status keys, private fixture under RUNNER_TEMP mode0600, separate new tenant UUIDs, real GoTrue operator, current production guard/Next action, no DB/Auth/module mocks in native. Node native fetch is restricted to the literal local Supabase API; browser resources outside loopback are blocked; provider credentials forbidden. Service/Auth/password/client token/health secret are not printed or committed.

1. `seed`: actual enqueue creates provider idempotency keys; two actual tenant-A refresh calls create exactly one aggregate; an explicit entity alert is unchanged; quiet B's twelve-table graph is identical. A synthetic interrupted processing row becomes delivery_uncertain through the real service-role fair-claim RPC. Actual health uncertainty count increases by1; actual sendTenantEmailNow denies without changing the row or calling a provider.
2. Real Next server must receive the fixture's private `secret` as OPS_HEALTH_CRON_SECRET before start, without printing it. Browser/HTTP calls no-secret/wrong-secret health and expects401; current secret executes the actual health route/RPC. Status200 or503 is derived from actual blocking checks, not hardcoded healthy against unrelated fixtures.
3. Browser logs in the actual GoTrue operator and submits the actual platform client pause form. Exact current authentication reports api_client_inactive. On System Health, an anonymous action request and an authenticated foreign-company target are denied with no row effects; actual current operator reviews/requeues its own uncertain row through the actual form/action. Its audit records the real company/actor/target; provider key/attempts remain stable; actual health uncertainty count decreases by1.
4. Existing generic status resume form returns client status active while launch_ready remains false. Current contracts HTTP still returns403 api_client_not_launch_ready. This proves safe incomplete resume, **not** a successful traffic resume. No launch approval, installation receipt, verified sender, tenant website readiness or Ediel live flag is fabricated.
5. `verify_after_http`: real native postcheck verifies the operator audit and the two current client status audit events. One tenant-A fair claim takes the reviewed intent; a second claim returns zero. No provider sender is invoked. Wrong-company alarm resolution has no effect; actual correct-company resolution changes only the aggregate. Explicit entity alert and quiet B remain unchanged.
6. `cleanup`: cancels only these fixture tenants' remaining queued/processing/uncertain emails before later workers. It neither deletes customer history nor sends messages.

Example root wiring (on the existing isolated runner after migration replay, with private fixture/status env already set):

```sh
GRIDEX_ANALYTICS_INCIDENT_PHASE=seed node node_modules/vitest/vitest.mjs run --config scripts/analytics-incident-20261001.native.config.ts
# Privately load fixture.secret into the Next server's OPS_HEALTH_CRON_SECRET.
# Start the existing localhost Next server using the existing pipeline.
GRIDEX_ANALYTICS_INCIDENT_LOCAL_E2E=1 node node_modules/@playwright/test/cli.js test e2e/browser/analytics-incident-20261001.spec.mjs
GRIDEX_ANALYTICS_INCIDENT_PHASE=verify_after_http node node_modules/vitest/vitest.mjs run --config scripts/analytics-incident-20261001.native.config.ts
GRIDEX_ANALYTICS_INCIDENT_PHASE=cleanup node node_modules/vitest/vitest.mjs run --config scripts/analytics-incident-20261001.native.config.ts
```

Mandatory successful-path markers: `ANALYTICS_AGGREGATE_INCIDENT_NATIVE_PASS`, `ANALYTICS_INCIDENT_HTTP_PASS`, `ANALYTICS_INCIDENT_RECOVERY_NATIVE_PASS`. Cleanup is also mandatory even on a failed proof. Skipped or absent markers are not accepted as a runtime pass. Local native/HTTP/browser executed count is0.

## Original P8/T55 outcomes still required

| Requirement boundary | Current outcome / next concrete action |
| --- | --- |
| Future absent-pair aggregate idempotency | locally VERIFIED bounded adapter+SQL; actual Supabase/PostgREST rerun prepared NOT_EXECUTED |
| Current secret health, operator pause/reconcile/recovery, no blind resend, scoped alarm resolution | actual production paths preserved; real native/HTTP/browser prepared NOT_EXECUTED |
| Historical NULL aggregate duplicates / conflict list | not changed. Use a read-only grouped current open-NULL identity count; separately decide audited resolution/backfill. Partial explicit identity duplicates remain outside this verified absent-pair repair. |
| Upgraded logical backup/restore ownership, ACL/Auth/issued bytes | separate root-owned existing wrapper/actual CI gates, no acceptance from this packet |
| Rollback to pinned seeded old state | concrete local implementation gap: current wrapper dumps after forwards. Prepare private pre-forward archive/fingerprints immediately after old fixture seed; restore into a second random empty template0 DB with the same strict owner/ACL administrator, compare old data/Auth/catalog/issued hashes and pinned-old native commands/RLS. Current candidate command proof must not be run as if old functions existed. No destructive downgrade or new hosted probe needed. |
| Full tenant API resume | explicitly BLOCKED until actual canonical go-live/readiness prerequisites qualify. Generic active status is deliberately insufficient; this packet exercises the denied outcome. |
| External monitor registration/alarm delivery and operational tenant pilot | real deployment/operator/configuration evidence absent. Local health and saved alarms do not certify external monitor enrollment, alert delivery, real pilot, provider transport or operational response timing. |
| Whole P8 and whole T55 | PARTIAL, not accepted by unit/core counts or authored runbook. Original master P8 backfill/conflict/replay/upgrade/rollback/pilot meanings retained. |

## Independent bounded review and current freeze

`ci_evidence` independently reviewed the exact current production paths and reran both unit files **12/12 PASS** plus actual exported adapter/original-DDL SQL core **3/3 PASS**. It confirmed guard before Auth/service read, fixed allowed table and exact current id/company/status, independently scoped conditional writer, actual target company audit, constant safe cache warning, no sender/activation change, and that real fair claim preserves attempts1. Native/browser executed count remains0. Historical/partial NULL duplicates, best-effort non-atomic audit and denied incomplete API resume remain explicit limits.

The earlier review of12 tests is superseded for the reopened Action/unit/report by the four new RED→GREEN regressions. Current16-test source awaits independent follow-up review before publication registration. The other six source/proof files remain byte-identical.

Publication integration requires root to register the newly explicit `supabaseService` import in `app/admin/system-health/actions.ts` with the reviewed current platform guard, exact actual Auth error/guard.userId equality and exact target qualifications. Registration must preserve the real Next `unstable_rethrow` before the constant cache warning. This shared registry is root-owned; no hidden service use or grant broadening is accepted.

## Frozen source manifest

| Path | Git blob | SHA256 |
| --- | --- | --- |
| lib/analytics/alerts.ts | 2681cf0ceb126ab22fe92a79731a6bc08d2d49ed | 026a18fed8915ec2d697642849a683760291f91d6b054d9ce078278e3aa3c6ea |
| app/admin/system-health/actions.ts | 67f08c90dbf88d920b862eb54982839b7eb1ed8f | 2beffffb8ae1e30b21348ca83908829a3ff5008510cf8865e73bea2346fe9b31 |
| __tests__/analytics-aggregate-incident-20261001.test.ts | e5c307fde81a309fe880423306e28264bf731b17 | 45163e7b7aa7103d6cc6c853789a4e0e5e1ff421fde2fad97c041ce0d1bf4250 |
| __tests__/analytics-incident-recovery-caller-20261001.test.ts | 014baa50826148dfd8fe77a2e400e905a409bdec | 709c0186e39d4952b24b07da116487e23f63860f353a5e69a36ef1f0f0241ea5 |
| scripts/analytics-aggregate-incident-20261001.postgres.test.cjs | 512380376b0336c35e3eb46f29507f3ac7414cd3 | b8df7b684fc7f0b1fa6b6ad824dab2a85666a4deb2eb5f03c1452e5889fe324a |
| scripts/analytics-incident-20261001.native.config.ts | 8702abbca14ca73a9ea945c8087cd398177d7ec6 | 34d2d97cd4acc00306fb5704226ce6d76f25e113e2a4af4c178be3661661d75a |
| scripts/analytics-incident-20261001.native.test.ts | c200db941d88f256c368720a2c99776963ac7cf2 | edfbb0a665804fa07df98132fda7c6d302e89ae42c20e1e3e081f98edb9577fa |
| e2e/browser/analytics-incident-20261001.spec.mjs | b5218b606c9c52bd28a317c8f2a2d021650f6fc7 | 8a32a6ee509ffedb0e9c4f88f62c1fa037baec453eda6d91e2e41c9b619a7186 |
