# Open blockers

Updated: 2026-08-10

The implementation and connected-dev checks are complete. Release remains blocked by evidence that cannot be produced from the supplied archive:

1. No `.git`: current HEAD, origin/main and merge SHA are unverified.
2. Clean empty-database replay is configured in CI but not executed locally because Docker/Supabase CLI are unavailable.
3. No staging or production Supabase project is connected for parity verification.
4. Supabase Auth leaked-password protection requires a hosted dashboard change.
5. No current hosted GitHub Actions run is available.
6. No Vercel deployment connector/evidence is available to prove exact-SHA production release.
7. Production p50/p95/p99 and timing breakdown require deployed traffic/observability.

Geodata cleanup is not a blocker hidden as completed work: the new lifecycle function was dry-run only and no rows were deleted.

See `docs/remediation/GRIDEX_75_POINT_EXECUTION_REPORT_2026-08-10.md` for the exact release sequence.
