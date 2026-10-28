# Avgränsad överlämning — F48 / J2-13 (ägarbeslut 43)

Ägarvillkor (ordagrant): "Ändringar i skyddad kod och godkända tester ska genomföras med avgränsad överlämning, bevarade skydd och nya positiva och negativa regressioner."

## Exakt omfattning
- **Godkänt test som ändras:** `__tests__/ediel-sc-059-registered-subaddress.test.ts` (SC-059, PASSED i `quality/audits/ediel-masterplan-v2/coverage.json`).
  - Två rader: UTILTS-fallet materialiserar nu routen med meddelandekod **E73** i stället för **E66**, och renderingssonden skriver `BGM+E73` i stället för `BGM+E66`. Ingen assertion ändras.
- **Ingen låst SQL-kropp ändras.** Migrationen `20261028130000_f48_utilts_registry_route_e73_readiness.sql` skriver bara om vyn `gridex_company_route_readiness_v` (CASE i CTE:n `platform_routes`), med exakt nål, frånvarande markör och kontroll av ägare, ACL, `security_invoker` och kolumnlista.
- Ändrad produktkod: `lib/ediel/routeMaterializer.ts`, `lib/ediel/flows/utiltsSupplierRequest.ts`, `app/admin/ediel/route-readiness/actions.ts`, ny `lib/ediel/utilts/supplierUtiltsOutboundScope.ts`. Ingen av dem är evidens för ett godkänt ID.
- Ändrat icke-godkänt test: `__tests__/registry-route-supplier-switch.test.ts` (F85), två förväntningar för UTILTS-projektionen: `[null]` blir `['E73']`.

## Varför
- Ägarbeslut 43: elhandlaren originerar inte nätägarens E66. Materialiseraren vägrar därför en UTILTS-route med en annan kod än E73 (`platform_route_message_code_not_materializable`).
- SC-059 använde E66 bara som etikett för UTILTS-routen. Det SC-059 bevisar är den registrerade subadressen genom materialisering, kontext och UNB, och det gäller oförändrat för E73-routen. Application Reference förblir `23-DDQ-E66-S`, den begärda typens referens.

## Bevarade skydd
- SC-059:s assertioner om mottagarsubadress, avsändarsubadress, UNB-komponenter, skrivordning, frysta projektionshashar och `first_production_send_approved=false` är oförändrade och gröna (13/13).
- `assertCanonicalSupplierUtiltsOutboundAllowed`, `prepareAndQueueUtiltsE66` (fail-closed), kravet på bilateral E73-kapabilitet och den kvalificerade daterade strukturen (U-06) är oförändrade.
- Fältet 311 valideras mot 25-A-3-registret. Ingen S/T-variant härleds, och ingen generell E73-referens byggs.
- PRODAT-raderna i vyn och SQL-bulkfunktionen är oförändrade.

## Nya regressioner
- `__tests__/reality-f48-utilts-e73-scope.test.ts` (19 fall), positiva och negativa.
- `__tests__/reality-f48-utilts-route-materialization.test.ts` (13 fall, PGlite med den riktiga migrationen), positiva och negativa.
