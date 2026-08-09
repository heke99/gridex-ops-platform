# Codebase health findings — 2026-08-06

Branch: `cursor/codebase-health-and-stability-fb8e`  
Based on `main` after GRIDEX-OPS-BL-002 (`bb877506`) plus the PHASE-45 health package from `6531`.

## Fixed (verified)

| ID | Severity | Finding | Fix |
| --- | --- | --- | --- |
| H-001 | High | Quote hash diverged for PostgREST `+00:00` vs JS `Z` on top-level timestamptz | `canonicalQuoteTimestamptz` for `valid_until` and `market_data_timestamp` |
| H-002 | High | Nullable/case-sensitive `grid_area_code` quote compares | shared `canonicalQuoteGridAreaCode` |
| H-003 | High | Local `verify-openapi-release` green without immutable artifacts/registry | fail-closed immutable JSON/route/registry checks |
| H-004 | Medium | Quote response example missing required `offer` | finalize seed + rematerialized release bytes |
| H-005 | Medium | Application merge compared grid areas case-sensitively | `normaliseGridAreaCode` on claims and compares |
| H-006 | Medium | Metering-point patch compared grid/price areas case-sensitively | shared normalizers before conflict detection |
| H-007 | Medium | Current market-price example missing required resolution fields | seeded `selected_resolution`, `available_resolutions`, `fallback_used` |
| H-008 | Low | Developer guide pinned `2026-08-05.1` | examples/prose bumped to `2026-08-05.2` |
| H-009 | High | Quote create accepted mixed-case `price_area` against resolution, then validate compared case-sensitively to uppercase resolution area | persist uppercase `price_area`; validate/snapshot compares are case-insensitive |
| H-010 | Medium | AI/BI import discrepancy used case-sensitive `grid_area_code` compare | local uppercase/whitespace normalize before mismatch |
| H-011 | High | Base-component parse treated lowercase `se3` as global (`null`) and underlay filter compared areas case-sensitively | shared `canonicalSwedishPriceArea` in parse + `filterBaseComponentsForUnderlay` |
| H-012 | High | Public fixed-offer completeness compared `price_areas` / area rows case-sensitively | canonicalize offer areas and area-price rows via `canonicalSwedishPriceArea` |
| H-013 | Medium | Portfolio monthly history filter compared `price_area_code` case-sensitively to uppercased query | canonicalize projection and route filter |
| H-014 | Medium | Application site/metering writers persisted raw `clean()` grid codes while merge used `normaliseGridAreaCode` | route explicit writers through `normaliseGridAreaCode` |
| H-015 | Low | Quote create uppercased `price_area` but not `grid_area_code` | persist + hash `canonicalQuoteGridAreaCode` (hash uses the same persisted value) |

## Open / blocked

| ID | Status | Note |
| --- | --- | --- |
| O-001 | BLOCKED | Full npm typecheck/test/lint/build — `node_modules` absent in this sandbox |
| O-002 | PENDING | Live quote create → validate E2E after deploy |
| O-003 | PENDING | Private/business legal-bundle → POA → supplier-switch E2E (PHASE-44) |
| O-004 | OPEN | Prefer one health merge onto main; close overlapping siblings `#75`–`#81` / `#83` |
| O-005 | CODE_REMEDIATED | BL-002 variant: `platform_actor_contacts` broad authenticated SELECT — remediated as GRIDEX-OPS-BL-006 (`20260809123000`) |
| O-006 | CODE_REMEDIATED | BL-002 variant: lookup-cache broad authenticated SELECT — remediated as GRIDEX-OPS-BL-006 (`20260809123000`) |
| O-007 | CODE_REMEDIATED | Admin `/admin/network-owners` import history now reads via `supabaseService` after `requirePlatformAdminAccess()` |
| O-008 | OPEN | `actor_readiness_status` (security_invoker) can under-count conflicts for non-admin JWT; current app uses service role — revoke authenticated SELECT or keep consumers on service role |

## Unverified / out of scope this pass

- Full quality-playbook / threat-model analyst suite against entire repository
- Nested JSONB timestamp rewriting (intentionally frozen at write)
- Production deploy of OPS source
- Changing `fullQuoteIntegrityPayload` to auto-uppercase `price_area` (would break existing lowercase quote hashes)
- Next database/RLS remediation workstream (program: one overlapping RLS branch at a time; BL-002 just merged)

## Verification executed

- `gridex:price-area-case-normalization-regression`
- `gridex:quote-null-grid-area-regression`
- `gridex:website-quote-integrity-regression`
- `gridex:aibi-grid-area-case-regression`
- `api:release:verify` (local)
- `api:docs-examples` / `api:docs-version`
- `api:compatibility`
- `gridex:explicit-input-preservation-regression`
