# PR #372 independent review — 2026-09-25

Reviewer: `/root/pr372_review`, a separate read-only agent. Reviewed published
head `16505294fbcb4851c2b550c27b03f16f3f7d4a6a`, tree
`854713c64347074a42fb7adb4d34c7ccd4e2ac79`, against main
`2a148d39d631fc759c99cd1c69350b5e2147dbdb`. The review covered the
repository instructions, acceptance plan, whole-diff inventory, and critical
SQL, TypeScript and native-test paths. It was not an exhaustive line-by-line
audit of every changed file and did not execute native tests.

**Verdict: REQUEST CHANGES. No merge approval.**

| Finding | Evidence | Required closure |
|---|---|---|
| R1: unrelated tenant source and concern volume can consume the combined budget | `selection_body_v2` counts tenant sources before limit 1001 and `combined_concern_body_v1` counts all tenant concerns in `20260924120822_e035_combined_correction_snapshot.sql`; `open_combined_v1` in `20260924221000_e035_combined_subject_scope.sql` still calls both. | Scope before count/limit, retain unknown links, then verify a linked inbound UTILTS with more than 1,000 unrelated sources and concerns. |
| R2: earlier physical point identifiers may disappear | New combined reader passes only the current `metering_points.metering_point_id` to process, outbound and document filters. An alias change can exclude older immutable facts associated with the inbound wire. | Use validated subject identities and immutable point history; exercise an actual alias change and relevant older facts in native replay. |

The reviewer initially suspected that the canonical link was only held in
memory during `processInboundUtiltsMessage`. After tracing the awaited
`linkEdielMessage` database update, the reviewer **retracted** that claim for
the normal linked path. Truly unresolved links remain conservatively unknown.

The inbound hold fixture on this head invokes the processor and checks a saved
receipt and no metering call; its volume fixture covers process facts for an
already linked subject. These are bounded claims, not acceptance of R1/R2 or
remaining signed and legacy producers and retention.

Subsequent OPS run `36105666765`: verify and quality/build passed. Clean replay
applied the migration and ran 324 native tests in five files: 322 passed, two
new assertions failed. The hold path created an allowed transport-level CONTRL,
so its test's blanket `ackIds:[]` expectation was wrong. The success path omits
the optional `internalReviewRequired` field, so its `false` expectation was
also wrong. These fixture assertions have been corrected locally; the next
commit needs its own native replay. The review's two blocking findings remain.
