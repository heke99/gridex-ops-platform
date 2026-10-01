# Independent bounded restore schema diagnostic review

2026-10-01. Scope: ROOT-owned JSON diagnostic, its six local tests, and read-only comparison of the two restore shell callsites and catalog query. This review executed no SQL, role/Auth/dispatch/path exercise, Supabase stack, network or provider operation. It adds only this report; all reviewed source/test files remain unchanged.

## Executed local result

```text
/tmp/gridex-event-v2-node22-cache/_npx/52027bd8fc0022aa/node_modules/node/bin/node --test scripts/tenantservice-restore-schema-diagnostic-20261001.test.cjs
```

**6/6 PASS, zero failed/skipped, exit 0.** The tests execute the actual comparator/output and actual child CLI against synthetic private JSON files. The CLI's successful output contains hashes, fixed category/field names, change kinds and counts; a malformed JSON document produces empty stdout, exactly `TENANTSERVICE_RESTORE_SCHEMA_DIAGNOSTIC_UNAVAILABLE` on stderr, and exit 1. The Node runtime's pre-existing experimental EnvHttpProxyAgent warning is separate from the child CLI, whose tests explicitly disable runtime warnings.

## Source and boundary findings

All thirteen fixed categories remain represented: schemas, relations, columns, enums, constraints, indexes, functions, triggers, policies, relation grants, function grants, schema grants and extensions. Only `pg_cron` is excluded, identically to the original Python gate. Object identities and entire before/after rows are SHA-256 hashes. Changed field values are independently hashed; extra unknown row fields use the constant label `[extra-fields]`, never their private names. SQL definitions, policy expressions, role names, emails, keys and other supplied values are never interpolated into output.

The full set of changes is counted before display truncation; each category retains its complete count. At most 80 object records are printed. The 111-change test verifies this distinction. Unknown top-level categories, absent/non-array category collections, malformed identities and duplicate identities cause exceptions before any output. The CLI catch emits one constant error without exception text, input filenames or JSON/parser details. The six tests directly cover unknown category/duplicate rejection in the comparator; their constant CLI behavior follows from this unconditional catch. Inputs larger than 64 MiB are rejected through the same path. No concrete raw-value disclosure or equality bypass was found in this bounded source review.

Both shell callsites first execute their original complete Python document equality comparison. They exclude only the existing `pg_cron` extension and retain all other categories/values. On mismatch they invoke the diagnostic, tolerate only diagnostic failure with `|| true`, and then explicitly `exit 1`. A successful diagnostic cannot turn a failed catalog comparison green. Original immutable bytes, application/Auth data, owner/column/default ACL fingerprints, template0/local restore guards and subsequent command/RLS/post-proof checks remain present; the later checks run only after strict catalog equality. Baseline rollback additionally captures and rechecks the diagnostic and query source identities among its helper dependencies.

## Catalog rendering qualification

The current query pins `search_path` to `pg_catalog` on each connection, with psql QUIET preserving one JSON document. It represents every visible, non-dropped column in actual logical order using `row_number()` rather than storage attnum holes. Type/default/nullability/identity/generated fields remain compared. Policy roles are sorted by the actual rendered role-name expression; `ORDER BY 1` inside the aggregate previously sorted a constant. All thirteen categories remain present, including full policy expressions, privilege rows, RLS flags and function-body hashes.

The billing owner's separate `tenantservice-parity-rendering-20261001.md` records 17/17 actual PostgreSQL-core cases against this exact new query SHA-256 `b856899dcb1b0ee3aae0aa3225efe819c8e3ce9cf3e1b8bacb9b61e03c53763d`. Its controlled old/new mechanisms and genuine drift controls are consistent with the read-only source changes above. This reviewer did not rerun those SQL/role cases. Their receipt does not identify actual private mismatch rows from CI and does not qualify full Supabase restore.

The genuine df7 upgrade reached real archive restoration, bootstrap ACL reconciliation and data/owner-ACL fingerprints, then failed `columns,policies` equality. Its separate old-schema rollback similarly failed strict catalog equality after those prior gates. Those actual failures remain failures; this diagnostic and rendering review do not declare their native acceptance. **New native restore/rollback execution by this reviewer: 0 / NOT_EXECUTED.**

## Reviewed immutable input identities

| Path | Git blob | SHA-256 |
| --- | --- | --- |
| `scripts/tenantservice-restore-schema-diagnostic.cjs` | `dc0226e0286678ce33d43285accd133fd3b16e1f` | `640f9b8952d1f6c031b509ce844391454eb4752b13a9444d9163d5f3ca47fad7` |
| `scripts/tenantservice-restore-schema-diagnostic-20261001.test.cjs` | `170e80b2ce90ffca60b5c0137ce5af593413e57e` | `f3518025e834ce410e04469698960eef6b73b3058500593fd52d6cbbbc4ac0bf` |
| `scripts/tenantservice-upgrade-restore.sh` | `fe6fbf1bac5065a2f3239164fa9b3ce92a8f4c0d` | `0f89a8126d3184c378e1f663d3552c7c65e9698aa47b1b3ba0326a460bb83e22` |
| `scripts/tenantservice-baseline-rollback-20261001.sh` | `2de62d9c7dbf5769de00ed603c6a450337171547` | `8fffaef387efad51f4fba4f7d36726ee983d810f2b03ec846b8386476459c8a3` |
| `scripts/sql/gridex-db-parity-introspect.sql` | `ca9c417e8b38a9a5273ad081d3882c50658545ba` | `b856899dcb1b0ee3aae0aa3225efe819c8e3ce9cf3e1b8bacb9b61e03c53763d` |

The report digest is supplied separately to ROOT. No reviewed source or prior frozen lifecycle/df7 report was modified.
