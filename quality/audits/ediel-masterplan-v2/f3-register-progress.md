# F3-H register implementation checkpoint — NOT MERGE READY

Scope: GOV-02 / P-05, the register unit following merged PR327. PR310 remains
paused and excluded. This is a durable partial implementation, not an F3,
GOV-02/P-05, 110-D-cell, production or external-portal certificate.

## Source and implemented paths

The per-field source table is `f3-register-source-map.json` / `.md`. Original
P26.A revision 3 was retrieved from the official Ediel portal and its bytes
match the frozen manifest. The original 33-file package, 13 usage columns and
110 numeric dependent cells have not been rewritten.

The existing matrix now owns register scope and distinct LIN locators 314 / 258.
Shared register readers/grouping retain every raw line, exact decoded object ID
and agency, source locations, global line sequence and per-object index.
Malformed chains receive no inheritance privileges. Later registers retain
own 213/214/218/259 fields; common SG8 values project from register 1 only.
These projections feed the canonical AST, compatibility facts and typed parser.

The existing dependent engine composes the source-defined first/later overlay:
Z06E/G first-register presence, Z04/Z06F/Z10 explicit meter-reading facts, local
annual quantities and differing tariff codes. Unknown readings are not proved
by a field being present. This is only the register-impact subset, not the
subsequent independent review of every D condition.

Both canonical profile and generic builders use one ordered register serializer.
It assigns global LIN numbering independently of register indices, retains empty
rows for validation, rejects partial/duplicate indices and never deduplicates
identical measurements. Snapshot arrays are authoritative, not fallback hints.
Generic validation and register-level policy checks share these rules.

Compatibility ingress and customer staging retain all objects and registers in
structured evidence. Bad register chains stop before database access. Existing
single-object customer approval fails closed on multi-object cases rather than
silently approving only the first; full multi-object application is still open.
The main TGT payload comparator matches explicit object/register identities and
own values rather than choosing the first matching object column.

## Reproductions and local verification

146 new Vitest cases, in four files: 50 core parser/matrix, 52 register conditions,
14 canonical/generic builders and 30 actual consumer cases. The first unchanged-
base run reproduced 49 failures / 1 pass. Later staged reproductions, immediately
before each relevant repair: conditions 25 failures / 27 passes; builders 14
failures; consumers 30 failures. These staged runs are not represented as one
146-case test of a common original head.

Current local full suite: 1,960 / 1,960 pass (217 files). App, script and test
TypeScript checks pass. All 848 retained Node source tests pass with unchanged
assertions. Immutable-package integrity passes (33 files, 121 rules, 231 planned
contracts; no application conformance asserted). Changed-TypeScript lint has no
errors; remaining unused-helper warnings are recorded, not hidden.

A retained dependent-catalog test fixture used nonexistent Z06V while expecting
complete valid context. It now supplies Z06F only for Z06; every assertion and
registry count is retained. No acceptance threshold was reduced. The C889 source
suite also exposed an over-restrictive new per-field reader: a legitimate trailing
empty fifth C889 component was rejected. The selected-field reader now preserves
that existing component contract, while never using another slot as its own value.
Complete unused-component/UNSM syntax qualification is not claimed by this reader.

Database boundaries in consumer tests are explicit in-memory mocks. The helper
workflow used to retrieve source material and any isolated patch transport are
not normal CI qualification. Exact-head ordinary CI and substantive independent
review are still required before merge.

## Open, blocking completion work (one active register unit)

1. **TGT source and rendering path.** `tgtEdifact.part-1.ts` still filters register
   rows and mixes source columns; part-2 builds ungrouped object rows; part-3 still
   emits one LIN and has old Z06-specific segments. Route these through the shared
   serializer using source-scoped object inventories. Preserve annotations only
   as source evidence; do not normalize away identifier punctuation. Explicit
   register column labels may identify register ordinals; field314 or arbitrary
   source column position must never stand in for field258.
2. **Other expected-data consumer.** `prodatExpectedContext.ts` and
   `prodatValidators.ts` still need the same exact object/register matching.
   Complete tests for source annotations, absent expected registers, same column
   names in different groups, and invalid-chain handling in the partial expected
   matcher. The main comparator's 30 consumer cases do not certify this second path.
3. **Preflight facts and unknown outcomes.** Persist authoritative per-object
   register facts in canonical engine diagnostics, pass them through row preflight
   and rulebook resolution, and ensure an unresolved register condition cannot
   be downgraded to a nonblocking test-send warning. Do not infer readings from
   214/218/259 presence. Test both successful full messages and blocked sends,
   including the existing `dependent_only` entry path.
4. **Inventory and application boundaries.** Add explicit external expected-count
   and missing-whole-object tests, duplicate/unknown fact records, and source-backed
   numeric 213 syntax limits. Resolve object-scoped customer application before
   treating multi-object importing as fully complete. Never remove its fail-closed
   guard merely to make a fixture pass.
5. **Qualification and review.** Run all ordinary workflows on the published final
   head, remedy actual findings with reproductions, re-read head/main/checks and
   perform guarded merge only after the complete register unit is accepted.

Next action is item 1, with failing tests first, followed by items 2–5. Unit B
(the remaining 110 national D conditions) must not begin before this unit merges.
