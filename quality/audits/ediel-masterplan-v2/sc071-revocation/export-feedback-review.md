# Independent review: SC071 BASE-then-forward caller

2026-10-05. **APPROVE the corrected bounded caller statically.** Exact workflow
SHA256: `24a53b103530fb7600c94d45456aefda673d19c8720eb2e0fdfd1bdcf56361ec`.
No remaining blocking finding. Ten-case experimental native execution remains
**NOT_RUN**; whole SC010/SC071 remain **UNAPPROVED**. This verdict does not
approve runtime, product, CI, admission, capture, parity or merge.

Review began at `4b6e0d037206b04e89ce00a3c64651dd7056df4d`; final read-only
checkpoint is `1de41192a92feed2c4dbff1df37a758a2c23c392`. The intervening17 paths
are foreign review/memory documents; relevant product/SQL/dependency/native
inputs have empty diff. BASE remains authentic main
`7b9218da2c7f71f4373bcc9189715c0043a8cb31`, tree
`f03ec10bec420c9013848be526595c5fbb0242b7`. Producer is immutable
`824e5f53c9a115e3f423d3e2e5ba13b41001bdb9`. Source-owner handoff5993124044 and
board5993188414 were independently read and retain coordinator final gates.

## Resolved P2

Initial workflow `8f4bd1e62e690a0c1a854f0550b04709709c873591e00ad6220b92427ba3228c`
received **changes requested**: its optional JSON reader raised on an empty
redirected ledger file after a failed psql read, preventing parent receipt,
redaction and failure-artifact promotion. Child canonical cleanup still ran.
The reviewer reproduced the finite empty-JSON parse failure without a database.

Corrected lines218–251 catch OSError/ValueError, record error types, return None
and parse all optional evidence before qualification. PASS requires no parse
errors, an exact BASE SHA/completed/48 receipt and four readiness records;
lines268/280 preserve diagnostics and fail incomplete evidence. **P2 resolved
at24a53b10.** Parent records seven finite controls, including empty-post-ledger
and malformed-BASE receipt; their current workflow/descriptor hashes match.
Those controls are orchestration evidence only.

## Checked boundaries and limits

The separate child uses a detached BASE checkout, compared package/lock files,
fixed BASE CWD and the unchanged unconditional canonical source/EXIT cleanup
(lines78–118). BASE replay evidence is attributed only to BASE. Six producer
inputs are extracted/hash-checked; the one-path owned patch must transform
registered6407877 into effective33b7d52a; config is separately pinned
(lines121–149). Sole SQLd0e4 stays in RUNNER_TEMP and uses actual psql on that
same stack after BASE replay. No shared admission, ledger row, schema/type,
fingerprint or native include is changed.

Actual schema reload/catalog and all four specific HTTP403/42501 RPC denials
precede native execution (lines151–185). Real-status guards, aliases, fixture,
serial execution and lock deadlines remain inherited. Parent qualification
requires exactly6SC071+4SC010 unique file/name cases, zero failures/errors/skips,
exit0, complete stage, before/after effective-input hashes, BASE receipt and
ledger comparison (lines186–251). Missing/malformed evidence cannot qualify.
Receipt separates BASE, workflow, producer, registered/effective source and
invoked versus hashed-but-uninvoked config. Existing canonical scrubber,
sb_secret input port and leftover-token refusal still precede artifact
promotion; local status/headers and raw output remain private.

The ledger comparison checks the ordered version list, not every metadata
column. Canonical BASE already checks version/name; exact824 has no ledger
write. Post-forward schema remains UNQUALIFIED_FOR_FINAL_CAPTURE, candidate
clean/upgrade parity NOT_CLAIMED and admission PENDING_COORDINATOR. Ordinary
final gates remain mandatory. Actual native effects still require real CI
execution and independent evidence qualification.

Assertion/fixture limits remain in `export-races-review.md`: private internal
result commit/current-grant read refusal, finite issuer/SMTP/session ports;
no separate later send, whole tenant matrix or independent reading oracle
qualification. Existing c08 native3 and local/f75 failures remain separate;
no prior green receipt qualifies the changed effective six-case input.

| Reviewed input | Independently verified SHA-256 |
| --- | --- |
| Corrected workflow | `24a53b103530fb7600c94d45456aefda673d19c8720eb2e0fdfd1bdcf56361ec` |
| export-feedback-inputs.json | `5f361eb8cef07dbd760d65cc593185869d1a6aafd355d755c04ee72a4e670f08` |
| Selected config | `e18a61dbe1b6ac885db235dcd3a54fa5b01763e716d83a08c7846326c85b9d7c` |
| Owned patch | `a45ee4b477f23fee35446132c9cf93a3fd00d4de673a4c00b68eac100eb71948` |
| Registered native | `6407877b57576c7b3dac3db2c3847935ef4941b71b5f5efd36c6e4b5f0fb1ef0` |
| Effective native | `33b7d52a6a5b94bc75eb77c5446f93942fbdebf64a678f3684ff3f77208a0dc4` |
| Sole forward SQL | `d0e4ec7285796cb4c53786dd7016d6e4ce9dc5aa9be111481481b490a62a0596` |

All six producer-overlays hashes match824 objects. BASE tree/48 declared ledger,
dependencies and canonical config/fixture/helper/replay/redactor match. Replay
SHA remains `fd28ec70ce1fff7392f282dd0029b2499ba2b24d6ab4cc4a13a11a758bf3aa18`.
Read-only git-apply-check passed; independent in-memory patch application gives
exactly33b7d52a/231 lines without checkout/index mutation.

Reviewer ran bounded reads, Git object/diff/status checks, sha256sum and read-only
Python checks. Parent records actionlint, Bash/Python syntax, selected types/lint
and seven finite controls PASS; those suites/native/DB/CI were not rerun here.
Skill routing continues bounded spec-to-code-compliance/code review and actual
Supabase path review. Reviewer writes only this new reserved review file.

## Actual first experiment: qualified partial result

2026-10-05. **QUALIFIED PARTIAL: 8 PASS / 2 FAIL; SC071 six-case native
component PASS. Full ten-case experiment FAILED; whole SC010/SC071 remain
UNAPPROVED.** This updates the historical NOT_RUN statement above only for
this exact experimental input. Actual run `37305623231`, job `111748483656`,
checkout `44992cdd47f1e146315679749804697f6395f71c`; native step failed and
redacted artifact upload succeeded. Artifact `11343427856` has independently
verified API/ZIP SHA256
`ab140ff44e32fcde4dd6210f6a1b00992269026f021cfeb4c1f9ee083c51b3ab`.

ZIP CRC, exact fifteen-file inventory, safe paths/no symlinks, extracted-byte
equality and absence of status files/JWT/sb_secret credentials passed. The
artifact receipt equals the immutable actual job-log receipt. The parent-created
`independent-qualification.json` is outside the ZIP and was not used as proof.
Receipt SHA256 is `10f0219950819ce2184501d98e3a1238dc4df1726fb0ec5214e647cf7d8f24b8`;
JUnit SHA256 is `f2a962bd3cfd503bd1e18d79cd58c69bd091ae8aeaa79960044daf2d760a99ff`.

Independent Git object checks match all **7,559** BASE tracked paths/byte hashes,
exact BASE tree f03ec10b, five owned published caller inputs, eight effective
before/after runtime inputs and sole SQL d0e4 to their immutable commits.
Package/lock files match BASE. Actual replay log verifies the canonical
9a0ecad9 fingerprint and 48 official ledger rows; before/after ordered ledger
versions agree. Four real RPC catalog entries and four HTTP403/42501 denials
match the intended functions. BASE replay completed; forward SQL completed.
This remains BASE-then-forward evidence, without candidate canonical parity.

Actual JUnit and native log agree: ten unique cases, six SC071 passes, two
SC010 route passes, two SC010 expiry failures, zero errors/skips. Effective
SC071 source is exact33b7d52a; registered6407877 remains unchanged. Its frozen
SC071 literals are exercised at the private internal-result and actual read
boundaries: writer-COMMIT blocks the real leased export with no result/page;
writer-ROLLBACK permits the valid page; export-first commits before the waiting
revoke and subsequently refuses retained-page reads. Real grant versions,
captured immutable job/lease scope, current-versus-stale revoked refusal,
owner-state snapshots and DGI provenance assertions passed. The original
three real projection races also passed. This qualifies those bounded effects,
not whole TEN-10/TEN-12, authentic market inputs or a later SMTP/send boundary.

Both owner expiry cases failed at published native line144: expected
`ediel_export_lease_not_current`, received PostgreSQL57014 / `canceling statement
due to statement timeout` during the real fifteen-second deadline hold. Their
subsequent result/receipt/original/job-preservation assertions were not reached;
expiry behavior remains unqualified. Preserve this failure and obtain a real
passing owner-controlled follow-up without weakening the ten-case gate. No
product vulnerability or runtime approval follows from this test outcome.

Reviewer used read-only Git blob batching/SHA checks, ZIP/XML/JSON parsing,
bounded source/log reads and GitHub artifact/job/log APIs; no DB/native rerun.
Coordinator admission/capture, producer/effective-test main integration and
ordinary final candidate gates remain pending. Historical c08/local/f75
qualification and failures remain separate; no coverage or whole-card promotion.

## Next caller: separate owner-native provenance and timeout diagnostic

2026-10-05. **APPROVE this minimal future caller delta statically; next native
execution NOT_RUN.** Exact workflow SHA256
`6e30b3f00f9ab6660eaf61327d881c6336e9e7b6d45e487cd3b888e143640f0b`,
descriptor SHA256
`5bf24fc67d9525532e565f1c304c6c360b4a1835f0b04208e98594ab3297cefe`.
No blocking finding. The actual449 result above remains 8 PASS / 2 FAIL.

Compared directly with immutable449: descriptor adds only `sc010_native_commit`
(currently824). Fetch includes that separate pin; only the exact SC010 native
test path selects it (`:81–87,133–135`). The other five producer/config inputs
and SQL still select immutable824 and retain all expected byte hashes. Receipt
records both pins separately (`:262–264`); unchanged strict ten-case, hashes,
ledger, error, cleanup, redaction and artifact-promotion gates remain in force.

The new `:124` query is SELECT-only and projects just four fixed role names and
their exact `statement_timeout` settings for global/current-database records.
It does not output other role configuration or issue SET/guard changes.
`role-statement-timeouts.json` follows the existing whole-directory canonical
redaction/refusal custody. This is a stored-setting diagnostic, not proof of
each RPC connection's effective timeout or native behavior.

Reviewer independently checked diff/descriptor equality, six selected source
hashes, sole SQL hash and all eight embedded Python AST blocks. Parent reports
seven finite controls/actionlint/Bash/Python syntax PASS; not rerun here. A new
owner handoff must supply the exact replacement native commit/hash before
publication/execution; this approval does not qualify future test bytes. No
source-owner test edit, native rerun or full10/whole-card inference was made.

## Exact owner-native correction9b50

2026-10-05. **APPROVE the bounded native-only correction statically; next
execution NOT_RUN.** Reviewed immutable owner commit
`9b50b1b9a5aae19e9cabead09c92af4e0443c44c` against824. Exact native SHA256
`14611ac1edc3a4c0795e2fe4888e52524f033d98606d436becba1bdaf6809c66`.
No blocking finding. Product/config five inputs and sole SQL bytes are
independently identical between9b50 and824; caller still selects immutable824
for them. Native imports, route cases, real RPCs and helper are unchanged.

Only the two expiry-case controls change: snapshots move before the lease
window, the privileged test deadline uses five real database-clock seconds
instead of fifteen, and line137 requires the lease still be live after the
actual destination lock wait is observed. The results/jobs lock modes and
actual PostgREST execution remain unchanged. Lines144–153 still require
observed wall-clock expiry, exact `ediel_export_lease_not_current`, null output,
atomic result/receipt/original preservation and unchanged leased job/token.
Statement timeout is still a failure; no SET, timeout guard edit, catch,
fallback, skip or weaker accepted error was introduced. Finally-disposal and
once-created request draining are retained.

This removes setup work from the short window and strengthens the live-wait
precondition; it does not prove that the native connection permits that timing.
Actual expiry/atomicity qualification still requires a real passing follow-up.
Caller6e30 supports a separately acknowledged exact native pin/hash; descriptor
currently retains824 pending handoff acknowledgement. Prior449 remains qualified
partial8/2, with its two expiry failures preserved. Reviewer used only immutable
Git diff/show and SHA checks, wrote only this review, and reran no DB/native test.

## Final acknowledged source pin

2026-10-05. **APPROVE the final caller/source-pin packet statically; next native
execution NOT_RUN.** Workflow remains exact6e30b3f0; final descriptor SHA256
`ed96171e58321ca8623bb1b5b30a11a3f506739ca5811d21939a3d6cb0c124a3`.
This supersedes only the prior awaiting-ack/current824 pin wording. Independently
read source-owner handoff5994292830 and ACK5994494883 on PR586: all six overlay
inputs and sole SQL must come from one9b50 commit. Both extraction/native pins
now equal exact9b50b1b9; product baseline824 and repair handoff are recorded
separately. Native hash14611ac1 matches; the other five/config and SQLd0e4
remain byte-identical824. All selected hashes and unchanged workflow bytes
were independently verified. Authentic BASE7b/tree f03 remains explicit;
candidate package/lock, fixture, lock helper and registered own native match
BASE bytes. No runtime, parity, full10 or whole-card approval is inferred.
Actual449 remains qualified partial8/2, including its unreached expiry
atomicity checks. No caller/descriptor/test/production/shared file was edited.
