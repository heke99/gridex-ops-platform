# E035 continuation — 2026-09-23

## ACK creation interruption review and candidate repair

The prior exact head 297afecd had all ordinary workflows green (OPS
35840200169 verify, quality/build and clean replay; full E2E, browser, tenant
and Ediel regressions). CodeRabbit review 5792202498 found a blocking gap:
the service created a transaction ERR ACK after persistence but before the
separate `final_response_type` update, and a changed retry could replace the
unfinalized negative decision with positive APERAK. Green CI did not cover it.

Published eac1a604 adds forward migration
`20260923113000_ediel_utilts_ack_plan_reservation.sql`. The persistence row's
non-held response plan becomes the durable reservation before ACK creation;
only an unfinalized `internal_review` with no series can change after fresh
authority. A retry with the same planned response remains idempotent. Two new
native SQL checks model interruption before finalization and reject an attempted
positive rerun of an already planned ERR. Locally 72 targeted TypeScript tests,
checksum and type-tail checks pass. Authentic empty replay run35842205514
passed eight retry SQL checks, 17 structural native cases, tenant invariants
and injected-drift parity. Generated public types remained byte-identical.
Only the committed schema snapshot differed in the replaced function body;
fingerprint `dcb959e4a47bd87a7eaf0486a4124fcbb226da112019727b5c61f5935a26d7b0`
and function count591 came from artifact10741254796, ZIP SHA256
`c3a848783796e212348b523a284081973190e87d3a31a0342ed9b7fa93abf860`.
The snapshot is locally reconciled, awaiting publication, exact-head CI and
reviewer recheck. This does not establish the rest of E035 or complete market
retry reconciliation.

## Retry and mixed-transaction continuation (dce05e48)

The previous exact head 35e35f45 passed all ordinary workflows: OPS
35838519201 (verify, quality/build and clean empty-database replay), tenant
integrity, browser, full E2E and Ediel regressions. CodeRabbit's four-part
whole-PR review 5791799801 found no confirmed blocking defect in that head;
it expressly retained the applicability and masterplan gaps.

The next published head dce05e48 adds a new forward-only SQL replacement of
the existing service-role UTILTS persistence RPC. It serializes transaction
retries, permits an unfinalized `internal_review` to become accepted after
fresh structure authority, returns the stored series for a same-result retry,
and rejects a changed decision after series persistence or ACK finalization.
No earlier migration was edited. A disposable six-check PostgreSQL script is
wired into the native replay, and a mixed physical E66 runtime test checks that
an unproved reading is held while its exempt energy sibling remains accepted.
Locally targeted 23/23, test typecheck and migration checksum/type-tail checks
pass. Authentic empty replay run35839531741 passed six new SQL retry checks,
17 structural native HTTP tests, tenant invariants and injected-drift parity.
Its generated public types SHA256
`6af55fbbed9390acfe71dbb8c757c10e3a021dec15842df801d06b679d98eda9`
are byte-identical. The job failed only at the stale committed schema snapshot:
the function section changed, count 591 unchanged, actual fingerprint
`39a7a3c4fdbf5a8b773f0b37d003c09a3d347107760053159d6aacd4e62ba71b`.
Artifact10740892548 (ZIP SHA256
`b5def03afd35dcf5f52a1f5af8ad5a4457e2e6ccbf1bdd0de5ac672110370aed`)
supplies the exact replacement schema and type receipt now reconciled locally.
This correction still requires publication and an ordinary all-green exact-head
CI run; no merge is claimed.

The remaining business/history gaps and F3C-02/04/05/06/07 plus F4-F7/G gates
remain open. An already finalized ACK that conflicts with newly discovered
structure is deliberately an internal conflict requiring reconciliation; this
guard does not claim a complete market retry policy. Main and paused PR310 are
unchanged.

Status: implementation in draft PR370, not merge-ready. Main remains
`eb2b8693130af8fa7976a93891b95973bc473b50`; PR310 remains paused at
`e961135199f292b8210884f07de3b616a670161a`. The qualified Z04 owner and
same-source assessment history from `64bf971` were retained.

## Skill route and source

Activated repository plan execution, code and differential inspection, TDD,
systematic debugging of actual CI, Supabase/Postgres migration hygiene, review
reception, and verification before completion. Security/tenant review applies
to the source-read and owner paths. Browser/UI design, infrastructure changes,
performance tuning and parallel agents do not apply to this narrow correction.
The frozen Library masterplan (2026-09-10, section 18–19) still requires
capability-scoped F0–F7 and G01–G07 evidence; green unit tests alone do not
authorize production or release.

## Evidence and findings

1. At `fe4f9ac6`, ordinary OPS run `35833938483` passed the application quality
   job. Its actual clean replay ran the 17-case native structural suite and
   generated identical public TypeScript bytes, but the committed schema
   snapshot omitted the new Z06E owner-function guard. `verify` and smoke also
   failed on the migration-tail check. Artifact `10738595716` has ZIP SHA256
   `d087a4e16791cdeefdad135e4b64fd194fb712d4b65cf3e7cd30ac6076a39e28`.
   Only the function section differs in the schema fingerprint. The replay
   snapshot and manifest correction was published as `0f871c78`, tree
   `7b70ef35688bf817f91e7c00f5509fc45c6981d5`; local migration checks pass.
2. An unavailable BGM5 correction of an accepted Z06 can propose a later
   effective date. The prior selector ignored that correction when checking an
   earlier interval, returning the possible predecessor as selected. A new
   regression reproduced `41 PASS / 1 FAIL`; the selector now withholds the
   object until the correction/predecessor proof is witnessed or explicitly
   rejected. After the change, 97 targeted selection/comparison/qualification
   tests, app/test typechecks and the Node22 full suite (5793/350) passed. This is a conservative unavailable
   result, not an E61/E62 rejection or a claim of universal market history.

## Remaining gates

- Publish the correction guard on the existing PR, run ordinary/native exact
  head verification, inspect artifacts, and obtain independent TASK/SPEC,
  QUALITY, TENANT-BOUNDARY and WHOLE-PR review before any merge decision.
- Establish applicable Z05/Z08 closure, Z06E death/bilateral, agency89,
  multiple-message, delegated-sender, changed-start Z04 and retry owners.
  Current post-ledger bounded coverage is not evidence of older market history.
- Reconcile F3C-02/04/05/06/07, then applicable F0/F1/F2/F4/F5/F6/F7 and
  formal counterparty, legal, transport and release evidence in dependency
  order. No hosted database mutation, deployment or external market message
  was made in this continuation.
