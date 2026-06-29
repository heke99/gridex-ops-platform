# Legal + Power of Attorney platform

OPS is the single source of truth for tenant legal documents, powers of attorney,
legal acceptances and reusable legal bundles. Tenant websites must not generate
their own legal or power-of-attorney text. They fetch/link the documents from OPS
and submit the customer's acceptance back to OPS.

## Data model (already in place)

- `legal_text_versions` — tenant-scoped, versioned legal texts. Immutable once
  published. Types: `terms`, `privacy_policy`, `withdrawal`, `price_terms`,
  `power_of_attorney`.
- `platform_default_legal_templates` — Gridex master templates copied into a new
  tenant on company creation (DB trigger), so every tenant starts with a complete
  legal package.
- `legal_bundles` / `legal_bundle_items` — reusable bundles linked from
  `public_contract_offers`.
- `customer_legal_acceptances` — immutable per-customer acceptance evidence with a
  full text snapshot. Points to the exact `legal_text_version_id` accepted.
- `powers_of_attorney` (+ `power_of_attorney_scopes`, `power_of_attorney_events`) —
  real POA records with scope, signer, evidence, method, document link and source.

Tenant legal identity (legal name, org number, address, support email) lives on
`companies`. Completeness is exposed via `tenant_website_readiness_v` and
`getTenantLegalDefaultStatus`.

## Public legal document URLs

Published, tenant-specific legal documents are served at:

```
/legal/{tenant_slug}/terms/{version_id}
/legal/{tenant_slug}/privacy/{version_id}
/legal/{tenant_slug}/withdrawal/{version_id}
/legal/{tenant_slug}/price-terms/{version_id}
/legal/{tenant_slug}/power-of-attorney/{version_id}
```

Only `published` versions are visible. Tenant isolation is strict (the version
must belong to the company resolved from the slug). The power-of-attorney page
shows the authorized scopes. Draft/archived versions return 404.

## Required scopes

- `website_contracts.read` — read public contracts.
- `website_legal.read` — read the legal bundle (the legal-bundle endpoint also
  accepts `website_contracts.read` for backward compatibility).
- `website_applications.write` — create customer applications.
- `events.read` / `website_events.write` — customer events.

Customer-portal / external-sync scopes (where relevant): `customer_documents.read/write`,
`customer_legal_acceptances.read`, `customer_power_of_attorney.read/write`,
`customer_sync.write`.

Tenant isolation invariants: the API token's `company_id` controls all access;
`legal_text_version_id`, contracts, customers and POA must belong to the same
tenant. The service role key is server-side only and never exposed to the browser.

## Flow 1 — Sign contract through a tenant website

1. Website calls `GET /api/v1/website/public-contracts` (or
   `GET /api/v1/website/legal-bundle`).
2. Website displays or links the OPS-hosted legal documents.
3. Customer accepts terms and the power of attorney.
4. Website posts the application with a camelCase `powerOfAttorney` object.
5. OPS creates the customer, contract, legal acceptances, power of attorney and a
   document/snapshot.
6. OPS returns `power_of_attorney_id`.

Customer applications use **camelCase** `powerOfAttorney`:

```json
{
  "consents": {
    "terms": true,
    "privacy_policy": true,
    "withdrawal": true,
    "price_terms": true,
    "power_of_attorney": true
  },
  "powerOfAttorney": {
    "accepted": true,
    "scope": ["supplier_switch", "facility_information_lookup"],
    "signerName": "Anna Andersson",
    "signerIdentityNumber": "YYYYMMDDXXXX",
    "method": "website_acceptance",
    "acceptedAt": "2026-06-29T10:00:00Z",
    "textVersionId": "<tenant power_of_attorney version id>",
    "ipAddress": "…",
    "userAgent": "…"
  }
}
```

`textVersionId` is optional; when omitted, OPS binds to the published
power-of-attorney version. When provided, it must belong to the same tenant and be
a published power-of-attorney version. Never log personal identity numbers, API
keys or service role keys.

## Flow 2 — Manual customer intake in OPS

1. Tenant creates the customer.
2. Tenant uploads the signed PDF power of attorney (or records a manual acceptance),
   selecting scope and signing date.
3. OPS stores the document and creates a `powers_of_attorney` row with
   `method = 'pdf_upload'`, signer, scope summary and document link.
4. When marked signed/verified, OPS can use it for facility lookup and supplier
   switch.

## Flow 3 — External sync / API

External systems send customer data, documents and the power of attorney using the
sync endpoint contract. OPS validates scopes and tenant ownership and stores the
legal evidence. The sync endpoint uses **snake_case**:

```json
{ "power_of_attorney": {} }
```

Difference to remember:
- `POST /api/v1/website/customer-applications` uses `powerOfAttorney` (camelCase).
- `POST /api/v1/customer/sync` may use `power_of_attorney` (snake_case).

## Customer application response (POA required)

```json
{
  "customer_id": "uuid",
  "customer_number": "DX-12345",
  "contract_id": "uuid",
  "site_id": "uuid",
  "application_id": "uuid",
  "power_of_attorney_id": "uuid",
  "power_of_attorney": {
    "status": "signed",
    "scope": ["supplier_switch", "facility_information_lookup"],
    "method": "website_acceptance",
    "externally_sendable": true,
    "text_version_id": "uuid",
    "document_url": "https://…/legal/{slug}/power-of-attorney/{version_id}"
  },
  "legal_acceptances": {
    "terms": "uuid",
    "privacy_policy": "uuid",
    "withdrawal": "uuid",
    "price_terms": "uuid",
    "power_of_attorney": "uuid"
  },
  "nextAction": { "code": "ready_for_facility_lookup", "label": "…" }
}
```

If a power of attorney is required and `power_of_attorney_id` is missing, the
response is not a success.

## Error codes

Legal / POA validation surfaces precise codes (the website may show a friendly
message to the end customer, but logs and the API `code` are precise):

- `public_contract_required`, `public_contract_not_available`
- `legal_bundle_missing`, `legal_versions_missing`, `legal_acceptance_missing`
- `power_of_attorney_not_accepted`
- `power_of_attorney_version_missing`, `power_of_attorney_version_not_published`,
  `power_of_attorney_version_tenant_mismatch`
- `powers_of_attorney_schema_mismatch` (required POA could not be persisted — the
  whole application fails; non-sensitive DB code/message included in `details`)
- `customer_type_invalid`

Downstream (facility lookup / supplier switch) blockers:
`power_of_attorney_missing`, `power_of_attorney_scope_missing`,
`poa_not_externally_sendable`, `power_of_attorney_not_signed`.

## Safety guarantees

- A required power of attorney or legal acceptance that cannot be persisted fails
  the whole application — OPS never persists a "complete" customer without legal
  authorization. Schema mismatches are no longer silently swallowed for POA.
- Published legal versions are immutable; new text means a new version. Old
  customer acceptances keep pointing at the exact version accepted.
