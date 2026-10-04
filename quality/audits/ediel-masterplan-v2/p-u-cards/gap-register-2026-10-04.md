# P/U card gap register (Claude, #491, 2026-10-04)

Status per effect after mapping existing behaviour tests (tests that call code;
string-matching source does not count). "GAP" = no asserting test found; it needs a new test
(and possibly an implementation) before the card can be VERIFIED. Update this file when a gap closes.

| Card | Status in coverage | Covered by (tagged) | Open gaps |
|---|---|---|---|
| P-07 | VERIFIED | energy-product, date-boundaries, date-fields, field-identity, energy-product-scope, permission-identityless-register-scope | — |
| P-08 | PARTIAL | date-boundaries (92 not 157, XOR), field-identity (40/109), date-events, date-event-wire-phase, date-fields | GAP: a valid inbound contract receipt updates the right production relation; no implementing path found |
| P-02 | VERIFIED | incoming-unused-fields, energy-product(-inbound)  (ignored fields reported separately as prodatIgnoredFields, raw kept, no negative APERAK) | — |
| P-06 | PARTIAL | identity-li-compliance (SE1/SE2/260, no guessing), aperak-text-evidence (inbound birth-date qualifier) , p-06-z13-birth-date (field 249 not in Z13/Z14/Z15/Z18) | GAP: protected-identity rules (no implementation found); ZZZ (field 206) not changed globally |
| P-10 | VERIFIED | p-10-z02-correlation (LI and customer identity mismatch refused; Z02 creates no message/Z03/request), z02-core-embedded-check (tenant, object, actor fences) | — |
| P-11 | VERIFIED | normal-switch-source-sql-regression, supply-market-consumers, supplier-switch-activation-sweep , p-11-z04-order (Z04 applies with Z03 only sent; late negative ACK keeps confirmation) | — |
| P-12 | VERIFIED | p-12-z04ad-scope (held without supplier role, signed contract, grid area, matching capability or source reference), regulated-supply-ground (production link, current ground), supply-market-consumers (no ordinary Z03) | — |
| P-13 | VERIFIED | p-13-end-preserves (matched end versioned on its period; customers, sites, points, other periods, grants unchanged), supply-end-followup, bilateral closure/supply consumers, supply-market-consumers (final billing task once) | — |
| P-14 | VERIFIED | switch-cancellation-sql-regression, switch-cancellation-source, prodat-prior-flow, prodat-subtypes (no Z13C/Z14C) , supply-market-consumers ("does not reaccept an ordinary start already cancelled") | — |
| P-15 | PARTIAL | received-structure-reader(-boundaries), prodat-registers | GAP: future supplier structure before start; history not overwritten in one global row |
| P-16 | VERIFIED | prodat-subtypes (explicit capability), bilateral-prodat-profile-native/intake, bilateral-prodat-supply-consumer, prodat-bilateral-source-capability , bilateral-prodat-profile-intake (other company/agreement/environment scope rejected) | — |

## U cards (2026-10-04)

| Card | Status | Covered by (tagged) | Open gaps |
|---|---|---|---|
| U-01 | VERIFIED | utilts-aperak-contrl-central-engine (E66 inbound only, supplier E66 blocked), utilts-profile-own-scope | — |
| U-03 | VERIFIED | utilts-guide-execution-order, transaction-disposition, e66-monthly-billing-resolution, utilts-runtime-cutoff, quantity-precision, received-utilts-header-validation (header error without ACW) | — |
| U-07 | VERIFIED | utilts-effective-date (S06 held outbound, S08 discontinued) | — |
| U-10 | VERIFIED | u-10-interval-count (96/92/100 by actual period), e66-monthly-billing-resolution | — |
| U-16 | VERIFIED | packing-limit-authority (10 MB advisory, 1 MB / 999 conservative) | — |
| U-18 | VERIFIED | utilts-observation-order-guide, canonical-observation-scope | — |
| U-02 | PARTIAL | canonical-observation-scope, transaction-disposition, structural-comparison | contract matrix for other profiles' repeated groups (acceptance-utilts-package-20260930.md) |
| U-06 | PARTIAL | utilts-aperak-contrl-central-engine | generic 23-DGI-E73 refused; S03/E31 reference |
| U-08 | PARTIAL | utilts-structural-comparison | ESCO-Z14 partial structure (receiver not required to hold full supplier structure) |
| U-09 | PARTIAL | consumption-contract, quantity-precision, s02-required-scope | annual forecast never used as actual quarter energy |
| U-11 | PARTIAL | utilts-runtime-cutoff, effective-date (E19 removed in 25-A-4) | E87 + mandatory fields kept after cutoff; incomplete quarter still rejected; E97/E98/E90 limited to E30/aggregates (no implementation found) |
| U-12 | PARTIAL | observation-order-guide (no E23/E88 mix) | outbound splitting into compatible groups (no implementation found) |
| U-13 | PARTIAL | utilts-err-canonical-guide (received 5/NA accepted) | outgoing 9/AB asserted |
| U-15 | PARTIAL | observation-order-guide, packing-limit-authority | packaging to one legal receiver |
| U-17 | PARTIAL | utilts-aperak-physical-scope (17-char element fallback) | numeric field never guessed from qualifier |
| U-19 | NOT_VERIFIED | — | no UTILTS code consumes a PRODAT case reference for correlation |
