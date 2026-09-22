# E035 witnessed owner-decision timeline — 2026-09-22

PARTIAL / NOT MERGE-READY. Existing PR370. Baseline de9e459a5843a9cf562436fb46e0376a61a7e53e,
tree b881b47c6e5b6408f2d5dc3b90a6ae40eecf514e, main eb2b8693130af8fa7976a93891b95973bc473b50.
The containing commit identifies this continuation, not the earlier implementation receipts.

## Actual new behavior

The service-only gridex_source_object_snapshot_v1 RPC already stores the exact bounded
readset. This increment consumes it in the actual UTILTS diagnostic path. Scope derives
from the original company/environment and receipt instant, with the full cutoff spelling
preserved. Each RPC has a2second AbortSignal deadline. No optional caller status or mutable
point link supplies source authority. No grants, migrations, dependencies or generated
contracts change. The wire/group owner is reused for every physical tuple; neutral
unavailable facets avoid conflating source disposition with canonical register disposition.

All source identities, hashes, timestamps and assessment chains must validate before any
source identifiers are returned. Input/physical-work budgets fail the WHOLE readset, not a
prefix. Broken chains, cross-source predecessor links, duplicate IDs/witnesses, scope drift,
malformed timestamps and partial object coverage cannot escape as inspected evidence.
Raw payload and full owner proof JSON are not projected into the diagnostic.

The predecessor chain is the sole assessment replacement order. Equal timestamps, unordered
RPC arrays and late older witnesses do not reorder corrections. Assessment creation and
availability are distinct microsecond instants. A later assessment created by the cutoff
without a timely committed witness has UNKNOWN historical visibility: asOf is withheld,
not replaced by an older accepted row. A correction created after the cutoff cannot change
the earlier asOf projection. This is SAME-SOURCE ASSESSMENT REPLACEMENT, not proof that one
market source supersedes another. A fully witnessed successor can replace an unwitnessed
predecessor because each actual SQL assessment independently covers the whole source.

## Authority limits

Digest verification is byte integrity, not authentication. The internal reader accepts
only the service-owned RPC envelope, validates closed owner markers/scopes, and projects
recorded dispositions. It does NOT recreate fresh runtime owner capabilities from JSON,
re-run historical ownership against today's mutable rows, or claim independent business
revalidation. The actual runtime test supplies genuine canonical/tenant/party/business
outputs and verifies that the resulting timeline cannot rehydrate a canonical capability.
SQL/native tests remain the owner-authority oracle.

All outputs retain authorityStatus:not_established, selection:not_performed,
marketSupersession:not_performed and historyCoverage:before_ledger_unknown. An inspected
bounded readset is not dated market completeness. No incoming UTILTS observations become
their own expected baseline. No E61/E62 decision is altered. Z04 legacy agency9 runtime
approval remains the baseline scope; applicable other business owners remain unfinished.

## Test-first and execution evidence

Local pure tests:50 actual assertion failures against a no-op implementation;50 passes
after implementation, including microsecond boundary, equal-time predecessor ordering,
late witnesses, hidden whole-readset errors and no fallback from an unproven successor.
Executed with Node22 --experimental-strip-types plus an external node:test adapter that
only maps the test registration. This is NOT Vitest or complete project verification.
A targeted real TypeScript compiler run found no changed-module diagnostic, but traversal
stops on absent @supabase/supabase-js dependency in this local container; no full typecheck
PASS is claimed. The unchanged generated DB source tree was reconstructed and all4908
baseline Git blobs verified before editing.

Added4 actual runtime-owner projection cases,10 actual accepted/rejected UTILTS outcome
cases and2 actual Supabase HTTP/native history tests. The native cases append through
real owners/RPCs: a later unavailable assessment must preserve earlier historical approval;
an unwitnessed successor must not revive an accepted predecessor. These tests are wired
into the preexisting mandatory native suite, not an optional or mock-only lane.
The existing12 durable business-outcome tests retain every outcome assertion; their exact
RPC totals increase only for the new separately asserted scoped timeline RPC.

Full root Vitest/all typechecks/lint/build/ordinary native replay and independent
TASK/SPEC, QUALITY, TENANT-BOUNDARY and WHOLE-PR review remain exact-candidate gates.
Qualification and completed-CI receipts on PR370 supersede this implementation-time
pending wording; do not rerun completed work simply because this historical note predates it.

## Qualification findings before final publication

Two additional pure boundary tests reproduced coercible array values passing the
caller-environment and stored-disposition enums. Exact-string guards corrected both;
the same isolated registration adapter then passed52 tests. Deliberately removing the
witness cutoff or assessment cutoff each produces one test failure; the duplicate-link
mutant is still rejected by the remaining full-chain constraint (not a killed mutant).

Initial integrated run35773634967 passed5675 root tests/345 files and every original
OPS verify/quality-release gate, including all typechecks and build. Its real native
suite reached9 PASS/1 FAIL: the new unwitnessed-successor fixture incorrectly expected
sourceDisposition on the append RPC receipt. The SQL returns exactly eight integrity
fields, not runtime authority. This test now asserts that exact receipt, the additional
stored assessment and absent witness before the unchanged timeline assertions. No SQL,
production behavior or assertion about withheld historical approval was relaxed.
The earlier run is FAILURE, not qualified. Its artifact10715850436 has ZIP SHA256
c8171731b50f0ad7517df5190776d22e6e2e21c06c68182f99d31a7713c21cc8.
The corrected candidate still requires successful actual native execution and remaining
contract gates; a final terminal qualification receipt supersedes this pending note.

## Skills, preserved boundaries and resume

Used repo using-superpowers/executing-plans, test-driven-development,
verification-before-completion, code-review and Supabase/PostgreSQL security principles.
No Next UI, dependency-upgrade, hosted-administration or deployment changes.
Resume at the current candidate qualification and review; then finish applicable business
owners, dated market completeness, cross-source supersession and E61/E62 selection.
PR310 OPEN/DRAFT/PAUSED at e961135199f292b8210884f07de3b616a670161a stays excluded.
D110/110+parents10/10 retained. Full E035/F3/masterplan incomplete; no checkpoint merge.
