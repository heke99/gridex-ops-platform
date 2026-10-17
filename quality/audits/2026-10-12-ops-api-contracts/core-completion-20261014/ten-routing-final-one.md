# Source-position replay routing — independent final review

**Verdict: REQUEST CHANGES for fail-closed builder consistency; current two descriptor identities and execution positions are correct.** No SQL/native/GEN/tests/CI or producer invocation was performed. Only this report is written. Review observes working changes over HEAD `6b3a51b2f84ea6dfaed6559a877d6db3c8130f77`; no custody/ref or publication action was taken.

The catalog adapter SHA `1c2bdd4276b99f15d838a80adb1bb63def487e8db2e31405e5821264f4a7c5d9` and SC031 terminal effect adapter SHA `29a8213426de1eeb0be2ed29976846aef1622239347f269325f0005a9ea97e55` equal the independently approved private proposals. Their implementation approval is reused from `remaining-replay-proposals-final-one.md`; this review does not repeat it or create new native acceptance.

## Confirmed blocking routing gap

**ROUTE-SP-01, P2:** source-position declarations do not fail closed consistently across the three input builders.

1. `scripts/gridex-derived-replay-inputs.py:63-65` silently skips a source-position descriptor without `source`. The preceding mode/kind/preserve checks do not require a source. Clean replay instead calls `validate_derived` and refuses a missing original. A declaration `{execution:sourcePosition, sourceKind:timestampedMigration, preserveSourceReplay:false}` lacking `source` therefore survives shared resolver configuration validation and supplies no substitution. The same shared resolver also lacks the clean builder's exact timestamped filename validation before selecting the source.
2. Upgrade removes noncanonical exclusions from additions before calling `substitutions` (`gridex-ediel-upgrade-inputs.py:90-92`). History union similarly passes `set(additions)-excluded_names` (`gridex-ediel-history-union-inputs.py:217-219`). The resolver then skips every unselected source at line 70. A source-position descriptor whose original overlaps a checksum-qualified noncanonical exclusion is silently ignored by both builders, whereas clean replay explicitly refuses that overlap. No malicious database input is needed; these are contradictory configuration declarations that the requested fail-closed admission should detect.

These are control-flow source proofs, not test results. Current two descriptors do not exercise either malformed state, so no current terminal-effect omission is alleged. The issue is the new execution-mode validation contract and three-builder consistency.

**Bounded correction:** require a source-position descriptor's nonempty safe `migrations/<14digits>_<name>.sql` source before the optional source/selection skip. Pass checksum-qualified excluded names into the shared resolver and explicitly refuse overlap before the selected-name skip, or perform equivalent shared pre-selection descriptor validation in both callers. Preserve legitimate skipping for valid, already-applied originals that are absent from an upgrade's additions. Do not loosen historical noncanonical exclusions or fabricate an adjacent boundary for the terminal source.

## Verified correct portions

- The additions manifest introduces exactly two `execution:sourcePosition` entries with sourceKind timestampedMigration and preserveSourceReplay false. Catalog original104143 and adapter1c2b identities are separate; terminal effect original113214/a2a7 and adapter29a8 identities are separate. Neither is declared foundation or interleaved. Existing prior entries and enrichments remain unchanged in the inspected diff.
- Source positions solve the actual chronological constraints: catalog104143 needs no bracket containing already-substituted expiry105521; terminal113214 needs no nonexistent later boundary.
- Clean uses `(logical original filename, executed artifact path)` pairs. Canonical sorting and interleaved boundary lookup use original timestamp names, while execution writes artifact paths. Thus a bootstrap filename cannot shift either original's logical timestamp position. Its original-present, duplicate-source/skip overlap, checksum and noncanonical overlap checks refuse incompatible declarations.
- Shared resolver accepts only None or sourcePosition execution modes; duplicate declaration identity includes execution. New mode rejects foundation/interleaved dual declarations, wrong kind and preserveSourceReplay other than false. Selected source identities are pinned against immutable manifest SHA and actual committed bytes; artifact bytes require their independent SHA. Duplicate selected sources refuse.
- Upgrade and history union materialize under original filenames. Rows retain original `sha256/sourceSha256`, separate `executedSha256/executedSourcePath`, preserved original source bytes, and explicit `ledgerClaim:NONE`. They do not relabel an adapter as the historical original or an externally observed deployment ledger. Existing source sorting supplies the intended logical position for these valid declarations.
- The adapter/manifest writes do not modify historical migration or sealed module bytes. Prior source-only preflight counts supplied by root are not independently re-executed or promoted to native acceptance here.

## Exact reviewed postimages

| File | SHA-256 |
| --- | --- |
| `scripts/gridex-aud-003-clean-replay.sh` | `9ba3dfba7995f70172683f759b0108a268cdd954075a634c274d8b71b5d2bc7b` |
| `scripts/gridex-derived-replay-inputs.py` | `8c8e47f5ac9c8054ce55a1246bdf6a279836b7b254a57ff9ea8ceadca4e0e02e` |
| `scripts/gridex-aud-003-legacy-foundation.additions.json` | `6dfdeeaa83809bc29d60a7460adb628631e91275928db9018d7309fde6e7e996` |
| `supabase/bootstrap/20261013_ops_permission_catalog_replay_adapter.sql` | `1c2bdd4276b99f15d838a80adb1bb63def487e8db2e31405e5821264f4a7c5d9` |
| `supabase/bootstrap/20261014_ops_atomic_bb0b_sc031_replay_adapter.sql` | `29a8213426de1eeb0be2ed29976846aef1622239347f269325f0005a9ea97e55` |

Read-only evidence: current exact diffs, clean routing/preflight source, complete shared resolver/materializer source, upgrade/history-union selection/exclusion/materialization call chains, fresh sha256sum and git status. No malformed-input executable probe or repository script was run. Root's memory file and existing `scripts/__pycache__` changes are outside this review and were not edited. Approval requires fresh review of the bounded correction's exact postimage.
