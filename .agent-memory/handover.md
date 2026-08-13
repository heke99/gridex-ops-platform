# Handover

Updated: 2026-08-13

Branch `cursor/codebase-health-and-stability-13b2` closes post-`3cad481b`
health residuals after `#123` landed on main.

Main tip `3cad481b` closed the post-`2eb61986` auth/SVK/UTILTS package, but
the squash/types-regen path reintroduced non-nullable field-511 resolver
Returns and left public/portal flash, disabled-session reason, dual
next-path, and UTILTS match-join gaps open.

This branch:

1. Re-applies nullable `description` / `valid_to` on
   `resolve_ediel_timeseries_product_511` Returns.
2. Adds durable `scripts/apply-supabase-types-nullability-overrides.cjs` and
   wires it into clean-migration-replay so future typegen cannot silently
   regress SQL nullability.
3. Gates `gridex:post-332-field-511-health-residuals-regression` in
   ops-hardening.
4. Allowlists public teckna-avtal and portal completion query flashes.
5. Maps `reason=account_disabled` on login to a fixed Swedish flash.
6. Unifies `getSafeNextPath` into `lib/auth/urls.ts` (including same-origin
   absolute URLs).
7. Synthesizes null IDE+24 ids in UTILTS tenant match building before
   persistence join.

Prefer merging `13b2`, then closing superseded open health PRs
`#122`/`#121`/`#120`/`#119`/`#117`/`#115`/`#113` rather than rebasing those
older branches.

ggshield was unavailable in this environment; run secret scan in CI/host.
Live DB apply of field-511 import + L653Q trim was not observed in this run.
