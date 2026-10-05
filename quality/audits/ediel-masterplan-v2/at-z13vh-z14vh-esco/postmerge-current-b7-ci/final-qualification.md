# PR589 exact-head CI qualification

Qualified at 2026-10-05T14:15:33.743878+00:00. All **9/9 mandatory jobs SUCCESS** on authentic PR head `b7acb387c4132c7885e84bd1d7197f3ec5a0143f` and committed tree `6aed10be3004362471444db2590d36784b852c23`. Fresh PR/check/run/jobs API reads succeeded; every mandatory check and all four attempt-1 pull-request runs identify this head. The PR was open/unmerged at this read. No head mismatch, failure or cancellation was observed.

| Job | Run / attempt | Job ID | Result | Completed UTC |
| --- | --- | --- | --- | --- |
| browser-public | 37315927293/1 | 111782539215 | SUCCESS | 2026-10-05T13:20:54Z |
| smoke | 37315927245/1 | 111782539655 | SUCCESS | 2026-10-05T13:21:29Z |
| coverage | 37315927245/1 | 111782539806 | SUCCESS | 2026-10-05T13:25:30Z |
| targeted-regressions | 37315927355/1 | 111782539683 | SUCCESS | 2026-10-05T13:24:25Z |
| verify | 37315927996/1 | 111782546766 | SUCCESS | 2026-10-05T13:21:41Z |
| quality-release-gates | 37315927996/1 | 111782546558 | SUCCESS | 2026-10-05T13:28:42Z |
| clean-migration-replay | 37315927996/1 | 111782546601 | SUCCESS | 2026-10-05T14:13:58Z |
| upgrade-migration-replay | 37315927996/1 | 111782546353 | SUCCESS | 2026-10-05T13:29:54Z |
| pr-certificate | 37315927245/1 | 111785066225 | SUCCESS | 2026-10-05T13:26:55Z |

The full check list has 18 checks: nine successes and nine event-inapplicable skips. `pr-certificate` is the ninth required PR job and waits for smoke/coverage. Tenant-integrity path filters do not select these NEW paths; no extra tenant job was required by this committed event graph.

## Actual unit/profile/quality receipts

Coverage job111782539806 and quality job111782546558 each report **822 files / 10,494 tests PASS, zero skipped**. Both actual decoded logs explicitly show the NEW Z13VH profile file **6 tests PASS** and Z14VH profile file **4 tests PASS**. Coverage log lines534/661 and1339–1340; quality log lines1434/1559 and2221–2222. The targeted masterplan gate job111782539683 reports **352 IDs /213 approved /236 tagged green /0 tagged failing /116 untagged** at log206 and lists both profile IDs/files at229–230. These tagged finite joins do not change whole-card coverage status.

Quality scripts/tests typechecks, lint, mechanical checks, 2-file/45-test quality checks and production build passed. Typecheck commands are visible at quality log1047/1057; compiled-success line2365. Authentic coverage artifact totals: statements57.57%, branches51.24%, functions64.85%, lines58.43%; ratchet PASS.

## Completed clean replay boundary

Clean job111782546601 ran13:19:45–14:13:58Z and succeeded with no failed steps. Authenticated completed log `job-111782546601.log` contains 28421 lines; SHA256 `831ee157a3cce6c3b6080e9158366f661a93ba43b457432bc7dca68c2a593520`. This is ordinary current-head CI evidence. The emitted clean replay completed13:23:06Z (line24509); artifact generation completed13:23:18Z (24523); SQL regressions completed13:23:39Z (25481); native owners completed14:03:41Z (26479); browser completed14:12:29Z (28135); post-browser native completed14:13:22Z (28275); schema gates completed14:13:30Z (28317). Thus the earlier long running step did not expose these completed subresults until its final receipt.

Generated types SHA256 `4f5713d630d848363dfa5d76c87adc9bb4c52a4dfb3fb3b4f53068f9606279c4` appears at24522. Schema snapshot verified fingerprint `a183679d86a31305e60b2e1625f666adee3ff1faa442e03a3be2fe55b7ff901e` at28316. Ordinary native aggregate **48 files /608 passed /1 skipped of609** at26473–26474; browser **31 passed** at28134. These aggregate summaries do not qualify a new VH object-owner/native scope or the whole cards. No selected native receipt was redownloaded or reattributed.

The log records uploaded clean artifact11351057199,16090415bytes, emitted ZIP digest `28dcc398e75fe57f59ffae802a000821049cd68acc8751c8a110ca4b4de0bc22` (28397–28401). It was **not downloaded**; CRC/member/archive qualification is NOT_EXECUTED. No full source or native archive was retrieved.

## Authenticated small artifacts and certificate limits

Only two small artifacts from same run37315927245/attempt1 were retrieved. Artifact11347334548 ZIP2297bytes SHA256 `65520a93657be2f3bc3f0c88001c33fdbd249f078f6422267f1fa31c9e97a784`; one CRC-valid `pr-release-certificate.json`. Artifact11347304308 ZIP753908bytes SHA256 `4fff6d67166740e3a4c99a02b42e29f3be632a898f20f5baddcb2050507e2ec1`; both CRC-valid `coverage-summary.json` and `lcov.info`. Digests match authenticated artifact metadata.

Actual certificate GREEN means smoke/coverage success. Its candidate SHA/tree equal b7/6aed, checkoutClean=true, event SHA`ff750412c175033419ff53c9c7eb5ea6ee94cf30`, sourceAuthentication=same_workflow_artifact_channel. It explicitly retains codeEvidence=incomplete, fullCardVerification=NOT_VERIFIED, formalEdielApproval=false, liveCounterpartyVerified=false, and an empty/false tenant/DDQ/DGI/cross-tenant scope matrix. Its evidence levels remain missing; job status does not supply full source/market approval.

Whole **AT-Z13VH-ESCO and AT-Z14VH-ESCO remain PARTIAL / coverage NOT_EXECUTED**. This report qualifies the actual nine ordinary jobs and finite ten NEW profile assertions. Fresh actual-main composition/foreign-owner preservation and final merge guard belong to root. Prior selected native d1 evidence retains d1 attribution after integration. This reader performed no rerun, tracked repository edit, native harness, external message or merge. Initial sandbox-network failures and subsequent successful authorized read-only fetches are preserved in this directory.

Machine receipt: `final-qualification.json`. Raw final head/18 checks/four runs/OPS jobs: `final-*.raw.json`; fetch status `final-fetch-attempt.json`. Decoded job logs, selected excerpts, immutable workflow copies, qualified small artifacts and initial failed attempts remain alongside them. Temporary signed download metadata stays in scratch and is not needed for a public receipt.
