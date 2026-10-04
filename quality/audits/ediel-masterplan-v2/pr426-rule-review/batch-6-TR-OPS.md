# Batch 6 — TR-01..11, OPS-01..05, AI-04
- **Godkända:** TR-04 (+SC-062), TR-07 (+SC-061), TR-11, OPS-01, AI-04. Misstänkta defekter E1, E2, E4, E5, E7 fp-kontrollerade: FALSE_POSITIVE.
- **Bekräftad defekt F-OPS-02 (medel):** kundkort/arbetskö härleder "väntar" och nästa steg från statiska `customer_info_requests.status`
  i stället för processprojektionen (customerCardWorkflow.ts:143-150,486-491). OPS-02 ej godkänd.
- **Oavgjord TR-09 (E6):** klartext blockeras bara för produktions-PRODAT; övriga familjer kan gå okrypterat via route. Kräver källa T §3.1 (finns ej i repot).
- PARTIAL: TR-01 (portaltestbrevlåda ej kontrollerad), TR-02 (4xx/5xx efter inträde blir delivery_uncertain), TR-03 (provider-ID ej separat),
  TR-05, TR-06 (olika statusfilter i två vägar), TR-08 (relä-TLS/leveransspår saknas), TR-10 (lease utan heartbeat), OPS-03, OPS-04, OPS-05.
