# Tenancy and RLS

All resolution, quote, customer, application, contract, site, metering,
switch, EDIEL, supply, settlement, billing, invoice, payment, document, event
and communication access must be scoped by `company_id`.

Integration API resources are resolved from the authenticated client. Public
opaque IDs are accepted only after tenant verification. Two-tenant tests with
overlapping external references are required before release verification.
