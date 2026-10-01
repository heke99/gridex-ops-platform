# Agreement durable crash-orphan cleanup, 2026-10-01

## Outcome and separation

A new internal consumer now processes one explicitly selected company (UUID, or NULL for genuine global-platform rows), at most ten private agreement upload intents per call. It seals never-attached object identities, checks current registered/committed references and exact private bucket, requires a current lease immediately before the Storage operation, and records completion/retry under CAS with immutable attempt facts. Attached or referenced document objects are never exposed for removal. An old upload may complete after a removal acknowledgement, so sealed cleaned objects remain eligible for periodic settlement; permanent physical absence is not asserted.

This nine-file packet depends on `grid-owner-agreement-atomic-20261001.md` and the independently frozen defensive document/key packet. Their source/proof/report bytes remain unchanged. This stage adds a forward and unique files only. Root owns workflow, generated schema/types, migration history/checksums, service-client registry, memory and publication; none were edited here. There were no live network requests, hosted Auth/database probes, real Storage deletes, external sends, production activation flags or commits.

Actual cached Supabase `migration new --help` was read, then local `migration new grid_owner_agreement_durable_cleanup` generated exactly `20261001030647_grid_owner_agreement_durable_cleanup.sql`. No linked project or database command was run by the CLI.

## Actual RED and implemented protocol

Before the new forward, an actual prepared private upload key could be saved as another agreement's manual document path through the existing atomic SQL writer. The exact real core test requiring rejection failed with Missing expected rejection, and the absent cleanup RPC failed with 42883. These are two genuine executed REDs on the prior SQL; no successful database response was stubbed. After the new forward both tests pass.

The new forward renames the old private implementation, revokes its EXECUTE from service/public/anon/authenticated, adds a fenced private wrapper with the original owner and pg_catalog search path, and refreshes the public service-only SECURITY INVOKER caller. The old unchecked implementation is not a new unfenced callable. Existing actual current-session/platform authority, company/owner/route, revision/idempotency and late rollback stay in the old bounded implementation; the wrapper adds only exact object serialization and reservation checks.

Every save that would attach an upload or publish a manual document identity takes the exact object lock before the existing actor/key lock. Manual publication/reuse of a private prepared/cleanup_required/cleaned key conflicts; existing attached identities remain protected and may retain legitimate document reference semantics. The cleanup protocol uses this same object-before-actor order and try-locks candidates before locking their exact upload row. It then rechecks never-attached state, no result attachment, private current bucket, actual agreement references across all companies/global rows and historical committed document-path receipts. A historical manual reference created by the actual prior writer is retained and excluded by cleanup. Concurrent new publication cannot race past the sealed reservation barrier.

The first claim seals the intent as cleanup_required and creates a private two-minute lease with a server-derived UUID token, attempt number and exact upload/company/original actor/bucket/path/file-hash/deadline receipt. Fresh prepared intents have a fifteen-minute grace period; prepared/cleanup_required/cleaned candidate scans are bounded to 100 within the single explicit company and return at most ten. There is no all-tenant global sweep or cross-tenant fairness claim. NULL is a real global-row scope, not a fabricated company. Cleanup is permitted for inactive/revoked original staff because this internal system capability only removes the issued sealed orphan; it cannot mutate agreement/customer/billing authority or grant a new staff write.

Current validation locks/rechecks exact receipt, live lease/token/attempt, sealed never-attached row, bucket privacy and current/historical document references just before Storage. Service has no private table SELECT/DML or old unchecked EXECUTE; only narrow public/private function EXECUTE. Anon/authenticated have none. The old private writer owner is copied to the new private functions/ledgers, with incompatible caller-role owners rejected; no role promotion or broad grant occurs. Private attempt events reject UPDATE/DELETE even by their owner.

The consumer sends only the verified exact bucket/key to Storage.remove. An unavailable/uncertain claim or current validation cannot trigger a removal. Storage failure or thrown/uncertain outcome is recorded as retry, never confirmed success. Finish rechecks exact current lease/reference state and CAS; identical completed finish replays without new facts, a stale or changed completion conflicts. A concurrent identical finish is re-read after validation waits before classifying stale. A late final clock/audit failure rolls back completion, seal/claim changes and attempt facts as applicable.

A removed result becomes cleaned with a next settlement due one hour later; retry waits one minute. A later attempt reuses exactly the same sealed key with a new token/incremented attempt. This is deliberate durable repeat settlement because an original in-flight upload may finish after an earlier delete. The remaining lease expires after a worker crash or uncertain finish; the next bounded current claim safely resumes. An HTTP summary contains counts only and does not expose document keys, file values, original actor, claim capabilities, role/SQL/provider errors or secrets.

## Actual caller and default denial

`POST /api/internal/grid-owner-agreements/cleanup` is the new actual server caller. It accepts only strict bounded JSON `{companyId: UUID|null, limit?:1..10}`. It requires its own exact configured `GRIDEX_AGREEMENT_CLEANUP_SECRET` (32..256 UTF-8 bytes), timing-safe bearer comparison, no query parameters and a 512-byte/five-second body bound. Default missing/short configuration denies 503; anonymous/foreign credentials deny 401 before DB. Caller-supplied actor/object/token fields, implicit company scope and excessive limit deny 422. The consumer derives the claim token and verifies company/deadline/unique exact identity before any physical call. Responses are no-store/nosniff and use constant private error codes.

The private receipt protocol is the authority for this narrow cleanup, not a new email/phone/billing/scanner trust root. The Action/ordinary public API assertion remains unchanged. The production server-only barriers stay; controlled Node unit context reuses the prior unique real installed Next empty.js alias, with no fake marker module in these tests.

A scheduled deployment invocation and dedicated deployment secret are not configured by this packet. The consumer has an actual authenticated internal route; root must wire its disposable runtime proof and decide operational scheduling. This is an explicit deployment/integration OPEN outcome, not evidence that cleanup ran or a terminal external/provider blocker. Route default denial is implemented and locally executed with controlled boundaries.

Custom agreement buckets remain a separate precise configuration/ACL dependency. The atomic stage's restrictive policies protect default grid-owner-agreements only. The new consumer checks exact recorded bucket privacy and rejects reserved customer-support-quarantine but does not broaden or certify a custom bucket's existing Storage policies. A nondefault deployment must provision its private bucket and close anonymous/authenticated Storage access independently; neither whole support nor this local cleanup protocol is declared externally blocked by that optional configuration.

## Executed verification and prepared native scope

| Proof | Result | Qualification |
| --- | --- | --- |
| Actual prior pending-key manual publication + missing cleanup RPC | 2 RED then 2 GREEN | Real entire SQL, no mocked DB success |
| New cleanup SQL/core including native constructions | 14/14 PASS | Eleven new protocol/ACL/rollback cases plus three authored native SQL constructions on PGlite/PostgreSQL 17.5 |
| Unchanged atomic proof callbacks with both actual forwards | 22/22 PASS | Every original assertion is retained; only fixture acquisition/test label adapted |
| Combined final actual SQL core | **36/36 PASS** | 14 new +22 retained; not 36 native cases |
| New actual internal route/consumer | **22/22 PASS** | Outer service RPC/Storage controlled; real route, validator, adapter and installed marker context |
| Combined new cleanup + retained actual Action units | **44/44 PASS, 2 files** | 22+22; no broader integrated candidate acceptance |
| Scoped TypeScript import closure/ESLint | PASS | Actual installed Node types; no stub dependency or whole-app concurrent tsc |
| Real Supabase/physical Storage/GoTrue/Next HTTP/browser | **0 executed** | Three native SQL cases prepared; actual isolated CI required |

Protocol cases include real prior-writer legacy manual reference, attached exclusion, explicit global/foreign scope, fresh/leased/max bounds, changed exact receipt/current reference denial, repeat settlement/idempotent finish, stale takeover, late claim-audit rollback, actual elapsed final lease-clock rollback and owner/ACL immutability. Standard financial/billing or Auth writes are not introduced. The late finish case uses a controlled two-second lease and actual 2.1-second SQL fault-trigger wait; it is an observed DB clock expiry during the command, not a two-connection lock-contention proof.

The core executes both entire current forwards and the actual extracted canonical global/current-session functions with real current grid-owner/audit table definitions. Other table scaffolding remains minimal as documented in the atomic-stage report. The authored native core capture has minimal ID/company scaffolding for eight protected graph tables; it executes exact constructed statements without canned success and checks the real JSON proof_receipt. That does not prove full reconstructed schema FK/trigger/RLS/runtime behavior or nonempty original finance. The full native code fingerprints actual entire PostgreSQL JSONB rows before JS parsing for customers, contracts, underlays, invoices, export items, Ediel messages, outbound requests and tenant email, plus a nonempty quiet owner. Missing actual required relations fail; empty tables remain explicitly possible and cannot certify a whole financial graph requirement.

The three prepared native cases use actual installed function/ACL semantics and actual synthetic Auth/session/profile/global-role rows, all inside ROLLBACK transactions: explicit orphan/periodic same-key settlement including revoked staff; attached protection/manual reservation denial; owned late claim audit rollback and denied old unchecked/public invocation. They do not claim GoTrue-issued sessions, HTTP/secret boundary runtime or any Storage erasure. Those require the genuine isolated runtime.

During native construction the first three cases were 2 PASS/1 genuine 42725 from a newly authored JSONB subtraction/concatenation SQL precedence error; parenthesized operands fixed it, then 3/3 passed. During retained-callback harness creation, a VM-realm array-prototype mismatch yielded 35/36 with identical row structures; switching the trusted unchanged source callbacks into the current Node realm fixed the harness without normalizing/mocking assertions or altering SQL, then all36 passed. Initial scoped tsc lacked /tmp-relative Node type discovery; adding actual repository node_modules/@types with installed node types to the temporary config fixed environment resolution; source was not weakened.

## Commands and integration prerequisites

```sh
NODE_PATH=/tmp/ediel-service-check/node_modules /tmp/gridex-event-v2-node22-cache/_npx/52027bd8fc0022aa/node_modules/node/bin/node --test scripts/grid-owner-agreement-cleanup-20261001.postgres.test.cjs
/tmp/gridex-event-v2-node22-cache/_npx/52027bd8fc0022aa/node_modules/node/bin/node node_modules/vitest/vitest.mjs run --config scripts/grid-owner-agreement-atomic-20261001.config.ts __tests__/grid-owner-agreement-cleanup-20261001.test.ts __tests__/grid-owner-agreement-atomic-caller-20261001.test.ts
/tmp/gridex-event-v2-node22-cache/_npx/52027bd8fc0022aa/node_modules/node/bin/node node_modules/eslint/bin/eslint.js lib/routes/gridOwnerAgreementCleanup.ts app/api/internal/grid-owner-agreements/cleanup/route.ts __tests__/grid-owner-agreement-cleanup-20261001.test.ts scripts/grid-owner-agreement-cleanup-20261001.native.config.ts scripts/grid-owner-agreement-cleanup-20261001.native.test.ts
/tmp/gridex-event-v2-node22-cache/_npx/52027bd8fc0022aa/node_modules/node/bin/node node_modules/typescript/bin/tsc --project /tmp/grid-agreement-cleanup-scope-20261001.json
```

Temporary type project extends actual tsconfig and contains only this route/model/unit/native config/test import closure with no emit/incremental/Next plugin and actual installed Node type roots. Core source extraction requires migrations present and should run before HOLD; native code reads no migration file. Native config requires CI=true, private GRIDEX_NATIVE_STATUS beneath RUNNER_TEMP with exact local 127.0.0.1:54321 status and local keys, and forbids the named send-provider credentials. SQL helper is fixed to local proof database; no new proof workflow/ref.

Root must independently review/register service caller qualifiers: dedicated-secret default denial before any DB, strict explicit company and limit, server-generated token, exact company/token/bucket/path/hash/deadline/unique claim receipt, current validate RPC immediately before remove, exact path remove, guarded finish CAS/constant counts/errors. SQL needs dependency order after 20261001020409, checksum/order and real generated/ACL adoption. Actual full-schema/native/upgrade-restore and local Next+Storage runtime proofs remain OPEN; they cannot be inferred from source documentation/unit counts. Existing frozen packets and remote refs were preserved.

## Frozen manifest

Eight source/proof paths below are frozen; this report is the ninth packet file and its hash is supplied separately to root.

| Path | Git blob | SHA-256 |
| --- | --- | --- |
| `supabase/migrations/20261001030647_grid_owner_agreement_durable_cleanup.sql` | `576499088e5c0ae58adc5e50f19ff18719536d6c` | `b81cbf28b53200d32dacb2d1caf2df50cb8060f9982b0fe0b659051da7ea0ca2` |
| `lib/routes/gridOwnerAgreementCleanup.ts` | `569f2d101eb1c271baeb75a56378e29eb5209402` | `f4ab78d2a6d5a67be4482438216e5857e6473a6a685c1da74692235050c14c55` |
| `app/api/internal/grid-owner-agreements/cleanup/route.ts` | `d4819fbeef3d700df82f4a12b4860ede7c8af480` | `5acaa208f03871bba392981c2468f725f3b28bfee4744c668115207da78b9ac2` |
| `__tests__/grid-owner-agreement-cleanup-20261001.test.ts` | `e0daff85314cf56881cf84e8a9a47830ad7a9765` | `9b519aa9dc290bed2af7701d18b7fdb8bb9ec7e41409e0a8e34b7b328343df46` |
| `scripts/grid-owner-agreement-cleanup-20261001-core.cjs` | `bf61cad8816de3bd58bba5fd6e0f25cc1b0e8510` | `c720b22a391fc208fea1d6646c3f23f646d713bff8f35eadd99cbad2dcfd624a` |
| `scripts/grid-owner-agreement-cleanup-20261001.postgres.test.cjs` | `1800ad0fae417353ce1ad749b6309444d082dd03` | `7b469f3d984491239063f07be3cef5826f4fd4af7a5f11ba84204a2263a94084` |
| `scripts/grid-owner-agreement-cleanup-20261001.native.config.ts` | `532a8c2cf8e2791dd624a2355b780fa9976da998` | `6b814c815f09daf7d271ac168e0ab57e0d9b612e42e44f74210f0bad10245f5e` |
| `scripts/grid-owner-agreement-cleanup-20261001.native.test.ts` | `c4ef9818f8bac107c7a9968557668729296f841e` | `e978c7bf8c2b71b41fa6b346a8406ed9e68ae741ef27731e717cda91e56ab98e` |
