# F3-C — source-backed PRODAT characteristic value projections

Base main b1e077288c8a6865c413c1bf366797b3a23d07d8, tree
c72835116cfbbfc78f1a4704814109208ec87a78 (merged PR322).
PR310 and its recovery reference remain paused and untouched.

## Acceptance for this work item

The existing field matrix is the single source for the nineteen PRODAT
SG14 CCI/CAV qualifiers and their exact C889 component positions. Both value
projection and presence/code checks must use that same descriptor. Field508 is
DTM354, never the old constant in CCI Z03. Preserve all thirteen message usage
classes and all existing parent/dependent conditions; do not infer register2+
requirements from the base matrix. Product242 and energy506 share Z14 but have
separate fourth/fifth components. Agency, list identity, empty values, escaped
separators or another line/message must not manufacture a selected field value.

## Source and reproduction

Immutable `docs/ediel/masterplan-v2/registers/prodat_fields.json`, P26.A revision3
§2.6 pp55–74, and the user's original PRODAT PDF tables were compared. In
particular the rendered source pages55,63,68 show C889 7111/1131/3055/7110/7110,
constant214 as CAV+:::10, reporting222 as CAV+:::M, product242 as CAV+:::L917 and
energy506 as CAV+::::8716867000030. Original source-package bytes are unchanged.
The original PDF is referenced/read, not claimed newly downloaded/hash-verified
or newly certified. No TGT reference bytes or normative hashes are invented.

Initial116 actual-source cases reproduced83 failures (33 passed). Defects included
wrong matrix qualifiers, first/last-nonempty CAV decoding, reading metadata as a
value, borrowing CAV across group boundaries, Z05 digit versus product collision,
Z03 constant versus duration collision, and treating valid Z04 product242 as
misplaced permission energy506. Additional variant review found the same faulty
projection in TGT comparison, TGT preflight, the permission/ACK decision and
customer-staging projections. These consumers are updated, not left as competing
qualifier tables. Stale parsed characteristic projections no longer override
available wire fields in customer staging; structured-only fallback is retained.

## Implementation and affected callers

`prodat26AFieldMatrix` retains all R/D/O/- cells and adds a zero-based C889 component
descriptor. `prodatCharacteristicFields` uses the existing release-aware tokenizer
and adjacent pairs. `fieldMatrix` checks the selected value, including all repeated
values for allowed-code checks; empty forbidden pairs still block, while a valid
shared-Z14 sibling alone does not become a forbidden field.

Consumers: PRODAT line parser; canonical AST and line facts; canonical/rulebook
subtype readers; TGT comparison; production and TGT preflight; permission validation;
ACK decision; inbound customer staging. Z15's required status322/end-reason324
cannot pass through wrong-slot metadata or an unsupported Z26 fallback. Existing
41/42 missing/invalid classifications and existing allowed-code lists are used;
this change does not certify those lists or every permission transition.

The Z09 producer-local postprocessor already reads the coded first component of
its own canonical renderer output; no untrusted wire input enters that helper.
UTILTS-only helpers and generic non-PRODAT CCI projection remain unchanged.

## Verification

Final local actual-source harness:124 tests passed, including generated
19-field x3-value combinations in each of three UNA alphabets. The generated cases
verify component projection, not complete custom-UNA support in every legacy
parser/validator. Initial116 cases were run before and after the fix. The only
synthetic service boundary throws on any database access; production source code
is loaded for the tested functions. Independent literal component arrays are used,
not only renderer/parser roundtrips. The real permission renderer also matches
explicit independent wire expectations.

Existing source harnesses:210/210 passed (98 guide +112 retained source/locator/
escaping cases). Combined source run334/334 passed. Specification integrity33 files,
121 rules,231 contracts and APERAK guard pass; those are not application acceptance
counts. Sixteen new Vitest cases exercise actual production/TGT preflight, inbound
staging and ACK callsites. Their execution plus all TypeScript, lint, full suite,
build and normal exact-head PR CI remain required before merge. Local npm is not
available (ENOTCACHED); no full local Vitest/build success is claimed.

## Remaining scope, not hidden completion

This work item addresses exact characteristic-field decoding and its identified
consumers. It does not certify all74 PRODAT fields/110 dependent conditions,
full UNSM grammar, future energy-sharing, whole F3/F7, actual grants or live TGT.
Non-characteristic NAD/RFF/date projection, per-register overlays and complete
permission status/process semantics remain independently named work. No production
customer records, DB schema/RLS, original messages or files are rewritten; no
external SMTP/Ediel traffic is sent.

## Verification routing

Used project memory and installed TDD, systematic debugging, spec-to-code,
variant-analysis and verification-before-completion workflows. CI preserves all
existing required gates and budgets. No independent human/subagent approval is
claimed. No UI/deployment/SQL change; those additional execution skills are not
invoked. An isolated publishing/qualification job may apply the exact reviewed
patch against the pinned base and assert the tested Git tree; it is not a substitute
for ordinary PR CI and is not included in the final application tree.
