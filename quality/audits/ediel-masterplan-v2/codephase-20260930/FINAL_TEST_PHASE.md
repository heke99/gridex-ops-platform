# Separat testfas för Ediel masterplan v2

Kodklart innebär inte verifierat, godkänt eller aktiverat. Originalens acceptansstatusar ändras inte av denna plan. Ingen produktionssändning, motpartsövning, aktivering eller merge ingår i koduppdraget.

## Kandidat och bevisbindning

Före testfasen låses den integrerade kandidatens fullständiga commit-SHA och Git-tree-SHA i kandidatmanifestet. API-publicerade commits kan ha andra SHA än lokala commits; samma Git-tree måste styrkas. Varje resultat anger egen körning, kandidat-SHA/tree, kommando, miljö, verklig källa, scope, datum och logg/artifact. Resultat från en äldre checkpoint gäller inte automatiskt slutkandidaten. Ett kodpaket med källstödd implementering får fortfarande status kodklart/ej verifierat.

Varje av de 121 regelkorten och 231 acceptanskontrakten behåller sitt exakta krav och sin egen förbuds-/gränsfallsassertion i arbetsmatrisen. Ett gemensamt roundtripprov, ett annat kontrakts pass eller en specifikationsintegritetskörning ersätter inte eget beteendebevis. DDQ, DGI, egna tenants, ESCO-uppdrag och cross-tenantförbud prövas med skilda egna underlag.

## Planerade prov — ännu inte körda på slutkandidaten

| Prov | Egna kriterier som ska styrkas | Bevis och avgränsning |
| --- | --- | --- |
| Full enhetssvit | Samtliga egna positiva, negativa och gränsfallsassertioner passerar på exakt kandidat; syntax före anvisning före funktion; meddelande/objekt/IDE-scope hålls åtskilda. | Full logg, resultat och täckningsrapport. Kodfasens riktade prov räknas bara för sin egen testade tree. |
| Native PostgreSQL | Direkta RPC-/trigger-/cron-/batchvägar kan inte kringgå den gemensamma auktoriteten; aktuell verifierad aktör/tenant krävs; atomära effekter och deduplicering; samma redan slutliga ACK/SMTP/IDE-utfall återges utan nya effekter. | Verklig PostgreSQL, verkliga migrationer, egna SQL-assertioner och negativa behörighetsprov. Embedded PGlite är diagnostik, inte nativebevis. |
| Clean migrationsreplay och uppgraderingsreplay | Tom databas respektive äkta tidigare schema når kandidatens framåtriktade schema; befintliga migreringshashar och redan tillämpade filer bevaras; nya wraps/ACL/låsordningar fungerar; inga historiska mandat eller regelvittnen konstrueras. | Native replaylogg, CLI-ledger, verifierad migrationshistorik. |
| Schema-/typparitet | Genererade typer och schema motsvarar just den replayskapade kandidatdatabasen; funk­tionssignaturer, SQL-behörigheter och applicationstyper stämmer. | Rätt generator, faktisk replaydatabas och proveniens. Inga manuellt fabricerade snapshots eller genereringsintyg. |
| Säkerhet och integritet | Tenant-/ESCO-/beneficiary-gränser, RLS, accepterat medlemskap, äkta kontext, privata kvitton/mandat, stängda framtids-/undantagskapabiliteter och secrets/injektionskontroller. | Obligatoriska CI-kriterier består; egna cross-tenant- och manipulationsassertioner. |
| Browser/E2E | Verklig UI/API → intent → canonical regelbeslut → outbox/providerfence → privat persistence/ACK → readiness/läsprojektion. Separata DDQ/DGI/ESCO/tenantfall; manuella vägar; skickat-kopia och DSN får inte aktivera affär eller orsaka omsändning. | Browserlogg, requests, synliga resultat och nativejournal för exakt kandidat. Inga verkliga Edielbytes skickas inom detta uppdrag. |
| Oberoende facit | Byggare och validator avslöjar ett gemensamt fel mot en separat, autentisk och versionsriktig källa; GOV-08:s externa kvalifikation gäller bara den exakta godkända originalfilen i test. | Originalets hash/version/ägarskap och eget oracle. Syntetiska format-/säkerhetsfixtureprov bevisar bara sina explicit angivna kriterier. |
| Manuella driftprov senare | Incidentspår, rutt, certifikat, profil och tenantkontext prövas på exakt kandidat och rätt miljö; minsta avgränsade förlopp dokumenteras. | Separat senare uppdrag. Ett verkligt överenskommet motpartsprov kräver uttryckligt mandat och autentiskt underlag; det genomförs inte i kodfasen. |

## Externt underlag och spärrar

Autentiska saknade original, juridiska mandat/AI-beslut, versionerade aktörs-/nät-/BRP-register, bilateral kvalitets-/enhetsgrund, verklig reläpolicy/leveransspår samt retention/raderingshistorik ersätts inte av fixturedata eller manuella flaggor. Arbetsmatrisen anger precis vilket underlag varje spärr kräver. Stödet för en tydlig, oberoende kodkedja färdigställs ändå. Saknat historiskt originalvittne innebär spärr för nya effekter; ett eget redan fastställt immutable utfall får återges utan omval eller omsändning.

En rättelse följs av nytt eget prov på ny kandidat-SHA för varje faktiskt berörd scope. Gamla sändningar massimporteras eller reprocessas inte vid en regel-/profiländring. Incidentjournal och transportjournal bevaras; okända interna fel blir inte påhittade nationella APERAK/ERR.
