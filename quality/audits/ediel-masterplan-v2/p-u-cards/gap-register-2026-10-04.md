# P/U card gap register (Claude, #491, 2026-10-04)

Status per effect after mapping existing behaviour tests (tests that call code;
string-matching source does not count). "GAP" = no asserting test found; it needs a new test
(and possibly an implementation) before the card can be VERIFIED. Update this file when a gap closes.

| Card | Status in coverage | Covered by (tagged) | Open gaps |
|---|---|---|---|
| P-07 | VERIFIED | energy-product, date-boundaries, date-fields, field-identity, energy-product-scope, permission-identityless-register-scope | — |
| P-08 | PARTIAL | date-boundaries (92 not 157, XOR), field-identity (40/109), date-events, date-event-wire-phase, date-fields, p-08-production-contract-confirmation (PGlite 9 PASS: positive APERAK on our bound Z09D confirms exactly that event; negative/CONTRL-only/unbound/revoked/other code/other tenant confirm nothing; idempotent, immutable) | owner decision 2026-10-04 implemented in 20261004190000; VERIFIED after native clean replay + schema capture |
| P-02 | VERIFIED | incoming-unused-fields, energy-product(-inbound)  (ignored fields reported separately as prodatIgnoredFields, raw kept, no negative APERAK) | — |
| P-06 | PARTIAL | identity-li-compliance (SE1/SE2/260, no guessing), aperak-text-evidence, p-06-z13-birth-date (field 249 not in Z13/Z14/Z15/Z18; protected identity: no autosend/retry/customer contact, manual review, intake blocked) | 'do not change all ZZZ globally': meaning not yet pinned to a code path (field 206 DTM+ZZZ timezone is required header field) |
| P-10 | VERIFIED | p-10-z02-correlation (LI and customer identity mismatch refused; Z02 creates no message/Z03/request), z02-core-embedded-check (tenant, object, actor fences) | — |
| P-11 | VERIFIED | normal-switch-source-sql-regression, supply-market-consumers, supplier-switch-activation-sweep , p-11-z04-order (Z04 applies with Z03 only sent; late negative ACK keeps confirmation) | — |
| P-12 | VERIFIED | p-12-z04ad-scope (held without supplier role, signed contract, grid area, matching capability or source reference), regulated-supply-ground (production link, current ground), supply-market-consumers (no ordinary Z03) | — |
| P-13 | VERIFIED | p-13-end-preserves (matched end versioned on its period; customers, sites, points, other periods, grants unchanged), supply-end-followup, bilateral closure/supply consumers, supply-market-consumers (final billing task once) | — |
| P-14 | VERIFIED | switch-cancellation-sql-regression, switch-cancellation-source, prodat-prior-flow, prodat-subtypes (no Z13C/Z14C) , supply-market-consumers ("does not reaccept an ordinary start already cancelled") | — |
| P-15 | VERIFIED | structural-source-selection (validity selected independent of receipt order; Z06/Z10 per period; meter exchange keeps both states, no global overwrite; old/new source exactly at boundary; future supplier structure received before start valid only from start), received-structure-reader(-boundaries), utilts-structural-comparison (two registers counted once) | — |
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
| U-06 | VERIFIED | u-06-request-application-reference (generic 23-DGI-E73 refused, S02/E66 + S03/E31 resolved), u-06-request-mandate-scope (E73 requires customer/site/point/period and a qualified own structure for exactly that period with matching supplier/grid owner; E74 bilateral + manual review only) | — (earlier 'no mandate check' finding was wrong: the mandate is requireDataRequestStructure) |
| U-08 | VERIFIED | utilts-structural-comparison (mismatch E61/E62 only against held structure; missing → unavailable), u-08-esco-partial-structure (DGI E66 without held structure: no ERR/APERAK, internal warning only) | — |
| U-09 | VERIFIED | consumption-contract, quantity-precision, s02-required-scope, u-09-estimate-never-actual (annual-profile estimate lines: quality 'estimated', no metering source, method kept, zero intervals not filled, invoice basis preliminary with estimated/actual kWh apart) | — |
| U-11 | PARTIAL | utilts-runtime-cutoff (E19 removed in 25-A-4; E98/E90 removed for individual E66 point; E98 kept for an aggregate/regulating object after cutoff; E87 kept and incomplete quarter rejected), effective-date | E30/aggregate E90/E97/E98 limits are product-specific ("enligt aktuell produkt", U bilaga2 s.132) with no machine-readable source; not invented |
| U-12 | VERIFIED | observation-order-guide + packing-limit-authority (E23/E88 and quarter/month mix blocked before send), u-12-outbound-single-transaction (real builder: one UNH, one IDE with own reference, one reason, period kept, no packaging violation) | — |
| U-13 | VERIFIED | utilts-err-canonical-guide (received 5/NA accepted), utilts-err-gateway (outgoing ERR BGM 9/AB) | — |
| U-15 | VERIFIED | observation-order-guide, packing-limit-authority (send preflight blocks >1 UNH, >1 NAD MR, mixed STS+7 reasons, quarter/month mix) | — |
| U-17 | VERIFIED | utilts-aperak-physical-scope (17-char element fallback; no field number without source; >17 / invalid refused) | — |
| U-19 | VERIFIED | u-19-prodat-reference (E66 without / unknown / non-TN field 226 gets identical validation and ACK outcome; RFF+TN binds a company-scoped grid_owner_data_request via lib/ediel/matching.ts, no invented match without a hit) | — |
