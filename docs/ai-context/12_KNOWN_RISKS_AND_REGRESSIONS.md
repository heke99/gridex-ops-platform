# Known Risks and Regressions

## Ediel ACK mismatch

Risk:

- Generated CONTRL/APERAK is blocked because selected test suite/message family does not match generated message.

Do not fix by blindly bypassing send guard.

Correct approach:

- inspect classification
- inspect message metadata
- inspect route/test matcher
- inspect generated ACK relation to inbound
- fix root classification/matching issue

## Positive APERAK where negative APERAK is required

Risk:

- UI or default logic creates positive APERAK even when backend should create negative APERAK.

Correct approach:

- backend decision engine should be authoritative
- UI recommendations must not override validation engine

## APERAK sent when UTILTS_ERR is required

Risk:

- functional error flow incorrectly results in APERAK.

Correct approach:

- distinguish application/anvisningsfel from functional/funktionsfel

## Tenant leakage

Risk:

- shared mailbox causes wrong tenant/company assignment.

Correct approach:

- resolve by Ediel ID/subaddress/route/CMS/EDIFACT, not mailbox alone

## Encryption/decryption mismatch

Risk:

- test run is marked encrypted but outbound draft/send uses unencrypted channel
- encrypted message is encrypted to wrong certificate
- inbound encrypted message is decrypted with wrong tenant private key
- tenant is guessed before safe CMS/EDIFACT verification

Correct approach:

- encryption state must follow from test run to draft to send
- encrypt to receiver public certificate
- verify/log CMS recipientInfo
- decrypt inbound only after matching correct tenant certificate
- unresolved messages must go to manual review

## Receiver subaddress missing

Risk:

- Edielportal does not connect message to test log if receiver subaddress is missing.

Correct approach:

- include receiver subaddress, e.g. 91100:ZZ:PRODAT where required

## Billing domain mixup

Risk:

- customer billing underlay gets mixed with platform billing against tenant company.

Correct approach:

- separate tables/modules/UI labels
- separate validation
- separate reports
- separate audit events

## Import/file parsing risk

Risk:

- BRP/eSett files are parsed incorrectly, matched to wrong customer/site or used in billing without validation.

Correct approach:

- tenant-scope uploads
- row-level validation
- safe metering point matching
- manual review for ambiguous rows
- no finalized export overwrite

## Over-refactoring

Risk:

- Cursor changes unrelated files and breaks approved flows.

Correct approach:

- keep scope focused
- expand only with explanation
- document all changed files

## 2026-06-05 Decision engine foundation risks

### Full PRODAT field matrix is not complete

The Edielportal Excel file `Uppgifter i PRODAT 26-A 16-B april 2026` is still required for complete field-level PRODAT validation. Until imported, the engine must avoid pretending it knows every field requirement.

Risk if ignored:

- false positive APERAK on field-level invalid PRODAT
- false negative APERAK due to over-generalized rule

Mitigation:

- keep FieldMatrix scenario/profile-based
- raise manual_review when profile data is missing
- import/version the Excel rulebook later

### Z14N regression risk

Do not regress into treating all Z14N as negative APERAK. Z14N is a business denial and can be a valid message requiring positive APERAK.

### ACK replacement risk

Do not allow UI or retry code to send opposite APERAK after one final APERAK has already been sent for the same source message/transaction/context.

### TGT/AGT/prod mixing risk

AGT can intentionally differ from TGT because AGT validates actor communication/production-like setup. Keep `testKind`, actor role and business-state context separate.

### UI simplification risk

Tenant admins should not get technical Ediel override controls. Technical override must stay superadmin/technical-admin only, with reason and audit.

## 2026-06-05 decision node risks

- Production Z14/Z15/Z18 now require a safe process/permission link before auto APERAK. If the production matcher does not populate `related_message_id`, `business_match_status`, `customer_id`, `site_id` or `metering_point_id`, the decision node will choose manual review. This is safer than guessing, but the matching pipeline must be completed for smooth production automation.
- Z18 missing CCI/CAV Z25 now produces negative APERAK with field 324. If an official profile permits missing Z25 for a narrow case, add that exception to the rule profile before enabling auto-send.
- Portal feedback parser supports common A902 expected/actual structures and text, but exact portal report import still needs a proper parser when report files are available.
- The legacy `decideProdatAperakOutcome()` API cannot express manual review, so it maps manual review to a safe negative object/process error. New callers should use `decideProdatAperak()` directly.
- Regression script needs installed project dependencies because existing imported Ediel modules transitively require Supabase/Next-related packages.
