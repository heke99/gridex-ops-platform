# Successful retry binding — coherent fix round 1/5

Status: **implemented candidate, native and independent re-review pending; not accepted or merge-ready**. Continue from published `c02f3ba6479fa890474925317f89981a90cb3016` and root documentation receipts, preserving the original design and qualified case/closure work. Full review baseline remains `33fc777076a123b2e6c47b2d3f4ef939833883f4`; this round addresses the frozen `32d44111` review. No hosted writes, deployment, messages, main or PR310 changes.

## Findings and fixes

1. **Billing ownership, real RED → GREEN:** `ediel-utilts-bound-ownership.test.ts` initially produced 3 FAIL / 1 PASS because real `ingestBillingUnderlay` inserted despite changed point grid owner, point site or site grid owner. Checks now also cover customer-site ownership and explicit frozen links. Five tests pass, including the unchanged positive. The positive deliberately asserts use of the new atomic stored-contract RPC instead of a direct insert; this is the changed external write boundary, not a removed behavioral assertion.
2. **Atomic authoritative writes:** both actual sink adapters forward their private cloned returned contract, source ID and current actor. New service-only metering/billing RPCs load the accepted reservation, complete physical membership, sealed current source/hash/context and immutable stored series/contract/hash. They compare the supplied returned contract(s) to that stored authority, derive all business write arguments in SQL, and lock customer, sites/customer-site, point, grid owner and request with `FOR SHARE` through insertion. Thus an ownership update cannot occur between the decisive comparison and write. Expected returned-contract equality also prevents a changed reservation pointer from silently substituting another projection. Metering calls the existing atomic dual-projection writer under a canonical-key advisory lock. Billing serializes by source, derives the complete contribution set/common context, writes frozen customer-site too, and reuses an equal existing source underlay. Existing unrelated generic callers retain their prior APIs.
3. **Actual E30 projection, real RED → GREEN:** accepted real-runtime `1:805` two-hour/two-QTY and `30:806` one-hour/two-QTY controls first failed because each observation inherited the entire transaction interval (2 FAIL / 9 PASS). The producer now expands E30 observations using the existing complete resolution/calendar arithmetic before applying the explicit offset, then uses the unchanged pure extractor. Both controls pass; a separately accepted `1:802` two-month/two-QTY control also passes. Positive controls use `+0100`; these are actual-runtime proofs, not an assertion of broader national certification. E66's existing canonical energy-only projection remains intact.
4. **Tenant ratchet:** the added natural-duplicate source read now uses genuine `tenantDb(companyId)`, with a narrow read-surface type for its intentionally unknown query return. No baseline increase or disguised unscoped call. Executed ratchet: 2402 call sites / 453 files, unchanged, PASS.
5. **Strict SQL shape parity:** new forward preserves the prior validator as a private base and replaces the existing validator at the same signature/OID, adding null-safe billing requestScope checks, numeric month/year type/integer/range validation, finite quantity representation and empty/padded string rejection. Previously published migration bytes are unchanged. Direct native malformed/null/wrong-type probes target the RPC, not only the TypeScript validator.
6. **Actual native helper feedback:** root reports c02 OPS `35879679881`, job `107244605050`, reached 82/84 native PASS. The two failures were SQL helper JSON decoding, not failed business assertions: bare PostgreSQL booleans from `SELECT is_current` and `SELECT has_function_privilege` render `f`; `JSON.parse('f')` raises Unexpected end of JSON input. The helper now recognizes only exact `t`/`f` as booleans and otherwise keeps strict JSON parsing. All existing assertions remain. Artifact `10759709893` is log-only; type/schema generation was not reached.

## Forward migration and authority

Authentic pinned `/workspace/scratch/db7cad0629c3/tools/supabase` 2.101.0 command: `migration new ediel_utilts_bound_sink_authority`. CLI created `20260923150649_ediel_utilts_bound_sink_authority.sql`, strictly later than 135706; observed preceding system timestamp was 150648. No clock spoof, rename or old migration rewrite. Final registered SHA256: `be5e58728e24c591a0c4d5e38c04ce86b770ed6e717d071b3475f48791a67d1a`.

The original migration remains at the explicitly approved syntax-exception SHA `c6376a62644efe24a733a872410d48d6f74372e68d4c0c56db03fd2a6380df7e`. The new forward grants only the two public consumption RPCs to service role; private functions remain revoked for public/anon/authenticated/service. Hardened search paths and UTC are explicit. Public generated types/schema/manifests remain untouched for root's authentic replay reconciliation; exact local RPC name/argument/result type boundaries are temporary, narrow and server-only.

## Added native matrix (not executed locally)

- Full actual processor with real DB matching/parser/persistence, deliberate interruption immediately after persisted success, then actual runtime QTY/timezone/resolution-format mutation. Natural dedup and stale read-to-persist attempts must both fail; ACK/completion/outbound/sinks remain absent. Identical retry retains 500 kWh and original UTC/month and reaches ACK/completion. Only external final effects/diagnostic writes are observed in these cases; persistence and canonical reads are real.
- Direct RPC order/scope/membership and malformed/null/wrong-type probes, byte-different equivalent resolution, source field mutation guards and concurrent identical retry.
- Real `normalizeAndStoreMeteringValue` and `ingestBillingUnderlay` positive/idempotent writes, plus five real ownership-drift cases after successful persistence. Actual accepted E30 hourly/30-minute/calendar controls each write two distinct adjacent rows and sum 507 kWh.
- Controlled concurrent point update held in an open PostgreSQL transaction while each bound sink RPC runs. The test observes its real lock wait, commits the changed ownership, then requires the writer to reject with zero rows. This is added proof awaiting execution, not a claimed concurrency pass.
- Both atomic writers reject a mutated expected returned contract, and anon/authenticated EXECUTE remains denied. Existing reservation, held/release, historical unbound, cross-source/environment, noncurrent/correction, corrupt authority/hash, whole-batch rollback and service ACL assertions remain.

## Local verification

Node prefix throughout: `/tmp/e035-node22/node_modules/node/bin/node`.

| Exact command after prefix | Result |
| --- | --- |
| `node_modules/vitest/vitest.mjs run __tests__/ediel-utilts-bound-ownership.test.ts __tests__/ediel-utilts-consumption-contract.test.ts __tests__/ediel-utilts-persistence-processor.test.ts __tests__/ediel-utilts-persistence-sideeffects.test.ts __tests__/ediel-utilts-source-collision.test.ts --reporter=dot` | Latest 52 PASS / 5 files, including final expected-contract RPC link |
| `node_modules/typescript/bin/tsc --noEmit -p tsconfig.app.json --incremental false` | PASS |
| same TypeScript command with `tsconfig.tests.json` and `tsconfig.scripts.json` | Both PASS |
| `node_modules/vitest/vitest.mjs run --coverage --reporter=dot --maxWorkers=3` | Final-code rerun 5939 PASS / 364 files, exit0; statements44.68%, branches38.48%, functions51.77%, lines44.85% |
| targeted ESLint on changed production/unit/native files | 0 errors; only pre-existing matchedOutboundId unused warning |
| `scripts/check-migration-versions.cjs` | PASS: 603 files / 507 version groups |
| `scripts/gridex-aud-003-migration-provenance-regression.cjs` | STATIC_PROVENANCE_PASS, 510 timestamped files |
| `scripts/check-service-role-tenant-ratchet.cjs` | PASS: 2402 / 453, unchanged |
| `git diff --check` | PASS |

SQL self-review checked actual schema columns/types, private privileges, preserved validator argument name/OID, null comparisons, CASE grouping, distinct PL/pgSQL variable names, complete outcome membership, lock strength/order and downstream derivation. No local PostgreSQL exists; static review is not compilation or native acceptance. No skipped or deleted old assertions, no manually fabricated public artifacts.

## Next gate

Root publishes the frozen candidate and runs authentic native replay plus independent SPEC/QUALITY re-review. Fix actual findings with new forward migrations after publication. Root reconciles generated artifacts and reruns final same-head ordinary/native gates. Until then the atomic SQL, expanded native suite, full task and E035 remain unqualified. This is fix round 1/5, not a completion claim.
