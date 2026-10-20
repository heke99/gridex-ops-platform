# Independent final six-file routing union source review

2026-10-14. Read-only source review in `/tmp/gridex-ops-final`, comparing actual uncommitted postimages with independently observed `HEAD=f13bb4f30766dfdc76dc25b5b234a6dfc31be85e`, tree `994edf5d028fac72de7b9987f74eb182e707cee0` (`git show -s --format='%H %T' HEAD`). This review binds the SHA256 postimages below, not a future commit or candidate tree.

## Conclusion

No source-blocking defect found in the actual six-file routing union. The clean path routes the declared quote adapter between the exact signing-deadline/pricing-snapshot boundaries; both upgrade planners select only candidate-committed checksum-pinned declared artifacts, preserve original SQL separately, and record original-source versus executed-artifact hashes distinctly. Source history is preserved. This is independent bounded final source review only, with no full-history, native, CI, database, delivery, or production PASS.

## Reviewed final postimages

| File | SHA256 |
| --- | --- |
| `scripts/gridex-aud-003-clean-replay.sh` | `7c2ab100784fe3aab8ee8a350254e272adbfb96aad04f2a61d199a5d7cc0c8cb` |
| `scripts/gridex-aud-003-legacy-foundation.additions.json` | `7a3cfad2dcccb999517874b743e4184ef3d08d1c4cbf85c4eb617fef7d6d7b83` |
| `scripts/gridex-derived-replay-inputs.py` | `f198a4e7cd800f4faa9629a9a34ae99d003f637613eb3831d77449d9595acb6c` |
| `scripts/gridex-ediel-upgrade-inputs.py` | `2286b227e967c9686c7e0541397c2fcb5814de5e1a02c5d5286bd17314e3c5de` |
| `scripts/gridex-ediel-history-union-inputs.py` | `4005c1ad9d0b52596e4f5bc52e009c68cbfc3d923f9ffe5e7d844c58f45d5750` |
| `supabase/bootstrap/20261013_ops_quote_nonexpiring_replay_adapter.sql` | `3afea47b4343c5d5e6d97a4f709bccf5c8cf6f7cf33c179f022629ff4d7c481b` |

## Source reasoning and evidence

- The new descriptor names the immutable migration `20261013093906_ops_api_website_quote_nonexpiring_policy.sql`, original SHA256 `7eceae42dccce7a968182d144389329d1c11466bf0c896afff62250950f9f2ce`, and executed artifact SHA256 `3afea47b…`. Actual historical source bytes and `git show HEAD:<source>` both hash to `7eceae42…`. Its source diff is empty. Existing additions remain intact; new descriptor and interleaved row are additive.
- Static manifest inspection identifies exactly one source strictly inside the declared open interval `(20261013093621,20261013093922)`: `20261013093906_ops_api_website_quote_nonexpiring_policy.sql`. Both boundary sources exist. Helper lines 77–86 explicitly reject a source outside that interval, missing endpoints, or a second source within it. Existing manifest merge checks still reject conflicting historical source digests.
- Clean replay lines 164–176 now reject conflicting `source`, `sourceKind`, `artifactSha256`, or `sourceSha256` identities between foundation descriptors before enriching nonidentity metadata. Existing descriptor enrichment for preserve-source replay remains possible. Lines 209–214 verify the original source against both historical manifest and the new explicit source SHA. Existing source skipping plus interleaved execution inserts the adapter after the signing deadline and before pricing snapshot and does not also execute the replaced legacy quote source.
- New helper lines 39–52 reads descriptor plans at the exact candidate revision through Git, validates normalized relative paths, descriptor identity consistency and boundary format/uniqueness. It does not read uncommitted SQL as candidate evidence. Lines 54–76 respect `preserveSourceReplay`, ignore verified-live declarations for migration substitution, select only absent planner-selected migration names, reject ambiguous adapters for a source, and verify original and artifact bytes against independent pins. It uses the existing historical source digest as source identity.
- Helper lines 93–108 preserves the exact original selected source under `original-sources/`, puts the verified executed adapter under the selected input path, and returns both `sourceSha256` and `executedSha256`; legacy `sha256` remains explicitly the canonical/source digest. The original bytes must match the committed source already checked by the caller. It labels the substitution `ledgerClaim: NONE`.
- Strict upgrade still requires genuine base ancestry, immutable historical manifests and byte identity, forward-only added names, and checksum-bound noncanonical exclusions before invoking the helper. History union still requires source-witness/ancestor/tree pins, no removed/changed history, exact earlier-absent classification and source bytes, required order, no version collisions, and exclusion contract; new materialization keeps `earlierAbsentInput` and `sourceCommit` provenance fields. No existing protection was removed.
- Direct unchanged callers `gridex-ediel-upgrade-replay.sh` and `gridex-ediel-applied-txt-branch-upgrade.sh` execute the paths from the planner lists using `psql -X -v ON_ERROR_STOP=1 -f`. Therefore preserving the canonical/source hash in the receipt does not cause either caller to execute the original legacy SQL accidentally. Review found no caller treating that field as the executed artifact hash or registering it into a historical ledger.
- Adapter source begins a transaction with bounded lock/statement timeouts and recognizes only the exact legacy body `4daec568…` or complete canonical body `007d078d…`. Canonical is checked as an exact full-definition no-op, including absence of TTL anchor/error. Legacy is transformed only if the exact retired TTL block occurs once and removal gives the pinned canonical full-definition digest. Unknown predecessor refuses. Complete relevant pg_proc attributes are checked before effect; all pg_proc attributes other than `prosrc`, exact canonical body/definition, and complete no-op row identity are checked afterward. No business-row mutations or token-expiry changes occur in this adapter source. Historical SQL is not rewritten.

## Verification boundaries

Commands were source reads, `git status`, `git show`, `git diff`, `rg`, line-number reads, SHA256 inspection, and a read-only JSON manifest inventory. No planner execution, tests, database calls, GEN, network, ref edits, publication, or shared/source writes. Only this private report was written. Parent's core seven code/document postimages and unrelated working-tree edits were left untouched.

Because the helper intentionally resolves descriptors/artifacts through candidate Git objects, these uncommitted files are not runnable proof for HEAD f13; execution/proof must bind the eventual commit containing the same reviewed postimages. Existing qualified producers and delivery owner remain authoritative. No existing historical or native evidence is promoted to a new whole-history result by this source review.
