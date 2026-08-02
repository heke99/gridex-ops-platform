# Supabase advisor baseline

Date: 2026-08-02
Project: `gridex-ops-dev` (`piidsfebjqjmnepdpnas`)

## Security Advisor

The connected project currently reports 124 findings:

| Finding | Count | Level/impact |
|---|---:|---|
| RLS enabled with no policy | 54 | informational; classify as intentional internal deny-all or add explicit policy |
| Authenticated-executable `SECURITY DEFINER` | 37 | warning |
| Anonymous-executable `SECURITY DEFINER` | 26 | error/warning surface |
| Security-definer views | 4 | error |
| RLS disabled in exposed `public` | 2 | error |
| Leaked-password protection disabled | 1 | warning/configuration |

Remediation references:

- https://supabase.com/docs/guides/database/database-linter?lint=0028_anon_security_definer_function_executable
- https://supabase.com/docs/guides/database/database-linter?lint=0029_authenticated_security_definer_function_executable
- https://supabase.com/docs/guides/database/database-linter?lint=0010_security_definer_view
- https://supabase.com/docs/guides/database/database-linter?lint=0013_rls_disabled_in_public
- https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy

## Performance Advisor

The project currently reports 1,389 findings:

| Finding | Count |
|---|---:|
| Unindexed foreign keys | 596 |
| Unused indexes | 582 |
| Multiple permissive policies | 150 |
| Auth RLS init-plan opportunities | 34 |
| Duplicate indexes | 26 |
| Absolute Auth DB connection allocation | 1 |

These findings are an inventory, not permission to delete indexes or policies.
Index usage must be evaluated over a representative production window, and RLS
consolidation must preserve the before/after JWT access matrix.
