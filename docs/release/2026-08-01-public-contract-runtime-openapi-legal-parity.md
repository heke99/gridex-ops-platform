# Public Contracts runtime, OpenAPI and legal parity — 2026-08-01.1

Status: **implemented and locally static-verified; database apply, dependency-based build and staging verification remain pending**.

## Scope

This release repairs the external Public Contracts contract used by:

- `GET /api/v1/website/public-contracts`
- `GET /api/v1/public-contracts`
- `GET /api/v1/contracts`
- `GET /api/v1/openapi/website-integration-v1.json`
- `GET /api/v1/openapi/customer-portal-v1.json`
- `GET /api/v1/integration/context`
- `/developers/customer-portal-api`

The canonical contract version is `2026-08-01.1`.

## Root cause

### Nested legal version identity was removed after it had been built

`lib/website/publicContracts.ts` already had access to the locked legal bundle
version, but the shared external DTO boundary recursively removed keys ending in
`_id`. That generic sanitizer therefore removed the public
`legal_bundle_version_id` both from the legal object and its module rows.

Permanent repair: legal data is now rebuilt through an explicit strict public
serializer. Public identifiers are allowlisted field by field; internal database
objects are never spread into the response.

### Price-option source of truth differed between database and public schema

The publication-bound database model stores `is_default`, while the previous
public DTO/OpenAPI path still treated `default` as the primary property. Runtime
could consequently emit `is_default` into a schema that only allowed `default`.

Permanent repair: `is_default` is canonical throughout mapping, validation,
OpenAPI, fixtures and documentation. `default` is generated only as a deprecated
compatibility alias and must always equal `is_default`.

### API-channel contracts did not carry the canonical legal object

The API-channel RPC returned commercial and pricing data but omitted the locked
legal bundle graph. Website and API channels could therefore describe the same
publication differently.

Permanent repair: the new forward-only migration adds one exact-relation legal
snapshot helper and uses it in publication finalization, API listing and
idempotent historical backfill.

### Parity tests were too indirect

Existing checks covered files and individual schemas but did not exercise the
actual Public Contracts route and the actual published OpenAPI route together.
Some older regression scripts also expected hardcoded version copies or
superseded source names.

Permanent repair: a route-level regression invokes both real GET handlers,
validates the complete response against the served schema and verifies headers,
version, default alias and legal bundle invariants. Static release, fixture,
documentation and migration gates provide dependency-free protection as well.

## Canonical architecture map

```text
legal_bundle_versions
legal_bundle_version_documents
contract_publication_versions
contract_price_options
contract_price_option_area_prices
        │
        ├─ gridex_publication_legal_snapshot_json_v1
        ├─ gridex_finalize_contract_publication_v1
        └─ gridex_list_external_api_contracts
                 │
website: canonical_visible_public_contracts_v
         + exact publication/legal/price enrichment
api:     gridex_list_external_api_contracts RPC
                 │
lib/website/publicContracts.ts
                 │
lib/external-contracts/publicContractModel.ts
  ├─ serializePublicContractPriceOptions
  └─ serializePublicContractLegal
                 │
lib/external-contracts/publicationDto.ts
                 │
/api/v1/website/public-contracts
/api/v1/contracts
/api/v1/public-contracts
                 │
scripts/finalize-openapi-release.cjs
                 │
docs/openapi/website-integration-v1.json
release manifest + exact SHA-256
                 │
/developers/customer-portal-api
canonical fixture + parity/regression tests
```

## Canonical invariants

### Legal

- New publications require a valid locked `legal_bundle_version_id`.
- `legal.legal_bundle_version_id` is always present in the serialized object.
- Every `legal.module_versions[]` row contains the property.
- Every module bundle ID equals the top-level bundle ID.
- One public legal snapshot cannot contain duplicate module keys.
- A mutable or empty legal snapshot is rejected.
- Historical `null` is only supported through an explicit serializer option and
  is emitted as `null`, never omitted.
- No first/latest bundle fallback exists in runtime or backfill.

### Price options

- `is_default` is the only canonical source of truth.
- `default` is emitted as a deprecated compatibility alias.
- Conflicting input values are rejected with
  `PUBLICATION_PRICE_OPTION_DEFAULT_MISMATCH`.
- Exactly one published price option is default.
- Unknown fields remain rejected by strict OpenAPI schemas.
- `area_prices: []` is valid for variable contracts that do not require fixed
  area-specific prices.

## Database release

Forward-only migration:

`supabase/migrations/20260801003000_public_contract_runtime_openapi_legal_parity.sql`

It adds/replaces:

- `gridex_publication_legal_snapshot_json_v1(uuid, uuid)`
- `gridex_finalize_contract_publication_v1(uuid, uuid, boolean)`
- `gridex_list_external_api_contracts(uuid, text)`
- `gridex_preview_public_contract_legal_backfill_v1(uuid)`
- `gridex_apply_public_contract_legal_backfill_v1(uuid, boolean, uuid)`

The backfill:

- defaults to dry-run;
- uses only `contract_publication_versions.legal_bundle_version_id` and the exact
  locked company-owned bundle;
- reports `scanned`, `already_valid`, `backfilled`, `ambiguous`,
  `missing_source`, `blocked`, `failed` and failure details;
- records derivation method and before/after hashes in audit logs;
- changes no commercial values;
- recomputes the publication content hash;
- is service-role only and idempotent.

The migration itself has SHA-256:

`19bbfbb56f3b150835e873200962d490dd043c7d2de51ded83e4460061659850`

## OpenAPI release

Version: `2026-08-01.1`

- Website Integration SHA-256:
  `e15a170a38b0cecadb2b815c1387c2336f02da7a69c96af418acca3999952f5f`
- Customer Portal SHA-256:
  `72fe14799c971f34e172782972ae510c9817cc6e4b981fb5ec8a71326f49e628`

The finalizer keeps `additionalProperties: false`, requires both default fields,
marks `default` deprecated, requires legal bundle identity properties on both
levels, uses the project nullable convention and embeds the production-like
canonical fixture as the 200 response example.

## Error classification

The external boundary now distinguishes publication inconsistency from temporary
infrastructure failure. Relevant codes include:

- `PUBLICATION_LEGAL_BUNDLE_VERSION_MISSING`
- `PUBLICATION_LEGAL_MODULE_BUNDLE_MISMATCH`
- `PUBLICATION_LEGAL_SNAPSHOT_INCOMPLETE`
- `PUBLICATION_LEGAL_MODULE_VERSION_INVALID`
- `PUBLICATION_PRICE_OPTION_DEFAULT_MISMATCH`
- `PUBLICATION_RUNTIME_SCHEMA_MISMATCH`
- `PUBLICATION_CONTRACT_VERSION_MISMATCH`
- `PUBLICATION_OPENAPI_CHECKSUM_MISMATCH`

Logs contain correlation/request ID, tenant and publication identifiers, contract
version, schema name, error code and JSON path. Tokens, customer data and legal
document contents are not logged.

## Documentation

`/developers/customer-portal-api` now uses the canonical release manifest and
production-like fixture rather than a separate response copy. It includes:

- introduction and quickstart;
- actual environments and authentication rules;
- request/response headers and correlation IDs;
- external endpoint inventory;
- complete Public Contract response and field reference;
- detailed `price_options`, `is_default`, deprecated `default`, `area_pricing`
  and `area_prices` semantics;
- legal bundle/version/module invariants;
- customer application flow;
- structural versus semantic error handling;
- version, OpenAPI, checksum, ETag and caching guidance;
- curl and TypeScript examples;
- migration guide, troubleshooting flow and changelog;
- responsive tables, anchors, focus targets and accessible copy controls.

## Verification performed in this workspace

Passed:

- OpenAPI/runtime registry parity: 39 registry routes, 41 operations, 59
  reachable schemas.
- Documentation version and example parity.
- Shared OpenAPI component boundary.
- Public API route contract inventory.
- Strict OpenAPI compatibility gate.
- Canonical Public Contracts fixture against the published Website OpenAPI.
- Exact local OpenAPI release artifact/checksum verification.
- New legal migration semantic safety gate.
- Public-contract publication, legal, commercial selection, fixed-area,
  security/energy-direction, go-live, market-price, invoice-fee, market
  resolution and portfolio regressions.
- TypeScript syntax/transpile validation for all 16 changed TS/TSX files.
- Strict isolated typecheck of the canonical public-contract model, DTO mapper
  and public error classifier using the installed TypeScript compiler.

Not performed:

- `npm ci`, full project typecheck, Vitest, lint and production build. This
  environment cannot resolve `registry.npmjs.org`; no complete `node_modules`
  installation was available.
- PostgreSQL migration apply, dry-run counts or second-run evidence. No
  authorized database URL was supplied.
- Staging route/OpenAPI/documentation curl verification. No staging origin or
  API key was supplied.

## Inherited migration-history blocker

The uploaded repository contains a pre-existing integrity mismatch:

- manifest expectation for
  `20260730220000_canonical_price_option_publication_api_completion.sql`:
  `0ab350f0da6648a497a80aeaedc1688eb5ae88e6279d6ab486526c070ff8c505`
- actual uploaded file SHA-256:
  `978de5e9b29da9428cd138cea3e57fb1c3ea65e8f903b28b1fb6493dff4e3cd5`

This release deliberately does **not** rewrite that historical checksum or the
historical migration bytes. An authorized operator must restore the trusted
file from the canonical Git source or reconcile it against the applied
migration ledger. The new migration is separately registered with its own exact
checksum.

## Required operator sequence

1. Restore/reconcile the inherited historical migration mismatch from the
   authoritative repository and applied ledger.
2. Install dependencies under Node 22 and run lint, all typechecks, tests and
   production build.
3. Run the legal backfill preview against an isolated staging tenant.
4. Apply the migration in staging.
5. Run the apply script and verify the second dry-run reports `backfilled = 0`.
6. Deploy OPS.
7. Compare served OpenAPI bytes with the release manifest.
8. Fetch real Public Contracts responses and validate them against the served
   OpenAPI.
9. Verify `/developers/customer-portal-api` shows the same version and hashes.
10. Synchronize and regenerate types/AJV validation in Gridex Web.
