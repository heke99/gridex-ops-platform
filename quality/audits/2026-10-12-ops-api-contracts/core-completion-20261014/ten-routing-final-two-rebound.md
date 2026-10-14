# Independent current seven-file routing review

2026-10-14. **Approved for bounded source review; no confirmed P1/P2 remains in the reviewed correction.** Workspace `/tmp/gridex-ops-final`, base HEAD `6b3a51b2f84ea6dfaed6559a877d6db3c8130f77`. These are current working postimages, not a claim that the base commit contains the changes. The earlier five-file report remains historical; this receipt replaces its applicability to the modified routing bytes.

| Current file | SHA256 |
| --- | --- |
| `scripts/gridex-aud-003-clean-replay.sh` | `be69a4dad9e979a0fe5a6d96e908d6c461063d8f2a047fab9864fd9ba7def81a` |
| `scripts/gridex-derived-replay-inputs.py` | `05e498eae301d2400aca76011d1fcc625717e7c4043b827e2bc5468e198a7cb2` |
| `scripts/gridex-ediel-history-union-inputs.py` | `c0019870478de4b2cf78f7ccb99a4901e2a8feab0c4c9fa64353cc9deb66ca69` |
| `scripts/gridex-ediel-upgrade-inputs.py` | `1752ca360b6afaf7bfeb6d08423296cb592012f99ab5369588425965116605b3` |
| `scripts/gridex-aud-003-legacy-foundation.additions.json` | `6dfdeeaa83809bc29d60a7460adb628631e91275928db9018d7309fde6e7e996` |
| `supabase/bootstrap/20261013_ops_permission_catalog_replay_adapter.sql` | `1c2bdd4276b99f15d838a80adb1bb63def487e8db2e31405e5821264f4a7c5d9` |
| `supabase/bootstrap/20261014_ops_atomic_bb0b_sc031_replay_adapter.sql` | `29a8213426de1eeb0be2ed29976846aef1622239347f269325f0005a9ea97e55` |

I independently read the actual four routing/caller diffs and computed all seven current hashes. No tests, SQL, engine, native/backend, GEN, CI, network, canonical changes or producer execution was performed. Only this report was written.

The consistency correction moves source-position source validation ahead of the selected_names omission and preserve/live-schema skip in the shared helper. It calls `_safe` on the required source, requires exactly two path components with migrations/ prefix, and requires a complete 14-digit timestamped SQL basename. Null/missing source, alias/subdirectory/unsafe paths and non-timestamped filenames therefore refuse even when they would previously have escaped through omission. Wrong source kind, dual declarations, wrong preserve flag and unknown modes still refuse before selection.

The shared helper now accepts excluded_names and explicitly rejects source-position original overlap before the selected_names skip. Both actual callers pass their locally classified exclusion sets: strict upgrade after exact checksum/classification checks and removal from additions; history union after its existing noncanonical source classification. Thus an excluded pending source cannot silently hide a source-position declaration. Existing committed byte/hash checks, duplicate selected-source refusal, artifact path/pin validation, original-copy preservation and separate source/execution SHA/paths remain unchanged after this correction. Valid substitutions outside a caller's pending window still deliberately produce no materialized input; that is not a claim to validate artifact execution for an unselected window.

Clean's new exact `migrations/\\d{14}_[^/]+\\.sql` full-path requirement prevents nested migration aliases from being reduced to a pinned basename by the existing resolver. Its checksum/presence/overlap checks and original logical filename boundary placement remain as reviewed. The two source-position declarations and the original source hashes are unchanged. All previous descriptor sections are preserved; both adapters retain exactly the already independently reviewed private SQL bytes and assessment from `remaining-replay-proposals-final-two.md`.

The prior finite incoming-main/runtime preservation checks remain applicable: this correction changes only the four routing/caller source files above, while descriptor/adapters remain at the prior approved hashes. No new whole API/native audit is claimed.

This approval is limited to these exact source postimages. It does not establish fresh custody, a committed final candidate, complete selected-input materialization, actual clean/upgrade execution, transactional restore/rollback observations, native qualification, GEN or CI. Those proofs must bind the final current committed source and complete input manifest. No fake migration ledger/history/checksum claim was introduced.
