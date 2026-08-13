# Current state

Updated: 2026-08-13

## Tip health after dependency remediation

- Main tip: `2eb61986` (`fix(security): remediate production dependency vulnerabilities`).
- Active health branch: `cursor/codebase-health-and-stability-0a00`.
- Tip change was lockfile-only (`brace-expansion`, `js-yaml`, `nanoid`).
- Open `#122`/`a029` residuals were replayed onto this tip, then tip-specific
  auth flash / base-URL / override pin gaps were closed.

## Residuals closed on `0a00`

1. HIGH — `#122` auth/SVK/UTILTS/L653Q/packaging residuals absent from tip
2. HIGH — sibling auth pages still rendered raw `?error=` query text
3. HIGH — dual fail-open `getBaseAppUrl` copies (auth email flow, password reset)
4. HIGH — logout ignored shared URL chain (`SITE_URL` only)
5. MEDIUM — auth-action error redirect dropped retry context
6. MEDIUM — audit remediations not pinned in `package.json` overrides

## Verification executed on `0a00`

- vitest auth-outage + UTILTS disposition/persistence: 43/43 PASS
- `gridex:post-332-field-511-health-residuals-regression`: PASS
- ops health: PASS
- `ediel:utilts-reason-regression`: PASS
- `db:migrations:integrity`: PASS
- `db:types:check`: PASS
- `security:audit-production`: PASS (0 vulnerabilities)
- `tsc -p tsconfig.app.json`: PASS
- ggshield: BLOCKED (CLI not installed)

## Intentionally not changed

- Applied field-511 import migration `20260813210500` (immutable).
- Official UTILTS matrices / TGT-AGT evidence remain external blockers.
- Open `#122` and older health PRs remain pre-`2eb61986` vehicles; close as
  superseded after `0a00` merges.
