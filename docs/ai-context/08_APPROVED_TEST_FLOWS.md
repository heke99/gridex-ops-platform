# Approved Test Flows

This file contains approved/facit flows. Preserve them unless clear evidence shows a rule is wrong or incomplete. If changing an approved flow, follow 13_OVERRIDE_PROTOCOL.md.

## PRODAT AGT L1

Status: Approved

Behavior:

- outbound PRODAT Z03
- sender 21660:ZZ
- receiver 91100:ZZ:PRODAT
- BGM+Z03
- NAD+FR+21660
- NAD+DO+91100
- NAD+Z02+91109
- correct UNT segment count

## PRODAT AGT L2

Status: Approved

Behavior:

- inbound PRODAT Z04 from Edielportalen
- positive CONTRL
- negative APERAK back to 91100
- short FTX 105 text, e.g. "The object could not be identified"

## PRODAT AGT L3

Status: Approved

Behavior:

- inbound PRODAT Z05
- positive CONTRL
- negative APERAK
- short FTX 105 text

## PRODAT AGT L4

Status: Approved

Behavior:

- inbound PRODAT Z06
- positive CONTRL
- negative APERAK
- short FTX 105 text

## PRODAT AGT L5

Status: Approved

Behavior:

- inbound PRODAT Z10
- positive CONTRL
- negative APERAK
- short FTX 105 text

## UTILTS U2.1.8b

Status: Approved

Behavior:

- E66-T with multiple transactions
- transaction-scoped APERAK per transaction in test context
- RFF+TN reference value parsed correctly
- RFF+ACW points to transaction reference

## UTILTS U2.2.2

Status: Approved

Behavior:

- E66 quarter/tim with missing invalid DTM+597
- negative APERAK
- BGM+313
- ERC+41::260
- FTX 512 MANDATORY FIELD MISSING

## UTILTS U2.2.3

Status: Approved

Behavior:

- E66 functional error SCH
- positive CONTRL
- UTILTS_ERR
- no APERAK from GridCore

## UTILTS U2.3.2

Status: Approved

Behavior:

- correct E31 final shares SCH
- positive CONTRL
- positive APERAK

## UTILTS U2.4.1

Status: Approved

Behavior:

- E31 SCH application error with negative final share
- positive CONTRL
- negative APERAK
- BGM+313
- ERC+41::260
- FTX 511a INCORRECT DATA -34

## UTILTS U2.4.3

Status: Approved

Behavior:

- E31 SCH functional error
- positive CONTRL
- UTILTS_ERR
- no APERAK from GridCore
- STS+E01::260+41+E50::260
- mandatory NAD+DDK and NAD+DDQ

## UTILTS U3.1.1

Status: Approved

Behavior:

- correct E66 periodic monthly SCH
- positive CONTRL
- positive APERAK

## UTILTS U3.1.2

Status: Approved

Behavior:

- correct E66 daily settled quarter
- positive CONTRL
- positive APERAK
- BGM+312/ERC+100/OK

## AGT DGI PRODAT encrypted test

Status: Approved

Behavior:

- S/MIME/CMS encrypted send
- Vercel must not depend on openssl binary for CMS recipientInfo
- AGT/test message may use production Expisoft certificate if that is what route config requires
- receiver for Edielportalen is 91100:ZZ:PRODAT
- send via Ediel/Strato SMTP, not Resend

## When a new test is approved

Immediately add:

- test name/code
- direction: actor -> portal or portal -> actor
- inbound/outbound message type
- expected CONTRL
- expected APERAK or UTILTS_ERR
- important EDIFACT segments
- route/encryption requirements
- what must not regress
- date approved
