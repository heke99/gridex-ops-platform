# Current state

Updated: 2026-08-13

## Tip health after #124 merge

- Main tip: `ca28cb0a` (`fix(health): close post-#123 tip residuals on 13b2 (#124)`).
- Active health branch: `cursor/codebase-health-and-stability-9807`.
- Hosted CI for `#124` succeeded on the PR and main verify job; tip review found
  a remaining UTILTS null IDE+24 disposition/ACK attribution gap that #124 did
  not finish.

## Residuals closed on `9807`

1. HIGH — Null IDE+24 profile/runtime issues used synthesized `transaction-N`
   refs while dispositions matched only raw null ids, producing false
   accepted/positive-APERAK outcomes; shared identity module + disposition/
   issue/ACK synthesis closes the join
2. MEDIUM — Fallback per-txn APERAK targets dropped null IDE+24 groups
3. MEDIUM — Typegen docs/process still taught a path without nullability
   overrides; `db:types:gen` now applies overrides after typegen
4. LOW — Disposition/persistence vitest now gated in ops-hardening verify

## Verification executed on `9807`

- vitest auth-outage + UTILTS disposition/persistence: 52/52 PASS
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
- Admin-only flash banners and navigation-mode same-origin escape remain
  deferred as previously classified likely FP / authenticated-only.
- Open `#122` and older health PRs remain pre-`ca28cb0a` vehicles; close as
  superseded after `9807` merges.
