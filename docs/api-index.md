# Gridex OPS API index

This inventory covers the central OPS implementation reviewed on 2026-10-12, with merged-source delivery status reconciled on 2026-10-17. Tenant repositories and live business writes are outside the inventory; the dated deployment observations below have their own scope. Actual handlers, their callees and effective database definitions determine behavior. Tests and specifications are supporting evidence; a passing test or an installed function alone does not establish production readiness.

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
- [Older validator errata](api-validator-errata/README.md): three checksum-bound source patches; immutable released specifications retain their original bytes.

## Review scope and authority

| Family | Reviewed method/path rows | What the inventory establishes | Evidence |
| --- | ---: | --- | --- |
| Website | 16 | Actual handler/callee inventory, bounded business findings and mounted synthetic behavior; native/provider/live qualification remains limited | [Website audit](../quality/audits/2026-10-12-ops-api-contracts/website-review.json) |
| Customer | 29 | Customer identity, ownership, reads, writes and support paths traced with stated fixture/native limits | [Customer audit](../quality/audits/2026-10-12-ops-api-contracts/customer-review.json) |
| Staff | 29 | 22 Staff business operations, 2 independent onboarding operations and 5 publication rows; per-tenant identity configuration and authenticated live-flow qualification remain separate prerequisites | [Staff audit](../quality/audits/2026-10-12-ops-api-contracts/staff-review.json) |
| Partner | 16 | Bounded dispatch/handler, scope, ownership and dependency review with targeted fixes; no complete native or hosted-provider qualification | [Partner audit](../quality/audits/2026-10-12-ops-api-contracts/partner-review.json) |
| Internal/inbound | 154 methods across 129 routes | Actual handler authorization/tenant/cron/provider boundaries reviewed for every method; deeper business/native limits remain listed, with bounded billing, pricing, inbound and receipt fixes | [Internal audit](../quality/audits/2026-10-12-ops-api-contracts/internal-review.json) |

These row counts are not independent endpoint totals or an all-green score. Website includes shared integration context and compatibility routes. Customer includes shared events and integration context. Staff includes public documentation routes. The current [route registry](../lib/api/publicRouteRegistry.ts) also includes the new immutable documentation URLs. Each family report records the exact implementation, dependencies, findings and limits for its own rows.

The [independent source/live database review](../quality/audits/2026-10-12-ops-api-contracts/database-code-review.json) compares actual callers with effective native functions, grants, policies, constraints and triggers. It does not use green tests as a correctness oracle. Its public-schema function catalog and explicit all-namespace absence searches are stronger evidence than the earlier selective function snapshots; a missing inventory name still needs a reachable call-chain proof before it is classified as a defect.

## Verified release and remaining qualification

The earlier missing-function finding DB-CODE-001 is resolved in OPS project `piidsfebjqjmnepdpnas`: effect migration `20261014113214` is applied, and all 1,243 selected functions match the qualified source and final definitions. The [native delivery receipt](../quality/audits/2026-10-12-ops-api-contracts/evidence/bb0b-native-delivery-20261014/native-effect-delivery-receipt.json) records exact SQL registration, protected metadata and final function verification. Its dated application and database observations are detailed under [Deployment and verified database installation](#deployment-and-verified-database-installation).

Historical preflights, absent-function counts, connector failures and uninstalled A6/037 proposals remain preserved in the [audit](../quality/audits/2026-10-12-ops-api-contracts/README.md). They describe earlier states and do not replace the latest native receipts. Historical Auth-owner scripts 001/002 must not be rerun; the installed approach requires no direct retention-owner Auth grants.

The API correction source was normally merged through [PR #794](https://github.com/heke99/gridex-ops-platform/pull/794) on 2026-10-15 at `196abab1f85511b94c6aa7f6eb998572c83a601d`. Its final-head delivery record binds `f3bd13370603a47053a7b4e74523d46c197065b0` to 33 successful PR jobs and 11 configured conditional skips, genuine CLEAN qualification, both historical UPGRADE scenarios, and coherent generated schema/type parity. This supersedes the earlier branch-level replay and canonical-output qualification waits. It does not establish configured tenant/provider business-flow readiness or formal EDIEL full-card acceptance.

The [Staff aggregate recorded in this audit](../quality/audits/2026-10-12-ops-api-contracts/staff-configuration-counts-latest.json), captured at `2026-10-14T11:43:23Z`, had zero bindings, active providers, explicitly scoped clients and registered external Auth clients. This is a dated observation, not a current production inventory. Each tenant must provision its required credentials, scopes, identity configuration and delivery integration, then qualify authenticated reads, writes, audit attribution and retry. The [support123 integration guide](staff-api/support123-integration.md) describes that tenant-owned work; source delivery alone does not certify a configured session.

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
| GET | `/api/v1/openapi/2026-10-12.1/staff-v1.json` |
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

## Deployment and verified database installation

The following application and database entries describe the recorded October 14 verification. They are not a fresh observation of the application or tenant configuration currently serving production.

The dated deployment receipt records application source `47a23b7573543021f79df172b44fb051024d2714` on [OPS production](https://app.gridex.se), preserving then-current main `7952177b` and adding the three independently reviewed older-profile/webhook/event-feed corrections. Full application typecheck passed; the genuine Vercel build passed in 131.855 seconds. Deployment `dpl_ADAyDfYPLkbPx6GJZdvhBYuAk68C` was READY with the OPS production alias. All 53 public current and historical OpenAPI routes returned 200 and matched the source after its documented serialization normalization. The deployed service SDK URL was attested as OPS project `piidsfebjqjmnepdpnas`: a missing-credential request returned 401 and a mismatching project returned 412 before database access. These observations did not qualify authenticated tenant/Staff business flows.

The signing preparation migration `20261014060124` and the reconstructed Auth-free eight-input module are applied in OPS project `piidsfebjqjmnepdpnas`. The live `platform_runtime_readiness` gate is ready with the exact version required by deployed code, a valid capability fingerprint, zero blocking issues and service-role read access. Twelve source-only registrations and one effect migration `20261014113214` match reviewed SQL exactly. The actual database contains all 1,243 source-selected functions with verified bodies, ABI, owners, permissions and execution attributes; all 422 previous Auth hooks and the complete active signing-preparation function are preserved. Exactly 226 internal RI hooks match 113 source-defined foreign keys. Both transport schemas are removed. See the [native delivery receipt](../quality/audits/2026-10-12-ops-api-contracts/evidence/bb0b-native-delivery-20261014/native-effect-delivery-receipt.json). Historical protected Auth-owner scripts must not be rerun.

The four Staff configuration aggregates were zero at 2026-10-14 11:43:23 UTC. That snapshot does not determine whether a tenant has since completed setup. For `support123.gridex.se` or another independently authenticated Staff portal, the tenant Auth service, API client, identity binding and invitation delivery integration must be registered and qualified; no external SSO vendor is required. See the [integration guide](staff-api/support123-integration.md). The merged API source and its release checks do not establish complete provider or configured-tenant business-flow readiness.

The merged API source includes the checksum-bound quote adapter in the actual clean, strict-upgrade and history-union source routing. Canonical source and executed-artifact hashes remain distinct, conflicting declarations and ambiguous placement refuse, and historical SQL is preserved. The final CLEAN, both historical UPGRADE scenarios and coherent canonical-output parity are recorded in the PR #794 delivery above. Staff onboarding uses one server-generated request ID across its response and API log. The [tenant invitation delivery contract](staff-api/tenant-invitation-delivery.md) specifies the existing worker bridge for tenant implementation. These changes do not certify a configured tenant session.
