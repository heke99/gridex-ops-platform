# Gridex OPS Website API 2026-07-23.1

> **Ersätter API 2026-07-22.2 för tenantautentiserad resolver och canonical quote.** Den historiska 7.22.2-gränsen nedan förklarar varför interna marknadskällor inte exponeras, men påståenden om att `POST /api/v1/website/quote`, `POST /api/v1/website/quote/validate` och `POST /api/v1/website/energy-area/resolve` returnerar 410 är inte längre aktuella. Endast den oautentiserade legacyrutten `GET /api/public/energy-area` är fortsatt borttagen.

Canonical 7.23.1 innebär ett publicerat fastprisavtal med områdesrader under samma produkt/version, tenantbunden area resolution, quote som låser vald rad och en idempotent kundkedja till kundnummer, anläggning, avtal, mail, uppgiftsbegäran, leverantörsbyte och faktureringssnapshot.

---

## Historik: 2026-07-22.2
# Gridex OPS – korrekt ansvarsfördelning för avtal, priser, avgifter och tenanternas kalkylatorer

## 1. Övergripande mål

Gridex OPS ska vara canonical source of truth för:

* vilka avtal som är publicerade;
* avtalets prismodell;
* fast pris per kWh;
* påslag;
* rörliga avgifter;
* månadsavgifter;
* fakturaavgifter;
* andra avtalsbundna avgifter;
* vilka avgifter som ska visas på hemsidan;
* juridiska villkor och dokument;
* vilka elområden avtalet får säljas i;
* avtalsversion och prisplansversion.

OPS ska däremot inte fungera som tenanternas externa Nord Pool- eller spotprisleverantör.

För rörliga avtal ska varje tenant själv:

* lösa kundens elområde;
* hämta aktuellt eller relevant marknadspris;
* välja sin externa marknadspriskälla;
* beräkna kundens indikativa månadspris;
* presentera kalkylen på sin egen webbplats.

OPS ska leverera alla avtalskomponenter som tenantens kalkylator behöver för att kunna räkna korrekt.

---

# 2. Grundprincip

Det måste finnas en tydlig skillnad mellan:

1. **Vad som påverkar kundens pris**
2. **Vad som ska visas som en separat rad på hemsidan**

En avgift kan vara dold i presentationen men måste ändå skickas till tenantens system och användas i kalkylen.

Exempel:

* Fakturaavgiften är 19 kronor.
* OPS-inställningen säger att fakturaavgiften inte ska visas som en egen rad på avtalskortet.
* Tenantens kalkylator ska ändå få avgiften.
* Avgiften ska fortfarande räknas in i den totala prisberäkningen när den är relevant.
* Kunden ska i den slutliga prissammanställningen kunna förstå vad totalpriset består av, enligt tillämpliga krav och vald presentation.

**Dold får aldrig betyda exkluderad från API eller beräkning.**

---

# 3. Fastprisavtal

## 3.1 OPS ansvar

För fastprisavtal ska OPS alltid skicka det publicerade fasta elpriset per kWh.

Exempel:

```json
{
  "pricing_model": "fixed",
  "fixed_price": {
    "amount": 140,
    "unit": "ore_per_kwh",
    "vat_included": true
  }
}
```

Det fasta priset är en del av själva avtalet och ska därför alltid komma från OPS.

Tenantens webbplats ska aldrig:

* hämta fastpriset från en extern källa;
* försöka räkna fram fastpriset;
* hårdkoda fastpriset;
* ersätta OPS-priset med ett lokalt värde.

## 3.2 Tenantens kalkylator

Tenantens webbplats ska använda fastpriset i sin kalkylator.

Exempel:

```text
Årsförbrukning: 12 000 kWh
Månadsförbrukning: 1 000 kWh
Fast pris: 140 öre/kWh
Månadsavgift: 49 kr
Fakturaavgift: 19 kr
```

Beräkningen ska i förenklad form bli:

```text
Energikostnad:
1 000 kWh × 1,40 kr = 1 400 kr

Månadsavgift:
49 kr

Fakturaavgift:
19 kr

Beräknad månadskostnad:
1 468 kr
```

Kalkylatorn ska alltså använda:

* fast pris per kWh;
* beräknad förbrukning;
* månadsavgift;
* fakturaavgift;
* andra relevanta fasta eller förbrukningsbaserade avgifter;
* korrekt momsstatus.

## 3.3 Presentation för kunden

Kunden ska tydligt kunna se exempelvis:

```text
Fast elpris: 140 öre/kWh inklusive moms
Beräknad månadskostnad: 1 468 kr
Beräknad årskostnad: 17 616 kr
```

Kalkylen ska också kunna visa en sammanställning av vilka delar som ingår.

---

# 4. Rörligt månadspris

## 4.1 OPS ansvar

OPS ska skicka avtalets egna prisdelar:

* påslag;
* rörlig avgift;
* månadsavgift;
* fakturaavgift;
* andra avtalsavgifter;
* momsstatus;
* avtalsmodell;
* synlighetsinställningar.

OPS ska inte skicka tenantens aktuella Nord Pool-pris.

Exempel:

```json
{
  "pricing_model": "variable_monthly",
  "market_price_responsibility": "tenant",
  "markup": {
    "amount": 4,
    "unit": "ore_per_kwh",
    "vat_included": true
  },
  "variable_fee": {
    "amount": 1.5,
    "unit": "ore_per_kwh",
    "vat_included": true
  },
  "monthly_fee": {
    "amount": 49,
    "unit": "sek_per_month",
    "vat_included": true
  },
  "invoice_fee": {
    "amount": 19,
    "unit": "sek_per_invoice",
    "vat_included": true
  }
}
```

## 4.2 Tenantens ansvar

Tenantens webbplats ska:

1. lösa kundens elområde;
2. hämta relevant marknadspris;
3. använda OPS-publicerat påslag;
4. använda OPS-publicerad rörlig avgift;
5. lägga till månadsavgift;
6. lägga till fakturaavgift när den påverkar kalkylen;
7. lägga till övriga avgifter;
8. hantera moms korrekt;
9. visa en indikativ månads- och årskostnad.

Exempel:

```text
Marknadspris: 62 öre/kWh
Påslag: 4 öre/kWh
Rörlig avgift: 1,5 öre/kWh

Sammanlagt energipris:
67,5 öre/kWh
```

För 1 000 kWh per månad:

```text
Energikostnad:
1 000 × 0,675 kr = 675 kr

Månadsavgift:
49 kr

Fakturaavgift:
19 kr

Beräknad månadskostnad:
743 kr
```

Marknadspriset ska märkas som indikativt och komma från tenantens egen valda källa.

---

# 5. Timpris och kvartspris

Samma grundprincip gäller för tim- och kvartspris.

OPS ska skicka:

* prismodellen;
* påslag;
* rörlig avgift;
* månadsavgift;
* fakturaavgift;
* övriga avgifter;
* avtalsvillkor;
* synlighetsinställningar;
* tillåtna elområden.

Tenanten ska själv:

* lösa elområdet;
* hämta tim- eller kvartspris;
* beräkna en uppskattad kostnad;
* visa hur beräkningen har gjorts.

OPS ska inte fungera som det externa tenant-API som hämtar eller levererar aktuella tim- och kvartspriser från Nord Pool.

OPS får däremot internt ha egna prisimporter för:

* fakturering;
* avräkning;
* settlement;
* mätvärdesberäkning;
* revisionsspår;
* faktisk kunddebitering.

Det interna OPS-flödet ska hållas separat från tenantens publika kalkylator.

---

# 6. Alla avgifter måste skickas till tenant

OPS måste alltid skicka samtliga avgifter som gäller för avtalet, även när de inte ska visas som separata rader på hemsidan.

Detta gäller bland annat:

* fast pris;
* påslag;
* rörlig avgift;
* månadsavgift;
* fakturaavgift;
* startavgift;
* miljöavgift;
* administrationsavgift;
* handelsavgift;
* certifikatkostnad;
* balansansvarsavgift;
* andra framtida avgiftstyper.

API:t får inte filtrera bort en avgift enbart för att den är dold i webbplatsens presentation.

## Korrekt modell

Varje avgift ska minst innehålla:

```json
{
  "code": "invoice_fee",
  "amount": 19,
  "unit": "sek_per_invoice",
  "vat_included": true,
  "calculation_inclusion": "included",
  "website_visibility": "hidden"
}
```

De två viktigaste fälten är:

```text
calculation_inclusion
website_visibility
```

### `calculation_inclusion`

Anger om komponenten ska användas i tenantens kalkyl.

Exempel:

```text
included
excluded
conditional
```

I normalfallet ska en gällande avtalsavgift vara `included`.

### `website_visibility`

Anger hur avgiften får presenteras.

Exempel:

```text
visible
hidden
summary_only
```

Betydelser:

* `visible`: visas som egen rad på avtalskort och i kalkyl.
* `hidden`: visas inte som separat säljrad men skickas ändå och används i kalkylen.
* `summary_only`: visas i den fullständiga prissammanställningen men inte nödvändigtvis på avtalskortet.

---

# 7. OPS ska styra presentationen men inte ta bort data

OPS-administratören ska kunna bestämma vilka delar som ska visas på hemsidan.

Exempel:

```json
{
  "website_display": {
    "show_fixed_price": true,
    "show_markup": true,
    "show_variable_fee": false,
    "show_monthly_fee": true,
    "show_invoice_fee": false,
    "show_estimated_monthly_cost": true,
    "show_estimated_annual_cost": true,
    "show_full_price_breakdown": true
  }
}
```

Detta ska endast påverka presentationen.

Det får inte göra att tenantens API-svar saknar:

* påslag;
* avgifter;
* prisvärden;
* beräkningskomponenter;
* momsuppgifter.

Tenantens backend eller kalkylmotor ska alltid få hela den maskinläsbara prismodellen.

---

# 8. Rekommenderad API-struktur

Ett publicerat avtal bör returneras med en uppdelning mellan:

1. prismodell;
2. beräkningskomponenter;
3. synlighetsregler;
4. sammanställningsregler.

Exempel:

```json
{
  "offer_reference": "offer_abc123",
  "pricing_model": "fixed",
  "pricing": {
    "fixed_price": {
      "amount": 140,
      "unit": "ore_per_kwh",
      "vat_included": true
    },
    "fees": [
      {
        "code": "monthly_fee",
        "label": "Månadsavgift",
        "amount": 49,
        "unit": "sek_per_month",
        "vat_included": true,
        "calculation_inclusion": "included",
        "website_visibility": "visible"
      },
      {
        "code": "invoice_fee",
        "label": "Fakturaavgift",
        "amount": 19,
        "unit": "sek_per_invoice",
        "vat_included": true,
        "calculation_inclusion": "included",
        "website_visibility": "hidden"
      }
    ]
  },
  "website_display": {
    "show_fixed_price": true,
    "show_monthly_fee": true,
    "show_invoice_fee": false,
    "show_estimated_monthly_cost": true,
    "show_full_price_breakdown": true
  }
}
```

Tenantens kalkylmotor använder samtliga komponenter där:

```text
calculation_inclusion = included
```

Tenantens gränssnitt visar komponenterna enligt:

```text
website_visibility
```

---

# 9. Kalkylatorns obligatoriska beteende

Tenantens kalkylator ska kunna ta emot:

* avtalstyp;
* årsförbrukning;
* uppskattad månadsförbrukning;
* fast pris eller marknadspris;
* påslag;
* förbrukningsbaserade avgifter;
* månadsavgifter;
* fakturaavgifter;
* andra fasta avgifter;
* momsstatus;
* synlighetsinställningar.

Kalkylatorn ska sedan returnera minst:

* energikostnad per månad;
* fasta avgifter per månad;
* fakturaavgifter;
* övriga avgifter;
* beräknad total månadskostnad;
* beräknad årskostnad;
* beräknat pris per kWh;
* vilka antaganden som har använts;
* om marknadspriset är indikativt;
* vilket elområde kalkylen avser.

---

# 10. Kundens prissammanställning

Kunden ska kunna få en begriplig sammanställning, exempelvis:

```text
Din beräkning

Elområde: SE3
Beräknad årsförbrukning: 12 000 kWh
Beräknad månadsförbrukning: 1 000 kWh

Fast elpris:
1 400 kr

Månadsavgift:
49 kr

Övriga kostnader som ingår i kalkylen:
19 kr

Beräknad månadskostnad:
1 468 kr

Beräknad årskostnad:
17 616 kr
```

När en avgift är satt som dold behöver den inte marknadsföras som en egen avgiftsrad på avtalskortet.

Den ska dock:

* vara med i totalsumman;
* finnas i den maskinläsbara prisinformationen;
* kunna ingå i en fullständig kostnadssammanställning;
* vara tillgänglig vid avtalsteckning och juridisk information när detta krävs.

---

# 11. Fastpris och moms

OPS måste vara tydlig med om priset är:

* inklusive moms;
* exklusive moms;
* olika beroende på kundtyp.

API:t ska inte tvinga tenantens webbplats att gissa.

Exempel:

```json
{
  "amount": 140,
  "unit": "ore_per_kwh",
  "vat": {
    "rate": 25,
    "included": true
  }
}
```

För företagskunder kan samma avtal exempelvis returneras eller presenteras exklusive moms, beroende på hur avtalet är publicerat.

---

# 12. Kundtyp

Alla priser och avgifter ska vara bundna till rätt kundtyp:

* privatkund;
* företagskund;
* eventuell annan framtida kundtyp.

OPS ska skicka rätt prisuppsättning för den kundtyp som tenantens webbplats frågar efter.

Tenanten ska inte själv försöka översätta privatpriser till företagspriser eller tvärtom.

---

# 13. Versionering

När ett avtal publiceras ska följande låsas i en version:

* prismodell;
* fast pris;
* påslag;
* samtliga avgifter;
* momsregler;
* synlighetsinställningar;
* juridiska dokument;
* giltighetsperiod;
* elområden;
* kundtyp;
* beräkningsregler.

Tenanten ska få en stabil publicerad version.

Ändringar i ett aktivt avtal ska skapa en ny version och inte förändra historiska kundansökningar eller tidigare prisunderlag.

---

# 14. Quote och avtalsval

OPS behöver inte längre räkna ut tenantens Nord Pool-baserade visningspris.

OPS kan däremot skapa ett låst avtalsval eller `contract_selection_reference` som innehåller:

* tenantidentitet;
* `offer_reference`;
* publiceringsversion;
* prisplansversion;
* juridikversion;
* kundtyp;
* elområde;
* giltighetstid;
* avtalets fullständiga prisformel;
* samtliga avgifter.

För fastpris kan det låsta underlaget också innehålla det fasta priset per kWh.

För rörliga avtal ska tenantens tillfälliga marknadspris inte bli en bindande del av avtalet.

---

# 15. Kundansökan

När kunden skickar in en ansökan ska tenantens webbplats skicka:

* valt avtal;
* kundtyp;
* kunduppgifter;
* adress;
* tenantens lösta elområde;
* juridiska godkännanden;
* eventuell beräknad förbrukning;
* avtalsvalets referens.

OPS ska kontrollera:

* att avtalet fortfarande är publicerat;
* att avtalsversionen är giltig;
* att kundtypen är tillåten;
* att elområdet är tillåtet;
* att juridiska krav är uppfyllda;
* att rätt pris- och avgiftsversion används.

OPS ska inte kräva att tenantens indikativa Nord Pool-pris skickas tillbaka som canonical avtalspris.

---

# 16. Elområdesansvar

Tenanten ska själv lösa elområdet för den publika kalkylatorn.

OPS kan ta emot:

```json
{
  "price_area_code": "SE3"
}
```

OPS ska verifiera att:

* området är ett giltigt område;
* avtalet får säljas i området.

OPS ska inte vara ett krav för att tenantens kalkylator ska kunna visa ett pris.

Internt kan OPS senare verifiera nätområde, nätägare och anläggningsinformation inför leverantörsbyte.

---

# 17. Nord Pool och marknadspris

OPS externa tenant-API ska inte returnera:

* aktuellt Nord Pool-pris;
* spotpris per månad;
* timspotpris;
* kvartsspotpris;
* interna spotpris-ID:n;
* tenantens externa marknadsdatakälla;
* spotprisets interna fallbackkedja;
* OPS interna marknadsprispolicy.

Tenanten ansvarar för dessa delar i sin publika kalkylator.

OPS får fortsätta lagra och importera marknadspriser internt för:

* fakturering;
* settlement;
* avräkning;
* intern riskhantering;
* revisionsspår.

---

# 18. Viktigaste reglerna

## Regel 1

Fastpris ska alltid skickas från OPS och användas i tenantens kalkylator.

## Regel 2

Alla avgifter som gäller avtalet ska alltid skickas till tenantens backend.

## Regel 3

En dold avgift ska fortfarande användas i kalkylen.

## Regel 4

Synlighet och beräkningspåverkan ska vara separata fält.

## Regel 5

Tenanten ska kunna beräkna korrekt månads- och årspris utan att känna till OPS interna databas-ID:n.

## Regel 6

OPS ska inte leverera tenantens externa Nord Pool-pris.

## Regel 7

Tenanten ska själv lösa elområde och hämta marknadspris för rörliga avtal.

## Regel 8

OPS ska kontrollera att valt elområde är tillåtet för avtalet.

## Regel 9

Den publicerade avtalsversionen ska innehålla alla priser, avgifter och visningsregler.

## Regel 10

Kundens prissammanställning ska vara begriplig och totalsumman ska inkludera samtliga tillämpliga kostnader.

---

# 19. Slutlig ansvarstabell

| Funktion                        |                OPS |                                Tenant |
| ------------------------------- | -----------------: | ------------------------------------: |
| Publicera avtal                 |                 Ja |                                   Nej |
| Fast pris per kWh               |                 Ja |                    Visar och beräknar |
| Påslag                          |                 Ja |                    Visar och beräknar |
| Rörlig avgift                   |                 Ja | Visar enligt inställning och beräknar |
| Månadsavgift                    |                 Ja | Visar enligt inställning och beräknar |
| Fakturaavgift                   |                 Ja | Visar enligt inställning och beräknar |
| Dolda avgifter                  |     Skickar alltid |                     Använder i kalkyl |
| Synlighetsinställningar         |                 Ja |                                Följer |
| Lösa publikt elområde           |                Nej |                                    Ja |
| Hämta Nord Pool-pris            |                Nej |                                    Ja |
| Beräkna indikativt rörligt pris |                Nej |                                    Ja |
| Beräkna fastprisets månadspris  | Levererar underlag |                                    Ja |
| Visa prisuppdelning             |   Levererar regler |                                    Ja |
| Verifiera tillåtet elområde     |                 Ja |                        Skickar område |
| Faktiskt faktureringsunderlag   |                 Ja |                                   Nej |
| Avräkning och settlement        |                 Ja |                                   Nej |
| Juridiska krav                  |                 Ja |         Visar och samlar godkännanden |

---

# 20. Samlad målbild

OPS ska leverera en komplett, korrekt och versionslåst beskrivning av avtalet.

Det innebär att tenantens system alltid får:

* alla priser;
* alla avgifter;
* alla beräkningskomponenter;
* alla momsregler;
* alla synlighetsinställningar;
* alla juridiska krav;
* alla tillåtna elområden.

Tenantens webbplats ska därefter använda dessa uppgifter i sin kalkylator.

För fastpris används OPS fasta pris per kWh direkt.

För rörliga avtal hämtar tenantens webbplats själv marknadspriset och kombinerar det med OPS påslag och avgifter.

Avgifter som inte ska synas separat på hemsidan ska ändå skickas med och räknas in. På så sätt kan tenantens kalkylator alltid ge kunden ett korrekt beräknat månadspris, årspris och en fullständig prissammanställning.

---

# 21. Aktivt endpointkontrakt

## Tenantkontext

```http
GET /api/v1/integration/context
Scope: integration_context.read
```

API-nyckeln är auktoritativ tenantidentitet. Externa klienter får aldrig välja tenant med internt `company_id`.

## Publicerade website-avtal

```http
GET /api/v1/website/public-contracts?customer_type=private
Scope: website_contracts.read
```

Svaret är både urvalsfeed och komplett maskinläsbart beräkningsunderlag:

- `pricing.calculation_components` innehåller alla tillämpliga komponenter;
- `pricing.components` är kompatibilitetsalias för samma fullständiga lista;
- `pricing.display_components` innehåller endast komponenter som får visas på avtalskortet;
- `calculation_inclusion` styr beräkning;
- `website_visibility` styr presentation;
- `fixed_price_ore_per_kwh` och `pricing.fixed_price` returneras alltid för fastpris;
- dolda månads-, faktura- och övriga avgifter returneras alltid när de gäller;
- `pricing.calculation_contract.market_price_supplied_by_ops` är alltid `false`.

## Kundansökan

```http
POST /api/v1/website/customer-applications
Scope: website_applications.write
Idempotency-Key: required
```

`offer_reference` är den enda kommersiella väljaren. Tenantens backend skickar sitt lösta `price_area_code`. OPS verifierar att området är giltigt och tillåtet för den publicerade avtalsversionen.

`quote_reference` ska skickas av nya integrationer efter att OPS skapat en canonical quote. Legacy omission stöds tillfälligt och fryser då samma publicerade version direkt.

## Intern OPS-prissättning

OPS interna spotprisimport, avräkning, settlement och faktureringsmotor finns kvar. Dessa interna datakällor får inte exponeras via website-API:t eller användas som tenantens publika Nord Pool-källa.

# 22. Releasekrav

En release är inte klar förrän följande är grönt:

1. TypeScript typecheck.
2. Public contract visibility- och calculation-contract-tester.
3. API-regression för aktiva tenantautentiserade quote-/resolverroutes samt fortsatt borttagen publik legacyresolver.
4. OpenAPI-validering mot version `2026-07-23.1`.
5. Migration checksum-verifiering.
6. Full Next.js-produktionsbuild.
7. Kontroll att website-klienter får endast de återaktiverade quote-/resolver-scopes som deras websitekontrakt kräver.
8. Kontroll att fastpris och dolda avgifter finns i public contract DTO.
9. Kontroll att ingen tenant-route returnerar Nord Pool-, spot- eller market-source-data.


`pricing.summary_components` används för fullständig prissammanställning, medan totalsumman alltid utgår från `pricing.calculation_components`.


API-svaret innehåller `contract_schema_version=2026-07-23.1` och headern `X-Gridex-Contract-Version`. Versionsvärdet ingår i ETag-underlaget så att klienter inte får `304 Not Modified` mot en äldre DTO när kontraktsrepresentationen ändras.
