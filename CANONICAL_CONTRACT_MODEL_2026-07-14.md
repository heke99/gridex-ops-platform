# Gridex OPS – kanonisk avtals-, juridik- och publiceringsmodell

Denna leverans inför den additiva målmodellen utan att bryta den befintliga webb- och kundintagskedjan.

## Infört

- Centrala avtalsprodukter och låsta avtalsversioner.
- Tenanttilldelningar och separata försäljningskanaler.
- Juridikmallar, versionsstyrning, tenantprofil, tenanttillägg och låsta juridikpaket.
- Låsta publiceringsversioner som kopplar avtalsversion, prisplan, prisversion, prisbok och juridikpaket.
- Kryptografisk `offer_reference` som även binder juridikdokumentens versions-ID:n, giltighet, kundtyp och kanal.
- Permanenta accept-, bevis- och dokumenttabeller.
- Databasregler som blockerar mutation av publicerade versioner, signerade kärnfält och bevis.
- Automatisk kompatibilitetssynk från befintliga `public_contract_offers` till den nya modellen.
- Tenant-safe läsvy `tenant_contract_catalog_v`.

## Migreringsprincip

`public_contract_offers` finns kvar som kompatibilitetsyta under övergången. Varje insert eller relevant uppdatering skapar eller återanvänder en innehållshashad avtalsversion, juridikpaketversion och publiceringsversion. Befintliga kundavtal länkas via samma tenant och det redan sparade publika erbjudandet; inga produktkod- eller "senaste version"-fallbackar används.

## Viktigt vid driftsättning

Sätt `WEBSITE_OFFER_REFERENCE_SECRET` i produktion. När denna version går live blir äldre offer references ogiltiga eftersom den nya referensen medvetet binder fler oföränderliga delar. Webbklienten ska alltid hämta ett nytt erbjudande från `GET /api/v1/website/public-contracts` precis före tecknande.
