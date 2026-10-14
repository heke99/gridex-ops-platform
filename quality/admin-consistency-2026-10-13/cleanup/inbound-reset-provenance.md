# Inbound customer-flow reset provenance

A first full reset attempt rolled back on a stale inbound event fingerprint. Automatic approval review refused the next attempt because refreshing a hash alone did not verify customer provenance. No deletes were committed.

Root then verified the current row without reading mail contents or personal identifiers: exactly one email event has business_process=power_of_attorney, intent=power_of_attorney_question, no customer/site/meter/request target, and an exact source_id match to the single unmatched manual customer-flow case. It has no source ID match to an Ediel message. The producer in lib/inbound-mail/manualInboundIngestion.ts explicitly creates this operational event from that manual case ID.

The two reset scopes are now restricted to that classification and verified source relationship; the script no longer deletes either complete inbound table. Counts and full-row fingerprints are checked again under transactional locks. Underlying inbound emails, technical Ediel messages, actor proof and unrelated event types remain preserved.
