# Independent review: SC071 BASE-then-forward caller

2026-10-05. **APPROVE the corrected caller statically at workflow SHA256
`24a53b103530fb7600c94d45456aefda673d19c8720eb2e0fdfd1bdcf56361ec`.**
No remaining blocking assertion, provenance, custody or cleanup defect was
found in this bounded packet. This is not runtime, product, CI, migration
admission, capture, parity, merge or whole-contract approval. Experimental
ten-case native execution remains NOT_RUN; SC010/SC071 remain UNAPPROVED.

Reviewed branch: `codex/ediel-sc071-export-feedback-20261005`, HEAD
`4b6e0d037206b04e89ce00a3c64651dd7056df4d`. Pinned actual-main BASE:
`7b9218da2c7f71f4373bcc9189715c0043a8cb31`, tree
`f03ec10bec420c9013848be526595c5fbb0242b7`; both commits have that exact tree.
Current reviewed caller is 316 lines. Source-owner handoff5993124044 and
board5993188414 were independently read; they explicitly permit this bounded
same-stack experiment while retaining coordinator admission/final capture.

## Historical finding and corrected verdict

Initial workflow `8f4bd1e62e690a0c1a854f0550b04709709c873591e00ad6220b92427ba3228c`
received **P2 / changes requested**. Its parent `optional()` reader at former
lines218–220 parsed any existing JSON file without handling errors. A failed
psql ledger read at lines110/194 can leave an empty redirected file; parent
receipt parsing then raised JSONDecodeError before redaction/artifact promotion,
losing failure feedback even when native log/JUnit already existed. The child
would still execute canonical cleanup. The reviewer reproduced the finite
empty-JSON parse failure without running a database.

Corrected caller lines218–251 now catches OSError/ValueError, records explicit
`optional_evidence_parse_errors`, returns None and reads all optional evidence
before qualification. PASS requires no such errors, a dictionary BASE receipt
with exact SHA/completed/48, and four readiness records. Lines268/280 retain
diagnostics and make incomplete evidence fail. **P2 resolved at24a53b10.** The
parent's seven finite controls include empty-post-ledger and malformed-BASE
receipt refusal; their current workflow/descriptor hashes match. These are
orchestration controls, not database or native evidence.

## Bounded execution and provenance assessment

- Lines78–106 use a separate child with its own errexit, a detached pinned
  BASE checkout and a fixed BASE CWD. package.json and lock are compared before
  reusing installed dependencies. The unchanged canonical script is sourced
  unconditionally, and its EXIT trap is neither replaced nor bypassed. BASE
  remains CWD through Supabase start/status/stop; parent redaction follows child
  exit. The disposable CI worktree's later runner disposal adds no second DB
  harness or producer.
- BASE source/tree and tracked input hashes are recorded before replay. The
  unchanged source verifies checksum history, fingerprint9a0ecad9 and the
  actual official ledger before returning; lines109–118 attribute that replay
  only to BASE. The canonical script's SHA is unchanged `fd28ec70ce1fff7392f282dd0029b2499ba2b24d6ab4cc4a13a11a758bf3aa18`.
- Lines121–149 extract only the six hash-pinned producer824 inputs into the
  runtime checkout. The owned patch is restricted to one native path and must
  convert registered6407877 to effective33b7d52a. The selected config is separately
  pinned. The sole d0e4 migration is extracted only to RUNNER_TEMP and applied
  through existing psql/ON_ERROR_STOP to the same canonical loopback DB after
  BASE replay; no replay migration, admission map, official row, shared native
  include, committed schema/type or expected fingerprint is edited.
- Lines151–185 execute the actual forward, NOTIFY schema reload, record four
  actual public function identities and witness all four real HTTP RPCs.
  Qualification requires each specific 403/42501 native denial; PGRST202 is
  retried finitely, other responses fail. Local status/headers remain private.
  Readiness creates no synthetic grant, lease, result or ready flag.
- Lines186–205 invoke the sole selected config with six SC071 plus four source-
  owner cases. Native status is retained independently from later checks; real
  failure still drains through post-checks and canonical EXIT. Effective runtime
  hashes must match after tests. Parent lines229–251 require exact file counts,
  ten unique file/name pairs, zero failure/error/skip, exit0, completed stage,
  actual readiness, BASE receipt and ledger equality. Missing/malformed JUnit
  cannot qualify. Original guards, serial execution, fixtures and lock deadlines
  remain inherited.
- Receipt lines253–275 separates workflow checkout, BASE, producer, registered
  versus effective native bytes, invoked config and hashed-but-uninvoked SC010
  config. It explicitly leaves post-forward schema unqualified for final capture,
  candidate parity unclaimed, coordinator admission pending and whole rows
  unapproved. Existing canonical CLI redaction, sb_secret inputs to its existing
  scrub port and leftover JWT/sb_secret refusal are unchanged; raw evidence and
  status cannot be promoted before successful redaction.

Native assertions retain the limits recorded in `export-races-review.md`:
actual leased private-result commit and live-grant read refusal, not a separate
later send boundary, full tenant-rule matrix, independent reading oracle or
authentic external authority. The existing c08 three-case qualification and
local/f75 failures remain historical and separately attributable. No green
result is carried from c08 into the changed effective six-case source.

The post-forward ledger comparison currently checks the ordered **version list**,
not every ledger column. The canonical BASE check already verifies version/name;
the exact producer forward contains no ledger writes. This review does not
claim an independent after-forward equality check of all ledger metadata.
Replay/readiness/native output and ten actual effect assertions still require
real CI execution and evidence qualification after publication.

## Exact reviewed bytes and checks

| Input | Independently verified SHA-256 |
| --- | --- |
| Corrected workflow | `24a53b103530fb7600c94d45456aefda673d19c8720eb2e0fdfd1bdcf56361ec` |
| export-feedback-inputs.json | `5f361eb8cef07dbd760d65cc593185869d1a6aafd355d755c04ee72a4e670f08` |
| Selected config | `e18a61dbe1b6ac885db235dcd3a54fa5b01763e716d83a08c7846326c85b9d7c` |
| Owned patch | `a45ee4b477f23fee35446132c9cf93a3fd00d4de673a4c00b68eac100eb71948` |
| Registered native | `6407877b57576c7b3dac3db2c3847935ef4941b71b5f5efd36c6e4b5f0fb1ef0` |
| Effective native, independently reconstructed in memory | `33b7d52a6a5b94bc75eb77c5446f93942fbdebf64a678f3684ff3f77208a0dc4` |
| Sole forward SQL at824 | `d0e4ec7285796cb4c53786dd7016d6e4ce9dc5aa9be111481481b490a62a0596` |

All six `producer_overlays` hashes were independently matched against immutable
`824e5f53c9a115e3f423d3e2e5ba13b41001bdb9` objects. BASE tree, declared48 ledger,
dependency files, canonical config/fixture/helper/replay/redactor and registered
test were also matched. Read-only `git apply --check` passed; an independent
in-memory application produced exactly33b7d52a/231 lines without filesystem or
index mutation. Existing tracked native/source/shared paths have empty diff.

Reviewer used bounded `nl`/`sed`/`rg`, Git object/diff/status reads, sha256sum,
read-only Python checks and the finite parse demonstration. Parent records
actionlint, Bash/Python syntax, selected types/lint and seven finite controls
PASS; this reviewer did not rerun those suites or native/DB/CI. Skill routing
continues bounded spec-to-code-compliance/code review and actual Supabase
transaction/custody review; no broad audit or implementation scope is added.
Reviewer writes only this new reserved review file.
