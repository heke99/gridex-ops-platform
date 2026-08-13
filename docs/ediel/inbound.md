# Inbound

Inbound evidence is stored before parsing. Tenant resolution uses receiver identity, subaddress, environment, mailbox and active route data; mailbox tenancy may not override EDIFACT identity. Ambiguous/unresolved traffic is quarantined. Valid traffic is parsed and validated before business matching and ACK/domain processing.

Aggregate UTILTS profiles do not require a metering-point match. Accepted traffic without a complete domain handler must remain explicit review work, never a silent success.
