# P/U card gap register (Claude, #491, 2026-10-04)

Status per effect after mapping existing behaviour tests (tests that call code;
string-matching source does not count). "GAP" = no asserting test found; it needs a new test
(and possibly an implementation) before the card can be VERIFIED. Update this file when a gap closes.

| Card | Status in coverage | Covered by (tagged) | Open gaps |
|---|---|---|---|
| P-07 | VERIFIED | energy-product, date-boundaries, date-fields, field-identity, energy-product-scope, permission-identityless-register-scope | — |
| P-08 | PARTIAL | date-boundaries (92 not 157, XOR), field-identity (40/109), date-events, date-event-wire-phase, date-fields | GAP: a valid inbound contract receipt updates the right production relation; no implementing path found |
| P-02 | open | incoming-unused-fields, energy-product(-inbound) | check that ignored fields stay out of the business projection |
| P-06 | open | identity-li-compliance (SE1/SE2/260, no guessing), aperak-text-evidence (inbound birth-date qualifier) | GAP: renderer-side Z13 birth-date ban; protected identity rules; no UUID fallback; ZZZ (field 206) not changed globally |
| P-10 | open | — (existing LI tests only string-match migrations) | GAP: Z02↔Z01 correlation by LI/parties/object/grid area/customer; Z02 not start confirmation; no automatic Z03 (gridex_apply_exact_z02_core) |
| P-11 | open | normal-switch-source-sql-regression, supply-market-consumers, supplier-switch-activation-sweep | GAP: Z04 before positive APERAK; Z02/ACK alone never activate; late ACK cannot roll back |
| P-12 | open | supply-market-consumers (assigned supply without own Z03; missing legal ground held) | GAP: role/contract/grid-area/production-link verification |
| P-13 | open | supply-end-followup, bilateral-prodat-closure-operation, bilateral-prodat-supply-consumer | GAP: end versioned with history preserved; customer/other facilities/ESCO grants not deleted |
| P-14 | open | switch-cancellation-sql-regression, switch-cancellation-source, prodat-prior-flow, prodat-subtypes (no Z13C/Z14C) | GAP: cancellation arriving before the original without double effect |
| P-15 | open | received-structure-reader(-boundaries), prodat-registers | GAP: future supplier structure before start; history not overwritten in one global row |
| P-16 | VERIFIED | prodat-subtypes (explicit capability), bilateral-prodat-profile-native/intake, bilateral-prodat-supply-consumer, prodat-bilateral-source-capability , bilateral-prodat-profile-intake (other company/agreement/environment scope rejected) | — |
