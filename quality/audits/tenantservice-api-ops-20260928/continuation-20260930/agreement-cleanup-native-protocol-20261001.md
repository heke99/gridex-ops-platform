# Agreement cleanup native: exact single-result protocol

Status: bounded local protocol correction qualified; installed agreement business/native execution remains **NOT_EXECUTED (0)** for this candidate. No original masterplan row is closed by this report.

Reviewed baseline: commit `6c5cca0edc1e58e90e979a45d3efc093ae91ca33`, tree `f8d852570b6a190132feffee631d906b46176a76`. Work was isolated in the agreement CI follow-up worktree. Root owns workflow, memory, indexes and publication. This package changes only the native fixture and adds its isolated protocol proof/report.

The authentic previous CI observation is three agreement-cleanup failures at `2026-10-01T10:31:26.8905923Z` in OPS run `36849184084`, with the closed wrapper outcome `customer_api_proof_database_failed stage=customer_sql sqlstate=UNKNOWN`. Agreement runtime and later native chains were not reached. The private underlying error is unavailable; the locally reproduced protocol defects do not establish the exclusive original CI cause, nor qualify the next candidate's full native outcome.

## Finding and bounded change

`proofSql` runs `psql -XAtq ...` and parses the complete trimmed stdout as one JSON value. The actual compiled native seed issued two bare `SELECT set_config(...)` calls, which emitted the command JSON and quiet-owner hash before the final JSON receipt. The third callback also issued a bare `SELECT` of the preparation command and emitted another JSON result. Valid SQL therefore still failed the shared strict JSON parser with `sqlstate=UNKNOWN`.

The two seed configuration calls now run inside a `DO $settings$` block using `PERFORM`. The third callback's preparation is now a `DO $prepare$`/`PERFORM` call with the exact same function and `current_setting(... )::jsonb` argument. The calls execute and retain transaction-local settings; they emit no unwanted result rows. The shared helper, complete-output parser and error projector are unchanged.

The initially proposed literal-backslash-newline defect is **FALSE_POSITIVE**. Both baseline source joins contain the TypeScript newline escape, not an escaped backslash followed by `n`. Compiling the actual baseline fixture produces real newline separators. The baseline protected INSERT and finish maps parse in PostgreSQL, and both join source lines remain byte-identical. The test's deliberate literal-separator injection is a negative mutation control only: PostgreSQL rejects that injected input with `42601`, while the actual safe child projector distinguishes the recognized SQLSTATE from client JSON-parse `UNKNOWN`. It is not an observed baseline/native parser failure.

## Executed evidence

All times below are actual UTC recorded through timezone-aware Python clocks, independent of Vitest/local timezone labels.

| Evidence | Actual result | UTC |
|---|---|---|
| Initial functioning 10-case baseline before fixture edits | 8 controls PASS, 2 genuine protocol RED, exit 1 | `10:47:58.216111Z`–`10:48:02.353034Z` |
| 14-case proof against exact original 6c fixture in private baseline tree (before variable-only lint rename) | 9 controls PASS, 5 genuine protocol RED, exit 1; TAP 3779.761827 ms | `10:55:10.831317Z`–`10:55:14.751606Z` |
| Final 14-case proof against corrected fixture after variable-only lint rename | **14/14 PASS**, exit 0; TAP 5247.343834 ms | `10:59:25.973350Z`–`10:59:31.358059Z` |
| Native TypeScript ESLint | exit 0, no reported warnings/errors | current candidate |
| New CJS `node --check` | exit 0 | current candidate |
| Explicit CJS ESLint (`--no-ignore`, CommonJS import rule disabled for this command only) | exit 0, no reported warnings/errors | final candidate |
| Actual native TypeScript transpile diagnostics | 0 syntax/transpile diagnostics; not a full typecheck | current candidate |
| `git diff --check` | exit 0 | current candidate |

A prior harness setup attempt read a UUID property the fixture does not export and failed before PostgreSQL proof execution. That attempt is excluded from all protocol RED counts. The corrected harness obtains the quiet-owner UUID from the actual compiled seed. The initial 10-case, subsequent 11-case and earlier 14-case runs before removal of an unnecessary separator-normalization helper are developmental receipts, not additional unique cases; the final denominator is exactly **14**.

A root forced-CJS lint pass exposed the test harness local name `module` as an `@next/next/no-assign-module-variable` error. The only following test-code change renamed that local binding to `compiledModule` while preserving the VM context property `module: compiledModule`, its exports property and returned exports. Exact full-test byte reconstruction from the prior baseline-test copy confirms those three substitutions only; all fourteen cases/oracles are unchanged. The final fresh 14/14 result above covers the renamed bytes. The earlier baseline receipt remains explicitly dated, not silently rewritten.

Final baseline log SHA256: `5a0861a981afe097186ec67178f5ce3cf0666bcb6286714d0b91f7a36fc2814a`.

Final green log SHA256: `1746f6f98500a01ecc08644a2cb9724cf5056e0c4f923a120bb056431e70ad57`.

The fourteen cases cover actual compiled callback inputs and transaction/receipt shape; real PostgreSQL parsing and exactly eight stored row fingerprints; real finish-map parsing and receipt; exact config values without stdout; third preparation argument/execution once without stdout; strict extra-JSON rejection; both old config result rows; the old third command result row; injected invalid separator; all eight changed protected numeric/bigint rows; changed quiet-owner row; and each of the three actual callbacks' distinct fixture/finish SQL projections retaining its actual tuple and single receipt.

## Real versus controlled boundary

The proof transpiles the actual checked-in native file and invokes all three real callbacks with capture-only `it`/`expect`/`proofSql` adapters. That capture adapter returns a declared `{passed:true}` solely to collect each callback's complete generated input; it contributes no native business PASS. Tests independently execute the exact generated fingerprint/configuration/finish bytes against typed PostgreSQL canaries, without separator normalization or repair and feed their complete result-row stdout to the actual extracted `proofSql` function.

The actual helper's API/DB constants, `quote`, `proofSql`, error projector and technical classifier execute. Only `execFileSync` is controlled; it checks the actual psql arguments/options, supplies all PostgreSQL result rows, and preserves every extra stdout row rather than choosing a convenient terminal line. JSON/text output serialization models the relevant `psql -Atq` row protocol; no actual psql/server/Auth call occurs here.

The preparation function installed in PGlite is explicitly a **protocol stub**, returning a fixed JSON object and recording the exact input once. It proves call/output/argument behavior only. It is not the real agreement writer, canonical authority helper, cleanup claimer or audit implementation. Each callback projection excludes its business/authority body. No Auth schema or role/grant objects are created, exercised or changed. No Storage, HTTP, provider, production or hosted writes occur.

The eight fingerprint canary tables have numeric/bigint values beyond JavaScript integer precision. Hashes are produced by the actual PostgreSQL row/text expressions before JavaScript sees them. Independently changing each table causes the unchanged protected guard to raise `cleanup_native_protected_graph_changed`; changing the actual quiet row causes `cleanup_native_foreign_changed`. These controls qualify the preserved fixture's fingerprint expressions, not its full-history original financial corpus.

## Byte preservation

Whole native-source byte reconstruction succeeds by replacing only the two configuration SELECT lines with their DO/PERFORM wrapper and the third preparation SELECT with its DO/PERFORM wrapper. Both join source lines, roles, transactions, command payload/args, all eight protected-table expressions, quiet fingerprint, fault and business assertions remain intact. The first two complete `it(...)` statements are byte-identical; the third is not byte-identical and differs only by the exact preparation wrapper.

| Exact statement/source | Baseline SHA256 | Candidate SHA256 |
|---|---|---|
| Native fixture file | `e978c7bf8c2b71b41fa6b346a8406ed9e68ae741ef27731e717cda91e56ab98e` | `9108915142641cc3d25fca05b022c457dbec413d7ceb4a457faae4bbd34cbbc6` |
| First complete native `it` | `726dacb14136bd7237d5f5541adb1aa34fa05bb0232865087b8ea29eab18c033` | same |
| Second complete native `it` | `de93d7ec2adf2a83df0def0e70eafe66c24e7ee532985eb030b48e5873da1074` | same |
| Third complete native `it` | `4d952b165feb583852b1a0c837cba6a9269bfee4367603ce5c78a61333993e69` | `fd433f43048232c5c0ef00b5bc9814b9fbeb40c98038eefe4cb6070e202831a6` |

Unchanged shared helper SHA256: `e0cf59ffeafd5aa4a6a591aadda6e4507ca7594700e9ca343f6cd649b5100c4f`.

## Owned packet and reproduction

| Owned path | SHA256 |
|---|---|
| `scripts/grid-owner-agreement-cleanup-20261001.native.test.ts` | `9108915142641cc3d25fca05b022c457dbec413d7ceb4a457faae4bbd34cbbc6` |
| `scripts/agreement-cleanup-native-protocol-20261001.test.cjs` | `b25f7c0194ec516bcdba9f641902b2529c3683a00aafe782358e1bcdcba7892e` |
| This report | final hash in the external review-ready manifest |

Run from the exact candidate worktree using the existing local PGlite dependency and Node22:

```sh
NODE_PATH=/tmp/ediel-service-check/node_modules NODE_OPTIONS=--max-old-space-size=1536 \
  /tmp/ediel-toolchain/node_modules/node/bin/node --test scripts/agreement-cleanup-native-protocol-20261001.test.cjs
/tmp/ediel-toolchain/node_modules/node/bin/node --check scripts/agreement-cleanup-native-protocol-20261001.test.cjs
NODE_OPTIONS=--max-old-space-size=1536 /tmp/ediel-toolchain/node_modules/node/bin/node \
  node_modules/eslint/bin/eslint.js scripts/grid-owner-agreement-cleanup-20261001.native.test.ts
NODE_OPTIONS=--max-old-space-size=1536 /tmp/ediel-toolchain/node_modules/node/bin/node \
  node_modules/eslint/bin/eslint.js --no-ignore --rule '@typescript-eslint/no-require-imports:off' \
  scripts/agreement-cleanup-native-protocol-20261001.test.cjs
git diff --check
```

CJS syntax is covered by Node. Default repository ESLint does not cover this CJS proof; the explicit forced lint command above covers it with only the CommonJS import syntax rule excluded for that invocation. The Next module-variable rule remains enabled and passes. No new package dependency was added. Skills applied: systematic-debugging for compiled SQL/parser boundaries, test-driven development for the observed baseline RED before fixture edits, differential review for the exact two-region correction, and verification-before-completion for fresh gates. Full app/script typechecks, actual psql/native agreement business outcomes, Auth/Storage/current session and subsequent HTTP/browser chains remain separate pending qualifications. No commit, freeze, publication or shared memory update was performed by this owner.
