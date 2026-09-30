# Independent lifecycle prerequisite review, 2026-09-30

Bounded source and PostgreSQL-core review PASS. Native Supabase upgrade and
actual backup/restore remain NOT_EXECUTED for this repaired candidate until a
new published-tree CI run reaches and passes them.

## Exact source provenance

| File | Reviewed Git blob |
| --- | --- |
| supabase/migrations/20260930144853_customer_profile_facility_atomic_commands.sql | 060c04e84d56aaf4d8d19be64184d14168e0be7c |
| scripts/sql/tenantservice-upgrade-postcheck.sql | 274813f5965b22ceacefb776b1e7a6bfec93a54a |
| scripts/customer-lifecycle-upgrade-compatibility.postgres.test.cjs | b7ea4ce4b97a3364213236e1e87c334ff1791737 |

Profile SQL SHA256
`9fcdc1f5ffb6cdd4a5a08994de40ca5367e3960c5629fc89082bc32e60f694be`
matches the actual migration-history-manifest.json files entry.

Compared every actual ae56ee0a1e0e8adbce9d5f4d92da75cdcb8010c8 published SQL
blob under supabase/migrations against current files: 653 checked, zero
changed, zero missing. The repaired SQL is a candidate forward migration.

The actual failing earlier candidate/run is separately preserved in
ci-candidate0d.md; that failure is not presented as a pass of these new blobs.

## Source review

The forward repair provides moved_out_at date, lifecycle_closed_at timestamptz,
lifecycle_closed_by uuid REFERENCES auth.users(id) ON DELETE SET NULL and
lifecycle_status_reason text. All four new fields are nullable with no default
or fabricated closure backfill. IF NOT EXISTS leaves pre-existing live column
definitions/values intact. Definitions match the historical 8-digit source,
which canonical replay does not execute.

The prerequisites occur before revision trigger installation and the later
billing backfill. That resolves the observed NEW.moved_out_at missing-field
cause without changing the historical replay selector or baseline SQL.

The root postcheck requires exactly four correctly typed nullable customer
columns and all four seeded old-customer values to remain null. It therefore
does not accept fabricated lifecycle closure. Both upgraded source database
and restored database call this postcheck in the actual wrapper. Missing fields
can fail at PostgreSQL field resolution; they cannot produce a PASS marker.

## Independent execution

Executed with Node22 and PGlite0.3.14:

```text
NODE_PATH=/tmp/ediel-service-check/node_modules node --test scripts/customer-lifecycle-upgrade-compatibility.postgres.test.cjs
4 tests, 4 pass, 0 fail
```

These execute exact extracted candidate prerequisite/trigger/billing SQL
statements against PostgreSQL core. Cases cover absent, partial and complete
legacy field shapes, retained existing values and nullable types, no invented
closure, unchanged unrelated billing-backfill revisions, separate legal versus
lifecycle increments, forged counters, actor FK rejection and actor deletion
with ON DELETE SET NULL. This reviewer executed GREEN; the author's prior RED
is separate provenance.

Also independently extracted and executed the actual newly added postcheck
IF-block in ephemeral PGlite databases. Five expectations passed:

| Input | Actual postcheck |
| --- | --- |
| Correct typed nullable fields, all null | Accepted |
| Non-null fabricated moved_out_at | Rejected, P0001 |
| moved_out_at wrong type | Rejected, P0001 |
| lifecycle_status_reason NOT NULL | Rejected, P0001 |
| lifecycle_status_reason absent | Rejected, 42703 |

This focused IF-block execution does not claim the entire postcheck, historical
migration replay, PostgREST, Auth runtime, RLS or pg_dump/pg_restore passed.
Only exact published-candidate native CI can provide that later qualification.

Reviewer changed only own audit reports. No workflow, refs, SQL, tests, baseline
or external state was changed by this review; no unchanged rerun was requested.
