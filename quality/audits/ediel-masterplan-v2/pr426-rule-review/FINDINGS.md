# Findings register — PR #426 rule review (2026-10-03)

| ID | Regel | Allvar | Status | Bevis / åtgärd |
|---|---|---|---|---|
| F-TEN-01 | TEN-01 | medel | ✅ rättad a7ad87a9 | central outbound execution context |
| F-TEN-02 | TEN-01 | låg | ✅ rättad a7ad87a9 | ingen tenantlös global aktör |
| F-TEN-03 | TEN-02 | medel | ✅ rättad a7ad87a9 | rollbundna aktörsprofiler |
| F-TEN-04 | TEN-06 | medel | ✅ rättad 2c78bede | juridisk mottagare endast DO/MR |
| F-U-04 | U-04 | hög | ✅ rättad 102fe9b1 (migr. 20261003150000) | sen äldre version tränger ej undan nyare |
| F-U-14 | U-14 | hög | ✅ rättad 102fe9b1 (migr. 20261003150000) | received-ERR-dispatcher återställd |
| F-OPS-02 | OPS-02 | medel | öppen | kundkort ska läsa processprojektionen |
| F-ENV-01 | ENV-01 | medel | öppen | UNOC-repertoar för alla utgående segment |
| F-GOV-03 | GOV-03 | låg | öppen | sätt källfamilj från korrelerat original; fail closed |
| U-1 | TEN-04 | — | ej avgjord | verify-RPC kräver inget mandat för ombudsroute |
| U-2 | TEN-09 | låg | ej avgjord | end_assignment LIMIT 1 |
| TR-09/E6 | TR-09 | medel | ej avgjord | kräver källa T §3.1 |
| ENV-02, ENV-03, IMP-04, DB-01 | — | — | CONTRADICTED i granskning, fp-check återstår | se batch-7 |
| PGLITE-CI | alla | medel | ✅ delvis | PGlite-regressioner kördes inte i CI; 0.3.14 nu devDependency, U-04/U-14 körs via test-ediel-wrapper |

Falsklarm (fp-check): D4, D5, D6, D8, D9, D11–D15 (TEN), A1–A3 (ACK), C1–C2 (P/U), E1, E2, E4, E5, E7 (TR/OPS/AI), G3–G5 (ENV/GOV).
