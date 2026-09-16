# F1-B — activation evidence metadata

Independent continuation after PR313/314. PR310 stays paused; no SQL, grants,
types, original source files or external-message state changed.

## Reproduced defect and correction

The resolver verified a DB activation date, then replaced its narrower window
and document name with normative guide metadata while retaining its DB hash.
It accepted impossible business dates and could interpret malformed valid_to as
an open activation. This is evidence misrepresentation, not normative authority.

Preserve the document/hash association, and intersect activation and guide
windows. Keep normative effective dates in the existing source-policy snapshot.
Validate real ISO calendar dates, explicit nullable end dates, noninverted
windows and the existing SQL 64-lowercase-hex source_hash constraint. A correctly
formatted digest is not proof of original document acquisition or certification.

The RPC signature, policy resolution, readiness requirements, row cardinality,
source guide/revision comparisons and tenant/permission behavior are unchanged.

## Verification

Initial 41-test harness run:24 passed,17 failed against the pre-fix source.
After the correction:41/41 passed. Two more finite-end/leap-date cases bring
the final source harness to43/43 passing; F3's28 independent golden tests pass.
The harness loads actual source/policy code, but fakes the DB boundary. Normal
published-head CI/typecheck/full tests/build are required before merge. No live
DB read, mutation or certification is claimed by these local tests.

Source constraint: supabase/migrations/20260713100000_ediel_completion_and_platform_contract.sql,
existing ediel_rule_packs schema and resolve_canonical_ediel_rule_pack projection.
Normative/evidence separation: MASTERMASTERPLAN_v2 sections3,17,19. Immutable
source package is unmodified. Skills: source-contract review, systematic debugging,
TDD, Supabase RPC-contract review, differential verification. No independent
human/agent review or full F1/F7/masterplan acceptance is claimed.
