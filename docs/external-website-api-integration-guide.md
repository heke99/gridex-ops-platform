# Gridex External Website API Integration Guide

Public developer page:

```text
https://app.gridex.se/developers/customer-portal-api
```

This guide is for external websites, customer portals, white-label portals and partner frontends that need to connect to Gridex Ops Platform to fetch customer-specific electricity data.

The API is designed for this flow:

```text
External website frontend
→ external website backend/server route
→ Gridex Ops API
→ customer data returned to the frontend
```

The API is **not** designed for this unsafe flow:

```text
Browser JavaScript
→ Gridex Ops API directly with API-token
```

## Production base URL

```text
https://app.gridex.se
```

## Authentication

Use a Gridex API-client token issued in Gridex Ops Platform.

```http
Authorization: Bearer YOUR_GRIDEX_API_TOKEN
```

The token must be stored server-side only, for example:

```env
GRIDEX_OPS_API_BASE_URL=https://app.gridex.se
GRIDEX_OPS_API_TOKEN=...
```

Never store the token in a public frontend variable such as:

```env
NEXT_PUBLIC_GRIDEX_OPS_API_TOKEN=...
```

## Tenant resolution

External websites must never send `company_id` to choose tenant.

Gridex resolves tenant through:

```text
API-token
→ integration_api_clients.company_id
→ customer_portal_identities.external_customer_id
→ customer_id
→ customer-specific data
```

This is required so one website/API-client cannot read another tenant's customer data.

## external_customer_id

All customer endpoints require `external_customer_id`.

Send it either as query string:

```http
GET /api/v1/customer/sites?external_customer_id=CUSTOMER-12345
```

or as header:

```http
x-gridex-external-customer-id: CUSTOMER-12345
```

The external customer ID must be stable and unique in the external website/customer portal.

## Endpoints

| Method | Endpoint | Scope | Description |
|---|---|---|---|
| POST | `/api/v1/customer-portal/sync` | `customer_portal.write` | Link or update an external customer identity. |
| GET | `/api/v1/customer/sites` | `customer_portal.read` | Get the customer's sites and metering points. |
| GET | `/api/v1/customer/contracts` | `customer_portal.read` | Get the customer's contracts. |
| GET | `/api/v1/customer/invoices` | `customer_portal.read` | Get the customer's invoices when billing export/display is connected. |
| GET | `/api/v1/customer/metering-values` | `customer_portal.read` | Get normalized metering values from `normalized_metering_values`. |

## Metering values

The metering-values endpoint reads from:

```text
normalized_metering_values
```

It must not read from older or unrelated tables such as:

```text
metering_values
meter_values
billing_underlay_items
```

Supported calls:

```http
GET /api/v1/customer/metering-values?external_customer_id=GRIDEX-WEB-TEST-001
GET /api/v1/customer/metering-values?external_customer_id=GRIDEX-WEB-TEST-001&from=2026-05-01&to=2026-06-01
GET /api/v1/customer/metering-values?external_customer_id=GRIDEX-WEB-TEST-001&facility_id=735999888000000112
```

Example response:

```json
{
  "data": [
    {
      "id": "46835aeb-c59f-43dc-941c-641ec3ecb16b",
      "customer_id": "93749529-aae5-43dc-8099-9729ecb8ca17",
      "customer_site_id": "6f407d3c-3291-4aee-88ef-4beadf2144b2",
      "site_id": "6f407d3c-3291-4aee-88ef-4beadf2144b2",
      "metering_point_id": "74f9f70e-6076-471f-867e-1af752fca471",
      "facility_id": "735999888000000112",
      "price_area": "SE3",
      "period_start": "2026-05-01T00:00:00+00:00",
      "period_end": "2026-06-01T00:00:00+00:00",
      "resolution": "monthly",
      "quantity_kwh": 1000,
      "quality_status": "verified",
      "source_type": "manual_verification",
      "status": "stored"
    }
  ]
}
```

## Next.js server route example

Example route in the external website:

```ts
// app/api/gridex/metering-values/route.ts
import { NextRequest, NextResponse } from 'next/server'

const GRIDEX_OPS_API_BASE_URL = process.env.GRIDEX_OPS_API_BASE_URL ?? 'https://app.gridex.se'

export async function GET(request: NextRequest) {
  const externalCustomerId = request.nextUrl.searchParams.get('external_customer_id')

  if (!externalCustomerId) {
    return NextResponse.json({ error: 'external_customer_id saknas.' }, { status: 400 })
  }

  // Important: verify that the logged-in website user is allowed to use this external_customer_id.

  const response = await fetch(
    `${GRIDEX_OPS_API_BASE_URL}/api/v1/customer/metering-values?external_customer_id=${encodeURIComponent(externalCustomerId)}`,
    {
      headers: {
        Authorization: `Bearer ${process.env.GRIDEX_OPS_API_TOKEN}`,
        Accept: 'application/json',
      },
      cache: 'no-store',
    }
  )

  const body = await response.json()

  return NextResponse.json(body, {
    status: response.status,
    headers: { 'Cache-Control': 'no-store' },
  })
}
```

## Security requirements

1. API-token must only be stored server-side.
2. Never expose the token in browser code.
3. Never use `NEXT_PUBLIC_` for the Gridex API-token.
4. The external frontend must not send `company_id`.
5. Tenant is resolved by API-token in Gridex.
6. Customer is resolved by `external_customer_id` in `customer_portal_identities`.
7. Allowed origins and scopes should be limited per website.
8. All customer data responses must use `Cache-Control: no-store`.
9. Rotate/revoke exposed tokens immediately.
10. Old API keys can be revoked and deleted from the Gridex superadmin API-client UI.

## Error codes

| Status | Meaning |
|---|---|
| 400 | Required input missing, usually `external_customer_id`. |
| 401 | API-token missing or invalid. |
| 403 | Client inactive, missing scope, origin/IP denied, or customer identity not linked. |
| 429 | Rate limit reached. |
| 500/503 | Internal or temporary service error. |

## Audit check

Gridex logs API requests in `integration_api_requests`. The table uses `route`, not `path`.

```sql
select
  created_at,
  company_id,
  api_client_id,
  method,
  route,
  status_code,
  metadata ->> 'result_count' as result_count,
  duration_ms,
  error_code
from integration_api_requests
where created_at > now() - interval '30 minutes'
order by created_at desc
limit 50;
```

Expected for a successful metering-values call:

```text
route = /api/v1/customer/metering-values
status_code = 200
result_count = 1
company_id is set
api_client_id is set
```

## Go-live checklist

- [ ] API-client created in Gridex Ops Platform.
- [ ] API-token copied once and stored server-side.
- [ ] Token is not visible in browser bundle, HTML, logs or public env.
- [ ] Allowed origins are configured.
- [ ] Scopes are limited to required access.
- [ ] `external_customer_id` is stable and unique per customer.
- [ ] Sync endpoint tested.
- [ ] Sites endpoint tested.
- [ ] Contracts endpoint tested.
- [ ] Invoices endpoint tested.
- [ ] Metering-values endpoint tested.
- [ ] `Cache-Control: no-store` verified.
- [ ] Audit logs verified.
- [ ] Old test tokens revoked or deleted.
