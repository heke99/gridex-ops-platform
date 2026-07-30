# Current state

Last updated: 2026-07-30T18:08:00+02:00

- PHASE-34 Customer Portal/API production completion: IMPLEMENTED and LOCALLY VERIFIED; DATABASE/LIVE/WEB E2E REMAIN BLOCKED.
- `/customer/sync` now has one strict runtime/OpenAPI contract for profile, facility data, documents, legal acceptances, power of attorney and metadata.
- Customer identity is normalized tenant-safely and public portal/application DTOs use stable tenant-bound references rather than internal UUIDs.
- Move-out now resolves external contract/facility references and commits completion, case, domain event, outbox and audit state through one idempotent database command.
- The forward migration `20260730153000_customer_portal_api_production_completion.sql` is registered with SHA-256 `b5a9f323400a4e3592f3e392bf94695161969c1d5b0ba8d99cace9821338d740`.
- Migration integrity passes: 324 files, 228 version groups and all registered checksums.
- Website and Customer Portal OpenAPI documents are synchronized at `2026-07-30.2`; exact local SHA-256 values are website `920a774c10ee8cc32ea5db62a8d898119f7ca59aa50896041d9d14a734a5bcd1` and portal `0371233929e6bafff463d7171e18a39712cb98577830aaff0669822f9184e315`.
- Verification: all TypeScript targets pass; 58 files/373 tests pass; API docs/parity/examples/shared boundaries, compatibility, release artifacts, migration integrity, API error boundaries, tenant/performance gates, zero-error lint and Next.js production build pass.
- Release remains NO-GO: no authorized clean/upgrade PostgreSQL apply, deployment, staging API keys, two-tenant fixtures, provider/webhook round trip or Gridex Web source was supplied. Three pre-existing allowlisted duplicate migration timestamps remain unresolved pending authoritative migration-ledger provenance.
