# Email event source integrity — sixth forward migration

The only production repository writer of `inbound_operation_events` is
`lib/inbound-mail/manualInboundIngestion.ts:210`. It sets `source_transport=email`
and uses the UUID returned by the canonical `manual_inbound_messages` insert as
`source_id`. A successful update of that manual row and its resolved company
precedes both event upserts. Repository-wide searches found no alternative email
source-ID form. The foundation migration defines the relation and policies but
does not write events. A read-only live search of public `pg_proc.prosrc` found
no stored functions referencing this table. No mail contents or personal values
were fetched by this verification.

CLI `migration new manual_inbound_event_source_consistency` created
`supabase/migrations/20261013123314_manual_inbound_event_source_consistency.sql`.
Its SHA256 is
`c85e3273a86eddf2dc2911d6c1ead843d3336770939f440cd5c6a89d4cf2f8fa`.
The earlier five migrations were left untouched.

The generated stored UUID casts `source_id` only for email. A plain FK anchors
the physical manual source even when company resolution is still NULL. A second
FK enforces equal company whenever the event company is resolved. Source
deletion cascades only to the derived email event; other transports keep NULL
generated anchors and their original polymorphic identifiers/history. The
parent gets a composite unique index and the derived anchor a lookup index.
RLS, grants, producer code and the existing idempotency key remain unchanged.

Eight production-DDL PGlite cases first failed without the migration and then
passed with it, including two migration replays. They cover a committed source
reset followed by a stale event insert, cross-company inserts/upsert changes,
unresolved sources and later owned resolution, derived-email-only cascade with
byte-for-byte retained Ediel/API/webhook history, malformed email IDs, and
transport changes. This is a committed stale-reference reproduction, not a claim
of native simultaneous multi-connection scheduling. Native replay and final
generated types belong to root/portfolio.

Apply only after the reviewed D reset. The existing guarded pair reset expects
to delete its two rows explicitly; introducing the cascade first would alter
that operation and its reviewed graph. Root alone applies the migration and
verifies the live outcome. This preparer performed read-only live metadata
queries and local fixture writes, with no live data or schema writes.
