# F3-A: PRODAT reporting and permission locator coherence

Independent continuation from PR313/c83b9c51; PR310 remains paused and excluded.
Source: immutable PRODAT P annex, §2.6 pp49,52,78 and field register; original
source files and their hashes are unchanged. This is not all F3 or certification.

## Actual defects reproduced

Matrix fields302/321 selected163/164 instead of90/91;326 selected171 instead of693;
327 selected273 instead of164;325 selectedZPI instead ofZ09. Required-field checks
could count empty composites as data. The parser reclassified RFF Z07 (object
reference) as permission identity, and used265/324/597 as permission creation.
The renderer omitted the permission id/creation on positive Z14 and Z15, used
an agreement reference as a fallback Z18 permission id, truncated reporting
start minutes to midnight, omitted finite nonhistorical report ends, and emitted
reporting starts on negative Z14N. These affect existing consumers without SQL.

## Correction and bounded guarantees

Reconcile the five matrix locators while preserving all R/D/O requirements.
Require the value component (not a qualifier/format) for those required fields;
even empty forbidden fields remain forbidden. Keep reporting90/91, creation693,
and cessation164 distinct. Parse only Z09 permission identity, exposing the
independent cessation timestamp on the parsed projection. Emit ids/creation on
positive Z14 and Z15/Z18 without substituting legal agreement references. Preserve
minute precision, finite reporting ends, and suppress these values on Z14N.

## Tests and limits

`node --experimental-vm-modules --test scripts/test-ediel-prodat-source-locators.cjs`
loads only actual local Ediel modules, with no DB/network/renderer mocks.
28 tests:26 failed against pristine c83b9c51, then28 passed after correction.
The tests include independent source-register expectations, rejected wrong
qualifiers, empty required/forbidden values, actual renderer/parser integration,
and independently varied timestamps. Existing23 F1 source tests still pass.
Persistent Ediel CI runs both groups. Full Vitest/typechecks/normal CI must also
pass on the published integrated commit before merge.

This does not implement all object/register overlays or full UNSM validation.
The legacy test renderer and permission lifecycle persistence are separate
consumers requiring follow-up source review; parser projection is not proof of
live permission mutation. No live message, database, schema, grant, generated
type or PR310 source has changed. No deployment/certification is asserted.

Skills: source-contract review, systematic debugging, TDD and differential review;
verification uses real sources. No separate human/agent review is claimed. SQL,
UI and performance skills do not apply to this bounded protocol correction.
