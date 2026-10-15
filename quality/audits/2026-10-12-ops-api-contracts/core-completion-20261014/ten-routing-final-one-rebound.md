# Source-position routing — independent rebound final review

**Verdict: APPROVE the exact seven-file working postimage union below for bounded SOURCE routing review.** The earlier REQUEST CHANGES remains preserved in `ten-routing-final-one.md`; ROUTE-SP-01 is now resolved by direct inspection of the corrected shared resolver and both callers. No runtime/native replay, source publication, custody acquisition or GEN acceptance is claimed. This review writes only this separate report; no tests, SQL, backend/native/GEN/CI or repository script was run.

Reviewed exact diffs over `/tmp/gridex-ops-final` HEAD `6b3a51b2f84ea6dfaed6559a877d6db3c8130f77`, fresh hashes and the narrowed complete resolver/caller control flow.

## Correction qualification

The shared resolver now receives `excluded_names=()` and, for every sourcePosition descriptor, invokes `_safe(source)` before the optional missing-source/selection skip. Missing/non-string/empty/unsafe source refuses. Its path must have exactly `migrations/` plus one timestamped SQL filename and match the 14-digit filename pattern. This closes the prior missing-source skip and aligns with clean's exact no-subfolder migration-source path check.

The shared resolver checks source-position overlap against `excluded_names` before `name not in selected_names` can skip it. Upgrade and history union now pass their actual checksum-qualified exclusions explicitly, after their existing classification/checksum checks. Their only caller changes are this extra argument. Therefore a contradictory noncanonical/sourcePosition declaration is refused consistently with clean, while a valid already-applied original outside an upgrade's additions can still be skipped normally.

Unknown execution mode, foundation/interleaved dual declaration, wrong source kind and preserveSourceReplay other than false remain rejected. Selected duplicates, original/source digest mismatch, missing actual committed bytes, malformed/missing artifact SHA and artifact byte mismatch retain their existing fail-closed checks. Existing legacy enrichment/identity handling remains unchanged apart from including execution in the conflict identity.

## Seven-file union applicability

Both new descriptors remain exact sourcePosition entries and preserve their independently approved adapter hashes. Catalog104143 uses its original logical timestamp; terminal113214 requires no fabricated next boundary. Clean keeps original source names separate from executed paths for sorting and interleaved boundary selection. Shared upgrade/history materialization keeps original filenames, immutable source SHA/bytes and distinct executed artifact SHA/path with ledgerClaim NONE. Neither original source byte stream nor sealed bb0 executable is rewritten by routing.

The prior approvals of the unchanged adapters are reused from `remaining-replay-proposals-final-one.md`: catalog paired canonical/native shape and exact semantic ACL; terminal effect exact SC031 normalization/restoration around unchanged sealed execution with full-row preservation and atomic refusal. No additional implementation review or producer claim is inferred from that reuse. Earlier verified correct routing portions in `ten-routing-final-one.md` remain applicable to the unchanged plan and bounded corrected logic.

No blocking mismatch remains in this reviewed union. Root's supplied syntax/preflight result is separate evidence, not a run performed by this reviewer. Fresh authenticated claims/custody, normal source delivery and qualified producer verification remain the parent's delivery gates.

## Exact approved SHA-256 postimages

| File | SHA-256 |
| --- | --- |
| `scripts/gridex-aud-003-clean-replay.sh` | `be69a4dad9e979a0fe5a6d96e908d6c461063d8f2a047fab9864fd9ba7def81a` |
| `scripts/gridex-derived-replay-inputs.py` | `05e498eae301d2400aca76011d1fcc625717e7c4043b827e2bc5468e198a7cb2` |
| `scripts/gridex-ediel-upgrade-inputs.py` | `1752ca360b6afaf7bfeb6d08423296cb592012f99ab5369588425965116605b3` |
| `scripts/gridex-ediel-history-union-inputs.py` | `c0019870478de4b2cf78f7ccb99a4901e2a8feab0c4c9fa64353cc9deb66ca69` |
| `scripts/gridex-aud-003-legacy-foundation.additions.json` | `6dfdeeaa83809bc29d60a7460adb628631e91275928db9018d7309fde6e7e996` |
| `supabase/bootstrap/20261013_ops_permission_catalog_replay_adapter.sql` | `1c2bdd4276b99f15d838a80adb1bb63def487e8db2e31405e5821264f4a7c5d9` |
| `supabase/bootstrap/20261014_ops_atomic_bb0b_sc031_replay_adapter.sql` | `29a8213426de1eeb0be2ed29976846aef1622239347f269325f0005a9ea97e55` |

Approval binds these exact bytes and scoped source applicability. Unrelated memory/cache changes receive no approval from this report. Later source changes require a renewed exact-postimage review.
