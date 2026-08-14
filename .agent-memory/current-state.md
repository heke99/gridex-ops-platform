# Current state

Updated: 2026-08-14

## Tip health after #134 merge

- Main tip: `2afe1db8` (`Merge PR #134: harden tenant RLS and simplify go-live`).
- Active health branch: `cursor/codebase-health-and-stability-b4c7`.
- Hosted CI for `#134` landed RLS lifecycle guards + single-path go-live UX, but
  unmerged `31d1` residuals and one new tip gap remained open.

## Residuals closed on `b4c7`

1. HIGH — UTILTS null IDE+24 identity join (shared `transactionIdentity`)
2. MEDIUM — Circuit success telemetry fail-closed
3. HIGH — Unbound `receipt_ready` after revalidation
   Forward migration `20260814170000_tenant_website_receipt_ready_binding.sql`
4. HIGH — Generic Aktivera / status activation for tenant website clients
   (UI + server; server also covers scope-heuristic clients from #134)
5. MEDIUM — Rotation metadata wipe
6. HIGH — `deleted_test_only` via generic status action
7. MEDIUM — Paused company write via `assertUserCanOperateCompany`
8. MEDIUM — Durable `db:types:gen` + ops-hardening gates

## Verification executed on `b4c7`

- vitest lifecycle + go-live + UTILTS disposition/persistence + circuit + RLS UI: 51/51 PASS
- `gridex:post-332-field-511-health-residuals-regression`: PASS
- `db:migrations:check`: PASS (433 files)
- `security:audit-production`: PASS (0 vulnerabilities)
- `tsc -p tsconfig.app.json`: PASS
- ggshield: BLOCKED (CLI not installed)
- hosted CI: NOT YET

## Intentionally not changed

- Applied RLS migration `20260814162500` (immutable).
- Official UTILTS matrices / TGT-AGT remain external.
- Open `#132` and older health PRs remain pre-`2afe1db8` vehicles; close as
  superseded after `b4c7` merges.
