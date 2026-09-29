## 2026-09-29 — Transaction-scoped ERR response identity

A functional-negative UTILTS IDE owns its UTILTS_ERR, physical RFF+TN, full original relatedTransactionReference, source-operation key and final reservation response. Equal error codes in different IDEs do not make the responses interchangeable. Canonical ERR business process is functional_rejection. Real CALL-11 dispositions reach CALL-12 gateway/finalizer and existing CALL-13 binding; sequential retry must preserve receipt, full reservation, ACK bytes/ID/timestamps and contracts. Concurrent same-IDE reservation of ACK identity remains a separate unproved requirement.

# Domain model

Canonical correlation keys include `company_id`, `customer_id`,
`customer_number`, `application_id`, `contract_id`, `customer_site_id`,
`metering_point_id` and `correlation_id`.

Core aggregate chain:

`integration client → resolution → offer → quote → application → customer →
contract/legal/POA → site/metering point → supplier switch → supply period →
meter values → settlement → billing underlay → invoice → payment`.

Customer number is permanent per tenant. Signed contract and active supply are
not equivalent. Pricing preview, final settlement and invoice are not
interchangeable resources.

Commercial identity adds `price_option_reference`,
`price_row_reference/area_price_reference`, `component_reference`,
`component_code` and `invoice_delivery_method`. These are stable business
references, not database UUIDs. Component policy is exactly one of mandatory,
customer_optional, admin_optional or conditional.
