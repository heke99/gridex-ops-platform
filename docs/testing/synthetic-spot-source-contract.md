# Synthetic spot originals: capture and review

This capability records explicitly synthetic test originals. Capturing or reviewing an original does not approve it for pricing, settlement, invoicing, provider delivery or production use.

## Scope

The first delivery writes only a new private `gridex_synthetic_spot_sources` archive and append-only event ledger. It does not write the existing source catalog, company source policies, spot intervals, summaries, pricing runs or invoices. `consumer_enabled` is always false. Consumer selection, immutable pricing lineage, production refusal and qualified time/fixture applicability are a separate required delivery before these originals can be used financially.

Original bytes are stored as immutable `bytea`, at most 1 MiB, with a server-computed SHA-256. This makes capture, the original and its first event atomic. No Storage object or external market-original authenticity is claimed.

## Original wire format

`POST /api/internal/pricing/synthetic-spot-sources` accepts raw UTF-8 JSON and an `Idempotency-Key` UUID header. The exact top-level keys are:

- `schema`: `gridex-synthetic-spot-source-v1`
- `declaration`: `SYNTHETIC_TEST_DATA_NOT_MARKET_ORIGINAL`
- `sourceVersion`: ASCII `[A-Za-z0-9][A-Za-z0-9._-]{0,63}`, without normalization
- `billingMonth`: a valid `YYYY-MM`, year 1900–2100
- `civilZone`: `Europe/Stockholm`
- `priceArea`: `SE1`, `SE2`, `SE3` or `SE4`
- `resolution`: `PT60M` or `PT15M`
- `currency`: `SEK_PER_KWH`
- `intervals`: objects with exactly `start`, `end`, `priceSekPerKwh`

Instants are valid UTC ISO strings ending in `:00.000Z`. Hours are 00–23. Each interval has the declared physical duration; the ordered input covers the entire Stockholm calendar month without duplicates, gaps, overlap or out-of-period rows. Spring and autumn transitions retain every physical UTC interval. Both TypeScript and SQL independently establish month bounds, duration and counts.

Prices are decimal strings matching `^-?(0|[1-9][0-9]{0,5})(\.[0-9]{1,6})?$`, with absolute numeric value at most 100000. Negative lexical zero is rejected. Negative and ordinary zero prices remain valid. Original decimal spelling and all original bytes remain preserved.

The API uses a bounded stream reader, fatal UTF-8 decoding and exact `JSON.stringify` wire equality. SQL parses the original itself, rejects duplicate object keys and validates the full schema, tuple, decimals and coverage independently. SQL must not trust caller-supplied normalized tuples, coverage or hashes. Client company, actor, capture/approval times and authentic provider claims are not accepted original fields.

## Identity and private access

API company and actor come from the existing authenticated operational-company guard. Platform actors are explicitly rejected. SQL also requires a confirmed, nonanonymous, nondeleted, nonbanned Auth user, active profile and company, an active accepted membership, and the DENY-aware `gridex_actor_has_company_permission` result. `canonical_actor_is_platform_admin(actor)` must be false. `canonical_actor_is_authorized` alone is insufficient.

Capture and review require `pricing.write`. Read permits `pricing.read` or `pricing.write`, with the same current identity checks. Public/anonymous/authenticated execution and direct private table access are revoked; only narrowly scoped service RPC execution is granted. Functions use a fixed search path and qualified names. Private tables also enable RLS. Protected triggers reject original/event update, delete and truncate; privileged DDL resistance is not claimed.

## RPC interface

The application derives all context and calls these service-only RPCs:

- `public.gridex_capture_synthetic_spot_source_v1(p_company_id uuid, p_actor_user_id uuid, p_request_key uuid, p_original_base64 text)`
- `public.gridex_read_synthetic_spot_source_v1(p_company_id uuid, p_actor_user_id uuid, p_source_id uuid, p_include_original boolean, p_request_key uuid DEFAULT NULL)`
- `public.gridex_review_synthetic_spot_source_v1(p_company_id uuid, p_actor_user_id uuid, p_source_id uuid, p_request_key uuid, p_expected_previous_event_id uuid, p_decision text, p_reason text)`

Capture/read receipts contain `source_id`, `original_sha256`, `source_version`, `billing_month`, `price_area`, `resolution`, `period_start`, `period_end`, `interval_count`, `expected_interval_count`, `covered_minutes`, `original_byte_length`, `capture_event_id`, `latest_event_id`, `latest_event_sha256`, `status`, `consumer_enabled:false` and `replayed`. Instants in JSON receipts use canonical millisecond UTC strings. Read adds `original_base64` only when requested. Review adds its stable `event_id` and `decision`; `status` and `latest_event_id` describe the current ledger head even for replay of an older command.

The adapter validates returned identities, hashes and tuple against the requested operation. Unexpected or uncertain results stop without an automatic mutation retry or deletion.

## Idempotency and review

The capture command key is scoped to company and actor. An exact original replay returns the original receipt without another event. Different bytes under the same command key conflict. Company, source version, billing month, price area and resolution form a separate unique subject/version tuple: another command colliding with it conflicts even for identical bytes. A caller reads the existing original explicitly.

`GET /api/internal/pricing/synthetic-spot-sources?id=UUID` returns its owner's receipt. After an uncertain capture outcome, `GET ?requestKey=UUID` reconciles the actual persisted capture without a mutation retry: this selector is restricted to the current company, current capture author and key. Exactly one selector is required; ambiguous or duplicate selectors are rejected. SQL enforces the same rule independently. Another authorized company reader can use a known source ID but cannot resolve another author's capture key.

`download=original` returns exact bytes, with `Cache-Control: private, no-store`, `X-Content-Type-Options: nosniff`, JSON content type and a server-derived UUID attachment filename. Foreign and unknown source IDs or capture keys return the same 404. Current authorization is checked before any replay or reconciliation lookup.

`POST /api/internal/pricing/synthetic-spot-sources/{sourceId}/review` accepts exactly `commandKey`, `expectedPreviousEventId`, `decision` and `reason`. Keys are UUIDs; reason is 1–500 characters. Next route parameters are awaited. The current authorized reviewer must differ from the capture author. Review commands lock the source, require the current predecessor event, and append a hash-linked event using actual server time. Originals never change.

Allowed transitions are captured/held to hold, reject or review_capture; reviewed_capture_only to hold or reject; rejected is terminal. Exact review replay is checked after current authorization and returns its original event without changing the ledger. A reused key with changed command data or a stale predecessor conflicts. Latest status is derived from the ledger, not rewritten on the original row.

Declared historical or future test periods are only captured as declared test subjects. Capture/review timestamps are real server times. They do not grant retrospective, future settlement, market or delivery authority. No global clock mutation is used.

## Verification and remaining gates

Controls exercise the actual parser, route callbacks and migration functions, including direct service calls that bypass TypeScript validation. They cover current authorization, foreign scopes, changed original/key/version, independent review, stale/concurrent predecessors, full DST coverage, immutable original/event state and exact replay. Existing market/policy/pricing/invoice graphs remain unchanged.

The migration itself uses `BEGIN`/`COMMIT`. Canonical replay calls `psql -f` without a surrounding single transaction, so the forward must not expose partially created definer RPCs before its final privilege revocations. A statement-roundtrip failure control reproduces the old partial schema/default-PUBLIC execution and verifies that the wrapped forward rolls back the namespace and all three RPCs completely.

PGlite and finite service ports are component evidence only. The migration still needs T4's normal checksum/GEN qualification, qualified native replay and execution. Financial consumers and production-lineage refusal must be implemented and verified before a complete TERM scenario can pass. All original T2 vectors, dates, fees and historical verdicts remain unchanged.
