# Outbound

Outbound execution resolves the tenant actor, counterparty, route, certificate, rule pack, Application Reference and immutable execution snapshot before rendering. The outbox accepts only tenant-consistent messages with an immutable payload hash. Retry reuses the same generation unless an audited superseding message is created.
