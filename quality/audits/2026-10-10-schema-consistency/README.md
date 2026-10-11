# Schemajämförelse och konsekvensinventering – 2026-10-10

Endast läsning mot produktion (Supabase `piidsfebjqjmnepdpnas`). Jämfört mot
`supabase/schema.sql` på main `420d212` (autentisk clean replay från CI).
Detaljer per tabell, kolumn och foreign key: `schema-och-konsekvens-inventering.xlsx`.

## Produktion jämfört med repot

| | Antal |
|---|---|
| Tabeller i produktion (public + gridex_*) | 546 |
| Tabeller i repot | 826 |
| Finns i båda | 505 |
| Bara i produktion (gamla, kan städas) | 41 |
| Bara i repot, aldrig driftsatta | 321 |
| – varav `public` | 9 |
| – varav Ediel-scheman `gridex_*` | 312 |
| Tabeller med olika kolumner | 61 |
| Kolumner som koden förväntar sig men som saknas i produktion | 51 |
| Gamla extrakolumner i produktion | 255 |

Migrationshistoriken i produktion (397 poster) följer inte repots 1 122 filer.
762 repo-migrationer saknas till namnet. Att spela upp dem i ordning fungerar
inte, eftersom tidiga Ediel-migrationer bygger på scheman som inte finns.

Slutsatser:

1. `public` ligger nära. Det som saknas är 9 tabeller och 51 kolumner:
   - avtalsbekräftelser (`customer_contract_confirmation_deliveries`),
     staff-identitet (`tenant_staff_*`) och Ediel-tilldelningar (`ediel_service_*`,
     `ediel_data_access_grants`);
   - kolumner i bland annat `customer_supply_periods`, `metering_permissions`,
     `communication_log_events.processed_at`, `customer_invoice_documents`,
     `user_permission_overrides` och `company_invitations`.

   Det går att lösa med en konsoliderad catch-up-migration som är framtagen ur
   diffen och testad mot en Supabase-branch av produktion.
2. Ediel-motorns 312 tabeller i egna scheman har aldrig driftsatts. Det är
   Ediel-teamets leverans och bör driftsättas som en egen, samordnad release
   (via #673), inte blandas in i public-catch-up.
3. 41 gamla tabeller och 255 gamla kolumner finns bara i produktion. De ska
   inventeras och tas bort först när det är verifierat att ingen kod läser dem.

## Konsekvens: radering, atomicitet och dubbletter

| | Antal |
|---|---|
| Foreign keys | 1 278 (508 CASCADE, 417 SET NULL, 182 RESTRICT, 171 NO ACTION) |
| Foreign keys där föreslagen regel skiljer från dagens | 517 (förslag, ska granskas) |
| uuid `*_id`-kolumner utan foreign key | 491 |
| – varav där FK bör läggas till | 410 |
| Idempotens-/dedupe-kolumner utan unik index | 7 (5 bör få unik index) |

### Föreslagen regel: varje tabell får en roll

| Roll | Raderingsregel mot förälder | Exempel |
|---|---|---|
| Ägd kunddata | `CASCADE` från kund, anläggning och mätpunkt | kontakter, adresser, portalkonton, interna anteckningar, uppgifter |
| Juridisk/affärshistorik | `RESTRICT`; kunden arkiveras eller anonymiseras i stället | avtal, fullmakter, fakturor, Ediel-meddelanden, mätvärden, juridiska godkännanden |
| Revisionslogg | `SET NULL` och raden behålls | `audit_logs`, `*_audit_*`, `*_logs` |
| Händelse/process/cache | `CASCADE` | `*_events`, utkorgar, körningar, cacher, idempotensrader |
| Tenant-konfiguration | `CASCADE` från företag | `company_*`, `tenant_*`, medlemskap, roller |
| Testdata | `CASCADE` | `ediel_test_*`, `actor_test_*` |
| Referens/masterdata | `RESTRICT` | nätägare, elområden, regelpaket, behörigheter |

Rollerna i Excel är framtagna automatiskt utifrån tabellnamn och ska granskas
innan någon foreign key ändras.

### Atomiskt och utan dubbletter

- Varje affärsåtgärd körs i en enda databasfunktion (en transaktion). Appen gör
  inga skrivningar i flera steg som kan avbrytas halvvägs.
- Varje åtgärd som kan köras två gånger får en unik nyckel som innehåller
  `company_id`, och skrivningen använder `on conflict`. Det gäller mejl,
  webhooks, Ediel, importer och provider-callbacks.
- Testkunder och testföretag raderas av en permanent databasfunktion som går
  igenom FK-grafen. Det ersätter `gridex_delete_test_customer_v1`, som stoppar
  på historik.

### Skydd framåt (CI)

1. Ett test som misslyckas om en ny `*_id`-kolumn saknar foreign key och inte
   är markerad som polymorf eller korrelations-id.
2. Varje ny tabell måste ha en roll i `platform_table_classification`
   (utökas med fältet `delete_role`).
3. Ett test som skapar en kund med data i alla ägda tabeller, raderar den och
   kräver noll kvarvarande rader.

## Ordning

1. Catch-up för public (konsoliderad migration och test mot en Supabase-branch).
2. Granska rollerna i Excel och ändra foreign keys tabellgrupp för tabellgrupp,
   en liten PR per grupp.
3. Foreign keys för de 410 kolumnerna. Först körs en kontroll av föräldralösa
   rader (orphans), och de städas innan FK läggs till.
4. Unika index för idempotens och CI-skydden.
5. Ediel-schemana driftsätts separat, samordnat med Ediel-teamet.
