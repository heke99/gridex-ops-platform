# Current state

Updated: 2026-08-12

## Source truth

- Repository: `heke99/gridex-ops-platform`.
- Default branch: `main` at `b8742591` (#114 production remediation v5).
- Active health branch: `cursor/codebase-health-and-stability-5dfb`.

## Tip review after #114

Confirmed residuals addressed on `5dfb`:

1. HIGH — post-#112 auth-callback verification messages were still rejected by
   the login error allowlist on tip (open #113 / `60b7` not merged). Replayed
   allowlist + callback constants onto post-#114 tip.
2. MEDIUM — login `?message=` success flash still unsanitized on tip.
   Added `sanitizeLoginSuccessFlash` and fixed invite/password success copy.
3. MEDIUM — proxy still used weaker local `normalizeNextPath` vs shared
   `getSafeNextPath` (including encoded backslash rejection via urls +
   authEmailFlow decode alignment).
4. LOW — disabled-session `signOut` outage could block account_disabled redirect.
5. LOW — #114 SVK reconciliation retry/API/cron ordering lacked regression lock;
   extended `gridex-ops-health-regression.cjs`.

Already correct on main via #114:

- Health v5 service-role boundary and role-aware counts.
- Grid-owner identifier normalization v3.
- SVK promote-then-reconcile with `failed_retryable` retry path.

## Verification executed on `5dfb`

- `vitest` auth-outage-cron-production-safety: 18/18 PASS
- `gridex-ops-health-regression.cjs`: PASS
- `gridex-ops-post-108-health-residuals-regression.cjs`: PASS
- `check-migration-versions`: PASS
- `check-supabase-generated-types`: PASS
- `tsc -p tsconfig.app.json`: PASS
- ggshield: BLOCKED (CLI not installed)
