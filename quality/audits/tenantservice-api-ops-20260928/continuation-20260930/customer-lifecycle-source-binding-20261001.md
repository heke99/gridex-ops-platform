# Current lifecycle decision schema and case-source repair

Status: frozen bounded source and local business proof, 2026-10-01T04:43Z. Actual Supabase/PostgREST native: **NOT_EXECUTED (three prepared cases)**. Existing legacy withdrawal native acceptance remains pending; its required decision count stays **one**.

## Actual cause and existing owner

The actual generated575 artifact11139382345 and the currently adopted schema have the same ten-column `public.customer_lifecycle_decisions` CREATE TABLE: receipt/source columns are absent and the CHECK accepts only `withdrawal`/`rejected`. Its exact CREATE TABLE SHA-256 is `102772e89618336f9a706923bdaa80cf76777a56150e8d3768b0b8f082027ee8`. The PostgreSQL-core fixture pins that exact old DDL, byte-compared with the artifact, so later genuine generated-schema adoption cannot erase this upgrade regression. Generated files and historical SQL are unchanged here.

`createLifecycleDecisionFromCase` is the sole application INSERT producer. Its one caller is `lib/customer-cases/engine.ts` `applyCustomerCaseOperationalStops`; the genuine legacy `createCustomerCase` withdrawal writer invokes that engine after case creation. The customer-card lifecycle action in `app/admin/customers/[id]/actions.part-4.ts` maps withdrawal/cancellation/rejection into that existing writer. Existing producer fields include `source_customer_case_id`, `received_at`, `received_channel`, and `notes`, and its cancellation mappings already require `cancelled`. Historical optional-column DDL exists in20260522/20260710190000 files, but is absent from the current canonical generated table; those files are not edited or replayed as a repair.

Initial local actual exported-producer + PostgreSQL reproduction: required decision was `null`, actual error `42703`. The old fallback hides this source gap; the existing explicit withdrawal fixture correctly requires the durable sourced decision. Twelve initial business cases gave11RED/1 old ordinary-support/missing-schema control PASS, primarily sharing that missing-column cause. A separate actual old-CHECK INSERT independently gave `23514` for `cancelled`.

## Bounded change

CLI2.101.0 `migration new customer_lifecycle_case_source_binding` created `20261001042748_customer_lifecycle_case_source_binding.sql` locally. It adds four nullable fields, checks compatible existing types/nullability, extends the CHECK to the already implemented cancellation type, and adds a partial unique `(source_customer_case_id, decision_type)` index. Incompatible pre-existing types or sourced duplicates abort; no historical backfill, deduplication, or row rewrite is performed.

A private **SECURITY INVOKER** trigger, with `pg_catalog` search path and explicit public relation names, locks the current case and referenced customer/site/metering-point/contract rows for the decision INSERT/UPDATE transaction. It checks the existing ten-case mapping, exact company/customer, canonical scope precedence, scope identity and referenced-resource ownership/relationships. Sourced decisions remain billing-blocked; a sourced decision cannot change/unlink its source/entity/type/scope binding. NULL-source historical/manual rows retain the existing semantics. No FK cascade is added that would rewrite or destroy old decision evidence when cases are removed.

The producer attempts INSERT first, including on retries. Therefore a replay reaches the current case/resource trigger before unique conflict. Only actual SQLSTATE23505 permits a reread, filtered by source-case/company/customer/type/scope and exact scope ID or NULL; title/reason is never identity. An unrelated primary-key conflict or absent exact binding preserves the original error. Non-unique and reread errors propagate. Ordinary nonblocking support still writes nothing; a genuinely missing old schema retains its explicit fallback. That fallback is compatibility, not acceptance of a missing current forward.

Existing table RLS/grants and caller gates are unchanged. The trigger does not mint authority, add a RPC, promote a role, or qualify the caller's economic mandate. No grants/Auth/session probes were exercised by this package. Existing explicit withdrawal stop/status/job/event/audit assertions, including `decisions = 1`, remain byte-unchanged in `scripts/helpers/ediel-support-boundary-native-20261001.ts` and its caller. Generic support still confers no implicit financial/lifecycle stop authority.

## Executed local proof and limits

- **15/15 PostgreSQL business cases PASS**, Node22/PGlite0.3.14 (PostgreSQL17.5): real exported TypeScript producer, exact pinned current575 decision DDL, actual current case DDL/selected existing FKs, real forward and compiled trigger. Withdrawal receipt/source; both cancellation case types; old cancelled CHECK; title-stable replay; genuine unique conflict from simultaneous producer calls; four scope variants; incorrect caller entity/scope/current resource rejection; immutable binding; nullable original historical-column byte preservation; late actual AFTER INSERT fault rollback; ordinary-support/no-schema compatibility; unrelated real primary-key conflict; stale current case denial; incompatible-type transaction rollback.
- **19/19 new exported-function adapter units PASS**, plus unchanged switch-readiness21/21 =40/40 in the bounded combined run. Units control only the outer Supabase adapter and qualify branch/error/DTO behavior, not real DB/Auth acceptance.
- Narrow four-entry actual import-closure TypeScript check PASS, scoped ESLint PASS including explicit standalone CommonJS files, `git diff --check` PASS. CommonJS require-rule exception is limited to the two standalone Node test harnesses, matching existing test entrypoint conventions.

The first schema-fix run was11PASS/1 Date-object reference-equality harness failure; deep equality corrected that test representation. No business assertion or source rule was relaxed. Final current-source core rerun was15/15, and final unique-unit rerun19/19. The simultaneous core calls share one real PGlite connection; they prove genuine SQL unique conflict handling, **not** physical two-session lock-wait behavior. Case/decision DDL and selected FKs are real; parent resource tables are narrow ID/company/customer/reference row scaffolding, not the full production schema, triggers or policy stack. Late failure proves rollback of the decision INSERT statement, not earlier stop writes.

Three prepared native cases use the existing private isolated CI status/psql helper and actual exported producer through the real service PostgREST client: durable withdrawal/title-edit replay, real concurrent cancellation calls, and owned late statement failure. They seed no Auth users/sessions/roles/grants, use no Auth API, and invoke no provider/worker. Exact PostgreSQL-side whole-finance hashes are taken before JSON parsing, and a nonempty quiet company/customer/contract graph must remain unchanged. Original rows are compared; owned rows/fault objects are cleaned. The existing explicit withdrawal native fixture remains the separate full legacy stop/evidence check. These prepared cases were type/lint checked only: **zero actual local Supabase/native/HTTP/browser cases**, no Storage/provider/live request.

Whole legacy withdrawal is still several service calls/transactions: prior stop/billing/contract mutations can commit before a later decision/switch/event error. Its economic caller gate, multi-transaction recovery/atomicity, native runtime and external transport evidence remain separately **OPEN/PENDING**. No full T/P phase acceptance is claimed. Frozen agreement19 and defensive agreement4 packets were not changed. Root owns generated adoption, checksum/security registries, workflow wiring, publication and actual CI qualification.

## Exact commands

```sh
NODE_PATH=/tmp/ediel-service-check/node_modules /tmp/gridex-event-v2-node22-cache/_npx/52027bd8fc0022aa/node_modules/node/bin/node --test scripts/customer-lifecycle-source-binding-20261001.postgres.test.cjs
/tmp/gridex-event-v2-node22-cache/_npx/52027bd8fc0022aa/node_modules/node/bin/node node_modules/vitest/vitest.mjs run __tests__/customer-lifecycle-source-binding-20261001.test.ts __tests__/switch-readiness.test.ts
/tmp/gridex-event-v2-node22-cache/_npx/52027bd8fc0022aa/node_modules/node/bin/node node_modules/typescript/bin/tsc --project /tmp/gridex-lifecycle-source-scope-20261001.json --pretty false
/tmp/gridex-event-v2-node22-cache/_npx/52027bd8fc0022aa/node_modules/node/bin/node node_modules/eslint/bin/eslint.js lib/operations/switchLifecycleBlocks.ts __tests__/customer-lifecycle-source-binding-20261001.test.ts scripts/customer-lifecycle-source-binding-20261001.native.config.ts scripts/customer-lifecycle-source-binding-20261001.native.test.ts scripts/customer-lifecycle-source-binding-20261001-core.cjs scripts/customer-lifecycle-source-binding-20261001.postgres.test.cjs --no-ignore
git diff --check -- lib/operations/switchLifecycleBlocks.ts supabase/migrations/20261001042748_customer_lifecycle_case_source_binding.sql
# PREPARED ONLY; isolated private actual stack must exist:
# node node_modules/vitest/vitest.mjs run --config scripts/customer-lifecycle-source-binding-20261001.native.config.ts
```

The private narrow TypeScript config extends the actual repo config, removes broad include/exclude/plugins/incremental, lists producer/new unit/native config/native test, and uses installed Node types from the actual repo typeRoots. Broad type/unit/quality/native checks remain root-owned. Skill routing: systematic-debugging/TDD/verification, current database patterns/spec compliance/differential review and false-positive qualification apply to this concrete business-schema repair. No new UI/API contract/provider/credentials/dependency changes; those unrelated skill groups are skipped. Mandatory active memory was read; root is the sole memory writer and publisher.

## Frozen seven source/proof paths

| Path | Git blob | SHA-256 |
| --- | --- | --- |
| `lib/operations/switchLifecycleBlocks.ts` | `cef19d042a8ef30f3798a10f93ff049cb3364aae` | `26bc61df7db14badedb3e2f9866d95a6971715a7c708ee0e9540ac068dbfcd97` |
| `supabase/migrations/20261001042748_customer_lifecycle_case_source_binding.sql` | `7d9715b2e41d007518b729349379b8db0a11710b` | `2e0cfb2b4d6947dd2c884f8ea9ad8b99f2e492efb0af651a4899d9ab40f30ddb` |
| `__tests__/customer-lifecycle-source-binding-20261001.test.ts` | `3064472737ce4331d706d45d7c0a1f758e0e3819` | `08a5466220df26dcc630ccbc22750d53847df0b5abb66253c3f8d13579e4c734` |
| `scripts/customer-lifecycle-source-binding-20261001-core.cjs` | `17c30b23bd326902d486016b1e3a0d8c31b19517` | `5446eb291f9818eedabc178a6af7105999de9df97716ae39bfa5a7c2966010d9` |
| `scripts/customer-lifecycle-source-binding-20261001.postgres.test.cjs` | `34753f265a769bd8350da9f1b5dae5c8dc963c64` | `0771b712fe6b12d438dd02076f8174aa72b7a6050bccd9eb4212520439c5e14d` |
| `scripts/customer-lifecycle-source-binding-20261001.native.config.ts` | `5f3771d470e62a0d91b2c0bcd00bf40020a5f004` | `aff961937de1555aec42bd1a231a932a9de5177aeee68c0f176fcf78b0c014b8` |
| `scripts/customer-lifecycle-source-binding-20261001.native.test.ts` | `e95ea002af30a3a7cb54069a7afcb037c0c0e7e3` | `90a84ccd2dc231c634a33c0451a8aeb55635ae8a1d36c34febe0d034a969b3b4` |

Report is the eighth packet path; its hash is delivered separately to root to avoid a self-referential manifest.
