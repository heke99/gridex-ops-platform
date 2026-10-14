# Verification of the interrupted full-suite failures

The original sandboxed full-suite run is incomplete. Root terminated session 95745 with exit 130 after 1,091 file reports and a prolonged output stall. Its 37 problem-file reports include failed assertions, failed imports and skipped-only hook failures. `full-suite-incomplete-inventory.json` preserves that status and every affected filename; no complete full-suite pass is inferred.

The completed Node22 rerun used the authorized local subprocess/loopback boundary, two workers, 60-second hook budgets and a 45-second default test budget. It ran all 37 problem files, the unreported pre-existing OPS03 file, all 18 new workstream files and the modified controltower test: 57 files, 1,164 assertions, zero skipped/todo. Outcome: 53 files passed, four failed; 1,157 assertions passed, seven failed. All 18 new workstream files passed their 140 assertions. The full result is `full-suite-failures-escalated-results.json`; the file-level classification is `full-suite-rerun-classification.json`.

The obsolete website customer-relationship test required the tenant-safe query string to occur twice in source code. The central loader now hydrates both list and detail through one query function. Root granted this exact test file, and the duplicate-occurrence assertion was replaced with stronger runtime checks for both paths: canonical-view company guard, explicit composite customer relationship, selected application ID and correct customer despite a foreign-company fixture. Three assertions pass in the combined run and `customer-relation-runtime-verification-results.json`; scoped ESLint and diff checks pass.

The remaining failures are independent of the admin edits:

| File | Combined-run failure | Isolated result |
| --- | --- | --- |
| `ediel-confirmed-customer-final-response.test.ts` | Three explicit 20-second test deadlines expired. | All 62 assertions pass with temporary local 120-second runtime budgets. |
| `ediel-sc-010-beneficiary-export.test.ts` | Native child `spawnSync` exceeded its explicit 30-second deadline. | All 12 assertions pass with temporary local 120-second runtime budgets. |
| `ediel-prodat-free-text.test.ts` | Native child `spawnSync` exceeded its explicit 30-second deadline. | Its complete native assertion wrapper passes with temporary local 120-second runtime budgets. |
| `native-lock-process.test.ts` | Cleanup and lifetime timing checks failed. | Unmodified isolated rerun passes five of six; the strict 30 ms cleanup-bound test still reports `native_lock_process_cleanup_timeout`. |

All four failed test files and the six checked native helper/harness/migration files are byte-identical to HEAD, with hashes recorded in the classification JSON. Repository Ediel source and tests were not edited. The native helper's default cleanup grace is 3,000 ms; the failing synthetic process test explicitly uses 30 ms. Its failure remains recorded, without a green claim or a change to that test's conditions.

The three timeout files were rerun in full, without test filters or skips, using an AST transform located only at `/tmp/gridex-native-budget-proof.config.mjs`. It changes numeric test-registration budgets and native child-runtime deadlines only. All assertions, mocks, SQL and repository files remain unchanged. The three-file result is 75/75 passed in `native-timeout-isolated-results.json`; the exact temporary configuration, source hash and transformed budget spans are preserved in `native-timeout-isolated-provenance.json`.

This establishes no admin-workstream regression from the affected-suite run, while preserving one unchanged baseline cleanup-bound failure and the original incomplete full-suite status. After this run, root handed the four named pages' canonical tenant-scope follow-up to the portfolio delegate, including the workqueue boundary mocks. That delegate and root own verification of the later scope change.
