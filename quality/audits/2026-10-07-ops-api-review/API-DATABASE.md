# Gridex OPS – vanliga API:er och databas

Komplettering den 7 oktober 2026 till `REVIEW.md`, efter användarens utökade uppdrag. Omfattningen är OPS egna Website Integration-, Customer Portal- och Partner-API:er samt databasens schema, RLS, grants, utvalda RPC-kroppar, migrationsläge och advisors. Gridex Web ingår inte. Endast granskningsartefakter har ändrats.

## Viktigaste resultat

1. **F4, P2: Partner-webhooks autentiserar två gånger och förbrukar dubbla rate-limit-platser.** Bekräftat med verklig dispatcher/handler och syntetiska beroenden.
2. **F5, P2: schemasnapshot och grant-konvergens kan återställa för bred åtkomst till två äldre RPC:er.** Bekräftat lokalt i PostgreSQL-kompatibel PGlite. Live har rätt spärrar; inget sådant produktionsintrång har påvisats.
3. **Driftsättningsgap:** live-databasen saknar tre tabeller och två RPC:er för extern personalonboarding som finns i nuvarande kod. Det publicerade onboardingkontraktet är därför inte bevis för ett driftsatt fungerande flöde.
4. **Prestanda:** två par identiska index verifierades i katalogen. Advisors pekar också på 120 FK:er utan täckande index och två policyer med upprepad Auth-utvärdering. För dessa saknas mätdata om faktisk latenspåverkan.

## Normal API-granskning

Granskningen följde autentisering, tenant-/kundavgränsning, signerade kundassertions, scopekrav, webhookvalidering, idempotens och felprojektion. API-klientens verifierade bolag används som auktoritet; portalens kundkoppling kontrolleras separat. De granskade läsvägarna länkar inte en obekräftad portalidentitet som bieffekt. Blockerade konton och felaktiga par av kund-/bolags-id nekas av befintliga kontroller och tester.

En Website-backends signerade identitetsassertion förutsätter uttryckligen en betrodd backend. Företagsavgränsad idempotens för ansökningsflödet är dokumenterad och bedömdes inte som ett bevisat klientisoleringsfel. Tidigare misstankar om fel i cacheade quote-svar avfärdades efter kontroll av felprojektionen. Detta ger inte en generell garanti för varje intern route eller produktionsintegration.

### F4 – webhookskapande förbrukar två autentiseringsbudgetar

`app/api/partner/v1/[[...path]]/route.ts:30` gör autentisering med `partner_webhooks.manage` före HTTPS-/SSRF-valideringen. Lyckad kontroll returnerar null och dispatchern på rad 94 fortsätter till handlern. Den enklare handlern i `lib/partner-api/simple.ts:1023` autentiserar igen via rad 176; den äldre pluralvägen i `core.ts:738` har samma upplägg via rad 126.

Varje autentisering anropar RPC:n i `lib/integrations/apiAuth.ts:338`. Inget request-lokalt återbruk finns. Databasens autentisering anropar rate-limit-funktionen: `20260809191057_authenticate_integration_request_route_cost.sql:178`; själva räknarökningen finns i `20260717235500_integration_api_rate_limiter_canonical_repair.sql:105` och förs vidare i augustikonvergensen.

**Effekt:** ett giltigt POST-anrop kostar två platser. Med en plats kvar godkänns preflight, men handlern ger 429 utan att skapa webhooken. En klient med budget 1 per fönster kan därför inte lyckas på denna väg.

**Bevis:** `evidence/partner-webhook-double-auth.probe.ts` kör den riktiga dispatchern och den riktiga simple-handlern. Authbudget, transport, idempotens och DB-portar är syntetiska. Två prov: budget 2 ger 201 och två auth-anrop; budget 1 ger 429 och ingen skapande RPC. Rate-limit-effekten kopplas till den verkliga SQL-räknaren genom källgranskning, inte genom att konsumera produktionsbudget.

**Åtgärd:** validera webhookmålet inom den en gång autentiserade handlern, eller för vidare request-lokal verifierad auth med samma scopekrav. Behåll SSRF-skyddet; undvik behörighetscache mellan anrop. Verifiera även pluralvägen och replay/idempotens.

## Live-databas

Projektet är `piidsfebjqjmnepdpnas`, med det historiska projektnamnet `gridex-ops-dev`, identifierat som OPS aktiva produktionsdatabas genom projektkonfigurationen. Ingen staging-/Web-databas användes för dessa resultat. Kontrollerna läste kataloger, funktioners SQL-definitioner och advisor-resultat; inga kundrader, autentiserade produktionsoperationer eller mutationer kördes.

| Kontroll | Observerat live |
|---|---|
| PostgreSQL | 17.6 |
| Publika tabeller | 513; RLS aktiverat på samtliga |
| Publika SECURITY DEFINER-funktioner | 437 totalt; 33 körbara för authenticated |
| De 33 authenticated-funktionerna | Alla nekade anon och hade explicit search_path; detta är inte en garanti för varje funktions behörighetslogik |
| Publika vyer | Alla 111 katalogresultat hade `security_invoker=true` |
| 13 utvalda API-/idempotens-/identitetstabeller | RLS på alla; inga anon CRUD-grants i urvalet |
| Kunden och API-klientens RLS | Restriktiva lifecycle-/tenantvillkor kombineras med permissiva läspolicyer |
| Idempotens/provider/replay-tabeller i urvalet | Vanliga användarroller saknade CRUD; avsaknad av policy ger default deny |
| Äldre archive-/nummer-RPC:er | anon=false, authenticated=false, service_role=true |

Vissa permissiva läspolicyer använder `true`. De ska bedömas tillsammans med de **restriktiva** policyerna: exempelvis aktiv session och plattformsadministratör eller aktuellt bolagsmedlemskap. `USING (true)` ensamt var därmed inte ett bevis för global kundåtkomst. Service-role och funktionsägare kan kringgå RLS; deras säkerhet beror också på RPC-kroppar och applikationens tenantvillkor.

Utvalda live-kroppar kontrollerades bland annat för kundportfölj-/tenantkontext, egen kontoanonymisering och supplier-switch-skrivskydd. Anonymisering kräver egen `auth.uid()`. Switch-skrivfunktionerna börjar med `gridex_assert_switch_writer_v1(company)`, som kräver `gridex_can_write_company` för användare och uttryckligen medger service-role. Ingen körning av dessa skrivningar gjordes.

### F5 – återställningsunderlaget kan lämna äldre RPC-grants öppna

`supabase/schema.sql:62703` innehåller `gridex_db4b_archive_customer_registry_row(text,text,boolean,text)`, en SECURITY DEFINER som kan söka globalt på email/kundnummer/UUID utan ett eget caller-/bolagsvillkor. Snapshotens rad 192237 ger authenticated EXECUTE. `gridex_next_customer_number(uuid)` på rad 74088 kan ändra ett godtyckligt bolags nummersekvens; rad 193386 ger också authenticated EXECUTE.

Konvergensmigrationen `20260904120000` återkallar PUBLIC och anon vid rader 80–86, men inte ett redan explicit authenticated-grant. Ingen senare uttrycklig återkallelse hittades i migrationsfilerna. **Live nekade däremot båda rollerna för båda funktionerna.** Den bekräftade risken gäller en återställning/uppgradering som bevarar snapshotens grants, inte nuvarande live-ACL.

`evidence/database-acl.probe.mjs` laddar fyra oförändrade lokala funktionskroppar med syntetiska tabeller och roller i PGlite. Exakta konvergens-ACL:er körs efter de befintliga authenticated-grantsen. Direkt kundläsning ger 0 genom RLS; archive-dry-run hittar ändå 1 syntetisk kund och nummerfunktionen ändrar ett annat syntetiskt bolags räknare från 100002 till 100003. Destruktiv archive-apply testades inte. Provet är inte en full PostgreSQL 17 clean/upgrade replay.

**Åtgärd:** gör avsedda service-only-ACL:er explicita även för authenticated i en framåtriktad migration och synkronisera snapshoten. Behåll immutable migrationshistorik. Lägg ett genuint clean-/upgrade-prov som visar att authenticated saknar EXECUTE och att service-only-flödet fortfarande fungerar. Behörighetsändra inte live blint: där är dessa grants redan spärrade.

### Deploymentparitet för personalonboarding

Senaste live-ledgerraden i urvalet var `20261005081122`, medan repositoryts verifierade manifest omfattar 1 095 migrationsfiler fram till `20261007000503`. Ledgerdatum ensamt bevisar inte saknade funktioner; separat katalogkontroll gav dock null för samtliga:

- `public.tenant_staff_actor_anchors`
- `public.tenant_staff_identity_deliveries`
- `public.tenant_staff_identity_bindings`
- `public.gridex_validate_staff_identity_binding_v1(jsonb)`
- `public.gridex_resolve_staff_identity_v1(jsonb)`

Dessa införs av `20261005124901_tenant_staff_external_identity_bindings.sql` och används av `lib/staff-api/identityAuthority.ts:54`. Det publika onboardingdokumentet har version 2026-10-05.2. Live-applikationens manifest anger en annan källrevision än denna arbetsyta, så man kan inte anta att dagens handlers körs där. Ingen autentiserad onboarding begärdes i produktion.

**Rekommendation:** lägg en läsande deploymentkontroll för nödvändiga tabeller/RPC-signaturer, avsedda grants och kompatibel apprevision. Kräv den före aktivering/publicering av ett kontrakt som förutsätter ny databasfunktionalitet. Prova därefter hela externa identitetsflödet i verifierad disponibel miljö. Den ursprungliga F1 är fortfarande en käll-/syntetisk observation, inte ett bevis om dagens driftsatta externa identiteter.

## Advisors och prestanda

| Advisor | Antal | Bedömning |
|---|---:|---|
| RLS aktiverat utan policy | 103 | INFO. Ofta avsiktligt privata/service-only-tabeller; default deny är inte en läcka. Granska ägarskap och grants per resurs. |
| authenticated SECURITY DEFINER | 33 | WARN. Många är avsedda tenant-/behörighetshjälpare. Prioritera skrivande funktioner och bolags-/aktörsvillkor, inte generell återkallelse. |
| FK utan täckande index | 120 | INFO. Kandidater för join-/FK-prestanda; mät frekvens, planer och skrivkostnad innan indexering. |
| Auth-utvärdering per rad i RLS | 2 | WARN. `inbound_operation_events_read/write` utvärderar `auth.role()` direkt. Överväg `(select auth.role())` efter plan-/beteendeverifiering. |
| Index utan observerad användning | 564 | INFO. Statistikfönstret och sällsynta arbetslaster är okända; ingen rekommendation att radera 564 index. |
| Flera permissiva policyer | 7 | WARN. Kontrollera faktisk rollåtkomst och workload; inte automatiskt ett säkerhetsfel. |
| Dubblettindex | 2 par | WARN. Identiska katalogdefinitioner bekräftade; inga pg_constraint-ägare på dessa fyra index. Kontrollera ändå andra beroenden före ändring. |
| Auth connection cap | 1 | INFO. Absolut gräns 10; bedöm kapacitet mot verklig samtidighet före konfigurering. |

Dubbletterna är `customer_case_events_customer_idx` / `idx_fk_customer_case_events_b634ce08bab5` på `customer_case_events(customer_id)` och `customers_company_customer_number_uk` / `ux_customers_company_customer_number` som båda är unika partiella index på `(company_id, customer_number) WHERE customer_number IS NOT NULL`. Borttagning av ett index per par kan minska skriv-/lagringskostnad; den utfördes inte.

Supabase beskriver [authenticated definer-kontrollen](https://supabase.com/docs/guides/database/database-linter?lint=0029_authenticated_security_definer_function_executable), [RLS initplan](https://supabase.com/docs/guides/database/database-linter?lint=0003_auth_rls_initplan), [FK-index](https://supabase.com/docs/guides/database/database-linter?lint=0001_unindexed_foreign_keys) och [dubblettindex](https://supabase.com/docs/guides/database/database-linter?lint=0009_duplicate_index). Alla ursprungliga advisor-remediationlänkar finns i metadataevidensen.

## Kontorevokering att verifiera vidare

Live-kropparna för `gridex_is_current_session_allowed` och `gridex_user_company_ids` läser profilstatus och aktivt medlemskap men inte Auth-kontots `banned_until`/`deleted_at`. Ett redan utfärdat JWT med enbart Auth-ban och oförändrad aktiv profil/medlemskap är därför ett villkorat kontrollgap i dessa helpers. Platform-admin-helpern kontrollerar däremot Auth-livscykeln. Repositoryts full-delete-flöde tar bort medlemskap/profil före Auth-delete, vilket motverkar medlemskapsvägen.

Ingen faktisk Auth-only-ban, gatewayåtkomst med sådant JWT eller läckande produktionsläsning testades. Behandla detta som ett kompletterande revokeringsscenario att verifiera i disponibel databas, inte som ett bekräftat produktionsintrång. En gemensam kontolivscykelpolicy skulle minska skillnaderna mellan personal-RPC:er och direkt Data API.

## Verifiering och evidens

De utökade normal-API-/tenant-/idempotenssviterna passerade: **586 tester i 57 filer**, med Vitest startat genom **Node 22.23.3**, projektets stödda huvudversion. Exakta filer finns i `evidence/normal-api-tests-command.txt`, resultat i `normal-api-tests.log`. Staff-svitens 658 tester passerade också med samma Node-version. Den kombinerade körningen slutade ändå med en misslyckad extra suite eftersom granskningsagenten tog bort den temporära Partner-provfilen innan Vitest hann läsa den. Det är ett hanteringsfel i granskningen. Partner-provet kördes därför separat med bevarad fil; resultat finns i `node22-staff-and-partner-proof.log` respektive `node22-partner-proof-rerun.log`.

Live-resultat: `evidence/live-database-metadata.json`, `live-restore-helper-acl.json`, `db_table_grants.json`, `api_db_review_2.json`. Lokalt ACL-prov: `database-acl.probe.mjs`, `database-acl-inputs.json`, `database-acl-probe.log`. Metadata hämtades läsande via Supabase; kunddata hämtades inte.

Inte utfört: PostgreSQL 17 clean/upgrade replay, full appsvit/build/browser, samtliga 437 definer-kroppar, verkliga produktionsskrivningar, databasintegritetskontroll av affärsrader, last eller EXPLAIN ANALYZE. Originalrapportens begränsningar för live-kataloger/normal-API:er är uppdaterade genom detta tillägg; resterande begränsningar gäller fortsatt.

## Föreslagen arbetsordning

1. Verifiera kompatibilitet mellan app, onboardingkontrakt och live-schema före aktivering av extern personalonboarding.
2. Rätta dubbelautentiseringen för Partner-webhooks och sammanhängande request-id, med befintligt scopes-/SSRF-/idempotensskydd kvar.
3. Täpp till restore-underlagets grants och kvalificera med native clean/upgrade ACL-prov.
4. Genomför ursprungliga Staff-guide-/historiska bindningsförbättringar.
5. Optimera först de verifierade dubblettindexen; prioritera sedan FK-/RLS-planer med faktisk workload och mätdata.

Befintliga open source-skills och verktygsförslag finns i `REVIEW.md`: framför allt Supabase-skills för RLS/grants/prestanda och Trail of Bits för kontrakt/falskpositivkontroll. Inga ytterligare skills behövde installeras för denna granskning.
