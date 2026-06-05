# Ediel Core Rules

## General Ediel rules

- No hardcoded inbound IDs, test IDs, test run IDs, metering point IDs or message references.
- Rules must be production-based and engine-based.
- Test-specific behavior must be expressed through environment, actor settings, route profile or test context, not hardcoded IDs.
- Positive CONTRL means technical/syntax acknowledgement.
- APERAK means application/business acknowledgement.
- UTILTS_ERR is used for functional error flows where required.
- Syntax errors should lead to CONTRL error handling where applicable.
- Application/anvisningsfel should lead to negative APERAK where applicable.
- Functional/funktionsfel should lead to UTILTS_ERR where applicable.
- Never let UI recommendation override backend validation when backend has enough information to decide.

## Message type source of truth

For inbound EDIFACT, actual message type/code should be parsed from payload.

Use actual EDIFACT content such as:

- UNH
- BGM
- NAD
- RFF
- DOC
- STS
- ERC
- FTX
- DTM
- LIN
- CCI/CAV

Do not blindly trust stale DB/UI fields when payload says otherwise.

## Shared mailbox

Shared mailbox is transport only.

Tenant must be resolved from:

- EDIFACT
- actor settings
- route profile
- Ediel ID
- subaddress
- environment
- certificate/CMS info where relevant

## Encryption

For encrypted Ediel tests/production:

- outbound S/MIME/CMS must encrypt to receiver's public encryption certificate
- not to sender's own certificate
- shared mailbox certificate is not tenant identity
- receiver Ediel ID, subaddress, route profile, cert owner, fingerprint, issuer, serial and CMS recipientInfo should be logged
- sending must be blocked if recipientInfo does not match expected receiver where this can be verified
- inbound encrypted messages must resolve tenant using CMS recipientInfo and then parse EDIFACT after decryption

## Inbound S/MIME/CMS decryption

Inbound encrypted Ediel messages must be handled in this order:

1. Receive message from shared mailbox.
2. Identify whether message is encrypted S/MIME/CMS.
3. Inspect CMS recipientInfo where possible.
4. Match recipientInfo/certificate fingerprint/recipient identifier to the correct tenant actor configuration.
5. Select the correct tenant private certificate/PFX from secure storage/env/secret reference.
6. Decrypt payload server-side.
7. Parse EDIFACT only after successful decryption.
8. Verify EDIFACT UNB receiver/sender/subaddress against the tenant/route resolved from certificate/CMS.
9. If tenant cannot be resolved safely, put message in unresolved/manual review.
10. Never assign tenant only based on mailbox address.

If decryption fails, log:

- mailbox message id
- environment
- expected recipient actor if known
- CMS recipientInfo if readable
- certificate fingerprint/serial if available
- failure reason
- whether EDIFACT parsing was skipped

Do not expose private key material, PFX content or certificate secrets in UI, logs or event history.

## Route profiles

Receiver subaddress is first-class routing data.

For Edielportal/test counterpart:

- Ediel ID: 91100
- PRODAT subaddress: PRODAT
- receiver should be 91100:ZZ:PRODAT when required by the test/route
- SMTP may be 91100@ediel.se depending on route profile

Do not drop subaddress from UNB/S002/S003, test matcher, diagnostics or audit.
