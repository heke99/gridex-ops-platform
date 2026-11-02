# Independent focused Linux 7.0 source delta review

Reviewer: `/root/review_t3_admission`. Verdict: **APPROVE_SOURCE_ONLY — EXACT TWO-FILE DELTA**. No blocking finding.

Base: `19e7b9fd737bfb8d68fb42ed04cc41873f308a5d`. Candidate: `/workspace/t3-handoff-20261101/qualified-kernel-7-candidate`.

- `scripts/simulation/track3/prepare.py`: SHA256 `8c192346b63235c3e62dd7ad0ebb90ad03470f44caa28be95b135f9f93fb3300`.
- `scripts/simulation/track3/prepare.test.py`: SHA256 `fd25b0c2074ee783210806181076f82e3c65426205fb516bcc729170a819f56b`.

I inspected the actual two diffs against the base worktree. The production change adds only `(7, 0)` to the existing 6.8–6.18 family set, with explanatory immutable source citation. Release syntax parsing, actual diagnostic release retention, FD/type/magic/initial inode and current-process checks, global root and mount/device checks, complete v1/v2 ancestry and CPU quotas, EOF bounds, repeated observations and capacity floors are unchanged. This is not approval of a versionless gate.

I read the qualification note and source-verification record. Independently recomputed all twelve provided official-source original byte lengths, SHA256 values and canonical Git blob identifiers against `qualified-kernel-7-source/manifest.private.json`; all match. The record binds torvalds/linux immutable commit `028ef9c96e96197026887c0f092424679298aae8`. These are supplied immutable source/provenance records, not an independently observed running kernel binary. Provider tag signature is unknown_key; no GPG signature verification is claimed.

I inspected the actual refactored initializer and allocator chain: cgroup.c initializes the initial namespace with NS_COMMON_INIT; ns_common.h assigns typed ns_type/inum; ns_common_types.h maps cgroup to CLONE_NEWCGROUP and CGROUP_NS_INIT_INO. UAPI retains initial inode 0xEFFFFFFB and NS_GET_NSTYPE; nsfs returns ns_type and exposes ns->inum with NSFS_MAGIC. Noninitial cgroup namespace creation calls ns_common_init(new_ns), which passes zero for the inode; kernel/nscommon.c then calls proc_alloc_inum. fs/proc/generic.c allocates from 0xF0000000, disjoint from the reserved initial inode. This supports continued use of the unchanged real FD proof; release text alone grants no namespace proof.

Independently ran `python3 -B scripts/simulation/track3/prepare.test.py` in the candidate: **40/40 PASS, exit 0**. The new exact observed `7.0.0-1017-azure` positive exercises the existing full finite FD/hierarchy path. The same label still rejects wrong FD and ancestry conditions. The amended outside-family/malformed cases reject 7.1, 7.99, 8, truncated and malformed versions; existing negative safety cases remain. Finite ports model observations and do not establish actual hosted RAM, kernel binary provenance or native acceptance.

Actual third-run evidence remains HOLD: the previously retained Linux 7.0 label established only the old gate rejection. This source extension supplies no later actual namespace/ancestor observation and does not convert that run into PASS. Backend/scenarios remain NOT_RUN for that run. No fresh host admission, source-event grant, retry authority, native budget, data approval or full cleanup certification follows from this source verdict.

I coauthored an earlier E01 test donor retained in the accepted full packet. This independent review concerns only the two files above, which I did not author; I remain excluded from independent full61/E01 source final review. No actual keys were read, no source files edited, and no services, network events or native operations initiated.
