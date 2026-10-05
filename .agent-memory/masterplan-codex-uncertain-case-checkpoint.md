# Codex isolated TR-10 reconciliation-case implementation

Base: `33b9f3d4b5f13dddd62781fa0d9ccef525c54149`; branch
`codex/ediel-tr10-reconciliation-20261004`, isolated checkout
`/workspace/gridex-masterplan-uncertain-case`. Root owns TR-05/TR-10 integration,
worker lease fences, GitHub coordination, native workflow/config, migration
register/checksums, generated capture/types, full-suite checks and acceptance.

Complete frozen scope read: TR-10/AT-TR-10, SC-063 and SYS ST-T04. SMTP is not
exactly once; unknown entry never permits blind business resend. A technical
tracking case is separate from customer/business cases and has no resolution API.

CLI-created forward:
`20261004204835_ediel_unknown_transport_reconciliation_cases.sql`.
SHA256: `61beb70a0b8b4837d0356dfe86c2c1a9a4798f74dc549b0292af63f79cde2cb8`.
CLI `/tmp/masterplan-native-bin/supabase migration new` succeeded with only
`/home/agent/.supabase` telemetry-directory write permission. No HOME override,
remote database use, historical migration changes or manifest edits.

Private RLS/no-DML immutable cases and opening logs derive tenant/environment,
lane/attempt, genuine actor origin, original/binding/MIME hashes and exact unique
retained archive metadata. Producers share the actual observation transaction:
generic first unknown; sealed uncertain event with a committed ENTRY witness;
and public sending→delivery_uncertain with the exact OLD genuine worker claim
matching an entered private unresolved attempt. Sealed result witness is not
required before its INSERT; it can only be obtained after commit. Publisher
failure rolls back observation/case/log but leaves previously committed entry.
Known accepted journal plus projection failure creates no false unknown case.

Existing transport-copy RPC is patched with exact body guards and full pg_proc
metadata equality (OID/signature/owner/ACL/defaults/settings preserved), obtains
the current graph lock before current tenant authorization, and exposes bounded
cases independently of archive availability. The opening is immutable; current
known outcome is derived from that same private observed attempt, or committed
sealed result+witness. It means outcome_observed, never delivery proven or resend
authority. Reader and GET explicitly project case fields without payload bytes,
archive paths, RFC/email addresses or caller approval fields.

Test-first RED: actual generic prepare→enter→observe ETIMEDOUT/DATA produced
unknown SMTP copy but reconciliationCases was absent (`undefined !== 1`). Finite
fixtures declare upstream actor/source/archive/queue dependencies, including
public original_message_id TEXT; no finite pass is native source/legal proof.

Verified locally:
- finite actual SQL: **29 checks PASS**, including both lanes, replay, exact
  opening/archive/actor identity, no resend/release, held archive, revoked/foreign
  reader, correct claim versus mismatched worker/pre-entry/known acceptance,
  committed sealed entry witness requirement, private helper ACL, application
  no-DML, owner append-only UPDATE/DELETE/TRUNCATE and final log failure rollback;
- Node 22 retained wrapper **1/1 PASS**, with loopback boundary preload and
  explicitly enabled child-process sandbox permission (network permission is
  used for the runner; preload denies external sockets);
- actual reader/GET unit **38/38 PASS** across own and existing transport API
  files; auth/RPC ports are explicit finite fixtures;
- app and scripts TypeScript **PASS**, targeted ESLint **PASS**, diff check PASS.

`scripts/ediel-tr-10-reconciliation-native.test.ts` contains **9 native tests**:
actual after-DATA owner/case; actual pending worker/sweep/late acceptance;
genuine pre-entry exclusion; accepted projection-fault exclusion; publisher
rollback and later sweep; held archive/current revoked and foreign scope; actual
RLS/ACL/owner immutability; genuine national H sealed unknown and witness ordering;
genuine sealed worker crash/late witnessed outcome and unchanged source/period/
mandate receipts. Only SMTP and browser-cookie client factory are replaced;
local GoTrue/JWT, source generation, archives and all private owners are real.
Synthetic local legal/source competence remains explicit, not real market/legal
acceptance. Existing H helper uses its declared October 2026 dates unchanged.

**Native execution pending root CI. No TR-10 coverage approval, external SMTP
delivery proof, legal acceptance or future composed-prefix proof is claimed.**
