# Portal identity and API origin replay effects

Status: locally verified input-selection repair; full replay remains open.
No production writes or full parity claim.

The complete 44-line source `20260609150000_batch_6_sync_status_origin_fix.sql`
contains four API-client column additions, origin metadata backfill, two identity
defaults, two legacy identity value normalizations and two client indexes.
Its early bootstrap preserves only the client columns/indexes. The selector
currently suppresses the entire timestamped source after selecting that bootstrap.

Direct read-only production catalog on 2026-09-06 gives identity defaults
`status='pending_review'` and `match_strength='manual'`. The committed canonical
table instead has `match_strength='weak'`. Thus omitted effects cause confirmed
schema drift, rather than an accounting-only discrepancy.

Both preceding whole-source migrations `20260609113000` and `20260609143000`
create the identity table before the source's timestamp position. The bootstrap
continues providing client prerequisites at its existing earlier position.

The narrow proposed repair is `preserveSourceReplay=true` for this specific
bootstrap: execute the immutable original source at its original timestamp,
including every reviewed effect, rather than declaring a partial replacement
complete. No source SQL or historical checksum changes. All other unresolved
substitutions stay blocking.

This source contains no fixed customer, operator, credential or tenant seed;
no inserts, deletes, external calls, policy changes, grants, or dynamic SQL.
Its generic data transformations are deliberately included in fresh local
reconstruction: populate absent origin lists only from array-shaped metadata;
normalize legacy identity values to the existing constraint contract. This
does not authorize re-executing it against production. Existing explicit origin
lists and valid identity attributes must remain unchanged.

Targeted verification is `scripts/canonical-portal-origin-replay-selftest.mjs`.
It checks actual input selection and executes the full source twice in an
isolated SQL fixture containing the actual committed identity table definition.
API-client fixture cases cover empty origins, existing explicit origins and
non-array metadata across synthetic companies. It checks identity preservation,
fresh defaults, and both indexes. This does not replace a complete Supabase
replay, ledger reconciliation, authoritative type/schema generation or production
comparison. The two legacy normalizations cannot be triggered by rows satisfying
the committed identity CHECK constraints; historical incompatible-data upgrade
coverage remains outside this canonical-fixture test.

Verification on 2026-09-06: the new test first failed because accounting returned
SUBSTITUTED for this source. After the single preserveSourceReplay change it
passes: actual source selected at timestamp stage, full SQL executed twice,
explicit origins and valid identities preserved, both indexes verified, and
fresh identity defaults match the read-only live catalog. The 21 accounting
regressions and static provenance regression also pass. No historical checksum,
schema baseline, generated type or ledger was rewritten.
