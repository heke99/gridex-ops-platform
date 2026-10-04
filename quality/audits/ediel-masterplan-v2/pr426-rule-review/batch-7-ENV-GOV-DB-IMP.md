# Batch 7 — ENV-01..10, GOV-01..08, DB-01..06, IMP-01..05
- **Godkända:** GOV-02, GOV-07, ENV-09 (G4 FALSE_POSITIVE — ägarbeslut 2026-10-02 för APERAK SG4).
- **Bekräftade defekter:**
  - F-ENV-01 (medel): `encodeEdifactLatin1` släpper C0/C1-kontrolltecken utanför UNOC; tenantfritext (namn/adress) når wire.
  - F-GOV-03 (låg): APERAK-versionskontrollen härleder källfamilj från egen associationskod (validator.ts:315-318); ingen producent sätter källfamiljen.
- **CONTRADICTED enligt granskning (ej fp-kontrollerade än):** ENV-02 (CAV-komponenter `filter(Boolean)` i canonicalEdifactAst/fieldMatrix),
  ENV-03 (hårdkodade UNT-räknare i UTILTS-simulering och selftest), IMP-04 (UTILTS-byggaren hittar på subadress 'UTILTS'), DB-01 (parallell
  marknadslös route-auktoritet `ediel_party_addresses`).
- Hårdning (FALSE_POSITIVE men rekommenderas): G5 send-läge `catalog_evidence` i validatorn.
- PARTIAL övriga: ENV-04..08, ENV-10 (UTILTS CCI läses med PRODAT-position), GOV-01, GOV-04..06, GOV-08, DB-02..06, IMP-01..03, IMP-05.
