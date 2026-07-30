# Verification matrix

| ID | Scope | Status | Evidence |
| --- | --- | --- | --- |
| VM-001 | Project memory | VERIFIED | Required structure, JSON and secret scan |
| VM-002 | Resolver capabilities | VERIFIED | Unit tests and route/OpenAPI parity |
| VM-003 | Public application DTO/IDs | VERIFIED | Sanitizer tests and ID policy |
| VM-004 | Switch creation/dispatch | VERIFIED | DTO and portal status tests |
| VM-005 | Billing readiness | VERIFIED LOCALLY | Pure tests; real loaders typechecked |
| VM-006 | Invoice resource purity | VERIFIED | List/detail source tests |
| VM-007 | Interval binding | VERIFIED | Hourly/quarterly selection tests |
| VM-008 | Cron tree/auth | VERIFIED | 22 registered crons mapped to authenticated routes |
| VM-009 | Atomic activation | STATIC VERIFIED | Migration/state-machine regression |
| VM-010 | Migration history | VERIFIED | 303 files; 208 groups; checksums |
| VM-011 | API/OpenAPI/docs | VERIFIED | `npm run api:docs` |
| VM-012 | Typecheck | VERIFIED | `npm run typecheck` |
| VM-013 | Full tests | VERIFIED | 54 files; 354 tests |
| VM-014 | Lint | VERIFIED | 0 errors; 125 existing warnings |
| VM-015 | Production build | VERIFIED | Next build generated `.next/BUILD_ID` |
| VM-016 | PostgreSQL migration apply | BLOCKED | No Supabase CLI/database |
| VM-017 | Two-tenant DB isolation/E2E | BLOCKED | Requires authorized test DB |
| VM-018 | Live deployed parity | PENDING DEPLOY | Live contract older than local |
| VM-019 | Terminal contract lifecycle | STATIC VERIFIED | Migration regression, types and admin flow |
| VM-020 | Tenant lifecycle readiness | STATIC VERIFIED | RPC regression and governance tests |
| VM-021 | Integration tenant gate | VERIFIED LOCALLY | Status mapping tests and full suite |
| VM-022 | Contract deletion graph | STATIC VERIFIED | Dedicated regression; SQL parser accepted 32 statements |
| VM-023 | Bulk failure isolation | STATIC VERIFIED | Exception-subtransaction and durable-reference regression |
| VM-024 | Contract list pagination | VERIFIED LOCALLY | Typecheck and production build |
| VM-025 | Contract/company admin alignment | VERIFIED LOCALLY | Tenant links, separate counts, revalidation regression and build |
| VM-026 | Delete preview execute boundary | STATIC VERIFIED | Authenticated execute revoked in append-only migration |
| VM-027 | Runtime/OpenAPI auth error parity | VERIFIED | API docs checks and alignment regression |
| VM-028 | Stable contract list/lazy diagnostics | VERIFIED LOCALLY | Typecheck, lint and cheap final view |
| VM-029 | Strict tenant/role normalization | STATIC VERIFIED | Central TS/SQL predicates |
| VM-030 | Legal customer matching | VERIFIED LOCALLY | Matching regressions and final RPC |
| VM-031 | Exact supply/underlay identity | STATIC VERIFIED | Runtime comparison and DB triggers |
| VM-032 | Canonical invoice export bridge | STATIC VERIFIED | Monthly runtime and atomic graph RPC |
| VM-033 | Customer invoice traceability | VERIFIED LOCALLY | Portal select and OpenAPI |
| VM-034 | Focused contract tests | VERIFIED | 40/40 contract, 18/18 fixed-area |
| VM-035 | Focused identity/supply/billing tests | PARTIAL | 49/54; 5 legacy fixtures lack exact IDs |
| VM-036 | Migration history | VERIFIED | 304 files; 209 groups; checksums |
| VM-037 | Provider webhook round trip | BLOCKED | No sandbox/credentials |
| VM-038 | Exported live lint coverage | VERIFIED | 23/23 error functions covered |
| VM-039 | Exact live function patches | VERIFIED | 41/41 match active exported definitions |
| VM-040 | Code/live relation and RPC paths | VERIFIED | 4,759 writes, 3,679 field accesses, 120 literal RPC calls |
| VM-041 | Live repair SQL parse | VERIFIED | Migration 141, preflight 12, post-apply 14 statements |
| VM-042 | Current migration integrity | VERIFIED | 319 files; 223 version groups; checksums |
| VM-043 | Current full tests | VERIFIED | 55 files; 357 tests |
| VM-044 | Current API/OpenAPI | VERIFIED | Version `2026-07-28.1`; all parity checks pass |
| VM-045 | Current production build | VERIFIED | Next.js build completed |
| VM-046 | Production repair apply/postflight | BLOCKED | Requires authorized operator/database |
| VM-047 | Historical canonical baseline | PENDING | Must derive from verified post-apply export |
| VM-048 | Contract channel grants/publication | STATIC VERIFIED | 43/43 dedicated controls |
| VM-049 | Contract go-live/lifecycle | VERIFIED LOCALLY | 212 go-live and 518 lifecycle controls |
| VM-050 | Current full tests | VERIFIED | 56 files; 361 tests |
| VM-051 | Current API/OpenAPI | VERIFIED | Version `2026-07-28.2`; parity/docs checks pass |
| VM-052 | New migration checksum | VERIFIED | `20260728190000...` matches manifest |
| VM-053 | Historical migration integrity | BLOCKED | `20260728170000...` immutable checksum drift |
| VM-054 | Channel post-apply and scenarios A-H | BLOCKED | Requires trusted history and authorized PostgreSQL/API environment |
| VM-055 | Commercial model TypeScript | VERIFIED | App and test targets pass |
| VM-056 | Commercial unit/full tests | VERIFIED | 57 files / 365 tests |
| VM-057 | Commercial static regression | VERIFIED | Admin/quote/internal/snapshot/billing chain |
| VM-058 | API/OpenAPI/docs | VERIFIED | Version `2026-07-29.1`; all parity checks pass |
| VM-059 | Commercial production build | VERIFIED | Clean Next.js build completed |
| VM-060 | New commercial migration checksum | VERIFIED | `20260729200000...` exact manifest match |
| VM-061 | Commercial PostgreSQL apply/post-apply | BLOCKED | Requires BLK-003 recovery and authorized staging |
