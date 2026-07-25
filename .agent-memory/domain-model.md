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
