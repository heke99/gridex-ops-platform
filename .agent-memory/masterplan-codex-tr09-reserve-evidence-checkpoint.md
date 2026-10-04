# TR09 reserve evidence checkpoint — 2026-10-04

Status: IMPLEMENTED_NOT_VERIFIED. Owner scope is the new native test, its one
native-config registration and this checkpoint in the isolated TLS/reserve
clone. Base: `05c6e8b7e8a4399ec0e5e50358eb6d9e2231f72e`.
No shared #503 checkout, product source, migration, private source row,
generated artifact, frozen specification or coverage status was changed.

Skill routing: Supabase source/ACL guidance and verification-before-completion
apply. Literal TR09/AT-TR09 review uses the frozen annex requirements and the
verified T original. This bounded test addition is not a repository-wide
quality/security audit, platform upgrade, UI or production deployment; those
workflows are outside this owner scope. The parent owns integration/review/CI.

Reviewed TR09 in annex A lines 1525–1539, AT-TR09 in annex D lines 2176–2188,
and T §3.1 plus the certificate/cache/CRL provisions in annex A. T SHA256:
`5204d4514774b04b8eedb039e1f4799ed447c7fef14554577935e2d7bd93f951`.
The actual extracted original places the cache/fallback wording under A.4.5;
the masterplan references the enclosing technical annex. No wording was edited.

Added `scripts/ediel-tr-09-reserve-source-native.test.ts`, nine native cases:

- Exact completed empty X.500 source permits its own plaintext original only
  with the actual reserve selector, preserves exact raw/original bytes and
  creates a separate operation, event journal and administrator alarm.
- Incomplete/nonempty searches, invented cases, foreign tenant/environment/
  route/recipient/original, missing TLS/counterparty conditions, stale/mismatched
  and unbounded approvals fail with no partial source/operation/SMTP effects.
- Current TLS route changes and a recipient cache published by the real
  restricted certificate owner invalidate an earlier no-certificate source.
- Revocation between actual prepare and the real entry RPC refuses entry and
  SMTP, retaining only the prepared deviation/alarm. The exact source refusal
  is asserted; an unrelated error or timeout cannot satisfy the test.
- An actually expired, issuer-signed cached CRL permits real S/MIME through the
  production certificate consumer only with its exact source capability and
  all URI CDPs declared failed. The decrypted single MIME body equals the
  original Latin-1 payload. Ordinary verification remains strict afterward.
- An omitted actual certificate CDP, bad CRL signature and actually revoked
  recipient remain held before operation/alarm/provider entry.
- A successful CDP, different cached CRL bytes and nonexistent/foreign
  certificate-owner selector are refused atomically by the real publisher.

Both restricted publishers use an ephemeral SET-capable membership inside an
owned local transaction, revoke it before commit and assert no lasting
SET/INHERIT member. Private authority, approvals, deviations and alarms are
produced through installed publishers/owners. Public certificate/route rows,
throwaway CA/leaf keys, clocks and upstream original claims are explicit
synthetic fixture inputs. Local temporary key material is removed in cleanup.

Verification actually executed:

- Scoped ESLint over new native file and native config: PASS, zero errors.
- Scripts TypeScript (`tsc --noEmit -p tsconfig.scripts.json`): PASS after
  narrowing fixture helpers to their common structural fields; no `any` or
  suppressed compiler diagnostics were added.
- `git diff --check`: PASS.
- Existing `ediel-transport-exception-sql-regression.mjs` with the repository's
  loopback-only Node preload: 23 PASS. This is finite SQL with declared
  predecessor/canonical/issuer fixture boundaries, not genuine native proof.
  Retained stdout: `/tmp/masterplan-tr09-reserve-finite-20261004.log`, SHA256
  `77b04fee679e8a664ed0646f71dc307f4ad02a3dbccedb00d8e93fd21d06e861`.
- Startup fixture cryptography only: mutated the final CRL signature octet;
  OpenSSL still parsed identical issuer/lastUpdate/nextUpdate, and real signature
  verification exited 1 with `verify failure`. This verifies the negative
  fixture's meaning, not the new native assertions or acceptance contract.

New nine-case native suite: NOT_RUN. Genuine owned Supabase/PostgreSQL/native
execution is reserved to root/CI. Whole TR09/AT-TR09 acceptance is unresolved;
do not infer it from lint, types, finite SQL, synthetic issuer material or the
presence of a test tag. Upstream X.500/CDP results, relay policy/all-hop TLS and
counterparty/source authority remain synthetic boundaries in these cases.
Nodemailer is the declared SMTP port; TLS assertions here prove actual sender
settings, not a handshake or every relay hop. The parent's TR08 real first-hop
suite has its own separate scope and receipt.

Next action: parent reviews the exact file, integrates the additive config
entry and obtains genuine CI results on the published combined candidate.
If native is red, diagnose the actual installed error before changing a
fixture or proposing any product correction. No approval status is promoted.
