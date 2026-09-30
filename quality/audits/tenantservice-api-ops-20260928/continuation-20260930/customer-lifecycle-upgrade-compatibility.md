# Customer lifecycle prerequisite compatibility on the pinned upgrade

Scope: the next authentic old-schema upgrade failure, not full legal/lifecycle acceptance or a qualified restore. This correction leaves all historical baseline SQL unchanged and preserves the preceding candidate SQL correction.

## Authentic RED and root cause

OPS run **36780003023**, upgrade job **110107571172**, workflow head `0d81465617d11f099502832385d976fdedf3cc6d`, actual checkout `45a09811bbbba42f287c6778de76f27dbe13b9ec`, tree `e86c110e64e7fa494a68a7dc6010aea39c2c7394`:

- The pinned `ae56ee0a1e0e8adbce9d5f4d92da75cdcb8010c8` historical clean replay and genuine old-row fixture passed.
- Profile migration parsing and the corrected restore wrapper passed their previously failing boundaries.
- `20260930161500_customer_billing_profile_command.sql` was applied at 21:34:13.178 UTC and failed at 21:34:13.223 UTC. The sanitized first error at 21:34:13.242 UTC was `record "new" has no field "moved_out_at"`.
- Candidate postcheck, immutable post-upgrade comparison, backup and restore were not reached. This run does not prove those outcomes.

The billing forward initializes existing customers with an UPDATE. The earlier profile forward installs `private.gridex_customer_legal_lifecycle_revision_v1`, whose UPDATE branch reads `NEW/OLD.moved_out_at` and three other lifecycle fields. PostgreSQL can create this PL/pgSQL trigger without resolving every record field; the actual existing-row UPDATE evaluates the absent field and fails.

The canonical `01_db1_schema_repair_core_helpers_and_canonical_tables.sql` customer CREATE TABLE omits the lifecycle fields. Its nearby `moved_out_at` declaration belongs to **customer_addresses**. The eight-digit repository source `20260519_customer_move_out_lifecycle.sql` defines the intended customer fields, but is absent from the pinned declared foundation and does not match the clean replay's canonical `^\d{14}_.+\.sql$` selector. Repository presence is therefore not evidence that these columns existed in the observed replay. The historical foundation/selector files remain unchanged; this correction does not alter replay history.

## Candidate correction

Only the candidate `20260930144853_customer_profile_facility_atomic_commands.sql` adds the historical nullable prerequisites before any revision trigger is installed:

| Customer field | Definition | Existing-value behavior |
| --- | --- | --- |
| `moved_out_at` | `date` | Nullable; existing column/value retained |
| `lifecycle_closed_at` | `timestamptz` | Nullable; existing column/value retained |
| `lifecycle_closed_by` | `uuid` referencing `auth.users(id) ON DELETE SET NULL` | Nullable; existing column/value retained |
| `lifecycle_status_reason` | `text` | Nullable; existing column/value retained |

Every addition uses `IF NOT EXISTS`. No legacy closure date, actor or reason is inferred, no customer row is rewritten, and no trigger field access or authorization check is bypassed. The candidate's original SQL syntax correction is untouched. Root owns checksum manifest regeneration and publication; this package changes neither manifests nor workflow files nor refs.

## Executable PostgreSQL-core RED/GREEN

New proof: `scripts/customer-lifecycle-upgrade-compatibility.postgres.test.cjs`. It uses the existing executor's PGlite 0.3.14 / PostgreSQL 17.5 runtime without network access. It executes extracted **actual** canonical customer table/normalizer SQL, candidate customer prerequisites/legal-lifecycle trigger, and billing initializer/backfill. Prerequisite tables and representative legacy billing/name fields are a deliberately scoped fixture; this is not a full 653-file native Supabase replay.

Command used with Node 22.23.3:

```sh
NODE_PATH=/tmp/ediel-service-check/node_modules \
  /tmp/ediel-toolchain/node_modules/node/bin/node --test \
  scripts/customer-lifecycle-upgrade-compatibility.postgres.test.cjs
```

Before the production correction: **1/4 PASS, 3/4 FAIL**, each failing with SQLSTATE `42703` and the authentic `NEW.moved_out_at` missing-field error. The already-complete legacy column shape passed, which isolates the compatibility defect.

After the correction: **4/4 PASS**:

1. Absent lifecycle fields: the actual billing backfill succeeds; all new lifecycle values remain null; contact email, foreign billing country and all revisions are retained.
2. Partial historical lifecycle fields: existing timestamp/reason remain unchanged while absent date/actor remain null.
3. Complete historical lifecycle fields: existing date, timestamp including microseconds, actor and reason remain unchanged.
4. Actual trigger behavior: legal and lifecycle revisions advance independently, supplied counters are ignored, an invalid actor fails with SQLSTATE `23503` without a row change, and actor deletion nulls the reference while retaining closure date/reason.

Existing customer lifecycle service, OPS lifecycle action and OPS legal action suites: **31/31 PASS** in three files. Node syntax check and scoped whitespace check passed. The repository ESLint configuration ignores this CJS proof; no lint validation is claimed for it.

Byte-for-byte comparison against `ae56ee0a`: **653/653 historical SQL files unchanged**, zero missing or changed; the complete 654-file baseline migration directory including its non-SQL file is also unchanged.

## Remaining qualification

The latest authentic upgrade remains **FAIL** at the recorded boundary until a new OPS run of the integrated candidate passes the old replay, genuine-row forward upgrade, postcheck, immutable bytes, backup/restore and catalog/data comparisons. The root integration adds typed nullable prerequisite/value checks to the native upgrade postcheck; its execution must be reported separately.

The focused PostgreSQL-core result verifies this diagnosed prerequisite defect. It does not close original T/U requirements, native legal/lifecycle permission/concurrency/rollback suites, deployed UX, provider delivery, or any unrelated masterplan gap. No commit, publication, remote mutation, external dispatch or baseline migration change was performed by this package owner.
