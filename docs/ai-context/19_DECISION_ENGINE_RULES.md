# Decision Engine Rules

## Purpose

Gridex must use production logic that is verified through TGT/AGT, not test logic that happens to work in production.

The same decision engine should be used for:

- TGT/systemtest
- AGT/actor test
- bilateral tests
- production/live

The difference is context, not separate engines.

## Inputs every decision should consider

- tenant/company id and tenant-resolution confidence
- environment: test/production where relevant
- test kind: TGT, AGT, bilateral or production
- message family: PRODAT, UTILTS, APERAK, CONTRL, UTILTS_ERR
- BGM/message code
- Application Reference
- sender and receiver Ediel ID
- sender and receiver subaddress
- actor role/subordinate role
- route profile
- transport/encryption requirements
- parsed EDIFACT payload
- related source message/business process
- known customer/site/metering point/permission state
- selected rule profile/version

## Core pipeline

1. Receive or prepare message.
2. Resolve tenant/company safely.
3. Parse EDIFACT.
4. Identify message family and BGM/message code.
5. Classify scenario/variant/process.
6. Select rule profile.
7. Run syntax, application, business and process validation.
8. Decide response: CONTRL, APERAK, UTILTS_ERR, manual_review or rule_conflict.
9. For TGT/AGT, compare engine result against expected test step.
10. Create/send ACK idempotently.
11. Log decision trace, rule profile and reason.
12. Show tenant-safe business status in UI; technical trace only to superadmin/technical admin.

## CONTRL rules

CONTRL is technical/syntax-level acknowledgement.

- syntax/EDIFACT OK => positive CONTRL
- syntax/EDIFACT error => negative CONTRL
- do not use CONTRL to represent business rejection
- do not send CONTRL on CONTRL

## APERAK rules

APERAK is application/business acknowledgement.

- valid application/business message => positive APERAK
- invalid application/business message => negative APERAK
- negative business result is not automatically negative APERAK

Example:

- correct PRODAT Z14N = access denied as business result => positive APERAK
- unlinked/invalid PRODAT Z14 = application/process error => negative APERAK or manual review

## UTILTS_ERR rules

UTILTS must split errors into the correct response type:

- syntax error => CONTRL
- application/anvisningsfel => negative APERAK
- functional/process error => UTILTS_ERR
- unknown production state => manual review

## Rule profiles

Rule profiles are required. They define required fields, optional fields, forbidden fields, expected references, business validation, error mapping and manual-review triggers.

Initial profile names:

- prodat_supplier_switch_z03
- prodat_supplier_switch_z04
- prodat_supplier_switch_z05
- prodat_masterdata_z06
- prodat_meter_change_z10
- prodat_permission_z13
- prodat_permission_z14
- prodat_permission_z15
- prodat_permission_z18
- utilts_e66_monthly
- utilts_e66_quarter
- utilts_e66_energy_service
- utilts_e31_sch
- utilts_s01
- utilts_s02
- utilts_s03
- utilts_s04
- aperak_ack
- contrl_ack
- utilts_err

## Manual review triggers

Manual review is required when the system cannot safely decide.

Examples:

- uncertain tenant resolution
- multiple possible related processes
- missing customer/site/metering point state in production
- route/certificate/encryption conflict
- unknown PRODAT variant
- FieldMatrix issue conflicts with scenario rule profile
- engine decision conflicts with TGT/AGT expected result
- a final ACK was already sent with the opposite outcome
- masterdata required for production decision is missing

Do not default uncertain production cases to positive or negative ACK.

## ACK idempotency

- correct sent ACK => success / already_sent
- do not resend sent ACK
- wrong draft/prepared/queued ACK => supersede/ignore
- wrong final sent ACK => block/manual review
- first sent APERAK on a message/transaction is binding unless a formal correction/cancellation process applies

## UI mapping

Tenant admins should see business status, not Ediel internals as the main UI.

Recommended mapping:

- parsed/classified/decision_ready => Pågår / Kontroll pågår
- ack_sent and no remaining expected action => Klar
- waiting for counterpart => Väntar på motpart
- manual_review => Åtgärd krävs
- rule_conflict/send_failed/security/route/certificate block => Tekniskt stopp

Superadmin/technical admin may see:

- CONTRL / APERAK / UTILTS_ERR
- ERC / FTX
- RFF / DOC / NAD
- rule profile
- decision trace
- route/certificate/encryption diagnostics
- raw EDIFACT

## Known limitation

Full PRODAT field validation still requires importing the Edielportal Excel file `Uppgifter i PRODAT 26-A 16-B april 2026`. Until that is implemented, the engine can enforce architecture, known rules, ACK lifecycle and major TGT/AGT flows, but not every exact PRODAT field matrix rule.

## Implementation node added 2026-06-05

The reusable decision node is now `lib/ediel/decisionEngine.ts`.

Use it for new code instead of creating new one-off ACK rules.

Primary functions:

- `decideProdatAperak()`
- `decideUtiltsResponse()`
- `parsePortalValidationFeedback()`
- `ensureExpectedAckSent()`

### PRODAT rules implemented in the node

- Z14N is a valid business denial when the message/process is valid.
- Valid Z14N must return positive APERAK.
- Invalid Z14 missing/invalid permission status returns negative APERAK.
- Z15 invalid permission status returns ERC 42 / field 322.
- Z15 invalid end reason returns ERC 42 / field 324.
- Z18 missing end reason returns ERC 41 / field 324.
- Portal A902 mismatch where expected is 40/41/42 and actual is 100 returns negative APERAK.
- Production Z14/Z15/Z18 without safe process/permission link returns manual review.

### UTILTS rules implemented in the node

- Runtime UTILTS application errors map to APERAK.
- Runtime UTILTS functional errors map to UTILTS_ERR.
- AGT UE1/UE2 is separated from TGT U3 and selects UTILTS_ERR for production-unknown data scenarios.

### ACK lifecycle rules implemented in the node

- Same final ACK/outcome exists => success/already sent.
- Opposite final ACK/outcome exists => blocked final ACK exists.
- Replaceable ACK exists => supersede/replace.
- No ACK exists => create new.

## E6 / non-production negative permission scenario

E6 is a regression proving that UI expected outcome is not authority.

Rules:

- The backend can choose negative APERAK for unlinked/non-identifiable permission response scenarios in AGT/TGT when the selected test path is negative.
- This is not a production shortcut.
- Production Z14/Z15/Z18 without safe permission/process/facility link must be manual review unless the engine has deterministic validation evidence for a negative APERAK.
- The canonical error for facility not identified is `ERC+40::260` and `FTX+AAO++105::260+The object could not be identified`.
- `RFF+LI` must be preserved from raw inbound payload where available.
