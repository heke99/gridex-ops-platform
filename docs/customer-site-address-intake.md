# Anläggningsadress, nätägarträff och automation

## Grundregel

Nätägarresolvern får endast använda `customer_sites` som aktiv anläggningsadress. Kundens kontakt- och fakturaadress är separata data och används aldrig som dold fallback.

## Tillåtna adresskällor

| Källa | Resultat |
| --- | --- |
| Tenant API | Kandidatuppgift. Kan inte verifiera nätägare eller anläggning. |
| Manuellt intag | Kandidatuppgift. Samma verifieringskedja som tenant-API. |
| Hemsida eller kundportal | Kandidatuppgift. Samma verifieringskedja. |
| Nätägarens svar | Kan verifiera adress när svar och korrelation är säkra. |
| Superadmin | Kan hantera granskning och verifiering. |

## Tenant API

Skicka anläggningsadress via `POST /api/v1/customer/sync`:

```json
{
  "customer_number": "DX-100023",
  "external_customer_id": "TENANT-CUSTOMER-123",
  "facility_data": {
    "customer_site_id": "optional-existing-site-uuid",
    "facility_id": "optional-facility-id",
    "address": {
      "street": "Storgatan 1",
      "postal_code": "21122",
      "city": "Malmö",
      "country": "SE",
      "apartment_number": null
    },
    "move_in_date": "2026-07-01",
    "grid_owner_id": "optional-claimed-owner-id",
    "grid_area_code": "optional-claimed-grid-area"
  }
}
```

`grid_owner_id`, `grid_area_code`, `price_area_code` och `verified_at` från tenantpayload behandlas endast som uppgifter/hints. OPS sätter inte nätägare, route readiness eller verifierad anläggningsstatus från tenantpayload.

## Adresskrav för automatisk nätägarträff

- Gatuadress
- Svenskt femsiffrigt postnummer
- Ort
- Land `SE`

Saknas någon uppgift stannar automationen med status att anläggningsadressen behöver kompletteras. Fakturaadress används inte som reserv.

## Automatik efter ny adress

1. Adressen normaliseras och får hash/provenance.
2. Tidigare nätägarträff och gamla queued/running jobb blir ogiltiga.
3. Automatiken köar ny nätägarträff.
4. Endast verifierad nätägare med verifierad route kan få Z01 eller Z03.
5. Adresskonflikt mot tidigare verifierad adress skapar granskning i stället för överskrivning.

## Superadmin

Superadmin granskar adresskälla, historik, konflikt, resolverresultat, vald nätägare, Ediel-id, route och certifikat. Vanliga tenant-admins kan inte skapa nya nätägare från kundkortet.
