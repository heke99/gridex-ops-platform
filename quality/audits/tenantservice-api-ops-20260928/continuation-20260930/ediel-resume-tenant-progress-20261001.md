# Reachable Ediel resume tenant progress — 2026-10-01

Status: **bounded scheduler repair implemented; actual runtime9/9 and SQL
core9/9 PASS; genuine native7 prepared /0 executed**. Original T40 remains open.
The separately frozen scanner25 and original75 reconciliation are unchanged.
Root alone owns publication/workflow/registry/generated capture.

## Reachable path and actual predicates

The actual exported GET/POST in
`app/api/internal/customer-operations/cron/route.ts` authenticates its dedicated
cron credential then calls `resumeStuckEdielIntents({limit: min(requested,25)})`
without companyId. This is an active global caller, not a dormant helper.

The pre-repair resume engine read global updated_at ascending then limit for:

- validated phase: validation_status=validated,
  render_status IN(not_rendered,failed), outbox_status=not_queued;
- draft phase: validation_status=draft, direction=outbound,
  ediel_message_id IS NULL, outbox_status=not_queued.

Explicit companyId added an exact company filter. The validated loop had an
updated_at optimistic CAS and retains canonical missing-facility/request and
process-specific preparation gates. The draft loop calls the actual intent
mapper/validator/lifecycle writer and never renders/sends. There is no durable
per-tenant turn in these selections. The unrelated generic invoice retry helper
was found without a current app/lib caller and is **not** classified reachable.

## Meaningful RED and controls

Unique `scripts/ediel-resume-tenant-progress-20261001.test.ts` executes the actual
Next exported GET, actual resume module and actual intentEngine mapper,
validator and lifecycle writer. Its PostgREST adapter executes parameterized
PostgreSQL17.5/PGlite queries against the complete actual foundational intent
DDL, constraints and indexes. Only parent FK tables are minimal typed fixtures;
full Supabase history/Auth/RLS/triggers are not claimed. Other cron workers and
all render/transport/activation calls are isolated and asserted zero.

Both companies have 250 older noisy A and one later B row, synthetically test
only. Missing facility/required metadata deliberately reaches the unchanged
canonical blocked decision without a provider call. The assertion is that the
quiet tenant gets a bounded opportunity; it is not a fabricated dispatch-success
claim or invented provider state.

| Actual case | Observed current code | Result |
|---|---|---|
| Actual authenticated cron, validated limit25 | 25 A attempted/blocked,0 B | RED expected B1/actual0 |
| Actual authenticated cron, draft limit25 | 25 A validated/blocked,0 B | RED expected B1/actual0 |
| Actual exported resume, two global limit1 calls | 2 A blocked,248 A still pending,1 B still pending | RED expected B1/actual0 |
| Explicit B validated | One B blocked; all A rows byte-equal | PASS control |
| Explicit B draft | One B blocked; all A rows byte-equal | PASS control |
| Unauthorized actual cron |401; zero SQL reads/writes and zero external calls | PASS control |

Final meaningful baseline command exited1 with **3 assertion RED /3 controls
PASS**. Earlier seed/adapter harness exceptions were corrected and are not
counted as implementation RED. Finite A backlog eventually drains: these cases
prove backlog-dependent quiet wait with no fixed per-tenant opportunity bound,
not infinite starvation from a finite set or native production latency.

```sh
NODE_PATH=/tmp/ediel-service-check/node_modules /tmp/ediel-toolchain/node_modules/node/bin/node node_modules/vitest/vitest.mjs run --config scripts/ediel-resume-tenant-progress-20261001.config.ts --reporter=verbose
```

The three original assertion REDs are now GREEN in the same exported-boundary
test. With 250 older A rows and one later B, both phases attempt5 A plus1 B in
the first limit25 batch. Two limit1 validated calls attempt1 A plus1 B. Canonical
blocked outcomes and zero provider/render/activation calls remain required.

## Authorized repair reservation

Only after meaningful RED, available Supabase CLI `migration new
ediel_resume_tenant_fair_claim` created exact forward
`20261001012959_ediel_resume_tenant_fair_claim.sql`. Root authorized this unique
migration, existing `lib/ediel/intent/resumeStuckIntents.ts`, new
`lib/ediel/intent/edielResumeFairClaim.ts` and independent unique core/runtime/
native proof files. No route/intentEngine/canonical dispatch gate changes,
workflow/registry/generated edits or historical SQL mutation are authorized.

## Implemented scheduler and authority boundary

The new invoker RPCs require current_user=service_role. Frontend roles receive
neither EXECUTE nor private-table access; service receives narrow SELECT/INSERT/
UPDATE and no private DELETE/TRUNCATE. No business permission or actor grant is
added. Current company status must be non-null active/onboarding. Stored phase
predicates exactly retain the original validated and draft filters, including
the original validated filter's absence of a direction predicate. Canonical
dispatch remains responsible for sender/source/party/readiness/lifecycle and
outbound-freeze gates.

Claim obtains current company SHARE locks, then current eligible intent UPDATE
locks with SKIP LOCKED. Persisted per-phase tenant turns order least recently
served tenants. The SQL caps100 overall and5 per tenant; the existing module
cap50 and actual cron cap25 remain. Explicit companyId stays the exact target.
Claim changes no public intent/business status or updated_at. It captures the
current intent stamp in a private ten-minute token lease. The actual current-row
UPSERT permits replacement only for a finished lease or expires_at strictly
before the bound DB clock. An unfinished lease at the exact expiry cutoff is
protected. Returned IDs and persisted turns come only from successful lease
RETURNING IDs; turn writes have deterministic company_id order.

Before each canonical operation, a separate RPC takes company SHARE, intent
UPDATE and lease UPDATE locks and rechecks current owner, phase, public stamp,
token, unfinished state and expiry. Completion takes the same lock order and
requires the current token/current company. It writes only the private receipt,
then checks wall clock again after the final write so a late trigger/lock delay
cannot commit an expired completion. A failed claim operation records a safe
static failure code where completion succeeds. A completion failure remains
explicit; later claimed tenants continue. Missing/bad claim RPC responses fail
closed without a legacy table-selection fallback. Finite inputs are clamped and
the adapter validates IDs, owner, phase, token, date, unique IDs and response cap.
Cron errors do not expose the actual controlled DB/provider canary text.

The pre-work check's SQL transaction ends before JavaScript calls the canonical
dispatcher. This is a point-in-time scheduler fence, **not an atomic worker or
provider-effect fence**. Canonical dispatch idempotency and current authority
remain necessary. The draft sweep's canonical business state write likewise
remains a separate transaction. A missing claim RPC may fail the entire outer
cron after earlier phase work; no whole-cron atomicity is claimed.

## Executed proof and exact limits

| Verification | Actual result | What it qualifies |
|---|---|---|
| Actual cron/resume/intentEngine with real table SQL |9/9 PASS| Both phase quiet progress, limit-one rotation, exact-company preservation, unauthorized no-op, per-claim safe failure/error isolation, missing RPC fails closed |
| Actual complete new SQL on PostgreSQL17.5/PGlite and original intent DDL |9/9 PASS| Phase caps/turns, public graph unchanged at claim, current stamp/company/token, original predicates, current-row cutoff CAS, expired reclaim/stale token, low-role/input denial, late claim rollback, witnessed late completion rollback |
| Scoped TypeScript, ESLint, CJS syntax, diff whitespace |PASS| Local compile/static gates only |
| Existing missing-facility outbound blocker |PASS| Existing canonical hard blocker source contract |
| Existing intent-outbox bridge regression |PASS| Existing intent/outbox source contract |
| Existing cron-idempotency source regression |Initial12 stale textual assertions FAIL; current exact source-trace correction PASS| Actual facade export is verified before the unchanged ten technical-context/terminal assertions run on part-3; obsolete resume strings are replaced with real helper→SQL current token/stamp/owner/CAS before every dispatch |
| Genuine full-history Supabase native |7 authored /0 executed| NOT_EXECUTED; no native acceptance inferred |

The SQL core uses the original complete intent DDL/constraints/indexes and
minimal typed parent company/message/request tables. It does not execute full
Supabase history, Auth, real storage, all owner/ACL/RLS policies or real
concurrency. Runtime uses actual exported route/module/intentEngine; controlled
outer DB and unrelated cron/transport seams remain explicitly bounded. Earlier
fixture mistakes during seed/adaptation and initial limit-one rotation setup
were fixed; they are not additional production REDs. Only the original3 actual
runtime REDs establish the change's pre-repair failure.

```sh
NODE_PATH=/tmp/ediel-service-check/node_modules /tmp/ediel-toolchain/node_modules/node/bin/node --test scripts/ediel-resume-tenant-progress-20261001.postgres.test.cjs
NODE_PATH=/tmp/ediel-service-check/node_modules /tmp/ediel-toolchain/node_modules/node/bin/node node_modules/vitest/vitest.mjs run --config scripts/ediel-resume-tenant-progress-20261001.config.ts --reporter=verbose
NODE_OPTIONS=--max-old-space-size=1536 /tmp/ediel-toolchain/node_modules/node/bin/node node_modules/typescript/bin/tsc -p /tmp/gridex-ediel-resume-tsconfig.json --noEmit
node scripts/gridex-z01-missing-facility-outbound-blocker-regression.cjs
node scripts/gridex-ediel-intent-outbox-bridge-regression.cjs
node scripts/gridex-cron-idempotency-and-locking-regression.cjs
```

## Genuine native preparation and integration ordering

The uniquely named native config requires CI=true and an exact status file for
http://127.0.0.1:54321 plus actual anon/service credentials. SQL sessions use only
postgresql://postgres:postgres@127.0.0.1:54322/postgres. This package supplies no
real provider credential, approved business source, transport mock, activation
actor or external call. Synthetic rows deliberately lack facility/metadata and
the actual engine must reach canonical blocked state with zero message/request/
outbox effects. Only the bundler's server-only marker is isolated.

Seven sequential prepared cases cover both phases' batch and turn progression;
actual explicit-company canonical blocked work and preserved A graph; current
stamp/phase/expired reclaim/stale token/paused tenant/frontend grants; two actual
psql transactions with a witnessed Lock wait whose pg_blocking_pids resolves
to the first session's exact application_name before release and disjoint IDs;
the exact applied server pg_get_functiondef lease UPSERT at the expiry cutoff;
late tenant-turn fault rollback; and final completion expiry rollback with an
observable nontransactional nextval before the delay. The final sequence must
report is_called=true/calls1 so early denial cannot substitute for reaching the
final write. Genuine execution and those assertions are still pending.

After applying the forward, wire this **after the existing webhook/residual/
customer-operation global fairness suites and before any other fixture leaves
eligible Ediel intents**. Global cases require an initially empty eligible queue
and refuse to delete/rewrite another fixture's work. Cleanup deletes only own
synthetic transient intents (with own leases) and own tenant turns plus unique
fault hooks/sequences. Company and immutable legal history survive until stack
disposal. No guard is disabled, no historical migration is moved/renamed, and
the applied source comes from the server rather than a repository migration
path that clean replay may place in HOLD.

```sh
CI=true GRIDEX_NATIVE_STATUS="$candidate_status_path" node node_modules/vitest/vitest.mjs run --config scripts/ediel-resume-tenant-progress-20261001-native.config.ts --reporter=verbose
```

No separate seed, secret artifact or postcheck is needed beyond the exact local
stack status. Root registers the unique forward and captures genuine generated
types/schema/fingerprint before claiming full-history proof. Independent
billing-owner review executed current core9/9 and actual exported runtime9/9
PASS. It found no concrete new source blocker, confirmed deterministic turn
writes and safe error isolation, and retained the point-in-time dispatcher
boundary. Its final native observation request was applied: the waiting worker
now must name the first worker as its actual blocker. No native execution was
claimed by either reviewer. The final bounded review and manifest belong in the
root integration evidence and do not qualify unexecuted native cases.

Full T40 measured fairness across all reachable queues, tenant/user/IP/cost
budgets and real runtime load remain open. The complete75-row reconciliation
retains every original requirement and separates remaining internally
implementable work from exact external boundaries; this one scheduler never
promotes full T40 or the whole masterplan to VERIFIED.
