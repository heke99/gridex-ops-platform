# Current state

Updated: 2026-08-13

## Source truth

- Repository: `heke99/gridex-ops-platform`.
- Default branch: `main` at `e44b13f9` (#116 Supabase security/performance remediation).
- Active health branch: `cursor/codebase-health-and-stability-a855`.

## Tip review after #116

Confirmed residuals addressed on `a855` (replayed from unmerged `#115`/`5dfb`):

1. HIGH — auth-callback verification errors rejected by login allowlist.
2. MEDIUM — unsanitized login `?message=` success flash phishing surface.
3. MEDIUM — proxy/authEmailFlow next-path weaker than shared helper (proxy now
   uses `getSafeNextPath`; email-flow decode aligns).
4. LOW — signOut outage before disabled-session redirect.
5. LOW — SVK retry-before-reimport ordering locked in health regression.

## #116 review notes (no code change this residual)

- RLS `TO public` on company_actor_test_runs / contact_channels matches prior
  PUBLIC default policy roles (false positive for widening).
- `20260813070046` is count-tolerant but still fails if end-state already
  present (v_count=0). Do not rewrite applied migrations; clone/re-apply risk
  remains an ops note.
- No production migration changes in this residual package.

## Verification executed on `a855`

- `vitest` auth-outage-cron-production-safety: 18/18 PASS
- `gridex-ops-health-regression`: PASS
- `gridex:post-108-health-residuals-regression`: PASS
- `check-migration-versions`: PASS
- `check-supabase-generated-types`: PASS
- `tsc -p tsconfig.app.json`: PASS
- ggshield: BLOCKED (CLI not installed)
