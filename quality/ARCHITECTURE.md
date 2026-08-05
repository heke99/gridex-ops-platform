# Gridex OPS — Architecture Review

## Canonical architecture

Gridex OPS is a multi-tenant Next.js and PostgreSQL platform. The canonical tenant key is `company_id`. External tenant identity is resolved from authenticated credentials, while browser-session access is constrained by membership/role checks and RLS.

## Main layers

### Presentation

- Server and client UI under `app/` and `components/`.
- Admin, tenant operations, customer views, developer documentation and auth flows.
- Server-side authorization must remain authoritative; UI visibility is not an authorization boundary.

### HTTP and integration boundary

- Next.js route handlers under `app/api/`.
- Versioned contracts under `app/api/v1/`.
- `lib/integrations/apiAuth.ts` authenticates external API clients and binds tenant context.
- `lib/api/strictRequest.ts` provides bounded JSON parsing and controlled input errors.
- Public responses are built through explicit serializers/DTOs rather than database rows.

### Application/domain services

- `lib/website/`: quote and customer-application orchestration.
- `lib/customer-portal/`: external customer identity, portal projections and write contracts.
- `lib/billing/`: invoice/export/provider webhook handling.
- `lib/ediel/`: market-message routing, readiness, dispatch and inbound processing.
- `lib/legal/`: legal bundle/version/acceptance logic.
- `lib/analytics/`: tenant analytics and cron work.

### Persistence

- Supabase/PostgreSQL is the durable source of truth.
- Browser/session queries are protected by RLS and helper functions.
- Service-role paths bypass RLS by design and therefore must scope every query/write with tenant ownership.
- Database changes are forward-only migrations in `supabase/migrations/`; already-applied migrations must not be edited.

## Request flows reviewed

### Tenant integration request

1. Route requests a required scope through `requireIntegrationApiAccess`.
2. API key is looked up by prefix/hash.
3. Client status, tenant status, expiry, scope, IP/origin and atomic rate limit are checked.
4. `companyId` comes from the authenticated client record.
5. Route/service queries use the bound company and return an allowlisted DTO.
6. Request metadata is recorded in integration logs.

Result: no verified tenant-claim or API-key tenant bypass in the reviewed core path.

### Website customer application

1. Website API key binds the tenant.
2. Request size and explicit field allowlists are validated before Zod parsing.
3. Quote/contract/legal/POA/customer/site/meter relationships are checked within the bound tenant.
4. Canonical records and events are written through the website orchestration module.
5. Public response removes internal identifiers.

Result: no verified cross-tenant write in the reviewed path. The orchestration module is oversized and high-risk to change.

### Customer portal sync

1. Tenant is bound from API credentials.
2. Portal/auth user IDs must be identical in headers and payload.
3. Candidate customer queries include `company_id`.
4. Identity upsert conflict key includes company/provider/external customer.

Result: tenant scoping is correct in the reviewed path. Controlled parser errors are incorrectly flattened to HTTP 500; see `BUG-001`.

### Webhooks

- Manual inbound and Resend verify signatures before business processing.
- Billing resolves the tenant-specific secret from the provider invoice reference and then verifies HMAC/timestamp.
- Billing currently returns a different response class for unknown invoice references than for bad signatures, creating a possible existence oracle; see `BUG-002`.

### Scheduled jobs

- Analytics cron uses a timing-safe shared secret and fails closed when missing.
- It loads up to 1,000 companies and processes them serially. This avoids uncontrolled concurrency but may cause duration pressure at scale; measurement is required before changing behavior.

## Security boundaries

| Boundary | Required invariant |
|---|---|
| Browser → route | Authenticated user, active session, server-side role/membership |
| External client → API | Valid key, scope, tenant status, origin/IP and rate limit |
| Route/service → service role | Explicit tenant/parent ownership on every operation |
| Tenant → tenant | No identifier-only query; tenant must be independently bound |
| Webhook → provider handler | Signature, timestamp/replay protection, bounded payload |
| Job → tenant work | Tenant carried in each work item and query |
| Application → database | Runtime types, migrations, constraints and state machines agree |
| Application → OpenAPI | Runtime status/error/body match published version |

## Architecture risks

1. Large orchestration modules make tenant invariants harder to review and test.
2. Service-role usage is widespread and safe only while every caller preserves explicit tenant filters.
3. Historical `.agent-memory` architecture paths have drifted from the actual root layout.
4. Repository metadata and the narrow root README do not provide a reliable current architecture overview.
5. Full dependency/build/test verification is blocked in this session.

## Recommended boundaries

- Keep tenant resolution centralized and immutable after authentication.
- Split large services by stable domain transaction: request validation, identity resolution, quote binding, legal evidence, canonical persistence and side effects.
- Keep database mutations transactional at the smallest complete business invariant.
- Preserve explicit DTO serializers and runtime/OpenAPI parity checks.
- Normalize controlled API errors through one canonical helper.
- Avoid tenant-agnostic caches, queue payloads and service-role repository helpers.
