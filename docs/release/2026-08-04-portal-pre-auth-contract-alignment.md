# Portal pre-auth contract alignment

**Contract version:** `2026-08-04.1`

**Database migration:** `20260804151500_website_application_pre_auth_contract_alignment.sql`

## Decision

Website customer applications are pre-authenticated. Before calling
`POST /api/v1/website/customer-applications`, the tenant backend must establish
or verify the tenant's own Auth session and send the same verified UUID in both
`auth_user_id` and `customer_portal_user_id`.

Anonymous customer applications are not supported by this contract release.
This matches the Website Integration OpenAPI required fields and the release
manifest classifications:

- `breaking-client-update-required-for-portal-identity`
- `breaking-request-requirement`

## Runtime and database guarantees

- Runtime returns `422 portal_auth_identity_required` when either ID is missing.
- Runtime returns `422 portal_auth_identity_mismatch` when the IDs differ or are
  not valid UUIDs.
- Every reservation and committed application row stores
  `portal_identity_required=true`.
- PostgreSQL defaults new rows to `portal_identity_required=true` and rejects
  inserts that try to disable the invariant.
- PostgreSQL prevents a canonical row from being downgraded to legacy mode.
- Historical pre-contract rows can still receive operational status updates.
