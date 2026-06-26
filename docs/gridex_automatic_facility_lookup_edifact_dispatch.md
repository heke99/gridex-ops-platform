# gridex_automatic_facility_lookup_edifact_dispatch

## Purpose

This patch closes the gap after `gridex_automatic_customer_intake_foundation`: a facility lookup request that becomes `ready_to_send` through a business-approved production Ediel route is now dispatched into the Ediel outbox instead of staying as a manual work item.

## Default channel for missing facility_id

The **default** channel for a missing `facility_id`/anläggnings-id is the **manual e-mail** pipeline (`requestMissingFacilityInformation` → `manual_email_outbox`), not Ediel. The legacy Ediel facility-lookup dispatch described below only runs when `GRIDEX_FACILITY_LOOKUP_CHANNEL=ediel`. In all cases PRODAT Z01 is blocked before render when `facility_id` is missing (no `ediel_outbox`, no `render_failed`). Manual e-mail is sent from the configured **manual operations mailbox** (`manual_communication_mailboxes`, e.g. `leverantorsbyte@gridex.se`), never from `ediel@gridex.se`.

`grid_owner_information_requests.dispatch_status` allowed values: `not_started`, `ready`, `blocked`, `queued`, `sent`, `waiting_response`, `response_received`, `completed`, `failed`, `skipped`. (The value `outbound_created` is **not** allowed and must not be written.)

## Scope

- Adds first-class dispatch linkage on `grid_owner_information_requests`.
- Links `outbound_requests` and `ediel_messages` back to the facility lookup request.
- Adds `dispatchFacilityLookupEdifact()` for PRODAT Z01 facility lookup dispatch.
- Runs the dispatcher both inline from customer intake/facility lookup automation and from the customer-operations cron.
- Keeps the strict supplier-switch/customer-masterdata Z01 preflight unchanged. This dispatcher is only for the facility-lookup gap where the customer, site and grid owner are known but the facility/metering identifier is missing.

## Lifecycle

1. Website/customer intake detects missing facility or metering point.
2. `ensureFacilityLookupAutomation()` creates or upgrades a `grid_owner_information_request`.
3. If production route readiness and business approval are green, the request becomes `ready_to_send` with `dispatch_status = ready`.
4. `dispatchFacilityLookupEdifact()` creates an outbound request, renders PRODAT Z01, finalizes an Ediel message and queues it.
5. The request moves to `waiting_response` and stores:
   - `communication_route_id`
   - `ediel_route_profile_id`
   - `outbound_request_id`
   - `ediel_message_id`
   - `operation_id`
6. Inbound facility response handling can then complete the request and trigger supplier-switch readiness.

## Regression

Run:

```bash
npm run gridex:automatic-facility-lookup-edifact-dispatch-regression
```

Recommended after applying SQL:

```bash
npm run gridex:automatic-customer-intake-foundation-regression
npm run gridex:facility-lookup-manual-workflow-regression
npm run gridex:inbound-facility-recognition-regression
npm run gridex:automatic-facility-lookup-edifact-dispatch-regression
npm run typecheck
npm run build
```
