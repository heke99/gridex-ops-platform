# Post-#101 residual handover

Status: **O-008 PUBLIC residual implemented on tip branch; staging apply pending**

Trigger: main push `#101` (`78013b71`) preserved controlled portal input errors
on `/api/v1/customer/sync` and `/api/v1/customer/portal-bundle` POST.

## What this branch closes

Closed PR `#100` on `7f6c` contained two residuals; only the portal half landed
via `#101`. This branch lands the remaining half:

- Forward migration `20260809151500_gridex_ops_o008_public_privilege_hardening.sql`
- Exact donor checksum `093c959de60ea3f426548dd82df779fb244c34adfa6c6baa567654cf70f36349`
- Static regression `scripts/gridex-ops-o008-public-privilege-hardening-regression.cjs`
- Manifest additions entry for the new migration

## Why it matters

`20260809131500` revoked readiness SELECT from `anon`/`authenticated` but left
inherited `PUBLIC` grants able to re-expose dashboard readiness views through
PostgreSQL's PUBLIC pseudo-role.

## Intentionally not changed

- Portal parse paths already covered by `#101` / `#99`
- External masterdata/config gaps from prior remediation handover
- Stale open draft residual PR `#96` (supersede after this tip lands)
- No historical migration rewrite; timestamp `20260809143000` remains BL-001

## Verification executed

- O-008 PUBLIC static regression PASS
- Migration integrity PASS
- Base O-008 and BL-001 static regressions PASS
- Portal V3-BUG-001 / legacy sync regressions PASS
- Vitest blocked (no `node_modules` in environment)
- Staging SQL matrix not run
