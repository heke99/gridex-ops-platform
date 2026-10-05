# Message/MIME retention review consumer — 2026-10-01

This package connects the existing class-bound native archive, separate review,
revocation and purge consumers to actual HTTP routes and an administrator page.
The root integration owns the shared authenticated `retentionHttp.ts` dependency
and navigation; it is read-only here and excluded from this package's commit.

Routes under `/api/ediel/message-content-retention` submit actual legal-decision
bytes, read a selected decision, download its native-hashed archived legal
document, review, revoke and purge. `/admin/ediel/message-content-retention` uses
these routes. GoTrue user, server-selected company, actual native current grants
and class determine scope. Caller company/actor, completion flags, malformed or
oversized documents are rejected. No source/MIME bytes are exported by the reader.

The CLI-created forward migration is
`20261001022426_ediel_blob_retention_review_reads.sql`; dependencies are immutable
00500, 00700 and 00710. Its reader locks native actor/class authorization and
returns immutable document/source/target hashes, real review history and actual
purge events. Only a current own reviewer may retrieve legal-document bytes.
MIME physical completion requires the existing actual Storage-delete/readback
consumer's native physical event. SQL metadata deletion alone returns false.

Independent review also found that 00710 did not add a native class check to
blob revocation. The new wrapper reads the actual immutable decision class in
the same transaction, repeats current class authority and hides the predecessor
from application roles. Red regression against the unwrapped 00700/00710 consumer
failed with "Missing expected rejection" under a current class DENY. The new
consumer rejects that operation without adding a revocation and passes green.

Executed locally on isolated baseline 0404b6d8 plus this package:

- HTTP/current-session and two-phase domain unit suites: **25/25 PASS**. Scope
  includes actual unchanged bytes, current session mismatch, wrong company and
  class, malformed/oversized body, held review, storage-pending receipt, document
  hash mismatch and forbidden caller physical-completion claim. These are finite
  synthetic external-port units, not genuine legal/native/physical proof.
- Actual forward SQL on PGlite PostgreSQL 17: existing E/F/G/archive/retention
  phases passed plus **11 reader/revocation mechanisms**. All issuer/legal/source
  boundary records are explicitly synthetic. No genuine issuer is asserted.
- Application and scripts typechecks passed; scoped ESLint and diff checks passed.

The existing native MIME-retention suite now additionally reads the exact legal
document and hashes through real authenticated local RPC, rejects foreign scope
and current reviewer DENY, observes false physical completion before HTTP Storage
deletion and true only after actual JWT remove/readback and native finish.
That native suite is **NOT RUN locally**: Docker/PostgreSQL/Supabase are unavailable.
Root must execute native/HTTP, interactive browser, build and exact-head CI at the
same frozen candidate. This package does not approve DB05 or any whole masterplan
criterion. Genuine issuer/legal decisions and approved periods remain absent and
held; other byte-copy classes have separate owners and class-bound decisions.
