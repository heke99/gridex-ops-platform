# Codex main merge window — 2026-10-05

Owner: root coordinates review and merge; this packet records only the seven Codex deliveries below. Fixed main snapshot `37b06fd31d91b23671c6f62fd459b6eb7635d605`, tree `59c478ef38697b72ba63a8af7cbc9c360516ae25`. Other merged PRs in the intervening main history are outside this packet.

| Merged PR | Approved IDs | Actual merge commit |
| --- | --- | --- |
| [#561](https://github.com/heke99/gridex-ops-platform/pull/561) | SC-051, SC-068 | `faddfdccb214305330e408a06c0f1d5a8c96896b` |
| [#508](https://github.com/heke99/gridex-ops-platform/pull/508) | ENV-02, AT-ENV-02 | `a24885d52275f832307329b92bcfaef95fca8cb2` |
| [#526](https://github.com/heke99/gridex-ops-platform/pull/526) | IMP-03, AT-IMP-03 | `b817c1f19d4c8322d1e80c840406ddf12557d8b2` |
| [#512](https://github.com/heke99/gridex-ops-platform/pull/512) | ENV-10, AT-ENV-10 | `826779dd798e81c0f2a0a854fb3cb810ddbc5598` |
| [#514](https://github.com/heke99/gridex-ops-platform/pull/514) | ENV-07, AT-ENV-07 | `82eccf0bbd1262f9d18b5f0da21cc7c06fd94c26` |
| [#513](https://github.com/heke99/gridex-ops-platform/pull/513) | SC-041 | `fd429e5dc042a01a2fd86ccf9875b31dc5e212c7` |
| [#522](https://github.com/heke99/gridex-ops-platform/pull/522) | GOV-05, AT-GOV-05 | `37b06fd31d91b23671c6f62fd459b6eb7635d605` |

Each retained source guard matches the actual merge first parent, merged head and resulting tree. A fresh Git comparison confirms that only its listed coverage rows changed; every other row, metadata field and order is preserved. Existing qualified tests were reused; no product tests were repeated for this documentation.

At this snapshot the ledger has **100 VERIFIED / 16 NOT_VERIFIED / 5 PARTIAL rules** and **148 PASSED / 67 NOT_EXECUTED / 16 PARTIAL acceptance contracts**. These are recorded ledger counts, not a whole-plan, market or production-readiness claim.

| Withdrawn draft | Preserved branch | Distinct proposal retained |
| --- | --- | --- |
| [#529](https://github.com/heke99/gridex-ops-platform/pull/529#issuecomment-5999559825) | `claude/imp-02-imp-03` | IMP-02/03 registry normalization and reviewed apply |
| [#537](https://github.com/heke99/gridex-ops-platform/pull/537#issuecomment-5999585173) | `claude/gov-05-gov-06` | GOV-05/06 policy and tests |
| [#538](https://github.com/heke99/gridex-ops-platform/pull/538#issuecomment-5999562870) | `claude/db-01-pr1-expand` | DB-01 communication-route expansion |
| [#540](https://github.com/heke99/gridex-ops-platform/pull/540#issuecomment-5999588310) | `claude/gov-01-rule-metadata` | GOV-01 normative rule metadata |
| [#542](https://github.com/heke99/gridex-ops-platform/pull/542#issuecomment-5999565659) | `claude/db-02-tenant-fk-inventory` | DB-02 tenant-FK inventory and workflow |

All five drafts were closed without merge and their remote branches still point to the exact recorded heads. The retained source comparison is explicitly against main `82eccf0bbd1262f9d18b5f0da21cc7c06fd94c26`; it contains distinct source proposals. This packet does not call those branches source-equivalent to snapshot `37b06fd3`, and does not approve or reapply their changes.

Machine evidence and byte-exact original receipts: [`delivery-proof.json`](../quality/audits/ediel-masterplan-v2/main-merge-window-codex-20261005/delivery-proof.json). Fresh JSON, actual Git parent/tree/ledger checks and original specification integrity (33 files, 121 rules, 231 contracts) pass. Source code, coverage, frozen specification and central memory files are unchanged.

Next: root reviews and merges this docs PR. Agents start further work from the actual latest main, retain existing owner claims and consult #530 before taking an unowned part. This document remains a fixed historical snapshot when main advances.

## Later delivery continuation — fixed main 38aa7345, 2026-10-05

The entire original seven-delivery snapshot above remains byte-exact. Eight later actual deliveries are recorded additively: #607, #603, #609, #541, #515, #531, #517 and #547. Fixed main is 38aa73454b724040f6aaf4339e7feab226ce3ecd, tree 64c93f935436a0c30db27fb86b5451d414984116.

Fresh local metadata checks validate all 16 original final gate/delivery JSON receipts, actual merge parents/trees/ancestry and nine retained root-qualified job/run/workflow bindings per source head. No CI, tests, native runs, capture or artifacts were repeated. All other main file modes, types and blobs remain unchanged.

At this fixed snapshot the ledger contains **108 VERIFIED / 10 NOT_VERIFIED / 3 PARTIAL rules** and **163 PASSED / 54 NOT_EXECUTED / 14 PARTIAL acceptance contracts**. These counts are stored implementation statuses, not all-rule, production or full-main GREEN qualification.

#520/#610 correction qualification remains pending; #533/#535 joint current-main capture and final gates remain pending with the sole writer; #599 remains held. Existing owners and prior full-card/native source boundaries remain intact.

Exact receipts, source-bound counts and SHA index: [continuation-20261005/README.md](../quality/audits/ediel-masterplan-v2/main-merge-window-codex-20261005/continuation-20261005/README.md).

Next: root independently reviews and publishes this one metadata ref, then the retained common writer adopts it. No competing PR, tag or common handover is created by this worker.

Prepared continuation: root-delivered #564 merge 5cde8094 / source d057d3e7 has 8 applicable successful gates; targeted is excluded, not PASSED. Genuine incoming main 2964415a is preserved; external #608 and closed-unmerged #610 are not our deliveries. Older receipts/history/hashes remain exact; await #520 final receipts before one reviewed documentation publication.

Final documentation package: #564 is the actual sixteenth root delivery (8 applicable successful gates; targeted excluded, not PASSED). External #608 supplied the first incoming-main fixture correction; #610 was author-closed unmerged. #520 head 17c37e1d is public/source-approved; public5206002840428 confirms all nine jobs exist, smoke SUCCESS, coverage CANCELLED without failed-step, upgrade executing and others pending. Final gates are NOT_VERIFIED, merge HOLD, individual canceled-job cause UNKNOWN. Official Actions status reports major_outage / investigating; the incident is not proven as an individual job cause. #594 stays NO_MUTATION per public5946002735541. Counts remain source-qualified 108/10/3 rules and 163/54/14 acceptance. Four existing bounded status receipts and all old raw/history/prefixes are preserved. One local two-parent documentation union awaits root independent guard/publication; no push by this worker.
