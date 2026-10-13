# Retired manual source identity

The ninth CLI-created forward migration closes the confirmed replay gap after
an authorized raw source deletion. It changes no existing source rows and retires
nothing during deployment. Root owns the separately fingerprint/classification-
guarded current deletion and its fresh outcome.

`20261013140502_manual_inbound_retired_source_consistency.sql` is frozen at
SHA256 `d68f09fa4ab18d62fbffa8c412d8fa53fa1db3d58e53ed519f45af1fc145fee0`.
Only one new public API is added: service-only
`gridex_manual_inbound_source_retired_v1(p_mailbox text,p_provider_id text)` returns
boolean. The source adapter owner calls this before persistence, ignores exact
retired messages without recreating rows/events and propagates lookup failures.
The exact direct-insert race signal is SQLSTATE23514 and message
`manual_inbound_source_retired`; other failures must remain failures.

A new private schema holds only 32-byte SHA256 keys and their retirement time.
The normalized mailbox and case-sensitive trimmed provider ID are encoded as a
JSON tuple before UTF8/SHA256, preserving boundaries and Unicode. Built-in
`sha256(bytea)` avoids an extension dependency. No mail address, provider ID,
sender, subject or content is retained in the registry. Missing stable provider
keys keep existing handling; distinct provider IDs and mailboxes remain allowed.

The source BEFORE DELETE trigger retires only its actual OLD identity; it cannot
retire a caller-supplied arbitrary message. Original source row authorization and
RLS still determine whether the DELETE reaches this trigger. The private trigger
runs as definer with fixed search_path and fully qualified references, has no
caller EXEC grant and grants no new source-table rights. The registry is RLS-
enabled/read-service only; direct mutation is not granted even to service_role.
UPDATE/DELETE/TRUNCATE are rejected as immutable, including owner accidents.

Source INSERT, retirement and service lookup share a per-key advisory transaction
lock. Their explicitly VOLATILE query bodies obtain a fresh SPI snapshot after
waiting. Native multi-connection tests proved a waiting raw INSERT sees the
committed retirement and rejects it, while a waiting service lookup returns true.
The source-deletion transaction and registry insertion roll back together.

PGlite8/8 and native PostgreSQL17.5 static ACL/RLS/replay plus two-connection
regressions passed. The first direct late-insert test reproduced successful raw
recreation before the migration. The native fixture compares unchanged source
relacl/RLS, double-applies the real migration, verifies no initial retirement and
checks authorized own deletion versus foreign RLS refusal. It models owned-row
permissions; root independently owns authentic schema/policy replay and type
capture. See `manual-inbound-retired-source-proof.json` and
`manual-inbound-retired-source-native-race-proof.json`.

This preparer made local fixture writes and read-only live diagnostic queries,
with no live data/schema mutations, global memory changes or prior applied SQL
rewrites. The earlier743-row/140-table/17-scope reset remains a historical verified
receipt; root records the new current outcome after targeted retirement/deletion.
