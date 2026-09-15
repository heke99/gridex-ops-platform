# Membership lifecycle status qualification

Source20260520_company_delete_backfill_and_admin_layout explicitly widens the membership status CHECK to11 values, including deleted_test_only. This is a real domain extension, not an ordering-only difference. No inspected current membership writer needs to emit that token to establish source authority; its supported inactive semantics must still be checked against concrete consumers.

The bounded qualifier pins the complete original migration and both current consumers. `readActiveMembership` in companyUserAccess.ts queries status=active plus is_active=true. `listOperationalCompaniesForUser` in tenant/scope.ts queries status=active. The qualifier executes the exact original CHECK on a rollback temporary relation, tests all11 statuses with true/false/NULL is_active, checks the two actual predicates, rejects four unknown tokens and preserves nullable CHECK semantics. It does not certify every application authorization path or invent new lifecycle writers.

Three offline tests PASS. Actual PostgreSQL17 execution remains pending. The standalone workflow uses the same owned-container/private-logging/cleanup transport proven by the intake qualifier. No runtime table, policy, migration or source decision is changed until the qualification is actually reviewed and executed.
