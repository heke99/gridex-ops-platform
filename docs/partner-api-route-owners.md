# Partner API · Ägare per operation

Metoder och sökvägar nedan följer specifikationen från `GET /api/partner/v1/openapi.json`. Övriga sökvägar är relativa till `/api/partner/v1`. Första hanterare anger vilken gren i den ordinarie rutten som först tar ansvar för svaret. [Specifikationen](../lib/partner-api/businessOpenApi.ts#L40) · [Ruttens dispatch](../app/api/partner/v1/%5B%5B...path%5D%5D/route.ts#L73)

| Metod | Sökväg | Första hanterare |
| --- | --- | --- |
| GET | `/location` | [business](../lib/partner-api/business.ts#L790) |
| GET | `/price/current` | [business](../lib/partner-api/business.ts#L793) |
| POST | `/price` | [business](../lib/partner-api/business.ts#L796) |
| POST | `/contract` | [business](../lib/partner-api/business.ts#L800) anropar `simple` för att skapa avtalet. |
| POST | `/customer` | [simple](../lib/partner-api/simple.ts#L1202) |
| POST | `/customer/{customer_id}/site` | [business](../lib/partner-api/business.ts#L803) anropar `simple` för att skapa anläggningen. |
| POST | `/customer/{customer_id}/site/{site_id}/powerofattorney` | [simple](../lib/partner-api/simple.ts#L1215) |
| GET | `/customer/{customer_id}/site/{site_id}/powerofattorney` | [simple](../lib/partner-api/simple.ts#L1215) |
| GET | `/contract/{contract_id}/state` | [simple](../lib/partner-api/simple.ts#L1198) |
| GET | `/customer/{customer_id}` | [simple](../lib/partner-api/simple.ts#L1205) |
| GET | `/customer/{customer_id}/site/{site_id}` | [simple](../lib/partner-api/simple.ts#L1211) |
| GET | `/customer/{customer_id}/site/{site_id}/invoice` | [simple](../lib/partner-api/simple.ts#L1225) |
| GET | `/invoice/{invoice_id}` | [simple](../lib/partner-api/simple.ts#L1245) |
| GET | `/invoice/{invoice_id}/pdf` | [simple](../lib/partner-api/simple.ts#L1248) |
| GET | `/customer/{customer_id}/site/{site_id}/measurement` | [simple](../lib/partner-api/simple.ts#L1235) |
| POST | `/webhook/subscription` | [simple](../lib/partner-api/simple.ts#L1252) efter ruttens förkontroll av mål-URL. |

`openapi.json` hanteras direkt av rutten. För övriga anrop prövar rutten `business`, `simple`, `canonical` och sist `core`. `business` omsluter skapandet av avtal och anläggning så att lyckade svar kan kompletteras med energiresolution. [Dispatchordning](../app/api/partner/v1/%5B%5B...path%5D%5D/route.ts#L84) · [Avtal och anläggning](../lib/partner-api/business.ts#L751)

Samma dispatchordning gäller för äldre kompatibilitetsvägar. `canonical` översätter `GET /contract/{contract_id}` till `GET /contracts/{contract_id}` och `DELETE /webhook/subscription/{id}` till `DELETE /webhooks/subscriptions/{id}` innan den anropar `core`. Direkta pluralvägar som `GET /contracts/{contract_id}` och `POST /webhooks/subscriptions` går till `core`. [Översättning](../lib/partner-api/canonical.ts#L337) · [Äldre vägar](../lib/partner-api/core.ts#L1130)

Det riktade provet läser den serverade specifikationen och kör varje metod genom den ordinarie Next-rutten fram till dess autentiseringssvar. Vid ändringar i publicerade operationer behövs även ordinarie API-kontrakts- och kompatibilitetsprov samt releaseverifiering för den berörda versionen. [Ägarskapsprov](../__tests__/partner-api-route-ownership.test.ts) · [Ordinarie kontroller](../.github/workflows/ops-hardening.yml#L74)
