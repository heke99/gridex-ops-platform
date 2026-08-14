# Current state

Updated: 2026-08-14

## Tip health after #139 merge

- Main tip: `09752455` (`Merge PR #139: forward-port remaining production capabilities`).
- Active health branch: `cursor/codebase-health-and-stability-ea1a`.
- Tip residual hunt after #139 found OpenAPI docs drift still open from unmerged
  `#138`, plus inbound manual-review correctness gaps in the #139 forward-port.

## Residuals closed on `ea1a`

1. LOW — Developer scope join follows `scopeMode` (`och`/`eller`) and
   `OPENAPI_RELEASED_AT` tracks `2026-08-14.1`
2. MEDIUM — Inbound manual review terminal status uses canonical `done`
   (legacy `completed` accepted then normalized)
3. MEDIUM — Job ↔ inbound email message binding in app action + SECURITY DEFINER RPC

## Verification executed on `ea1a`

- vitest tip residuals + related: 22/22 PASS
- `db:migrations:integrity`: PASS (436 files)
- `security:audit-production`: PASS (0 vulnerabilities)
- `tsc -p tsconfig.app.json`: PASS
- `check-supabase-generated-types`: PASS (tip `20260814190000`)
- ggshield: BLOCKED (CLI not installed)
- hosted CI: NOT YET
- live DB apply of `20260814190000`: NOT observed in this run

## Intentionally not changed

- Applied `#139` migration `20260814183500` (immutable; forward-only residual).
- Platform-admin operate bypass remains intentional.
- Release-receipt `auth.uid()` attribution under pure service-role callers remains
  nullable by schema design.
- Draft `#137`/`515d` and `#138`/`8637` are superseded as merge vehicles once
  this tip branch lands.
