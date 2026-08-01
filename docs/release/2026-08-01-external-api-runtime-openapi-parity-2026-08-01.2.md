# External API runtime and OpenAPI parity — 2026-08-01.2

## Goal

Make the website integration API and customer portal API use one executable
contract from authentication through runtime DTOs, idempotency, OpenAPI,
documentation and operational verification.

## Canonical decisions

- Contract version: `2026-08-01.2`.
- Tenant is derived server-side from the verified API client.
- Website application status is addressed by `application_number`, never by a
  database UUID.
- Public responses expose business references and tenant-bound opaque resource
  references only.
- All errors use the closed nested `ErrorEnvelope`.
- Every successful or failed JSON response carries contract version and request
  ID headers. Rate-limit and retry headers are included when the authenticated
  limiter produced those values.
- Event, notification and portal mutation writes require `Idempotency-Key` and
  use tenant/client/operation/customer/payload-bound replay protection.

## Corrected operations

| Operation | Correction |
|---|---|
| `POST /api/v1/website/customer-applications` | Returns `application_number` and public references; no internal IDs. |
| `GET /api/v1/website/customer-applications/{application_number}` | Tenant-bound lookup by the same public number returned at creation. |
| `POST /api/v1/website/quote/validate` | Accepts optional `application_number` and resolves the internal relation server-side. |
| `POST /api/v1/customer/profile-update` | Closed profile/facility payload, operation-dependent scopes and canonical customer/site writes. |
| `POST /api/v1/customer/notifications/read` | Canonical `notification_ids`, mandatory idempotency and closed response. |
| `POST /api/v1/events` and `POST /api/v1/website/customer-events` | One strict event schema and mandatory idempotency. |
| `GET /api/v1/events` | Versioned envelope and documented filters without internal `customer_id`. |
| `GET /api/v1/website/legal-bundle` | Accepts either documented legal-read or contract-read scope. |

## Database impact

No new table or column is required for this release. The existing unique
`(company_id, application_number)` relation is the application status key, and
existing facility/completion public-reference columns are reused.

The migration checksum manifest was reconciled only after confirming that the
two disputed SQL files and the stale manifest were byte-identical to the
connected repository's `main` branch. Historical migration SQL was not edited.
Production schema parity must still be checked before deployment.

## Deployment order

1. Apply the source patch without deleting local environment files.
2. Run migration integrity, API finalization and all static parity gates.
3. Install dependencies from the approved registry and run typecheck, tests,
   lint and production build.
4. Deploy OPS to staging.
5. Run the deployed OpenAPI release verifier against staging.
6. Submit a real test application, poll by `application_number`, verify the
   durable continuation job and follow the process through the applicable
   fullmakt/facility/supplier-switch branch.
7. Promote only after database, tenant-isolation and E2E evidence is green.

## Rollback

Application code and OpenAPI must be rolled back together. Do not publish a
`2026-08-01.2` OpenAPI document while running older route DTOs. This release
contains no new database migration, so rollback does not require destructive
schema changes.
