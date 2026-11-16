# Gridex: samlad simuleringsstatus

Detta är den gemensamma ingången för samtliga 105 scenarier, aktuella fel och kvalificerad dödkod. Kanonisk status är **38 fullständiga PASS, 1 dokumenterat gap och 66 ofullständiga**. Komponentresultat ändrar inte dessa tal automatiskt. Lokal dokumentationsleverans; ingen push eller produktadoption påstås.

- [105 scenarier och deras fullständiga ursprungliga orakel](105SCENARIOS.json): exakt bevarad per-ID-ledger, kvarvarande kriterier, nästa åtgärd och bevislänkar. Basledgerns bryttid är 15 november 2026 kl. 03:53:22 svensk tid (02:53:22 UTC). Senare resultat ligger separat som komponentöverlagring.
- [Aktiva fel, rättningar och historiska revisionsbevis](FINDINGS.json): tidsstämplad kopia av Roots enda aktiva register, med källhash och korrigerad README-proveniens för kundlistans kandidat. Registret är inte ett påstående om att samtliga historiska fel har räknats om.

## Vad som faktiskt är känt

K12 genomförde ISSUE, RECEIVE, PREPARE och ATTEST med faktiska ACK och fullständiga kontrollpunkter. Det nya avtalsdokumentet granskades före ATTEST. En normal filimport gav exakt en POST och HTTP 200 men tomt kvitto och avvisat/okänt utfall; inget nytt försök gjordes. SQL 57014 avbröt `ediel_messages` INSERT trots att frameroptimeringen faktiskt installerats och kvalificerats på den egna klonens fulla katalog med 3444 funktioner. Detta är en komponentframgång, ingen lyckad fullständig INSERT eller Main-adoption.

Oberoende före/efter-avläsning visar exakt oförändrade hela rader i 16 finansiella tabeller, 6 lineage-tabeller och 14 privata tabeller. Inga importerade mätvärden, underlag, prissättningar eller fakturor tillkom; bland de 522 fångade relationsscopen ändrades bara tre inbound-scope efter ATTEST; de 14 separat lästa privata tabellerna var oförändrade. Andra privata schemas rader omfattas inte av jämförelsen. K12 stängdes med kvalificerad API-utloggning, native Auth0 och stängd browser; slutkvitto `70a70f…` och oberoende granskning `9393fe…` länkas i registret. UI-utloggning och API-utloggning sammanblandas inte.

Den faktiska avbrottsstacken `5343fa…` är `wire_tokens_v1` rad 51 → `gridex_ack_authority.wire_v1` rad 2 → `gridex_utilts_issuer.capture_insert_v1` rad 9. Den identifierar aktiv kod vid avbrottet, inte ensam orsak eller samtliga tidigare anrop. Ett separat isolerat prov på exakt aktuell v1-kropp och samma 171462 råbyte gav 10774 token: 0,321662 sekunder SQL till materialiserad digest och 0,468412 sekunder hos anroparen (`014e80…`). Det var snabbt och reproducerade ingen fristående timeout; den kumulativa INSERT-orsaken är fortfarande olöst. Timeoutgränser höjs inte för att skapa ett godkänt resultat.

2688 är antal intervall i det deklarerade månadsunderlaget, inte en kWh-kvantitet. Faktisk CPS visar 0,95 kr/kWh, månadsavgift 40 kr och avtalsmoms 25 %, men faktisk importerad kvantitet och fakturabelopp saknas. Därför finns inget nytt penningfacit eller ekonomiskt PASS.

EVENT R, R2 och S avslutades med noll affärssteg, ingen normal UI-leverans och ingen TLS-mottagning. S passerade factory-/leasekontrollen men stoppades av HMR-konfigurationens faktiska filmetadata före privat runtime och UI. Efter stängning korrigerades mode och den avgränsade faktiska statiska filsystemkontrollen gav 148 PASS, 0 FAIL. Det är ingen faktisk affärsleverans eller replay. Därför tillkommer inget fullständigt PASS eller ny case-action-mappning för EVENT01.01 eller EVENT01.03. Ursprungligt orakel kräver verklig stödd affärshändelse genom native outbox/webhook till lokal mottagare, inklusive event-/payload-/signatur-/leveransbevis och exakt mottagencount; replay måste bevittnas separat.

33 scenarier har en etablerad nedre gräns för native-/browserförsök vid basledgerns bryttid; 23 överlappar de 38 fullständiga PASS. Talen får inte summeras. Ett exakt totalt antal försök genom hela historiken är inte fastställt. Noll etablerade fullständiga FAIL i basledgern betyder inte noll upptäckta produkt- eller harnessfel.

Det historiska underlaget med 28 meddelanden och förväntat 1809,51 kr samt officiell Nordfin-XSD saknas enligt användaren. Nya deklarerade syntetiska funktionsprov kan verifiera beteenden men ersätter inte historiska originaljämförelser. De fem QA-fallens avgränsade NOT_LOCATED är en separat klassificering.

## Dödkod och separata artefakter

Primärgranskningen omfattar 33 källidentiteter: 24 borttagna och 9 kvarhållna i den lokala huvudartefakten. Vid dess bryttid var de nio 4 levande, 4 legacy och 1 osäker. Den osäkra dashboard-writern fick senare en separat borttagningsartefakt e6b269; den har inte komponerats in i huvudartefaktens 24/9 eller verifierats som aktiv runtimeadoption. De 187 root-unreached kandidaterna är inte 187 bevisat döda funktioner.

Fyra redan granskade cleanup-operationer finns nu som lokal artefakt `7d37ea318902626b44999e0be8bcc5be62517bc0`: tre borttagna moduler och en ersättning, totalt 866 borttagna och 6 införda rader. Den femte operationen undantogs på grund av PR1051-konflikt; ingen främmande claim eller PR skrevs över. De fyra är inte aktiv runtimeadoption och räknas inte ovanpå primärartefaktens 24/9.

Kundlistans isolerade rättning har 41 godkända komponentfall och Roots slutgranskning; native-/UI-kvalificering och aktiv adoption återstår. Blandade och okända kontraktsinställningar får inte döljas som ett kundgemensamt värde. Den separata headerlängdsrättningen har granskad lokal källa och 75 definierade nativefall som **inte har körts**. Den är inte införd i K12:s framerartefakt.

## Arbetssätt och bevisens tillgänglighet

En kvalificerad producent äger backend, nativeinsamling och affärsåtgärder. Små isolerade diagnostiska prov använder egna resurser och bevarar skyddade referenser; tidsmätningar är komponentbevis. Redan kvalificerade original återanvänds med uttrycklig källtillämplighet. Den normala importen väntar själv på underlag, prissättning och utkast; inget extra worker-POST används som genväg och okända utfall återförsöks inte.

Fyndregistrets nya immutable Root-bryttid är 15 november 2026 kl. 15:31:04 svensk tid (14:31:04 UTC), antalets bryttid kl. 15:32:46 svensk tid (14:32:46 UTC). **11 aktiva registerposter är inte ett livstidsantal upptäckta fel.** Den tidigare centrala artefakten `3dcad0e4706ad23c6db9af967b79c3fa1fe033ca` och dess Root-bryttid bevaras. Denna efterföljare byggs på verifierad Main med tre avgränsade dokumentfiler; relativt föregångaren ändras bara README och FINDINGS. `105SCENARIOS.json`, dess ursprungliga ledger/orakel och 38/1/66 är byteidentiska.

JSON-filerna innehåller exakta lokala bevisadresser och immutable Git-artefakter. De historiska rapporterna är inte nödvändigtvis pushade eller införda på denna gren: läs dem med `git show <commit>:<repoPath>` enligt indexet. Stora historiska JSON-/Fc-bevis kan vara förlustfritt arkiverade med SHA-kontrollerad exklusiv återställning; ursprunglig sökväg ska återställas enligt respektive custody innan en framtida fysisk omläsning. Detta skiljer sig från saknade normativa original. Skyddade senaste backupreferenser, patchar och små bevis ska bevaras.

Denna sammanställning kör inga nya tester och påstår ingen helprojekts-QA, produktadoption eller fullständigt scenariopass utöver den bevarade kanoniska statusen.
