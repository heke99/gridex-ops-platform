# Canonical multi-tenant architecture

## Scope and invariant

`public.companies` is the platform tenant root and `company_id` is the only canonical tenant key. Integration client IDs, domains, users, brands and partner IDs may resolve a tenant, but they never replace `company_id` in the domain model.

Every tenant-owned command must enter the domain layer with a verified server-side `TenantContext`. The browser, public API payload, query string and arbitrary headers are untrusted. A matching compatibility claim may be tolerated and removed; a mismatching claim is rejected.

```text
verified identity
→ tenant resolution
→ TenantContext
→ channel adapter
→ canonical domain service/RPC
→ domain rows + audit + event/outbox
```

There is no fallback tenant and no tenant-specific production pipeline. Gridex is configuration data, not an architecture branch.

## Tenant context

The runtime type is defined in `lib/tenant/context.ts`:

```ts
type TenantContext = {
  companyId: string
  actorType: 'user' | 'integration' | 'worker' | 'webhook' | 'system'
  actorId: string
  permissions: readonly string[]
  scopes: readonly string[]
  correlationId: string
  sourceChannel: string
}
```

Context sources:

| Source | Trusted tenant resolution |
|---|---|
| Tenant admin | authenticated user membership and server authorization guard |
| Integration API | API key hash → integration client → `company_id` and scopes |
| Customer portal | authenticated portal identity → tenant-bound customer relation |
| Worker | atomically claimed job row containing verified `company_id` |
| Webhook | verified provider registration plus persisted provider/entity relation |
| Superadmin | explicit selected company plus platform authorization and audit |

A domain service receives context explicitly and checks every supplied company ID with `assertTenantContextCompany`.

## Canonical customer aggregate

```text
companies
└── customers
    ├── customer_onboarding_operations/applications
    ├── customer_sites
    │   └── metering_points
    ├── customer_contracts
    ├── customer_legal_acceptances / legal snapshots
    ├── powers_of_attorney
    │   └── customer_authorization_documents
    ├── customer_info_requests
    ├── supplier_switch_requests
    ├── customer_invoices / payments
    ├── domain_events / outbound work
    └── audit history
```

A person or organization may be a separate customer of multiple companies. Customer IDs, customer numbers, legal evidence, sites, contracts, communications, invoices and portal links are tenant-bound. Global identity deduplication is not assumed.

## System of record

| Information | System of record |
|---|---|
| Tenant identity | `companies` |
| Tenant capabilities | `company_capabilities` |
| Tenant customer | `customers` |
| Intake idempotency and result | `customer_onboarding_operations` |
| Intake snapshot | `customer_onboarding_applications` and source application row |
| Site | `customer_sites` |
| Metering identity | `metering_points` |
| Contract | `customer_contracts` |
| Signed legal evidence | legal acceptance/snapshot tables |
| Power of attorney | `powers_of_attorney` and authorization document/scope tables |
| Operational request | canonical request table for the operation |
| Communication intention/delivery | outbound/message/outbox/provider attempt tables |
| Audit | `audit_logs` and immutable domain evidence |

Metadata stores raw evidence, compatibility payloads and diagnostics. It does not replace canonical columns.

## Intake architecture

All implemented channels call `onboardCustomerGraph`, which now requires a `TenantContext` and invokes the tenant-neutral `canonical_onboard_customer_graph(jsonb)` alias. The historical `gridex_onboard_customer_graph` implementation remains temporarily for database compatibility only.

Adapters may authenticate, normalize and validate channel payloads. They may not create separate customer, contract, legal or automation rules.

Idempotency is tenant-qualified:

```text
(company_id, channel, idempotency_key)
```

The same key and normalized payload resumes the same operation. A conflicting payload must fail. Existing rows are verified and repaired rather than blindly returned or duplicated.

## Tenant configuration and capabilities

`company_capabilities` contains fail-closed activation/readiness state. A capability is usable only when both `enabled = true` and `readiness_status = 'ready'`. Capability configuration cannot bypass permissions, RLS, relational constraints or domain prerequisites.

Initial capability codes cover intake, portal, POA, facility lookup, Ediel, supplier switch, invoicing and webhook delivery. All companies receive disabled/not-configured rows. Activation is an explicit onboarding decision.

Tenant-specific products, legal versions, email identities, routes, market identities, customer-number formats and provider settings remain in their existing canonical configuration tables. Code must load configuration by `company_id`; it must not branch on tenant name, UUID or domain.

## Database isolation

The hardening migration adds `(company_id, id)` unique candidate keys to canonical parents and tenant-qualified foreign keys to key customer-graph relations. Constraints are `NOT VALID` so they protect new writes immediately while legacy conflicts are inspected separately.

Tenant tables also receive `company_id IS NOT NULL` check constraints as `NOT VALID`. A child row carrying tenant A with a parent from tenant B is rejected by PostgreSQL after the migration.

RLS remains mandatory for tenant tables. Service-role code does not become trusted merely because RLS is bypassed; it must still carry and filter by verified `company_id`.

## Data precedence

Updates follow this order:

1. verified canonical value;
2. explicitly validated current-channel value;
3. authoritative registry/resolver value;
4. older unverified value;
5. metadata for review.

Patch/upsert code preserves existing values when the new value is `null`, empty, unknown or a placeholder unless an explicit authorized business event clears the value.

## Events, outbound and workers

Domain state changes create durable work with the same tenant and correlation identity. Workers must claim atomically, filter by `company_id`, retry idempotently, retain provider references and dead-letter unrecoverable failures. Provider webhooks resolve tenant from verified provider/entity relations; payload/header tenant hints are ignored.

## State and readiness

The current platform has canonical onboarding and operation workflow services, but status terminology remains distributed across older domain modules. New status mutations must go through the domain transition/readiness service rather than direct frontend writes. Tenant-specific copy belongs in presentation; machine blocker codes remain shared.

## Known migration boundary

This repository contains the OPS platform only. Tenant websites, separate customer portals, partner repositories and deployed database/staging environments must independently adopt the same contract and context before platform-wide production approval.
