# Actual candidate CI evidence: 0d814656, 2026-09-30

## Provenance

Read-only monitoring of existing #422 runs; no rerun, workflow/ref mutation or
publication was performed by this reviewer.

- Repository: heke99/gridex-ops-platform.
- Published candidate head: `0d81465617d11f099502832385d976fdedf3cc6d`.
- Actual checkout observed in OPS verify/clean/upgrade/quality, full-E2E smoke
  and public-browser logs: `45a09811bbbba42f287c6778de76f27dbe13b9ec`.
- GitHub Git commit API confirms this merge checkout has tree
  `e86c110e64e7fa494a68a7dc6010aea39c2c7394`, exactly candidate head's tree.
- OPS run: 36780003023. All jobs terminal.
- Logs fetched through authorized GitHub tools. Raw local CLI fixture keys from
  earlier runs were never printed or preserved in this report.

## Actual first errors and acceptance

| Job | Actual result | First failure / scope |
| --- | --- | --- |
| OPS verify 110107570747 | FAIL | Generated-types migration tail 20260930193417_customer_ops_command_capabilities.sql differs; later verify gates skipped. Migration checksum/legal/contract checks passed before it. |
| OPS clean replay 110107571193 | FAIL, exit 3 | Site migration 20260930192831_customer_site_registry_atomic_command.sql:285, SQL LINE 109, syntax error at end of input near postal_code regexp_replace expression. Prior profile migration now parses. |
| OPS upgrade 110107571172 | FAIL, exit 1 | Billing migration 20260930161500_customer_billing_profile_command.sql invokes a trigger whose NEW has no moved_out_at field. Real pinned older replay and old-row seed passed; no backup/restore acceptance reached. |
| OPS quality 110107571157 | PASS | Full quality steps completed: 456 files / 6718 tests, plus scoped ops suite 2 files / 45 tests, lint/types/API/RBAC/build/budgets. Expected failure-log text inside unit fixtures is not a job failure. |
| Full-E2E smoke 110107571313, run 36780003036 | FAIL | 14/15 checks pass; sole failure is the same generated-types migration-tail drift. Typecheck passes. |
| Full-E2E coverage 110107571687 | PASS | Coverage gate completed; does not replace native/runtime evidence. |
| Full-E2E PR certificate 110108626890 | FAIL | Smoke did not pass: failure. Artifact verdict RED. |
| Public browser 110107572736, run 36780003210 | PASS | 4/4 public landing/login navigation and automated serious/critical accessibility checks. |

Full/nightly/runtime-staging/real-customer-staging were skipped after
full-E2E smoke failure. Browser staging, k6 load/soak, ZAP staging and staging
quality certificate jobs were skipped. No skipped/runtime path is accepted.
Tenant integrity run 36780003024 and Ediel masterplan run 36780003434 are
terminal success at the same candidate head (metadata observed); crawler run
36780003251 is skipped.

Sanitized exact native error excerpts:

```text
2026-09-30T21:34:24.2140944Z psql:/tmp/[PRIVATE]/20260930192831_customer_site_registry_atomic_command.sql:285:
ERROR: syntax error at end of input
LINE 109: ...ce(v_changes->>'postal_code',''),'\D','','g') ~ '^[0-9]{5}$'

2026-09-30T21:34:13.1789532Z TENANTSERVICE_UPGRADE_APPLY 20260930161500_customer_billing_profile_command.sql
2026-09-30T21:34:13.2236322Z TENANTSERVICE_NATIVE_SQL_FAILED 20260930161500_customer_billing_profile_command.sql
2026-09-30T21:34:13.2428071Z TENANTSERVICE_PROOF_FIRST_ERROR 20260930161500_customer_billing_profile_command.sql.log:
record "new" has no field "moved_out_at"
```

## Artifact inspection

Artifact ZIPs were actually downloaded and SHA256 compared to GitHub metadata.

| Artifact ID | Name | ZIP SHA256 | Observed content |
| --- | --- | --- | --- |
| 11127404106 | gridex-rem-002-clean-replay | 185297d24d5f7058ee5e0b95ceee9c037edf571587c4c9e43b6fe1f344e18d0d | Only rem002-clean-replay.log; no generated schema/types. |
| 11126788690 | gridex-browser-public-36780003210 | ed62dda5f84632b6ebc1785c5bc408b64381fd983adc688b364f8d7d24a0129b | Playwright report/JUnit + P0/handoff JSON. JUnit has 4 tests, 0 failures, 0 skips. |
| 11126883575 | gridex-e2e-smoke-36780003036 | 7aecf6ea192d4ce802bcdadcadab3fdb59f96daed85942f8b5ee4829ed721688 | Smoke reports/JUnit and 15 bounded gate logs. |
| 11126489666 | gridex-pr-release-certificate-36780003036 | 4a2c5a6766839c428d17f7d575ae12d0808090009ac0952d7713c5f3375880ef | schema_version1, smoke=failure, coverage=success, verdict=RED. |

Upgrade artifact 11126808879 metadata observed, not downloaded here:
sha256 9f4860cefea9c6f2b3f02a03bbedaf14e011cd1764599c41441e1316fa9852e7.
No actual schema/type artifact can be adopted from this run. Clean replay
fails while sourced, before authentic generation and all downstream native,
HTTP and authenticated browser fixtures.

## Startup hygiene

New actual clean log contains zero sb_secret/sb_publishable key patterns,
versus two in preceding run36775178898. Generic local startup PASS is observed.
The full CLI startup capture remains in private RUNNER_TEMP only while running.
Earlier executed extracted-wrapper success/failure tests verify mode600,
original exit preservation and EXIT removal; this CI observation additionally
proves actual runner stdout no longer leaks those local key patterns.

## Upgrade prerequisite diagnosis

The historical 20260519_customer_move_out_lifecycle.sql has an 8-digit prefix.
Canonical replay's timestamp selector only accepts 14-digit names; the file is
absent from the explicit foundation and additions in both ae56 baseline and
this candidate. Those classification/foundation files and the legacy lifecycle
SQL are byte-identical between baseline and candidate. The authentic clean log
contains no application of that historical file.

Canonical foundation01 actually executes, but its customers CREATE TABLE has
no lifecycle fields. The moved_out_at occurrence in that file belongs to
customer_addresses. Combined with the old-row seeded runtime trigger failure,
this explains the missing customer lifecycle prerequisite. No table dump from
the failed upgrade exists here; this explanation derives from verified replay
selection/source and actual error, not an unobserved schema artifact.

Site SQL blocker was relayed to site_continuation; upgrade prerequisite was
relayed to requirements_audit. Both own their next fixes. Portal review has
separate local blob provenance in the continuation portal-review report; this
earlier published candidate does not qualify those later local portal changes.
