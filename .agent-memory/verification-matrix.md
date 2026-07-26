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
| VM-010 | Migration history | VERIFIED | 302 files; 207 groups; checksums |
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
