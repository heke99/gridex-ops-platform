# F3-E — source-exact PRODAT BGM document fields

Base: main after merged PR324, b0b3b395a36168757b0f8b4a765b7f7fadf6cceb.
PR310 remains paused at e9611351; no original source, SQL, RPC, grants or generated
types changed. This is the four-field document-header unit, not all F3/masterplan.

## Source contract and reproduced defects

The unchanged prodat_fields.json and P26.A r3 section2.6 printed p42 specify:
202 = BGM/C002/1001; 203 = flat BGM/1004 (an..35, NOT UNH0062);
204 = flat1225 (optional,9/5); 313 = flat4343 (AB/NA, optional Z01, R otherwise).
All13 usage columns are retained. C002 metadata cannot supply a field value;
flat elements cannot gain unescaped components. No new external error code is
invented: existing field-matrix errors remain internal diagnostics.

Before correction,203 used UNH presence,313 fell through to whole-BGM presence,
optional204 values could evade checking, and readers split decoded references
again or borrowed row/UNH/body values. A legacy builder emitted unused SVK/260
C002 metadata; the profile builder compacted/truncated already allocated ids.

## Corrected consumers

One matrix-backed document projector feeds canonical AST/facts, rulebook and
PRODAT parsers/facade, customer staging, compatibility/transport ingress,
permission readers and typed BGM reference persistence. Each uses the first
PRODAT message HEADER, not later LIN/BGM/message content. Literal escaped
punctuation and leading zeroes remain intact. Explicit BGM document id and UNH
technical reference remain separate. Genuine structured-only legacy input keeps
its existing fallback; source-bearing missing/malformed input does not.

PRODAT APERAK rendering references the actual original BGM in escaped RFF ACW,
not stale parsed/row/UNH/UUID values. Missing/oversized/malformed original id is
an internal correlation blocker, not a fabricated acknowledgement. U-family
ACK behavior is unchanged. Both PRODAT builders share the four-field header
serializer; allocated ids are escaped, not rewritten, and invalid lengths fail.
Default-UNA production preflight counts escaped terminators and BGM lengths
correctly, and cannot choose a valid profile from a truncated/borrowed BGM code.
Declared EDIFACT/UNA outranks CSV heuristics; custom-UNA document parsing is tested.
This does NOT certify all nondefault-UNA preflight, NAD/DTM grammar or permissions.

## Test qualification checkpoint

129 distinct source-module cases:62pass/67fail on unchanged base;129pass after
fix. The earlier95-case exploratory harness included one erroneous assertion
against a nonexistent staging.messageCode property; this was corrected to test
real production-classification effects and the full129 suite rerun against base.
It is not counted as a product defect. Retained439 cases were run; one expectation
that previously indexed a stale BGM on undecodable wire is now corrected to
expect NO fabricated BGM. Its row-scope/nonmutation/RFF checks remain intact.
Same correction is applied to the matching existing Vitest test. No original
normative or TGT fixture is modified. These are independently specified synthetic
wires and actual application modules, with declared database/mutation boundaries.

19 real-module Vitest cases cover public ingress, ACK, preflight, permission
classification and reference persistence, including positive/negative/no-mutation
cases. Full dependency/type/test/lint/build and normal exact-head PR qualification
are REQUIRED and not asserted by this local-source checkpoint. No SMTP was sent
and no live data was queried/mutated. Source-package integrity remains33files,
121rules/231contracts; integrity is not application acceptance.

## Review and next work

Applied systematic debugging/TDD, source-contract and differential review,
worktree base comparison and exact-source verification. UI/React, IAM, SQL/index
schema optimization skills are not triggered by these code-only header changes.
No independent human/subagent review is claimed. Normal CI and review remain
mandatory. After merge continue NAD and DTM field projections, then register/
dependent-condition work. Full provenance/TGT/live scope and paused PR310 remain
separate blockers, never certified by this unit.
