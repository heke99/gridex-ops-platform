# Open blockers

Updated: 2026-08-10

Post-`#105` tip health work on `ee51` is implemented and statically verified.
Remaining blockers:

1. Staging/production apply of `20260810230000` O-008 PUBLIC privilege
   hardening (local Docker/Supabase CLI apply not executed in this agent).
2. Supabase Auth leaked-password protection requires a hosted dashboard change
   (GRIDEX-OPS-BL-003).
3. Exact Git/CI/Vercel production SHA receipt after the next release that
   includes this residual.
4. Production p50/p95/p99 and timing breakdown require deployed traffic /
   observability.
5. Open residual PR `#102` is stale relative to `#105` and should be superseded
   by the `ee51` PR once opened.
6. `ggshield` CLI is not installed in this environment; secret scan for the
   tip commit is therefore blocked (no credentials were introduced in the
   grant-only SQL/regression changes).

Clean empty-database replay remains CI-owned (`ops-hardening` /
`clean-migration-replay`).
