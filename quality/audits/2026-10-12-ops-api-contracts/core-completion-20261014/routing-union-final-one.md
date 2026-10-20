# Independent canonical routing-union final source review

2026-10-14. Actual checkout: `/tmp/gridex-ops-final`; inspected working postimages against HEAD `f13bb4f30766dfdc76dc25b5b234a6dfc31be85e`. This is the newly integrated canonical six-file routing union, not an unchanged third review of the earlier private proposal.

**Bounded verdict: source CLEAR for the actual quote routing union.** No concrete blocking counterexample found for the current descriptors, source bytes, boundaries, or consumer wiring. Earlier conflicting-identity and intervening-source defects are corrected in the canonical helper/clean-replay postimages as described below. This is source approval only; no native, GEN, CI, database or full replay qualification is asserted.

## Exact reviewed postimages

| Canonical path | SHA256 |
|---|---|
| `scripts/gridex-aud-003-clean-replay.sh` | `7c2ab100784fe3aab8ee8a350254e272adbfb96aad04f2a61d199a5d7cc0c8cb` |
| `scripts/gridex-aud-003-legacy-foundation.additions.json` | `7a3cfad2dcccb999517874b743e4184ef3d08d1c4cbf85c4eb617fef7d6d7b83` |
| `scripts/gridex-derived-replay-inputs.py` | `f198a4e7cd800f4faa9629a9a34ae99d003f637613eb3831d77449d9595acb6c` |
| `scripts/gridex-ediel-upgrade-inputs.py` | `2286b227e967c9686c7e0541397c2fcb5814de5e1a02c5d5286bd17314e3c5de` |
| `scripts/gridex-ediel-history-union-inputs.py` | `4005c1ad9d0b52596e4f5bc52e009c68cbfc3d923f9ffe5e7d844c58f45d5750` |
| `supabase/bootstrap/20261013_ops_quote_nonexpiring_replay_adapter.sql` | `3afea47b4343c5d5e6d97a4f709bccf5c8cf6f7cf33c179f022629ff4d7c481b` |

Direct byte comparison proves canonical helper, both builders, and SQL adapter are exactly the independently reviewed final private source versions. The full canonical clean replay is byte-identical to `/tmp/gridex-ops-replay-review-20261014/clean-replay-source-proposal.sh`. Parsing the actual additions JSON and constructing expected HEAD plus the proposal's one interleaved row and one derived descriptor proves the entire additions object is exactly additive, with all prior descriptors preserved. Current canonical tracked diff was read completely for these paths; untracked helper and adapter were included by direct source and byte comparison.

## Actual execution/source chain

- Canonical clean replay now rejects simultaneous conflicting `source`, `sourceKind`, `artifactSha256`, or `sourceSha256` declarations before descriptor enrichment. It retains omitted prior identity pins. The four existing same-source/same-artifact additions that add `preserveSourceReplay:true` remain legitimate compatible enrichments; the new descriptor does not touch them.
- The new quote descriptor explicitly binds original `migrations/20261013093906_ops_api_website_quote_nonexpiring_policy.sql` to adapter `bootstrap/20261013_ops_quote_nonexpiring_replay_adapter.sql`, declares `preserveSourceReplay:false`, and records the exact source/artifact hashes above. Clean replay's newly added explicit sourceSha256 comparison augments its existing canonical manifest/actual-byte source check. The adapter is inserted between93621 and93922 by existing interleaved routing; original93906 is omitted from execution, without changing original history or inventing a ledger row.
- The upgrade builder now imports the helper from its actual canonical sibling path, which exists. History-union imports that actual strict upgrade module and takes its `_replay` object. Both inspect committed canonical manifest/source bytes before selecting only genuinely absent, non-excluded inputs. The helper reads both routing plans and artifacts from the pinned candidate revision, not mutable workspace substitutes. Existing historical checks and earlier-source provenance constraints remain unchanged.
- The final helper rejects conflicting descriptor identities before skipping preserved/live declarations, and rejects more than the exact substituted source inside a selected interleaved interval. All three actual canonical migration manifests contain exactly93906 strictly between93621 and93922. Therefore original sorted source placement and clean insertion immediately before93922 coincide in this exact union.
- Neither93621 nor93922 is a noncanonical exclusion or a direct migration foundation entry in the actual plans. Neither endpoint is a skipped derived source under the reviewed declarations. Current quote93906 likewise is not noncanonical/foundation. Thus the previously noted endpoint-applicability limitation does not produce a counterexample for these actual source inputs.
- Materialization writes adapter bytes to the input basename, retains original bytes separately, and preserves canonical `sha256`/`sourceSha256` alongside actual `executedSha256`. Actual unchanged shell consumers invoke the canonical builders, then execute their materialized `.list` files with `psql -f`. They do not compare adapter bytes to the old canonical sha256; no wrong-digest consumer failure is introduced. Their existing materialization-to-execution lack of a fresh digest check remains a documented limitation, without a demonstrated mutation or race.
- Actual original published quote SQL is byte-identical to HEAD and SHA256 `7eceae42dccce7a968182d144389329d1c11466bf0c896afff62250950f9f2ce`, exactly matching current canonical manifest and new descriptor. Canonical bootstrap adapter is byte-identical to the already reviewed/qualified source proposal; this reviewer did not re-run SQL or substitute new runtime evidence.

## Verification and boundaries

Read-only source checks performed freshly: complete scoped `git diff`, status, exact five postimage/proposal byte comparisons, additive JSON equality, all six hashes, original SQL vs HEAD byte equality/hash, complete three-manifest interval calculation, actual foundation/noncanonical endpoint/source inspection, relevant unchanged consumer calls/loops, complete Python AST parsing for all three actual canonical Python files and clean replay's first embedded Python segment, `bash -n` on canonical clean replay, and scoped `git diff --check`. Source/syntax checks succeeded. No helper/builders were executed and no unit tests, database, GEN, CI, refs, network publication or shared writes occurred. Only this private report was written.

Local project review/find-bugs/differential-review/false-positive/source-verification skills continue to apply. No production SQL behavior is newly qualified by this routing review. Parent reported the six exact resources' explicit current authorization and ownership acquisition; this read-only reviewer neither acquired/released nor modified custody refs.

The checkout contains unrelated tenant and documentation work; those files were excluded from this verdict. The builders intentionally read committed candidate Git objects. Consequently this approval binds the exact postimage hashes above; qualification should use a candidate commit containing those postimages, not infer new routing from the current working files while HEAD still contains the old plans. Broad endpoint applicability, unrelated future interleaved adapters, tenant behavior, independent SQL qualification and exact final merged-head gates remain outside this bounded source approval.
