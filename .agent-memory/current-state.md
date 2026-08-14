# Current state

Updated: 2026-08-14

## Tip health after Go Live + tenant lifecycle consistency

- Main tip: `6f171011` (`Merge Go Live and tenant lifecycle consistency`).
- Active health branch: `cursor/codebase-health-and-stability-31d1`.
- Open `#132` on `3943` was still based on `8deb9435` and not merged; residuals
  were replayed onto the lifecycle tip on `31d1`, plus new tip findings.

## Residuals closed on `31d1`

1. HIGH — UTILTS null IDE+24 disposition/ACK/profile identity join (from #132)
2. MEDIUM — Circuit success telemetry fail-closed over completed dependency calls
3. MEDIUM — Durable `db:types:gen` + ops-hardening gates for disposition/circuit
4. HIGH — `receipt_ready` unbound to metadata receipt after revalidation
   (`20260814140000`, from #132)
5. MEDIUM — Generic Aktivera for paused `tenant_website` clients (from #132)
6. MEDIUM — Rotation metadata wipe dropping go-live keys (from #132)
7. HIGH (NEW on lifecycle tip) — `setCompanyOperationalStatusAction` could set
   `deleted_test_only` without history blockers
8. MEDIUM (NEW on lifecycle tip) — `assertUserCanOperateCompany` treated paused
   visibility as enough for tenant mutations

## Verification executed on `31d1`

- vitest lifecycle + go-live + UTILTS disposition/persistence + circuit: 44/44 PASS
- `gridex:post-332-field-511-health-residuals-regression`: PASS
- migration integrity: PASS (432 files)
- `tsc -p tsconfig.app.json`: PASS
- `security:audit-production`: PASS (0 vulnerabilities)
- ggshield: BLOCKED (CLI not installed)

## Intentionally not changed

- Applied go-live migrations `20260814125600` / `20260814133500` (immutable).
- Official UTILTS matrices / TGT-AGT evidence remain external blockers.
- Open `#132` and older health PRs remain pre-`6f171011` vehicles; close as
  superseded after `31d1` merges.
