# Native staff role reference fixture repair

The complete S2 clean-replay artifact `11301918098` from OPS run
`37196388737`, exact head `c7e2b22825773f976293ccc8a2991fd5d7897d63`, has ZIP
SHA256 `ac2d7977540c44cc7d2e5ca15d17ba1c35590609a0bf8947282c364eafe0a10f`.
It records three SQL fixture setup failures (staff commands, client guard,
actor guard) and four native concurrency setup failures. All seven fail on
missing ordinary role catalog references before their domain/race assertions.
The main native JUnit contains 592 tests and four failures.

Canonical clean replay builds the role table and its global `roles_key_key`
unique constraint, while omitting the old noncanonical role seed migrations.
The five fixture producers now load the same additive reference SQL inside
their existing transactions. It creates `company_admin`,
`customer_service_agent` and `operations_agent` company role catalog rows using
`ON CONFLICT (key) DO NOTHING`. Existing rows, IDs, names, scope and active
status stay unchanged. The fixture grants no permission or account authority.
SQL fixtures roll back; the concurrency cohort remains disposable as before.

Six focused PGlite checks execute the actual five producer seed prefixes under
committed table declarations and constraints. Each reproduces the old
empty-catalog failure with the shared SQL removed, then reaches actual scoped
role assignments with the SQL present. The sixth check verifies idempotence,
unchanged existing inactive rows, the real global unique-key rejection and no
account/permission grants. This is a SQL mechanics diagnostic, not native race
qualification. All native race assertions, failure latches and CI gates remain
unchanged; fresh authentic native CI is required after this fixture repair.

Routing: code-review/systematic-debugging for the complete failure evidence,
test-driven-development for the reproduced seed failure, using-git-worktrees
for isolated repair and verification-before-completion for focused checks.
No production write, migration, rerun or history rewrite was performed.
