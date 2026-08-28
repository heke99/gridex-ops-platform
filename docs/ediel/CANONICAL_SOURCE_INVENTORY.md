# Canonical Ediel source inventory

Status date: 2026-08-28

This inventory is the provenance contract for the Gridex canonical Ediel/EDIFACT engine. Runtime rules must be deterministic code derived from the listed authoritative sources. Database rows may persist projections, evidence, snapshots and activation state, but may not redefine protocol semantics.

## Source precedence

1. Latest semantically effective change from Svenska kraftnät / Edielportal documentation.
2. Message-family guide.
3. Generella tekniska regler.
4. Elmarknadshandboken for business-process semantics and market timing.
5. Product/structure/code-list documentation explicitly referenced by the guide.
6. Portal-approved interoperability fixtures as regression evidence.
7. Current database rows as persisted projection/evidence.
8. Legacy runtime behavior.

A lower source never overrides a higher source. Missing or ambiguous authoritative evidence fails closed.

## Authoritative guides

| Family | Revision | Association code | Effective | Source | Runtime owner |
|---|---|---:|---|---|---|
| PRODAT | 26-A revision 3 | E2SE6A | 2026-04-01 | `260630_Ediel_PRODAT_APERAK_Anvisning_version_26-A_16-B` | `lib/ediel/rulebook/prodatRulebook.ts`, `lib/ediel/rulebook/prodatSubtypeRegistry.ts`, `lib/ediel/prodat/prodat26AFieldMatrix.ts` |
| PRODAT APERAK | 16-B | E2SE6A | semantic rules from 2016-12-01; paired current guide 2026-04-01 | same PRODAT/APERAK guide | `lib/ediel/rulebook/aperakRulebook.ts`, `lib/ediel/ack/inboundAckOutcome.ts`, `lib/ediel/prodat/prodatAperak.ts` |
| UTILTS | 25-A-3 | E5SE5A | 2025-06-01 through 2026-09-30 | `251001_Ediel_UTILTS-APERAK_User_Guide_Version_25-A-3` | canonical UTILTS field/profile rulebook |
| UTILTS | 25-A-4 | E5SE5A | 2026-10-01 onward | `260331_Ediel_UTILTS-APERAK_User_Guide_Version_25-A-4`, updated 2026-08-05 | 25-A-3 immutable base + `lib/ediel/rulebook/utilts25A4.ts` overlay |
| UTILTS APERAK | 05-B/current Swedish UTILTS profile | family-specific | guide-effective | current UTILTS guide | UTILTS ACK engine; never reuse PRODAT BGM semantics |
| UTILTS-ERR | 24.A | E5SE5A transport family | guide-effective | current UTILTS technical profile | UTILTS functional/processability ACK path |
| CONTRL | 2:2 / technical rules 24-A-6 | n/a | 2024-04-01 onward | `260220_Ediel-anvisning-generella_tekniska_regler_version_24-A-6` | `lib/ediel/contrlEngine.ts`, canonical ACK classifier |

## Effective-date rule

Association-assigned code is not sufficient to select a Swedish guide revision. UTILTS 25-A-3 and 25-A-4 both use E5SE5A. Runtime therefore resolves by family + association code + business/reference date. A future guide is never selected merely because it exists in the repository.

## PRODAT field-matrix provenance

The complete 26-A matrix is represented by `lib/ediel/prodat/prodat26AFieldMatrix.ts`:

- 77 rows
- 13 message functions: Z01, Z02, Z03, Z04, Z05, Z06, Z08, Z09, Z10, Z13, Z14, Z15, Z18
- 1001 deterministic message/field requirements
- R = required
- D = dependent
- O = optional
- - = forbidden/not used

The historical SQL import `20260530190000_import_prodat_26a_field_matrix.sql` is retained as migration history and DB projection evidence. It is not the normative runtime owner.

## Market timing / deadline provenance

Swedish business timing from Svensk Elmarknadshandbok 26A chapters 10.2.1 and 11.3 is source-controlled in `lib/ediel/rulebook/deadlinePolicy.ts`.

The deadline policy owns, among other rules:

- Z02 L/LK response within 30 minutes of Z01.
- Z03L: earliest 14 months before and latest 14 calendar days before delivery start.
- Z03LK: earliest 14 months before and latest on the move-in day.
- Z03C: subtype/context-specific cancellation deadlines.
- Z04/Z05/Z06/Z08/Z09/Z10 response/change timing from the chapter 10.2.1 table.
- Z13V/Z13VH historical date bounds, including the three-year limit and current grid-agreement start when that evidence is later.
- Z14 V/VH/N 21-day handling window.
- Z15/Z18 qualitative "as soon as possible" / in-connection-with timing without inventing numeric deadlines.

Operational consumers must use `canonicalEdielFacade`; they may not import `deadlinePolicy.ts` directly.

`ediel_business_deadline_rules` and supplier-switch rows in `market_process_policies` are retained only as historical/projection evidence. They are inactive and must never be read by runtime as normative timing. `scripts/ediel-normative-authority-guard.cjs` fails CI if those DB tables regain an operational runtime reader.

## UTILTS 25-A-4 delta

25-A-4 is intentionally an overlay rather than a copied matrix. The overlay owns only the documented changes, including removal of S08-only fields 535-538, removal of E19 as a rejection reason, removal of transaction reason Z03, and the changed processability behavior for individual meter-reading/energy comparisons. Historical 25-A-3 behavior remains immutable for dates through 2026-09-30.

## Actor identity evidence

Legal/market identity and transport identity are separate. The canonical tenant model stores environment-scoped Ediel identifiers and roles and supports representation as an explicit relation. No representation relation may be inferred merely because one Ediel ID can transport messages for another context.

The 2026-08-27 dev migration materializes tenant identities only from an active tenant actor setting joined to a verified platform Ediel identifier. It creates no representation relation without evidence.

## Portal/TGT evidence

Portal-approved files are interoperability evidence, never the source of normative rules. A fixture may prove that the canonical implementation interoperates with the portal; it cannot override the guide.

External approval/certification must never be fabricated. `READY_FOR_TGT` and `PORTAL_APPROVED` are distinct states.
