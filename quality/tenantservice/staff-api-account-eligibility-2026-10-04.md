# Staff API account eligibility review

Reviewed S1 at `98905f67` against the requested staff identity boundary and S2
command authority. Company membership alone previously admitted globally
suspended, deleted or banned accounts. A missing/unknown tenant role could also
gain authority through role fallback or explicit allow overrides.

Forward CLI migration `20261004085008_staff_active_membership.sql` adds a
service-only exact-company/user lookup. It requires an accepted active
membership, an active profile and a nondeleted, nonbanned Auth account. It does
not require an OPS session. The context now calls this lookup and admits only
explicit recognized tenant staff profiles, excluding customer and all platform
administrator roles before processing overrides.

The new native rollback regression covers missing/cross-company membership,
unaccepted/disabled membership, suspended profile, deleted/banned account,
expired ban and actual caller grants. Root adds it to the clean Supabase replay.

Observed RED: the new invalid-role cases failed before the role guard (fallback
or allow overrides granted `users.write`); the SQL test failed before the new
RPC existed. Observed GREEN: 24 tests across context, account SQL and integration
auth SQL pass; scoped ESLint and `git diff --check` pass. SQL execution here uses
PGlite as a focused source-SQL diagnostic. Native PostgreSQL, clean replay and
final-head acceptance remain CI gates; this container cannot switch from root
to a postgres process owner.
