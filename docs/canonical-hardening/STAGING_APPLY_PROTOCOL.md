# Staging apply protocol

1. Create or select an isolated non-production Supabase branch.
2. Record project ref, PostgreSQL version, ledger and schema-only dump hashes.
3. Compare every A–C table, column, constraint, index, policy, trigger, function body and grant.
4. Repair A–C ledger entries only after exact parity sign-off.
5. Run `supabase db push --dry-run` and archive its output.
6. Apply D–F, `20260802160000`, then `20260802170000` in order.
7. Run `canonical_run_hardening_preflight()`.
8. Resolve the 153 unscoped test runs, duplicate profile group and missing production snapshot without guessing.
9. Validate deferred constraints.
10. Execute DB behavior, JWT/RLS, service-role negative, concurrency and worker pause tests.
11. Rerun Supabase security/performance advisors.
12. Record PASS/FAIL/NOT VERIFIED and retain the branch for review.

Never run the first apply directly against production.
