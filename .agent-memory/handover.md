# Handover

Updated: 2026-08-14

Branch `cursor/codebase-health-and-stability-3943` closes post-`8deb9435`
health residuals after the canonical go-live admin UX landed on main.

Main tip `8deb9435` clarified the superadmin API-client form as the
canonical provision/revalidate path, but left unmerged `#131`/`580a`
residuals open and still exposed a misleading generic Aktivera control
for paused `tenant_website` clients. Credential rotation also replaced
metadata wholesale.

This branch:

1. Ports `#131` UTILTS `transaction-<n>` identity, circuit success-telemetry
   isolation, durable `db:types:gen`, ops-hardening gates, and
   `20260814140000` receipt_ready metadata binding.
2. Hides tenant_website Aktivera in the admin list and fail-closes the
   status action with an explicit canonical go-live message.
3. Merges rotation markers into existing client metadata so
   `provisioning_receipt_id` / `go_live_flow` survive key rotation.

Prefer merging `3943`, then closing superseded open health PRs
`#131`/`#127`/`#125`/`#122`/`#121`/`#120`/`#119`/`#117`/`#115`/`#113`
rather than rebasing those older branches.

ggshield was unavailable in this environment; run secret scan in CI/host.
Live DB apply of `20260814140000` was not observed in this run.
