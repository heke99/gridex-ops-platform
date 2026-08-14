# Handover

Updated: 2026-08-14

Branch `cursor/codebase-health-and-stability-580a` closes tip residuals after
main merged canonical tenant website go-live hardening (`2c5a8c0f`).

Unmerged `#127` (`8738`, based on `c2adf6a0`) still held UTILTS null-id
identity, circuit success telemetry isolation, durable `db:types:gen`, and
ops-hardening gates. Those commits were cherry-picked onto the go-live tip.

NEW go-live residual: `authenticate_integration_request_v1.receipt_ready`
accepted any completed `tenant_website_installation_receipts` row for the
api_client_id. After revalidation with a new idempotency key, an old completed
receipt could keep authorizing normal API traffic once launch_ready returned.
Forward migration `20260814140000_tenant_website_receipt_ready_binding.sql`
requires the metadata `provisioning_receipt_id` match when present, and keeps
legacy any-completed-receipt behavior only while that metadata key is null.

Prefer merging `580a`, then closing superseded open health PRs
`#127`/`#125`/`#122`/`#121`/`#120`/`#119`/`#117`/`#115`/`#113` rather than
rebasing those older branches.

ggshield was unavailable in this environment; run secret scan in CI/host.
Live DB apply of go-live + receipt-binding migrations was not observed in this
run.
