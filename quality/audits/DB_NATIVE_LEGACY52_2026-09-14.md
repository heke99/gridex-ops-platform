# Native foundation44-52 CLI envelope — 2026-09-14

Status: IMPLEMENTED_NOT_VERIFIED. Native CI is required before this envelope
is accepted. First43 remains independently verified. Full replay, schema/types,
release and85/86 are NOT accepted.

## First genuine attempt

Published implementation8ec1cef87ff20961d81d00f503f851a9f47f8a52 reached the
new native44-52 lane in ordinary OPS34868620937/clean104058668919. First43
again passed, but the first new probe expectedP5244 and instead received42501.
Zero44-52 inputs were accepted. The prior ledger, private disposal and owned
cleanup are not treated as full-chain acceptance. Artifact10358351879 ZIP SHA256:
7064dbe969bb445b5802658c198075b8b7612fcd053b4f4c2b8f8f5618e83c98.

## Source and transaction authority

Reuse the hash-locked A/B/C/D/E/F/H/I/Q source authority, stage guards,
source-derived DDL oracles and preservation assertions. All nine original
sources and every on-disk support file remain byte-identical. One CLI unit
covers44-52; the ledger records its complete actual program, not nine commits
or fabricated historical applied versions. Original source names are unchanged.

The invoker DO body executes whole components. Temporary context, advisory
mutex and all six domain ACCESS EXCLUSIVE locks survive through the CLI's own
ledger INSERT. Exact READ COMMITTED is required; isolation is not changed after
DO acquires its snapshot. The original10s lock and60s statement limits are also
set before the DO statement so the deadline is actually armed, not merely
visible in current_setting from a SET inside a running function.

## Finite provider-owned metadata adaptation

The original fixture admission tries SHARE locks on every public/auth/storage
relation. Native postgres is not the owner of Supabase's internal migration
and vector metadata and may only SELECT those objects. A read-only inspection
of hosted piidsfebjqjmnepdpnas confirmed four such protected identities:
auth.schema_migrations (supabase_auth_admin), storage.migrations,
storage.buckets_vectors and storage.vector_indexes (supabase_storage_admin).
This query neither modified the hosted database nor established native CI proof.

The native candidate independently inspects its own first43 catalog and actual
role privileges. Only those exact four identities, their exact provider owners,
SELECT permission and absence of INSERT/UPDATE/DELETE/TRUNCATE may qualify.
Unknown deficits, public/domain relations, owner changes and references in any
of the nine historical source programs fail closed. Eligible unrelated provider
metadata gets ACCESS SHARE in the derived native admission; the immutable
admission file is not edited. Its exact old SHARE version is a required42501
negative probe, tied to the actual denied relation, not an arbitrary42501.

ACCESS SHARE protects against provider DDL, not concurrent provider DML. This
is a finite adaptation of a disposable, unlinked db-only CI fixture, not a claim
of equivalent production concurrency semantics. No Auth/Storage application
service is started. All six domain exclusive locks and all other SHARE locks
remain unchanged. Complete before/after catalog and row comparisons still
include protected provider metadata; any unexpected change blocks acceptance.
No GRANT, ALTER ROLE, SECURITY DEFINER or superuser historical execution is
introduced. Earlier wording claiming every native fixture lock was unchanged
is superseded by this explicit derived-admission projection.

## Required native proof before real application

All failed probes must leave the preceding genuine ledger, complete scoped
catalog and public/auth/storage row snapshots unchanged:

-42501: reproduce the original provider metadata SHARE denial when applicable.
-P5244: fail after whole A, before B or Q can restore it.
-57014: execute pg_sleep(61) after A and verify the original60s deadline aborts.
-P5252: complete all nine sources/assertions, add marker DDL/DML, then fail.
-P5253: fail in the CLI's own ledger INSERT while checking all six exclusive
 locks, transaction mutex, provider read locks, original local timeouts,
 completed current-transaction temp context and synthetic marker.

Only after those controls and helper disposal may the real group be applied.
The complete execution body and unchanged previous CLI entries are verified;
a repeat CLI up must change neither ledger nor schema/rows. No direct insert
of an applied migration row exists in the runner. Raw SQL, catalogs and rows
remain in the private owned workspace; finite diagnostics use only admitted
relation identities and never arbitrary error text.

## Offline verification and remaining boundary

97 local tests PASS:20 envelope/transport/probe controls,31 prefix integration,
9 lock-boundary,15 lifecycle,8 ledger and14 bootstrap tests. They simulate
native calls and do not establish native SQL success. All601 source files and
505 version groups plus complete source accounting pass integrity checks.
CLI2.101.0, first43 execution and lock27 code remain unchanged.

A verified52 result would still contain zero timestamp inputs. The ordinary
entry retains NATIVE_LATER_ENVELOPES_AND_FULL_ACCEPTANCE_REQUIRED until the
rest of144 foundation/514 timestamp stages, full independent schema parity,
generated types and every mandatory OPS/E2E gate are implemented and verified.
No type/schema acceptance baseline refresh, hosted mutation/reset, main merge
or production deployment is included. Existing app/API work is preserved.
