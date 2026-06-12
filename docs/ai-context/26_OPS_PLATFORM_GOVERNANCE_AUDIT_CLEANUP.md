# OPS platform governance, audit, usage and data cleanup

## Non-negotiable product rules

- Platform admin owns agreement and pricing governance.
- Tenant admins must not create, edit or publish price plans, price plan versions, public contract offers, legal terms or pricing components.
- Tenant admins may work with customers, facility requests, powers of attorney, supplier switching, billing readiness and support workflows for their own company.
- External websites must fetch public offers from OPS and send back `contract_offer_id`, `price_plan_id` and/or `price_plan_version_id`; websites must not submit legal price truth as free text or arbitrary fee fields.

## Customer card UX rules

Customer cards should be understandable for an electricity company operator. Avoid raw system language in the default view.

Use:
- Kundprofil
- Anläggningsflöde
- Saknade uppgifter
- Väntar på nätägare
- Redo för leverantörsbyte
- Händelselogg
- Teknisk information

Avoid in normal tenant views:
- raw_payload
- event_outbox
- debug
- mock
- placeholder
- null
- undefined
- internal_error

Technical details may be shown only under a clearly labelled technical section, preferably for platform admin.

## Audit and usage events

Every customer-card button that changes state must create audit and usage records:

- `audit_logs`: legal/revision trail.
- `platform_usage_events`: tenant-scoped usage/action statistics for SaaS billing and support analytics.

Examples:
- `customer_profile_updated`
- `customer_move_out_registered`
- `customer_soft_terminated`
- `customer.marked_as_test_data`
- `customer.archived`
- `customer.test_data_hard_delete_started`

Usage events are not a replacement for audit logs. Audit answers “who changed what”. Usage answers “what tenant activity should count for support/SaaS billing/statistics”.

## Test data and deletion rules

Real customers must not be hard-deleted from normal operations.

Correct handling:
- test/fake customer: mark as testdata, archive, and only hard-delete if it has no protected history.
- real customer: archive or lifecycle-close; anonymize only via explicit GDPR/retention process.
- real sites/metering points: archive/close, do not delete if linked to contracts, metering, billing, Ediel or switch history.

Protected history that blocks hard delete:
- active or any customer contract
- supplier switch request
- invoice/customer invoice
- billing underlay
- Ediel message
- partner export

The platform data cleanup page should be the safe workflow for cleaning bad test records. It previews candidates and shows whether permanent deletion is blocked.

## Developer docs

`/developers/customer-portal-api` must reflect the current OPS model:

1. Website fetches `GET /api/v1/website/public-contracts`.
2. Customer selects a published offer.
3. Website submits `POST /api/v1/website/customer-applications` with contract offer/version identifiers.
4. OPS creates customer, customer number, contract number and locked snapshot.
5. OPS sends legal communication and logs it.
6. Website can read customer data through customer portal endpoints after portal identity/linking.

Do not document old patterns where the website sends `contract_name`, monthly fee or markup as legal source of truth.
