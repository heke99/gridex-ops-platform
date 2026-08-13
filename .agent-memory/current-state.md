# Current state

Updated: 2026-08-13

## Ediel production-engine audit

- Baseline: `main@e44b13f9`; active branch `agent/ediel-production-engine-20260813`.
- Live dev UTILTS rule packs now separate guide `25-A-3` / future `25-A-4` from association `E5SE5A`; current window starts 2025-06-01 and future remains inactive until 2026-10-01.
- Canonical UTILTS object/aggregate/request semantics are aligned in TypeScript and DB profile metadata. Aggregate inbound request evaluation no longer forces a metering-point match.
- Production verdict remains **NOT READY**: live canonical field rules contain only one UTILTS row for E66 and one for E31, and aggregate/forecast domain persistence plus transaction-level partial-success evidence are incomplete.
- Do not merge this branch to `main` until the blockers in `quality/ediel-production-engine-2026-08-13/initial-audit.md` are closed.

## Source truth

- Repository: `heke99/gridex-ops-platform`.
- Default branch: `main` at `b443bfea` (#110 auth outage + cron safety).
- Active health branch: `cursor/codebase-health-and-stability-0f25`.

## Tip review after #110

Confirmed residuals addressed on `0f25`:

1. CRITICAL — #108 still granted reconciliation EXECUTE to `authenticated`.
   Forward migration `20260811114500` (from #109) cherry-picked onto post-#110 tip.
2. MEDIUM — login/update-password `?error=` flash phishing surface allowlisted.
3. MEDIUM — next-path helpers now reject backslash/NUL open-redirect shapes.
4. LOW — cron regression asserts no `environment=test` query anywhere in vercel crons.
5. LOW — update-password auth client init wrapped in outage boundary.

Open #109 remains the pre-#110 vehicle for the same security residual; `0f25`
is the tip-based superseding branch after #110 merged.

## Verification executed on `0f25`

- `vitest` auth-outage-cron-production-safety: 12/12 PASS
- `gridex:post-108-health-residuals-regression`: PASS
- `check-migration-versions`: PASS
- `check-supabase-generated-types`: PASS
- `tsc -p tsconfig.app.json`: PASS
- ggshield: BLOCKED (CLI not installed)
