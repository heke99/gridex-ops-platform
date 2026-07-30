# Current state

Last updated: 2026-07-30T13:05:00+02:00

- PHASE-33 canonical API/tenant production repair: IMPLEMENTED and LOCALLY VERIFIED; DATABASE/LIVE/WEB E2E REMAIN BLOCKED.
- Historical migration `20260728170000_live_schema_code_canonical_sync.sql` was recovered byte-for-byte from the prior trusted synchronized archive and now matches registered SHA-256 `881e1bc552b6a6295b6bc993cec82e55a25c56f0d5cdf525a784e33d2222d482`.
- Intended changes that had been inserted into that immutable file were moved to forward migration `20260730130000_historical_sync_forward_repair.sql` with registered SHA-256 `3e204b00fa33badbfdc7a11c0304df3bc5385b16e0854e40af2df1c06b32b50b`.
- Migration integrity passes: 323 files, 227 version groups and all registered checksums.
- Release-manifest hashing now uses the exact pretty-printed bytes served by the OpenAPI routes, and the manifest route is `no-store`.
- Public error responses are normalized centrally to one nested error envelope; integration context and quote responses no longer emit duplicate `meta`/`quote` aliases.
- Webhook payloads use tenant-bound opaque event/delivery/customer/aggregate references and recursively exclude raw database `id`/`*_id` fields.
- OpenAPI Website and Customer Portal documents were regenerated at `2026-07-30.1`; exact local SHA-256 values are website `9ad3fc518d9aadb687141af2df7d3068df8f7daca530cc01b525d4b94c816b7b` and portal `a3e3f475f3822f30efab4e9a792d714585bacc98773d52790adf12072ed3251e`.
- Verification: all TypeScript targets pass; 58 files/373 tests pass; API docs/parity/examples/shared boundaries, migration integrity, API error boundaries, tenant/performance gates, zero-error lint and Next.js production build pass.
- Live endpoints return HTTP 200 at version `2026-07-30.1`, but deployed manifest hashes do not match the bytes served and do not match this patch; deployment plus live revalidation is required.
- Release remains NO-GO: no authorized clean/upgrade PostgreSQL apply, staging API keys, two-tenant fixtures, provider/webhook round trip or Gridex Web source was supplied. Three pre-existing allowlisted duplicate migration timestamps also remain unresolved pending authoritative migration-ledger provenance.
