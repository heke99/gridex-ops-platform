# Five changed index source witnesses

Status: implemented; actual owned PostgreSQL 17 execution required. This is source
and predicate qualification, not schema, performance, generated-type or release
acceptance. The original reference and source migrations remain unchanged.

Skill routing: code-review and verification-before-completion apply to the
orphaned witness draft and its runtime integration. Database/source review uses
the pinned index disposition register. UI, deployment and performance tuning
skills do not apply: this introduces no application, production or index changes.

The witness pins the whole disposition register, comparator and four historical
DDL sources. It verifies the exact declaration locations and statement hashes,
then recreates all five definitions on empty temporary clones. Actual and source
witness indexes must match all six canonical fields and the unchanged observed
hashes; both must be valid, ready and live. The one unique index exercises twelve
status/activity/null-key combinations: four duplicate rejections and eight
allowed duplicates. Nonunique index ordering differences are explicitly retained;
matching the authored source does not establish equivalent performance.

All derived SQL uses the existing owned transports, with portable SQL in stdin
only. The transaction rolls back; catalog, table rows, migration ledger, retained
sources and ownership must remain unchanged. Raw SQL/catalog definitions never
enter diagnostic receipts. Invalid, absent, forged or mismatched receipts block
schema collection and the application type candidate. Native execution additionally
binds the witness before and after to the real Runner's complete forward ledger.

Integration is after the changed-function witness in portable/native runtimes,
with native retained-source handoff and both schema collectors. Application type
generation requires the same verified index receipt in the post-cleanup comparison.
The final acceptance gates remain unchanged.

Local verification: witness8, portable timestamp21, native schema4, schema
collector28, application type candidate9, native runtime24 and historical
lifecycle166 tests pass.
Local fixtures do not claim actual PostgreSQL execution.
