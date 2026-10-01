# Manual-mail native snapshot syntax correction — recovered continuation

Scope: five files only, prepared for the next material candidate. Root owns publication, workflow, generated artifacts, index, manifests and project memory. No native/Auth/provider execution, production change, permission change or historical migration edit was performed here.

## Actual published boundary and recovered source

The read-only PR receipt identifies `heke99/gridex-ops-platform#422` head `0cf30cce687f7dfc76094fe51201ca14ab0a117c`, tree `cdb89ea6f09b701016f5203d9d669de2b20cab4c`, parent `c4ab486a9c83d629a9dbd26f8b974f9186e860f6`, base `ae56ee0a1e0e8adbce9d5f4d92da75cdcb8010c8`, and actual CI merge `144893684d0b9497a2df020b565e49d7d1cc5abb` with the same tree. Root's genuine ninth clean-job receipt `110257511446` records all six manual-mail native cases FAILED with SQLSTATE `42601`, before subsequent fixtures. That historical native result remains FAILED; corrected native execution is zero.

Recovered native baseline was verified before editing: Git blob `41c2df3b7035fe00b34c432e1eee6e1772b9e2bd`, 16,212 bytes, SHA256 `944fcb17e2bd90630f9b8a8445d9184425231be185062780d8ee5a9ff50f8f21`. Earlier pre-offline local test receipts are historical and were not reused for these recovered bytes.

Root separately adopted genuine 31-forward schema artifact `11145833501` from run `36827867458`, clean job `110257511446`, checkout `144893684d0b9497a2df020b565e49d7d1cc5abb`/tree `cdb89ea6f09b701016f5203d9d669de2b20cab4c`. The current schema is 6,058,507 bytes, Git blob `4611d561a601ecb09849c7379604c7058275b0df`, SHA256 `ac510feadf9cd4b7cc5009e92f92b54c5ea5209732c426a83558859b8cdfd39a`. This overlay is intentional and was not edited by this packet.

The core test extracts the actual current `manual_email_outbox` CREATE TABLE clause: 2,213 bytes, SHA256 `a8a88d8bd99aed80d7fc6d91733c997b69c8a1e4aff85599b962300776cfe101`. Read-only comparison with tracked `0cf:supabase/schema.sql` (Git blob `39af4825dfbc684ed0359d362af3db899386fc69`, 6,042,365 bytes) found a 2,155-byte CREATE clause, SHA256 `9829a64a518ee7a4d3a8cbbbbc30472167fc27592ca8ebe0ef2be0c9b5b7ffde`. Their only CREATE-clause difference is the genuine generated delivery-status CHECK adding `delivery_uncertain` and `blocked_tenant_state`. The core receipt qualifies its explicitly recorded current CREATE clause, rather than claiming identical full historical schema.

## Verified defect and bounded repair

`otherRows()` previously inserted an already quoted UUID list into two PL/pgSQL string literals without quoting the complete predicate. The actual emitted query therefore terminated its literal at the first UUID. Fresh pre-edit execution of that exact extracted builder failed all six PostgreSQL-core controls with `42601`.

Only the two complete predicate literals now pass through the existing `quote()` function. The company exclusion, NULL-company inclusion, ordered row hashing and SQL identifiers are unchanged. The snapshot call gains the closed stage `other_rows_snapshot`.

The actual native SQL wrapper now projects a fixed failure message, validated SQLSTATE and closed stage. It uses the existing `technicalErrorDiagnostic` SQLSTATE namespace and rejects `KARIN`, success code `00000`, ambiguous primaries, trailing private primary text and oversized output. Raw process exceptions, private JSON parser excerpts, SQL/context, file paths and arbitrary stages do not leave the wrapper. Existing private per-command logs retain mode `0600`. `ON_ERROR_STOP=1`, `VERBOSITY=sqlstate`, timeout, buffer size, nonzero failure behavior and the asserted `private_context_P0001` substring are retained.

The complete native tail from `function fixture(` through EOF is byte-identical to the verified published baseline: 12,369 bytes, SHA256 `631a0e191440f43d5ead33dd9246e7bfa0d16e3fbd9d9ee622d96e96ca6301e6`. This preserves all six native callbacks, empty-eligible prerequisite, capability setup, immutable snapshots, business assertions, cleanup, real worker calls, exact session-blocking witness and concurrency/rollback assertions. No business claim/finish/recovery SQL or provider/recipient/policy behavior changed.

## Fresh verification on recovered bytes

Node `v22.23.3`: `/tmp/ediel-toolchain/node_modules/node/bin/node`. Local Vitest clock uses `Europe/Berlin` at UTC+02; the GREEN `11:00:21` local start is `2026-10-01T09:00:21Z`. This timezone was checked directly after the run.

| Check | Fresh RED | Fresh GREEN | Qualification |
| --- | --- | --- | --- |
| Actual extracted snapshot builder, PGlite | 0/6 PASS; all six `42601` | 6/6 PASS; 15,689.8 ms | Fresh typed public/private canaries, actual current table CREATE clause; no Auth schema, role, native stack or full trigger installation |
| Actual extracted SQL wrapper + actual diagnostic helper + existing technical classifier | 1/11 PASS, 10 FAIL | 11/11 PASS; Vitest 1.76 s | Controlled outer process/file boundaries; no psql child or live file log |
| Scoped TypeScript, 1,536 MiB heap | Initially missing five recovery imports | PASS after root materialized those exact baseline dependencies | Native/helper/unit import closure only; no full application gate claimed |
| Scoped ESLint | — | PASS, zero warnings/errors | Native/helper/unit only |
| CJS syntax and owned-file whitespace | — | PASS | Source checks only |
| Native fixture/session/callback preservation | Verified original hash | PASS, byte-identical complete tail | No native behavior executed |

The six core cases cover actual SQL parsing, expected surfaces/counts, deterministic read-only execution, owned-row exclusion with NULL-row preservation, PostgreSQL numeric precision before JavaScript, pre-existing unscoped legal-row protection with rollback, and one-company exclusion. They update only fresh controlled local canaries. They do not qualify Supabase/Auth/RLS, whole-schema triggers, lock concurrency, actual worker delivery or physical provider acceptance.

The eleven unit cases execute the actual extracted native wrapper with synthetic process/file boundaries and the actual compiled helper wired to the existing technical classifier. They retain exact successful psql arguments and private-log options, and verify fixed errors for malformed JSON/process exceptions and arbitrary stage values. Synthetic private canaries are test data, not recovered credentials.

Commands:

```sh
NODE_PATH=/tmp/ediel-service-check/node_modules /tmp/ediel-toolchain/node_modules/node/bin/node --test scripts/manual-email-fair-native-sql-20261001.postgres.test.cjs
/tmp/ediel-toolchain/node_modules/node/bin/node node_modules/vitest/vitest.mjs run __tests__/manual-email-fair-native-sql-diagnostic-20261001.test.ts
NODE_OPTIONS=--max-old-space-size=1536 /tmp/ediel-toolchain/node_modules/node/bin/node node_modules/typescript/bin/tsc -p /dev/shm/gridex-manual-sql-recovery-20261001/tsconfig.json --pretty false
/tmp/ediel-toolchain/node_modules/node/bin/node node_modules/eslint/bin/eslint.js scripts/manual-email-fair-claim-20261001-native.test.ts scripts/helpers/manual-email-native-sql-diagnostic-20261001.ts __tests__/manual-email-fair-native-sql-diagnostic-20261001.test.ts --max-warnings 0
/tmp/ediel-toolchain/node_modules/node/bin/node --check scripts/manual-email-fair-native-sql-20261001.postgres.test.cjs
```

## Source freeze

| Source/test path | Bytes | Git blob | SHA256 |
| --- | ---: | --- | --- |
| `scripts/manual-email-fair-claim-20261001-native.test.ts` | 16531 | `14306cbf10005ba1f626acb6bebc14453c68e186` | `9bc730180e938124b30e73ed227b06c55d5b37eb98bf870fce8019c84815cca6` |
| `scripts/helpers/manual-email-native-sql-diagnostic-20261001.ts` | 1271 | `ee3eaf69d6efb4971076e6ff5016bc1f5fb3c83e` | `6edad31b7aba71159289b5214c78c9dc9a684092489ebf0d27b3df56ced6ac7c` |
| `scripts/manual-email-fair-native-sql-20261001.postgres.test.cjs` | 7142 | `1a5774bf8c32f93ff1fdd2ec89c8e80bf79fae0b` | `2724e6bfcc77231196f25a6dd4c72f4f86f984851bf1d1d5a43e37a2c301bdcc` |
| `__tests__/manual-email-fair-native-sql-diagnostic-20261001.test.ts` | 5199 | `49dbd6741ddb38239b7c7c919e029383344fe01b` | `25cd259610309bcd3ca9847b5ad97b612987b5dd9ef2a433e462f00ddb392707` |

The fifth owned path is this report. Root receives its computed hash separately to avoid self-referential metadata. Independent bounded peer review is requested and remains pending; it must not infer native acceptance from these receipts.

Skill routing: systematic-debugging traced the actual emitted SQL, test-driven-development required fresh RED before repair, verification-before-completion required current GREEN/source-preservation receipts, and Supabase/PostgreSQL guidance applies to literal quoting. This is a fixture/parser correction, not a full audit, UI change, deployment or new authorization exercise; unrelated skill groups were not invoked. Root exclusively maintains shared memory and publication metadata.

Next: root captures these exact five files, obtains bounded peer receipt and publishes only a material candidate. The disposable CI must execute the corrected six native cases and subsequent original fixtures. Historical six native failures and later NOT_REACHED outcomes are not promoted here.
