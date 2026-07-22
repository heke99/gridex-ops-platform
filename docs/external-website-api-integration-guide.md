# Gridex OPS – extern websiteintegration

> **Canonical API-version: 2026-07-22.2**
>
> OPS levererar publicerade avtalsvillkor, fullständiga pris- och avgiftskomponenter, moms, juridik och versionskopplingar. Tenantens backend löser publik elområde/price area och hämtar extern marknadsprisindikation. OPS levererar inte tenantens Nord Pool-pris.

## 1. Autentisering och tenantkontext

Alla anrop görs server-side med tenantens API-nyckel:

```http
Authorization: Bearer YOUR_GRIDEX_API_TOKEN
```

Verifiera nyckelns opaka tenantreferens:

```http
GET /api/v1/integration/context
Scope: integration_context.read
```

Skicka aldrig internt `company_id`, `tenant_id` eller databas-UUID som tenantväljare.

## 2. Hämta publicerade avtal

```http
GET /api/v1/website/public-contracts?customer_type=private
Scope: website_contracts.read
```

Canonical kundtyper är `private` och `business`. Aliaset `company` normaliseras till `business` under övergångsperioden.

Feedens ETag är bunden till `tenant + channel`. Skicka `If-None-Match`; oförändrad feed ger `304 Not Modified`.

### Komplett beräkningskontrakt

`public-contracts` returnerar alltid de prisdelar som behövs för en korrekt kalkyl:

- fast pris per kWh för fastprisavtal;
- spotpåslag;
- rörlig avgift;
- månadsavgift;
- fakturaavgift;
- elcertifikat, miljöavgifter och övriga avgifter;
- momsstatus och momssats;
- alla publicerade beräkningskomponenter;
- presentationsregler.

Dolda komponenter filtreras inte bort från API:t.

```json
{
  "offer_reference": "offer_...",
  "contract_type": "fixed",
  "fixed_price_ore_per_kwh": 112,
  "monthly_fee_sek": 49,
  "invoice_fee_sek": 19,
  "pricing": {
    "fixed_price": {
      "amount": 112,
      "unit": "ore_per_kwh",
      "vat_included": false,
      "vat_rate": 0.25,
      "calculation_inclusion": "included",
      "website_visibility": "visible"
    },
    "calculation_components": [
      {
        "component_code": "monthly_fee",
        "amount": 49,
        "unit": "sek_month",
        "calculation_inclusion": "included",
        "website_visibility": "visible"
      },
      {
        "component_code": "invoice_fee",
        "amount": 19,
        "unit": "sek_invoice",
        "calculation_inclusion": "included",
        "website_visibility": "summary_only"
      }
    ],
    "display_components": [
      {
        "component_code": "monthly_fee",
        "amount": 49,
        "unit": "sek_month",
        "website_visibility": "visible"
      }
    ],
    "calculation_contract": {
      "includes_all_applicable_components": true,
      "hidden_components_must_be_calculated": true,
      "market_price_supplied_by_ops": false
    }
  }
}
```

### Beräkning och presentation är olika saker

- `calculation_inclusion=included`: komponenten ska räknas med.
- `calculation_inclusion=conditional`: komponenten ska räknas med när villkoret inträffar, exempelvis förtida uppsägning.
- `calculation_inclusion=excluded`: komponenten ska inte ingå i aktuell kalkyl.
- `website_visibility=visible`: får visas på avtalskortet.
- `website_visibility=hidden`: visas inte som säljrad, men finns kvar i kalkylen.
- `website_visibility=summary_only`: visas i fullständig prissammanställning men inte nödvändigtvis på avtalskortet.

`pricing.components` är ett kompatibilitetsalias för hela `pricing.calculation_components`. Använd `pricing.display_components` när avtalskortet renderas. `pricing.summary_components` innehåller de komponenter som får visas separat i en fullständig prissammanställning; totalsumman ska fortfarande använda hela `calculation_components`.

## 3. Fastpris i tenantens kalkylator

OPS fasta pris används direkt. Tenantens backend ska kombinera det med kundens förbrukning, samtliga tillämpliga avgifter och moms.

```text
månadsförbrukning = årsförbrukning / 12
energikostnad exkl. moms = månadsförbrukning × fixed_price_ore_per_kwh / 100
subtotal exkl. moms = energikostnad + alla included-komponenter
månadskostnad inkl. moms = subtotal × (1 + vat_rate)
```

En avgift med `website_visibility=hidden` ska fortfarande ingå i subtotalen.

## 4. Rörligt månads-, tim- och kvartspris

Tenantens backend ansvarar för att:

1. lösa kundens prisområde;
2. hämta extern marknadsprisindikation;
3. välja egen leverantör och fallbackpolicy;
4. kombinera marknadspriset med OPS-publicerade påslag och avgifter;
5. visa att resultatet är indikativt;
6. lämna en begriplig månads- och årssammanställning.

OPS externa website-API returnerar inte:

- Nord Pool-pris;
- spotpris per månad;
- tim- eller kvartsspotpris;
- `market_sources`;
- `market_data_timestamp`;
- interna spotpris-ID:n;
- OPS interna provider- eller fallbackpolicy.

OPS interna spotprisdata används fortsatt för fakturering, avräkning och settlement.

## 5. Elområde

Tenantens publika webbplats löser `price_area_code`, exempelvis `SE3`, själv.

Vid kundansökan verifierar OPS:

- att värdet är ett giltigt svenskt prisområde;
- att det valda avtalet är publicerat för området;
- att tenant, avtalsversion och kundtyp matchar.

OPS kan senare verifiera nätområde, nätägare och anläggningsinformation internt inför leverantörsbyte.

## 6. Kundansökan

```http
POST /api/v1/website/customer-applications
Scope: website_applications.write
Idempotency-Key: required
```

Exempel:

```json
{
  "external_customer_id": "CUSTOMER-12345",
  "offer_reference": "offer_...",
  "customer": {
    "customer_type": "private",
    "first_name": "Anna",
    "last_name": "Andersson",
    "email": "anna@example.se",
    "personal_number": "YYYYMMDDXXXX"
  },
  "site": {
    "street": "Storgatan 1",
    "postal_code": "21122",
    "city": "Malmö",
    "price_area_code": "SE4",
    "annual_consumption_kwh": 5000,
    "move_in_date": "2026-09-01"
  },
  "contract": {
    "offer_reference": "offer_...",
    "requested_start_mode": "specific_date",
    "requested_start_date": "2026-09-01"
  },
  "consents": {
    "terms": true,
    "privacy_policy": true,
    "withdrawal": true,
    "power_of_attorney": true,
    "price_terms": true
  }
}
```

`offer_reference` är den enda kommersiella väljaren. Skicka inte interna prisplans-, produkt- eller offer-UUID:n.

`quote_reference` är deprecated och ska inte skickas. Ett legacyvärde ignoreras och blir inte del av det låsta avtalspriset.

## 7. Juridik

OPS är source of truth för juridiska versioner och publika dokumentlänkar. Kraven är databasdrivna och kan variera med kundtyp, avtal, prismodell, kanal och fullmakt. Tenantens klient får inte anta ett fast antal dokument.

## 8. Borttagna endpoints och scopes

Följande endpoints returnerar `410 Gone` från API 2026-07-22.2:

```text
POST /api/v1/website/quote
POST /api/v1/website/quote/validate
POST /api/v1/website/energy-area/resolve
GET  /api/public/energy-area
```

Följande scopes är avaktiverade och tas bort från befintliga website-klienter:

```text
website_quotes.write
website_quotes.validate
website_energy_area.resolve
```

## 9. Aktiv minimiuppsättning för en websiteintegration

```text
integration_context.read
website_contracts.read
website_legal.read
website_applications.write
website_switch_status.read
```

Lägg till portal-, dokument-, notifierings- och events-scopes endast när integrationen använder dessa funktioner.

## 10. Diagnostics och publication webhook

Canonical diagnostics:

```http
GET /api/v1/website/public-contracts/diagnostics
Scope: website_contracts.diagnostics
```

Publication-event:

```text
contracts.publication.changed
```

När revisionen ändras ska tenantens backend invalidiera sin cache och hämta feeden igen med ETag.

## 11. Maskinläsbar dokumentation

OpenAPI:

```text
docs/openapi/website-integration-v1.json
```

Publik utvecklarsida:

```text
/developers/customer-portal-api
```


API-svaret innehåller `contract_schema_version=2026-07-22.2` och headern `X-Gridex-Contract-Version`. Versionsvärdet ingår i ETag-underlaget så att klienter inte får `304 Not Modified` mot en äldre DTO när kontraktsrepresentationen ändras.
