# PRODAT Rules

## General PRODAT principles

- PRODAT flows must be engine-based.
- Do not hardcode test-specific references.
- Read BGM code from raw EDIFACT payload when available.
- Sender/receiver and subaddress must be route-profile driven.
- PRODAT to grid owner/test counterpart may require encryption depending on route/environment.
- PRODAT ACK decisions must separate technical CONTRL from application APERAK.

## AGT / supplier actor tests

For Div3rsa AB supplier/AGT PRODAT tests:

L1 and L7 are actor to portal:

- system should create outbound PRODAT draft

L2, L3, L4 and L5 are portal to actor:

- system should wait for inbound PRODAT from Edielportalen
- system should create/respond with CONTRL and APERAK according to AGT rules

## Approved AGT facts

L1 PRODAT Z03 approved with:

- outbound PRODAT Z03
- UNB sender 21660:ZZ without sender subaddress
- receiver 91100:ZZ:PRODAT
- PRODAT:D:97A:UN:E2SE6A
- BGM+Z03
- NAD+FR+21660
- NAD+DO+91100
- NAD+Z02+91109
- correct UNT segment count

L2 PRODAT Z04 approved with:

- inbound PRODAT Z04 from Edielportalen/testsystem
- positive CONTRL
- negative APERAK back to 91100
- negative APERAK uses short FTX 105 text, e.g. "The object could not be identified"

L3 PRODAT Z05 approved with:

- inbound PRODAT
- positive CONTRL
- negative APERAK back to 91100
- short FTX 105 text

L4 PRODAT Z06 approved with:

- inbound PRODAT
- positive CONTRL
- negative APERAK back to 91100
- short FTX 105 text

L5 PRODAT Z10 approved with:

- inbound PRODAT
- positive CONTRL
- negative APERAK back to 91100
- short FTX 105 text

## ESCO / energy service company flows

Z13/Z14/Z15/Z18 ESCO flows must be handled by permission engine, not hardcoded values.

For inbound PRODAT:

- read actual BGM code from raw payload
- use permission-flow engine
- if permission flow cannot match, negative APERAK may be required according to rules/facit

Known approved ESCO/TGT tests:

- 8.1.1 approved
- 8.1.2 approved
- 8.1.3 approved
- 8.2.1 approved
- 9.1.1 approved
- 9.1.2 approved

Important:

- 8.2.1 Z14V should produce positive CONTRL but negative APERAK when Z14 does not match correct permission flow.
- 9.2.1 Z15V should produce positive CONTRL but negative APERAK when Z15 does not match active/previous permission flow.
- For incorrect permission status/reason, negative APERAK should include relevant ERC/FTX codes according to engine rules.

## Current known Z14/CONTRL issue pattern

If inbound PRODAT Z14 parses successfully and CONTRL is generated but send is blocked with:

"Sending blocked: selected test suite/message family does not match the generated message."

Then likely areas to inspect:

- generated ACK family/type
- selected test suite/message family
- outbound ACK message classification
- send blocker/guard
- route profile/test matcher
- relation between inbound message and generated CONTRL
- event log diagnostics

The fix must not simply bypass guard. It should correct classification or matching logic unless the guard itself is proven wrong.
