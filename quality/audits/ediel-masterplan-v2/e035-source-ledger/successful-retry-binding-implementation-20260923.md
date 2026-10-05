# Successful retry binding — first integrated native checkpoint

2026-09-23. Owner `/root/retry_binding`. **INCOMPLETE / NOT ACCEPTED / NOT MERGE-READY.**

Implementation base: `33fc777076a123b2e6c47b2d3f4ef939833883f4`. Parent documentation-only commits through `e492a90f633633ca8b4e3892623b1bf8098a701c` are preserved. Qualified case checkpoint `cb5e5f75` and closure `805f5fbb` are unchanged in scope. This checkpoint is intentionally frozen for the first real native SQL feedback; it does not claim completed approved-design verification.

## Integrated behavior

- The actual E30/E66 producer prepares a strict versioned consumption contract before persistence; the nonbilling producer prepares explicit no-consumption contracts. Preparation freezes exact eligible observation order/quantity, original time/resolution inputs, actual absolute UTC intervals, resolution, profile/guide versions, current attribution version, tenant/environment, explicit write/skip and source-wide billing context/contributions. Local interval arithmetic is resolved before the pure extractor to avoid host timezone dependence. Pure inspection extraction remains unchanged.
- The service-only V1 RPC locks the actual source, hashes its stored UTF-8 bytes, parses physical ordered unique transaction membership, seals source context/time, rejects historical unbound evidence, then preserves the old insertion/ACK reservation semantics. Accepted immutable contracts are stored privately by exact series ID. Existing/noncurrent/cross-source series require matching immutable raw/hash and original sealed environment/scope. Environment is now included in logical reuse/predecessor grouping; changing binding revisions do not enter logical identity.
- Any immutable/raw/source/contract conflict occurs outside the existing catch-to-ERR insertion block, rolling back the entire batch. True insertion failure continues to return failed/ERR. New bound holds permit identical-byte release; historical held evidence cannot be opportunistically sealed.
- Returned results must contain the complete unique physical outcome set and the stored V1. The adapter verifies scope/raw binding, complete shape and equality against preparation, and privately retains a cloned authority record. Both actual sinks consume only those returned stored records; mutation of normalized diagnostics or the public result object cannot change sink values. Current actor/source lineage stays outside reusable content.
- Natural inbound duplicate handling compares bytes and scope before ordinary overwrite and unique-conflict reuse. A database trigger protects sealed raw/source context against direct/racing writers. Diagnostic/status updates remain permitted.
- Bound metering/billing calls retain downstream tenant/ownership checks, disallow silent late attribution, and use explicit frozen nulls and write/skip. The old unbound public RPC is revoked and fails rather than remaining a successful bypass.

## Migration provenance and generated artifacts

Actual pinned CLI `/workspace/scratch/db7cad0629c3/tools/supabase` version `2.101.0` created `supabase/migrations/20260923135706_ediel_utilts_consumption_binding_v1.sql` with `migration new ediel_utilts_consumption_binding_v1`. The observed system clock was already later than prior maximum `20260923124645`; no timestamp invention, rename, clock spoof, or applied migration edit occurred. The SQL file was initially empty CLI output, then implemented via patches.

SHA256 `2e961d22370ead922ee02252a4fa95b77ecd33880f37b9d59fbd8e1a2966ca28`, registered using the repository checksum command. Published migration must remain immutable; native-discovered fixes require an authentic forward migration if publication has occurred.

`supabase/schema.sql`, generated public types and generated-contract manifests are deliberately untouched. Root owns authentic replay artifacts and any staged types-before-schema reconciliation. The sole new RPC adapter uses a narrow server-only exact name/argument/result type boundary, not blanket type weakening. Native replay is not available locally (no Docker/PostgreSQL); there were no hosted DB writes.

## Tests and intentional interface fixture changes

Observed meaningful RED before implementation: the new existing-sink regression showed a persisted-status-only path writing changed quantity `999`; three of four new natural-source collision tests failed because old duplicate paths reused/overwrote changed bytes. After integration those assertions pass. Existing failed-persistence, mixed-held, ACK reservation and pure-extraction assertions remain.

External persistence mocks now return the required V1/source binding shape and use the actual result validator. Eight diagnostic/handoff suites previously replacing all of part-1 now use partial mocks so actual preparation can retain its pure extraction helpers; matching IO is explicitly stubbed. These are real interface changes, not deletion of prior assertions or bypass of canonical/tenant gates.

The eight old native ACK/reservation assertions are preserved. Their fixture now submits both physical siblings on every attempt and explicit no-consumption contracts through V1; old unbound subset calls are intentionally no longer valid. Historical unbound accepted/reserved/held rows intentionally fail internally, without fabricated timestamp/timezone or national ERR.

Actual runtime timezone mutation `+0200` to `+0100` changes UTC while the legacy transaction payload stays equal. This is mutation characterization, not Swedish positive certification. Positive controls use `+0100`. The real runtime accepts `15:805` and normalizes it to `PT15H`; an initially assumed rejection was corrected honestly. Separately valid `1:805` and `60:806` controls produce equal interval endpoints while retaining distinct raw interpretation fields. E30 local-time and S07 explicit-no-consumption unit controls pass after correcting their actual allowed application references.

## Executed local checks

All Node commands use `/tmp/e035-node22/node_modules/node/bin/node` (Node22).

| Command (after Node prefix) | Observed result |
| --- | --- |
| `node_modules/vitest/vitest.mjs run __tests__/ediel-utilts-consumption-contract.test.ts __tests__/ediel-utilts-persistence-processor.test.ts __tests__/ediel-utilts-persistence-sideeffects.test.ts --reporter=dot` | 39 PASS / 3 files before added E30/S07 control |
| `node_modules/vitest/vitest.mjs run __tests__/ediel-utilts-consumption-projection.test.ts --reporter=dot` | 3 PASS including equivalent formats |
| `node_modules/vitest/vitest.mjs run __tests__/ediel-utilts-consumption-contract.test.ts --reporter=dot` | 9 PASS including E30/S07 |
| `node_modules/vitest/vitest.mjs run --reporter=dot --maxWorkers=3` | Earlier integrated run 5929 PASS / 363 files. Later concurrent run saw the newly added E30 fixture before application-reference correction: 5930 PASS / 1 FAIL. A clean final rerun is recorded below; do not treat the intermediate failure as a product regression or hide it. |
| `node_modules/typescript/bin/tsc --noEmit -p tsconfig.tests.json --incremental false` | PASS; helper initially needed complete typed transaction defaults, fixed without loosening types |
| `node_modules/typescript/bin/tsc --noEmit -p tsconfig.scripts.json --incremental false` | PASS before final two native controls; final rerun recorded below |
| `node_modules/typescript/bin/tsc --noEmit -p tsconfig.app.json --incremental false` | Earlier PASS; final rerun recorded below |
| `node_modules/eslint/bin/eslint.js` on 10 changed production modules, 4 new unit/helper files and native suite | 0 errors; 1 pre-existing `matchedOutboundId` unused warning in inboundStatusUpdater |
| `scripts/register-migration-checksum.cjs 20260923135706_ediel_utilts_consumption_binding_v1.sql` | Registered exact SHA above |
| `scripts/check-migration-versions.cjs` | PASS: 602 files / 506 version groups |
| `scripts/gridex-aud-003-migration-provenance-regression.cjs` | STATIC_PROVENANCE_PASS; 509 timestamped files |
| `git diff --check` | PASS |

One mistaken command used nonexistent `tsconfig.test.json`; it exited TS5058 and was replaced by the actual `tsconfig.tests.json` command above. No check was skipped on that account.

## Native test matrix added, NOT EXECUTED locally

Final frozen-code local receipt: clean full Vitest rerun **5931 PASS / 363 files**, 70.62 seconds (displayed test-run start 15:30:11; timezone not independently verified); application and scripts typecheck reruns both exited 0. Final app/tests/scripts checks are green. Full coverage/build/ordinary remote workflows have not run for this candidate; native and independent review remain required.

`scripts/ediel-utilts-consumption-native.test.ts` is included in the existing ordinary native config. It uses the actual parser/canonical policy/preparation, localhost service RPC/PostgreSQL, returned stored-contract validator and both sink adapters; only final external metering/billing effects are observed.

Cases: interrupted persisted success → natural changed-byte rejection → identical stored retry; quantity/timezone/resolution-format/customer/request/point/billing-period/version mutations; sealed held repeat/release and raw mutation guard; unbound historical accepted/held; equal cross-source reuse; genuine correction and exact noncurrent replay; cross-environment isolation; E30 and S07 controls; key-order equivalence/wrong scope; later-sibling dedupe conflict rolls back earlier insertion and ACK state; private/service ACLs and retired unbound RPC; missing contract, corrupt contract hash, corrupt stored raw hash (rollback-only disposable mutation probes). The eight retained SQL reservation assertions also run through required V1.

## Explicit remaining qualification / next action

1. Root publishes this frozen coherent checkpoint, runs native replay and supplies real SQL findings plus authentic public artifacts. No edits during publication/same-tree synchronization.
2. Complete native matrix gaps after feedback: actual full `processInboundUtiltsMessage` retry with persisted DB plus observed ACK/completion boundaries (current native suite stops at actual sink adapters; unit processor coverage is separate); distinguishable observation order mutation; wrong company/direction and malformed/missing fields/membership probes; native byte-different equivalent-resolution retry; concurrency and downstream changed-ownership checks as required by the approved design. Expand actual runtime mutation assertions rather than claiming contract-only mutation covers every producer case.
3. Complete strict shape parity/self-review, coverage/full exact-head gates, generated artifact reconciliation and independent SPEC/QUALITY review. Assess missing-ID normalized expansion and explicit timestamp interpretation edge cases; fail closed is not evidence of successful coverage.
4. Preserve all baseline failed-persistence/closure/case assertions and no-consumption controls. No agency89, multi-message redesign, hosted operations, remote writes, deployment, main or PR310 change.

Review request follows the requesting-code-review skill via the parent-owned independent reviewer, not a new subagent spawned here (explicit sole-implementer/no-subagent instruction). Approved design remains authoritative and is not reopened.
