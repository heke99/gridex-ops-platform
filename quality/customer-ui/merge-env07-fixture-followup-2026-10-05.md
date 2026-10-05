# PR #608 ENV-07 fixture follow-up — 2026-10-05

CI on e13fe254f680c96d2351cfdf4a426d67a41feefd ran 856 test files:855 passed and one failed;11133 tests passed and three failed. All three failures are in `__tests__/ediel-env07-outbox-separation.test.ts`. The tagged masterplan gate reports the same fixture failures. No merge occurred.

Main's send consumer now checks the worker lease before dispatch. The existing claim mock set `status` and `locked_by`, but omitted `locked_at`; the real `claim_ediel_outbox_items` SQL sets `locked_at = now()` in `20260615_multitenant_integrity_and_claim_locks.sql`. The mock now sets one current ISO timestamp for the claimed batch. Root independently compared the diff against the SQL and send-consumer lease guard.

The same separation, immutable interchange, foreign-tenant/environment refusal, no-submission and no-effects assertions remain. No runtime, migration, grants, security threshold, coverage approval or masterplan tags changed. The existing agent reproduced all three failures before the edit; after the edit,29 tests in three files pass, including expired/missing/invalid/future lease rejection and ACK retry safety. Root scoped lint, tests TypeScript and diff check pass (exit0).

The initial local full tagged gate did not produce a Vitest JSON report and exited1 before a result could be evaluated. Its log is retained; it is not a passing run. The repeat with supported `VITEST_MAX_WORKERS=2` also exits1 without a readable JSON report. Neither local full-gate attempt is recorded as green. The agent investigates the local reporter separately; final-head GitHub targeted-regressions runs the full gate before merge. Tests, assertions and timeouts remain unchanged.

Evidence: `merge-env07-red.log`, `merge-env07-targeted-green.log`, `merge-env07-lint.log`, `merge-env07-tagged-initial.log`, `merge-env07-tagged-limited.log`, `merge-env07-test-types.log`. Final-head CI, including the full tagged gate, remains required before the authorized main merge.
