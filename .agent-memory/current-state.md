# Current state

Updated: 2026-08-14

## Tip health after #141 merge

- Main tip: `f4ff19d2` (`Merge PR #141: fix final OpenAPI developer-docs residuals`).
- Active health branch: `cursor/codebase-health-and-stability-d15d`.
- `#141` landed scopeMode-aware developer docs (`och`/`eller`) and
  `OPENAPI_RELEASED_AT=2026-08-14T18:26:00.000Z`.
- Open PR `#140`/`ea1a` is CONFLICTING with tip (overlapping OpenAPI slice) and
  still held the inbound manual-review residuals.

## Residuals closed on `d15d`

1. MEDIUM — Inbound manual review terminal status `completed` vs worker `done`
   Forward migration `20260814190000` + UI/action normalization
2. MEDIUM — Unbound `job_id` / `inbound_email_message_id` on resolve
   App membership check + 5-arg SECURITY DEFINER RPC
3. LOW — Admin UI error mapping for mismatch / invalid next_status

## Verification executed on `d15d`

- vitest tip residuals: 4/4 PASS
- `db:migrations:integrity`: PASS (436 files)
- `db:types:check`: PASS
- `security:audit-production`: PASS (0)
- `tsc -p tsconfig.app.json`: PASS
- ggshield: BLOCKED (CLI not installed)
- hosted CI: NOT YET

## Intentionally not changed

- Applied `#139` migration `20260814183500` (immutable; forward-only).
- OpenAPI docs already correct on tip after `#141` (not re-touched).
- Platform-admin-only IDOR without binding remains defense-in-depth (privilege
  already platform admin); binding still required for consistency.
