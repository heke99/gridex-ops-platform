# Ediel production-engine initial audit

Date: 2026-08-13
Branch: `agent/ediel-production-engine-20260813`
Baseline: `main@e44b13f9`

## Inventory

- Runtime: Next.js 16, TypeScript, Supabase/Postgres, Vercel.
- Ediel implementation: 309 TypeScript files under `lib/ediel`; canonical envelope, rule-pack resolver, PRODAT/UTILTS profiles, ACK engine, route/tenant resolver, inbound pipeline and outbox.
- Live database: Supabase project `piidsfebjqjmnepdpnas` (`gridex-ops-dev`), PostgreSQL 17.6.1.
- Canonical DB objects: `ediel_rule_packs`, `ediel_message_profiles`, `ediel_segment_rules`, `ediel_field_rules`, `ediel_ack_rules`, `ediel_ack_transaction_results`, `ediel_business_correlations`, `ediel_business_expectations` and tenant route/capability tables.
- Baseline evidence: 71 test files / 480 tests passed; canonical Ediel verification passed before changes.

## Confirmed findings

| ID | Severity | Evidence | Current behavior | Canonical behavior | Fix / disposition |
|---|---|---|---|---|---|
| EDIEL-001 | critical | Live `ediel_rule_packs` stored current UTILTS as `E5SE5A/current-r3`, valid from 2026-04-01 | Guide identity was conflated with the UNH association and rejected valid dates from 2025-06-01 | Guide `25-A-3`, association `E5SE5A`, effective 2025-06-01; `25-A-4` future-only from 2026-10-01 | Fixed in forward migration `20260813120500...`; live resolver verified |
| EDIEL-002 | high | `utiltsRulebook.ts` classified S01/S04/S05 as object/register and E72/E74/S06 as value-bearing data | Aggregate flows could require a metering point; requests could require observations | Aggregate and request identity/quantity semantics must be explicit | Fixed in canonical profiles, DB profile metadata and tests |
| EDIEL-003 | high | `evaluateInboundEdielRequest` always attempted tenant-local metering-point matching | Valid E31/S03/S01/S04/S05/E74/S06 aggregate traffic could be parked for missing object identity | Object and aggregate matching follow the selected profile | Fixed by deriving identity requirements from canonical UTILTS profile |
| EDIEL-004 | medium | Admin instruction registry contained only 6/13 PRODAT and 4/13 current UTILTS codes | UI coverage could omit supported codes or disagree with the runtime registry | Admin coverage derives from the same canonical profiles and preserves truthful partial readiness | Fixed; canonical registries now generate the active rows and all UTILTS rows remain partial until blockers close |
| EDIEL-005 | medium | UTILTS support registry labeled all non-E66 traffic `metering_values`; E66 also claimed `timeseries_request` | Intent/UI semantics contradicted message taxonomy | Business process derives from the canonical profile | Fixed and regression-tested |
| EDIEL-006 | critical | Live field matrix counts: PRODAT 77–80 rows per code; UTILTS has only E31=1 and E66=1, all other current codes=0 | Complete field-by-field R/D/O/X validation cannot be proven | Every active UTILTS profile needs source-bound field rules, parser/validator/renderer coverage and fixtures | **Open production blocker**; official matrices cannot be invented |
| EDIEL-007 | critical | `shouldIngestMeteringValue` handles only E66/E30; state machine classifies only E66 as a UTILTS business fact | S02/S03/E31/S05/S07 may be accepted/ACKed without immutable domain disposition | Every accepted transaction needs independent, atomic persistence and a next action | **Open production blocker** |
| EDIEL-008 | high | Message-level UTILTS validation/ACK plan is used before persistence | Full 95/3/2 partial-success behavior is not proven end-to-end | Valid transactions commit independently; application and process errors receive transaction-scoped responses | DB coverage table exists, but complete runtime proof is **open** |

## Duplicate source-of-truth inventory

| Meaning | Sources found | Result |
|---|---|---|
| PRODAT profiles | canonical rulebook, engine registry, field rules, legacy admin spec list | Admin list now derives from canonical profiles; older static entries are excluded at runtime |
| UTILTS profiles | canonical rulebook, support registry, legacy admin spec list, DB message profile JSON | Support/admin rows now derive from canonical profiles; DB metadata aligned by migration |
| Version identity | DB rule packs, TypeScript profile version, UNH association | Guide and association separated for current/future UTILTS |
| Application Reference | application-reference policy, route declarations, legacy route defaults | Existing regression proves policy wins and route values only declare/validate |
| ACK policy | ACK rule pack, canonical ACK engine, legacy builders | Existing canonical consolidation regression rejects parallel envelope/ACK writers |

## PRODAT support matrix

| Code | Canonical process | Builder/parser | Field rows live | Business disposition |
|---|---|---:|---:|---|
| Z01 | customer/facility request | yes | 78 | outbound request; inbound not applicable |
| Z02 | customer/facility response | yes | 77 | customer-info response |
| Z03 | supplier switch / move-in / cancel | yes | 79 | outbound lifecycle |
| Z04 | switch confirmation / regulated supply | yes | 77 | automatic when safely correlated; otherwise review |
| Z05 | termination / prior-supplier response | yes | 77 | termination or review |
| Z06 | grid-owner master data | yes | 77 | safe proposal/manual review |
| Z08 | termination request | yes | 77 | correlated termination request |
| Z09 | supplier master data | yes | 77 | safe proposal/manual review |
| Z10 | meter change | yes | 77 | safe proposal/manual review |
| Z13/Z14/Z15/Z18 | permission lifecycle | yes | 77–80 | permission state machine |

## UTILTS support and field-gap matrix

| Code | Canonical scope | Supplier capability | Runtime profile | Live field rows | Disposition status |
|---|---|---|---|---:|---|
| S02 | object forecast | primary inbound | present | 0 | storage/next action open |
| S03 | aggregate preliminary shares | primary inbound | present | 0 | storage/next action open |
| E66 | validated object values | primary inbound | present | 1 | object ingestion present; full matrix open |
| E31 | aggregate final values | primary inbound | present | 1 | aggregate storage open |
| S05 | aggregate settlement | configurable/bilateral | present | 0 | storage/next action open |
| S07 | object time series | configurable/bilateral | present | 0 | storage/next action open |
| E73 | object request for E66/S02 | configurable/bilateral | present | 0 | outbound builder present; field matrix open |
| E74 | aggregate request for E31/S03 | configurable/bilateral | present | 0 | field matrix/storage open |
| E30 | collected object values | not normal supplier action | present | 0 | object ingestion present; capability proof open |
| S01/S04 | aggregate values | not normal supplier action | present | 0 | storage/next action open |
| E72/S06 | request | not normal supplier action | present | 0 | capability/field matrix open |

## Application Reference matrix

| Family/process | Canonical policy | Evidence |
|---|---|---|
| PRODAT supplier/customer | `23-DDQ-PRODAT` | canonical rulebook + regression |
| PRODAT permissions/ESCO | `23-DGI-PRODAT` | canonical rulebook + regression |
| UTILTS | route/process-derived `23-DDQ-UTILTS` in current support registry | route mismatch is fail-closed; complete per-process official matrix remains part of EDIEL-006 |
| ACK | correlate to source message; never independently select business AppRef | canonical ACK regression |

## Tenant, route and ACK matrices

| Control | Result | Evidence |
|---|---|---|
| Inbound tenant from receiver/routing, not mailbox override | verified | inbound tenant-resolution and shared-mailbox regressions |
| Outbound company-scoped materialization | verified | two-tenant route-isolation regression |
| Unknown/ambiguous tenant quarantine | implemented | `ediel_inbound_quarantine` and tenant resolver |
| Immutable outbound payload and tenant-consistent outbox | implemented | DB triggers and canonical consolidation regression |
| CONTRL != business acceptance | verified | acknowledgement-engine regression |
| Negative APERAK / UTILTS-ERR stop automation | verified | acknowledgement-engine regression |
| Per-transaction ACK coverage table | implemented | `ediel_ack_transaction_results` |
| Complete mixed 95/3/2 transaction execution | blocked | no end-to-end official fixture evidence |

## Inbound disposition / next-action matrix

| Input | Current disposition | Required next action | Status |
|---|---|---|---|
| Z02 | customer-info request completion | continue customer flow | verified |
| Z04 L/LK/C/A/D | supplier-switch/regulated supply state machine | activate/cancel/review based on correlation | verified by code; hosted DB fixture still required |
| Z05 | terminate or review | end supply / manual review | implemented |
| Z06/Z09/Z10 | master-data proposal | review before mutation | implemented fail-safe |
| Z13/Z14/Z15/Z18 | permission lifecycle | request/confirm/reject/end | implemented |
| E66 | object meter-value ingestion | readiness recalculation, never direct invoice | partial; ingestion present, complete field rules absent |
| S02 | forecast | forecast projection only | missing domain persistence |
| S03/E31/S05 | aggregate settlement/planning | reconciliation only | missing domain persistence |
| S07 | bilateral object time series | configured handler | missing domain persistence |
| negative CONTRL/APERAK/UTILTS-ERR | correlated stop + admin action | manual remediation | verified |

## False positives and blocked checks

- Supabase reports 12 `authenticated_security_definer_function_executable` warnings. Function definitions were inspected: the flagged routines are authenticated tenant-context/RLS helpers or guarded self-service RPCs with pinned `search_path` and explicit `auth.uid()`/permission checks. They are not blindly revoked because doing so would break RLS and authenticated context resolution. Treat as reviewed warnings, not proof of absence of risk.
- A separate staging/production Supabase project is not exposed; only `gridex-ops-dev` can be queried and migrated.
- Official Ediel portal TGT/AGT evidence and the complete UTILTS 25-A-3 field matrices are not present in the repository or connected tools. No row is marked verified from examples alone.
- Node 24 is installed locally while the repository declares Node `>=22 <23`; final release verification must also run on hosted Node 22.

## Release-gate evidence on the final tree

| Gate | Result |
|---|---|
| Migration integrity and generated types | passed; 421 migrations and latest `20260813123500` checksum verified |
| Application and test TypeScript | passed |
| Full Vitest suite | passed; 71 files / 502 tests |
| Canonical Ediel consolidation | passed; 18 tests and 309-file regression |
| Full Ediel intent pipeline regression | passed; batches 1–9 |
| RBAC audit | passed; 24 checks / 0 warnings |
| Production dependency audit | passed; 0 vulnerabilities |
| ESLint | passed with 0 errors / 141 pre-existing warnings |
| Node 22 production build | passed with 4 GB heap; 13 static pages generated |
| Supabase post-migration security advisor | 12 reviewed WARN notices; no new DDL finding |
| Supabase post-migration performance advisor | 1,256 notices: 20 WARN / 1,236 INFO; no release claim made from dev usage statistics |

The production build initially exposed an unrelated Next.js 16 route-config error in
`/admin/customer-applications`: `dynamic` was re-exported instead of declared locally.
The route now declares the static config in its own page module, and the Node 22 build passes.

## Remediation and verification plan

1. Import source-bound UTILTS 25-A-3 field matrices for all active codes; add 25-A-4 as future-only.
2. Add immutable transaction/observation storage for object, forecast and aggregate facts.
3. Add a canonical inbound disposition and next-action evaluator for every profile.
4. Prove transaction-level partial success and atomicity with 95/3/2 and concurrency fixtures.
5. Map official TGT/AGT artifacts and run them against the exact rule-pack hashes.
6. Run full local/hosted gates, then merge only if all critical rows are verified.

Production verdict at this checkpoint: **NOT READY**.
