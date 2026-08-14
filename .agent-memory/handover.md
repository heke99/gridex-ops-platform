# Handover

Updated: 2026-08-14

Branch `cursor/codebase-health-and-stability-8738` closes post-`c2adf6a0`
(`/ #126`) tip residuals and supersedes open `#125` on `9807`.

`#126` landed runtime readiness + dependency circuits on main, but left the
pre-existing UTILTS null IDE+24 disposition/ACK identity gap open and
introduced a success-path circuit telemetry fail-closed residual.

This branch:

1. Replays `#125` UTILTS shared `transactionIdentity.ts` so profiles,
   dispositions, issue refs, persistence and ACK targets all synthesize
   `transaction-<n>` for missing IDE+24.
2. Adds durable `npm run db:types:gen` (typegen + nullability overrides +
   check) and updates the canonical verification protocol.
3. Makes `withDependencyCircuit` success recording best-effort so a completed
   dependency call still returns when telemetry throws.
4. Aligns integration write idempotency invalid-key messaging with the
   canonical grammar.
5. Gates UTILTS disposition/persistence and dependency-circuit vitest in
   ops-hardening verify, and extends the post-332 static residual gate.

Prefer merging `8738`, then closing superseded open health PRs
`#125`/`#122`/`#121`/`#120`/`#119`/`#117`/`#115`/`#113` rather than rebasing
those older branches.

ggshield was unavailable in this environment; run secret scan in CI/host.
Live DB apply of `#126` runtime readiness migration was not observed in this
run.
