# Handover

Updated: 2026-08-13

Branch `cursor/codebase-health-and-stability-0a00` closes post-`2eb61986`
health residuals after the production dependency remediation landed on main.

Main tip `2eb61986` only bumped `package-lock.json` (brace-expansion, js-yaml,
nanoid). This branch replays open `#122`/`a029` residuals onto that tip and
adds tip-specific hardening:

1. Sibling auth `?error=` flash allowlists (forgot-password, auth/action,
   company-invite).
2. Canonical fail-closed `getBaseAppUrl` shared by auth email flow, password
   reset email, and logout.
3. Auth-action verify failures preserve `token_hash` / `type` / `next`.
4. `package.json` overrides pin nanoid / js-yaml / brace-expansion dual trees.

Prefer merging `0a00`, then closing superseded open health PRs
`#122`/`#121`/`#120`/`#119`/`#117`/`#115` (and older tip vehicles) rather than
rebasing those older branches.

ggshield was unavailable in this environment; run secret scan in CI/host
before production apply of `20260813221500`.
Live DB apply of field-511 import + L653Q trim was not observed in this run.
