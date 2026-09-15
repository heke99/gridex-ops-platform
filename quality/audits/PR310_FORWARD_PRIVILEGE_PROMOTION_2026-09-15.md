# PR310 additional forward privilege promotion — 2026-09-15

The two SQL-qualified candidates below are copied byte-for-byte from their genuine CLI-created artifacts into `supabase/migrations/`, after the two previously admitted forward sources. The runtime additions manifest and finite source admission now contain exactly four forward sources. This is source promotion and isolated SQL qualification evidence, not a receipt that the full native chain, schema parity, application actors or generated types have passed.

## Exact qualification evidence

Both workflows checked out `824f24d4a657d8a7563fc162aa5d7a9125d4e7b8`, ran their disposable PostgreSQL 17 fixtures successfully, and used Supabase CLI `2.101.0` to create the artifact filenames. The archive, SQL, CLI receipt and SQL qualification bytes were independently checked before copying. Each SQL file also exactly matches its existing staged candidate.

| Forward ordinal | Exact artifact SQL filename | SQL SHA256 | Workflow execution |
| --- | --- | --- | --- |
| 3 | `20260915132224_restrict_inbound_service_table_privileges.sql` | `0ee026c41d180768b23e20826d522387cc1c65e9c689304472f62cda39b19033` | Run `34974499866`, successful job `104398695222`, artifact `10398752010` |
| 4 | `20260915132227_restrict_new_tenant_table_truncate.sql` | `c67328cde9b270efad94aa44ded06f3b435170f247af90b1ea93e01dfe08523a` | Run `34974499894`, successful job `104398694965`, artifact `10398364669` |

Inbound archive `pr310-inbound-service-824.zip` has SHA256 `2aa6f716a0842271c0d7110172b1735a1fa30f811a9a56726a89ff1b3c6677b2`. Its `cli-creation.json` has SHA256 `7b12d2d88ca8373d769a540c95ba440ba04da3f69bafa2381e107cf9433b703d`; `qualification.json` has SHA256 `2fa2bbbe1437c840a296b9aee0c2266d33d9fb2f7bac5e10a92b1a02c444b35c`. The latter explicitly reports the limited three-table fixture, original TRUNCATE bypass, expected `42501`, exact ACL removal, service DML, catalog/row preservation, rejected shapes, atomicity, repeat and cleanup. Application graph, actual Auth helpers, schema acceptance and production modification remain false.

Tenant archive `pr310-tenant-truncate-824.zip` has SHA256 `3f2f97e06befa5a355223f3d6ab6cdb5c9a86f619fc74181a3957ea4f57b8fca`. Its `cli-creation.json` has SHA256 `fc7d30f0bbd75a377101ebeca17188ddd7b81a5c2a379bc8f62a1e269b25ad14`; `sql-proof.json` has SHA256 `1a10780e53c00fc9a9ef0997445836123d273e60337f383143364464c58f4b68`, which also equals the CLI receipt's `sqlProofSha256`. The CLI receipt binds source tree `1de9922e02019c5ff2b148794257ab5e157a093c`, run attempt `1`, and the empty CLI-created file hash before the reviewed bytes were installed. The SQL receipt reports the limited seven-table fixture, synthetic policy composition, original TRUNCATE bypass, expected `42501`, exact ACL removal, preservation, rejected shapes, atomicity, repeat and cleanup. Application graph, actual Auth helpers, schema acceptance and production modification remain false.

The qualification receipts correctly record `selectedMigration=false` at artifact creation. This later promotion registers the exact artifact bytes. Their original staged-candidate comments are retained unchanged as part of those bytes; they are not rewritten to manufacture a different source hash.

## Retained authority and execution boundary

The four ordered forward pairs are:

1. `20260915111458_restore_existing_column_foreign_keys.sql`, SHA256 `5593bf9f66e2ea783ac37f23ca4f547132e70beb519a955dc5b2666a65db569c`.
2. `20260915121224_restrict_retained_operational_table_privileges.sql`, SHA256 `c8928d29f3cf5ad527513a7448b4819c4f7a80f07d9fe3b78c764e30759e134e`.
3. The inbound artifact above.
4. The tenant TRUNCATE artifact above.

The historical 601-file inventory hash remains `ed164e9b8c55194015cd5b0f62adde6b743dc31a5866f08546a78c60b5240a31`; the ordered 514 timestamp-pair hash remains `076408eb112ebd8b153a18d4774ffd7122d92ad3c0a8a9aaf8b58faacfe71fbe`. Admission still validates both exact hashes, all four suffix hashes, uniqueness and chronological suffix order. No historical SQL, historical manifest pin or foundation order is replaced.

Current accounting is 605 migration files, 593 FULL_FILE_SELECTED, two substituted, five unclassified and five explicitly excluded. Raw selected input counts are foundation 144 and timestamp 518. The separate historical accounting remains 601 files, foundation 144 and timestamp 514, with 589 whole-file inputs and seven separately reviewed residual sources. These are input dispositions, not execution or ledger acceptance.

Native execution still requires the fully qualified retained historical prefix and uses the real CLI Runner for each of the four forward programs. Every source retains both exact post-body `PF001` and ledger-boundary `PF002` failure controls, unchanged earlier ledger checks, source/private-file/statement identity checks, row preservation and no-op repeat. Ordinal 3 requires all eight authenticated table privileges and all SELECT/INSERT/UPDATE/REFERENCES column reach absent on the exact three parser tables. Ordinal 4 requires authenticated TRUNCATE absent on the exact seven tenant tables. Neither postcondition grants or revokes another principal's privileges.

The portable continuation likewise executes and repeats all four retained original files, checking their postconditions and catalog/row preservation. OwnedTimestampTail completion and full-schema collection now require four forward inputs; source hashes and existing disposal/privacy gates remain mandatory. Their ordinary schema/ledger acceptance guards are not relaxed.

The CLI transport allows only forward names `gridex_native_forward_01` through `04`, each with the existing exact 12-character lowercase hash suffix. Unknown ordinal 05 and malformed names remain rejected. The separately requested synthetic type-generation command is also admitted only as the exact owned-network, local TypeScript/public-schema argument tuple; other networks, schemas, languages, linked targets and URL overrides are rejected. That transport admission is not full-schema type acceptance.

## Verification boundary

Local checks cover immutable inventory/selection, retained bytes, all four native failure controls, finite postconditions, all four portable executions/repeats, the exact CLI transport, historical accounting, owned continuation and schema collection. The existing final SQL admission automatically binds the four actual retained forward programs and ledger entries; its focused regression is rerun without changing its code.

Executed locally: 162 focused tests passed (forward sources 6, native forward 7, portable forward 5, CLI/lifecycle transport 15, residual admission 20, timestamp frontier 16, input accounting 38, owned continuation 15, full-schema observer 23, final SQL 5, historical timestamp compiler 12). `gridex-replay-complete-accounting.py --require-canonical-sources` reports `CANONICAL_SOURCES_ACCOUNTED`, exactly four additional sources and no errors; its execution and acceptance flags remain false. These local checks use offline transports and source evidence, not an additional native SQL run.

The next required evidence is actual execution of the complete native chain with all four forwards and subsequent existing SQL gates, followed by the separately required schema/actor/type decisions. Successful isolated PostgreSQL fixtures do not substitute for that execution. No commit, push, historical rewrite, reference refresh or acceptance-flag bypass is performed by this implementation subtask.
