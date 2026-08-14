# Handover

Updated: 2026-08-14

Branch `cursor/codebase-health-and-stability-31d1` closes post-`6f171011`
health residuals after the Go Live actor-context and tenant lifecycle
consistency merge landed on main.

Main tip `6f171011` fixed go-live readiness actor context and centralized
company lifecycle transitions, but left unmerged `#132`/`3943` residuals open
and introduced two incomplete enforcement gaps around test deletion and
paused-tenant write paths.

This branch:

1. Ports UTILTS null IDE+24 shared transaction identity across disposition,
   persistence, ACK, and profiles.
2. Makes dependency-circuit success telemetry best-effort (not fail-closed).
3. Adds durable `db:types:gen` + ops-hardening gates for UTILTS/circuit.
4. Forwards `20260814140000` receipt_ready metadata binding with legacy
   null-metadata fallback.
5. Blocks generic Aktivera for `tenant_website` and merges rotation metadata.
6. Refuses `deleted_test_only` via `setCompanyOperationalStatusAction`.
7. Requires writable lifecycle status in `assertUserCanOperateCompany` for
   non-platform admins (paused stays read-only).

Prefer merging `31d1`, then closing superseded open health PRs
`#132`/`#131`/`#127`/`#125`/`#122`/`#121`/`#120`/`#119`/`#117`/`#115`/`#113`
rather than rebasing those older branches.

ggshield was unavailable in this environment; run secret scan in CI/host.
Live DB apply of `20260814140000` was not observed in this run.
