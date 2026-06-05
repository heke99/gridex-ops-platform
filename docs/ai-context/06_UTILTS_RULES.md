# UTILTS Rules

## General UTILTS principles

- UTILTS decisions must be engine-based.
- Do not hardcode test IDs or inbound IDs.
- Backend validation must decide ACK type.
- UI recommendation must not override runtime validation.

## U2.2.2 approved rule

Test:

- Felaktig UTILTS-E66, anvisningsfel kvart

Approved behavior:

- negative APERAK
- BGM+313
- ERC+41::260
- FTX+AAO++512::260+MANDATORY FIELD MISSING

Rule:

- UTILTS E66 kvart/tim with missing or invalid DTM+597 registration timestamp should produce negative APERAK.
- DTM+597 must contain a real date value, e.g. DTM+597:202605080000:203.
- Bare DTM+597, DTM+597:, DTM+597:? or placeholders count as missing.

Important:

- tgtAutoMatcher must read DTM+354 correctly, e.g. DTM+354:15:804 means value is 15, not qualifier 354.

## U2.2.3 approved rule

Test:

- Felaktig UTILTS-E66, funktionsfel SCH

Approved behavior:

- no APERAK from GridCore
- send UTILTS_ERR

Expected transaction errors:

- SE_1213 / transaction E260508833945 => reason E19
- SE_1313 / transaction E260508833946 => reason E50
- STS E01
- description 41

Rule:

- functional_rejected should lead to UTILTS_ERR
- application/anvisningsfel should lead to negative APERAK
- syntax errors should lead to CONTRL

## U2.1.8b approved rule

Approved behavior:

- E66-T with multiple transactions should create transaction-scoped positive APERAK per transaction in test context.
- Production should still default to message-scope unless route/test context requires transaction scope.
- RFF+TN must read reference value after colon, not qualifier TN.
- RFF+ACW should point to each transaction reference.

## E31 SCH approved rules

### U2.3.2

Correct UTILTS-E31 final shares SCH:

- positive CONTRL
- positive APERAK

### U2.4.1

Incorrect UTILTS-E31 anvisningsfel SCH:

- positive CONTRL
- negative APERAK
- BGM+313
- ERC+41::260
- FTX+AAO++511a::260+INCORRECT DATA -34
- DOC points to E31/BGM reference
- RFF+ACW points to IDE/transaction reference

Rule:

- inbound UTILTS E31 SCH with negative final share, e.g. QTY+136:-34, is application/anvisningsfel and should produce negative APERAK 41 + 511a.

Do not use:

- ERC+42
- FTX 508

### U2.4.3

Incorrect UTILTS-E31 functional error SCH:

- positive CONTRL
- UTILTS_ERR from GridCore
- no APERAK from GridCore
- then APERAK from Edielportalen

Correct UTILTS_ERR:

- BGM+ERR
- mandatory SG5 NAD+DDK and NAD+DDQ copied from inbound
- STS+E01::260+41+E50::260
- RFF+TN to IDE/transaction reference
- RFF+E31 to BGM/E31 reference

E49 was wrong for this test. E50 is correct.

## U3 approved rules

### U3.1.1

Correct UTILTS-E66 periodic monthly SCH:

- inbound UTILTS E66 SCH
- positive CONTRL
- positive APERAK

### U3.1.2

Correct UTILTS-E66 daily settled quarter:

- inbound UTILTS E66 quarter
- positive CONTRL
- positive APERAK
- BGM+312/ERC+100/OK
