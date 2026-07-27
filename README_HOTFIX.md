# Gridex OPS SQL hotfix – 2026-07-27

## Rotorsak

`public.public_contract_offers` har inte kolumnen `commercial_snapshot`.
Migrationen `20260727040000_contract_security_energy_direction_api_completion.sql`
refererade felaktigt till kolumnen i tre runtimevägar: historisk backfill,
energy-direction-trigger och kundansökningsbackfill.

## Korrigering

`public_contract_offers.energy_direction` härleds nu canonicalt från:

1. `contract_publication_versions.energy_direction`;
2. `contract_product_versions.energy_direction`;
3. `contract_offers.energy_direction` via `source_contract_offer_id`;
4. `public_contract_offers.metadata.energy_direction`;
5. `contract_products.energy_direction`;
6. `consumption` endast som historisk fallback.

Triggern använder endast verkliga kolumner på `public_contract_offers`.
Kundansökningsbackfillen använder `pco.energy_direction`.

## Applicering

Synka hotfixen till projektroten och kör därefter hela migrationen igen.
Migrationen innehåller `BEGIN` och det tidigare misslyckade försöket ska därför
inte ha committats. Alla DDL-satser använder dessutom `IF NOT EXISTS` eller
ersätter befintliga definitioner där det är relevant.

```bash
cd /Users/hekmath/Projects/gridex-ops-platform
npm run db:migrations:check
node scripts/gridex-contract-security-energy-direction-regression.cjs
```

Kör sedan migrationen via projektets canonical Supabase-flöde eller klistra in
hela den korrigerade SQL-filen i SQL Editor.
