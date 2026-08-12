# Current state

Updated: 2026-08-12

## Source truth

- Repository: `heke99/gridex-ops-platform`.
- Default branch: `main` at `929f4650` (#112 production convergence).
- Active health branch: `cursor/codebase-health-and-stability-60b7`.

## Tip review after #112

Confirmed residuals addressed on `60b7`:

1. HIGH — auth-callback verification errors were rejected by the post-#111/#112
   login `?error=` allowlist, so expired/missing-code flows showed a false
   outage flash. Allowlisted via shared constants and callback uses them.
2. MEDIUM — login `?message=` success flash was unsanitized (phishing). Now
   allowlisted; company-invite uses a fixed success string.
3. MEDIUM — `proxy.ts` local `normalizeNextPath` was weaker than
   `getSafeNextPath` (encoded backslash shapes). Proxy now reuses the shared
   helper.
4. LOW — disabled-session `signOut` outages could throw before redirect; now
   try/catch and still redirect with `account_disabled`.
5. LOW — update-password success redirect now appends `message` safely when
   `next` already contains a query string.

Already correct on main via #112:

- Reconciliation EXECUTE service-role only (`20260811155851`).
- O-008 readiness PUBLIC residual closed.
- OPS health v4 live-route qualification (`20260811155412`).
- Middleware fail-closed on auth infrastructure outages.

## Verification executed on `60b7`

- `vitest` auth-outage-cron-production-safety: 18/18 PASS
- `gridex:post-108-health-residuals-regression`: PASS
- `check-migration-versions`: PASS
- `check-supabase-generated-types`: PASS
- `tsc -p tsconfig.app.json`: PASS
- ggshield: BLOCKED (CLI not installed)
