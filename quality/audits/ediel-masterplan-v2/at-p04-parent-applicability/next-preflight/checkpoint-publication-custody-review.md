# Independent checkpoint publication custody review

Bounded mechanical read-only review, 2026-10-05. No boards, frozen cards or production behavior were re-reviewed; no source module/probe/test, CI, SQL, native stack or GitHub mutation was executed. Receipt JSON was read as custody metadata; compressed snapshot contents were decompressed only for byte/hash/format checks, not read for their substantive board/spec content. Reviewer wrote only this new report.

**Verdict: no actual custody/reference/allowlist mismatch found at the two supplied immutable publication commits.** These documentation checks do not grant a new scenario, production or CI approval.

## Exact publication diffs and ownership boundary

| Supplied checkpoint commit | Parent | Immediate changed paths | Allowed paths | Result |
| --- | --- | ---: | --- | --- |
| SC `3e104be14823e207c8f8f9b3aeb11c0912da9e6d` | `2d0f21108fbc5a4d14825dbbb9bde3ecbaa8fb10` | 39 | Exact own `.agent-memory/masterplan-sc010-sc071-checkpoint.md` and `quality/audits/ediel-masterplan-v2/sc010-sc071/**` | All39 allowed. |
| AT `59ac0804c94d56a90cb234cd610dfc3aa7b33621` | `bbf89d53f62b495739097601133bea30007d5dfb` | 75 | Exact own `.agent-memory/masterplan-at-p04-parent-applicability-checkpoint.md` and `quality/audits/ediel-masterplan-v2/at-p04-parent-applicability/**` | All75 allowed. |

Independently inspected both immediate and cumulative Git object diffs. SC source9b50 → publication3e104 changes59 paths, all in that same allowlist; AT sourcebbf89 → publication59ac changes75 paths, all in its allowlist. Both source commits are ancestors of their checkpoint publications. No product, production SQL, test suite, native config/workflow, shared generated output, frozen register, actual coverage ledger or shared-memory path changes occur in these diffs. The copied `next-pair-scout-main-coverage-*.json` files are owned historical evidence snapshots, not writes to the actual coverage ledger. AT's preserved `next-preflight/p01-217-canonical-probe.mjs` is the already-owned read-only diagnostic artifact; it was not executed here.

These checks verify the immutable supplied Git objects and source carry. No fresh remote PR-head query was needed or performed; the supplied source references remain PR5709b50 and PR591bbf89. This reviewer did not push either source PR or either checkpoint ref.

## Gzip receipt roundtrips and determinism

Checks used publication Git blobs, not mutable uncompressed local snapshots. For every listed compressed entry independently verified: stored byte count and SHA-256, decompressed byte count and SHA-256, gzip mtime0, no original filename header, and exact byte equality to fresh deterministic level9 recompression in memory. No recompressed file was written.

| Receipt family | Entries | Actual checks |
| --- | ---: | --- |
| SC `next-pair-scout-inventory-receipt-20261005.json`, `raw` plus `p04_followup.raw` | 14 | All roundtrips match; all14 exactly reproduce via `gzip.compress(..., compresslevel=9, mtime=0)`. Receipt SHA-256 `dfd5bdfe5dc7558662e58cc1305730624a3176651fb9f95607d6a91beebfdace`. |
| AT `raw-artifact-receipt.json`, `compressed_raw` | 33 | All roundtrips match; all33 exactly reproduce via the same deterministic compression. Receipt SHA-256 `eb51a85359bf7809a55949fe3c193ac84973c414ef3341ac6f56200258eb1b61`. |
| AT `remaining-artifact-receipt.json`, `compressed_raw_receipts` | 20 | All roundtrips match; all20 exactly reproduce via level9 `gzip.GzipFile(filename='', mtime=0)`. Receipt SHA-256 `12ef8f05845b257790696b37b8d43088d948b6321e602ba0aa6039400d61cf8c`. |

Each family has unique stored paths and zero mismatches. Every newly published scout `.gz` path is accounted for by its corresponding receipt. The additional SC `root-503-native.log.gz` is correctly outside the scout receipt: its decompressed SHA-256 is `1308a416c7166a578b2e0420e2467402371b3f70722e7eaf1d33106e45a98e52`, matching `root-503-current-native-qualification.json`'s `artifact_files_sha256['native.log']`; mtime0 and exact deterministic recompression also pass. Thus all67 receipted scout gzip files plus this separate native-log custody file are mechanically qualified.

All11 AT readable-artifact records across the two artifact receipts independently match their published path, bytes and SHA-256. Snapshot semantic validity, completeness/freshness and historical ownership conclusions were not re-audited by these mechanical checks.

## Probe and final report references

Published P01 probe receipt SHA-256 is `b1abcbc44b5db97e02ed7385007c27fabcfa4be157d7a054b7119146afc98935`. All three actual published artifacts match both their receipt keys and the already-published independent P01 report references:

| Actual path in AT `next-preflight/` | SHA-256 |
| --- | --- |
| `p01-217-canonical-probe.mjs` | `dc9407759fe9e6d8f4db3672792cd4361ae689e6d39c0b4fc2036ad94eba204c` |
| `p01-217-canonical-observation.json` | `b5f85ad1f7c44ed6576f5b392dd94588ae78750d57b1e6415150caf296c42539` |
| `p01-217-canonical-probe.log` | `c4fa93627758612f5aa174e4fb75247c290f5506e05c4b75012a8171ae5cca07` |

The final publication metadata points to actual `next-preflight/remaining-acceptance-followup.md` SHA-256 **`b81836992e58dbe9452c17e9d51c13486165e1255fffb3d1af97ba5cb7e9c58a`** and actual `next-preflight/remaining-artifact-receipt.json` SHA-256 **`12ef8f05845b257790696b37b8d43088d948b6321e602ba0aa6039400d61cf8c`**. The final receipt also records the actual b818 report bytes/hash. No stale3316/d049 value is used as the current artifact hash: both are retained under the explicit `historical_pre_whitespace_normalization` field in `publication-and-ci.json:120–123`. This mechanically confirms their historical labeling, not a fresh reconstruction or substantive re-review of that earlier authored version.

The published earlier reviewer files are unchanged from their local reviewed counterparts: SC `root-503-capture-independent-review.md` → `e990289855eba4dd49f8f7b4558e3f73bea7b5e5b5f43bb1a770f0e3e1552e29`; AT `p01-literal-review.md` → `b7f294bd68a23a05312a1dd8b1576f0f6604910e8e7b53629ef0a3f3f5f8af1a`; AT `clean-replay-triage.md` → `1af82f608e952319efba4b1f7db59c1e7fa95e20aaf42367600aaa4414bb7ed6`. Their existing qualifications are preserved rather than upgraded by metadata publication.

## Exact whitespace outcomes and limits

Immediate full SC publication `git diff --check parent head` returns **exit2 with exactly one warning**: owned historical raw `next-pair-scout-main-coverage-498ebd1c.json:3291`, new blank line at EOF. Checking all other38 changed paths returns **exit0**, with no warnings. This matches `root-503-documentation-validation.json`; the full SC check must not be relabeled PASS or the preserved raw bytes normalized by this reviewer.

Immediate full AT metadata publication diff check returns **exit0**, with no warnings. The source PR's earlier raw-console EOF warnings and the authored report's former whitespace findings remain explicitly historical; this new metadata result does not rewrite them. No further fix or mutation is requested from this custody review. Root's actual #503/#591 execution, owner integration and final approval work remain separate.
