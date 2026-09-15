# PR310 — native diagnostic transport correction, 2026-09-15

Status: IMPLEMENTED_LOCAL_TESTS_PASS. NOT PUSHED. NATIVE RESULT NOT VERIFIED.

## Source and preservation

Repository: heke99/gridex-ops-platform; PR310; branch
codex/gridex-parity-remediation-20260905; target main.
Source head: 43efaf895aaf080abadef84ce724bceafa3e3a79.
Exact imported tree: 354d5295c392e15cdb741998b3b3451530e67506.
The source.tar.gz checksum and Git write-tree match the downloaded receipt.
The local Git baseline is an archive import, NOT the original commit history.
GitHub still reports PR310 open, draft and not merged. Its prior changes are
published; the separately read-back backup ref
backup/pr310-20260915-d8ace45c points to d8ace45ceedc29ef911352f249967d378fd3351a.
The current connector has no push/merge action. No remote ref was changed.

## Latest native evidence

Run34946750789 / artifact10388556488 executes144 regular foundation inputs and
five residual inputs. Six groups are verified; residual144 (group7) stops in
TRANSACTION_QUALIFICATION on the portable55000 control atR071. The report
contains SQLSTATE55000 and stageR071, but no fixed reason. The exact required
reason must not be inferred from those two fields. Cleanup is verified; full
replay, timestamp execution, complete schema acceptance and types are false.

## Reproduced transport defect and minimal correction

The previous SQL wrapper puts DB2_INVITATION_INDEX_OWNED_DATABASE_REQUIRED only
in HINT. pgconn.PgError.Error() renders severity, primary Message and SQLSTATE,
not Hint. Therefore the ordinary CLI error representation loses that evidence.
The old tests fabricated a HINT-containing transport record and missed this.

The wrapper now puts the same finite reason in the primary MESSAGE, but only
when both SQLSTATE55000 and the exact SQLERRM match. All other source messages
remain redacted. The error code and stage remain unchanged. HINT is retained.
The parser accepts the reason only from one complete primary ERROR line with
both R071 and55000. Quoted SQL excerpts, an extra token suffix, a wrong stage,
a wrong SQLSTATE, arbitrary messages or multiple primary errors cannot supply
this reason. No target admission, grant, policy, rollback check, source pin,
index preimage check, CLI ledger or final release requirement was relaxed.

This fixes a reproduced diagnostic defect, NOT proof that the latest55000
was the intended exception. A new actual native run is still mandatory.

## Auth boundary — located, not guessed or marked fixed

Auth artifact10387362854, checkout1fb4f1577f342c126a1dea0f39ab0048c8bcb9f8,
identifies command15, scripts/canonical-full-governance-source-selftest.py.
Its source SHA256 is c65ae806e179e992affc021062188f6c137ebd02bb98c7adf5128ea806c4ac6a,
which matches this source tree. The traceback reaches full_empty_lane line205,
psql_sql(oracle.complete_postflight_sql()), then the SQL return-code assertion
at line55. Observed SQLSTATE is P0001; the redacted artifact does not identify
which postflight assertion failed. This is not evidence of a specific missing
auth table, a login defect, or permission to grant broader rights.

The local full-governance execution could not start: psql is not installed.
No native Docker/PostgreSQL runtime or hosted replacement was used.
A source-review follow-up is the completion_shape_sql journal relacl IS NULL
expectation versus the bootstrap's explicit managed table default grants.
That discrepancy must be investigated against executed postflight evidence;
it is NOT asserted to be the first CI failure and has NOT been auto-approved.

## Executed verification

- Before correction:27 existing foundation tests PASS.
- RED:32 tests ran, with4 assertion failures and1 execution-control error.
  Realistic primary-error fixtures exposed the missing reason and a quoted-SQL
  false-positive case before the implementation changed.
- After correction:32 foundation tests PASS.
- Aggregated native-prefix/control suite:163 tests PASS (includes the32 above).
- Native lifecycle offline controls:15 tests PASS.
- Preserved auth-evidence tests:16 tests PASS. These do NOT certify auth SQL.
- Migration integrity:601 files /505 version groups, all checksums PASS.
- git diff --check:PASS.

No full native SQL run, independent schema reconciliation, full auth SQL pass,
type regeneration, mandatory same-head CI/E2E or independent review is claimed.

## Exact next action, without rebuilding old work

Apply this patch once to the exact source head/tree. Publish it on the existing
PR310 branch using a writable Git environment. Run the ordinary native job and
read residual144's exact reason and all negative/ledger/repeat controls. Then
finish source-admitted timestamps through the real CLI ledger, independent
schema reconciliation, actual auth postflight correction, genuine generated
types and all mandatory same-head CI/E2E/review. Merge the ENTIRE PR only after
those gates pass. No cherry-picking a subset, force update or bypass is allowed.

## Review and skill routing

Activated systematic-debugging, test-driven-development,
verification-before-completion, Supabase guidance and differential review.
No application, tenant API, UI, historical SQL, production schema, migration
manifest or generated types changed. UI/performance/deployment skills were not
triggered. Review here is self-review; no independent reviewer is claimed.

Primary references checked:
- https://github.com/jackc/pgx/blob/v5.7.2/pgconn/errors.go
- https://www.postgresql.org/docs/17/plpgsql-errors-and-messages.html
The Supabase changelog.md fetch failed; no provider/CLI version was changed.

## Publication continuation

The current GitHub connection now exposes writer actions. The saved patch was
reused, not rebuilt, and all32 focused foundation tests passed again. This
publication includes the two byte-identical tested code files and this receipt.
Remote commits must retain43efaf89 as parent, preserve the rest of its tree,
and update only the existing PR310 ref without force. Read back the resulting
commit/tree before treating it as published; ordinary native CI remains pending.
The earlier read-only/local-only statements above describe the prior session.
