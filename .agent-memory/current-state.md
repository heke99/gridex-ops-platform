# Current state

Updated: 2026-08-14

## Tip health after tenant website go-live merge

- Main tip: `2c5a8c0f` (`Merge canonical tenant website go-live hardening`).
- Active health branch: `cursor/codebase-health-and-stability-580a`.
- Open `#127` on `8738` was still based on `c2adf6a0` and not merged; residuals
  were replayed onto the go-live tip on `580a`.

## Residuals closed on `580a`

1. HIGH — UTILTS null IDE+24 disposition/ACK/profile identity join (from #127)
2. MEDIUM — Circuit success telemetry fail-closed over completed dependency calls
3. MEDIUM — Durable `db:types:gen` + ops-hardening gates for disposition/circuit
4. HIGH (NEW on go-live tip) — `receipt_ready` accepted any completed receipt for
   the api_client_id; revalidation with a new idempotency key left stale
   completed receipts authorizing normal traffic. Forward migration
   `20260814140000` binds to metadata `provisioning_receipt_id` when present,
   with legacy null-metadata fallback.

## Verification executed on `580a`

- vitest go-live + UTILTS disposition/persistence + circuit: 30/30 PASS
- `gridex:post-332-field-511-health-residuals-regression`: PASS
- migration integrity: PASS (432 files)
- `db:types:check`: PASS (sha `7df58d04...`, tip `20260814140000`)
- `tsc -p tsconfig.app.json`: PASS
- `security:audit-production`: PASS (0 vulnerabilities)
- ggshield: BLOCKED (CLI not installed)

## Intentionally not changed

- Applied go-live migrations `20260814125600` / `20260814133500` (immutable;
  forward binding fix only).
- Official UTILTS matrices / TGT-AGT evidence remain external blockers.
- Open `#127` and older health PRs remain pre-`2c5a8c0f` vehicles; close as
  superseded after `580a` merges.
