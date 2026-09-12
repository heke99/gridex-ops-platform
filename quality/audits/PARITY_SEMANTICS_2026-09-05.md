# Parity catalog semantics — 2026-09-05

Status: verified local tooling repair; production/canonical parity remains OPEN.
No production database was accessed or mutated for this bounded work. No phase
is closed, no generated schema/types were edited, no ignore or fingerprint
baseline was changed, and no commit or publication was performed.

## Skill routing and scope

Read AGENTS.md, active project memory and database-and-migrations domain memory;
inspected existing parity, introspection, document validator, fingerprint writer
and both selftests. Applied Supabase, systematic-debugging,
test-driven-development and verification-before-completion. Direct executable
catalog comparisons supply finding verification. This delegated task is a
bounded instrumentation repair, not a full baseline audit: UI, application
architecture, performance, deployment, hooks and broad static-analysis workflows
are outside scope. General memory updates belong to the coordinating agent.

## Confirmed findings

| Finding | Severity | Evidence and impact | Root cause and repair |
| --- | --- | --- | --- |
| View/relation option drift invisible | High | Changing `security_invoker=true` to `false`, `security_barrier`, or table fillfactor yielded a blocking PASS and unchanged fingerprint before repair. View execution security changes can therefore evade the gate. | Catalog projection omitted `pg_class.reloptions`; comparator omitted it. Capture a sorted array (C collation, empty for absent options), compare it, require its presence. |
| Privilege delegation drift invisible | High | Adding WITH GRANT OPTION to relation SELECT, function EXECUTE or schema USAGE yielded a blocking PASS and unchanged fingerprint before repair. The gate could miss expanded privilege delegation. | Every `aclexplode` projection omitted `is_grantable`; grant sections compared identity alone. Capture and compare grantability in all three sections; require its presence. |

PostgreSQL primary references: [pg_class](https://www.postgresql.org/docs/17/catalog-pg-class.html),
[ACL information functions](https://www.postgresql.org/docs/17/functions-info.html).
The Supabase changelog markdown endpoint was attempted but the web reader rejected
its content type; no Supabase API or platform feature change is made here.

## Executed verification

Runtime: Node 24.19.0, externally installed PGlite 0.3.14, embedded PostgreSQL
17.5. Dependencies were not added to the repository.

| Command/check | Outcome |
| --- | --- |
| `GRIDEX_PGLITE_MODULE=/tmp/gridex-guard-validation/node_modules/@electric-sql/pglite/dist/index.js node scripts/gridex-db-parity-semantics-selftest.mjs` before repair | RED, exit 1: 22 failed checks. Six independently applied catalog mutations were invisible in both directions and fingerprints; four omitted-field documents were accepted. Identical/order controls passed. |
| Same command after repair | GREEN, exit 0: 26 checks. Each mutation detected as exactly one matching field finding in each direction, each fingerprint changed; identical captures and reordered options stayed equal; incomplete documents failed closed; actual multiple-grantor ACLs reject ambiguous identity instead of collapsing rows. |
| `node scripts/gridex-schema-document-selftest.cjs` | PASS: incomplete documents, including old-format relation/ACL rows, rejected by parity in all three modes and snapshot writer. Valid empty requested schema accepted. |
| `bash -n scripts/gridex-db-parity-selftest.sh` | PASS. |
| Executed both heredoc SQL blocks from the PostgreSQL selftest in fresh PGlite | PASS: fixture and mutation SQL execute, including pg_monitor grant-option fixtures. |
| `git diff --check` | PASS. |

The PGlite regression executes the actual repository introspection SQL against a
real embedded PostgreSQL catalog. A temporary psql transport fixture supplies
those captured documents to the actual blocking CLI in both directions, with
`--no-ignore`; it does not synthesize changed catalog fields. Snapshot checks
exercise the actual writer/fingerprint path using those documents. The pg_dump
fixture emits constant text deliberately, so these checks prove fingerprint
sensitivity rather than pg_dump behavior. Temporary files and databases are
removed. There is no socket PostgreSQL/psql installed here: the complete bash
selftest against the Supabase stack remains a hosted CI requirement. Its
existing gate now includes view/table options and all three grant-option classes.

## Snapshot provenance consequence and remaining limits

The expanded JSON changes the relations, relation_grants, function_grants and
schema_grants section hashes (when nonempty), and the overall fingerprint, even
when the database itself has not changed. This is increased measurement coverage,
not proof of database drift. The algorithm remains canonical-json/v1; its JSON
serialization has not changed. Existing hashes must NOT be hand-edited or
regenerated from this fixture or a noncanonical local replay to turn a gate green.
Capture a new snapshot artifact from the authoritative clean-migration-replay CI
stack at the reviewed revision; inspect and commit that provenance-backed output
using the existing process. Any concurrent forward migration has its own schema
changes and must be included in that review. No baseline artifact was updated here.

This repair covers only the two evidenced omissions. It does not establish that
all PostgreSQL security semantics are represented: ownership, column/default ACLs,
role membership and other catalog dimensions were not expanded or certified.
Existing ambiguous grant identities continue to fail closed. Sorting relation
options removes ordering noise; explicit option defaults vs absent options remain
visible catalog differences. Production and complete canonical replay still need
fresh two-way comparison with the repaired introspection and classification of
all residual findings. Counts or local fixture success cannot close that work.
