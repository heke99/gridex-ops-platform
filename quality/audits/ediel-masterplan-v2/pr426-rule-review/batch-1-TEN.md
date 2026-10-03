# Batch 1 — TEN-01..TEN-14 (head 0c848701)

Metod: `spec-to-code-compliance` (7 oberoende granskare, 2 regler var) + `fp-check`
(4 oberoende verifierare). Rådata: `batch-1-TEN.json`, `batch-1-TEN-fpcheck.json`.

## Regelstatus
Alla 14 = **PARTIAL**. Ingen regel motsäger registret i sin helhet; luckor är
saknade effekter eller saknade beteendetester.

| Regel | Huvudlucka |
|---|---|
| TEN-01 | Verifierad execution context byggs aldrig (F-TEN-01). |
| TEN-02 | En aktörsprofil per bolag/miljö; ingen DDQ/DGI-separation; SC-002 (Z13V i DGI) saknas helt (F-TEN-03). |
| TEN-03 | Z13-wire (avsändare i DGI-roll, inga tenant-UUID) inte provad. |
| TEN-04 | Ingen routning via dokumenterat ombud provad; verify-RPC kräver inget mandat (uppföljning U-1). |
| TEN-05 | Z14→leverans-riktningen saknar negativt test. |
| TEN-06 | Mail-vägen kan välja avsändaren (NAD+MS) som juridisk mottagare (F-TEN-04). |
| TEN-07 | Ingen negativ test: beneficiary nekas rå/transportkopia; inget fil-med-flera-objekt-prov. |
| TEN-08 | Fan-out per grant ok; "ingen dubbelfakturering" (SC-005) oprovat. |
| TEN-09 | SC-015 (väntande Z13, 21-dagarsflöde) saknas; end_assignment LIMIT 1 (U-2). |
| TEN-10 | SC-010 exportjobb med lease saknas; Z15C-återaktiveringsspärr endast PGlite-provad. |
| TEN-11 | Ingen end-to-end-prov att olöst tenant ger CONTRL men ingen E10/42/209. |
| TEN-12 | Cache/sök/export-isolering ej påvisad utanför beneficiary-projektionen. |
| TEN-13 | SC-013 bara unit-provad. |
| TEN-14 | Ingen test att rollrad utan bevis ger held. |

## Bekräftade defekter (fp-check TRUE_POSITIVE)
| ID | Allvar | Defekt | Riktad åtgärd |
|---|---|---|---|
| F-TEN-01 ✅ a7ad87a9 | medel | `createEdielExecutionContext` saknar produktionsanropare (lib/ediel/core/executionContext.ts:160). | Anropa före utgående send/kundmutation; beteendetest för avvisning. |
| F-TEN-02 ✅ a7ad87a9 | låg | `resolveCanonicalActorContext` utan companyId faller tillbaka på global aktör (actorRegistry.ts:55-71); nås från legacy-adminsidan. | Kräv companyId; hoppa över uppslag när scope saknas. |
| F-TEN-03 ✅ a7ad87a9 | medel | Endast en aktiv `ediel_actor_settings`-rad per bolag/miljö (config.ts:240-256); `tenantHasMarketRole` oanvänd. | Forward-migration med marknadsroll i aktörsprofil + rollgrind för DDQ/DGI. |
| F-TEN-04 ✅ rättad 2c78bede | medel | `inboundTenantResolver.ts:152` tar NAD+MS/DDQ som juridisk mottagare → feltillskrivning via delat ombud. | Använd `extractMarketActorEdielIdFromRawPayload` (DO/MR), annars håll. |

## Uppföljning (ej avgjort)
- U-1 (TEN-04): `ediel_verify_registry_el_actor_v1` aktiverar representerad route utan dokumenterat mandat.
- U-2 (TEN-09): `end_assignment` utvärderar bara senaste länkade tillstånd (LIMIT 1) och filtrerar inte status.

## Falsklarm (fp-check FALSE_POSITIVE)
D4 legacy-DGI-härledning (död kod för kanoniska familjer), D5 party_id-fallback (onåbar),
D6 mandatflagga (fail-closed), D8 UNB-fallback (kräver legal==transport), D9 grant-arrayer
(elementvis filtrering), D11 beneficiary-RPC (endast service_role, sessionaktör),
D12 olöst uppgift (skrivs inte utan bolag), D13 admin-OR-RLS (ingen icke-admin-läcka),
D14 ambiguous (fail-closed korrekt), D15 wire-unikhet (reservationstabell finns).

## Nästa steg (två regler i taget)
1. F-TEN-04 + F-TEN-01 (TEN-06/TEN-01) — test först, sedan fix.
2. F-TEN-03 + F-TEN-02 (TEN-02) + SC-002.
3. Saknade beteendetester per regel enligt tabellen, därefter godkännande i coverage.json.

## Status 2026-10-03
- F-TEN-04 rättad i `2c78bede` med test först (`__tests__/ediel-inbound-mail-legal-receiver.test.ts`, märkt TEN-06; rött före, grönt efter).
- F-TEN-01 och F-TEN-03 hänger ihop: en verifierad execution context kräver avsändarroll per process (DDQ/DGI),
  vilket kräver rollbundna aktörsprofiler. Designbeslut begärt av ägaren innan implementation.
- TEN-06 kvar för godkännande: SC-014 (teknisk CONTRL i karantänfallet) saknar beteendetest.

## Status efter a7ad87a9 (ägarbeslut: rollbundna profiler + kernel)
- Processen (23-DDQ/23-DGI) väljer tenantens leverantörs- eller ESCO-profil via befintlig kolumn `actor_role`
  (ingen schemaändring). Profilen kräver motsvarande verifierad marknadsroll i tenantidentiteten.
- Kernel (`createCanonicalOutboundMessage`) kräver att wire-avsändaren är rollprofilens transportidentitet och
  sparar en fryst execution context i `executionContextSnapshot.executionContext` innan utkastet skrivs.
- Ingen tenantlös global aktör används längre (`canonical_actor_company_required`).
- Tester: `ediel-actor-role-profiles.test.ts`, `ediel-outbound-execution-context.test.ts` (rött före, grönt efter);
  hela unitsviten 9496/9496.
- **Produktionspåverkan:** en DGI-sändning (t.ex. Z13) kräver nu en aktiv ESCO-profil (`actor_role='energy_service_company'`)
  och rollen `energy_service_company` i tenantidentiteten. Produktion har i dag endast en aktiv leverantörsprofil.
- Godkännande av TEN-01 sker när CI (inkl. native) är grön på a7ad87a9 eller senare. TEN-02 kräver dessutom SC-001 och SC-002.
