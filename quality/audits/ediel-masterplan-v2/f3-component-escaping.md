# F3-B — release-aware structural components

Independent continuation from main cf42f768 after PR313/314/315. PR310 remains
paused and none of its migrations, schema, types or replay machinery is imported.

## Source contract and reproduced defect

UNECE application syntax section5: a release character protects the following
service character; the literal must not become a delimiter at a deeper level.
Primary sources reviewed on2026-09-16:
https://unece.org/fileadmin/DAM/trade/untdid/sessdocs/r1157.htm
https://unece.org/trade/uncefact/unedifact/part-4-chapter-22-syntax-rules
Masterplan F3/G06 requires source-backed structural parser evidence. These syntax
sources do not replace any original Ediel source package or national profile.

The tokenizer's legacy elements are already decoded. AST/composite consumers
split those strings again, making a released colon structural and interpreting
a literal question mark twice. A valid trailing literal question mark could
throw a dangling-release error; a released separator could introduce a phantom
scalar S18 token. Envelope subaddresses and UNH profile components also shifted.

## Bounded fix

Add segmentComposite to split the wire segment with release sequences retained
until component decoding. Canonical AST references, identifiers, scalar tokens,
envelope decoding and UNH parsing use it. Retain tokenized object shape and legacy
element values unchanged. Do not reinterpret codes or bypass downstream field,
route, identity, authorization or guide validation. Decoder correctness does not
mean a fixture is an allowed Ediel business message.

## Verification

38 initial actual-source tests:36 failed before correction; all38 pass after.
Three further exhaustive tests cover648 combinations over three UNA alphabets.
F3-B final41 tests and existing F1/F3-A71 tests:112/112 pass locally. No DB/network
or parser mock. Independent test-wire serialization and expected component arrays
avoid relying on application encoder roundtrips. Existing dangling-release
rejection and legacy projection shape explicitly retained. Full normal exact-head
PR CI/typechecks/build are mandatory before merge; local npm registry is offline.

## Remaining scope

This is not full UNSM grammar, all74 PRODAT fields/110 conditions, component-aware
CCI/CAV semantic projection, legacy raw-string-consumer migration, custom-UNA
outbound encoding, MIME extraction certification, or live F7 acceptance. Those
are separate work items and must not be marked complete by these tests.

Skills: systematic debugging, source-contract review, TDD, property-based and
variant testing, differential review and verification-before-completion. No SQL,
UI, performance claim, live transport or independent reviewer execution involved.
