# Disposable restore authority repair — 2026-09-30

Status: bounded wrapper fix implemented and locally qualified; actual restored
owner/ACL/data/auth/catalog proof remains **NOT_EXECUTED for this change** until
the next exact candidate CI. The complete T49/T55 outcomes are not accepted by
wrapper tests.

## Actual failure and root cause

The read-only `ci-candidate4b.md` receipt records published head
`4b7888a461ad03580b6e11ae91217b64cd05fa21`, tree
`06630a04ba3800e5e1ae53bffa1bacdd47950de1`, actual OPS run `36783103604`,
upgrade job `110117956774`. Its pinned old-schema replay, synthetic pre-existing
rows, all thirteen forward migrations, upgrade compatibility checks and issued
byte hash pass. It creates and verifies an empty `template0` restore database.
The first actual restore error is:

```text
TENANTSERVICE_RESTORE_PG_RESTORE_FAILED
TENANTSERVICE_PROOF_FIRST_ERROR restore.log: must be able to SET ROLE "supabase_admin"
```

The independent CI reviewer validated upgrade artifact `11128832610`, ZIP
SHA-256 `ee7cb658b10c42852ffa2cbf6b0f042499beb803715a012a9e845abab4313d89`,
whose sole member is the sanitized `tenantservice-upgrade-restore.log`. The
receipt explicitly contains no prior role/container/superuser probe result.

The old wrapper restores an ownership-preserving custom archive using its
ordinary local `postgres` connection. That role lacks the authority required to
restore an object owned by `supabase_admin`. This is a restore connection defect,
not evidence that owner/ACL records should be discarded. Restored fingerprint,
catalog parity and positive/negative authorization proofs were not reached.

Primary sources checked on 2026-09-30:

- [PostgreSQL 17 pg_restore documentation](https://www.postgresql.org/docs/17/app-pgrestore.html):
  default restoration retains ownership; it requires a true superuser or a role
  owning all restored objects. Omitting ownership or privileges changes the
  proof. SQL output is an actual archive restoration mode and single-transaction
  restoration preserves transactional execution.
- [Supabase internal role documentation](https://supabase.com/docs/guides/database/postgres/roles):
  distinguishes ordinary application/API roles and the internal administrator.
- [Vendor role initialization](https://github.com/supabase/postgres/blob/develop/migrations/db/init-scripts/00000000000000-initial-schema.sql):
  establishes `supabase_admin` as a superuser.
- [Vendor initialization/migration runner](https://github.com/supabase/postgres/blob/develop/migrations/db/migrate.sh):
  uses the internal administrator for vendor migrations after demoting postgres.
- [Vendor client authentication configuration](https://github.com/supabase/postgres/blob/develop/ansible/files/postgresql_config/pg_hba.conf.j2):
  has trusted container-internal IPv4 loopback. Unix-socket authentication differs
  between source generations, so this wrapper uses explicit in-container
  `127.0.0.1:5432`, with password prompting prohibited.

These current upstream files explain the privilege model; they do not prove the
running pinned image's attributes. The archived local baseline fixes
`project_id="gridex-ops-platform"`; its replay fixes image `17.6.1.155`.
The new live authority probe must verify the real current session and superuser
attribute in the exact running stack. The failed receipt proves insufficient SET
ROLE authority, but does not itself record the `postgres.rolsuper` boolean.

## Bounded implementation

Owned runtime wrapper: `scripts/tenantservice-upgrade-restore.sh`. New helpers:

1. `tenantservice_local_docker` explicitly removes `DOCKER_HOST` and
   `DOCKER_CONTEXT` and selects the runner's fixed local Docker Unix socket. It
   cannot use a selected remote context or network daemon endpoint.
2. `tenantservice_restore_archive` checks `CI=true`, the original literal
   localhost source URL, the private runner-temp prefix, exact generated database
   name shape and matching literal target URL before any administrator operation.
3. It reads actual source-role attributes and the just-created target database
   OID through the existing local connection. It connects only to the pinned
   baseline container `supabase_db_gridex-ops-platform`, as `supabase_admin` on
   container loopback. Actual `session_user`, `current_user`, `rolsuper=true` and
   the same random target database OID must all match before archive execution.
4. The existing matching host `pg_restore` reads the actual custom archive and
   exact filtered TOC and emits original SQL with `--single-transaction`. That
   stream feeds the proven container administrator's `psql -X -q` with
   `ON_ERROR_STOP=1`. Bash `pipefail` propagates either generator or database
   execution failure. No backup copy or credential file is placed in the
   container; raw errors remain in private logs and only the existing sanitized
   first error is published.
5. Subsequent actual data/owner/column/default ACL fingerprints, full catalog
   parity, restored upgrade checks, authorization positives/negatives and
   rollback fingerprint remain on the existing ordinary `postgres` connection.

No roles, role memberships, login credentials, application ACLs or ownership
rules are changed. No `--no-owner`, `--no-acl`, `--no-privileges`, SQL stripping,
extra schema exclusion, trigger-disabling flag or new proof workflow is added.
The existing explicit `pg_cron` exclusion and full scope limits remain unchanged.
The parent owns workflow/checksum integration and reviews the change before
publication. No hosted database, production credential or external daemon was
probed.

## Genuine local RED/GREEN and limits

New `__tests__/tenantservice-restore-authority-wrapper-20260930.test.ts` extracts
and executes the actual Bash restore control flow under `set -euo pipefail`.
The original direct-connection path failed the positive case before source edits,
exiting 1 against a process stub reproducing the restricted SET ROLE error. The
fixed helper passes the same case and preserves owner/ACL SQL in the stream.

Additional cases reject a non-superuser administrator, different database OID,
non-CI execution and external target URL before the archive generator/consumer
runs. Their private logs are inspected to prevent vacuous no-call assertions.
Both generator and psql failures propagate. Remote Docker environment variables
are deliberately present in the fixture; the actual fixed Unix-socket invocation
is checked. This proves wrapper routing, boundaries and status propagation,
**not** PostgreSQL restoration.

Executed final local checks with Node 22.23.3:

| Check | Actual result |
| --- | --- |
| New seven-case restore authority wrapper file plus retained two-case upgrade SQL wrapper file | 2 files, 9/9 PASS |
| Scoped ESLint for new TypeScript test | PASS |
| `bash -n scripts/tenantservice-upgrade-restore.sh` | PASS |
| Owned `git diff --check` | PASS |
| ShellCheck | NOT_EXECUTED: executable absent |
| Local actual Supabase/Docker/psql restore | NOT_EXECUTED: local Docker and psql absent |

No new TypeScript application behavior was changed. Whole candidate type/lint/
build/native acceptance and independent root review remain parent gates.

Independent reviewer `/root/ci_evidence` checked wrapper blob
`6eba61fe1f3cd2306a8f9d2152374d8614c5788b` and test blob
`abd97a6987f822ee9bc96cadf50deef52e5f7870`, confirmed the immutable baseline
project/container binding, reran the real Bash/stub unit corridor 9/9 PASS and
`bash -n` PASS, and reported no bounded source blocker. This source approval
does not qualify the vendor administrator connection or a restored database.

## Next actual CI boundary

The next existing upgrade job must first observe:

```text
TENANTSERVICE_RESTORE_SOURCE_ROLE postgres_superuser=<actual boolean>
TENANTSERVICE_RESTORE_LOCAL_ADMIN_AUTHORITY_PASS
```

Those diagnostics establish a current connection capability, not restore success.
Only actual successful archive execution may produce
`TENANTSERVICE_RESTORE_REAL_PG_DUMP_ARCHIVE_PASS`. The retained downstream data,
owner/column/default ACL, schema/function/RLS/catalog parity, restored command
authority and post-proof no-effect markers must then pass before
`TENANTSERVICE_UPGRADE_RESTORE_NATIVE_PROOF_PASS` can be accepted. Candidate
generated schema/fingerprint equality remains a separate final gate.

If this exact vendor image denies the local administrator connection, the new
wrapper fails closed before handing it archive SQL; the sanitized authority log
will identify that next actual blocker. No unobserved authentication method,
restored owner/ACL parity or whole backup/incident acceptance is claimed here.
Storage object bytes, service configuration, cluster-role backup, hosted PITR,
production restore and dispatch recovery remain outside this same-cluster
logical database proof.

Skills: existing repository systematic-debugging, TDD/writing-good-tests,
fp-check, spec-to-code-compliance and verification-before-completion;
Supabase/PostgreSQL privilege guidance and primary vendor documentation.
This is a narrow actual-CI repair; full inventory regeneration, unrelated UI,
dependency/role redesign and deployment skills have no trigger. Shared source,
all pending workers and historical migrations are preserved.
