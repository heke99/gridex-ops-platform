# E035B prerequisite: immutable newly received PRODAT source

Baseline: accepted main `7409e28c307a450ac6618655b8ded27ee9df2f51`, tree `464605f7f87beca7d6466ba2fda5a32eac2ad9d4`. PR366 acceptance is comment5762431044; its pre-merge memory is superseded, not unfinished code. This is the next bounded source-integrity prerequisite, NOT the complete dated structure loader or E61/E62 implementation.

## Source and actual finding

Masterplan CALL-09 requires an immutable raw record. E035 requires independently dated structural information, not an observed snapshot treated as authority. Existing `ediel_messages` already has `immutable_payload_hash`; `gridex_validate_ediel_message_contract` and its BEFORE INSERT/UPDATE trigger seal only outbound canonical raw messages. Its final guard rejects raw/hash changes only when the OLD hash is nonnull. New inbound PRODAT is consequently not automatically sealed. This is a source-retention contract gap under an authorized database write, not proof of a live exploit, corrupted production history, or inadequate SMTP archive cryptography.

Traced real writers: `lib/ediel/db.ts:createEdielMessage`, `lib/inbound-mail/inboundStatusUpdater.ts:createInboundEdielMessage/createUnresolvedInboundEdielMessage`, and diagnostic inserts in `lib/inbound-mail/edielMailboxPoller.part-2.ts`. Several bypass `createEdielMessage`, so a TypeScript-only helper fix would be incomplete. `lib/ediel/inboundCases.ts` already persists object/register projections in applications/operations; these must not be duplicated or relabeled as expected structure.

The current canonical trigger body is in `supabase/schema.sql` and historical migrations; retain its current search_path public/extensions/pg_temp and all company/environment/outbound route/rule-pack/source-operation checks. All old triggers, permissions, types, constraints, and unrelated behavior stay unchanged.

## Bounded proposed change, after source/design and real RED

One new forward migration replaces only the current trigger function body. On INSERT of direction inbound, family PRODAT, compute the existing immutable hash from the exact UTF-8 `raw_payload`. Do not trim, normalize, parse, or certify those bytes. Empty/whitespace strings are received bytes too; a hash is not guide acceptance. Null raw means no received payload and a null hash, regardless of caller-supplied hash. Override a supplied stale/forged hash on insertion. Do not set immutable_rendered_at for inbound: this is receipt, not rendering.

Keep the existing old-hash update guard unchanged, including reclassification attempts and attempts to change both raw and its hash. Parsing/validation diagnostics remain mutable without changing the raw. UPDATEs do not automatically seal or backfill pre-existing unsealed data, including later filling an originally null row; those records remain unqualified. No existing source, hash, migration or type is rewritten. No DELETE protection, context immutability, cryptographic authenticity, complete source history, actor authority, business-time or supersession proof is claimed.

## Test-first real database oracle

`ediel-inbound-prodat-source-regression.sql` adds60 physical PostgreSQL checks in one rollback-only synthetic transaction. The existing manual-inbound regression entrypoint includes it after its original rollback; all old statements and assertions are preserved. The unchanged ordinary OPS clean-migration-replay job executes that entrypoint on its owned empty replay database, not production. Tests are new company A/B, test/production, exact Unicode/CRLF/release bytes, empty/whitespace input, caller hashes, raw/hash/reclassification mutation, null/later unqualified data, metadata updates, other families, retained existing seal/company/environment/outbound guards, and service-role insert. Separate fresh rows isolate negative cases. The test records all outcomes and requires the exact60 inventory. Meaningful original RED must be storage behavior, not syntax, setup, missing profile, dependency, or permission errors. No claimed test result yet.

## Migration and publication acceptance

Register the new forward checksum additively, preserve every historical checksum. Regenerate actual schema/type evidence through unchanged ordinary clean replay. A replacement trigger must have identical CLI type output; retain actual bytes only on demonstrated equality and update tail metadata truthfully. Review the normalized full SQL dump and per-section fingerprints: only this exact function body may change, no grants/policies/signatures/relation changes. The legacy restricted fingerprint does not include this function and must remain unchanged. No hash difference may be bulk-adopted.

The local workbench reconstructs the exact Git tree from existing main source artifact10645740541; network/dependencies/PostgreSQL are unavailable locally, so no local full-suite execution is claimed. If needed to transport the large generated schema blob, use a separate temporary branch-only, exact-base/expected-blob-guarded GitHub job which creates a blob only (no ref/main update, no live secrets/database/deployment). It is not a CI waiver and must not enter the delivery tree. All ordinary gates and source history are retained.

Independent SOURCE/DESIGN/ORACLE review and actual RED precede runtime. Then ordinary exact-head tests/types/build/coverage/replay plus independent TASK/SPEC, QUALITY, TENANT-BOUNDARY, WHOLE-PR review. Guarded merge only afterwards. Actual-main full73/73, allOPS, inspected artifact/hash/rows/JUnit/unit results and final PR acceptance comment conclude this bounded delivery. No receipt-only followup PR.

## Routing and remaining work

Activated: codebase acquisition, executing/writing plans, TDD, direct false-positive/source tracing, Supabase/Postgres trigger/security review, differential review, request/receive independent review, verification-before-completion and branch finishing. No unavailable subagent/scanner execution claim. Conditional systematic debugging applies to actual failures. Skip UI, Next rendering, performance, external infrastructure and broad supply-chain campaigns: no applicable change; this is not a repo-wide audit.

After this prerequisite, E035B still needs qualified environment/legal actor/object+agency/valid-time, accepted disposition, independent completeness and supersession, and a loader. Then actual E61/E62 comparison, guide-before-functional ordering, ACK/persistence and the five remaining F3 acceptance areas. Later applicable F0/F1/F2/F4/F5/F6/F7 gates remain separately evidenced, not implicitly accepted. Accepted D110/110+10/10 and PR361/363/364/366 retained. PR310 remains paused at e9611351; no import, restart, merge, live DB, provider, market, settings or deployment action.
