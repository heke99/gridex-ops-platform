# Current state

Updated: 2026-08-13

## Post-#118 health tip

- Main tip reviewed: `fd84b15a` (#118 fail-closed UTILTS transactional persistence).
- Active health branch: `cursor/codebase-health-and-stability-312d`.
- Replayed open `#117` auth flash / next-path / SVK retry residuals onto the tip.
- Confirmed UTILTS residuals fixed on `312d`:
  1. HIGH — mixed guide+processability ACK plans dropped `aperakApplicationErrors`.
  2. HIGH — null transaction ids synthesized only in SQL, causing ACK finalization throw / remap miss.
- Intentionally deferred: observation `readingAt` still null in persist payload (series period retained); external UTILTS matrices/tuples/TGT-AGT evidence remain source-blocked.

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
