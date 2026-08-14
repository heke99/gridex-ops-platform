# Current state

Updated: 2026-08-14

## Tip health after go-live admin UX merge

- Main tip: `8deb9435` (`Merge canonical tenant go-live admin UX`).
- Active health branch: `cursor/codebase-health-and-stability-3943`.
- Supersedes open `#131` on `580a` as the merge vehicle.

## Residuals closed on `3943`

1. HIGH — UTILTS null IDE+24 identity join (ported from #131)
2. MEDIUM — Circuit success telemetry fail-closed (ported from #131)
3. MEDIUM — Durable `db:types:gen` + ops-hardening gates (ported from #131)
4. HIGH — Unbound `receipt_ready` after revalidation (ported migration
   `20260814140000`)
5. LOW — Idempotency-Key invalid message alignment (ported from #131)
6. MEDIUM — Admin list still offered generic Aktivera for paused
   `tenant_website` clients despite canonical go-live copy; UI guidance +
   server-action fail-closed added
7. MEDIUM — Latent `rotateIntegrationApiClientTokenAction` metadata wipe of
   `provisioning_receipt_id` / `go_live_flow` (merge instead of replace)

## Verification executed on `3943`

- vitest go-live + UTILTS disposition/persistence + circuit: 32/32 PASS
- `gridex:post-332-field-511-health-residuals-regression`: PASS
- migration integrity PASS (432)
- generated types PASS (sha `7df58d04...`, tip `20260814140000`)
- production npm audit PASS (0)
- `tsc -p tsconfig.app.json` PASS
- ggshield: BLOCKED (CLI not installed)

## Intentionally not changed

- Applied go-live migrations `20260814125600` / `20260814133500` (immutable).
- Official UTILTS matrices / TGT-AGT remain external.
- Open `#131` and older health PRs remain pre-`8deb9435` vehicles; close as
  superseded after `3943` merges.
