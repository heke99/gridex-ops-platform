# Avtal, portfölj och fakturering – konsistensgranskning

**Projekt:** Gridex OPS Platform  
**Datum:** 2026-08-03  
**Supabase-projekt:** `gridex-ops-dev` (`piidsfebjqjmnepdpnas`)  
**Avgränsning:** Avtalssidan, elområdespriser, portfölj/mix, månadspriser, tenantisolering, fakturaunderlag och berörda API-kontrakt.

## Resultat

Flödet har korrigerats så att avtalsmodellen, UI:t, databasrelationerna och faktureringsbeviset använder samma tenant, avtalsversion, portfölj, leveransmånad och elområde. Portföljadministrationen är nu begränsad till `super_admin`, både i sidomenyn, sidan, server actions och databasens interna RPC-yta.

## Verifierade brister och korrigeringar

1. **Portfölj kunde delegeras till andra roller.**  
   Delegeringsflödet togs bort från sidan och server actions. Portföljlänken visas endast för `super_admin`. Samtliga mutationer gör en separat superadmin-kontroll på serversidan.

2. **Databasrollen och kodens superadmin-roll hade olika namn.**  
   Portföljkontrollen sökte `platform_superadmin`, medan den faktiska databasen använder `super_admin`. Funktionen accepterar nu den kanoniska rollen och den äldre nyckeln för bakåtkompatibilitet.

3. **Superadmin-hjälpfunktionen var exponerad för `authenticated`.**  
   Den interna kontrollfunktionen kan nu endast köras via `service_role`. Vanliga inloggade användare kan inte anropa den som publik RPC.

4. **Elområden hanterades inte enhetligt för alla avtalstyper.**  
   Avtalseditorn har nu en gemensam SE1–SE4-väljare. Valen lagras kanoniskt i `price_areas` för samtliga avtalstyper.

5. **Fastprisrutor saknades för den fasta delen av ett mixavtal.**  
   Ett fast avtal, eller ett mixavtal med positiv fast andel, får exakt en separat prisruta per valt elområde. Om fast andel tas bort rensas de fasta områdesraderna.

6. **Portföljens månadspriser registrerades ett område åt gången.**  
   Superadmin kan nu välja tenant, portfölj, prisplansversion och månad samt ange SE1–SE4 i fyra tydliga kort. Samtliga angivna områden sparas atomiskt och idempotent i samma operation.

7. **Manuellt angivet slutpris kunde inte alltid genomgå hela godkännandeflödet.**  
   Ett positivt direkt månadspris kan nu beräknas/frysas med snapshot och SHA-256-bevis och därefter gå genom `draft → calculated → reviewed → final → locked`.

8. **Låssteget kolliderade med befintlig immutabilitetsvakt.**  
   `final → locked` ändrar nu endast tillåtna låsfält och stoppas inte felaktigt av triggern.

9. **Tenantisoleringen vilade delvis på applikationskod.**  
   Sammansatta tenantbundna främmande nycklar blockerar nu kopplingar mellan olika bolag för prisplan/version, avtalsalternativ/områdespris och portföljavräkning/version. De nya nycklarna är indexerade.

10. **Mixfakturering utelämnade fast andel och kunde acceptera mindre än 100 %.**  
    Fakturan innehåller nu `portfolio_share_percent`, `spot_share_percent` och `fixed_share_percent`. Summan måste vara exakt 100 %. Fast områdespris och fast energikostnad ingår i det låsta beräkningsbeviset.

11. **Avtalstypen portfölj/mix var semantiskt för lös.**  
    Ett rent portföljavtal måste vara exakt 100 % portfölj. Ett mixavtal måste innehålla minst två positiva delar. Samma regler finns i UI-validering, serverschema, versionsskapande och fakturering.

12. **Utställd fakturas portföljbevis var inte komplett för treandelmix.**  
    Fast andel, fast områdespris och fast energikostnad ingår nu i immutable snapshot och hash. En utställd/skickad/exporterad/betald faktura kan inte få bevisfält ändrade i efterhand.

## UI

- Gemensam elområdessektion på avtalsformuläret.
- Separat och tydlig prisruta för varje valt elområde när fast pris används.
- Portföljsidan använder responsiva grid-layouts som staplas på smala skärmar.
- Tenant väljs före portfölj och prisplansversion för att förhindra fel kontext.
- Månadspriser visas som fyra separata SE1–SE4-kort utan överlappning.
- Portfölj visas endast för superadmin i sidomenyn.

## Databasmigreringar

- `20260803144819_contract_portfolio_area_billing_consistency.sql`
- `20260803145108_portfolio_lock_transition_immutability_fix.sql`
- `20260803145427_portfolio_superadmin_role_alignment.sql`
- `20260803150723_portfolio_mix_share_billing_completion.sql`
- `20260803152200_contract_portfolio_tenant_fk_indexes.sql`
- `20260803153500_portfolio_superadmin_helper_service_role_only.sql`

Samtliga sex migrationer är applicerade i `gridex-ops-dev` och inkluderade i projektets migreringsmanifest.

## Databastester

### Portföljflöde, rollback-test

- Fyra områdespriser sparades atomiskt.
- Idempotent återkörning skapade inga dubbletter.
- SE1 gick hela vägen till `locked`.
- Pris, snapshot och SHA-256 fanns.
- Tenantkoppling mellan portfölj, prisplansversion och avräkning var konsekvent.
- Mixandel 60/40 bevarades.
- All tillfällig testdata rullades tillbaka.

### Faktureringsflöde, rollback-test

Testfall: 1 000 kWh, SE3, mix 50 % portfölj / 30 % spot / 20 % fast.

- Portföljkostnad: 250 SEK.
- Spotkostnad: 180 SEK.
- Fast kostnad: 160 SEK vid 0,80 SEK/kWh.
- Förvaltningsavgift: 10 SEK.
- Energikostnad exklusive övriga avgifter: 590 SEK.
- Andelssumma: exakt 100 %.
- Felaktig 90 %-mix blockerades av databasen.
- Faktura, kund, avtal, tenant, portfölj och avräkning pekade på samma kontext.
- All tillfällig testdata rullades tillbaka.

### Befintlig datakonsistens

Kontrollerna gav noll avvikelser för:

- avräkning kontra portföljtenant,
- avräkning kontra prisplansversiontenant,
- snapshotens portfölj-ID,
- områdespris kontra avtalsalternativ/version,
- faktura/underlag kontra avräkningtenant,
- slutliga/låsta avräkningar utan bevis.

## Kod- och regressionskontroller

Godkända kontroller inkluderar:

- migreringsintegritet: 358 filer och 262 versionsgrupper,
- kanonisk portföljregression: 168 kontroller,
- elområdesflöde: 30 kontroller,
- avtals-go-live: 216 kontroller,
- pricing-flow och billing-readiness,
- public API-kontrakt och OpenAPI-release,
- canonical external API runtime parity,
- market resolution/quote/billing,
- pricing/billing source regression,
- TypeScript-syntax för samtliga ändrade TS/TSX-filer.

## API-konsistens

De publika Customer Portal/Website API-kontrakten behöver ingen versionsändring för dessa korrigeringar. De nya operationerna är interna admin- och faktureringsfunktioner. Publika kontraktsobjekt fortsätter att använda tenant från API-nyckeln och exponerar kanoniska elområdespriser. Portföljhistorik lämnar endast slutliga/låsta utfall, medan fakturering kräver låst avräkning.

## Kvarvarande projektövergripande advisories

Supabase Security Advisor visar äldre, bredare projektfrågor utanför denna avgränsning, bland annat tabeller med RLS men utan policy, ett antal äldre `SECURITY DEFINER`-funktioner med bredare execute-rättigheter samt avstängt skydd mot läckta lösenord. De nya skrivfunktionerna i denna leverans är `service_role`-begränsade, och superadmin-hjälpen har också stängts för `authenticated`.

Performance Advisor visar fortfarande projektövergripande äldre varningar som flera permissiva policies, initplan-mönster och oanvända index. De fyra nya tenantbundna främmande nycklarna har verifierade stödindex.

## Begränsning i lokal build

En fullständig `npm ci`/Next.js-build kunde inte köras i arbetsmiljön eftersom paketregistret först saknade `zod-validation-error@4.0.2` i den interna spegeln och därefter inte kunde nå det publika registret på grund av DNS-felet `EAI_AGAIN`. Detta är inte ett verifierat kodfel. Syntax, databasmigreringar, databasflöden och samtliga relevanta repository-regressioner ovan är körda och godkända.
