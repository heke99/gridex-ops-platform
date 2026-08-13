# EDIFACT envelope

Envelope construction is centralized under `lib/ediel/core`. UNA syntax, UNB parties/subaddresses/Application Reference, UNH message identity, UNT segment count and UNZ interchange count are generated and validated together. Business, interchange, message and transaction references remain distinct. The immutable rendered payload hash is stored before outbox dispatch.
