# Independent restore authority wrapper review, 2026-09-30

Bounded source and executable Bash control-flow review PASS. Actual vendor
administrator connection, archive restore and owner/ACL parity remain
NOT_EXECUTED for this new wrapper until a new exact-candidate native run.

## Reviewed source

| File | Reviewed Git blob |
| --- | --- |
| scripts/tenantservice-upgrade-restore.sh | 6eba61fe1f3cd2306a8f9d2152374d8614c5788b |
| __tests__/tenantservice-restore-authority-wrapper-20260930.test.ts | abd97a6987f822ee9bc96cadf50deef52e5f7870 |

The earlier4b actual receipt is ci-candidate4b.md: all13 forward migrations,
old-row/lifecycle/immutable-issued-byte checks and empty template0 DB passed;
actual old postgres pg_restore failed at SET ROLE supabase_admin. That old run
contained no current-role/superuser/container/OID probe. None is inferred here
as observed native evidence.

## Connection and target trace

The wrapper refuses non-CI, absent private RUNNER_TEMP, an unowned temporary
path, external source/target URLs, and any database name outside the random
tenantservice_restore_number_number pattern. It requires the exact localhost
54322 postgres source and target URLs.

The immutable ae56 baseline config actually specifies
project_id=gridex-ops-platform; the restore container is fixed as
supabase_db_gridex-ops-platform. Docker uses the explicit local Unix socket
and removes DOCKER_HOST and DOCKER_CONTEXT so a selected remote daemon is not
used by this proof.

The source connection's current_user must be postgres; its actual superuser
boolean is recorded rather than assumed. The target OID is read through the
created disposable database. A separate in-container localhost5432 connection
uses explicit username supabase_admin, explicit target database and no password
prompt. Before any archive SQL, it must return exactly session_user=current_user
supabase_admin, rolsuper=true and the same target OID. Any unexpected value or
connection failure stops the archive stream.

This uses an existing local vendor administrator rather than promoting
postgres, changing cluster memberships or accepting a linked/hosted credential.
Vendor local authentication itself is not proven by the source or stubs.

## Archive and failure trace

The matching host pg_restore reads the actual custom archive and the existing
filtered TOC. It emits SQL to stdout with single-transaction and exit-on-error;
the SQL stream goes directly to the proven local administrator's psql with
ON_ERROR_STOP. No private dump copy or password is written in the container.

Original ownership and privilege SQL remains included: there is no no-owner,
no-acl or no-privileges option. The pg_cron exclusion scope is unchanged.
Source-data/catalog fingerprint, restored-data/catalog comparisons and positive/
negative restored authorization proofs remain in the existing downstream path.

Bash pipefail observes both archive generator and psql consumer failures.
Either failure emits only the generic restore failure marker and prevents the
outer real-archive PASS marker. Raw authority/restore diagnostics are private
and included in the existing sanitized-first-error/EXIT cleanup path.

For command semantics, the official PostgreSQL17 pg_restore documentation was
checked: stdout script mode retains the ordinary archive reconstruction SQL;
single-transaction wraps emitted commands in BEGIN/COMMIT, and no-acl would
explicitly remove privilege restoration.
https://www.postgresql.org/docs/17/app-pgrestore.html

## Executed verification and boundary

Reviewer executed with project Node22:

```text
node node_modules/vitest/vitest.mjs run __tests__/tenantservice-restore-authority-wrapper-20260930.test.ts __tests__/tenantservice-upgrade-sql-wrapper.test.ts
2 files, 9 tests, 9 pass
bash -n scripts/tenantservice-upgrade-restore.sh
PASS
```

Seven new cases execute the actual extracted Bash helpers, with PostgreSQL/
Docker processes stubbed. They cover the valid unstripped owner/ACL stream,
non-superuser and wrong-target OID rejection, non-CI and external target
rejection, generator failure and consumer failure. The two existing SQL-wrapper
cases also pass.

The stub verifies local socket/container/username/port/target/no-password
arguments and both owner/ACL statements in the stream. It supplies the
authority/OID values itself; it does not establish native authentication,
native superuser status, actual pg_restore execution or final restore parity.
Those remain explicit exact-candidate CI prerequisites.

Reviewer changed only own audit reports; no SQL, wrapper, tests, workflow,
refs or external state was modified during this independent review.
