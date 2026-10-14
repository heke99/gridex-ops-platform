# OPS quote replay compatibility — private proposal only

The applied source `supabase/migrations/20261013093906_ops_api_website_quote_nonexpiring_policy.sql` remains byte-identical, SHA256 `7eceae42dccce7a968182d144389329d1c11466bf0c896afff62250950f9f2ce`. Its exact legacy-body guard refuses the canonical non-expiring body already established by `20260822103821_non_expiring_website_quotes.sql`. A later chronological forward cannot repair that earlier refusal. The current actual OPS function is already canonical `007d078d9d0065395edf2190d4f1d3b6`; read-only metadata at2026-10-14T08:02:01Z confirms definition digest `fe9fcd88e137756d6b663b5bcaa7363f`, postgres ownership, service-role-only application EXECUTE and the complete expected metadata. No native application is required for this compatibility correction.

Proposed bootstrap destination: `supabase/bootstrap/20261013_ops_quote_nonexpiring_replay_adapter.sql`. The new artifact is source-SHA-bound to the original October forward. Canonical007d runs a verified no-op. Legacy4daec removes exactly the original TTL block, verifies the complete canonical transformed definition and preserves every other `pg_proc` attribute and OID. Unknown body, ABI, owner, ACL, settings, cost, support or transformation refuses. It invokes no business RPC and changes no quote records or historical deadlines.

`legacy-foundation-additions-entry.json` is an additive descriptor proposal for the existing `scripts/gridex-aud-003-legacy-foundation.additions.json`. The existing derived-bootstrap/interleaved routing executes the adapter between93621 and93922 and skips execution of the pinned original93906 in clean replay. Both boundary migrations and the original source stay in the canonical source history. This is executed-input provenance, not a fabricated historical registration or a claim that the applied source was undeployed.

The current upgrade and history-union materializers ignore the derived-bootstrap descriptors and copy the original93906 bytes into their executable lists. Their private patch proposals share a committed-source resolver. It verifies the canonical manifest source hash, optional explicit `sourceSha256`, committed artifact hash, declaration and exact boundary. It refuses ambiguous bindings. Unaffected input rows and all historical source-preservation checks remain intact.

For substituted rows, `sha256` and `sourceSha256` retain the original canonical source identity. `executedSha256` identifies the actual replay artifact; `path` points to its materialized executable bytes and `originalSourcePath` retains the untouched original bytes. Consumers verifying executed files must use `executedSha256`. These materializers perform no SQL and make no migration-ledger claim. The small clean-replay patch also checks an explicitly supplied source hash instead of merely binding the source to a potentially different manifest entry.

Proposed shared-file handoff:

- New bootstrap SQL and new helper `scripts/gridex-derived-replay-inputs.py`.
- Additive descriptor entry in `scripts/gridex-aud-003-legacy-foundation.additions.json`.
- Bounded patches for `scripts/gridex-aud-003-clean-replay.sh`, `scripts/gridex-ediel-upgrade-inputs.py` and `scripts/gridex-ediel-history-union-inputs.py`.
- Provenance consumers/documentation must distinguish canonical source and executed derivative hashes; do not relabel the old source checksum as executed adapter proof.

This private directory does not take GEN/C2 or shared-builder custody. Root must obtain the existing named source-routing handoff before applying shared-file changes. No repository files, published SQL/checksums, native database objects or canonical GEN outputs were modified here. Source AST parsing and original/adapter hash checks pass; genuine canonical-noop, legacy repair/replay, unknown-body/metadata refusal and whole-transaction rollback qualification remain pending under the final routed source.
