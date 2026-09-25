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

## Follow-up status, 2026-09-25

This is implementation tracking by the author, **not an independent re-review**.
The source/concern scoping forward `20260925072500` was published at
`8e7c6268` (tree `d32e3d5d`). OPS `36106857700` passed verify and
quality/build; clean replay applied the migration, then native ran 323/324.
The sole failing 1,001-row fixture reached the actual inbound processor but
found null `receivedStructureQualification.snapshotId/readsetHash`. This does
not establish R1 closure. A direct service RPC budget probe was added for
failure isolation.

The historical alias forward `20260925090000` and old-alias native regression
were published at `66b12f9` (tree `7e845683`). It derives aliases from
immutable old/new metering-point facts and the verified subject wire before
calling all five owner readers. Local script typecheck, lint, migration
integrity, generated-type manifest and diff check passed. OPS `36107605706`
clean replay remains pending. R1 and R2 remain **REQUEST CHANGES** until
native evidence and the independent reviewer inspect the final whole diff.

OPS `36107605706` at `66b12f9` applied the historical alias migration and
passed 325/325 native cases in five files, including the volume and alias
fixtures, plus case/browser continuations. Verify and quality/build passed.
Clean replay's final canonical schema check failed only because the committed
schema snapshot was older: actual fingerprint `df38a442` vs `5e3db200`, with
five added private functions/grants. Artifact `10851567749` ZIP SHA256
`a67a97d8b779d361a1f90046f0bbc17d30b13162819c759f56eba1c4f2d38849`
was downloaded and checked; generated types match the tracked SHA256
`2b2dda6a`, and schema diff contains only 209 added function lines plus
fingerprint function/grant sections. This is not final-head approval.

The volume test's newly added direct service RPC ran **before** the actual
processor and could warm its source parse. Because the previous cold processor
saved no receipt, the next forward materializes an immutable, conservatively
nullable source wire point at insertion; the test moves the direct diagnostic
after the actual processor. Cold native replay remains required before R1
closure. The independent review remains REQUEST CHANGES.

Independent reviewer `/root/pr372_review` followed up read-only on published
`e27e3403` / tree `5a2c7e12` and found a new blocker: its generated source
point parser recognized only Z04/Z05, while the same sealed ledger captures
single-object Z06/Z10. More than 1,000 unrelated Z06/Z10 rows could still
consume the source budget as NULL wildcards. The reviewer did not inspect
uncommitted changes or perform the final whole-diff review.

OPS `36108754412` on `e27e3403` passed verify and quality/build, and its clean
replay passed 325/325 native in five files with the **cold processor first**.
The 1,001 unrelated Z05 sources/concerns and process rows no longer prevent
its saved receipt or meter persistence. Final schema check failed only on
expected canonical drift: one generated column, one index, six private
functions/grants, fingerprint actual `30856133` versus committed `5e3db200`.
This qualifies the cold Z05 budget behavior, not the new Z06/Z10 or document
volume cases. The next forward rebuilds the stored parser projection for
Z06/Z10 and the next native fixture adds 1,001 of each supported source class
across a mixed batch, plus 1,001 unrelated document attempts. Review remains
REQUEST CHANGES until those cases and final whole-diff review pass.
