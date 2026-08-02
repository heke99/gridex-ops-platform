# Canonical preflight report

Read-only query against `gridex-ops-dev` on 2026-08-02:

| Check | Rows | Result |
|---|---:|---|
| noncanonical company status | 0 | PASS |
| cross-tenant test run/message relation | 0 | PASS |
| test run messages missing company | 0 | PASS |
| test runs missing company | 153 | BLOCKED |
| active actor-profile duplicate groups | 1 | BLOCKED |
| prepared/live production without snapshot | 1 | BLOCKED |
| readiness rows already marked stale | 0 | PASS |

The preflight is read-only. No ambiguous tenant, profile or snapshot value was guessed.
