# Customer card operational snapshot follow-up

This patch makes the customer card use one shared operational snapshot for the standard view.

## Main changes

- `customerCardSnapshot` now also understands legal acceptances, customer documents, events and work queue style missing fields.
- Power of attorney is valid when either a signed POA row or an available `customer_documents` POA document exists.
- Legal readiness no longer depends only on strict `acceptance_type`; it also tolerates existing acceptance rows and metadata/snapshot values.
- The standard customer card uses simple wording for missing facility ID, metering point and grid owner.
- Technical words such as route, PRODAT, Z01/Z03 and Ediel are kept out of normal blocker text where possible.
- Customer card components receive the same snapshot instead of independently guessing fullmakt/legal/readiness.

## Still intentionally technical

Platform-admin-only Ediel sections still show Ediel/PRODAT details. Ordinary customer-card flow should use the standard words: Begär uppgifter and Begär leverantörsbyte.
