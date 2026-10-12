# Gridex OPS API index

This inventory covers the central OPS implementation reviewed on 2026-10-12. It excludes tenant repositories, deployment and live business writes. Actual handlers, their callees and effective database definitions determine behavior. Tests and specifications are supporting evidence; a passing test or an installed function alone does not establish production readiness.

## Revisions and documentation

| Surface | Documentation or specification revision | Business response contract |
| --- | --- | --- |
| Website and Customer Portal | 2026-10-12.1 | 2026-10-09.1; earlier registered profiles remain supported |
| Staff | 2026-10-12.1 | 2026-10-09.1; earlier registered Staff profiles remain supported |
| Independent Staff onboarding | 2026-10-05.2 | Separate 2026-10-05.2 schema |
| Partner | Separate Partner API revision 2026-08-17.1 | Its own contract; not the Website/Customer/Staff response schema |

A documentation revision does not require a tenant integration upgrade or change `contract_schema_version`. The Website/Customer minimum stays `2026-10-02.3`. The exact supported profiles and representation rules are in the [compatibility policy](api-compatibility-policy.md) and [runtime registry](../lib/integrations/apiContractCompatibility.ts). Historical frozen specifications remain unchanged, including documented omissions discovered during this review.

Website, Customer and Staff business responses identify their response profile in `X-Gridex-Contract-Version`; `X-Gridex-Documentation-Version` identifies associated documentation. When fetching an OpenAPI document, the former header identifies the document being fetched. The [release manifest implementation](../lib/integrations/openApiReleaseManifest.ts) reports the documentation release separately from `runtime_contract_version`.

- [Website specification](openapi/website-integration-v1.json), [immutable documentation 2026-10-12.1](openapi/releases/2026-10-12.1/website-integration-v1.json) and [integration guide](external-website-api-integration-guide.md).
- [Customer specification](openapi/customer-portal-v1.json), [immutable documentation 2026-10-12.1](openapi/releases/2026-10-12.1/customer-portal-v1.json) and [Customer Portal guide](gridex-customer-portal-api.md).
- [Staff specification](openapi/staff-v1.json), [immutable documentation 2026-10-12.1](openapi/releases/2026-10-12.1/staff-v1.json) and [Staff guide](gridex-staff-api.md).
- [Independent onboarding specification](openapi/staff-onboarding-v1.json) and [identity/binding guide](staff-api/independent-onboarding.md).
- [Partner specification source](../lib/partner-api/openApi.ts) and [unified developer guide](../app/developers/customer-portal-api/page.tsx).
- [Documentation findings and verification](../quality/audits/2026-10-12-ops-api-contracts/documentation-review.json).

## Review scope and authority

| Family | Reviewed method/path rows | What the inventory establishes | Evidence |
| --- | ---: | --- | --- |
| Website | 16 | Actual handler/callee inventory, bounded business findings and mounted synthetic behavior; native/provider/live qualification remains limited | [Website audit](../quality/audits/2026-10-12-ops-api-contracts/website-review.json) |
| Customer | 29 | Customer identity, ownership, reads, writes and support paths traced with stated fixture/native limits | [Customer audit](../quality/audits/2026-10-12-ops-api-contracts/customer-review.json) |
| Staff | 29 | 22 Staff business operations, 2 independent onboarding operations and 5 publication rows; shared authorization and deployment gaps remain | [Staff audit](../quality/audits/2026-10-12-ops-api-contracts/staff-review.json) |
| Partner | 16 | Bounded dispatch/handler, scope, ownership and dependency review with targeted fixes; no complete native or hosted-provider qualification | [Partner audit](../quality/audits/2026-10-12-ops-api-contracts/partner-review.json) |
| Internal/inbound | 154 methods across 129 routes | Actual handler authorization/tenant/cron/provider boundaries reviewed for every method; deeper business/native limits remain listed, with bounded billing, pricing, inbound and receipt fixes | [Internal audit](../quality/audits/2026-10-12-ops-api-contracts/internal-review.json) |

These row counts are not independent endpoint totals or an all-green score. Website includes shared integration context and compatibility routes. Customer includes shared events and integration context. Staff includes public documentation routes. The current [route registry](../lib/api/publicRouteRegistry.ts) also includes the new immutable documentation URLs. Each family report records the exact implementation, dependencies, findings and limits for its own rows.

The [independent source/live database review](../quality/audits/2026-10-12-ops-api-contracts/database-code-review.json) compares actual callers with effective native functions, grants, policies, constraints and triggers. It does not use green tests as a correctness oracle. Its public-schema function catalog and explicit all-namespace absence searches are stronger evidence than the earlier selective function snapshots; a missing inventory name still needs a reachable call-chain proof before it is classified as a defect.

## Pending release and live qualification

The database report read for this inventory is timestamped `2026-10-12T21:44:57.220Z`. Its following findings remain release/qualification work, not claims of a successful live customer or Staff integration:

- **DB-CODE-001:** Required native retention functions are absent. The traced customer-contract reads, portal bundle, Partner PDF retrieval and signing continuation cannot be qualified from source/specification alone. Signing can commit natively before a missing post-commit receipt guard reports failure; this is a conditional call-chain finding, not an executed live signing incident. Preserve the fail-closed retention rules and reconcile the required functions/wrappers through the owning migration process.
- **DB-CODE-002:** The reviewed native Partner transaction can bind a production site to a consumption offer/contract because offer direction replaces the requested direction and no effective native mismatch guard was found. Application entrypoints now check the canonical selected offer before uploads or registration; the native transaction still requires the proposed guard. The report found no current active Partner contract client or existing corrupt contract.
- **DB-CODE-003:** The effective current-company actor authorizer lacks the latest explicit deny predicates. A configured matching deny could therefore be ignored at that gate. The report found no active deny exposure and does not transfer this finding to the separate Staff deny-wins authorizer.

The fresh [native preflight](../quality/audits/2026-10-12-ops-api-contracts/required-native-preflight-result.json) and [effective definitions](../quality/audits/2026-10-12-ops-api-contracts/final-native-state.json), checked at `2026-10-12T22:10:18Z`, confirm 51 absent required functions: five customer/document retention guards and 46 functions on the mapped internal command paths. The tombstone-list function is present with service-only ACL; an earlier prose claim that it was absent was refuted against the original and fresh catalogs. The internal audit maps 74 valid-command method chains to its 46 missing RPCs; this is not a claim that every empty queue or invalid request invokes them.

Reviewable SQL and owner reconciliation steps are in the [release packet](../quality/audits/2026-10-12-ops-api-contracts/release-proposals/README.md). They are not applied migrations or production readiness evidence.

The observed live database had no customers or Staff identity bindings. The Staff review also found no active Staff provider or explicitly scoped Staff client. These facts do not demonstrate tenant isolation, a working live Staff request, storage/delivery completion or a full customer lifecycle. Staff is not certified all-green. Local fixes, mounted probes and selected native fixtures do not close production migration, provider, concurrency or tenant-configuration qualification.

## Reviewed operations

Method/path rows below are copied from the family inventories, not inferred from test names. Shared rows intentionally appear in more than one family. Detailed dependencies and per-operation qualifications remain in the linked JSON reports.

### Website

| Method | Path |
| --- | --- |
| GET | `/api/v1/integration/context` |
| GET | `/api/v1/website/public-contracts` |
| GET | `/api/v1/website/public-contracts/diagnostics` |
| GET | `/api/v1/contracts` |
| GET | `/api/v1/public-contracts` |
| POST | `/api/v1/website/quote` |
| POST | `/api/v1/website/quote/validate` |
| POST | `/api/v1/website/customer-applications` |
| POST | `/api/v1/website/energy-area/resolve` |
| GET | `/api/v1/website/switch-status` |
| POST | `/api/v1/website/market-price/current` |
| GET | `/api/v1/website/portfolio-prices` |
| GET | `/api/v1/website/legal-bundle` |
| POST | `/api/v1/website/customer-events` |
| GET | `/api/v1/public-contracts/diagnostics` |
| GET | `/api/v1/website/customer-applications/{application_number}` |

### Customer

| Method | Path |
| --- | --- |
| POST | `/api/v1/customer-portal/sync` |
| GET | `/api/v1/customer/contracts` |
| GET | `/api/v1/customer/documents` |
| GET | `/api/v1/customer/events` |
| GET | `/api/v1/customer/invoices` |
| GET | `/api/v1/customer/invoices/{id}` |
| GET | `/api/v1/customer/legal-acceptances` |
| GET | `/api/v1/customer/me` |
| GET | `/api/v1/customer/metering-values` |
| POST | `/api/v1/customer/move-out` |
| GET | `/api/v1/customer/notifications` |
| POST | `/api/v1/customer/notifications/read` |
| GET | `/api/v1/customer/portal-bundle` |
| POST | `/api/v1/customer/portal-bundle` |
| GET | `/api/v1/customer/powers-of-attorney` |
| POST | `/api/v1/customer/profile-update` |
| GET | `/api/v1/customer/sites` |
| POST | `/api/v1/customer/sync` |
| GET | `/api/v1/events` |
| POST | `/api/v1/events` |
| GET | `/api/v1/integration/context` |
| GET | `/api/v1/customer/support/cases` |
| POST | `/api/v1/customer/support/cases` |
| GET | `/api/v1/customer/support/cases/{reference}` |
| GET | `/api/v1/customer/support/cases/{reference}/messages` |
| POST | `/api/v1/customer/support/cases/{reference}/messages` |
| GET | `/api/v1/customer/support/cases/{reference}/attachments` |
| POST | `/api/v1/customer/support/cases/{reference}/attachments` |
| GET | `/api/v1/customer/support/cases/{reference}/attachments/{attachmentReference}` |

### Staff and independent onboarding

| Method | Path |
| --- | --- |
| GET | `/api/v1/staff/users` |
| POST | `/api/v1/staff/users` |
| PATCH | `/api/v1/staff/users/{id}` |
| POST | `/api/v1/staff/users/{id}/disable` |
| POST | `/api/v1/staff/users/{id}/enable` |
| GET | `/api/v1/staff/roles` |
| GET | `/api/v1/staff/customers` |
| GET | `/api/v1/staff/customers/{ref}` |
| PATCH | `/api/v1/staff/customers/{ref}/contact` |
| POST | `/api/v1/staff/customers/{ref}/identity-change` |
| GET | `/api/v1/staff/cases` |
| POST | `/api/v1/staff/cases` |
| GET | `/api/v1/staff/cases/{reference}` |
| GET | `/api/v1/staff/cases/{reference}/events` |
| POST | `/api/v1/staff/cases/{reference}/messages` |
| POST | `/api/v1/staff/cases/{reference}/notes` |
| POST | `/api/v1/staff/cases/{reference}/phone-interactions` |
| PATCH | `/api/v1/staff/cases/{reference}/status` |
| PATCH | `/api/v1/staff/cases/{reference}/assignee` |
| GET | `/api/v1/staff/cases/{reference}/attachments` |
| POST | `/api/v1/staff/cases/{reference}/attachments` |
| GET | `/api/v1/staff/cases/{reference}/attachments/{attachmentReference}/file` |
| POST | `/api/v1/staff-onboarding/identity/resolve` |
| POST | `/api/v1/staff-onboarding/invitations/accept` |
| GET | `/api/v1/openapi/release-manifest.json` |
| GET | `/api/v1/openapi/staff-v1.json` |
| GET | `/api/v1/openapi/2026-10-04.1/staff-v1.json` |
| GET | `/api/v1/openapi/2026-10-09.1/staff-v1.json` |
| GET | `/api/v1/openapi/staff-onboarding-v1.json` |

### Partner

| Method | Path |
| --- | --- |
| GET | `/location` |
| GET | `/price/current` |
| POST | `/price` |
| POST | `/contract` |
| POST | `/customer` |
| POST | `/customer/{customer_id}/site` |
| POST | `/customer/{customer_id}/site/{site_id}/powerofattorney` |
| GET | `/customer/{customer_id}/site/{site_id}/powerofattorney` |
| GET | `/contract/{contract_id}/state` |
| GET | `/customer/{customer_id}` |
| GET | `/customer/{customer_id}/site/{site_id}` |
| GET | `/customer/{customer_id}/site/{site_id}/invoice` |
| GET | `/invoice/{invoice_id}` |
| GET | `/invoice/{invoice_id}/pdf` |
| GET | `/customer/{customer_id}/site/{site_id}/measurement` |
| POST | `/webhook/subscription` |

Partner paths are relative to `/api/partner/v1`. Compatibility dispatchers are reviewed separately in the Partner report; this table is the published 16-row surface.

### Internal and inbound boundaries

These routes are outside the public tenant integration contract. The internal report lists all 154 methods with handlers, boundary evidence and limits; listing them does not approve their complete business effects or the active Ediel work.

| Classification | Methods |
| --- | ---: |
| `admin_internal` | 83 |
| `platform_admin` | 7 |
| `cron_worker` | 42 |
| `admin_retention` | 18 |
| `retired_public_utility` | 1 |
| `provider_webhook` | 2 |
| `inbound_webhook` | 1 |

The two bounded internal remediations bind billing authorization to the actual target company and make provider-status GET diagnostic-only. They do not approve unrelated internal jobs, inbound sender behavior, native replay chains or complete RBAC equivalence.

## Maintenance

Update this index from the current implementation and latest family/database evidence. Keep source defects, locally corrected behavior, undeployed database drift and unverified live flows distinct. Recheck the effective database definitions before marking pending findings resolved; an empty result set or a green test suite is not a substitute.
