# AI context: OPS website intake, facility workflow and customer card

## Scope

This context covers the multi-tenant website-to-OPS flow and the OPS-E/OPS-F customer operations layer. Gridex is the first tenant, but no logic may assume Gridex-only data.

## Non-negotiable rules

1. Tenant is resolved from the integration API client, session or server-side tenant scope. Never trust `company_id` from frontend payloads.
2. Websites display contracts from OPS. They must use `/api/v1/website/public-contracts` and submit `price_plan_version_id` or `contract_offer_id` when the customer applies.
3. Customer applications may be accepted even when facility data is incomplete, but supplier switch must not start until required data is verified.
4. Address/postal code is only a suggestion. Verified truth is grid area code, facility ID, metering point ID, admin confirmation or grid-owner response.
5. Tenant admins should not manually create/select arbitrary grid owners in normal customer intake. They should use the verified actor/masterdata registry and facility resolver output.
6. Customer card must stay simple for operators: status, missing fields, next action, communication and audit. Hide raw IDs/debug under technical views only.
7. All actions that change customer/site/metering point/facility/switch state must remain tenant-guarded and audit-safe.

## Built surfaces

```txt
GET  /api/v1/website/public-contracts
POST /api/v1/website/customer-applications
POST /api/v1/website/customer-events
GET  /api/v1/customer/me
/admin/facility-requests
/admin/work-queue
/admin/customers/[id]
```

## Facility statuses

```txt
missing_authorization      Fullmakt missing. Do not send grid-owner request.
needs_facility_data        Facility ID, metering point or price area missing.
needs_grid_owner_review    Network owner/grid area must be verified.
awaiting_grid_owner        Z01/Z02/manual request is already pending.
ready_for_switch           Data is sufficient to proceed to supplier switch.
manual_review              Automation is unsafe; admin review needed.
```

## Customer card operator flow

1. Open customer card from work queue or facility queue.
2. Read the `Snabbstatus` and `Anläggningsflöde` cards.
3. Resolve fullmakt first if missing.
4. Resolve facility data through `Uppgiftsbegäran`.
5. Continue to `Leverantörsbyte` only when facility data and authorization are ready.
6. Communication/mail stays in OPS; websites do not send business-critical customer emails directly.

## Read model

The facility queue uses `gridex_facility_work_queue_v` and `gridex_get_facility_work_queue(p_company_id, p_limit)`. If the migration is not present yet, the TypeScript helper falls back to direct reads from `customer_sites`, `metering_points`, `customer_info_requests`, `grid_owner_data_requests`, `powers_of_attorney` and `grid_owners`.

## Common failure modes to avoid

- Creating a second website-client or webhook model when `integration_api_clients`, `domain_events`, `event_outbox` and `webhook_deliveries` already exist.
- Starting supplier switch because address/postal code found a possible grid owner.
- Showing raw `uuid`, `raw_payload`, `null`, `undefined` or internal event names in normal tenant UI.
- Letting tenant admins bypass verified actor registry by manually typing grid owners during normal intake.
- Sending customer confirmation from website instead of OPS mail templates/sender identity.
