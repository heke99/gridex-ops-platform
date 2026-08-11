# Handover — post-#108 health residuals

Updated: 2026-08-11

Branch: `cursor/codebase-health-and-stability-1848` (from `main@38d55dc7` / `#108`).

## What changed

Forward migration `20260811114500_post_108_health_security_residuals.sql`:

- Revokes `authenticated` EXECUTE on
  `canonical_run_architecture_reconciliation` and restores service-role-only
  grants (cron path already uses `supabaseService`).
- Replaces the reconciliation function with success-path `check-error:*`
  clears (count=`0`) for every current check, and drains the renamed legacy
  finding key `due-stranded-canonical-outbox`.
- Revokes PUBLIC (and anon) on readiness surfaces; keeps authenticated SELECT
  on `actor_readiness_status` for `gridex_verified_grid_owners_v`.

Static regression:
`scripts/gridex-ops-post-108-health-residuals-regression.cjs`, wired into OPS
hardening CI and the remaining-masterpoints golden path.

## Do not

- Reuse migration timestamp `20260810230000` from open PR `#106` — tip advanced
  past it via `#108`.
- Re-grant reconciliation EXECUTE to `authenticated` without a tenant authz
  gate inside the SECURITY DEFINER body.
- Fabricate identities for manual-review ownership; operational owner text is
  intentional.

## Next

Open/merge the tip residual PR; close/supersede `#106`; apply the forward
migration on connected environments after CI green.
