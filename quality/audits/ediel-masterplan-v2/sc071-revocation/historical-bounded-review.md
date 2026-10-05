HISTORICAL / SUPERSEDED SCOPE: the six duplicate SC010 unit cases were withdrawn
from this PR after explicit ownership handoff5991386261. SC010 belongs to PR570.
The current SC071-only review is independent-review.md; native still NOT_RUN.
The original review below retains its exact earlier results and limits.

# Independent bounded review: SC-010 / SC-071

Source SHA: `985724f58ef15e222cf4d3b2e1c643c674852106` (independently verified HEAD).
Test-only packet; no production,
coverage, frozen-specification, shared-memory or external-comment edits by this
reviewer. Review date: 2026-10-05.

**Verdict: APPROVE the bounded tests; whole SC-010 and SC-071 remain unapproved.**
The tests accurately separate the current-read and native projection components
from the absent queued/leased beneficiary export capability. No material defect
was found in their assertions, fixture ownership or transaction cleanup. Native
execution is **NOT_RUN**; static review is not a native PASS receipt.

## Reviewed packet and verification

| File | SHA-256 |
| --- | --- |
| `__tests__/ediel-sc-010-current-export-authority.test.ts` | `e7ad42b90505a30ff85a4c22e9f48c35ef80016643cdeedd7c127b07160fadea` |
| `scripts/ediel-sc-071-projection-revocation-native.test.ts` | `6407877b57576c7b3dac3db2c3847935ef4941b71b5f5efd36c6e4b5f0fb1ef0` |
| `quality/audits/ediel-masterplan-v2/sc010-sc071/native.config.ts` | `dfd7ae4e5b278d0c86904cda781ae4b8c1232d2aa1033022f4bb075d11853d1b` |

Independent command, executed on Node **22.23.0**:

```text
/tmp/ediel-sc010-sc071-npm-cache/_npx/b9d87a63db2d0ec3/node_modules/node/bin/node node_modules/vitest/vitest.mjs run __tests__/ediel-sc-010-current-export-authority.test.ts --reporter=verbose
```

Result: **6/6 PASS**, one file, exit 0, 2026-10-05 09:11:21 UTC, duration 596 ms.
The reviewer did not launch or interfere with the concurrent canonical native
setup/runtime. Root reported setup aborted during Docker image-layer registration
with `no space left on device`, before native execution, then restored disk space
and all tracked source files through canonical EXIT cleanup. The reviewer
subsequently ran `git rev-parse HEAD`, `git diff --exit-code`, and `sha256sum` on
the three files above: correct source SHA, tracked diff empty, hashes recorded.
No native setup/replay/test PASS is claimed. Parent-reported type/lint results
were not independently reexecuted by this reviewer.

## Assertions and execution boundaries

- SC010 unit lines 37–45 run the actual GET → query parser → projection adapter
  and assert positive scoped rows, the real RPC identity/version parameters,
  provenance and `private, no-store`. Lines 48–59 reuse a real generated cursor,
  invoke the RPC again after a successful page, and require a generic 403 with
  neither cached quantities nor private error details. Lines 62–91 assert
  returned-version mismatch, denial with the current version, stale data plus
  an authority error, and cursor refusal after changing version. Only session
  authorization and RPC transport are mocked. Database revocation is not proved
  by those finite RPC errors.
- SC071 native lines 18–44 use the existing real archive/review, market approval,
  grant publication, received E66 validation and accepted-storage fixture. A
  beneficiary membership and `metering.read` permission are explicitly seeded;
  neither global administrator authority nor fake accepted receipts substitute
  for those application owners. External issuer inputs and SMTP remain synthetic.
- Native lines 56–95 acquire writer-first locks by executing the current
  production revoke RPC with `SET LOCAL ROLE service_role` in an open psql
  transaction. A retained successful page exists before the race. The actual
  adapter read must wait on a database lock. COMMIT requires zero returned data,
  an incremented revoked grant version, rejection of both old/current versions,
  and unchanged source/series/values/consumer receipts/provider calls. ROLLBACK
  requires the original active grant and identical retained page.
- Native lines 97–119 run the actual projection SQL in a retained reader
  transaction and observe the actual application revoke command waiting.
  After reader COMMIT, revoke succeeds and subsequent reads with both versions
  fail. This establishes the opposite SQL transaction order; it does not model
  a provider send after RPC commit.
- `waitForNativeLock` lines 47–53 observes PostgreSQL lock waits on the actual
  function query. It is a general lock observation, not a specific PID/relation
  assertion; the unchanged canonical config disables file parallelism. Cleanup
  uses the existing psql helper deadlines, disposes the open transaction in
  `finally`, then drains the pending request. No new fixture cleanup mechanism
  or fabricated native status file is introduced.

## Contract trace and precise remaining effects

Frozen `registers/acceptance_tests.json:137` (SC-010) requires an active grant at
queueing, relevant revocation before reading/sending, and a job taking a lease
that rechecks the version and stops export without stale cache authority.
Line 1020 (SC-071) requires parallel export-job execution and relevant grant
revocation, with a current-version check and transaction boundary preventing
unauthorized disclosure. Rules TEN-10/TEN-12 remain the existing owners' scope.

Actual production reads are `app/api/ediel/beneficiary/series/[seriesId]/route.ts`
lines 10–22 → `lib/ediel/services/projection.ts` lines 5–13 → final wrapper
`20261001035402_ediel_beneficiary_receipt_read_before_write_replay.sql` lines
18–22 → filtered reader `20261001015846_ediel_service_scope_grant_set_and_projection_entry.sql`
lines 234–275. The wrapper takes the graph SHARE fence
(`20261001004953_ediel_current_company_permission_denies.sql:62–70`); the filtered
reader locks assignment/grant FOR SHARE and checks exact current version,
active/nonrevoked rights and tenant/purpose/field/time scope at lines 246–251.
The revoke command's writer fence takes conflicting SHARE ROW EXCLUSIVE service
locks before its assignment/grant FOR UPDATE and version checks
(`20261001043917_ediel_service_source_network_period_timing.sql:67,95–96,131–147,169–176`).
The new native tests target this real projection boundary, unlike the inherited
accepted-storage race (`scripts/ediel-service-evidence-native.test.ts:263–271`)
and beneficiary-permission DENY race (lines 378–387).

Prior absence search across lib, app, migrations/functions, scripts and tests:
`beneficiary_export|export_beneficiary|beneficiaryExport|exportBeneficiary` → 0;
`export_job|exportJob|export_jobs` → 0; beneficiary/grant-version combined with
lease/enqueue/queued/worker/export-job → only inherited native projection test
line 386. Tracing every production projection/RPC caller found only the
synchronous GET, with no durable beneficiary-export queue, lease or send owner.

Remaining whole-contract work: actual active-at-queue → revoked-before-leased
read/send execution; current grant/actor/tenant checks by the real worker;
parallel grant revocation and actual export/disclosure transaction boundary;
and assertions that cached authorization or page bytes cannot trigger a send
after the relevant revocation. Native projection PASS alone cannot approve
either whole row. Existing SQL rights locks end at transaction commit; they do
not by themselves establish a queued export/send boundary. No production
projection vulnerability was established by this bounded review.
