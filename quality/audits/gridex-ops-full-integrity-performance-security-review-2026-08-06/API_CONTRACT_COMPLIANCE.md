# API contract compliance

## Contract baseline

- Current website integration and customer portal artifacts identify contract version `2026-08-05.2`.
- Current snapshots and immutable release files/routes for `2026-08-05.2` exist.
- Exact deployed runtime, external tenant client version and generated declaration parity were not available.

## Compliance matrix

| Endpoint/group | Implementation | Runtime schema | OpenAPI | Generated types | Client usage | Database | Status |
|---|---|---|---|---|---|---|---|
| `POST /api/v1/website/quote` | Present | Source validation present | Documented | File exists; exact regeneration not run | External website not connected | Quote tables/functions inspected partially | `DRIFT_CONFIRMED` for timestamp hash semantics |
| `POST /api/v1/website/quote/validate` | Present | Source validation present | Documented | Exact parity not run | External website not connected | Rehydrates persisted quote | `DRIFT_CONFIRMED` with create/read serialization |
| Website public contracts/diagnostics | Present | Runtime mappers/helpers present | Current + immutable routes present | Not regenerated | External client not connected | Diagnostics view service-role-only | `NOT_VERIFIED` end-to-end |
| Website customer applications + continuation | Present | Large orchestration and allowlisting | Documented | Not regenerated | External tenant not connected | Multi-domain writes | `NOT_VERIFIED` end-to-end |
| Energy-area resolve | Present | Runtime validation present | Documented | Not regenerated | External tenant not connected | Geodata/grid-owner views | `NOT_VERIFIED`; performance hotspot |
| Market/portfolio/current price | Present | Runtime modules present | Documented | Not regenerated | External tenant not connected | price/market tables | `NOT_VERIFIED` external freshness/fallback |
| Customer portal sync | Present | Controlled request path | Documented | Not regenerated | Portal client not connected | Multi-domain upsert/sync | `NOT_VERIFIED` deployed error/size behavior |
| Customer portal resource routes | Present | Thin server adapters | Documented group | Not regenerated | Portal client not connected | customer-scoped objects | `NOT_VERIFIED` per-field/two-tenant |
| OpenAPI current/immutable/manifest routes | Present | Static route serving | Artifacts present | N/A | Client fetch not run | N/A | `CONSISTENT` at repository presence level |
| Internal admin API/routes | Broad App Router surface | Mixed | Public documentation not required | N/A | Admin UI | RLS/service modules | `NOT_VERIFIED` complete inventory |
| Cron/webhook/worker endpoints | Present across source/scripts | Mixed | Internal/provider docs vary | N/A | External providers unavailable | queues/jobs/events | `NOT_VERIFIED` replay/signature E2E |

## Confirmed drift: quote timestamp canonicalization

`lib/pricing/quoteIntegrity.ts` canonicalizes `valid_until`. In `lib/pricing/websiteQuotes.ts`, `market_data_timestamp` is placed into the hash payload without the same canonicalization. PostgreSQL/PostgREST may return the same UTC instant as `+00:00`, while JavaScript emits `Z`; JSON hash bytes differ although time semantics do not. This violates immutable quote equivalence and can surface as `quote_underlaget har ändrats`/integrity validation failure.

## Contract controls present but not gated

Repository scripts exist for OpenAPI release verification, documentation version checks, API examples, compatibility and contract regressions. The current single GitHub workflow does not execute the complete set.

## Required release proof

- Generate OpenAPI and `.d.ts` from the same exact head.
- Byte/schema compare current and immutable artifacts.
- Execute request/response contract tests for every public operation and error status.
- Run quote create -> database read -> validate -> application using real serialization.
- Test money/decimal, kWh/Wh, öre/SEK, nullable fields, enums and timestamp zones.
- Verify external tenant and portal clients pin or accept the current version.
- Confirm no internal fields appear in public responses and request/correlation IDs survive failures.