# SVK-geodata och canonicalt prisområde för fakturering

**Datum:** 2026-08-04
**Publikt API-kontrakt:** `2026-08-04.2` (oförändrad responsform)
**Migrationer:**

- `20260804190000_svk_geodata_and_billing_price_area_canonicalization.sql`
- `20260804193000_contract_price_snapshot_company_guard_fix.sql`

## Korrigerad SVK-källa

Importen använder Svenska kraftnäts aktuella ArcGIS FeatureServer
`Natomraden_250526`, lager `3` (`Nätområden`). Canonicala källfält är:

- `Natomrade` → nätområdeskod;
- `Namn` → nätområdesnamn;
- `Agare` → nätägare;
- `Elomrade` → SE1–SE4.

Importen validerar fälten före staging, använder deterministisk OBJECTID-paginering
och bevarar strukturerade Postgres/Supabase-fel. En komplett version aktiveras
atomiskt först när samtliga polygoner har importerats och validerats.

## Faktureringskedja

Canonical ordning är:

`resolution_id` → `price_area_assurance` → quote → immutable
`contract_price_snapshot` → `billing_underlays.price_area` → prisberäkning → faktura.

`billing_underlays.price_area` hämtas från den låsta avtals-/quote-snapshoten.
Mätpunkt och anläggning används endast för konsistenskontroll. En motsägelse
blockeras som `price_area_snapshot_mismatch`, och databastriggern avvisar en
skrivning som försöker använda ett annat område än snapshotens SE1–SE4.

Ett äldre tenant-guard för `contract_price_snapshots` refererade felaktigt till
`NEW.customer_contract_id`, trots att tabellen använder `contract_id`. Guard-funktionen
är korrigerad så att snapshoten både kräver ett existerande kundavtal och verifierar
att avtalet och snapshoten tillhör samma tenant.

## API-paritet

Ingen extern request- eller responsform ändras. Dokumentationen för
`2026-08-04.2` är styrande: klienten använder `resolution_id`, behöver inte skicka
`price_area`, och ett klientpåstått område kan aldrig skriva över OPS-resolutionen.
