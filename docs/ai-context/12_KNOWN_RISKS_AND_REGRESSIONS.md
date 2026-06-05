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
