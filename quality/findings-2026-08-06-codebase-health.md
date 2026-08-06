# Codebase health findings — 2026-08-06

Branch: `cursor/codebase-health-and-stability-6531`  
Superset of `ec6b` / PR #81 after main tip `ffe4d0b0` (skill execution contract sync).

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

## Open / blocked

| ID | Status | Note |
| --- | --- | --- |
| O-001 | BLOCKED | Full npm typecheck/test/lint/build — `node_modules` absent in this sandbox |
| O-002 | PENDING | Live quote create → validate E2E after deploy |
| O-003 | PENDING | Private/business legal-bundle → POA → supplier-switch E2E (PHASE-44) |
| O-004 | OPEN | Prefer this branch / one merge onto main; close overlapping siblings `#75`–`#81` |

## Unverified / out of scope this pass

- Full quality-playbook / threat-model analyst suite against entire repository
- Nested JSONB timestamp rewriting (intentionally frozen at write)
- Production deploy of OPS source
- Changing `fullQuoteIntegrityPayload` to auto-uppercase `price_area` (would break existing lowercase quote hashes)

## Verification executed

- `gridex:quote-null-grid-area-regression`
- `gridex:website-quote-integrity-regression`
- `gridex:aibi-grid-area-case-regression`
- `api:release:verify` (local)
- `check-api-documentation-examples`
- `check-api-documentation-version`
- `check-api-compatibility`
- `check-public-contract-runtime-openapi`
- `gridex-explicit-input-preservation-regression`
