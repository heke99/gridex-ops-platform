# Retired manual-inbound source — independent final review

No blocker found in the bounded migration/adapter contract. This was a read-only source/security review with isolated local runtime tests; this workstream performed no live mutations or publication.

## Reviewed frozen sources

- `supabase/migrations/20261013140502_manual_inbound_retired_source_consistency.sql`, SHA256 `d68f09fa4ab18d62fbffa8c412d8fa53fa1db3d58e53ed519f45af1fc145fee0`.
- `lib/inbound-mail/manualInboundIngestion.ts`, SHA256 `c6dba0e3027f5c4cf1c37e60ae8dc09c80cca4c5e26cb307d3dfbaf8c2277515`.

The private registry stores only a 32-byte SHA256 source key and retirement time. JSON-array tuple encoding preserves boundaries. Both SQL and actual persistence use normalized lowercase/trimmed mailbox plus trimmed, case-sensitive provider ID. The same provider under another mailbox, a different provider, and differently cased provider IDs remain distinct.

An authorized raw-source DELETE retires only its OLD key in the same transaction. No existing row is backfilled or deleted by the migration. Existing source grants/RLS are unchanged; the native authenticated own-row/foreign-row fixture verifies that the definer trigger does not grant permission to delete another tenant's source. Failed/rolled-back deletion rolls retirement back. Existing migration123314 email-only FKs cascade only the deleted raw source's derived email projections.

The direct INSERT guard, DELETE retirement and public lookup share an advisory key lock. The privileged trigger and lookup functions are explicitly VOLATILE, fully qualify non-built-in objects and use fixed `pg_catalog,pg_temp` search paths. The native two-session proof confirms that a waiting INSERT sees committed retirement and raises exactly SQLSTATE23514/message `manual_inbound_source_retired`; a waiting service lookup returns true. Both leave zero raw rows.

Registry RLS is enabled. Public/anon/authenticated privileges are revoked; service has bounded read access and public lookup EXECUTE, with a second service-role runtime gate. Private helper/trigger EXECUTE and direct registry modification/TRUNCATE are denied. Owner-level accidental UPDATE/DELETE/TRUNCATE are rejected by immutability triggers. No mailbox, provider ID, sender, subject or body is retained in the registry.

The ingestion adapter probes before raw persistence and requires a boolean response. A lookup error, thrown transport error or malformed response remains a failure. Only the exact retired-source INSERT error is converted into `ignored` for the lookup/insert race; unrelated CHECK/FK/other errors are propagated. Ignored results have null source/request/company IDs and invoke no correlation or business persistence. Existing raw idempotency and missing-provider handling remain.

The actual webhook accepts the ignored result successfully. The actual poller counts ignored, clears its attempt state and marks the UID Seen; new mail in the same poll continues normally. A lookup failure stays unseen and writes neither raw nor derived events. The existing plain-object error formatting was not changed.

## Verification

- `retired-source-independent-verification-results.json`: **34/34 passed, zero skipped** across the new SQL8 cases, new actual ingestion/poller18 cases and forecast producer8 cases (including the added embedded-customer array case).
- All captured source/test hashes remained unchanged during this independent run (`retired-source-independent-provenance.json`).
- Peer final regression: new adapter18 plus prior inbound30 =48/48 passed; source/test scoped ESLint and whitespace checks passed.
- Reviewed runnable isolated native fixture `cleanup/manual-inbound-retired-source-native.sql`: double migration, unchanged original ACL/RLS, exact authorized retirement/replay, distinct keys, private ACL and immutable registry.
- Reviewed isolated native PostgreSQL17.5 race script/receipt: INSERT waited1.022s then exact23514; lookup waited1.042s then true; raw0 in both cases. The script refuses non-loopback/non-fixture database targets. No production credentials or source content are part of its evidence.

## Type repairs and delivery boundary

The audit page's removed `scope.message` block was unreachable legacy UI: the central scope now fails closed before tenant-null reads and has no such field. Its data filters and platform mode are unchanged. Forecast embedded-customer array/object normalization preserves same-company portal exclusion and real/orphan diagnosis; the independent eight-case suite passes. The PGlite adapter at `cleanup/customer-source-consistency.test.ts:79` passes the same real validator/writer client through `unknown` to `Parameters<typeof saveMeteringPoint>[0]`; this is an erased type assertion. The adapter still restricts the target table, records exact filters and executes real SQL, and the scanner/source assertions are unchanged.

The original198-case scope proof remains preserved as the completed earlier snapshot. Apply the ninth migration and expose its generated RPC type before shipping the adapter, because missing lookup/schema state fails closed. Root owns final generated types, build/CI, live cleanup and deployment.

The registry protects exact keys retired by authorized deletion after installation, including the presently classified source pair. This review does not claim that a newly observed provider key equals an earlier unarchived key, and does not infer retrospective source identity from equal content or a prior zero count.

References used: Supabase `supabase` and `supabase-postgres-best-practices` skills; current [Securing your API](https://supabase.com/docs/guides/api/securing-your-api) and [Row Level Security](https://supabase.com/docs/guides/database/postgres/row-level-security) documentation. The changelog fetch was unavailable through the environment proxy; current documentation was retrieved through the Supabase docs connector. No implementation depended on a new Supabase API feature.
