# Current state

Updated: 2026-08-13

## Tip health after #123 merge

- Main tip: `3cad481b` (`fix(health): close post-2eb61986 tip residuals (#123)`).
- Active health branch: `cursor/codebase-health-and-stability-13b2`.
- Hosted CI for `#123` completed successfully on main, but tip review found
  residuals that either regressed during the squash/types regen or were never
  covered by the auth-only hardening package.

## Residuals closed on `13b2`

1. HIGH — Field-511 resolver Returns nullability overwritten by types regen;
   durable post-gen override + clean-replay/CI gate restored
2. HIGH — Public `/teckna-avtal` rendered raw `?message=` and redirected
   `error.message` (phishing + provider leak)
3. MEDIUM — Portal `/portal/komplettera` rendered raw blocked `?message=`
4. MEDIUM — Proxy set `reason=account_disabled` but login ignored it
5. MEDIUM — Dual `getSafeNextPath` implementations (urls vs authEmailFlow)
6. MEDIUM — UTILTS tenant match builder kept null IDE+24 refs, so synthesized
   persistence ids could not join metering-point matches
7. MEDIUM — post-332 residual regression was not gated in ops-hardening

## Verification executed on `13b2`

- vitest auth-outage + UTILTS disposition/persistence: 50/50 PASS
- `gridex:post-332-field-511-health-residuals-regression`: PASS
- ops health: PASS
- `ediel:utilts-reason-regression`: PASS
- `db:types:check`: PASS (nullable Returns + sha `2111c2c6...`)
- `security:audit-production`: PASS (0 vulnerabilities)
- `tsc -p tsconfig.app.json`: PASS
- ggshield: BLOCKED (CLI not installed)

## Intentionally not changed

- Applied field-511 import migration `20260813210500` (immutable).
- Official UTILTS matrices / TGT-AGT evidence remain external blockers.
- Open `#122` and older health PRs remain pre-`3cad481b` vehicles; close as
  superseded after `13b2` merges.
