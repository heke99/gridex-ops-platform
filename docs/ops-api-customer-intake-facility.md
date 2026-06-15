# OPS API: website intake, public contracts, customer events and facility workflow

This document is the integration contract for external tenant websites and customer portals using the Gridex OPS platform. The API is multi-tenant by design: the website must authenticate with an integration API client that is bound to exactly one company/tenant. OPS derives `company_id` from that API client. External websites must never send a free `company_id` and expect OPS to trust it.

## Authentication

All website endpoints use the existing integration API client model.

Expected headers:

```http
Authorization: Bearer <integration_api_key>
Content-Type: application/json
Idempotency-Key: <stable unique key for retry-safe POST requests>
```

The API client must have the required permission for each endpoint. Typical website client permissions are:

```txt
website_contracts.read
website_applications.write
website_events.write
```

## Public contracts

```http
GET /api/v1/website/public-contracts?customer_type=private
```

Returns only public, active contract offers for the tenant connected to the API key.

Response:

```json
{
  "data": [
    {
      "id": "offer-id",
      "offer_reference": "offer_opaque_reference",
      "contract_offer_id": "offer_opaque_reference",
      "campaign_version_id": null,
      "product_code": "variable_spot",
      "name": "Rörligt elpris",
      "public_name": "Rörligt elpris",
      "description": "Elpris med rörligt spotpris och påslag.",
      "contract_type": "variable_spot",
      "type": "variable_spot",
      "billing_model": "spot",
      "customer_type": "both",
      "monthly_fee_sek": 59,
      "invoice_fee_sek": 19,
      "markup_ore_per_kwh": 1.5,
      "spot_markup_ore_per_kwh": 1.5,
      "variable_fee_ore_per_kwh": null,
      "fixed_price_ore_per_kwh": null,
      "green_fee_mode": "none",
      "green_fee_value": null,
      "terms_version": "2026-06",
      "withdrawal_version": "2026-06",
      "valid_from": "2026-06-01",
      "valid_to": null,
      "is_public": true,
      "is_active": true,
      "sort_order": 10
    }
  ],
  "tenant": {
    "company_id": "resolved-from-api-client",
    "api_client_id": "client-id"
  }
}
```

Website rule: send `offer_reference` back when the customer applies. Legacy `contract_offer_id` is accepted only as the same opaque offer reference. Do not submit internal price plan IDs or only the visible contract name.

## Customer application

```http
POST /api/v1/website/customer-applications
```

Minimum payload:

```json
{
  "external_customer_id": "WEB-20260612-0001",
  "source": "elbolagets-hemsida.se",
  "customer": {
    "customer_type": "private",
    "first_name": "Sara",
    "last_name": "Karlsson",
    "personal_number": "19900101-1234",
    "email": "sara@example.se",
    "phone": "+46700000000"
  },
  "site": {
    "street": "Exempelgatan 1",
    "postal_code": "11434",
    "city": "Stockholm",
    "move_in_date": "2026-07-01"
  },
  "metering_point": {
    "metering_point_id": null
  },
  "contract": {
    "offer_reference": "offer_opaque_reference",
    "requested_start_date": "asap"
  },
  "consents": {
    "terms_accepted": true,
    "power_of_attorney_accepted": true,
    "cancellation_right_accepted": true
  },
  "metadata": {
    "utm_source": "website",
    "landing_page": "/rorligt-elpris"
  }
}
```

Successful response:

```json
{
  "data": {
    "status": "application_received",
    "customer_id": "uuid",
    "customer_number": "DX-100023",
    "application_id": "uuid",
    "application_number": "APP-20260612-0001",
    "contract_id": "uuid",
    "contract_number": "AVT-DX-100023-001",
    "contract_price_snapshot_id": "uuid",
    "missing_fields": ["metering_point_id", "facility_verified", "power_of_attorney"],
    "blocking_reasons": ["mätpunkt saknas"],
    "next_step": "facility_data_requested"
  }
}
```

Processing rules:

1. OPS resolves tenant from API client.
2. OPS validates the chosen public contract against the same tenant.
3. OPS creates or reuses customer using idempotency and duplicate checks.
4. OPS creates customer site and metering point when data is available.
5. OPS creates customer contract and immutable contract price snapshot.
6. OPS runs energy/facility resolver when address, postal code, grid area or facility data exists.
7. OPS creates blocker/work-queue items when facility data, fullmakt or verified grid owner is missing.
8. OPS emits domain events and communication triggers.

## Customer events

```http
POST /api/v1/website/customer-events
```

Allowed event names follow `customer.<event_name>`, but support/case events are outside Ops scope and must not be sent. `customer.support`, `customer.support_*`, `customer.case` and `customer.case_*` are rejected with `422 support_out_of_scope`.

Example:

```json
{
  "event_type": "customer.opened_contract",
  "external_customer_id": "WEB-20260612-0001",
  "occurred_at": "2026-06-12T09:00:00Z",
  "payload": {
    "contract_number": "AVT-DX-100023-001"
  },
  "metadata": {
    "page": "/mina-sidor/avtal"
  }
}
```

OPS stores allowed operational customer events in `customer_events`, emits a `domain_events` row and lets the event outbox/webhook layer deliver it to configured tenant destinations. OPS does not create, route or log support cases.

## Facility workflow / work queue

Facility data is handled inside OPS, not by forcing the customer or website to choose network owner manually.

Rules:

```txt
Address/postal code = proposal or strong match.
Grid area/facility ID/metering point/admin confirmation = verified truth.
Supplier switch is blocked until facility data is verified enough for the process.
```

The admin UI surfaces this in:

```txt
/admin/facility-requests
/admin/work-queue
/admin/customers/[id]?tab=data-requests
/admin/customers/[id]?tab=authorization-documents
/admin/customers/[id]?tab=switch-operations
```

Facility statuses:

```txt
missing_authorization      Fullmakt missing; outbound to grid owner blocked.
needs_facility_data        Facility ID, metering point or price area missing.
needs_grid_owner_review    Grid owner/grid area not verified enough.
awaiting_grid_owner        Request sent/queued; wait for Z02/manual response.
ready_for_switch           Data is sufficient for supplier switch.
manual_review              Cannot safely automate; admin must review.
```

## Customer card operator flow

The customer card should be used in this order:

1. Open the customer from `/admin/work-queue`, `/admin/facility-requests` or `/admin/external-contract-intakes`.
2. Read the top status and the `Anläggningsflöde` card.
3. If fullmakt is missing, go to `Fullmakt / avtal`.
4. If facility data is missing, go to `Uppgiftsbegäran` and request data from grid owner/current supplier.
5. If data is complete, go to `Leverantörsbyte`.
6. Do not manually override grid owner for normal tenant intake unless resolving a verified exception.

## Implementation files

```txt
app/api/v1/website/public-contracts/route.ts
app/api/v1/website/customer-applications/route.ts
app/api/v1/website/customer-events/route.ts
app/admin/facility-requests/page.tsx
components/admin/customers/CustomerFacilityWorkflowCard.tsx
lib/facility/workQueue.ts
supabase/migrations/20260612183000_ops_e_f_facility_work_queue_customer_cards.sql
```

## OPS-J..N: governance, audit and cleanup rules

### Agreement ownership

Only platform admin may create, edit or publish price plans, price plan versions, pricing components, public contract offers and legal terms. Tenant admins may view and operate customers using already-published offers, but may not create their own commercial/legal truth.

### Website contract flow

External websites must first call:

```http
GET /api/v1/website/public-contracts
```

The selected offer is then submitted to:

```http
POST /api/v1/website/customer-applications
```

Recommended contract payload:

```json
{
  "contract": {
    "offer_reference": "offer_opaque_reference",
    "requested_start_date": "asap"
  }
}
```

Do not let a website submit internal price plan IDs, monthly fee, markup or legal terms as the source of truth. OPS resolves the opaque offer reference and creates the locked customer contract snapshot.

### Customer actions

State-changing customer-card actions must log both:

- `audit_logs` for revision/legal traceability.
- `platform_usage_events` for tenant-scoped SaaS statistics and future billing.

### Testdata and archive

Use these rules:

- Mark fake/test customers as testdata.
- Archive real customers instead of deleting them.
- Hard-delete only test customers that have no contract, invoice, Ediel message, supplier switch, billing underlay or partner export.
- Archive test sites and metering points when they should no longer appear in operations.
