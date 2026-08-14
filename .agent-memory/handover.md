# Handover

Updated: 2026-08-14

Branch `cursor/codebase-health-and-stability-9740` closes post-`fbb8e617`
(#135 tip health) second-order residuals around the tenant website activation
guard.

Main tip `fbb8e617` bound receipt_ready, blocked generic Aktivera for
tenant-website clients, fixed UTILTS null-id identity, circuit telemetry,
lifecycle operate/status guards, and rotation metadata merge. Tip hunt after
merge found:

1. Company lifecycle resume (`paused → active`) re-activates launch-ready
   `tenant_website` clients paused with `lifecycle_paused_by_tenant`, but the
   activation guard still demanded provisioning preflight blockers — deadlocking
   resume.
2. `updateIntegrationApiClientPermissionsAction` always wrote
   `profile_key=tenant_website` while leaving `status=active`, skipping the
   guard (`old.status=active`) for non-canonical clients.
3. UI/server tenant-website classifiers were duplicated and could drift again.

This branch:

1. Adds forward `20260814180000` lifecycle-resume exemption when old metadata
   has `lifecycle_paused_by_tenant`, `launch_ready` stays true, canonical
   go-live metadata remains, and a completed binding receipt exists.
2. Forces `paused` +
   `TENANT_WEBSITE_PERMISSIONS_REQUIRE_CANONICAL_GO_LIVE` when promoting an
   already-active non-canonical client via permissions.
3. Shares `lib/integrations/tenantWebsiteClient.ts` between page and actions.

ggshield was unavailable in this environment; run secret scan in CI/host.
Live DB apply of `20260814180000` was not observed in this run.
