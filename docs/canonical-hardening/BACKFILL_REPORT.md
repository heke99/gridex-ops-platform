# Backfill report

Execution status: **NOT EXECUTED**

The forward migration contains only deterministic identity backfill: an Ediel profile identity is created when exactly one active profile exists for a company/environment. Duplicate groups are deliberately skipped and block profile mutation/readiness.

The 153 `ediel_test_runs` rows without `company_id` were not changed because no deterministic tenant source was established. Physical `NOT NULL` and validated composite FKs must remain blocked until those rows are resolved or quarantined under an approved retention decision.

Required staging evidence:

1. before/after row counts;
2. source key used for every assigned tenant;
3. zero cross-tenant relations;
4. zero duplicate active profile identities;
5. constraint validation output.
