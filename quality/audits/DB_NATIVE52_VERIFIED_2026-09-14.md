# Native through52 and provider42501 — verified, 2026-09-14

Status: VERIFIED THROUGH52 ONLY. Full replay, schema/types, release and85/86
remain PARTIAL. This is a documentation-only receipt of already-published
runtime, not a new SQL repair. The older42501/P5244 blocker is SUPERSEDED.

## Scope and evidence

Scope: source-first debugging, focused differential review and
verification-before-completion. Supabase guidance and PostgreSQL17 LOCK
privilege documentation were checked. No UI/API/performance refactor,
new dependency, hosted database audit or deployment is included.

Runtime603e68a52f223a7fcfb65fc8ec33a3ed529ff4da.
Source tree872908e717f961bde8a6f78952b8114b67e2f455.
OPS34873361878 / clean job104074455772 / native artifact10359689961.
Native ZIP SHA256:
5f849416ed91f3d9490fe72fee3e6a8a79b8a8875c53ff2d18bde6e953ad9a2c.
Native JSON SHA256:
a780288028550b187d30279b25fa91f7bf9152828feaf2c865ebf83ee4f2adf5.
Source artifact10359913445 ZIP SHA256:
5ee4c267c183f3c49be32db7b5128252cec4407c1ac9b15de2f0ec6e836d15b6.
The extracted source tree matches the GitHub commit tree exactly.

## Actual native result and verified cause

Official CLI2.101.0 / Supabase PostgreSQL17.6.1.106 reports
NATIVE_HISTORICAL_THROUGH52_VERIFIED. First43 and the whole9-source44–52
atomic unit execute and verify, with one genuine additional CLI ledger row,
unchanged previous entries and a no-op repeat. Zero timestamp inputs execute.
The group program SHA256 is
c94713bc7035d00f2c7dd8bf4e762c99d946b2a6d4b0a548bc2701845b51aecf.
Its actual ledger-statements SHA256 is
f5ada86c3f2a337078a0cf18889b7e44e696f0f619a6d879d644b60c9ffa5523.
These two aggregate hashes are native-runner evidence: the private complete
preimage was not exported, so no independent local recomputation is claimed.

The first reported42501 arose from requesting SHARE on unrelated provider
metadata. The current required negative proof binds that denial to
provider_relations[0], auth.schema_migrations, rather than accepting any42501.
The fresh native catalog also identifies storage.migrations,
storage.buckets_vectors and storage.vector_indexes as SELECT-only for the
migration role. Their owners must be the exact Supabase auth/storage roles.

Published224eda98 uses ACCESS SHARE only for those four exact read-only
provider identities in the disposable, unlinked db-only fixture. It rejects
unknown privilege deficits, owner changes and references in historical SQL.
No GRANT, ALTER ROLE or superuser historical execution is added. Domain
exclusive locks and source SQL remain unchanged. ACCESS SHARE does not block
provider DML; this finite test-fixture projection is not a production concurrency
waiver. All protected metadata remains in preservation snapshots.

Published603e68a5 subsequently fixes a source-admission false positive:
comments containing migrations are not storage.migrations references. The
existing lexer recursively examines dollar bodies, keeps quoted/dynamic SQL
searchable and ignores only comments. Source hashes/order stay mandatory.

## Native failure controls

All five controls pass with unchanged preceding ledger and restored scoped
catalog/rows:42501 original metadata-lock denial;P5244 after whole A;
57014 actual60s deadline;P5252 after the whole group and marker changes;
P5253 inside the CLI's ledger INSERT. The latter requires all six domain
exclusive locks, transaction mutex, provider read locks, completed temporary
context and original10s/60s timeouts. Probe helpers, owned databases and private
workspaces are removed. These are scoped proofs, not full schema equality.

## Independent verification of this receipt

The native ZIP was matched to GitHub's artifact digest. All52 original source
hashes,43 first-prefix program hashes and4 support hashes were independently
recomputed from exact603e68a5. The five expected SQLSTATEs, ledger/row rollback,
no-op repeat, cleanup and explicit fullReplay/types=false fields were asserted.
The ordinary log contains NATIVE_LATER_ENVELOPES_AND_FULL_ACCEPTANCE_REQUIRED.

Fresh local controls PASS:22 legacy-envelope,31 historical-prefix/integration,
9 lock-boundary tests (62 total), plus601 immutable files/505 version groups.
Local database/CLI callbacks are simulated; no local native run is claimed.
This publication changes only continuity/evidence documents. Existing runtime,
601 SQL source files, type manifest and schema-reference fingerprint stay exact.

## Current boundary

The ordinary clean job is still FAILURE because later envelopes are not yet
implemented. Next is native53–56 from canonical-user-rbac-repair-batch.py,
then remaining foundation57–144 and all514 timestamp stages. Full independent
schema semantics, auth-email, generated types and mandatory OPS/E2E acceptance
remain open. Do not label through52 as complete or rerun old8ec1cef8 as a fix.

This receipt supersedes the active43-only status and the quoted failure from
run34868620937, not their historical records. No main merge, hosted database
call/mutation, original migration rewrite, fake ledger or deployment occurs in
this receipt update. Existing application and paused partner work is preserved.
