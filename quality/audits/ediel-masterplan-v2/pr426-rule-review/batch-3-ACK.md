# Batch 3 — ACK-01..10
- **ACK-08 COMPLETE, ACK-10 COMPLETE** — misstänkta defekter (A1–A3) fp-kontrollerade: alla FALSE_POSITIVE
  (döda hjälpfunktioner; per-transaktionssändning i `utiltsDataRequest.part-1.ts:706-790`; PRODAT-APERAK kräver källwire).
  Godkända i coverage.json med märkta tester (ACK-08: ediel-prodat-mixed-object-outcome; ACK-10: aperak-unused-document,
  aperak-acw-match, z04-persisted-ack) + native SC-044-bevis.
- PARTIAL: ACK-01 (larm vid negativ CONTRL oprovat), ACK-02 (P-APERAK utan 312/313 oprovat), ACK-03 (ACW-fallback till
  ensam IDE, misstänkt), ACK-04 (loggbegränsning saknas), ACK-05 (APERAK-på-APERAK oprovat; misstänkt positiv APERAK för
  BGM+ERR), ACK-06 (PGlite-test kör ej senaste apply_v1-kedjan), ACK-07 (incident manuell, korrigering bara 'held'),
  ACK-09 (dubblettsvar endast PRODAT).
