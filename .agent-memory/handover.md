# Handover

Updated: 2026-08-13

Branch `cursor/codebase-health-and-stability-9807` closes post-`ca28cb0a`
health residuals after `#124` landed on main.

Main tip `ca28cb0a` closed the post-`3cad481b` flash/nullability/match package,
but UTILTS disposition matching still compared issue refs against raw null
IDE+24 ids while profiles/runtime issues and persistence already used
`transaction-N`. That orphaned guide/processability faults into false
accepted ACKs on the disposition path (early return before message-level ACK).

This branch:

1. Extracts shared `lib/ediel/utilts/transactionIdentity.ts`.
2. Synthesizes disposition transaction ids and matches issues against them.
3. Synthesizes runtime/profile issue refs and fallback ACK targets the same way.
4. Adds `db:types:gen` that always applies nullability overrides after typegen.
5. Gates disposition/persistence vitest in ops-hardening verify and extends
   the post-332 residual static regression.

Prefer merging `9807`, then closing superseded open health PRs
`#122`/`#121`/`#120`/`#119`/`#117`/`#115`/`#113` rather than rebasing those
older branches.

ggshield was unavailable in this environment; run secret scan in CI/host.
Live DB apply of field-511 import + L653Q trim was not observed in this run.
