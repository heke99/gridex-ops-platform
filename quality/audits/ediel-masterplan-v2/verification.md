# Verification — Ediel masterplan v2 first repair batch

Date:2026-09-15. Baseline:b9f732d28ceaf090e3b984e71d13a9cbd27f6408. Commands ran locally with locked dependencies; final Vitest and TypeScript commands used Node22.23.2.

| Check | Result | Boundary |
| --- | --- | --- |
| Original package lengths/SHA256 | PASS,33 files | specification integrity only |
| Baseline Vitest --maxWorkers=2 | PASS,212 files/2080 tests | original PR310 head |
| Final Vitest --maxWorkers=2 | PASS,218 files/2127 tests | all discovered application unit suites; no live market traffic |
| TypeScript tsconfig.tests.json | PASS | initial temporary reviewer fixture error removed; final permanent tests compile |
| TypeScript tsconfig.app.json | PASS | final source compile |
| Protocol consolidation typecheck | PASS (protocol worker) | protocol module boundary |
| Protocol independent review | APPROVED after version-validator/DOC fixes | 47 independent focused tests; downstream projection/full grammar not certified |
| UTILTS independent review | APPROVED | shared policy/date,18 focused tests; full normative time-anchor selection not certified |
| DSN independent review | APPROVED after nested/legacy bypass fixes |13 focused tests, original bypass repros now rejected |
| SMTP independent review | APPROVED |16 tests including actual transport post-acceptance errors and attempt fence |
| git diff --check | PASS | whitespace |
| scripts/ediel-rule-regression.cjs | FAIL on BOTH baseline and repaired tree | static PRODAT RFF_LI_MISSING regression at line133; retained unchanged, not waived |
| Native replay/schema/types/E2E | OPEN | inherited PR310 gates; no main-merge acceptance |
| Full121-rule/231-acceptance conformance | NOT COMPLETE | ledger retains unverified/partial scope |
| GitGuardian ggshield | NOT RUN,CLI unavailable | no secret-scan completion claimed |

The separate rule regression failure was reproduced on a detached pristine b9f732d2 worktree using the same dependencies and Node22, not inferred from historical notes. It requires source/contract reconciliation; this patch does not hide it.

The initial final-tests typecheck caught a temporary reviewer reproduction fixture cast; the reviewer removed that temporary file after permanent regressions covered the same cases. A fresh tests typecheck then exited0.

No generated database types or migration manifest refreshed. No tests or rules marked universally accepted from the specification import. No Supabase mutation or live Ediel send was performed.

Publication: draft PR311, code commit b06dc9f60af32e99902baf6cf89923b329b95a18. GitHub-created tree10c8ea77104f01273582be78ff3ab1b2fb750e6f exactly matches the local tested tree, and fetched-content diff was empty. Terminal Git push lacked credentials; GitHub connector publication succeeded. Remote CI began; completion remains to be inspected.
