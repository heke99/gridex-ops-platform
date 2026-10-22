/**
 * Canonical public contract for website and customer-portal integrations.
 *
 * A production integration configures one server-side credential:
 * `GRIDEX_API_KEY`. Gridex derives the organization and permissions from that
 * credential. Internal database identifiers are never part of the public V1
 * request contract.
 */
export const WEBSITE_INTEGRATION_CONTRACT_VERSION = '2026-10-09.1' as const
// Documentation revisions are independent of the stable business response schema.
export const API_DOCUMENTATION_VERSION = '2026-10-22.1' as const
// Documentation releases never raise the minimum supported wire revision; a request
// requirement that applies to every profile is classified below, not by a wire bump.
export const MINIMUM_TENANT_INTEGRATION_VERSION = '2026-10-02.3' as const

export const WEBSITE_INTEGRATION_ORIGIN = 'https://app.gridex.se' as const
export const WEBSITE_INTEGRATION_BASE_PATH = '/api/v1' as const
export const WEBSITE_INTEGRATION_BASE_URL = `${WEBSITE_INTEGRATION_ORIGIN}${WEBSITE_INTEGRATION_BASE_PATH}` as const

export const WEBSITE_INTEGRATION_OPENAPI_PATH = '/api/v1/openapi/website-integration-v1.json' as const
export const CUSTOMER_PORTAL_OPENAPI_PATH = '/api/v1/openapi/customer-portal-v1.json' as const
export const OPENAPI_RELEASE_MANIFEST_PATH = '/api/v1/openapi/release-manifest.json' as const
export const WEBSITE_INTEGRATION_VERSIONED_OPENAPI_PATH = `/api/v1/openapi/${API_DOCUMENTATION_VERSION}/website-integration-v1.json` as const
export const CUSTOMER_PORTAL_VERSIONED_OPENAPI_PATH = `/api/v1/openapi/${API_DOCUMENTATION_VERSION}/customer-portal-v1.json` as const
export const WEBSITE_INTEGRATION_OPENAPI_URL = `${WEBSITE_INTEGRATION_ORIGIN}${WEBSITE_INTEGRATION_OPENAPI_PATH}` as const
export const CUSTOMER_PORTAL_OPENAPI_URL = `${WEBSITE_INTEGRATION_ORIGIN}${CUSTOMER_PORTAL_OPENAPI_PATH}` as const
export const OPENAPI_RELEASE_MANIFEST_URL = `${WEBSITE_INTEGRATION_ORIGIN}${OPENAPI_RELEASE_MANIFEST_PATH}` as const
export const WEBSITE_INTEGRATION_VERSIONED_OPENAPI_URL = `${WEBSITE_INTEGRATION_ORIGIN}${WEBSITE_INTEGRATION_VERSIONED_OPENAPI_PATH}` as const
export const CUSTOMER_PORTAL_VERSIONED_OPENAPI_URL = `${WEBSITE_INTEGRATION_ORIGIN}${CUSTOMER_PORTAL_VERSIONED_OPENAPI_PATH}` as const

export const WEBSITE_TENANT_REQUIRED_ENVIRONMENT_VARIABLES = ['GRIDEX_API_KEY'] as const
export const WEBSITE_APPLICATION_REFERENCE_LOCATION = 'top_level' as const

/**
 * 2026-10-01.1 adds the customer support API (`/api/v1/customer/support/cases*`, scopes
 * customer_support.read/.write). Customer-portal mutations require an actively
 * linked portal user: identifier-only matches (customer number or e-mail) are
 * rejected with customer_identity_binding_required, and reads never create links.
 */

/**
 * 2026-10-02.1 adds support-case attachments for customers
 * (`/api/v1/customer/support/cases/{reference}/attachments*`): raw-body upload of PDF/PNG/JPEG
 * (≤ 4 MB) into quarantine, release only after a content check, SHA-256 re-verified downloads.
 */

/**
 * 2026-10-02.3 documents the runtime contract-version and request-id headers on
 * customer support attachment downloads. This release is retained unchanged.
 */

/**
 * 2026-10-02.2 documents the optional `x-gridex-customer-assertion` header (verified customer
 * login, configured per tenant in OPS) on every customer API operation, and its 403 outcomes.
 */

/**
 * 2026-10-22.1 documents a breaking Website request requirement (FINDINGS F51, owner decision
 * 2026-10-22, effective immediately): POST /api/v1/website/customer-applications requires
 * `customer.registered_address` { street, street2?, postal_code, city, country? } for private and
 * business customers: the customer's own Swedish registered address (folkbokföringsadress; for a
 * business the organisation's registered address), never the billing or facility address. Missing:
 * 422 registered_address_required; invalid: 422 registered_address_invalid; unknown key: 422
 * unknown_field (error.field customer.registered_address[.<field>]). Runtime request validation is
 * not selected by a credential-pinned representation, so every supported profile is affected and no
 * opt-in exists: the release is classified breaking-client-update-required for Website. Responses,
 * error envelopes and contract_schema_version are unchanged, so the wire revision stays
 * 2026-10-09.1 and the minimum stays 2026-10-02.3. Customer-portal and Staff documents only receive
 * the new documentation revision.
 *
 * 2026-10-12.1 separates the documentation revision from the stable wire revision 2026-10-09.1.
 *
 * 2026-10-09.1 is a documentation-only release (OPS API remediation Paket 17). It publishes the
 * OpenAPI text for runtime behaviour already in production: Staff x-gridex-expected-project-ref /
 * X-Gridex-Project-Ref / 412 storage_project_mismatch, Idempotency-Replayed semantics,
 * x-gridex-query-parsing strict profile and server request ids; customer support message and
 * attachment continuation (X-Gridex-Next-Cursor/cursor), closure-versus-replay precedence and the
 * idempotency_completion_uncertain (503) / idempotency_reconciliation_required (409) outcomes;
 * Website textVersionId exactness (409 power_of_attorney_offer_version_mismatch), public-contracts
 * ETag/If-None-Match/Vary and energy-area 422 energy_area_address_required. No request
 * requirement or response field changes; 2026-10-02.3 and 2026-10-04.1 clients remain supported.
 *
 * 2026-10-02.4 corrects the closed support-case detail and release-manifest schemas.
 * Business fields remain unchanged; compatibility is relative to the preceding .3 release.
 *
 * 2026-08-22.2 makes website settlement semantics explicit: only fixed contracts
 * lock the energy price at signup. Market monthly/hourly/quarter-hour, portfolio
 * and mixed products accept a pricing model and settle later from actual metered
 * consumption and authoritative period data. valid_until remains compatibility
 * metadata and does not expire a customer-visible quote by wall-clock time.
 */
export const API_COMPATIBILITY_CLASSIFICATION = {
  // 2026-10-22.1: Website clients must send customer.registered_address (F51).
  release: 'breaking-client-update-required',
  website: 'breaking-client-update-required',
  customerPortal: 'backward-compatible',
  // Staff requests and responses are unchanged by 2026-10-22.1.
  staff: 'backward-compatible',
} as const
export type CompatibilityClassification =
  (typeof API_COMPATIBILITY_CLASSIFICATION)[keyof typeof API_COMPATIBILITY_CLASSIFICATION]

export const WEBSITE_CHECKOUT_REQUIRED_SCOPES = [
  'integration_context.read',
  'website_contracts.read',
  'website_energy_area.resolve',
  'website_market_prices.read',
  'website_quotes.write',
  'website_quotes.validate',
  'website_legal.read',
  'website_applications.write',
  'website_switch_status.read',
] as const

export const CUSTOMER_PORTAL_REQUIRED_SCOPES = [
  'customer_profile.read',
  'customer_sites.read',
  'customer_contracts.read',
  'customer_invoices.read',
  'customer_metering.read',
  'customer_legal.read',
  'customer_events.read',
  'customer_documents.read',
  'customer_notifications.read',
  'customer_power_of_attorney.read',
  'customer_notifications.write',
  'customer_contact.write',
  'customer_facility_data.write',
  'customer_power_of_attorney.write',
  'customer_sync.write',
] as const

export const TENANT_WEBSITE_RECOMMENDED_SCOPES = [
  ...WEBSITE_CHECKOUT_REQUIRED_SCOPES,
  ...CUSTOMER_PORTAL_REQUIRED_SCOPES,
  'website_events.write',
  'events.read',
  'customer_documents.read',
  'customer_documents.write',
  'customer_notifications.read',
  'customer_notifications.write',
  'customer_contact.write',
  'customer_facility_data.write',
  'customer_power_of_attorney.write',
] as const

/** Additive Staff API release; existing website and customer business contracts stay compatible. */
export const STAFF_API_CONTRACT_VERSION = WEBSITE_INTEGRATION_CONTRACT_VERSION
export const STAFF_OPENAPI_PATH = '/api/v1/openapi/staff-v1.json' as const
export const STAFF_VERSIONED_OPENAPI_PATH = `/api/v1/openapi/${API_DOCUMENTATION_VERSION}/staff-v1.json` as const
export const STAFF_OPENAPI_URL = `${WEBSITE_INTEGRATION_ORIGIN}${STAFF_OPENAPI_PATH}` as const
export const STAFF_VERSIONED_OPENAPI_URL = `${WEBSITE_INTEGRATION_ORIGIN}${STAFF_VERSIONED_OPENAPI_PATH}` as const
