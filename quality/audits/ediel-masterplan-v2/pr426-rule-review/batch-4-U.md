# Batch 4 — U-01..U-19 (UTILTS)
- **U-05 COMPLETE → godkänd** (defekt C2 fp-kontrollerad: FALSE_POSITIVE — E23 för DGI är avsiktligt; E88 kräver separat bilateral kapabilitet).
- **U-04 CONTRADICTED — bekräftad defekt F-U-04 (hög):** `persist_series_v2` (20261001010230:190-230) väljer gällande serie efter ankomstordning;
  en sent ankommen äldre version (512/532) blir `is_current` och trycker undan nyare data. Åtgärd: forward-migration + beteendetest.
- **U-14 — bekräftad defekt F-U-14 (hög):** 20261001003807 ersätter UTILTS_ERR-dispatchern från 20261001003657; positiv APERAK för
  mottagen UTILTS_ERR faller alltid. Åtgärd: forward-migration som återinför dispatchern.
- PARTIAL övriga: U-01 (utgående grind alltid leverantör), U-02 (första LOC/QTY-fallback), U-03 (ERR-plan tappar syskon-APERAK i
  responsePlan), U-06 (E73 utan mandat/produkt), U-07 (S06 inkommande), U-08 (Z14 som strukturkälla saknas), U-09 (korrigeringsspår
  oprovat), U-10/U-11 (96/88-kvartsfall oprovat), U-12 (ingen batchplanerare), U-13 (utgående 9/AB ej grindat), U-15/U-16 (ingen
  omkontroll vid sändning utan kontext), U-17 (negativa fall oprovade), U-18 (byggarsidan saknas), U-19 (226-korrelation saknas).
