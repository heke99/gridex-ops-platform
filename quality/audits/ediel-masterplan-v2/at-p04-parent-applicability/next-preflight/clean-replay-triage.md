# PR591 clean-job triage — corrected terminal evidence

Independent bounded read-only review, 2026-10-05 UTC. Candidate: `bbf89d53f62b495739097601133bea30007d5dfb`, OPS hardening run `37317382626`, original clean job `111787432069`. No replay, SQL, native test, workflow rerun, source, shared file, coverage, or external message was executed by this reviewer. Only this report is written. Source inspection followed the project spec-to-code/review instructions and the Supabase skill for the migration context.

**Verdict: original clean job CANCELLED during a progressing sequential native suite; migration replay itself completed. No migration lock, statement timeout, assertion failure, or source defect is established by the inspected evidence. The complete clean job and whole native suite remain unverified.** The original live-log prefix must not be described as twenty-two minutes of actual pipeline inactivity.

## Live-prefix limitation and decisive correction

The live connector response read at approximately 13:54 ended at `13:33:38.5273576Z CREATE INDEX`, after migration `20260930164804_ediel_prodat_retry_correction_authority.sql` began and emitted one `CREATE TABLE` and two `CREATE INDEX` command tags. Job metadata then reported `in_progress`; no failure annotation or `clean_replay_complete` was visible in that response. This established only the last progress **visible in that fetched prefix**. It did not establish a waiting SQL statement, lock owner, database/backend inactivity, or a failed migration.

The final decoded job-log response after cancellation supplies later authentic records from the same run. They directly refute the migration-stall interpretation:

| UTC record | Actual effect observed in the final log |
| --- | --- |
| 13:33:38.5292063 | The next `CREATE TABLE` completed, immediately after the live prefix's last index tag. |
| 13:33:38.5516392 | The implicated migration emitted `COMMIT`. |
| 13:33:38.5613980 | The following migration, `20260930164947_ediel_z02_original_dispatch_proof.sql`, began. |
| 13:34:05.6837435 | Replay verified fingerprint `9a0ecad97567e0af86c623b6f79b5144c922dda2af2f02bd9225c97ce5ca6d9b`. |
| 13:34:05.8688506 / .8712372 | Canonical replay reported PASS, then the workflow emitted `clean_replay_complete`. |
| 13:34:17.2538937 | `artifact_generation_complete` was reached. |
| 13:34:37.9707213 / .9722121 | Merge-concurrency and SQL-regression phases completed. |
| 13:34:38.9608150 | The existing complete native-owner suite began. |
| 13:55:32.1018170 | Another native file completed successfully; actual progress continued long after the live prefix ended. |
| 13:56:12.8802763 | GitHub emitted `The operation was canceled.` |

No mechanism for the incomplete live response is diagnosed here. The terminal log, rather than an inference from silence, resolves the specific migration hypothesis.

The final log contains five actual successful file-completion records: UTILTS consumption (141 tests, 145131ms, 13:37:10), correction context (117 tests, 578072ms, 13:46:49), source owner (48 tests, 312986ms, 13:52:03), service evidence (29 tests, 147971ms, 13:54:32), and document reference (40 tests, 58645ms, 13:55:32). These are bounded file records, not a final suite/JUnit approval. `native_owners_complete` and the full native summary were not reached in the inspected final log. Some native SQL prints intentional denial errors: for example, `scripts/ediel-document-reference-native.test.ts:339–343` explicitly expects direct table/RPC calls to throw. Such `ERROR:` text alone is not a failed test; this file subsequently emitted its successful completion record.

At 13:56:21 the connector independently reported the original clean job `completed/cancelled`, its main step `cancelled`, and both redaction and artifact-upload steps `success`. Verify (`111787431831`), quality (`111787432549`), and upgrade (`111787431647`) remained `completed/success`. The final log records uploaded clean artifact `11349384892`, compressed size 3185222 bytes. That artifact has not been downloaded or independently qualified in this review. Successful upload does not turn the cancelled job into a green gate.

## Actual source and timeout boundary

All four inspected source inputs match the immutable candidate; `git diff --exit-code bbf89d53… -- <these paths>` returned zero and their working-tree status was clean:

| Source | SHA-256 |
| --- | --- |
| `.github/workflows/ops-hardening.yml` | `eceef159107cc788bb0188e43874ed20fbcf9acdbd9a0f259ef68e20b5c6a261` |
| `scripts/gridex-aud-003-clean-replay.sh` | `fd28ec70ce1fff7392f282dd0029b2499ba2b24d6ab4cc4a13a11a758bf3aa18` |
| `scripts/gridex-ediel-upgrade-replay.sh` | `80702acf7eaa3ba0c8819a3426e4a42032f2da9aec6cbb4e30dd745eb34f7485` |
| `supabase/migrations/20260930164804_ediel_prodat_retry_correction_authority.sql` | `f7d2f3d538cda98e7295778b304995b04667a251a8e58e72bdf263c46796d43c` |

The clean job has `timeout-minutes: 90` (`ops-hardening.yml:89–97`), checks out the PR head, and sources the canonical replay within the same step (`:128–138`). It does not have a shorter step deadline. The replay runs migrations sequentially through `psql -X -v ON_ERROR_STOP=1 -f` (`gridex-aud-003-clean-replay.sh:322–331`); this wrapper supplies no `timeout`, `PGOPTIONS`, `statement_timeout`, or `lock_timeout`. The passing `bounded-child-process.test.mjs` in the separate verify job does not wrap this replay command. This inspection does not determine server-side GUCs or prove that every downstream native operation has a bounded child deadline.

Canonical replay starts a real disposable local Supabase stack and image `17.6.1.155` (`clean-replay.sh:291–311`). Its sourced `EXIT` trap stops the stack and restores held migrations/seed (`:62–79`). That is the intended cleanup path; completion of all individual cleanup operations is not inferred solely from its definition. Following replay, the workflow runs the existing native command at `ops-hardening.yml:275–279`. The existing config has `fileParallelism:false`, `testTimeout:120000`, and `hookTimeout:120000` (`scripts/ediel-source-owner-native.config.ts:70`). A 120-second test/hook limit is not a two-minute whole-suite limit: many tests execute sequentially across the selected files. The recorded file durations explain why the native phase could still be progressing after twenty minutes without establishing a timeout defect.

The originally inferred next statement is indeed the `CREATE TABLE … prodat_recovery_messages` at migration line 15, with foreign keys to the newly created operations table and `public.ediel_messages`; it could require relation locks. No `pg_stat_activity`, `pg_locks`, blocking-PID, query-start, or wait-event observation accompanied the live prefix. The terminal log proves this statement and the transaction completed immediately. The preceding migration's prospective-recovery functions and authority model must not be changed to fix an unobserved replay lock.

## Comparison with the successful upgrade job

The successful upgrade checks out the same PR head with full Git history, uses Node 22 / Supabase CLI 2.101.0 and the matching PostgreSQL client, and also has a 90-minute job limit (`ops-hardening.yml:533–577`). It executes the existing `gridex-ediel-upgrade-replay.sh`; it is not the complete clean-job native/browser chain.

The script first replays genuine ancestor `53bf989b0ad402bb2ce151c186eea31f1ec9cf03` in its disposable worktree and applies checksummed forward inputs with real psql (`upgrade-replay.sh:13,49–69`). It then tears down that historical stack through the sourced cleanup and starts an independent candidate clean replay at the candidate root (`:96–101`). Authentic schema, fingerprint and generated-type comparisons remain blocking (`:102–111`). The later history-union scenario reuses the resulting candidate-clean reference and has its own historical branch replay; it is not a second candidate-clean gate.

The implicated migration actually completed in the ancestor forward sequence at 13:33:49 and in the candidate clean replay at 13:36:17, progressing to the next migration in each case. The latter has the same preflight counts as the standalone clean job: 59 foundation inputs, 9 substitutions, 3 noncanonical exclusions, 20 interleaved artifacts, 961 canonical timestamped files. Its verified fingerprint is `9a0ecad…` at 13:36:44.5575335. The historical ancestor and later history-union branch each have their own `c70fa2…` fingerprint; those are not the candidate fingerprint. Final upgrade records include `UPGRADE_REPLAY: PASS` at 13:37:15.1864073 and `HISTORY_UNION_UPGRADE: PASS` at 13:40:19.7900562. These successful real paths corroborate the absence of a deterministic migration failure but do not replace the cancelled full clean-job release check or its unfinished native/browser phases.

## Custody, retained ownership, and operational continuation

The complete connector payloads are retained only in this review session's `functions.store`; raw credentials/environment output is not written or printed. Hashes below are over the decoded log strings encoded as UTF-8, not downloaded artifact ZIPs:

| Retrieved log | UTF-8 bytes | SHA-256 |
| --- | ---: | --- |
| Original live clean prefix | 2115892 | `08faab39ea37c62b61bb8013dad4fd58a4908e572ef8116338cd1c6117d3e048` |
| Final original cancelled clean job | 2705090 | `801707b25c9957ee9e3222b8be2d34a913d925f2eaa396d05f0a58bbd56e26d7` |
| Successful upgrade job | 6909464 | `5f7c28db8914a6d3b2ba5751b9f1267c8427962a02704c487c554a3cbf3d0d30` |

The separate ownership scout reports the complete current ownership evidence retains TR05/TR10 correction/retry source with #503 (historical claim `5305985815040`, branch `codex/ediel-tr05-recovery-20261004`), and explicitly retains canonical migration-manifest/schema/types/capture with #503 (`5305995480621`). Its fresh #503 status does not release that interface. The review allocates no production or pipeline ownership to the AT-P04 test-only work.

Parent reports it requested cancellation of only its own exact-head OPS run at 13:55:46, accepted the final-log correction, withdrew the false migration-stall account, and at approximately 13:58 requested a retry of only the same existing clean job after terminal cancellation. These actions were performed by parent, not this reviewer. This is operational recovery of a cancelled check on unchanged source, not a source fix, new harness, gate bypass, or evidence that the original run failed. The original cancelled history and successful sibling checks must remain attributable; any retry receives its own attempt/job/log/artifact provenance and cannot overwrite the original conclusion.

Next evidence is the same existing job's actual retry status, completed phase records and final native/JUnit/browser/artifact gates. A new fetched prefix's lack of later output must again be treated as a visibility limit until corroborated by fresh job state and eventual complete logs. If an actual SQL wait or timeout is later observed, retained #503 owns any canonical-stack diagnosis/changes, with actual query/wait/blocker evidence required before assigning a SQL cause. There is no confirmed defect to hand off for repair from this cancelled attempt, and no whole-clean/native/current-head merge approval is issued here.
