# UUID actor and inet address column qualification

Status: implemented; actual owned PostgreSQL 17 workflow execution pending.
No schema/source migration, reference or central acceptance mapping changes.

Skill routing: source/code review and verification-before-completion apply to
these two changed type contracts. This is a bounded payload qualification, not
an application-wide security, ACL, network or performance audit.

`ediel_send_locks.locked_by` is UUID in the original June1 source, with a real
`auth.users(id)` foreign key and ON DELETE SET NULL. The later source's conditional
text declaration does not convert this retained UUID column. The canonical
production transition takes a UUID actor parameter and its original state writer
assigns that actor into locked_by. The admin action supplies admin.userId. Existing
`canonical-residual-readiness-native.py` separately qualifies unknown-actor 23503
and lock-row identity preservation; this new fixture does not replace that proof.

`integration_api_requests.ip_address` is nullable inet in the May31 declaration.
The application writes requestIp → trustedClientIp → normalizeIpAddress, which
uses Node isIP and returns a normalized IPv4/IPv6 string or null. Arbitrary text
is not its supported payload contract. Source and caller bytes are pinned by the
new qualifier; the audited differing reference types are not edited.

The isolated qualifier creates only temporary typed tables in a rollback
transaction. It exercises three UUID-format/null cases, five normalized IPv4/
IPv6/null cases, omitted nullable fields, and seven invalid-string 22P02
rejections through PostgreSQL jsonb_populate_record. The UUID-format cases prove
input conversion, not that a corresponding auth identity exists. inet host text
is compared for these selected compressed IP examples only; this does not prove preservation of every accepted textual spelling (for example expanded IPv6). No arbitrary textual or CIDR equivalence
is claimed. Catalog/rows and pinned sources must remain unchanged. Derived SQL
uses the established owned stdin transport; no raw SQL fixture is exported.

This is not a PostgREST HTTP, effective actor/ACL, full-column metadata, foreign-key
or release acceptance receipt. Actual SQL execution and cleanup must pass before
its bounded behavior evidence can support a later, separately bound native
schema decision. The workflow owns a network-isolated disposable PG17 target and
always invokes only that target's owner cleanup.

Local verification: five targeted Python controls and all four existing IP-policy
application tests pass under Node22. No production connection or
external message was used.
