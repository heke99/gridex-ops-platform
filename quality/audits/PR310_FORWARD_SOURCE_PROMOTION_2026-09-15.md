# PR310 — two forward repairs after the retained historical chain

Status: IMPLEMENTED_NOT_VERIFIED. Actual native full-chain/forward SQL, independent
schema acceptance, generated types and final CI/E2E/review remain mandatory.

## Verified defects and genuine sources

| Source | SQL SHA256 | Evidence |
| --- | --- | --- |
| `20260915111458_restore_existing_column_foreign_keys.sql` | `5593bf9f66e2ea783ac37f23ca4f547132e70beb519a955dc5b2666a65db569c` | Genuine pinned Supabase CLI filename; isolated PG17 job104361913617 passes exact two FKs, invalid references23503, delete SET NULL/update NO ACTION, existing/fresh paths, orphan rollback, wrong-definition55000 and idempotence. |
| `20260915121224_restrict_retained_operational_table_privileges.sql` | `c8928d29f3cf5ad527513a7448b4819c4f7a80f07d9fe3b78c764e30759e134e` | fd4fb907 workflow34967447054/job104375184474 SUCCESS; genuine CLI2.101.0 filename after PG17 original TRUNCATE/RLS bypass and repaired42501, exact DML/service grants, policy/row preservation, atomicity/repeat/cleanup. |

Operational artifact10395677716 ZIP SHA256
`3965feecf1326870dc28148559aa27a4765eeefae257bc806c5ab30dd048fe72`
was downloaded and verified. Its CLI source bytes match the staged candidate.
Both files are copied unchanged to `supabase/migrations` and registered together
in the runtime additions manifest. Staged candidate comments describe their
original authorship state; this document records the later promotion.

## Historical integrity and execution boundaries

The original601 path/SHA pairs retain digest
`ed164e9b8c55194015cd5b0f62adde6b743dc31a5866f08546a78c60b5240a31`.
The ordered original514 timestamp pairs retain digest
`076408eb112ebd8b153a18d4774ffd7122d92ad3c0a8a9aaf8b58faacfe71fbe`.
The unchanged shell selector now reports144 foundation/516 timestamp inputs;
explicit partitioning retains historical514 and exactly these2 new sources.
All603 inventory paths/hashes, suffix order/classification and original601 pins
are required. Unknown/missing/changed inputs fail admission.

Historical SQL fixture constructors still test their original601 scope. A bounded
adapter verifies the actual603 inventory and exact2 suffix rows first, preserves
the raw report, and labels the returned historical view with currentInventoryTotal603.
It does not silently raise historical count assertions or change auth SQL.
The focused auth/membership group remains347 inputs; original ec503fc retained.

The native lifecycle retains both original SQL files before target creation.
After all144/514 source and real ledger receipts, snapshot qualification, special
phase/lock/live-sync controls, restoration controls and no-op repeat, the existing
live owned Runner applies both suffixes through the official CLI. Each gets its
own CLI-generated execution filename/statement ledger, post-body PF001 and ledger
PF002 failures with exact rollback checks, row-preserving postconditions and no-op
repeat. Outer BEGIN/COMMIT is transferred to the CLI transaction; source bytes and
execution-body hashes remain separately identified. No historical ledger aliases.

Four ledger-dependent sources T257/T262/T275/T351 now run actual view/function
behavior qualifications after their real CLI apply. Disposable native clone
manifest rows reference only genuine existing CLI version/name pairs, in a
transaction ending ROLLBACK. Positive and defect controls, unchanged real ledger,
clone snapshot restoration/disposal and parent preservation are mandatory.
Deployment readiness remains explicitly false; manifest evidence is not invented.
T351's explicit historical seed value is characterized separately from its default
refresh, which must read the actual latest native CLI version.

The owned portable path runs the same retained2 sources after144/514 while its
original-file HOLD is active. It requires exact postconditions, unchanged rows,
identical repeat snapshots and source disposal/restoration. The independent full
schema observer only captures after both verified receipts. It does not imply
native ledger provenance and does not replace `supabase/schema.sql`.

## Review and verification

Independent reviewer found two initial forward-admission gaps: a forged empty
Plan and omitted prerequisite qualifications. Both are fixed; exact retained
plan recompilation and source-specific qualification receipts are required.
Re-review found no necessary issues in forward ownership/SQL/rollback/capture.
Readiness helper/runtime hook also independently reviewed without findings.

Fresh local checks: forward source6; native forward6; portable forward5;
owned timestamp15; full-schema observer23; native ledger regression8; timestamp
frontier16; residual admission20; timestamp source compiler12; readiness4;
existing timestamp runtime19. The complete auth/membership construction/group
selftest passes including unchanged auth assertions and truthful603/347 memory.
These are offline/source/transport tests, not actual full native SQL acceptance.

The ordinary clean job remains blocked until full native execution AND final
schema/tenant/type gates are integrated and passed on its live owned database.
Generating only a type manifest or replacing the independent reference is not
permitted. The whole PR must reach main only after same-final-head acceptance.

Skill routing continues the recorded systematic-debugging, source preservation,
verification-before-completion and requesting-code-review workflows. Parallel
agents own only independent source dispositions/readiness and review. No UI,
performance optimization or production mutation is part of this batch.

Additional integration verification: real CLI transport originally rejected the
new source names. A faithful RED test reproduced FIXED_NATIVE_CLI_COMMAND_REQUIRED;
the allowlist now admits only forward01/02 plus12hex digest, preserving external
target/workspace rejection. Lifecycle15 and full historical integration166 tests
PASS. Inventory38, residual-probe12, restored-source19 and timestamp-source9
tests PASS; full auth/membership group also PASS. Source and count changes are
qualified by the explicit historical/current partition, never assertion removal.
