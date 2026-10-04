# Staff case assignee eligibility

Isolated base: S4 `1feebb68a`. Supabase CLI created forward migration
`20261004100849_staff_case_assignee_eligibility.sql`; no historical migration changed.
The six-argument assignment RPC and its service-only execution ACL remain intact.

The original RPC accepted customers, unknown/platform/null roles and unaccepted,
deleted or banned accounts when membership and profile still looked active.
Ten of sixteen actual-RPC tests failed before the repair. The new RPC holds target
membership/profile/Auth SHARE locks under the shared actor guard's company lock,
then rechecks accepted active membership, active profile and nondeleted/nonbanned
Auth account. Staff type comes from S2's normalized recognized base role profile,
excluding customer/platform roles. Effective permission denies do not make an
otherwise valid staff assignee ineligible. Null unassignment remains available.

Auth locks use a narrowly scoped SECURITY DEFINER with empty search path and no
new Auth table grants. The case graph filter, assignment mutation, event payload
and atomic audit body are unchanged.

Fresh verification: 17 new actual-RPC tests, 23 shared actor guard tests and 19
case adapter tests passed (59 total). Coverage includes foreign/ineligible targets,
the role-profile matrix, zero effective permissions, null assignment, attribution,
audit rollback and service-only execution. The complete native rollback regression
script passed on embedded PostgreSQL. Scoped ESLint and diff checks passed.

Supabase, Postgres locking/privilege guidance and verification-before-completion
apply as in the preceding repairs. Parent owns memory, checksum registration,
native CI wiring and artifact capture. Native full replay must run
`scripts/staff-case-assignee-eligibility-regression.sql` for actual schema, grants
and owner qualification; embedded execution does not prove native concurrency.
No production action or real staff account was used.
