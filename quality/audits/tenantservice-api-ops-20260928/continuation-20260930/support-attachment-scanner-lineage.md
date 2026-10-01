# T36 — authenticated private scan evidence, 2026-10-01

This package implements local scanner identity, exact intake/storage lineage, a
short-lived nonce and an immutable verdict receipt. It does **not** release a
file. Every eligibility result is blocked and `releaseAllowed=false`. T36 is
still partial: the actual malware detection provider, production consumer and
protected download path have not been qualified by these tests.

## Observed source gap and scope

The existing attachment command reserves an owner-bound object, uploads to the
private `customer-support-quarantine` bucket, commits the intake revision and
records `CUSTOMER_SUPPORT_ATTACHMENT_QUARANTINED` plus the durable
`customer.support.attachment.scan_requested` outbox event. Its public metadata
contract restricts `scan_status` to `quarantined`. Before this package there was
no authenticated scan challenge/verdict consumer or release decision.

The existing `lib/customer-cases/attachments.ts`, its public API contract, all
historical SQL and previous continuation packets are unchanged. New files are
the two server-only helpers, the CLI-created forward
`20260930234348_support_attachment_authenticated_scan_receipts.sql`, six unique
proof/config files and this report. No workflow, checksum registry, generated
schema or public release contract is changed by this owner.

## Implemented boundary

- Server-managed per-company configuration selects a public RSA/RS256 key from
  a bounded local JWKS. No remote JWKS/provider request occurs. The JWT must have
  the exact issuer, audience, subject, key ID, type, purpose, nonce, binding hash
  and a valid lifetime of at most five minutes. Unknown claims and private JWK
  material are rejected. Trusted roots are separately recorded in a private
  owner-managed table and must currently be active and unexpired.
- The authoritative binding includes company, customer, case, attachment,
  committed reservation hash/revision, scan outbox ID, bucket/object key,
  physical content hash/size and the current Storage object ID, version and
  update timestamp. Original intake actor/channel/client attribution, command
  receipt, domain event and scan intent must still match. A different owner,
  replaced attribution or missing committed lineage cannot create a nonce.
- The server privately downloads the reserved object and hashes its actual
  bytes. A correct signed verdict for changed bytes is rejected. Server trust
  and token expiry are checked again after that asynchronous read. The SQL
  recording boundary then rechecks current lineage/root, exact binding and
  nonce under locks before inserting the receipt and consuming the nonce in
  the same transaction. A late expiry or write fault rolls both changes back.
- Exact unexpired replay returns the existing receipt without a second effect;
  altered replay conflicts. Revoked roots and expired proofs are rejected even
  on replay. Current protected-read authority is checked before and after
  private byte inspection for assessment. Malicious/unknown receipts remain
  blocked, and a clean receipt explicitly reports
  `blocked_provider_qualification`. Missing evidence reports
  `blocked_unscanned`; a non-clean verdict reports `blocked_scan_verdict`.
- The shared lineage lock order is customer, case, attachment, Storage object,
  current root and nonce. Assessment first obtains the existing parent/case
  authority corridor. It does not retain a child lock while waiting for that
  parent corridor. This source review is not a native deadlock/concurrency pass.

Anon/authenticated roles have no new table or RPC access. The service role can
read roots, but cannot configure them. One narrow private `SECURITY DEFINER`
helper performs only an exact root read/`FOR SHARE` with a fixed search path and
service-only EXECUTE. This avoids granting UPDATE on the trust configuration
merely because PostgreSQL row locking requires it. Outer commands and lineage
checks remain service invokers; the existing actor helpers decide current
session, membership, customer/account relationship and support permission.
Challenges cannot have their binding replaced; receipts cannot be updated or
deleted. No scanner text, client-supplied verified flag or database clean value
can authorize a public download.

## Executed evidence

| Proof | Actual result | Limit |
| --- | --- | --- |
| Positive SQL feature without the new forward | RED: missing RPC, SQLSTATE `42883` | Proves the original implementation gap |
| Actual forward/helper SQL in PostgreSQL 17.5 through PGlite | **8/8 PASS** | Bounded core schema; not full Supabase history or Storage service |
| Actual local RS256 verification and server adapter runtime | **14/14 PASS** | Controlled Storage/RPC adapters; no provider/HTTP claim |
| Scoped ESLint and narrow source/runtime/native TypeScript | PASS | No new broad project gate was run by this owner |
| Independent billing-owner source review | No concrete new authority/signature/nonce/lineage/replay/lock-order bypass found | Read-only source review, no independent native execution |
| Genuine disposable Supabase native suite | **8 authored, 0 executed — NOT_EXECUTED** | Requires root CI execution and actual results |

Three additional meaningful negative cases exposed bugs in this new candidate,
then passed after the corresponding fix. They are candidate corrections, not
claims of a previously reachable public exploit:

1. A real SQL wait let the trusted root expire during nonce insertion: initial
   candidate **6 PASS / 1 RED**, then **7/7 GREEN** after post-lock/post-insert
   database-clock checks with rollback.
2. Removing current server trust during the private byte read initially still
   allowed recording a previously verified proof: focused **RED**, then runtime
   **14/14 GREEN** with the second current-trust/token check.
3. Changing an otherwise owner-matching attachment's intake actor attribution
   initially let it retain the original intake receipt: focused **RED**, then
   actual SQL **8/8 GREEN** with exact original actor/channel/client/domain
   attribution checks.

Core cases cover exact one-use receipt/replay, owner/intake/object/binding/hash
denial, altered replay/root revocation/expiry, malicious/unknown states, current
read authority, low-role denial, late receipt-consumption failure rollback,
database-clock root expiry and replaced intake attribution. Runtime cases also
cover forged/unconfigured keys, signatures, claims, physical byte changes,
forged paths, current authority and trust changes during asynchronous reads,
and an asserted release result being rejected.

Reproducible local commands:

```sh
NODE_PATH=/tmp/ediel-service-check/node_modules /tmp/ediel-toolchain/node_modules/node/bin/node --test scripts/support-attachment-scan-20260930.postgres.test.cjs
/tmp/ediel-toolchain/node_modules/node/bin/node node_modules/vitest/vitest.mjs run --config scripts/support-attachment-scan-20260930.config.ts
```

Prepared root native command:

```sh
CI=true GRIDEX_NATIVE_STATUS="$candidate_status_path" node node_modules/vitest/vitest.mjs run --config scripts/support-attachment-scan-20260930-native.config.ts
```

The native config requires an authentic disposable loopback Supabase status
file. Fixtures use actual Auth/session, support commands, Storage bytes, public
intake lineage and private roots for a controlled test issuer. Cases include
two real transaction replay, a late trigger fault, current root/session
revocation, real expiry and parent-held intake/scanner interleaving. Synthetic
issuer keys do not qualify a production scanner. No external scanner/provider
is called. Immutable intake/scan evidence and its synthetic company/object are
retained until stack disposal; only fixture-owned fault hooks are removed.

## Remaining exact outcomes

T36 gains a locally verified private evidence boundary; it is **not fully
verified or wholly externally blocked**. The production outbox consumer and
authenticated callback binding are still implementable local work. Protected
read/download transport, current ownership at delivery, expiry/replay of any
download capability, safe content disposition/type, caching/security headers
and callback/transport resource limits also need their own implementation and
actual HTTP/native proofs. These helpers are currently not connected to such
routes and return neither file bytes nor a download URL.

The actual approved malware detection provider, scanner delivery credentials
and its measured verdict behavior are separate external qualifications. They
have not been supplied or exercised here. Physical Storage version/update
atomicity, actual full-history privileges/ACL reachability and native
concurrency remain pending genuine execution. A later receipt cannot remove
any of these qualifications, and every decision remains blocked until the
complete release boundary has independent evidence.

This is bounded T36 evidence relevant to T25/T42 current-authority/security
checks. It does not settle those wider requirements, the full 75-row inventory
or the OPS/browser/masterplan acceptance denominator.
