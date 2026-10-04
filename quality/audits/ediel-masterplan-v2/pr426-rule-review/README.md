# PR #426 — regel-för-regel-granskning (start 2026-10-03)

Ägarbeslut 2026-10-03: granska allt i #426 i mindre batcher och kontrollera att
varje regel är korrekt byggd. Framåt byggs **två regler i taget**, och de ska vara
korrekt byggda och godkända (coverage.json + märkta gröna tester) innan nästa par
påbörjas.

## Metod (skills)
- `spec-to-code-compliance`: en granskare per regelpar, i egen kontext, mot
  `docs/ediel/masterplan-v2/registers/{rules,acceptance_tests}.json`.
- `fp-check`: varje påstådd avvikelse (CONTRADICTED/defekt) verifieras separat
  innan den räknas som bekräftad.
- `verification-before-completion`: inget ID godkänns utan körda, märkta tester.
- `systematic-debugging` + `test-driven-development`: för varje bekräftad defekt.

## Bedömning per regel
Varje effekt (condition, on_pass, on_failure, AT expected, AT prohibited) får:
`IMPLEMENTED` (kod fil:rad + beteendetest som anropar koden), `IMPLEMENTED_UNTESTED`,
`PARTIAL`, `ABSENT` eller `CONTRADICTED`. Regeln är `COMPLETE` endast om alla
effekter är IMPLEMENTED.

## Batcher (prioritet enligt leveranskontraktet)
| Batch | Familj | Regler | Status |
|---|---|---|---|
| 1 | TEN | 14 | klar: 14 PARTIAL, 4 bekräftade defekter (batch-1-TEN.md) |
| 2 | ESCO | 11 | klar: 11 PARTIAL |
| 3 | ACK | 10 | klar: ACK-08, ACK-10 COMPLETE och godkända; 8 PARTIAL |
| 4 | U (UTILTS) | 19 | klar: U-05 godkänd; U-04, U-14 bekräftade defekter |
| 5 | P (PRODAT) | 17 | klar: P-01,03,04,05,09,17 godkända |
| 6 | TR, OPS (+AI-04) | 17 | klar: TR-04, TR-07, TR-11, OPS-01, AI-04 godkända |
| 7 | ENV, GOV, DB, IMP | 29 | klar: GOV-02, GOV-07, ENV-09 godkända |

Resultat per batch: `batch-<n>-<familj>.json` (maskinläsbart) och `.md` (sammanfattning).

## Sammanfattning 2026-10-03
Alla 121 regler granskade. Godkända i coverage.json (inkl. main): 55 ID:n. Fynd: `FINDINGS.md`.
