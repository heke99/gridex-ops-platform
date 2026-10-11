# Samtliga fynd hittills – Gridex OPS

Sammanställning 2026-10-07. Endast OPS, inklusive OPS-hostade Website-API och inbyggda kundportal; inte Gridex Web. Underlaget är granskning av lokal revision 1aef94be4758260e134bdc195a69312901bf8cb2, riktade beteendeprov och läsande produktionskatalog-/marknadspriskontroller. Driftsatt apprevision skiljer sig från lokal. Inga fynd har åtgärdats eller deployats inom granskningen.

**45 numrerade fyndposter.** F1–F28 består fortsatt av27 bekräftade kod-/kontraktsfynd och policyoklarheten F10 (2P1,22P2,4P3). Tidigare separata observationer har nu egna registerposter F29–F44; F45 är en ny webhook-policyobservation. Dessa omfattar verifierade struktur-/dokumentationsavvikelser, SQL-verifierat beteende med återstående gatewayprov, advisors och effektiviseringskandidater — **45 poster betyder inte45 bekräftade buggar**. Prioritet på en kandidat anger utredningsordning, inte bevisad skada. Bekräftad betyder styrkt inom beskrivet kod-/kontrakts-/beteendeprov, inte observerad produktionsincident. F28 inkluderar tidigare U23 utan dubbelräkning.

Åtgärdsplan skapad9oktober2026: [OPS-fixar, dokumentation och bakåtkompatibilitet](../../../docs/superpowers/plans/2026-10-09-ops-api-remediation-and-compatibility.md). Planen täckerF1–F45 och det nya kravet på fortsatt stöd utan exakt dokumentationsnummermatchning; inga fixar påstås utförda.

## Register utan dubbelräkning

| ID | Prioritet/status | Fynd och praktisk effekt | Riktad åtgärd |
|---|---|---|---|
| F1 | P2, villkorat kodfynd | Borttagen operatörsägd extern Staff-registreringsmetadata kan växla läsningar till legacy och hoppa över extern bindningskontroll. Kräver fortfarande giltig assertion, API-klient och aktivt medlemskap. Inget unauthenticated/cross-tenant-intrång påvisat. | Klassificera historiskt externa identiteter beständigt och kräv aktuell bindning även när registreringsmetadata saknas. |
| F2 | P2 | Publik Staff-guide saknar krav/claims för externt bundna identiteter; integration som följer exemplet kan nekas. | Publicera separata fungerande exempel för legacy respektive externa identiteter och länka onboarding. |
| F3 | P2 | Staff-svarets request-id och loggens id kan skilja sig, vilket försvårar felsökning. | Skapa ett server-request-id vid gränsen och använd samma i svar/fel/logg. |
| F4 | P2 | Partner-webhooks autentiseras två gånger och förbrukar dubbla rate-limit-budgetar. | Behåll en auktoritativ autentisering och rate-limit-kontroll per anrop. |
| F5 | P2, återställningsrisk | Schemasnapshot/grant-konvergens kan behålla för bred authenticated-åtkomst till två äldre RPC:er. Aktuell live-databas nekar redan denna åtkomst. | Gör service-only-grants explicita i forward migration/snapshot; kvalificera clean/upgrade innan release. |
| F6 | P2 | Partner kund-/anläggningsscheman kombinerar oförenliga slutna objekt; korrekta 200-svar underkänns av schemat. | Definiera slutna responsobjekt som faktiskt rymmer DTO-fälten; validera verkliga svar. |
| F7 | P2 | Anläggningens fakturor filtreras efter kundens limit200; andra anläggningars fakturor kan tränga undan rätt resultat. Ingen continuation. | Filtrera anläggningsfakturor i databasen före limit och inför continuation. |
| F8 | P2 | Support visar äldsta500 meddelandena utan fortsättning; senare svar kan döljas. | Inför continuation för aktuell supporthistorik. |
| F9 | P2 | Bilagelistan visar äldsta100 utan fortsättning; nyare bilagor blir svåra att hitta. Känd referens kan fortfarande användas för hämtning. | Inför continuation för bilagor med bibehållen ägarskapskontroll. |
| F10 | P3, policyoklarhet | Stängt supportärende ger409 även vid replay av tidigare lyckad bilageuppladdning. Dokumentationen anger både closure409 och replay utan att bestämma företräde; inget entydigt kodkontraktsbrott fastställt. | Besluta och dokumentera closure/replay-företrädet; nuvarande åtkomst ska alltid kontrolleras. |
| F11 | P3 | Staff-användarskrivningar saknar dokumenterad valfri Idempotency-Replayed-signal. Ingen bevisad dubblettmutation. | För vidare replay-flaggan till svar eller dokumentera undantaget. |
| F12 | P3 | Staff OpenAPI saknar projektheader/precondition, svarsheader och412 storage_project_mismatch. Skyddet fungerar i tester. | Dokumentera valfri projektheader, svarsheader och412 i ny kontraktsrelease. |
| F13 | P2 | Partner-mätdata returnerar ersatta och aktuella revisioner för samma period; klient kan dubbelräkna. Ingen felaktig fakturering påvisad. | Filtrera aktuell mätrevision före pagination; separat uttrycklig historikväg. |
| F14 | P2 | Mätvärdet hämtas från quantity_kwh men kan märkas Wh/MWh; net-directions avviker också från publicerat schema. | Bind normaliserad mängd till kWh och definiera net-riktning utan att förlora semantik. |
| F15 | P2 | OPS-portalen beräknar månadssummor från250/500 rader. Prov med744 timvärden visar250/500kWh i stället för744kWh. | Summera hela månaden native med aktuell revision och separata begränsade detaljer. |
| F16 | P2, releasevillkor | Public-contracts ETag saknar representations-/schemaversion; ändrad release med samma DB-fingerprint kan ge304 för gammal payload. | Inkludera representations-/schemaversion i den billiga ETag-vägen. |
| F17 | P3 | Giltiga weak ETags och wildcard missar304 och utlöser fler laddningar. | Använd GET weak comparison, wildcard och korrekt headerparser efter auth. |
| F18 | **P1** | Lyckad affärsskrivning följd av fel vid idempotenscompletion kan radera den redan länkade fullmaktsfilen. Provad efter-commit-felhantering, ingen sådan liveincident observerad. | Skydda affärscommittade filers ägarskap; radera aldrig vid osäker efter-commit-status. |
| F19 | P2 | Förlorad DB-kvittens efter sparad completion kan skriva över completed med failed; retry nekas trots lagrat resultat. | Förhindra completed→failed-downgrade och återläs beständigt resultat vid osäker kvittens. |
| F20 | P2 | Ändring av care_of ignoreras vid samma fysiska adress, trots accepterat uppdateringssvar. | Skilj adressidentitet från care_of/informationsfält och spara dessa ändringar. |
| F21 | P2 | Samma-adress-refresh kan sänka källproveniens från nätägare till kundportal; nästa adressändring kan passera tidigare konfliktskydd. Gäller egen anläggning, inget cross-tenant-fynd. | Behåll auktoritativ proveniens vid oförändrad adress; återkontrollera konflikt native. |
| F22 | P2 | Kombinerad profiluppdatering kan spara ny e-post innan okänd anläggning ger404; klient får fel trots delvis ändrad profil. | Validera alla resursreferenser före första mutation; definiera delresultatpolicy. |
| F23 | P2 | Partner/pris väljer API-publicerat default-erbjudande men beräknar via website-publicering; API-only-erbjudande kan ge404. | För API-kanalen genom offertresolver och motsvarande publiceringsvyer. |
| F24 | P2 | /location kan presentera gammal SVK-geodata som resolved/verified trots unresolved assurance. Varning finns; prisendpointen stoppar samma underlag. | Visa assurance/färskhet; behåll äldre identifierare som preliminära. |
| F25 | P2 | Normala nullfält i lokalisering bryter OpenAPI3.1-schemat som använder nullable:true utan nulltyp. | Använd nulltypunion/anyOf och tillåt null i relevanta enums för OpenAPI3.1. |
| F26 | P2 | Fem bytes %PDF- accepteras som signerad fullmakts-PDF; filen är strukturellt oanvändbar. Ingen signaturautenticitetsprövning påstås. | Validera strukturell PDF-läsbarhet före lagring och signed-framgång. |
| F27 | P2 | Secure-link-signering kan lyckas utan köad avtalsbekräftelse vid PDF-arkiveringsfel; UI lovar ändå mejl och felvägen skapar ingen beständig leveransretry. Website-API:s separata fortsättningsflöde är inte samma väg. | Spara beständig tenantbunden leveransfortsättning vid signering och visa mejlstatus. |
| F28 | **P1**, SQL-fas verifierad | Fullmakten kan lagras som signed och få snapshot från ett annat publicerat, låst fullmaktsdokument i samma bolag än det accepterade avtalsunderlaget. Den testade infogningsfasen är identisk med live-koden; hela onboardingtransaktionen och extern sändning är inte körda. | Kräv exakt accepterat POA-dokument i Website-validering och native onboarding; behåll tenant/lås/FK-guards. |

| F29 | P2, liveavvikelse verifierad | Tre externa Staff-tabeller och två RPC:er saknas live; app-/databasrevision skiljer sig. Autentiserat onboardingfel är inte provat. | Kvalificera migrations-/releaseparitet och beroendepreflight före extern Staff-aktivering. |
| F30 | P2, SQL verifierat; gateway kvarstår | Enbart Auth-ban/softdelete lämnar egen tenant-RLS-läsning med giltigt JWT och aktiv profil/medlemskap. Ingen annan tenant synlig; full-delete och synkroniserad spärr nekar. | Harmonisera avsedd Auth/profil/medlemskapslivscykel och prova hosted gateway i disponibel miljö. |
| F31 | P3, struktur verifierad | Två identiska indexpar med16kB per index och inga pg_constraint-ägare ger dubbelt indexunderhåll; ingen stor latensvinst belagd. | Kontrollera beroenden, behåll ett canonical index per par och kvalificera unikhet/queryplaner. |
| F32 | P3, advisor/kandidat | 120 FK-indexsignaler; annan public-katalogdefinition ger91. Ingen faktisk flaskhals bevisad. | Prioritera faktisk workload och testlast, rätt kolumnordning och skrivkostnad före index. |
| F33 | P3, policystruktur verifierad | Två inbound_operation_events-policyer har auth.role direkt per rad. Observerad tabellstatistik visar0live-rader; vinst ej mätt. | Prova policyparitet och representativ EXPLAIN ANALYZE innan initplan/TO-förändring. |
| F34 | P3, advisor/kandidat | 564 index utan observerad användning; observationsfönster/ovanliga arbetslaster är okända. | Inventera roll, beroenden och statistikperiod; radera inte utifrån enbart advisor. |
| F35 | P3, kapacitetskandidat | Auth har absolut connection cap10; högre instansstorlek höjer inte automatiskt detta tak. Belastningsproblem ej påvisat. | Mät samtidighet/anslutningsväntan före poolkonfigurering. |
| F36 | P3, optimeringskandidat | Portalens fulla section-plan24 operationer jämfört med14 för kärna+invoices; auth/audit tillkommer. Upprepade retention-RPC:er kvarstår. | Använd include efter behov; utvärdera säker native bundle-read och mät bytes/p95. |
| F37 | P3, onödiga sidoeffekter verifierade | Completed fullmaktsreplay gör1 upload+1 remove innan återspelat resultat, utan ny POA-mutation. | Claim/hash före filoperationer med samma auth/ownership och F18-felsäkerhet. |
| F38 | P3, optimeringskandidat | Avgränsad fixed-only-prisresolver gör2källfrågor trots tillgängligt fixedvärde; hela offertkostnaden ej mätt. | För vidare erforderliga source types och prova fixed/mixed/portfolio/settlement innan borttagna läsningar. |
| F39 | P3, dokumentation verifierad | README/API-minne beskriver äldre ingång/version och färre kontrakt än aktuell publicering. | Peka på aktuell kontraktsinventering/manifest och bevara daterad historik. |
| F40 | P3, inkonsekvens verifierad | Users väljer sista querydubbletten, cases första, customers avvisar; numeriska format skiljer sig. Tre verkliga handlerprov PASS. | Publicera gemensam dubblett-/decimalpolicy och kvalificera kompatibilitet. |
| F41 | P3, testtäckningslucka verifierad | N+1-scannern granskar inte Staff- eller Partner-hjälparna. Identisk syntetisk select-loop missas där men upptäcks i website-roten. | Utöka relevant helper-scope och regressionstest; mät dessutom indirekta RPC-/helperanrop. |
| F42 | P2, återställningsparitet verifierad | Fullmaktsnormaliseringens livefunktion/trigger hittas inte i lokal supabase/lib/scripts-källa. Normal live-FK-väg fungerar; clean restore är inte kvalificerad. | Återskapa driftsatt säkerhetsgräns i versionsstyrd canonical schema/forward migration och clean/upgrade-test. |
| F43 | P3, advisor/kandidat | Sju grupper av flera permissiva RLS-policyer; varken läcka eller faktisk overhead fastställd. | Bedöm effektiv policykombination/grants och workload före förenkling. |
| F44 | P3, säkerhetsinventering | 103 RLS-tabeller utan policy och33 authenticated-definerfunktioner från advisor. Default deny/avsedda helpers gör detta till signaler, inte136 sårbarheter. | Granska exponering, grants och funktionskroppar efter risk; bevara service-only. |
| F45 | P3, policyobservation | Aktiv webhook kopplad till återkallad API-klient kan fortsatt köas/levereras. Subscription-/tenantspärr fungerar; inget uttryckligt krav på gemensam revokering hittat. | Besluta separat kontra gemensam livscykel. Dokumentera separata stoppsätt eller stoppa kopplade prenumerationer atomiskt om policy kräver det. |

## Fördjupad granskning av de tidigare observationerna

Kontrollerna nedan utfördes efter den första sammanställningen. Alla punkter finns i detta dokument; detaljrapporter och maskinbevis är kompletterande underlag. Endast läsande OPS-anrop och isolerade lokala SQL-fixtures användes.

### F29 — deploymentparitet: fortfarande bekräftad avvikelse

**Status:** live katalog verifierad 2026-10-07 10:56:32 UTC. Alla tre tabellerna tenant_staff_actor_anchors, tenant_staff_identity_deliveries och tenant_staff_identity_bindings samt gridex_validate_staff_identity_binding_v1(jsonb) och gridex_resolve_staff_identity_v1(jsonb) saknas fortfarande. Senaste observerade live-migration är20261005081122. Lokal källkod förutsätter dessa objekt vid externa identitetsflöden.

Publikt release-manifest hämtat11:01:57 UTC svarade200, kontraktsrelease2026-10-04.1 och build_commit c401ae989f8add2f73912746936ced6be2d02708. Det skiljer från den lokalt granskade revisionen. Det visar versions-/beroendeavvikelse; inget autentiserat produktionsonboardingförsök genomfördes och det bevisar inte att alla driftsatta Staff-anrop är trasiga.

**Åtgärd:** release-preflight som kontrollerar tabeller, exakta RPC-signaturer, grants och app-/databaskompatibilitet före aktivering. Leverera saknade objekt genom kvalificerade forward-migrationer, inte manuell ad hoc-DDL. **Godkännandekrav:** alla objekt finns med rätt ACL, extern onboarding fungerar och legacy fortsatt fungerar i disponibel end-to-end-miljö.

**Bevis:** evidence/remaining-deployment-live.json; evidence/remaining-release-manifest-live.json; identityAuthority.ts54 och migration20261005124901.

### F28 — tidigare U23: fullmaktsversionen avviker från accepterat underlag

**Status:** bekräftat kod-/evidensintegritetsfynd, P1; avgränsad PostgreSQL-infogningsfas och lästa live-anropskedjor. Sju kontroller passerade i isolerad PGlite. Korrekt dokument accepteras; ett annat giltigt, publicerat och låst fullmaktsdokument inom samma bolag accepteras också och dess andra bundle/text materialiseras som signed. Fel bolag, fel dokumenttyp, olåst, okänt dokument och saknade scopes avvisas.

Normal Website-onboarding skickar caller textVersionId oberoende av offer-dokumentet, medan acceptance_snapshot innehåller erbjudandets dokument. OpenAPI11942 kräver primary_document_id från exakt accepterat bundle. Hjälparens exakta jämförelse används av reparationsflödet men inte normal onboarding. Live core-infogningsfasen är byte-identisk med testad SQL. Alla fyra live-wrappers lästes: quote och avtal binds till samma legal bundle, men fullmaktsdokumentet jämförs inte med det. Den signerade fullmaktstexten kan därför representera annat underlag än kundens acceptans.

**Avgränsning:** detta är ett riktigt isolerat SQL-beteendeprov i PGlite, inte körning av hela onboardinggrafen i full projekt-PostgreSQL17 eller en produktionsincident. Verklig extern sändning/mail har inte utförts. PostgreSQL/psql/initdb-binärer saknades; Docker-daemon kunde inte nås inom sandboxen. Ingen delad databas återställdes.

**Åtgärd:** kontrollera exakt accepterat POA-dokument före skrivning och upprepa native mot kontraktets accepterade legal bundle/dokument. **Godkännandekrav:** full graph-test med två giltiga olika dokument inom samma tenant måste avvisa det alternativa före commit; exact-document-positive och befintliga tenant/lås/scopes-kontroller ska fortsatt passera.

**Bevis:** customerApplicationOnboarding.ts477, customerApplicationLegal.ts870; evidence/remaining-poa-native-phase.{mjs,sql,log}; evidence/remaining-poa-live-functions.json; remaining-poa-live-refutation.json; remaining-poa-root-verification.log.

**Avfärdat:** canonical-ID är inte generellt FK-fel live. Normalization-triggern flyttar kompatibilitets-ID till rätt kolumn och nekar fel tenant/typ/låsning. Triggern finns live men hittades inte i lokalt supabase-träd; även denna återställningsparitet bör kvalificeras.

### F30 — kontospärr: SQL-beteende verifierat, hosted gateway återstår

**Status:** båda versionerna av de fyra verkliga helperfunktionerna — lokala och nyligen lästa live-definitioner — kördes i isolerad PGlite med riktiga kund-SELECT-policyer, syntetiska bolag/användare och lokalt signaturverifierat fortfarande giltigt JWT. Användarens egen tenantkund är synlig vid Auth-only-ban eller softdelete om profil/medlemskap fortfarande är aktiva. Staff-helpern nekar då användaren. Annan tenant förblir osynlig.

| Tillstånd | Egen tenantkund synlig | Staff-medlemskap aktivt |
|---|---:|---:|
| Aktiv Auth/profil/medlemskap | 1 | 1 |
| Enbart Auth-ban | 1 | 0 |
| Enbart Auth-softdelete | 1 | 0 |
| Profil disabled | 0 | 0 |
| Medlemskap återkallat | 0 | 0 |
| Fullständig Auth-radering med medlemskaps/profil-CASCADE | 0 | Ej relevant |

Rotorsak: gridex_is_current_session_allowed kontrollerar profilstatus men inte auth.users banned_until/deleted_at; gridex_user_company_ids återanvänder beslutet. Live-body skiljer bara i formatering från lokal version. Kundernas authenticated-policys matchar de testade; en ytterligare livepolicy gäller service_role och ändrar inte authenticated-provet.

**Avgränsning:** ingen verklig användare bannades/raderades och ingen produktionskund lästes. DB-/rolinställning för pgrst.db_pre_request saknades vid läsning; miljökonfigurerade gatewaykontroller kan inte uteslutas. OPS-proxyn använder Auth.getUser och ingår inte i den bevisade direkt-RLS-kedjan. Officiella Supabase-dokument beskriver stateless access-JWT till expiry; strikt omedelbar revokering kräver extra kontroll. Utan fastställd produktpolicy/gatewayprov registreras detta som F30 med kvarvarande hosted-begränsning, inte som bekräftat liveintrång.

**Åtgärd:** harmonisera avsedd Auth-livscykel med profil/medlemskap i gemensam sessionshelper. Om omedelbar logout-revokering krävs, kontrollera även JWT session_id mot auth.sessions. **Godkännandekrav:** disponibelt hosted-test med gammalt JWT, Auth-only-ban/softdelete, refresh/freshlogin, profilspärr, medlemskapsrevoke, harddelete och positiv aktiv användare, både gateway och native. Ändra inte produktionsanvändare för testet.

**Bevis:** evidence/remaining-auth-native-{proof.mjs,inputs.json,results.json}; remaining-auth-live-definition.json; remaining-auth-native-live-proof.mjs; remaining-auth-live-sql-verification.log; remaining-auth-current-docs.json. [Supabase sessions](https://supabase.com/docs/guides/auth/sessions), [användarhantering](https://supabase.com/docs/guides/auth/managing-user-data).

### F31 — dubblettindex: bekräftat, liten observerad storlek

Två par är fortfarande identiska och saknar pg_constraint-ägare:

| Tabell | Indexpar | Storlek per index | Observerade idx_scan |
|---|---|---:|---:|
| customer_case_events | customer_case_events_customer_idx / idx_fk_customer_case_events_b634ce08bab5 | 16kB / 16kB | 24 /115 |
| customers | customers_company_customer_number_uk / ux_customers_company_customer_number | 16kB /16kB | 1 /2 |

Ett index per par motsvarar nu32kB indexdata; onödigt underhåll vid skrivningar kvarstår. Detta motiverar städning efter beroendekontroll, men bevisar ingen stor responstidsvinst. Statistiken har okänt observationsfönster; stats_reset var null. **Åtgärd:** dokumentera canonical index, kontrollera alla andra beroenden och avlägsna högst ett per par genom kvalificerad forward migration. **Godkännandekrav:** unikhets-/NULL-semantik oförändrad, relevanta queryplaner och insert/update fortsatt korrekta. Inga index har raderats.

Bevis: evidence/remaining-indexes-live.json; [Supabase dubblettindex](https://supabase.com/docs/guides/database/database-linter?lint=0009_duplicate_index).

### F32–F35/F43 — FK-index, RLS och kapacitet: struktursignaler, ingen belagd produktionsflaskhals

Ny performance-advisor visar fortfarande120 FK-indexsignaler,2 auth-RLS-initplan-signaler,564 unused-index-signaler,7 grupper av flera permissiva policys,2 dubblettindexpar och Auth absolut connection cap10. Av FK-signalerna gäller103 public och17 andra scheman. En separat public-katalogkontroll med giltigt icke-partiellt index och FK-kolumner i de första indexpositionerna (permutation tillåten) hittar91; detta är annan täckningsdefinition/scope, inte ett bevis att120 helt oindexerade relationer behöver nya index.

Största15 heapresultaten i det avgränsade public-urvalet var under1MB. Första kandidater för queryplanering utifrån observerad storlek/skrivaktivitet är ediel_test_runs, ediel_certificates, route_decision_logs samt website_customer_applications. Välj index efter faktiska child-joins/parent-delete/update och column order. Inga kundrader eller råa SQL-parametrar har hämtats.

inbound_operation_events har de två aktuella auth.role()-uttrycken direkt i read/write-policys. Observerad n_live_tup=0, inga insättningar enligt tillgänglig statistik. SQL-statements innehållande tabellnamnet räcker inte för att skilja DDL/underhåll/granskning från affärslast; ingen produktionslatens eller initplan-vinst påstås. Överväg SELECT-initplan eller roll-TO-lösning först efter native policyparitet och realistisk testlast; bolags-/admin-/servicevillkor måste bevaras.

**Åtgärd/godkännandekrav:** ett index/policy i taget med jämförbar EXPLAIN ANALYZE på syntetisk representativ last, buffers, latens och skrivkostnad samt RLS-negativprov. Utvärdera Auth-pool efter faktisk samtidighet. Radera inte564 index utifrån enbart unused-signal. Inga ändringar eller tunga business-querybenchmarks genomfördes live.

Bevis: evidence/remaining-performance-advisors.json; remaining-fk-coverage-live.json; remaining-table-stats-live.json; remaining-rls-policies-live.json; remaining-statement-stats-live.json. [FK-index](https://supabase.com/docs/guides/database/database-linter?lint=0001_unindexed_foreign_keys), [RLS initplan](https://supabase.com/docs/guides/database/database-linter?lint=0003_auth_rls_initplan).

### F36–F38 — effektivisering (tidigare E1–E3): kodkedjor granskade, vinster ännu inte införda

| Kandidat | Verifierat underlag | Riktad åtgärd och acceptanskriterium |
|---|---|---|
| E1 portalpaket | Full section-plan11 retention-RPC+13 reads=24; kärna+invoices7+7=14. Auth/identity/audit tillkommer. Verklig route använder gatedSection/include; default laddar alla optional-sektioner. | Använd befintlig include när skärmen behöver ett urval, lazy-load andra delar. Mät bytes/p95 för samma användaruppgift. summary=true begränsar vissa listor men tar inte bort alla sektioner. |
| E1b säker bundle-läsning | Retention-RPC upprepas trots att sektionsaudit undertrycks. De flesta sektioner kör redan parallellt. | Utvärdera tenant-/kundbunden native bundle som verkställer retention auktoritativt. Behåll revokerings/samtidighetssemantik; inget cross-request-cache av rättigheter. |
| E2 fullmaktsreplay | Verklig handler laddar upp före executeIdempotentPortalWrite; tidigare lokalt completed-replay-prov av131087byte gör1 upload+1 remove,0 ny POA-mutation. | Hash-/idempotensclaim före filsideeffekt. Mål:0upload/remove vid completed replay och samma auth/input/ownershipbeslut; felprov måste samtidigt bevara F18:s committed fil. |
| E3 fastprisresolver | Avgränsat actual fixed-only-helperprov gör2frågor: company_market_price_sources+price_plan_versions trots tillgängligt fixedvärde och tom marknadspolicy/snapshot. | För igenom nödvändiga source types/prissnapshot; läs endast behövliga källor efter kontroll av portfolio/freshness/settlement. Mät full quote, inte bara helper. |

Ingen procentuell responstidsvinst beräknas från antalet frågor; inga optimeringar infördes. Tidigare exakta beteendeprov och nya kodkedjeläsningar är underlag, inte upprepade livebelastningstester. Bevis: portal-bundle/route.ts194–208; simple.ts616–627; priceSourceResolver.ts672; evidence/further-portal-summary.probe.ts och further-metering-storage.probe.ts samt further-feed-resolver.probe.ts;29test/7filer i tidigare pass.

### F39–F41 — underhåll (tidigare M1–M3): verifierade inkonsekvenser och täckningsluckor

**M1 dokumentationsingångar:** README beskriver hotfix2026-07-22 och API-minne anger Current version2026-08-05.2 med två specs. Aktuellt publicerat manifest anger2026-10-04.1 och inkluderar Staff. Uppdatera aktuell index/versionspekare och länka separat onboarding, bevara daterad historik och frysta releasebytes. Acceptans: alla aktuella kontrakt nås från ingången och versioner stämmer med release-manifest.

**M2 queryparser:** tre nya tester kör verkliga Staff-handlers mot syntetiska affärsportar. Users väljer sista page-dubbletten och accepterar0x10 som16. Cases väljer första limit-dubbletten och accepterar1e1 som10. Customers avvisar båda typerna före affärsporten med422. Detta är en bekräftad inkonsekvens, inte dokumenterat regelbrott eller tenantbypass. Harmonisering kräver vald publicerad policy och kompatibilitetsbedömning; testet ska visa samma decimal-/dubblettregel för alla tre.

**M3 prestandagate/telemetri:** scripts/check-n-plus-one-query-budget.cjs passerar men sourceRoots är bara app/api/v1, lib/customer-portal, lib/pricing och lib/website. Handleranropens Staff-hjälpare i lib/staff-api/lib/tenant och Partner-hjälpare i lib/partner-api ligger utanför denna analys. Tre isolerade fixtures med oförändrad scanner bekräftar samma direkta awaited select-loop: Staff PASS, Partner PASS, Website FAIL. Detta är en täckningslucka, inte bevis att motsvarande loop finns i produktionskoden. Bevis: evidence/variants-performance-scope.json. Grönt resultat säger därför inget om alla Staff-loopar eller helper-RPC-vattenfall. Utöka avgränsad scanning/täckning och lägg säkra stegtimings/p95/p99 före optimering; dölj tokens/identitetsdata. Acceptans: gate upptäcker ett syntetiskt förbjudet Staff-queryloop-fall och tillåter dokumenterade bounded-loopar.

Bevis: README.md1; .agent-memory/api-contracts.md16; userHandlers.ts37; caseHandlers.ts76; customerHandlers.ts36; evidence/remaining-query-parsers.probe.ts, remaining-query-parsers-tests.log (**3/3PASS**); remaining-n-plus-one-scope.log. Produktionslatens ej mätt.

### F44 och övriga beroenden

103 RLS-tabeller utan policy och33 authenticated-definerfunktioner från tidigare security-advisor är fortsatt separata granskningssignaler; default deny och avsedda tenanthelpers ska vägas in. De räknas inte som136 sårbarheter. Tidigare node-forge high-advisory har ett dokumenterat undantag till2026-11-01; ingen påvisad exploateringsväg i det granskade flödet. Ingen ny beroendefix eller full security-scanning gjordes i detta pass.

## Liknande fel: avgränsad variantgranskning

### Juridisk dokumentbindning

**Reparationsvägen, motbevis:** actual ensureWebsitePowerOfAttorney avvisar annan offer-dokumentversion med409 före DB-porten; saknad/annan tenant-version avvisas med422 efter tenantbundna canonical/legacy-lookups. Både publik retry och admin-repair använder denna guard. Två nya tester PASS. Detta skiljer sig från F28:s normal-onboardingväg; inget nytt reparationsfel fastställt.

**Online-signering, motbevis i läst kedja:** browsern skickar token/IP/user-agent, inte valfritt legal-ID eller hash. Native signeringsfunktion hämtar dokument/version/hash från exakt kontraktsbundle efter tenant/publication/låskontroller. Ingen motsvarande dokumentöverskrivning hittades. Detta är källgranskning, inte en ny full native- eller produktionssignering.

Två saker att hålla under observation, ännu inte bekräftade fel: original signer-evidence behålls vid legitim återanvändning trots nytt signer-input; delvis befintligt acceptance-set kanske inte fylls av repair. Ingen entydigt förbjuden signer-reuse eller automatisk partiell bulk-write-kedja kunde visas, så de får inga nya bug-ID:n. Bevis: evidence/variants-legal-review.md och variants-legal-repair-guards.{probe.ts,log}.

### Revokering och utgående webhooks — F45

**Staff-livscykel, motbevis:** real context-resolver och native credential-kontroller nekar inaktiv provider, återkallad bindning, inaktivt medlemskap, borttagen aktuell behörighet, revoked_at, utgången nyckel och pausad tenant. Tillstånd läses på nytt mellan requests. Äldre F1/F30 omfattas fortfarande av sina särskilda förutsättningar; de räknas inte igen.

**Nytt verifierat webhookbeteende:** real enqueue och dispatcher mot syntetiska DB/transportportar skickar en gång via aktiv subscription med api_client_id till en återkallad klient, utan integration_api_clients-läsning. Pausad subscription ger skipped och ingen transport. Plattformens key-revoke-action uppdaterar credentialen, inte prenumerationen. Liveintegration_api_clients-triggers lästes: ingen av de fyra kropparna refererar webhook_subscriptions. Ingen av dem identifierades som en extra subscriptionspärr i den lästa kedjan; bred triggerkaskad/gatewaytest är inte körd.

Det saknas ett identifierat uttryckligt krav som kopplar inkommande nyckelrevokering till redan godkänd utgående prenumeration. Därför är F45 en **policyobservation**, inte en ny bekräftad säkerhetsbugg. Keyrotation kan behöva behålla webhooken; komprometteringsrevokering kan kräva separat kill-switch. Dokumentera skillnaden eller verkställ önskad gemensam spärr före transport. Tenant- och subscriptionspärr ska fortsatt gälla.

**Verifiering:**49tester PASS (44befintliga context-fall,2native credential-fall,3nya webhookfall). Transport mockad; inget mejl/webhook skickades och ingen kunddata lästes. Huvudagenten granskade även action/dispatcher och live-triggerkroppar. Bevis: evidence/variants-auth-webhook-proof.test.ts; variants-auth-tests.log; variants-auth-review-notes.txt; variants-credential-live-triggers.json. Källor: app/admin/platform/api-clients/actions.ts286–308; lib/integrations/webhooks.ts378,571,632.

### Prestandascannerns närliggande lucka — tillägg till F41

Det tidigare Staff-scope-fyndet gäller även Partner-scope. Samma syntetiska direkta awaited DB-select-loop missas i båda helperrötterna och fångas i inkluderad website-rot. Tre kontroller PASS i isolerad fixture; inget faktiskt N+1-missbruk påstås på dessa grunder. Lägg till regressioner både för relevant filscope och indirekta helper/RPC-waterfalls. Underlaget utvidgar F41, inte ett extra dubbelräknat F-fynd.

## Vad som redan har verifierats positivt

Läsande livekontroll:513 publika tabeller hade RLS;111 vyer security_invoker; de33 granskade authenticated-definerfunktionerna nekade anon och hade explicit search_path. Detta ersätter inte granskning av alla funktionskroppar. Utvalda13 API-tabeller saknade anon CRUD-grants.

Aktuella elprisrader från Elprisetjustnu var verified för SE1–SE4 vid2026-10-07 12:44:21 svensk tid. Riktade tester verifierar intervallgränser, Stockholm/DST, SEK/öre, negativa priser, freshnessspärr och exVAT/no-fee-flaggor. Website checkout skiljer signerat avtal från faktisk confirmation-status. Direkt providerjämförelse gav403; autentiserade liveaffärsanrop och verklig mejlleverans återstår.

## Prioritering och evidens

Rekommenderad första grupp: **F18/F28 → F19 → F27 → F26 → F13/F14/F15 → F23/F24**, därefter övriga API-/schema-/dokumentationsfel. F5 kvalificeras för native clean/upgrade; aktuell live-ACL är redan korrekt. Deploymentparitet kontrolleras före aktivering av externa Staff-flöden. F28 ska få ett helt onboardinggraph-regressionsprov i full projekt-DB vid remediation; nu finns infogningsfasbevis och deployed-source-granskning.

Alla poster F1–F45 finns ovan med status och åtgärd. F29–F44 är omklassificering/registrering av tidigare dokumenterade observationer, inte16nyupptäckta kodbuggar; F45 är ny policyobservation och Partner-scope utvidgar F41. Prioritera F29/F42 vid release/restore och F30:s disponibla gatewayprov; F31–F44:s övriga förbättringar drivs av mätning/kontraktsunderhåll. Kompletterande detaljrapporter med källrader, rotorsak, reproduktion och motprövning:

- [F1–F3 och grundinventering](REVIEW.md)
- [F4–F5 och databas/deployment](API-DATABASE.md)
- [F6–F12](ADDITIONAL-API-DOCS.md)
- [F13–F17 och effektivisering](EFFICIENCY-AND-FURTHER-FINDINGS.md)
- [F18–F22](STATE-FAILURE-FINDINGS.md)
- [F23–F27, U23 och aktuellt prisunderlag](DOMAIN-OUTPUT-FINDINGS.md)

Testresultat i separata pass:658 Staff-fall/53filer;586 vanliga API-fall/57filer; därefter20/4,29/7,8/3 och domänpass108/14+24/5. Senaste variantpass:2nya legalguardfall PASS,49Auth/webhookfall PASS och3isolerade scannertäckningskontroller PASS. Fördjupat observationspass:3nya parserfall PASS,7POA-infogningsfasfall PASS och6Auth/RLS-tillstånd verifierade med både lokala och lästa livefunktioner. Huvudagenten körde SQL-proven oberoende. Sviterna överlappar, så talen ska inte summeras till unika tester. Typecheck och flera dokumentations/migration/RBAC-gates passerade. Full app/build, fulla scanners, genuin hel PostgreSQL17 clean/upgrade, produktionslatens samt autentiserade liveaffärsflöden är inte fullständigt verifierade. Inget löfte om att inga fler fel finns.
