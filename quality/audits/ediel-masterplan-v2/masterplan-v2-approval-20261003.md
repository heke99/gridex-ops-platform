# Ediel masterplan v2 — approvals 2026-10-03

Owner instruction: approve what is correctly built. Scope: the 13 items judged `complete_code` in `masterplan-v2-code-verification-20261003.json`. Each item's expected **and** prohibited effects from `docs/ediel/masterplan-v2/registers/{rules,acceptance_tests}.json` were matched to production code and an asserting test, and the tests were run on main `9f5bb70d`:

- `npx vitest run` on the 24 cited PRODAT test files: 1 199/1 199 passed.
- `node --experimental-vm-modules --test scripts/test-ediel-unb-ack-request.cjs`: 64/64 passed.

| ID | New status | Key assertions |
|---|---|---|
| ENV-04 | VERIFIED | UNB0031=1 on requested ACK, empty otherwise; CONTRL requests no ACK; BGM requestAck cannot override; persisted monitoring uses same decision |
| AT-ENV-04 | PASSED | same |
| P-01 | VERIFIED | P26.A field matrix with typed field numbers/groups; diagnostics carry fieldNumber, not text regex |
| P-04 | VERIFIED | Z14N accepted without positive-Z14 fields; N forbids them; no borrowing across objects |
| SC-024 | PASSED | as P-04 |
| SC-025 | PASSED | identityless Z13 renders `LIN+1'` with no invented object id |
| SC-026 | PASSED | Z15 field 327 from DTM+164, 325 from RFF+Z09; contract/report dates not used |
| SC-027 | PASSED | DTM+91 for bounded V and VH; omitted for indefinite V |
| SC-028 | PASSED | field 506 kept as fifth CAV component; field 242 never relabelled |
| SC-029 | PASSED | DTM+92/93 rendered; DTM+157 does not replace them; both dates → ERC40/109 |
| SC-030 | PASSED | Z09E carries NAD+UD; other Z09 variants unaffected |
| SC-032 | PASSED | Z06E/G optional branch vs Z06F required |
| SC-033 | PASSED | 314 global, 258 per object; second-register error not masked |

Approval covers code behaviour. Market activation and counterparty testing remain separate external gates. The other 339 items are not approved: their code is partial (313) or missing (26); see the verification record.
