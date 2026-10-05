# PR600 terminal CI receipt

**9/9 mandatory jobs SUCCESS** on authentic PR head `52a0e77cbf4816d2f55cfea083b29888632c374c` (committed source tree `ea5f37e9ea0431d50bd96cfc0c566d343764161a`). Final PR/check observation **2026-10-05T17:33:49.407610+00:00**; all four associated pull-request workflow runs are completed SUCCESS, attempt1, same52a head. PR600 was open/unmerged at this read. The sole poll chain is stopped.

| Actual job | Run / attempt | Job ID | Result | Completed UTC |
| --- | --- | --- | --- | --- |
| clean-migration-replay | 37341555899/1 | 111869614757 | SUCCESS | 2026-10-05T17:33:32Z |
| upgrade-migration-replay | 37341555899/1 | 111869614570 | SUCCESS | 2026-10-05T16:49:38Z |
| quality-release-gates | 37341555899/1 | 111869614760 | SUCCESS | 2026-10-05T16:46:04Z |
| verify | 37341555899/1 | 111869614834 | SUCCESS | 2026-10-05T16:39:12Z |
| targeted-regressions | 37341555786/1 | 111869616893 | SUCCESS | 2026-10-05T16:41:22Z |
| browser-public | 37341556049/1 | 111869615681 | SUCCESS | 2026-10-05T16:41:52Z |
| smoke | 37341555864/1 | 111869614272 | SUCCESS | 2026-10-05T16:49:23Z |
| coverage | 37341555864/1 | 111869613963 | SUCCESS | 2026-10-05T16:41:56Z |
| pr-certificate | 37341555864/1 | 111877076374 | SUCCESS | 2026-10-05T16:58:42Z |

Initial17 checks contained eight mandatory jobs plus nine conditional skips; `pr-certificate` materialized after smoke/coverage. The parent’s initial `full-release-suites` template name was corrected against committed52a `.github/workflows/full-e2e.yml:100–129` and acknowledged by root. Both the initial assumption and authoritative correction are preserved in the routing/receipt JSON. All nine conditional staging/full/nightly checks remain SKIPPED, without PASS credit.

One root-requested clean-job metadata read at **2026-10-05T17:11:11.180791+00:00** identifies exact52a, job start **2026-10-05T16:39:15Z**, and then-running step7 “Clean empty-database replay and verify generated types” starting16:40:03Z, with no failed step at that observation. Actual final clean conclusion **SUCCESS**, completion **2026-10-05T17:33:32Z**. No successful-job log, native/capture artifact or further step metadata was retrieved.

The requested **ONE** combined commit-status read at **2026-10-05T17:34:49.154314+00:00** returned exact52a, overall **success**, one context: **CodeRabbit=success**, literal description **“Review skipped: manual review required for this OSS repository”**. There are **0 separate non-green contexts**. This is a green provider status with a skipped automated review; existing manual/peer review is not replaced or requalified here.

Every mandatory check and each of the four actual attempt1 runs carries52a `head_sha`; the once-read clean-job metadata independently carries that head. Frozen workflow sources were read by `git show52a:path`; no checkout was performed. Actual checkout bytes, certificate payload, unit/native counts and artifact contents are **NOT_EXECUTED/NOT_READ** in this bounded observer. No PR589 verdict was reused, and no new whole-card/runtime/native/source/schema/formal-market approval is claimed.

The chain has 46 sequential numbered observations with a60-second wait between polls, and one documented pause/resume for the requested clean metadata read. All authenticated read attempts succeeded. No other PR/main was watched, and no source edit, push, runner start, rerun, log download, artifact download, external comment or merge occurred. **Root owns the next single fresh main/head/check/serial merge guard.**

Authentic initial raw: `initial-pr.raw.json`, `initial-checks.raw.json`, `initial-runs.raw.json`; root-provided original17-check capture retained as `root-initial-checks.raw.json`, SHA256 `6251d98667229b7e59a0ed17b97ec1b8c4b1774b6eda690f220a553a99bf73e5`. Authentic terminal raw: `terminal-pr.raw.json`, `terminal-checks.raw.json`, `terminal-runs.raw.json`, `terminal-commit-status.raw.json`. One-time job metadata: `clean-job-once.raw.json`. Full numbered raw observations, fetch attempts/stderr, control log and source-routing custody are retained alongside `final-receipt.json` and `final-preservation.sha256`.
