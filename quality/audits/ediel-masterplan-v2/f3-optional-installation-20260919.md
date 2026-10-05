# Z01/Z03/Z08 optional installation — locally verified candidate

**Status: implemented and locally verified. The six cells are not accepted.**
Independent root review, publication, ordinary GitHub CI, exact-head review and
merge remain required before the masterplan count may change.

Accepted code base: `19ca7e074d4a337620bd041394b22e637e83a9b4` (merged PR339).
The retained starting HEAD was `72fa4352d2a38cb150f2df60448dfc173b3a85ba`,
which adds only the root memory checkpoint to that accepted base. This task did
not edit active memory, frozen normative projections, migrations or remote state.
PR310 remains paused and none of its changes were imported.

## Scope and source qualification

This candidate covers exactly PC-233 and PC-234 for Z01, Z03 and Z08: six
numeric D cells. They are children of the optional IT parent and are not counted
as additional occurrences in the separate ten-parent inventory.

The frozen P26.A r3 projection gives the governing rules:

- page 22 marks the installation parent O for Z01/Z03/Z08 and fields 233/234 D;
- the page-22 parent note says the installation address need not be included for
  these message codes;
- the page-22 field notes say that, when installation is sent, field 233 always
  has the same value as field 209 and field 234 has one to three rows;
- the NAD+IT table on page 81 requires the party identity and a 9/89 agency,
  limits the identity to 25 characters, and requires the first of at most three
  address components, each limited to 35 characters.

Consequently, absent IT creates neither a child requirement nor an unknown.
Once an object supplies IT, actual wire presence selects the parent for that
object and both children become mandatory. Field 233 must equal that object's
actual LIN field 209, including the same valid agency. Root facts, arbitrary
`byCell` values, another object, a sibling group or a later message cannot stand
in for the object's own parent or children. Supplied malformed, duplicate,
header or misplaced IT is inspected before object narrowing and cannot vanish.

The direct condition engine now represents the phase boundary explicitly. Its
`not_required` result has `decisionPhase: pre_wire_parent`: there is no blanket
child requirement before an optional parent is selected, but this is not
source-verified evidence that every object lacks IT. Builder diagnostics replace
that with `decisionPhase: rendered_wire_parent` and the actual emitted choice.
Canonical outbound validation and send preflight independently recompute the
choice from wire, so a caller or persisted snapshot cannot use either phase to
hide a supplied invalid group.

## Demonstrated gaps and TDD

Before implementation, the new actual-module suite had 28 cases: 10 failed and
18 passed. The failures demonstrated that optional IT could be decided through
message-wide facts, malformed/header/duplicate/wrong-object groups were not all
protected by the bounded parent rule, the generic builder ignored explicit
optional installation input, and profile rendering could emit an incomplete
optional group.

An early test/design draft proposed a new explicit selection flag and treated
installation-specific address input as unrelated shared address data. Review of
the actual profile API disproved that premise: `siteAddress`,
`siteAddressLines`, `siteIdAgency` and `siteCity` are already installation data.
The flag, its assertions and the unsupported claim were withdrawn. Complete
installation-specific profile data continues to select a valid IT group.
Generic `object.installation` remains its existing explicit parent intent.
Incomplete optional profile data is omitted; an explicitly supplied incomplete
generic group is emitted into validation and rejected rather than hidden.

One full-suite run then exposed a preserved batch assertion: all official D
conditions must be determined with complete explicit facts. The initial
pre-wire `undetermined` representation violated both that assertion and the
source rule that absent optional IT creates no unknown. The final phased
representation is deterministically `not_required` before wire selection,
ignores `byCell`, and is overwritten only by rendered-wire evidence. The
original assertion remains unchanged.

The release regression previously expected address-only IT when field 209 was
missing. That output contradicts the qualified source because field 233 is
mandatory within a used IT group and must equal actual 209. This one baseline
expectation was source-corrected to require optional IT omission. Its existing
`LIN+1` and no-placeholder assertions remain. The counterpart with complete own
identity and installation address still emits valid IT. This is an explicit
source correction, not a claim that every prior assertion was byte-for-byte
unchanged.

## Implementation boundaries

- The bounded validator scans all supplied IT segments first, then validates
  cardinality, placement, exact qualifier/components, decoded lengths, own LIN
  identity/agency equality and the required child descriptors per object.
- Canonical outbound fields, subtype/send fallback, payload preflight and send
  lock use the wire policy. A complete persisted condition snapshot that claims
  `not_required` is covered and cannot bypass the wire result.
- The generic builder now honors existing `object.installation` for Z01/Z03/Z08
  and validates its final wire. Its identity-agency fallback is limited to these
  three optional paths.
- The profile builder selects IT from complete, correctly scoped installation
  identity and address data and exposes rendered-wire diagnostics.
- Existing required-IT codes and Z14 retain their prior rendering and agency
  defaults. Existing party syntax protections and identity boundaries remain.
- Inbound stays parse-only for these six outbound source conditions.
- PC-321/323 remain blocked for lack of authoritative producer facts. No flow
  was enabled for them.

## Final local verification

| Check | Result |
|---|---|
| New optional-installation suite | 35/35 |
| Relevant ten-file protocol/build/send set | 359/359 |
| Original `gridex:z01-facility-no-placeholder-regression` entrypoint | passed; selected installation contract 6/6 |
| Full application suite | 3,411/3,411 in 249 files |
| App TypeScript | passed |
| Scripts TypeScript | passed |
| Tests TypeScript | passed |
| Masterplan integrity | 33 original files, 121 rules, 231 acceptance contracts; passed |
| Large-file budget | passed |
| Performance/tenant, N+1 and SLO gates | passed |
| `git diff --check` | passed |

The suite covers all three supported UNA alphabets, all three message codes,
absent and valid parents, partial and duplicate groups, header/misplaced scope,
wrong object identity, wrong agency, sibling objects, later messages, direct
condition-engine behavior, canonical validation, generic/profile builders,
rendered diagnostics, persisted-status override attempts, preflight/send lock
and inbound parse-only behavior. The final run used Node v24.19.0 and the
unchanged installed dependencies.

No local result is a publication or acceptance certificate. Root review and
ordinary CI must assess the exact committed revision. Accepted counts remain
30/110 numeric D cells and 4/10 parent occurrences. These six cells remain a
candidate until review, CI and merge; the four PC-321/323 cells remain blocked.
