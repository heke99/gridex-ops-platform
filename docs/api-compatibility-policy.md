# Gridex API compatibility policy

> You do not need to match the latest documentation revision exactly to use a supported API version.

You integrate against a supported **contract family** (currently `v1`) per API surface. New documentation revisions do not require you to update your integration. Backward-compatible updates keep working. New features may require new capabilities or scopes. Breaking changes get a separate contract version and a documented migration period.

See the [API migration guide](api-migration-guide.md) for what each documentation revision adds and how to adopt optional additions.

## Terms

| Term | Rule |
|---|---|
| Contract family | Stable behaviour and format boundary, for example Website V1 or Partner V1. Each surface (Website, Customer, Staff, Staff onboarding, Partner) has its own support matrix. |
| Documentation revision | Date/release number (`YYYY-MM-DD.N`) for traceability of the exact published spec. It is **not** a runtime gate. |
| Supported client profile | A qualified earlier V1 format that Gridex reads and, if needed, returns. |
| Capabilities / scopes | A new feature is used only when your client supports it and the credential has the scope. Missing a new feature never stops existing flows. |
| Legal/price version | The exact customer-accepted document, hash, product/option/quote. These must still match exactly; they are not documentation revisions. |

## Rules within V1

1. Existing endpoints, required request fields, field types, units, idempotency and business semantics are kept for supported profiles. New required fields, removed fields and breaking enum values require opt-in or a new major.
2. New response fields are compatible only where older clients tolerate them. Strict clients (`additionalProperties: false`) are served a projected representation for their qualified profile.
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
| Staff onboarding | v1 | `2026-10-04.1`, `2026-10-09.1` | Requires the external identity database objects (deployment preflight). |
| Partner | v1 | runtime spec | Separate matrix; published with the Partner docs release. |

The registry lives in `lib/integrations/apiContractCompatibility.ts`. A profile is listed only after its format has been proven against the current server; the release-classification label alone is not evidence.

## Reference helper behaviour

`refreshPublicContractFeed` (OPS reference helper):

- accepts any well-formed V1 `contract_schema_version`, including revisions newer than the helper; `expectedSchemaVersion` is deprecated and no longer requires an exact match;
- rejects an explicit other major (`contract_major` ≠ `v1`) and keeps the last verified snapshot;
- validates tenant, count, unique `offer_reference`, feed state and empty-feed authorization on every 200;
- sends `If-None-Match` and accepts `304` only for a verified snapshot of the same tenant; another tenant's snapshot is never reused, for 304 or as last known good.
