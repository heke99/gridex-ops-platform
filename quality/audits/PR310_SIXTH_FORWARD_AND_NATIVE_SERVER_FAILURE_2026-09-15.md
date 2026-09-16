# Actual sixth-forward qualification and native failure — 2026-09-15

The sixth forward is promoted only after actual PostgreSQL17 qualification and
official SupabaseCLI2.101.0 file creation. Neither proves full native acceptance.

- Head `dc011c008a198b3e848fbc9115c264e16bb25682`, tree `5f6f42d570c648a66a1df2651fd562a0b54a3f3c`.
- Run34983371102/job104429131362 SUCCESS; artifact10402835959.
- Downloaded ZIP SHA256 `6302804dc76fc4a64b6945aac9c310a0af055de0fc58b2c868cae41223ae6397` verified.
- Exact created file `20260915144319_restrict_ediel_send_lock_client_writes.sql`.
- SQL SHA256 `411df92fc01f8b84dd9a83600464594e76a4841d48928d52dfadfd97b3177705`.
- CLI receipt SHA256 `b742786f18c0625030d162432c43e54bd332918dba0f0470d2f6a063e966675e`.
- SQL proof SHA256 `abc8a1c76a2434ede3589079a49f9219f445ca2dba5dee8851aa47de8723f99f`.

The bounded fixture reproduces original direct INSERT/UPDATE and TRUNCATE
authority, then verifies42501 after the exact7privilege revoke. SELECT boundaries,
service operations, existing rows/catalog/policies and a labelled synthetic
definer mechanism are preserved. Shape, inherited/column authority, atomicity,
repeat and cleanup controls pass. Real Auth helpers and production RPC business
graphs are not executed in this isolated fixture. The source and caller decision
is `PR310_EDIEL_SEND_LOCK_CLIENT_WRITES_2026-09-15.md`; final restore RPC access is
service-only, as explicitly corrected there before qualification.

Six exact forwards follow the retained514timestamps. Current inventory607 and
FULL595 account the added files; historical601 hashes and all514timestamp pins
remain unchanged. Native ordinal6 now has actual post-body/ledger-fault boundary
assertions; full six-forward execution is still required.

Short native run34983371143/job104429130148 on the same head fails after fixture
setup and the session matrix. The anon check expects42501 but receives psql exit2,
SERVER_CONNECTION_CLOSED, no primary SQLSTATE. Subsequent clone identity lookup
receives psql exit2 and DATABASE_RECOVERY. This is not evidence of an authorization
predicate defect and must not be treated as a passing negative SQL control.
Outer owned-resource/private-workspace cleanup is true; individual clone cleanup
cannot complete through the recovering connection. The follow-up captures only
fixed marker categories from at most200owned-server log lines; marker presence
does not itself establish cause or current server readiness.

Portable run34981240448/job104421807074 separately completes144+514+5 and all2496
real-helper actor cases. Its independent schema remains unequal. Thirty-one exact
source-query view witnesses are now wired before both independent comparisons;
offline parser/ownership/preservation tests and independent review pass, while
actual PostgreSQL witness execution remains pending.

Constraint review found the actual reconstructed auth email action domain remains
seven values because historicalQ restores its saved first43checks. Active callers
need the later source-authored11domain; a separate forward candidate is required.
The earlier15module mocks exercised intended11, not the full-schema7constraint.
No reference, historical auth SQL, type manifest or acceptance flag was refreshed.
