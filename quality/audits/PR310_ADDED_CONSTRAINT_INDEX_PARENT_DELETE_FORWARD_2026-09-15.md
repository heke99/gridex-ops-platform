# Five retained-history FK repairs — qualification package

The source-backed decision is to retain each optional customer-history row and
its known company when an otherwise permitted customer deletion detaches its
customer link. The candidate changes only the five composite DELETE actions to
`SET NULL (customer_id)`. UPDATE CASCADE, all 13 other coexisting FKs, validation,
constraint comments and nullable input compatibility are preserved.

This is a concrete candidate and executable qualification package, not an
executed PostgreSQL result. No historical migration, reference or selected
forward file was edited. The owner must publish the reviewed package, obtain
the successful PostgreSQL17 and genuine CLI artifacts, then qualify the selected
forward on the owned full replay before accepting its five resulting catalog
rows. Source intent is resolved; runtime execution is still pending.

## Evidence and scope

The companion `PR310_ADDED_CONSTRAINT_INDEX_PARENT_DELETE_INTENT_2026-09-15.json`
and Markdown bind table-specific retention declarations, the current test-only
customer deletion route, all 18 coexisting FK rows, three user trigger rows and
two final function rows. The four overlapping simple SET NULL/composite CASCADE
relationships must be measured in both RI trigger orders. The nullable sync
journal must preserve a known company; an unknown legacy company is a separate
case, not permission to erase an existing tenant owner.

The separate FORWARD JSON records all five observed and proposed complete
constraint rows and hashes. It is not an acceptance allowlist. The immutable
211-row source register and its observed artifact hashes remain unchanged.

PostgreSQL17 supports a column list for DELETE SET NULL, including retaining a
tenant key while clearing an optional related identity. This establishes syntax
support, not the result of our fixture. See the official [foreign-key
documentation](https://www.postgresql.org/docs/17/ddl-constraints.html#DDL-CONSTRAINTS-FK).

## Candidate admission and mutation

`scripts/sql/forward-candidates/preserve-retained-customer-history-on-delete.sql`
has SHA256 `00f8a844fc5c72274d697558d57f216acf56388b6d36f6aad6063ca255283734`.
It acquires all six relation locks before admitting or mutating the five FKs,
rechecks ordinary/noninherited relation shape under locks, and rechecks the
parent OID against its name. Each target must have the exact UUID key layout,
MATCH SIMPLE, UPDATE CASCADE, validated/nondeferrable/local FK shape, and either
its known old delete action or the exact final targeted SET NULL action. Missing
targets and unfamiliar shapes reject the transaction. Repeats retain final
constraint OIDs. Comments are restored when a constraint must be recreated.

Physical nullability is table-specific: company_id is nullable on
customer_sync_events and data_quality_findings, nonnullable on the other three;
all five customer_id columns are nullable. The fixture derives this matrix from
ten fully hashed added-column rows. The unchanged parent customers.company_id
is physically nullable in the pinned reference; a tenant-required CHECK does
not change pg_attribute.attnotnull. Parent ID remains physically nonnullable.
These distinctions were corrected during independent review, before any SQL
qualification claim or publication.

## Executable qualification

`scripts/canonical-added-constraint-index-parent-delete-selftest.py` reuses the
existing fixed-address, nonce-owned disposable PostgreSQL17 database lifecycle.
It accepts no database URL, table, SQL or artifact input. Only a selection-only
mode can omit SQL execution. Sources and current caller pins are checked before
the first database operation.

The fixture installs all 18 exact FK definitions, the three actual user-trigger
definitions and both final real function bodies. Native pg_get_constraintdef
and pg_get_triggerdef use the comparator's pretty=true convention; complete
function rows, including pg_get_functiondef MD5, are checked. Parent tables,
payload columns and audit sink are bounded synthetic shapes. Full parent,
application, authentication and audit_logs dependency graphs are not claimed.

Twenty cases cover five tables, both FK creation orders, and original/repaired
actions. The actual parent DELETE trigger order is measured from pg_trigger,
not assumed from creation order. Valid links, orphan/wrong-company rejection,
retained payload and company, the real operational guard for paused tenants,
real import audit append, and nullable journal/finding inputs are exercised.
Each probe proves whole-fixture data/catalog rollback.

The actual candidate is also executed with all five children simultaneously.
The state comparator permits only the five changed constraint definitions and
their associated internal RI trigger recreation; other rows, constraints,
comments, triggers, functions, ACLs, relation security and column metadata must
remain equal. It checks exact final FK rows, unchanged repeat state, missing
last target, wrong action, unvalidated shape, nonnullable child customer and
nonnullable parent company rejection. An injected error after the candidate's
DDL but before COMMIT must restore the entire preimage.

`.github/workflows/gridex-retained-parent-delete-qualification.yml` runs these
checks against a disposable PostgreSQL17 service. Only after successful SQL and
strict receipt checks does official Supabase CLI2.101.0 create the migration
filename in a temporary project. The uploaded candidate bytes must have the
exact SHA above. The receipt identifies the source head and explicitly leaves
selectedMigration/schemaAccepted/productionModified false.

## Verification and review boundary

Executed locally:

- Seven offline source/selection/delta tests pass via
  `python3 -B scripts/canonical-added-constraint-index-parent-delete-tests.py`.
- Selection-only checks pass: 18 FKs, three triggers and two real functions.
- Source intent evidence and all pinned rows/caller declarations validate.
- `git diff --check` passes. No local PostgreSQL is available.

The initial offline invocation failed because the implementation did not yet
exist. Independent review then found and corrected two real admission/fixture
assumptions: nullable finding company and nullable parent company. It also
aligned native trigger formatting and tightened parent identity rechecks.
These are code-review results, not executed SQL outcomes.

Independent reviewer `/root/schema_column_review/sendlock_candidate_review/added_constraints`
approved the final candidate, helper, tests, workflow and proposed-row JSON for
staged PostgreSQL17 qualification after independently rerunning the seven tests,
selection and workflow syntax checks. No remaining concrete source defect was
reported. The approval explicitly excludes unexecuted SQL and full-schema
acceptance.

Skill routing follows the enclosing database audit's established baseline:
source acquisition, differential review, false-positive checking, systematic
debugging, focused tests, independent review and verification-before-completion
apply. The work is a bounded database-integrity discrepancy repair; UI,
performance tuning, deployment, hooks and broad unrelated scans are outside
this subtask. The owner retains final publication, native execution, acceptance
and merge gates.
