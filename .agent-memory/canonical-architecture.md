# Canonical architecture

- Server-side API key authentication resolves tenant/company/client/scopes.
- External clients never select tenant with `company_id`.
- OPS owns energy resolution, public offers, market references, quotes and
  immutable price snapshots.
- Customer lifecycle state is tenant-scoped and durable; external side effects
  occur after commit through outbox/continuation workers.
- Supplier-switch creation, dispatch and supply activation are separate states.
- Metering, settlement, billing underlay, invoice and payment are distinct
  aggregates.
- Customer portal is a read projection, not a competing state machine.
- End-customer billing and Gridex platform billing are separate domains.
