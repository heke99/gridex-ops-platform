# Gridex API compatibility policy

> You do not need to match the latest documentation revision exactly to use a supported API version.

You integrate against a supported **contract family** (currently `v1`) per API surface. New documentation revisions do not require you to update your integration. Backward-compatible updates keep working. New features may require new capabilities or scopes. Breaking changes get a separate contract version and a documented migration period.

See the [API migration guide](api-migration-guide.md) for what each documentation revision adds and how to adopt optional additions.

## Terms

Current documentation revision is `2026-10-12.1`; the default Website, Customer and Staff wire representation remains `2026-10-09.1`. The separate Staff onboarding representation is `2026-10-05.2`. `info.version` and the manifest's `release_version` identify documentation. `x-contract-schema-version`, the manifest's `runtime_contract_version` and business `contract_schema_version` identify the wire contract. These values need not be equal.

| Term | Rule |
|---|---|
| Contract family | Stable behaviour and format boundary, for example Website V1 or Partner V1. Each surface (Website, Customer, Staff, Staff onboarding, Partner) has its own support matrix. |
| Documentation revision | Date/release number (`YYYY-MM-DD.N`) for traceability of the exact published spec. It is **not** a runtime gate. |
| Supported client profile | A qualified earlier V1 format that Gridex reads and, if needed, returns. |
| Capabilities / scopes | A new feature is used only when your client supports it and the credential has the scope. Missing a new feature never stops existing flows. |
| Legal/price version | The exact customer-accepted document, hash, product/option/quote. These must still match exactly; they are not documentation revisions. |

## Rules within V1

1. Existing endpoints, required request fields, field types, units, idempotency and business semantics are kept for supported profiles. New required fields, removed fields and breaking enum values require opt-in or a new major.
2. New response fields are compatible only where older clients tolerate them. Credential-pinned profiles project fields from closed historical response objects. This field projection does not validate every constraint or repair contradictory historical schemas; the errata below remain relevant to strict generated validators.
3. New request fields need client opt-in. Unknown or forbidden security fields are still rejected; request validation is not loosened.
4. An API key and a V1 endpoint are enough. No new mandatory version header is introduced.
5. Existing `contract_schema_version` values and headers are kept. They describe the representation actually returned.
6. A profile selection never changes company, customer, actor or privileges.
7. Each surface has its own support matrix; a Staff addition never makes a working Website integration incompatible.
8. The minimum marker stays at the existing baseline until real client tests show wider support. A documentation-only release never raises the minimum. Dates are never compared as the only compatibility check.
9. Older client profiles are re-tested on every release.
10. Breaking product changes are introduced in parallel in a new major. Planned support policy: at least **180 days announced migration window** before retirement, with tenant inventory and a migration guide. Urgent security fixes can require immediate restriction with clear communication.
11. Sunset dates in frozen releases are not changed retroactively.
12. Wrong tenant, wrong legal document hash, revoked access and genuinely missing required fields are still rejected. There is no "accept all versions" shortcut.

## Current support matrix (qualified)

| Surface | Major | Supported profiles | Notes |
|---|---|---|---|
| Website | v1 | `2026-10-02.3` (minimum), `2026-10-04.1`, `2026-10-09.1` (current) | Reference helper accepts any well-formed V1 revision and validates the business payload. |
| Customer | v1 | `2026-10-02.3`, `2026-10-04.1`, `2026-10-09.1` | |
| Staff | v1 | `2026-10-04.1`, `2026-10-09.1` | |
| Staff onboarding | v1 | `2026-10-05.2` | Separate independent-login contract; requires its external identity database objects. The archived `2026-10-05.1` prototype is not an active profile. |
| Partner | v1 | runtime spec | Separate matrix; published with the Partner docs release. |

The registry lives in `lib/integrations/apiContractCompatibility.ts`. It selects supported V1 profiles and capabilities; it does not prove that every frozen document correctly describes every runtime response. The release-classification label alone is not evidence of compatibility.

## Credential-pinned representations

An authorized OPS operator can register `metadata.api_contract_profiles` on the API credential, for example:

```json
{
  "api_contract_profiles": {
    "website": "2026-10-04.1",
    "customer": "2026-10-02.3",
    "staff": "2026-10-04.1"
  }
}
```

The selected response carries that profile's `contract_schema_version` and `X-Gridex-Contract-Version`. Closed historical response objects determine their projected field set. Only declared wire markers and the response envelope change revision; arbitrary business metadata and legal/price versions retain their values. This does not change tenant, customer, actor, permissions, pricing or exact legal evidence. A caller-supplied version header cannot change the profile. Missing profile metadata keeps the stable current representation; a documentation release alone does not change it. After successful API-credential authentication, a malformed map or unsupported revision for the selected surface fails closed before business execution with `503 api_contract_profile_unavailable`. Pins for other surfaces do not control this operation. API-credential authentication, credential revocation and credential rate-limit denials retain precedence; an identified credential's usable pin also formats its denial, while unusable configuration does not replace that denial. This configuration check precedes the separate Staff/customer assertion and binding gates, so an invalid pin can be reported before an invalid actor proof. Both gates must pass before business execution.

Shared `/integration/context` and `/events` operations prefer the configured Website profile, falling back to the configured Customer profile. The two customer-sync aliases prefer Customer, falling back to Website. Surface-specific routes select only their own profile. Keep shared-operation pins consistent when a credential serves both surfaces. Staff onboarding retains its own stable representation and does not use these three profile keys.

Conditional offer-feed cache identities include the selected profile, tenant, customer type and channel. A cached response from another representation cannot authorize a `304` for this one. The optional `X-Gridex-Documentation-Version` identifies current guide metadata on participating API responses; it is never a client admission requirement. OpenAPI download headers identify the document being downloaded, not a business response.

## Historical specification errata

The frozen Customer `2026-10-02.3` support-detail schema combines a closed base that forbids `messages` with an extension that requires `messages`. No response can satisfy both constraints. The existing detail endpoint returns its messages; the corrected later specification describes that existing behavior. Profile pinning does not remove required messages or claim to make the contradictory validator valid.

Frozen Website `2026-10-02.3` and `2026-10-04.1` describe a non-null market reference for fixed-quote validation, while the implementation returns `null` when no market reference exists. Documentation `2026-10-12.1` records that fact. The API does not fabricate market evidence to satisfy an inaccurate older schema.

These exceptions concern strict validation generated from the affected historical documents. Existing business requests do not acquire a documentation-version check. Operators using those validators must apply the specific schema correction; a blanket claim that every old document validates every response is unsupported.

## Reference helper behaviour

`refreshPublicContractFeed` (OPS reference helper):

- accepts any well-formed V1 `contract_schema_version`, including revisions newer than the helper; `expectedSchemaVersion` is deprecated and no longer requires an exact match;
- rejects an explicit other major (`contract_major` ≠ `v1`) and keeps the last verified snapshot;
- validates tenant, count, unique `offer_reference`, feed state and empty-feed authorization on every 200;
- sends `If-None-Match` and accepts `304` only for a verified snapshot of the same tenant; another tenant's snapshot is never reused, for 304 or as last known good.
