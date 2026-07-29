# Current state

Last updated: 2026-07-29T15:56:55+02:00

- PHASE-31 commercial contract model: IMPLEMENTED and LOCALLY VERIFIED; DATABASE VERIFICATION BLOCKED.
- Canonical schema is `gridex_contract_pricing_v6_selection`.
- Price options and SE-area rows have stable references and belong to one product/price-plan version.
- Components carry stable code/reference, selection policy, conditions, lifecycle, invoice line and accounting classification.
- Admin offer authoring is genuinely type-driven; hidden fields from another contract type are unmounted.
- Website quote and internal customer registration use the same resolver.
- Quote hash v3 covers exact selection and resolved component arrays while historical v2 quotes remain verifiable.
- Website and internal customer contracts freeze exact base/price components.
- Billing reads the immutable contract snapshot and fails closed on incomplete v6 identity; once/annual/invoice lifecycle gates are explicit.
- API/OpenAPI/docs are synchronized at `2026-07-29.1`.
- Verification: app/test TypeScript pass; changed runtime ESLint has zero errors; 57 files/365 tests pass; API contract/parity/version/examples pass; focused regression passes; Next.js production build passes.
- New migration SHA-256 is `59c19820866d186567914b12fcf831cc94c769ba200038034fbc4e172603d80c` and is registered exactly.
- Migration integrity remains blocked only by pre-existing immutable `20260728170000...` drift (`a743...` actual versus `881e...` expected).
- Release remains NO-GO until trusted historical recovery and authorized clean/upgraded staging apply, post-apply and end-to-end parity tests pass.
