# Handover

Updated: 2026-08-14

Branch `cursor/codebase-health-and-stability-b4c7` closes post-`2afe1db8`
(#134 tenant RLS + go-live) tip residuals, including the unmerged `31d1`
package and one new tip gap.

Main tip `2afe1db8` hardened Data API lifecycle RLS and simplified go-live UX,
but left receipt binding, UTILTS null-id identity, circuit telemetry,
lifecycle operate/status guards, rotation metadata merge, and durable typegen
gates open. #134 also introduced an UI/server mismatch where
`isTenantWebsiteClient` includes scope heuristics while status activation only
checked `profile_key`.

This branch:

1. Shares UTILTS `transaction-<n>` identity across disposition/persistence/ACK/profiles.
2. Isolates circuit success telemetry from dependency results.
3. Adds forward `20260814170000` receipt_ready metadata binding (legacy null fallback).
4. Blocks crafted tenant website activation in the status action (profile + scopes).
5. Merges rotation metadata instead of replacing it.
6. Refuses `deleted_test_only` on the generic status action.
7. Requires writable company status in `assertUserCanOperateCompany`.
8. Restores `db:types:gen` nullability overrides and ops-hardening vitest gates.

Prefer merging `b4c7`, then closing superseded open health PRs rather than
rebasing those older branches.

ggshield was unavailable in this environment; run secret scan in CI/host.
Live DB apply of `20260814170000` was not observed in this run.
