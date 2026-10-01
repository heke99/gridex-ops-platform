# P2/T51: remaining telemetry producers and minimal projection proposal

Date: 2026-10-01. Read-only continuation after frozen helper/caller packages. This is a source inventory and implementation proposal, not a new reproduced leak, runtime/native PASS or whole P2/T51 closure. No production, test, public contract, historical row or frozen packet is edited here.

## Exact current inventory

The TypeScript-AST inventory covers call expressions in `app/` and `lib/`, excluding tests/scripts. It found 80 direct `logIntegrationApiRequest` calls, 18 `logPortalRequestTelemetry` calls and 25 `logCustomerPortalSuccess` calls: **123 call expressions**. The latter include wrappers around direct helper calls; they are not 123 independent persisted requests or 123 source-qualified server-ID producers. Current explicit server-ID wiring remains 36 direct calls in eight reviewed routes and 44 unbound direct calls.

Literal metadata objects/spreads and variable metadata contributions produce **189 records over 68 keys**, including the synthetic inventory keys `*spread` and `*variable`. These are source contributions, not unique persisted metadata fields. Fifty literal request-ID contributions appear when wrapper calls are included; these are not fifty genuinely generated IDs. The direct-helper-only pre-wiring inventory's 46 literal IDs uses a different denominator and remains historical evidence.

Each machine record includes exact current source path, line, expression and SHA-256. The two artifacts have no runtime data or credentials; expressions are current source code. Future source evolution requires regenerating/reviewing this inventory rather than treating line numbers or hashes as immutable current facts.

| Artifact | Records | SHA-256 |
| --- | --- | --- |
| `integration-request-telemetry-producers-20261001.jsonl` | 123 | `2bd5615294a6e9faed2d1fa4aa98dc82902e1f53c2228a2fdf3f22708b3f3ee2` |
| `integration-request-telemetry-metadata-fields-20261001.jsonl` | 189 | `c2a1835d23d9afbf1ff82db9d5e829137e366f9b15566163aa86dc14fb9109d2` |

## Actual producer boundaries

The frozen generic projection currently removes unknown/free metadata and rejects wrong scalar types before deferred persistence. The following source producers still build unnecessary or insufficiently bounded diagnostic values before that projection. Their current presence is **not** a demonstrated persisted leak through the fixed helper. Cleanup must be distinguished from reproducing a live sink defect.

| Existing source producer | Actual value/bound | Current projection behavior | Minimal producer proposal |
| --- | --- | --- | --- |
| `website/customer-applications/route.ts` `applicationMetadata` | Request `external_customer_id`; result `customer_number`; optional string error fields | Customer references omitted; UUID/application, known error/stage/field values retained only when valid | Build only count, returned UUID and existing canonical technical fields; remove external/customer-number fields from diagnostic construction |
| `customer-portal/sync/route.ts` `serializePortalSyncError` | Arbitrary name/message/code/details/hint from caught error | Entire `portal_sync_error` object omitted | Use the frozen constant technical diagnostic's database code, without constructing/passing the raw record; preserve original response/error/status and business idempotency behavior |
| `customer/portal-bundle/route.ts` | `customerStatus.issues` is an array of fixed `PortalStatusIssue` labels | `data_quality_issues` is currently count-only, so the array is omitted | Supply `customerStatus.issues.length` under that existing numeric key; preserve public issue/status arrays and business logic |
| Same portal bundle | Warning objects/section arrays and included-section arrays | Structured values omitted; existing complete/partial/count/summary/access-mode scalars retained | Keep existing booleans/counts; avoid passing complete warning/error/section objects to generic diagnostics; any new section count needs explicit whitelist/consumer review |
| `events/route.ts`, `website/customer-events/route.ts` | Incoming event type accepts `customer.[a-z0-9_]+`; this is an open string space | `event_type` omitted | Use a numeric `events` count or fixed existing operation label; preserve canonical business/domain-event type and payload |
| `customer/metering-values/route.ts` | External customer/facility identifiers and date windows; `source_table` is a literal constant | Those fields omitted | Retain result count and reviewed current request ID; omit customer/facility/window diagnostics; the redundant table constant is already represented by the technical route |
| `website/market-price/current/route.ts` | `provider=String(selected.source)`, provider period timestamps and spread `error.details` | Unknown provider/time/detail keys omitted; supported typed fields alone retained | Supply only existing price-area/resolution/count/technical fields; do not spread arbitrary details or assume a database string is a closed provider enum |
| `website/energy-area/resolve/route.ts` | Resolution status has an actual finite type; price area/UUID/cache-hit are bounded | Status omitted; valid price-area/UUID/cache-hit retained | Keep current supported scalars; retaining a new status key requires an explicit exact enum/consumer review, without altering resolution or provider decisions |
| `website/legal-bundle/route.ts` | Missing-type list and source offer reference | Both omitted; result count/completion retained | Keep completion/count; omit source references and unreviewed lists from diagnostics |
| Switch/application status, quote/validation routes | Customer application numbers and source quote/offer references; validation details object | These unsupported values omitted | Keep current canonical outcome/count/request ID; keep full public/business references only in their existing authorized response/document paths |
| API/website contract feeds | RPC fingerprint and derived representation ETag | Both omitted; revision/count/channel/diagnostics retained | Keep revision/count/current request correlation; do not add opaque namespaces without a concrete cache-diagnostic need and verified producer bound |
| `externalApi.ts` success wrapper | Spread of arbitrary caller metadata | Fixed generic projection ultimately bounds it | Prefer explicit route literals/scalars at each caller; do not duplicate a second broad permissive redactor or promote wrapper input IDs into server authority |

`PortalCustomerStatus.code` is a real finite six-value type, `PortalStatusIssue` is a finite nine-value type and `EnergyResolutionStatus` is a finite seventeen-value type. That source fact is not a reason to retain every status/issue in diagnostics. Conversely, the event-type regex and market-provider string are not closed enums. A general string/regex test must not be used to infer privacy or trusted provenance.

## Proposed validation and ownership sequence

The smallest coherent first producer package is the portal-bundle numeric issue count and portal-sync constant diagnostic, plus application metadata's unnecessary-reference omission. It must use unique actual-export tests with controlled outer DB/identity boundaries. For a numeric-count defect, prove the current exported bundle omits the expected count under a real nonempty issue state, then verify the corrected count without changing public issue/status contents or saved business effects. For any privacy claim, first reproduce an actual reachable persisted/log sink; a raw local object already filtered by the helper is insufficient RED evidence.

Do not rewrite customer/domain-event/outbox payloads, provider IDs, original invoice/document evidence, historical telemetry or public DTOs. Those are business evidence, not generic diagnostic metadata. No widened grant or email-only/customer identity claim follows from these projection proposals.

The 44 unbound direct helpers and the portal wrappers need a separate request-ID producer review. Some routes genuinely generate an ID themselves; others let `customerPortalJson` create the response ID after logging, so simply generating a new logging-only UUID would produce unrelated correlations. The partner modules and catchall deliberately reuse inbound IDs and must remain unverified unless a distinct reviewed server correlation is created while preserving the existing public request-ID contract. Neither header/metadata format nor the existing provenance marker grants tenant/actor authority.

The unchanged top-level telemetry fields—route, IP, user agent, idempotency key and `input.errorCode`—remain a separate source/necessity/canary proof boundary. Some error-code producers are genuine closed typed classifiers; dynamic database/business properties require their actual producer chain before being labeled safe or leaking. This report does not widen the frozen helper whitelist, reserve existing producer files, claim a new runtime gate or declare all T51/P7 logs safe. Native persistence, real API/browser and external provider execution counts are **0**.
