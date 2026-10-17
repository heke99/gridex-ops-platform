# Independent second source review — descriptor provenance merge and execution-order guard

Verdict: no blocking finding in the new narrow merge fix. SOURCE ONLY; no replay, full-history, native, database, CI, producer or delivery PASS is asserted.

Reviewed against repository HEAD `d086941e288c9062d153b7652c3ca1d4077d3aa4`. The two proposed routing files were uncommitted modifications; shared canonical scripts were read only and remain owned by C2. Only this private review document was written.

## Exact reviewed bytes

- Proposal `gridex-derived-replay-inputs.py`: SHA-256 `f198a4e7cd800f4faa9629a9a34ae99d003f637613eb3831d77449d9595acb6c`.
- Proposal `gridex-aud-003-clean-replay.sh.patch`: SHA-256 `c1c654766d711757d4c04837b5768bdc618f47279724f751090005840de46569`.
- Private full patched shell `/tmp/gridex-ops-replay-review-20261014/clean-replay-source-proposal.sh`: SHA-256 `7c2ab100784fe3aab8ee8a350254e272adbfb96aad04f2a61d199a5d7cc0c8cb`.

The diff between the canonical shell and the private shell contains exactly the descriptor merge and explicit original-source checksum check represented by the proposed patch.

## Evidence and reasoning

The former helper `derived.update(...)` and shell top-level dictionary unpacking replaced an entire earlier descriptor when the same artifact path appeared in additions. That allowed a conflicting explicitly supplied source, source kind or hash to supersede the earlier declaration, or an omitted earlier explicit source pin to disappear. Subsequent byte checks validated the replacement descriptor rather than establishing consistency between declarations. This is a source-provenance ambiguity, not evidence of an actual malicious or conflicting committed plan.

Both new implementations inspect descriptors before replacement, reject non-dictionary descriptors and compare every jointly present identity key: `source`, `sourceKind`, `artifactSha256`, `sourceSha256`. A disagreement raises before substitution selection in the helper, or before SQL execution in the clean-shell path. Therefore neither `preserveSourceReplay` nor the verified-live-schema branch can bypass an explicit cross-plan identity conflict. The shallow `{**previous, **meta}` merge retains earlier omitted identity pins while admitting compatible descriptor enrichment. Explicit missing-key enrichment remains permitted; the fix does not assert that every declaration must independently supply every key.

The real plans contain 26 base and 46 additions descriptors, with exactly four shared paths:

- `bootstrap/20260611_grid_owner_information_request_foundation.sql`
- `bootstrap/20260613_powers_of_attorney_customer_site_foundation.sql`
- `bootstrap/20260618_customer_application_workflows_foundation.sql`
- `bootstrap/20260724_customer_application_continuation_schema_foundation.sql`

For all four, `source` and `artifactSha256` agree exactly, while additions intentionally add `preserveSourceReplay: true` and explanatory purpose. Neither side supplies conflicting `sourceKind` or `sourceSha256`. The new merge retains the additions' true flag, so the helper still skips substitution for these sources and the clean shell still preserves their chronological source replay. Blanket rejection of duplicate descriptors would have broken these real compatible declarations; this fix avoids that regression.

Read the complete helper and the full affected clean-shell path, including checksum validation, foundation/interleaved resolution, preservation/exclusion decisions, preflight output, execution and ledger boundaries. The helper retains canonical source checksum validation, committed artifact checksum validation, declaration and boundary checks, original byte preservation, separate executed hash and no-ledger claim. The clean shell retains its source manifest pin and now also checks any explicit `sourceSha256`. Foundation ordering, interleaving, preserve-source behavior, noncanonical exclusions and ledger handling are otherwise unchanged.

Read both proposed builder callers' selection/materialization paths as context: the merge fix introduces no caller signature or output-row change. Builders continue supplying committed HEAD and checksum maps and invoking substitutions before creating materialized outputs. No broader builder or historical provenance approval is implied.

## Final execution-order guard review

The final helper adds three lines after the existing selected-source and endpoint boundary checks. It collects all checksum-manifest basenames with a 14-digit version strictly inside the declared open interval and requires that set to equal `{name}`. Thus a selected source alone is accepted; any additional canonical basename, including a same-version collision, causes `ambiguous_derived_replay_execution_order` before materialization. This is conservatively fail-closed even if an additional source might later be excluded; it does not attempt an unsafe equivalence inference.

The source reason is concrete: clean replay inserts an interleaved artifact immediately before the declared upper endpoint, while upgrade/history-union materialization replaces the selected original source at its chronological position. Another intervening migration could otherwise execute on different sides of the adapter. Requiring the selected source to be the sole canonical basename inside the interval removes that differing-order opportunity for canonical timestamped sources. This narrow guard does not claim equivalence of every other clean foundation, prerequisite or historical execution effect.

Independent metadata inspection of all three actual checksum manifests found exactly these interval entries: lower endpoint `20261013093621_ops_api_signing_stockholm_withdrawal_deadline.sql`, sole interior `20261013093906_ops_api_website_quote_nonexpiring_policy.sql`, and upper endpoint `20261013093922_ops_api_atomic_interval_pricing_snapshot.sql`. The proposed descriptor selects the sole interior source, pinned to `7eceae42dccce7a968182d144389329d1c11466bf0c896afff62250950f9f2ce`. The guard therefore preserves this concrete proposal by source inspection. No new blocking source finding. This report binds the final helper SHA listed above; the earlier helper SHA is superseded. Shell patch and private shell hashes remain unchanged.

## Routing and limitations

Applied local code-review and differential-review guidance for narrow source comparison; used direct source/data-flow verification equivalent to false-positive checking for the stated overwrite defect; applied verification-before-completion by limiting conclusions to observed source evidence. Database/security scanner, runtime, generator, UI, performance and delivery workflows were not activated because this assignment authorizes only a bounded read-only source review. No extra agents were launched.

Evidence commands were read-only source reads, `git rev-parse HEAD`, `git status --short`, scoped `git diff`, canonical-versus-private `diff -u`, metadata JSON inspection, reference search and SHA-256 calculation. The ordinary `diff` command returns 1 because the expected changes exist; that is not a test failure. No helper execution, tests, generated fixtures, SQL, database, native capture, CI rerun, ref changes, publication or source writes occurred. Latest remote issue receipts and full history were not collected; the explicit parent handoff sets this reviewer’s narrow authority. Runtime rejection behavior and end-to-end replay remain unexecuted here. Any change to the reviewed bytes requires renewed review binding.
