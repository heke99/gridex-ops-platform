# PR310 complete foundation admission — 2026-09-15

Status: targeted correction; whole PR remains PARTIAL.

## Evidence and impact

At GitHub head82cb5d0018028364cf17713e495d37c8f9f6749d timestamp predecessor
admission accepted seven group success hashes and boolean execution flags, but
omitted exact failure-control programs and complete foundation78–144/residual
source receipts. This allowed incomplete/tampered qualification metadata to
reach the next migration boundary. Duplicate predecessor filenames/versions
also lacked an explicit uniqueness gate. Severity: high verification-integrity
finding, confirmed by direct execution-path review; not a production mutation.

## Correction and provenance

Reuse verify_foundation_end/read_predecessor_ledger and relevant tests from the
preserved stash containing the previously reviewed T53 candidate. Do not restore
its superseded partial-source executor. Validate current support/source/native
body hashes, exact ordered failure programs/SQLSTATEs, rollback flags, group
indices/kinds, repeat/atomicity flags and65 unique ordered real CLI ledger rows.
Keep private-file identity/mode/bytes and actual parsed SQL-statement matching.
Keep all historical source files and full514 compiler unchanged.

## Verification

- RED: new helper tests fail against the previous runtime (missing validation).
- GREEN: python3 scripts/test-canonical-native-timestamp-runtime.py —19 tests,
  including74 individual source-receipt mutations and12 ledger/file fault modes.
- Actual CI artifact10394223040 from ec503 run34960996805/job104354284703:
  SHA2565352f1730aa9afa662c47c93511ae57cd7c2871239ec7fa315059b714291ce5f.
  All seven current-source foundation groups pass admission. Individually changed
  control hashes in each group reject before the real-ledger readback helper.
- These are admission checks against previously executed SQL evidence. They do
  not certify new-head full native SQL, schema comparison or generated types.

Independent review approved this narrow correction with no blocking findings;
all19 runtime tests and whitespace checks independently passed. Remaining review findings:
broaden timestamp catalog/rows to source-modified schemas/types/extensions/event
triggers; qualify and record real-ledger-dependent readiness semantics. Preserve
blocked readiness when that is the actual source result, with no ledger aliases.

No production mutation, reference rewrite, disabled control, force push or merge.
