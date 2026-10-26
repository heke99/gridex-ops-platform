# Fullmakts- och mejlautomation: leveransjournal 2026-10-26

Datum avser Europe/Stockholm. Den här journalen skiljer observerad produktion, den nya kodändringen och återstående verifiering. Den kompletterar [fullmaktsrunbooken](manual-poa-mail-runbook.md) och [pollningsrunbooken](inbound-mail-polling-runbook.md). Inga lösenord, nycklar, personnummer eller mejlkroppar ingår.

## Observerat före ändringen

- GitHubs main är `4da677fcd7e7ef43c02bdb11b78460d47e766f03`. Vercels ordinarie produktionsbygge `dpl_UTK881dpA6xnjng8QXEQJbBUraWe` är READY för samma commit. Detta bevisar inte att alla affärsflöden har verifierats.
- Två produktionsmejlboxar är aktiva och verifierade, med pollningsintervall en minut och aktuella registrerade pollningstidpunkter. Dessa tidpunkter bevisar inte ensamma att ett nytt mejl faktiskt hämtats. En äldre testinkorgspost är fortfarande `unmatched`; den är inte bevis för korrekt kund-/tenanttilldelning.
- Databasens migrationsledger har `manual_mail_pending_partial_review` (`20261022230836`) och `normal_supplier_switch_atomic_enqueue` (`20261022230935`). SQL-funktionerna finns och API-typerna är genererade.
- Den installerade enqueue-funktionens kropp har SHA256 `e3f2d2775dfd229e7f46486930fac3c4901b8ea6c71a94b771fc722ddd264e4f`, identisk med källan. Funktionen har fast `pg_catalog`-sökväg; anon/authenticated saknar EXECUTE och service_role har EXECUTE. Kontrollen läste metadata och ändrade inte databasen.

## Bekräftad lucka och rättning

`renderAndQueueNormalSwitch` anropade fortfarande den äldre separata köskrivningen. En redan registrerad rad med annan status än draft returnerades dessutom utan bevis för beständig köning.

Den ändrade gatewayn:

1. Behåller validerat intent, befintliga referenser och ursprunglig native-bindning för draft.
2. Kräver sparade originalbytes, deras SHA256 och lagrad renderingstid.
3. Anropar `gridex_enqueue_normal_supplier_switch_v1` med genererade argument för rätt company, ärende, intent, original, outbound, oförändrad aktör och originalhash.
4. Låter SQL-transaktionen äga outbox, meddelandestatus, intentets köstatus och outbound-status tillsammans. Den gamla separata köskrivningen och efterföljande manuella intent-köuppdateringen används inte för denna normala väg.
5. Kontrollerar svarets original-ID, köreferens och uttryckligen falska provider-entry-/delivery-flaggor. Oklart, avvisat eller felaktigt resultat ger fel utan reservutskick.
6. Läser tillbaka samma beständiga meddelande. Ett återförsök med befintligt original renderar eller binder inte ett nytt original bara för att återställa köstatus.

Detta ändrar inte förtroendet för inkommande avsändare, fullmaktens giltighet eller marknadens godkännande. Historiska okända utskicksutfall återspelas inte; den övre dedupliceringsvägens konservativa stopp behålls.

## Verifiering och arbetsmiljö

- Testerna skrevs först: 23 fall misslyckades mot den tidigare gatewayn. Därefter passerade den nya inkopplingen. Ett senare kontraktsprov för JSON-array i status gav 1 avsiktligt fel med 27 passerande kontroller; status kräver nu uttryckligen en sträng.
- Den berörda körningen omfattar 157 tester i fyra sviter, inklusive befintlig intent-, deduplicerings- och dispatch-logik. Native-RPC och omgivande datakällor är uttryckligt avgränsade testportar; detta är inte ett nytt fysiskt marknads- eller transportprov.
- Första typkontrollen hittade både ett typfel i den nya gatewayn och äldre lokala beroenden. `EdielMessageRow` saknar de två immutable-fälten i sin applikationstyp; gatewayn använder nu de befintliga genererade databasfälten, med runtime-kontroll. Genererade schema-/typfiler ändrades inte.
- Arbetsytans installerade Zod var 3.25.76 medan den aktuella låsfilen anger 4.6.7. `npm ci --ignore-scripts --no-audit --no-fund` synkade endast arbetsytans beroenden. Paketfiler och låsfil ändrades inte. Kontroller körs med Node 22 enligt projektets versionkrav.
- Applikationens typkontroll och lint passerar efter synkningen. Den första fulla testtypkontrollen överskred Nodes standardheap; omkörningen separat med projektets 6144 MiB-gräns passerade med exit 0. Ett minnesavbrott räknas inte som godkänd typkontroll. Testtypkvittot är sparat separat från minnesavbrottet. Oberoende slutgranskningar dokumenteras innan publicering. Ett passerat komponentprov räknas inte som en slutförd produktionsleverans.

Inga externa kund-API-fält ändras; den redan installerade interna RPC:n används. Befintliga historiska OpenAPI-utgåvor skrivs inte om.

## Hela mejlflödets regler och återstående steg

Resend skickar och Strato tar emot. AI läser kandidatuppgifter och källcitat; servern avgör ärende, tenant, kund och anläggningar från betrodda bindningar. Ett utgående ärende avser en kund och kan få flera anläggningar i svaret. Saknade eller motstridiga uppgifter, okänd avsändare och otillräcklig fullmakt går till superadmins granskning.

Ett entydigt ”om 30 dagar” beräknas från kvalificerad ursprunglig mottagningsdag i Stockholm. ”Inom 30 dagar”, saknat årtal eller enbart uppsägningstid ger inte ett påhittat exakt startdatum. Fullmakt, verifieringsnummer, verkligt godkännande/IP och privat arkiv behåller sina separata kontroller.

Före slutligt klartecken återstår normal versionsleverans av denna ändring, aktuella obligatoriska kontroller, två tillämpliga slutgranskningar och readback i rätt produktionsbygge. Ett fullständigt webbläsarprov kräver verkliga testinloggningar för superadmin och isolerade tenantkonton via säker miljökonfiguration. Ett avskilt kundärende måste ha korrekt kundidentitet och verklig giltig fullmakt; ingen kundidentitet eller signering fabriceras. Ett personligt testsvar bevisar inte automatisk tillämpning från en verifierad motpart. Verklig Ediel-sändning och kvittens kräver separat överenskommen testmotpart, rutt och miljö.

Inga nya migrationskörningar, GEN-/nativeproducenter, originalåterspelningar, betalda AI-anrop eller verkliga utskick genomfördes i denna kodrättning. Äldre bevis och engångskvitton bevaras.

## Uppföljning av bred CI efter PR #916

Den breda körningen upptäckte tre fel i två äldre ändliga testfixturer: de lagrade meddelandeportarna saknade databasens automatiska immutable-fält, och det positiva SC001-provet förväntade den borttagna separata köporten. Felen reproducerades lokalt med 3 fel och 13 passerande kontroller. Fixturerna återger nu den befintliga hashförseglingen och den nya RPC-/readback-gränsen. De två avsiktliga original-bindningsstoppen, oförändrade sidoeffekter, juridisk avsändaridentitet och tenant-/kundnegativer behålls. Produktionsskydd försvagades inte. Den berörda komponentkörningen passerar nu 173 tester i sex sviter. Detta ger ingen ny native- eller registergodkännandecredit.

Två separata native-hinder kvarstår i samma CI-underlag. DB01:s begränsade current-testbackend saknar `gridex_enqueue_normal_supplier_switch_v1` i sin schema-cache, trots att funktionen finns i den verkliga installerade databasen. Originalartefakten hämtades och dess ZIP-SHA256 verifierades mot GitHubs uppladdningskvitto. Den befintliga kvalificerade DB01-producenten behöver uppdatera sitt verkliga current-käll-/API-underlag och kvalificera det; varken en låtsas-RPC i native-provet eller en produktionsfallback till separata köskrivningar är en lösning. Den frysta historiska körningen behålls separat.

Klockförkontrollens riktiga jobblogg gick senare att läsa genom den befintliga GitHub-anslutningen. Jobbet avslutas fortfarande med exit 1 utan en konkret diagnostik för orsaken; ingen maskin-/klockorsak antas utifrån detta. Inget nytt clock/native-backendprov eller blind omkörning startades lokalt. Exakta CI-huvuden, originalutfall och nästa ägaråtgärd sparas i leveranscheckpointen och överlämningen.
