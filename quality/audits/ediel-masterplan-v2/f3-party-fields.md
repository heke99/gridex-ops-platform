# F3-F — PRODAT NAD field projection and party consumers

Status: IMPLEMENTED_NOT_VERIFIED (ordinary exact-head PR CI is required).
Date: 2026-09-17. Base main `2d65dc9fdc66738cc66984ec91350adace34eb0d`,
source tree `be9ca7ee44f2594100efb50328006e114fca2f91` after merged PR325.
Work branch: `codex/ediel-v2-prodat-party-fields-20260917`.

## Scope and authority

The original P26.A revision3 field register, all13 usage columns, original
33 files/121 rules/231 acceptance contracts are unchanged. Authority is the
locked P source (SHA256 `83c2f1d2915851d2e670731f6ab404ef06c9b9def282afbafdfa0eda836a6e95`),
section2.6 pp45–46 and79–83, and its independently retained source tables.

All20 mapped NAD fields are handled: 207/208 FR/DO; 227/228/229/231/232/316 UD;
233/234/235/236/237 IT; 250/251/252/253/317/318 IV; 262 Z02. The descriptors
select C082/3039, the two C080 name components, three C059 address components,
3164 city, 3251 unedited postcode and3207 country rather than arbitrary whole
segments. 207/208 include the mandatory two-character legal-party country.
The technical UNB route remains separate. LIN209 is not substituted for NAD233.
ID qualifiers1/SE1/SE2 use ebIX260, not ZZZ; explicit distributor IDs use89 with
no list qualifier. IT uses agency9 or89 and max25; other party IDs max35.
Country shape is checked against these source definitions; this is not an
independent live ISO/Ediel actor-registry validation or national-ID certificate.

The shared source projector retains case, leading zeroes, inner spaces, released
separators, empty name/address positions and custom UNA syntax. Missing first
object/header values cannot borrow from another party, later object/message or
stale parsed snapshot. Required, forbidden and supplied optional values are
checked without promoting national D cells to unconditional R. Supplied NAD
groups also receive source-table format/length/unused-element/scope checks;
IT233 must agree with its own LIN209. Z14N's inapplicable parents stay excluded.
Full UNSM/cardinality, registered actor validity and all110 national D cells are
not claimed by these checks.

## Implementation consumers

- Real PRODAT parser, matrix and canonical policy field evaluation, including
  UNA propagation through canonical/runtime/rulebook call sites.
- Main renderer, compatibility builder and compatibility ingress, transport
  projections and payload preflight. Explicit legal actors and multicomponent
  UD/IT/IV data are supported; IV is never manufactured from UD. Source-forbidden
  groups/child address fields are not emitted. Missing input is not replaced by
  a previous supplier, site label or `KUND`. Invalid/oversized data is rejected,
  not compacted/truncated. Swedish outbound country defaults remain explicit;
  inbound source absence is not assigned SE by the source projector.
- Customer staging consumes UD; installation address consumes IT, not UD/IV or
  cached aliases. Invalid agency evidence cannot become a Swedish national ID.
  Structured-only legacy inputs retain their explicit fallback values. A
  malformed nonempty wire throws rather than falling back to cached identity.
- TGT comparison uses the exact20 fields and supported name/address subfields,
  preserving the expected source unchanged. Comparing source values alone is
  not a declaration that all message validity/market tests passed.
- Permission matching uses the actual well-formed UD identity, never IV or
  punctuation/case-folded aliases. A wire-backed candidate missing valid UD
  cannot become the legacy optional-match wildcard. A nonempty headerless
  candidate cannot acquire a stored customer identity. The privileged request
  candidate query now requires/filters the source company and rejects returned
  foreign-company rows. This is a bounded consumer correction, not full F2/F5
  cross-tenant or permission-lifecycle certification.

## Executed local evidence

`node --experimental-vm-modules --test scripts/test-ediel-prodat-party-fields.cjs`
executes264 synthetic actual-source cases. The same final test file against an
unchanged archive of base treebe9ca7ee gives30pass/234fail; the corrected source
gives264/264pass. These include descriptor assertions as well as runtime
regressions, not234 separately claimed production incidents. Earlier harness
and synthetic-fixture corrections (native crypto import, valid concatenated
messages, proper subtype codes and UD optional address positions) are excluded
from this final before/after result.

The additional permission-boundary batch reproduced6 failures before correction
(malformed/empty/missing candidate identity, missing tenant query scope, absent
scope and nonempty headerless source); all9 permission cases then passed. The
service is a declared in-memory query boundary, never a real Supabase mutation.

Combined final source suite:848/848 =264new +584retained, comprising guide98,
rule-pack43, source locators28, characteristic124, references105, BGM145,
component escaping41 and NAD264. The specification integrity check and unchanged
large-source-file budget pass. Node22.16.0 was used locally.

The permanent Ediel workflow additionally runs
`__tests__/ediel-prodat-party-consumers.test.ts` (actual module imports, Vitest).
Local dependency installation is unavailable; those cases and full application,
script/test TypeScript, Vitest, lint, API/RBAC, security audit, build, budgets,
smoke/browser/certificates and ordinary-main replay MUST pass in ordinary CI on
the final PR head before this unit can be marked verified/merged. The source
suite does not replace those gates or a live market/TGT run.

## Synthetic fixture corrections (no original normative/TGT input changes)

1. Existing identity helper tests incorrectly expected SE1/SE2:ZZZ; they now
   require source-backed260 and explicitly prohibit ZZZ. New negative vectors
   prove that the original wrong-agency wire blocks in actual preflight.
2. One RFF source test and its equivalent Vitest test asserted a cached customer
   name even when the nonempty wire had no UD. Their reference assertions stay
   intact; the unrelated customer expectation now remains null. New positive,
   negative and structured-only cases exercise the intended NAD contract.
3. Three BGM compatibility-builder variants now give their incidental customer
   fixture an explicit distributor agency89 and a name. Their BGM/ACK assertions
   are unchanged; the existing bare-ID fixture lacked required supplied-NAD data.

## Skills and dependency review

Applied repository knowledge, specification-to-code compliance, systematic
root-cause debugging, test-driven/variant/property-style testing, code-security
and differential review, verification-before-completion and quality-playbook.
Supabase guidance informs scoped privileged reads. Finishing-branch and review
procedures apply at publication. No separate agent reviewed this code; source
review and executed tests must not be described as independent human approval.
UI/React/Vercel performance, SQL optimization/migrations, hooks, skill authoring,
SARIF/CodeQL-specific processing and new dependency sourcing have no change
trigger in this bounded server-side parser unit. Existing ordinary repository
security/performance/build gates still run unchanged.

PR310 SQL, snapshot/proof machinery, generated DB types and paused branch are
not dependencies of this unit and are not imported. No SQL/types/grants,
production DB/storage changes, explicit deployment or external messages.
Supabase discovery only confirmed the existing project; no live acceptance
state was changed. The admin-reviewed application of staging drafts is not
certified by pure projection tests.

## Next

Read exact ordinary PR head/CI/review state; fix actual regressions before a
SHA-guarded merge. Then remaining DTM/register/dependent-field work from new
main. This unit does not certify all74 fields, all110D, full F3, F7 or the whole
masterplan. PR310 remains paused at e9611351 with its recovery branch intact.
