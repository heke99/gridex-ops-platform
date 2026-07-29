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
