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

## 2026-06-05 Decision engine update — UTILTS response rules

UTILTS must separate syntax, application/anvisningsfel and functional/process errors.

### Response selection

- syntax/EDIFACT error => CONTRL
- application/anvisningsfel => negative APERAK
- functional/process error => UTILTS_ERR
- valid UTILTS => positive APERAK
- unknown production scenario => manual review, not guessed positive or negative ACK

### TGT vs AGT context

Do not merge TGT and AGT expectations into one rule.

- TGT U3.1 correct UTILTS E66 to energy service company => positive CONTRL + positive APERAK.
- AGT UE1/UE2 can require positive CONTRL + negative UTILTS/UTILTS_ERR because test data is unknown to the actor's production application.

This means `testKind`, actor role, Application Reference, BGM code, transaction references and known business state must be part of the decision context.

### Transaction-scoped APERAK

UTILTS may require transaction-scoped results where some transactions are valid and others invalid.

Rules:

- RFF+ACW must point to the affected transaction/reference.
- Positive UTILTS APERAK should use BGM 312, ERC 100, FTX OK.
- Negative UTILTS APERAK should use BGM 313, ERC 41/42 and relevant FTX field/error code.
- Multiple transactions can require separate ACK decisions depending on route/test/profile context.

### NULL values

`QTY+136:NULL` can be valid when paired with the correct quality/status code, such as missing-value quality status. Do not treat all NULL meter values as errors without checking the rule profile and quality code.


## UTILTS_ERR reason-code policy for AGT UE1/UE2

UE1/UE2 AGT uses the same backend decision engine as production, but the reason code must be constrained by the AGT test context. The Ediel portal can reject `E87` in UE1 when rule 531 expects one of `E10|E14|E49|E55|E61`.

Do not remove `E87` globally. In live production, `E87` remains valid when the real fault is period/resolution/observation-count mismatch. For AGT UE1/UE2, if inbound E66 cannot be processed because the actor's production application does not have the object/test data, use the best allowed code: unknown/non-processable metering point => `E10`, unknown grid area => `E49`, otherwise `E14` as generic allowed reason.

The engine must apply context-aware policy: live production uses actual fault; TGT follows TGT facit; AGT UE1/UE2 uses actual fault constrained to `E10|E14|E49|E55|E61`.
