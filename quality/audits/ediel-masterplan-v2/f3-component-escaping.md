# F3-B — release-aware structural components

Rebased independent continuation from main after merged PR #320 (`6606041960b87caeb5e0e71e9ef11aa60d32e59b`). PR #310 remains paused and none of its migrations, schema, types or replay machinery is imported.

## Source contract and reproduced defect

UNECE application syntax section 5 states that a release character protects the following service character; the literal must not become a delimiter at a deeper level. Primary sources reviewed on 2026-09-16:
- https://unece.org/fileadmin/DAM/trade/untdid/sessdocs/r1157.htm
- https://unece.org/trade/uncefact/unedifact/part-4-chapter-22-syntax-rules

Masterplan F3/G06 requires source-backed structural parser evidence. These syntax sources do not replace any original Ediel source package or national profile.

The tokenizer's legacy elements are already decoded. AST/composite consumers split those strings again, making a released colon structural and interpreting a literal question mark twice. A valid trailing literal question mark could throw a dangling-release error; a released separator could introduce a phantom scalar S18 token. Envelope subaddresses and UNH profile components also shifted.

## Bounded fix

Add `segmentComposite` to split the wire segment with release sequences retained until component decoding. Canonical AST references, identifiers, scalar tokens, envelope decoding and UNH parsing use it. Retain tokenized object shape and legacy element values unchanged. Do not reinterpret codes or bypass downstream field, route, identity, authorization or guide validation. Decoder correctness does not mean a fixture is an allowed Ediel business message.

The four affected source files were unchanged on main relative to the original reviewed F3-B merge base before this rebased application; the bounded source correction was therefore reapplied onto current main without importing the stale branch history or overwriting the newer APERAK/governance work.

## Verification

The source harness covers 38 targeted actual-source cases plus three exhaustive generated tests covering 648 combinations over three UNA alphabets. It uses real source modules with no DB/network or parser mock. Independent test-wire serialization and explicit expected component arrays avoid relying on application encoder roundtrips. Existing dangling-release rejection and legacy projection shape are retained.

The harness is wired into the persistent Ediel masterplan CI. Full normal exact-head PR CI/typechecks/build remain mandatory before merge; no local-only result is treated as merge evidence.

## Remaining scope

This is not full UNSM grammar, all 74 PRODAT fields/110 conditions, component-aware CCI/CAV semantic projection, legacy raw-string-consumer migration, custom-UNA outbound encoding, MIME extraction certification, or live F7 acceptance. Those are separate work items and must not be marked complete by these tests.

No SQL, production database mutation, deployment, or external Ediel message is part of this change.
