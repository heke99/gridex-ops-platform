# Batch 4 — Canonical Ediel EDIFACT Rulebook + Field Matrix + Certification

## Status

This context documents the intended Batch 4 implementation for Gridex after merging the old Batch 4 Field Matrix import/review work with the new canonical EDIFACT rulebook scope.

Batch 4 must be production-safe. It must not only pass Edielportal tests. It must implement one shared Ediel Decision Engine that is used for AGT/TGT/regression and production. Test cases are evidence/regression, not business logic.

## Explicit scope

Build now:

- PRODAT
- UTILTS
- APERAK
- CONTRL
- UTILTS_ERR
- Supplier AGT: L1, L2, L3, L4, L5, L7
- Supplier UTILTS AGT: UL1, UL2, UL3, UL4, UL6
- Energy service company AGT: E3, E4, E5, E6, E7, E8
- Energy service company UTILTS AGT: UE1, UE2

Do not build now:

- NBS/XML/eSett
- BRP/trader XML flows
- gas/natural gas support
- ECP/EDX transport
- full bilateral test manager

Unsupported families/markets/transports must be blocked or sent to manual review instead of being processed by the EDIFACT decision engine.

## Core architecture rule

Do not implement test-case hardcoding:

```txt
E7 => negative APERAK
L3 => negative APERAK
Z14 => positive APERAK
```

Implement engine-based decisions:

```txt
payload
+ BGM code
+ Application Reference
+ NAD/RFF/LIN/DTM/CCI/CAV
+ actor role
+ route/subaddress
+ tenant
+ customer/site/metering point
+ permission/process state
+ rule profile
+ ACK lifecycle
+ confidence policy
=> CONTRL / APERAK / UTILTS_ERR / manual_review / blocked
```

`testCaseCode` may be used only for:

- test-run linking
- UI labels
- portal expected/actual reports
- regression
- diagnostics
- golden result tracking

`testCaseCode` must never directly control:

- positive/negative APERAK
- positive/negative CONTRL
- UTILTS_ERR
- ERC/FTX mapping
- production decision
- production routing

## Main files added/changed by Batch 4

Rulebook and engine:

- `lib/ediel/decisionEngine.ts`
- `lib/ediel/rulebook/index.ts`
- `lib/ediel/rulebook/canonicalRules.ts`
- `lib/ediel/rulebook/prodatRulebook.ts`
- `lib/ediel/rulebook/utiltsRulebook.ts`
- `lib/ediel/rulebook/aperakRulebook.ts`
- `lib/ediel/rulebook/contrlRulebook.ts`
- `lib/ediel/rulebook/testCaseRuleRegistry.ts`
- `lib/ediel/rulebook/compileRuleProfile.ts`
- `lib/ediel/rulebook/evaluateFieldMatrix.ts`
- `lib/ediel/rulebook/fieldMatrixImport.ts`
- `lib/ediel/rulebook/mapEdielError.ts`

Admin UI:

- `app/admin/ediel/page.tsx`
- `app/admin/ediel/certification/page.tsx`
- `app/admin/ediel/rule-profiles/page.tsx`
- `app/admin/ediel/rule-profiles/actions.ts`
- `app/admin/ediel/masterdata-reconciliation/page.tsx`

SQL:

- `supabase/migrations/20260605183000_batch4_canonical_edifact_rulebook.sql`

Regression:

- `scripts/ediel-canonical-rulebook-regression.cjs`
- `scripts/ediel-certification-regression.cjs`
- `scripts/ediel-field-matrix-regression.cjs`

Package scripts expected:

```json
{
  "ediel:canonical-rulebook-regression": "node scripts/ediel-canonical-rulebook-regression.cjs",
  "ediel:certification-regression": "node scripts/ediel-certification-regression.cjs",
  "ediel:field-matrix-regression": "node scripts/ediel-field-matrix-regression.cjs"
}
```

`npm run ediel:regression` should include all three once merged.

## Known build fix after initial Batch 4 patch

A TypeScript export conflict occurred because both `fieldMatrix.ts` and `evaluateFieldMatrix.ts` exported `FieldMatrixEvaluationInput` through `lib/ediel/rulebook/index.ts`.

Fix applied:

- Rename the new type in `lib/ediel/rulebook/evaluateFieldMatrix.ts` to `FieldMatrixActivationEvaluationInput`.
- Keep `index.ts` exporting `evaluateFieldMatrix` safely.

If this error reappears, inspect `lib/ediel/rulebook/index.ts` and ensure there are no duplicate star-exported type names.

## Canonical rules admin must not override

Field Matrix imports may add/activate rule profile versions, but they must not override canonical safety rules:

- APERAK must not be sent on CONTRL.
- APERAK must not be sent on APERAK.
- CONTRL must not be sent on CONTRL.
- CONTRL must be sent on APERAK.
- First final APERAK wins.
- Opposite final ACK must be blocked.
- Wrong draft/prepared/queued ACK can be superseded.
- One APERAK per source PRODAT.
- PRODAT Z01 APERAK request is optional/exception.
- Unsupported gas/NBS/XML/ECP must not be processed as supported EDIFACT.
- Application Reference guards must remain active.
- Missing/wrong route/subaddress must block or manual-review, not silently send.
- PRODAT encryption must use receiver certificate and validate CMS recipientInfo.

## Application Reference rules

Electricity only for this batch:

- Supplier switch / ordinary PRODAT: `23-DDQ-PRODAT`
- Energy service company permission flows Z13/Z14/Z15/Z18: `23-DGI-PRODAT`

Guard rules:

- Z13/Z14/Z15/Z18 with `23-DDQ-PRODAT` => blocked/manual_review.
- Z03/Z04/Z05/Z06/Z09/Z10 with `23-DGI-PRODAT` => blocked/manual_review.
- `27-DDQ-PRODAT` => unsupported gas/natural gas, blocked/manual_review.

## Certification matrix

Approved golden results:

- L1 PRODAT Z03 — ID 388756 — approved
- L2 PRODAT Z04 — ID 388764 — approved
- L3 PRODAT Z05 — ID 388765 — approved
- L4 PRODAT Z06 — ID 388766 — approved
- L5 PRODAT Z10 — ID 388767 — approved
- L7 PRODAT Z09 — ID 388809 — approved
- UL1 UTILTS S03 — ID 388810 — approved
- UL2 UTILTS E66-KVART — ID 388811 — approved
- UL3 UTILTS E66-SCH — ID 388812 — approved
- UL4 UTILTS S02 — ID 388813 — approved
- UL6 UTILTS E31-SCH — ID 388814 — approved
- E3 PRODAT Z13V — ID 389178 — approved
- E5 PRODAT Z14V — ID 389280 — approved
- E6 PRODAT Z14N — ID 389301 — approved

Active fix target:

- E7 PRODAT Z15V — ID 389303 — failed

Pending readiness:

- E4 PRODAT Z13VH
- E8 PRODAT Z18V
- UE1 UTILTS E66-KVART
- UE2 UTILTS E66-SCH

Approved tests must be protected as golden regression and must not be broken by later changes.

## Supplier PRODAT AGT behavior

- L1 Z03: Gridex sends PRODAT Z03 to portal; portal returns CONTRL and negative APERAK.
- L2 Z04: portal sends PRODAT Z04; Gridex sends positive CONTRL + negative APERAK.
- L3 Z05: portal sends PRODAT Z05; Gridex sends positive CONTRL + negative APERAK.
- L4 Z06: portal sends PRODAT Z06; Gridex sends positive CONTRL + negative APERAK.
- L5 Z10: portal sends PRODAT Z10; Gridex sends positive CONTRL + negative APERAK.
- L7 Z09: Gridex sends PRODAT Z09 to portal; portal returns CONTRL and negative APERAK.

These are not hardcoded outcomes. They are caused by ordinary PRODAT rulebook + route + portal/test context + object/process not being identifiable in the production application/test portal.

## Supplier UTILTS AGT behavior

- UL1 S03
- UL2 E66-KVART
- UL3 E66-SCH
- UL4 S02
- UL6 E31-SCH

AGT UTILTS cases must not be answered with negative APERAK if the rulebook/test requires negative UTILTS/UTILTS_ERR. Expected pattern:

```txt
inbound UTILTS
=> positive CONTRL
=> negative UTILTS / UTILTS_ERR where applicable
=> portal sends APERAK on Gridex response
```

## Energy service PRODAT AGT behavior

- E3 Z13V: Gridex sends PRODAT Z13V; portal returns CONTRL and negative APERAK.
- E4 Z13VH: Gridex sends PRODAT Z13VH; portal returns CONTRL and negative APERAK.
- E5 Z14V: portal sends PRODAT Z14V; Gridex sends positive CONTRL + negative APERAK.
- E6 Z14N: portal sends PRODAT Z14N; Gridex sends positive CONTRL + negative APERAK.
- E7 Z15V: portal sends PRODAT Z15V; Gridex must send positive CONTRL + negative APERAK. Current active fix target.
- E8 Z18V: Gridex sends PRODAT Z18V; portal returns CONTRL and negative APERAK.

## Permission lifecycle

State machine:

- Z13 = request access to meter values.
- Z14 = response: approved/denied/historical.
- Z18 = request to end reporting.
- Z15 = permission ended.

Match using:

- `company_id`
- Application Reference = `23-DGI-PRODAT`
- sender/receiver Ediel ID
- `LIN` / metering point id
- `RFF+Z05` / grid area
- `RFF+LI` / case/reference
- `RFF+Z09` / permission id
- `NAD+UD` / end customer
- active permission/process state

Production safety:

- Safe correct match => positive APERAK.
- Safe deterministic business/application error => negative APERAK.
- Uncertain match/state => manual_review.

AGT/TGT:

- Safe portal/test context + production object/process not identifiable => negative APERAK/UTILTS_ERR according to the same rule engine.

## Z15/Z18 key rules

Z15 must allow:

- `NAD+FR`
- `NAD+DO`
- `NAD+UD`
- `LIN`
- `DTM+693`
- `DTM+164`
- `CCI+Z13 / CAV+S17`
- `CCI+Z23`
- `CCI+Z25`
- `RFF+Z05`
- `RFF+LI`
- `RFF+Z09`

Remove false assumptions:

- `NAD+UD` is not forbidden.
- `NAD+FR` is not forbidden.
- `LIN` is not forbidden.
- `DTM+164` is not forbidden.
- `RFF+ZPI` must not be treated as required for these permission flows.

Z15 decisions:

- Valid Z15V + active permission => positive APERAK.
- Object/permission not identifiable => negative APERAK.
- Invalid permission status => ERC 41 / FTX 322.
- Invalid end reason => ERC 41 / FTX 324.

Z18 decisions:

- Valid Z18 + active permission => positive APERAK.
- Missing end reason => ERC 41 / FTX 324.
- Actor not connected to installation => ERC 40 / FTX 107.

## UTILTS decision split

- Syntax error => CONTRL.
- Guide/application error => negative APERAK.
- Functional/process error => UTILTS_ERR.
- Correct UTILTS => positive APERAK.

Special care:

- E66 quarter/SCH and E31 SCH must select the correct response type.
- Transaction-scoped APERAK must preserve correct transaction references.
- RFF+TN, RFF+ACW, DOC, STS, NAD+DDK and NAD+DDQ must be handled by the appropriate UTILTS response builder.

## ERC/FTX canonical mappings

Minimum canonical mappings:

- ERC 100: OK / positive APERAK.
- ERC 40 + FTX 105: `The object could not be identified`.
- ERC 40 + FTX 107: actor not connected to installation.
- ERC 41 + FTX 322: invalid permission status.
- ERC 41 + FTX 324: invalid/missing permission end reason.
- ERC 41 + FTX 511a/511b/511c/511d/511e: UTILTS E31/SCH application error.
- ERC 41 + FTX 512: mandatory field missing.
- ERC 42 + FTX 209: invalid metering point id.
- ERC 42 + FTX 260: invalid grid area id.

FTX text must use short canonical texts to avoid portal validation failures such as field content oversized.

## Routing, subaddress and encryption

Route profile must include:

- sender Ediel ID
- sender subaddress
- receiver Ediel ID
- receiver subaddress
- SMTP address
- environment
- message family
- Application Reference
- encryption_required
- certificate profile

Ediel portal PRODAT route:

- receiver Ediel ID: `91100`
- receiver subaddress: `PRODAT`
- SMTP: `91100@ediel.se`
- UNB receiver: `91100:ZZ:PRODAT`

Rules:

- Missing receiver subaddress => block_send.
- Wrong receiver/subaddress => manual_review or negative acknowledgement depending on discovery layer.
- PRODAT encryption => encrypt to receiver certificate, not sender/shared mailbox certificate.
- CMS recipientInfo must match receiver identity before send.

## ACK lifecycle

Incoming lifecycle:

- incoming positive CONTRL => technical accepted.
- incoming negative CONTRL => technical_stop/action_required.
- incoming positive APERAK => business accepted and link to original outbound/process.
- incoming negative APERAK => business rejected, parse ERC/FTX, link to original outbound/process, create action_required/manual_review.
- incoming APERAK => send CONTRL only.
- incoming CONTRL => do not send CONTRL and do not send APERAK.

Outgoing lifecycle:

- first final APERAK wins.
- same final ACK/outcome already sent => already_sent/success.
- opposite final ACK/outcome already sent => blocked/manual_review.
- wrong draft/prepared/queued ACK => supersede.
- one APERAK per source PRODAT.
- multi-facility PRODAT must support partial acceptance/rejection.

## Duplicate/order/resend rules

Implement:

- duplicate detector
- same facility + same switch date guard
- same permission duplicate guard
- wrong order detector
- resend after negative APERAK guard

Rules:

- Same BGM/reference => duplicate.
- Same facility + same switch date => not a new process.
- Resend after negative APERAK requires new BGM/message id.
- Z04 before positive APERAK on Z03 can be tolerated according to process.

## AI-list/masterdata reconciliation foundation

Build foundation, not a full advanced module yet:

- AI-list import.
- metering point masterdata snapshot.
- grid owner/supplier data diff.
- missing metering point candidates.
- customer identity candidates.
- permission match candidates.

Purpose:

- Reduce manual review in production.
- Improve customer/site/metering point/process matching.
- Send negative APERAK only when object is deterministically not identifiable.

## Manual review taxonomy

Use clear reason keys:

- unknown_tenant
- unknown_route
- ambiguous_process_match
- missing_business_state
- field_matrix_conflict
- test_expected_conflict
- wrong_final_ack_exists
- certificate_mismatch
- customer_match_low_confidence
- metering_point_match_low_confidence
- permission_match_low_confidence
- unsupported_market_gas
- unsupported_message_family_nbs_xml
- unsupported_transport_ecp_edx
- portal_expected_actual_mismatch

## UI rules

Keep UI simple.

Admin Ediel start page should show only high-level cards:

- Certification
- Rule profiles
- ACK lifecycle / Kvittensflöden
- Manual review
- Masterdata

Certification page should be a simple table:

```txt
Testfall | Meddelande | Status | Senaste beslut | Nästa steg
```

Technical details must be behind `Visa teknisk trace`.

Tenant/company UI must not expose raw EDIFACT tables by default. Tenant admin should see:

- Customer
- Installation/metering point
- Case
- Status
- Next step

Tenant-facing statuses:

- Kontroll pågår
- Väntar på motpart
- Klar
- Åtgärd krävs
- Tekniskt stopp

Tenant admin must never choose positive/negative APERAK manually.

## Validation commands

After applying Batch 4 and the export build fix, run:

```bash
npm run ediel:canonical-rulebook-regression
npm run ediel:certification-regression
npm run ediel:field-matrix-regression
npm run ediel:regression
npm run typecheck
npm run build
```

If `npm run build` fails, do not assume rule logic is wrong. First identify whether the error is:

- TypeScript export/import issue.
- Server/client component boundary issue.
- Missing Supabase type/table mismatch.
- Route/action signature mismatch.
- Actual rulebook logic issue.

## Important implementation warning

The generated patch zip should only contain changed/added source files. Do not intentionally include build artifacts such as `tsconfig.tsbuildinfo` in future patches.

If a patch zip accidentally includes `tsconfig.tsbuildinfo`, it is usually safe but unnecessary. Prefer removing it from the patch before applying or deleting it after extraction.

## Definition of done

Batch 4 is complete only when:

- `npm run ediel:canonical-rulebook-regression` passes.
- `npm run ediel:certification-regression` passes.
- `npm run ediel:field-matrix-regression` passes.
- `npm run ediel:regression` passes.
- `npm run typecheck` passes.
- `npm run build` passes.
- SQL migration has run successfully.
- Approved L/UL/E3/E5/E6 tests are protected as golden regression.
- E7 is traceable as active fix target and can be corrected with portal diff/payload.
- E4/E8/UE1/UE2 have readiness checks.
- UI shows backend decision, not requested/test outcome.
- Field Matrix import activates versioned profiles but cannot override canonical safety rules.
- incoming APERAK/CONTRL links to original message/process.
- uncertain production cases go to manual_review.
- unsupported gas/NBS/ECP is blocked/manual_review.

## Batch 4 follow-up — all certification sends must go through Systemtest

All AGT/TGT certification traffic must be initiated, sent, linked and verified through `/admin/ediel/system-tests` or `/admin/ediel/system-tests/cases/[id]`.

Do not send certification PRODAT from a generic outbound page, customer card action or raw EDIFACT editor unless that flow explicitly attaches the message to the active `ediel_test_run` and uses the same Systemtest send action.

Required behavior:

- Actor → portal tests such as L1, L7, E3, E4 and E8 create the first outbound PRODAT from the Systemtest run.
- Systemtest shows the generated outbound message in the run and exposes the button `Skicka från Systemtest`.
- The send action locks the message to `testRunId`, `testCaseCode`, selected route profile, selected encryption mode and the expected step before calling SMTP send.
- Portal → actor tests such as L2-L5, E5-E7, UL/UE start the run and wait for inbound IMAP from the portal.
- IMAP sync must keep `tgtTestCaseCode`/`testCaseCode` so inbound messages attach to the correct active run.

E8 specifically:

- E8 is actor → portal.
- Systemtest must create `PRODAT Z18V` as step 1.
- Receiver must be Edielportalen `91100:ZZ:PRODAT`, SMTP `91100@ediel.se`.
- Application Reference must be `23-DGI-PRODAT`.
- The test-run encryption choice must follow draft → send → SMTP → audit.
- Portal response is expected as positive CONTRL and negative APERAK for AGT, because the content is not known in the portal/test production application.

E7 follow-up:

- E7 is portal → actor.
- The approved live behavior was positive CONTRL + backend-driven negative APERAK.
- Systemtest expected/facit must therefore show E7 APERAK as negative, not positive.
- Field Matrix must not forbid `NAD+UD` for Z15; if negative APERAK is required it must be due to object/permission/process not identified, not because Z15 structure falsely blocks allowed segments.

UE1/UE2 follow-up:

- UE1/UE2 are portal → actor UTILTS E66 tests.
- Systemtest should create positive CONTRL and negative UTILTS/UTILTS_ERR where AGT expects a negative UTILTS response.
- Do not respond to UE1/UE2 with negative APERAK when UTILTS_ERR is required.

Runtime-suite rule:

- When a test run is AGT, `runTgtAutopilotForRun` must resolve runtime settings using `testSuite = AGT`, not hardcoded `TGT`.
- This is required so actor Ediel ID, route profile, PRODAT subaddress, certificate environment and SMTP environment are the AGT settings.
