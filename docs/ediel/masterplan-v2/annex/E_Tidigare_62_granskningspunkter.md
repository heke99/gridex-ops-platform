# Bilaga E — tidigare62granskningspunkter

Ärvda från granskningarna av bascommitten. Punktens evidensklass och reservationer består. Inte nya fynd eller genomförda rättelser i denna leverans.

## E001 · 26 felaktiga eller oprecisa fältkopplingar
**Evidens/prioritet:** Kodfel / P0

**Observation:** Matrisens segmentPath konsumeras av både mottagnings- och sändningsvalidering. De 26 delavvikelserna finns separat; detta är inte 26 observerade driftincidenter.

**Åtgärd:** Korrigera hela fältkatalogen med exakt segmentgrupp, kvalificerare, element och komponent. Generera projektioner från en versionsstyrd källa.

**Acceptans:** Alla 26 kopplingar verifieras mot oberoende källutdrag. Giltig Z15 med DTM+164 och RFF+Z09 ska inte underkännas som fel fält.

**Kod/källa:** lib/ediel/prodat/prodat26AFieldMatrix.ts · R1 §3 F01; P kap. 2.2, 2.6; se blad Fältmappning  
**Status:** Öppen

## E002 · Inkommande extra X/D-fält avvisas
**Evidens/prioritet:** Kodfel / P0

**Observation:** Matrisens ej-tillämpliga fält blir forbidden även vid mottagning. PRODAT:s extra information får då utlösa negativ APERAK.

**Åtgärd:** Skilj sändningskrav från mottagningskrav. Ignorera enligt anvisningen den extra informationen utan att uppdatera affärsdata från den. Behåll verklig syntaxkontroll.

**Acceptans:** Inkommande PRODAT med extra X eller D vars villkor inte gäller får ingen negativ APERAK enbart för detta; motsvarande utgående profil bygger inte dessa fält.

**Kod/källa:** lib/ediel/rulebook/fieldMatrix.ts · R1 §3 F02; P bilaga 4 s.119  
**Status:** Öppen

## E003 · APERAK-fältreferens härleds från segmenttext
**Evidens/prioritet:** Kodfel / P0

**Observation:** applicationErrorFromIssue plockar tre siffror ur fieldPath. DTM+273 blir 273 i stället för avsett fält 327; RFF+Z05 saknar träff i stället för fält 260.

**Åtgärd:** Bär explicit fältnummer från regeln till APERAK-byggaren. Separera ERC, PRODAT-fältnummer och särskild applikationsfelkod.

**Acceptans:** Fälten 260 och 327 ger rätt ERC/FTX-fältreferens. ERC 40 använder sin särskilda kodrymd, aldrig ett gissat segmentnummer.

**Kod/källa:** lib/ediel/core/runtimeDecision.ts · R1 §3 F03; P s.90–105  
**Status:** Öppen

## E004 · Felobjekt tappar objekt- och ärendereferenser
**Evidens/prioritet:** Kodfel / P0

**Observation:** Det mellanliggande felobjektet sätter referenser till null. Slutkonsekvensen för varje flerobjektsfall är ännu inte E2E-bevisad.

**Åtgärd:** Bevara huvud-, meddelande-, objekt-, register- och ärendescope i en strukturerad felmodell.

**Acceptans:** Två LIN med fel i den andra raden ger svar som refererar till rätt objekt och RFF+LI, utan att avvisa eller skriva om det första.

**Kod/källa:** lib/ediel/core/runtimeDecision.ts · R1 §3 F03; P kap.3 och bilaga 4  
**Status:** Öppen

## E005 · Z09D byggs med fel datumsegment
**Evidens/prioritet:** Kodfel / P1

**Observation:** Den gemensamma byggaren använder DTM+157 för Z09. Efterbehandling korrigerar F/G men inte D.

**Åtgärd:** Z09D använder avtalets start DTM+92 eller slut DTM+93 enligt händelsen, inte båda.

**Acceptans:** Separata start- och sluttestfall ger rätt segment. Fallet med båda datumen prövas mot den särskilda avvisningsregeln, inte en generell datumregel.

**Kod/källa:** lib/ediel/prodat/builders/profileRenderer.ts · R1 §3 F04; P s.16–23, 49–52, 112–113  
**Status:** Öppen

## E006 · Z09E tappar elanvändaruppgifter
**Evidens/prioritet:** Kodfel / P1

**Observation:** NAD+UD undertrycks för alla Z09, fast elanvändaren ska anges i Z09E.

**Åtgärd:** Använd undertypsspecifika villkor för NAD+UD; behåll att B/D/F/G inte skickar elanvändare.

**Acceptans:** Z09E innehåller föreskrivna elanvändaruppgifter. B/D/F/G följer sina andra villkor.

**Kod/källa:** lib/ediel/prodat/builders/profileRenderer.ts · R1 §3 F04; P s.22, 123  
**Status:** Öppen

## E007 · Z13 utan anläggnings-id tappar LIN
**Evidens/prioritet:** Kodfel / P1

**Observation:** Byggaren skapar LIN endast när anläggningsidentitet finns.

**Åtgärd:** Skapa föreskriven sekvensrad även när Z13-fallet saknar anläggnings-id; tillverka inte ett id.

**Acceptans:** Z13 utan objekt-id har LIN+1 och rätt övriga uppgifter; full parser–validerare–svar-kedja passerar enligt profilen.

**Kod/källa:** lib/ediel/prodat/builders/z13.ts · R1 §3 F04; P kap.2.2, LIN-beskrivning  
**Status:** Öppen

## E008 · Rapportslut byggs bara för historiskt tillstånd
**Evidens/prioritet:** Kodfel / P1

**Observation:** DTM+91 tas bara med när tillståndet klassificeras som historiskt.

**Åtgärd:** Låt fält 321 styras av faktisk tidsbegränsning och aktuell undertyp, inte bara VH-flagga.

**Acceptans:** Både ändlig ordinarie rapportering och historiska fall har rätt start/slut; obegränsad rapportering får ingen påhittad slutdag.

**Kod/källa:** lib/ediel/prodat/builders/profileRenderer.ts · R1 §3 F04; P fält321 och DTM s.49  
**Status:** Öppen

## E009 · Validatorn använder första förekomsten
**Evidens/prioritet:** Kodfel / P1

**Observation:** first/findIndex innebär att förekomstkontrollen inte i sig validerar varje LIN/register. Andra kontrollager kan finnas.

**Åtgärd:** Validera huvud, varje objekt och varje register i sin egen grupp.

**Acceptans:** Test där första gruppen är korrekt och nästa felaktig identifierar endast rätt felgrupp. Flerregisterfall följer skillnaden mellan register 1 och 2+.

**Kod/källa:** lib/ediel/rulebook/fieldMatrix.ts · R1 §3 F05; P bilaga 2  
**Status:** Öppen

## E010 · Tomma komponenter tas bort
**Evidens/prioritet:** Kodfel / P1

**Observation:** components tar bort tomma positioner så att olika CAV-komponenter kan läsas som samma uppgift.

**Åtgärd:** Använd en positionsbevarande EDIFACT-AST med korrekt hantering av UNA och frisläppningstecken.

**Acceptans:** CAV med första respektive andra 7110 skiljs åt. Tomma komponenter, kolon, plustecken och frågetecken testas utan informationsförlust.

**Kod/källa:** lib/ediel/rulebook/fieldMatrix.ts · R1 §3 F05; P segmentbeskrivningar; T kap.4, 6  
**Status:** Öppen

## E011 · UNB/0031 fylls inte i
**Evidens/prioritet:** Kodfel / P0

**Observation:** ACK_REQUEST-positionen finns men serializeUnb tilldelar aldrig värdet. Den avlästa Z01-payloaden saknar begäran om CONTRL.

**Åtgärd:** För in kvittenspolicyn i kuvertbyggaren. CONTRL självt ska utelämna begäran; BGM/AB är separat.

**Acceptans:** PRODAT och relevanta övriga profiler har 0031=1. CONTRL saknar den. Testindikatorns position påverkas inte.

**Kod/källa:** lib/ediel/core/edifactEnvelopeCodec.ts · R2 F01; R3 T-01; T s.12, 25  
**Status:** Öppen

## E012 · SE2-identitet byggs med ZZZ i stället för 260
**Evidens/prioritet:** Kodfel / P0

**Observation:** prodatCustomerNadSegment och kommentaren i funktionen använder ZZZ för det granskade kund-id-fältet. Detta syns i den avlästa Z01-payloaden.

**Åtgärd:** Rätta kvalificerare/kodlisteansvarig per specifikt fält och profil. Ingen global ersättning av ZZZ.

**Acceptans:** Det aktuella SE2-fallet renderas enligt SG17/NAD med 260 och valideras som fält227; andra legitima ZZZ-koder bevaras.

**Kod/källa:** lib/ediel/prodat/render/segments.ts · R2 F02; R3 T-02; P s.79–80, 119  
**Status:** Öppen

## E013 · AB i Z01 är inte ett förbjudet värde
**Evidens/prioritet:** Förtydligande / P1

**Observation:** Tidigare noterad skillnad mellan AB i payload och ingen positiv APERAK-förväntan får inte tolkas som att AB är olagligt.

**Åtgärd:** Dokumentera Z01:s särskilda kvittenssemantik. Låt inte positiv APERAK bli ett extra obligatoriskt steg före Z02.

**Acceptans:** Z01 med tillåten AB/NA hanteras enligt anvisningen. Z02 eller negativ APERAK driver fråga–svar; ingen ny påhittad väntespärr.

**Kod/källa:**  · R1 F04, preciserat vid sammanställning; P s.42, 86, 109  
**Status:** Klargjord

## E014 · Två separata registerparsers ger olika resultat
**Evidens/prioritet:** Kodfel / P0

**Observation:** Nätägarimporten och /admin/ediel/actors använder skilda parserimplementationer och normaliseringar.

**Åtgärd:** En gemensam importkärna med formatadaptrar och gemensam normaliserad datamodell; UI och scripts anropar samma tjänst.

**Acceptans:** Samma XML ger identiskt normaliserat resultat från samtliga stödda ingångar. Gamla alternativa parsers avvecklas eller delegerar.

**Kod/källa:** lib/actor-registry/parseActorRegistryXml.ts · R3 R-06/R-07; companies.xml  
**Status:** Öppen

## E015 · Generiska XML-parsern missar officiella nycklar och rutter
**Evidens/prioritet:** Kodfel / P0

**Observation:** Oberoende reproduktion: 697 poster men 0 ruttblock; org.nr/EIC missas i 697 poster och Ediel-id i 134. Key Type och EDIFACTDetails känns inte igen som avsett.

**Åtgärd:** Läs officiell XML-struktur med marknad, Key Type, EDIFACTDetails och respektive attribut. Använd säker XML-parser.

**Acceptans:** Oförändrad export ger 697 företagsposter, 651 EL/46 GAS och 1196 EDIFACTDetails över alla familjer. Avsaknad av rutt bedöms efter aktörens roll, inte som generellt krav för alla.

**Kod/källa:** lib/actor-registry/parseActorRegistryXml.ts · R3 R-06; registry_selector_results.json; companies.xml  
**Status:** Öppen

## E016 · Marknaden EL/GAS tappas i aktörsimporten
**Evidens/prioritet:** Kodfel / P0

**Observation:** parseCompaniesXml hittar rutterna men bevarar inte förälderns Market. Samma aktör kan ha olika adresser för EL och GAS.

**Åtgärd:** Bär marknad genom normalisering, lagring, konflikter, ruttmaterialisering och urval. Gasaudit ger inte automatiskt rätt att aktivera gasflöden.

**Acceptans:** CGI 92400:s skilda EL-/GAS-rutter förblir separata. Ett elärende kan inte välja en gasrutt.

**Kod/källa:** app/admin/ediel/actors/actions.ts · R3 R-07; companies.xml; T kap.5  
**Status:** Öppen

## E017 · Rollnamn normaliseras inkonsekvent
**Evidens/prioritet:** Kodfel / P1

**Observation:** PowerSupplier missas av generiska normaliseraren. BalanceResponsible hanteras inte som avsett i den andra.

**Åtgärd:** Ett centralt rollregister med källans råvärde och uttryckliga mappningar. Okända roller blir granskningsfall, inte tyst fel roll.

**Acceptans:** PowerSupplier, Netowner, ESCO, SystemSupplier och BalanceResponsible bevaras korrekt; test- och produktionsbehörighet följer särskild verifiering.

**Kod/källa:** lib/actor-registry/normalizeActor.ts · R3 R-06/R-07; companies.xml  
**Status:** Öppen

## E018 · companies.txt matchar inte CSV-parsern
**Evidens/prioritet:** Kodfel / P1

**Observation:** CompanyName och upprepade PRODAT/UTILTS-kolumnblock matchar inte parserns rubriker; reproduktion ger 0 namngivna poster.

**Åtgärd:** Explicit TXT-adapter till samma importmodell, eller tydligt avvisat format tills stöd finns. XML används som rikare huvudkälla.

**Acceptans:** Ingen tyst nollimport; rätt formatmeddelande eller verifierad blockparsning. Filändelsebyte får inte räknas som lösning.

**Kod/källa:** app/admin/ediel/actors/actions.ts · R3 R-08; companies.txt  
**Status:** Öppen

## E019 · Importstatus bevisar inte komplett eller aktiv import
**Evidens/prioritet:** Konfigurationsavvikelse / P1

**Observation:** Äldre körningar ligger kvar som running. En annan completed-körning bevisar inte korrekt import av dagens rutter. Tom ruttlista kan passera parser/import.

**Åtgärd:** Stegen uppladdad, parsad, förhandsgranskad, applicerad och ruttverifierad får separata bevis. Lägg till heartbeat, timeout och fullständighetskontroll.

**Acceptans:** Avbruten körning flaggas. Ingen aktör/rutt blir sändningsklar endast genom completed. Antal, hash och konflikter går att följa.

**Kod/källa:** lib/actor-registry/importActorRegistry.ts · R3 §5 importhistorik; R1/R2/R3 skrivskyddade avläsningar  
**Status:** Öppen

## E020 · Teknisk och juridisk partsidentitet sammanblandas
**Evidens/prioritet:** Kodfel / P0

**Observation:** Generiska parsern sätter interchangePartyId till partyId. Officiell export innehåller ombud där identiteterna skiljer sig.

**Åtgärd:** Separera UNB:s tekniska adress från NAD:s juridiska part, med båda kvalificerarna. Matcha inte bort separata Ediel-identiteter enbart på org.nr.

**Acceptans:** Ombudsfallet 62110/82150 bevaras. Gridex 21660 och systemleverantör 92825 får inte sammanblandas. Bilateral behörighet kontrolleras separat.

**Kod/källa:** lib/actor-registry/parseActorRegistryXml.ts · R3 §3, R-06; companies.xml; T kap.5  
**Status:** Öppen

## E021 · Gridex avsändarsubadress avviker från exporten
**Evidens/prioritet:** Konfigurationsavvikelse / P0

**Observation:** Sparad Z01 använder 21660:ZZ:GRIDEX; exporten 10 september anger ingen subadress. Senare export bevisar inte läget 3 september.

**Åtgärd:** Avstäm registrerade giltiga avsändaruppgifter och returmatchning tillsammans; skilj känt tom subadress från okänd.

**Acceptans:** Sändning och retur till 21660 matchar rätt tenant med verifierade registeruppgifter. Ingen historisk payload skrivs över.

**Kod/källa:**  · R3 §3; companies.xml; transport_observations_current.json  
**Status:** Öppen

## E022 · Supplier-inställning har DGI som generell standard
**Evidens/prioritet:** Konfigurationsavvikelse / P1

**Observation:** Inställningen säger supplier men default DGI-PRODAT. Den faktiskt avlästa Z01:an använde DDQ, alltså inte bevisat fel i det skickade fältet.

**Åtgärd:** Beräkna Application Reference från process, marknad och underordnad roll; gör inte DGI/DDQ till en enda aktörsstandard.

**Acceptans:** Leverantörsbyte och tillståndshantering väljer sina olika profiler även när samma aktör har PowerSupplier och ESCO.

**Kod/källa:** lib/ediel/rulebook/canonicalEdielPolicy.ts · R1 §6; R3 §3; T kap.5.2.3–5.2.4  
**Status:** Öppen

## E023 · Register–rutt–certifikat–tenant-kedjan saknar fullständigt bevis
**Evidens/prioritet:** Verifieringslucka / P0

**Observation:** 27700:s SMTP-adress/PRODAT-subadress stämmer i senare export. party_address_id-länk saknas i avläsningen; full historisk ruttbindning är inte bevisad.

**Åtgärd:** Lagra versionslåst ruttbeslut med registerkälla och giltighet, teknisk/juridisk adress, certifikatunderlag och tenantidentitet.

**Acceptans:** Varje valt ruttvärde kan härledas till en giltig källa. Ingen första-träff-fallback vid tvetydighet. Ändrad rutt kräver nytt beredskapsbevis.

**Kod/källa:** lib/ediel/routeMaterializer.ts · R2 §2; R3 §3; T kap.5  
**Status:** Öppen

## E024 · Transportincidenten är inte slutligt lokaliserad
**Evidens/prioritet:** Verifieringslucka / P0

**Observation:** Applikationslogg visar Z01 kölagd via SMTP med y15c68283K1OFMF, inte mottagen Z03. Nätägaren uppger utebliven mottagning. CONTRL/affärssvar saknas i avläsningen.

**Åtgärd:** Förena runtime-konfiguration, databas, Stratos köspår och mottagarens SMTP/S/MIME/Edielspår. Ingen blind omsändning.

**Acceptans:** Incident har styrkt slutligt utfall eller uttryckligt okänt leveransläge med ansvarig. Återförsök/rättelse beslutas utifrån källregler och motpartsspår.

**Kod/källa:**  · R2 §2; R3 §2; transport_observations_current.json; H kap.10  
**Status:** Öppen

## E025 · Två olika Message-ID i samma sändningsspår
**Evidens/prioritet:** Konfigurationsavvikelse / P0

**Observation:** Rå-MIME-förhandsloggen och Nodemailer-resultatet använder olika Message-ID.

**Åtgärd:** Ett stabilt RFC Message-ID binds till exakt sänd EML. Leverantörens kö-/försöks-id lagras i egna fält.

**Acceptans:** Råmejl, SMTP-logg, outbox och leveransfel kan korreleras utan id-gissning. Båda historiska id:n bevaras.

**Kod/källa:** lib/email/sendEdielEmail.ts · R2 §2; R3 §2  
**Status:** Öppen

## E026 · Exakt skickat råmejl går inte att återställa från kontrollerat spår
**Evidens/prioritet:** Verifieringslucka / P0

**Observation:** Granskad S/MIME-post har hash och smtp-smime://-referens, men inte själva krypterade bytes eller full EML. Annat arkiv är inte verifierat.

**Åtgärd:** Arkivera exakt färdig EML och EDIFACT-bytes åtkomstskyddat med hash före sändning. Följ retention utan generella payloadutskrifter.

**Acceptans:** Det faktiska sändningsunderlaget kan verifieras byte för byte. Arkivfel efter SMTP250 får inte initiera en ny affärssändning.

**Kod/källa:** lib/ediel/transport/index.part-2.ts · R2 §2; R3 §6; T kap.7.7  
**Status:** Öppen

## E027 · Leveransfel saknar dedikerad DSN-korrelation
**Evidens/prioritet:** Kodfel / P0

**Observation:** Granskad processor behandlar mejl utan EDIFACT som generell manuell granskning. Ingen särskild delivery-status-gren hittades där.

**Åtgärd:** Identifiera DSN före affärspayload, koppla transportfel till rätt försök och skapa incident. Originalbilaga i returbrev får inte behandlas som nytt affärsmeddelande.

**Acceptans:** Bounced/delayed rapporter uppdaterar transportläget, inte kundens leveransstatus. Dubblett-DSN skapar inte dubbla incidenter.

**Kod/källa:** lib/inbound-mail/edielInboundProcessor.ts · R2 F05; T bilaga A s.55–56  
**Status:** Öppen

## E028 · Tom Skickat-mapp bevisar inte att inget skickats
**Evidens/prioritet:** Förtydligande / P2

**Observation:** Granskad SMTP-funktion gör ingen separat IMAP APPEND. Denna arkivfunktion är inte ett Edielkvittenskrav.

**Åtgärd:** Använd utväxlingslogg och serverbevis som auktoritet. En IMAP-kopia kan läggas till som separat, icke-affärsdrivande funktion.

**Acceptans:** Skickat-kopia eller dess fel påverkar inte sändningsbeslut. UI förklarar SMTP accepterat respektive mottaget/kvittenserat.

**Kod/källa:** lib/email/sendEdielEmail.ts · R3 §2; RFC9051 APPEND; T kap.7.7  
**Status:** Klargjord

## E029 · Certifikatens tidsgränser kontrolleras fel
**Evidens/prioritet:** Kodfel / P0

**Observation:** valid_from stoppar inte för tidig användning. Math.ceil över hela dagar kan godkänna certifikat efter faktisk utgång.

**Åtgärd:** Jämför exakta tidpunkter mot verifierade certifikatdata. Håll varningsfönster skilt från giltighetsbeslut.

**Acceptans:** Inte-giltigt-än, gränstid och utgånget-certifikatfall får korrekt resultat utan dygnsavrundning i säkerhetsbeslutet.

**Kod/källa:** lib/ediel/security/certificateStatus.ts · R2 F03; T bilaga A.3.2.1  
**Status:** Öppen

## E030 · Revoked stoppar inte certifikathjälpfunktionen
**Evidens/prioritet:** Kodfel / P0

**Observation:** Den lästa hjälpfunktionen stoppar inte explicit revoked; vald-id-vägen har inte samma kandidatfilter. Övriga skydd kan finnas.

**Åtgärd:** Ha en gemensam validerare för uttryckligt id och sökning: status, betrodd CA, tidsgräns, spärrkontroll och adress.

**Acceptans:** Ett spärrat certifikat används aldrig för kryptering, oavsett hur det valdes. Alla anropsvägar använder samma beslut.

**Kod/källa:** lib/ediel/security/outboundRecipientCertificate.ts · R2 F03; T bilaga A.3  
**Status:** Öppen

## E031 · TLS, SPF och certifikatkedja inte bevisade hela vägen
**Evidens/prioritet:** Verifieringslucka / P0

**Observation:** Klient-TLS/konfigurationsrader bevisar inte TLS mellan reläerna, aktuell SPF, CA/CRL eller nätägarens avkryptering.

**Åtgärd:** Verifiera faktiska transportegenskaper och certifikatkontroll med loggar utan att exponera hemligheter.

**Acceptans:** Relä-TLS, avsändardomän och certifikatbevis finns för produktionsvägen. Ett SMTP TCP-test får inte ensamt ge grönt.

**Kod/källa:** lib/ediel/mailReadiness.ts · R2/R3 transportluckor; T kap.3.1 och bilaga A  
**Status:** Öppen

## E032 · Krypteringsvägen väljer endast ett mottagarcertifikat
**Evidens/prioritet:** Kodfel / P1

**Observation:** Den lästa vägen skickar ett mottagar-PEM till krypteringen. Faktiskt certifikatöverlapp i incidenten är inte belagt.

**Åtgärd:** Bygg CMS för samtliga tillgängliga giltiga mottagarcertifikat enligt anvisningens överlappningsregler.

**Acceptans:** Två samtidigt giltiga certifikat ger rätt RecipientInfos och meddelandet kan dekrypteras med respektive nyckel i isolerat prov.

**Kod/källa:** lib/ediel/transport/index.part-2.ts · R2 F04; T s.44  
**Status:** Öppen

## E033 · Säkerhetsreglernas uttryckliga undantag måste ingå
**Evidens/prioritet:** Förtydligande / P0

**Observation:** Tidigare huvudregel om PRODAT-kryptering får inte omformuleras till att anvisningen saknar reservförfarande. T s.20,44 beskriver tillfälligt fel/inget certifikat och tidigare CRL.

**Åtgärd:** Implementera uttryckligt versionsstyrt reservförfarande med larm, dokumenterade villkor och fortsatt relä-TLS. Ingen tyst generell nedgradering.

**Acceptans:** CRL-hämtningsfel använder föreskrivet tidigare CRL-underlag med larm. Undantagsfall för meddelandekryptering särskiljs från normalläge och från krav på TLS.

**Kod/källa:**  · Precisering i denna sammanställning; T s.20,44  
**Status:** Klargjord

## E034 · Olika regelrevision kan väljas i olika lager
**Evidens/prioritet:** Kodfel / P0

**Observation:** runtimeDecision använder först DTM+137; utiltsEngine använder mottagningstid när inget explicit datum ges. Samma upplösta beslut skickas inte vidare.

**Åtgärd:** Ett gemensamt versionsbeslut för transport, guide, affärsregler och fältaktivering. Skilj ny sändning, svar, mottagningsövergång och historisk återspelning.

**Acceptans:** Fall 30 september/1 oktober och efter tvåveckorsfönstret använder konsekvent dokumenterat beslut i alla lager. Historiskt test aktiverar inte gamla regler i ny produktion.

**Kod/källa:** lib/ediel/utiltsEngine.ts · R2 F07; T kap.1.4; U giltighet och ändringslogg  
**Status:** Öppen

## E035 · Strukturkontrollflagga bevisar inte E61/E62-beteende
**Evidens/prioritet:** Verifieringslucka / P0

**Observation:** validateMeterAndRegisterAgainstStructuralInformation hittades i definition/tester, utan verifierad operativ konsument i granskningen. Det bevisar inte att alla motsvarande kontroller saknas.

**Åtgärd:** Spårbar kontroll av mätare/register mot daterad strukturinformation; ta bort frikopplade flaggor eller anslut dem.

**Acceptans:** Rätt/fel mätarnummer, saknat/extra register och strukturbyte ger korrekt transaktionsutfall enligt vald guide.

**Kod/källa:** lib/ediel/rulebook/utilts25A4.ts · R2 F08; U bilaga 2  
**Status:** Öppen

## E036 · Global felprioritet kan dölja anvisningsfel
**Evidens/prioritet:** Verifieringslucka / P0

**Observation:** Återläst utiltsEngine sammanfattar functional före application. Slutliga transaktionssvar och headerfelspärr är inte verifierade av detta ensamt.

**Åtgärd:** Låt anvisningens kontrollordning styra per huvud och transaktion. Sammanfattningsstatus får aldrig ersätta detaljerade utfall.

**Acceptans:** Headerfel ger negativ APERAK för hela meddelandet och ingen fortsatt funktionskontroll. En guidefelaktig transaktion ger inte ERR för ett senare funktionsfel. Friska syskon hanteras separat.

**Kod/källa:** lib/ediel/utiltsEngine.ts · Kod återläst i denna sammanställning, rader80–126; U s.101–107  
**Status:** Öppen

## E037 · Full transaktions-, lagrings- och rättelsekedja inte godkänd
**Evidens/prioritet:** Verifieringslucka / P0

**Observation:** Ingen full E2E med blandade korrekta/felaktiga transaktioner, kvittens efter lagring och nyare/äldre värden har bevisats.

**Åtgärd:** Transaktionsvisa slutbeslut, atomär lagring och kvittensavsikt. Särskilj godkänt men äldre värde från overwrite och från internt databashaveri.

**Acceptans:** Positivt svar bygger på föreskriven behandling; gamla korrekta värden avvisas inte enbart för sen ankomst och skriver inte över nyare. Interna fel genererar inte påhittat motpartsfel.

**Kod/källa:** lib/ediel/utiltsEngine.ts · R1 §7–9; R2 §4; U s.107  
**Status:** Öppen

## E038 · Kodkatalogerna är inte utbytbara eller komplett oktoberbevis
**Evidens/prioritet:** Verifieringslucka / P0

**Observation:** Numerisk produktkodlista, L-tidsserieprodukt, energiprodukt-id och räkneverkskod är olika. 20250528-listan har inte L654Q som PRODAT anger från oktober.

**Åtgärd:** Separata typade kodrymder med källa, giltighet och kombinationer; tillägg genom källbelagt revisionsbeslut.

**Acceptans:** L639Q/E31, L917:s ValueNo och registerkoder används i rätt sammanhang. L654Q tidsstyrs, inte aktiveras genom filnamn eller gissning.

**Kod/källa:**  · R1 §5; R3 §8; P 26.A.2; TSP20250528; RK1.7; PK4.12  
**Status:** Öppen

## E039 · Pensionerade och bilaterala flöden kräver uttrycklig behörighet
**Evidens/prioritet:** Verifieringslucka / P1

**Observation:** Katalogdefinitioner är inte fulla exekveringsbevis. S06 är inte taget i bruk; S08 är historiskt efter 14 april 2026. E73 kräver rätt efterfrågat meddelande och avtalat stöd.

**Åtgärd:** Kapabilitetsmatris per marknad, roll, riktning och datum. Ingen automatisk aktivering av allt som en parser känner igen.

**Acceptans:** S06 skapas inte som normalt svenskt produktionsflöde. S08 återspelas endast isolerat. E73 använder begärd S02/E66 och dess Application Reference enligt tillämplig regel.

**Kod/källa:** lib/ediel/rulebook/utiltsMarketSemantics.ts · R2 §4; U kap.3.3 och ändringslogg; T 5.2.4  
**Status:** Öppen

## E040 · AI-huvudet följer avsändare i stället för fasta roller
**Evidens/prioritet:** Kodfel / P1

**Observation:** Byggaren sätter avsändare först, men huvudet ska ha elnätsföretaget först och elhandelsföretaget sedan oavsett sändningsriktning.

**Åtgärd:** Rollstyrt huvud, separat från filnamnets avsändare/mottagare.

**Acceptans:** AI i båda riktningarna har samma rollordning i huvudet; filnamnet följer sina egna regler.

**Kod/källa:** lib/ediel/aiList.ts · R2 F06; AI s.7–9  
**Status:** Öppen

## E041 · AI bygger marknadsidentiteter från interna UUID/namn
**Evidens/prioritet:** Kodfel / P1

**Observation:** site.customer_id används för elanvändar-id, site.site_name för kundnamn och site.id kan bli GS1-märkt anläggnings-id.

**Åtgärd:** Hämta verifierad juridisk kundidentitet och faktisk anläggningsidentitet; inga platshållare som ser godkända ut.

**Acceptans:** Saknade identiteter blockerar export tydligt. Internt UUID hamnar aldrig som personnummer eller GS1-id. Skyddad identitet följer särskilda regler.

**Kod/källa:** lib/ediel/aiList.ts · R2 F06; AI s.8–9; P bilaga 3  
**Status:** Öppen

## E042 · Sex AI-fält fylls trots att leverantören ska lämna dem tomma
**Evidens/prioritet:** Kodfel / P1

**Observation:** Mätarnummer, avräkningsmetod, årsenergi, rapporteringsfrekvens, mätmetod och produktkod är inte korrekt avsändarrollstyrda.

**Åtgärd:** Separat fältprofil för elhandelsföretag och elnätsföretag.

**Acceptans:** Leverantörens sex fält är tomma men alla separatorer finns kvar. Nätägarprofilen kräver eller tillåter sina värden enligt anvisningen.

**Kod/källa:** lib/ediel/aiList.ts · R2 F06; AI s.8–9  
**Status:** Öppen

## E043 · AI-produkt och mätmetod härleds från fel domän
**Evidens/prioritet:** Kodfel / P1

**Observation:** Energiprodukt-id används som tidsserieprodukt. Byggaren kopplar reading_frequency daily till Z04, vilket inte bevisar kvartsmätning.

**Åtgärd:** Bär separat mätmetod, upplösning, avräkningsmetod och rapporteringsfrekvens. Använd rätt kodkälla när rollen ska fylla fältet.

**Acceptans:** Dygnsrapportering förväxlas inte med mätmetod. Ingen 8716867000030/31 sätts i AI:s tidsserieproduktfält. Leverantörsfältet lämnas tomt.

**Kod/källa:** lib/ediel/aiList.ts · R2 F06; läst byggarkod; AI s.9; TSP20250528  
**Status:** Öppen

## E044 · AI-perioder och flera historiska rader inte beteendeverifierade
**Evidens/prioritet:** Verifieringslucka / P1

**Observation:** Den granskade exportvägen bygger från en site; komplett periodurval och strukturhistorik har inte E2E-verifierats.

**Åtgärd:** Urval över leverans- och strukturperioder, halvöppna intervall och rätt blankdatum på detaljnivå.

**Acceptans:** Ändring mitt i månaden ger rätt följdrader och sortering; alla relevanta anläggningar ingår och inga giltighetsintervall tappas vid deduplicering.

**Kod/källa:** lib/ediel/flows/aiListFlow.ts · R2/R3; AI kap.2.1  
**Status:** Öppen

## E045 · AI-mottagning når inte verifierad avstämningsväg
**Evidens/prioritet:** Kodfel / P1

**Observation:** Granskad gemensam mejlprocessor kräver EDIFACT och sätter annars generisk manual_review. En korrekt kopplad AI-avstämning har inte visats där.

**Åtgärd:** Klassificera AI/BI före EDIFACT-grenen och skapa avvikelser mot daterad struktur; ingen automatisk masterdataöverskrivning från AI.

**Acceptans:** Giltig AI-fil ger begriplig avstämning, inte Mail saknar EDIFACT. Skillnader skapar utredning utan ändrad grunddata.

**Kod/källa:** lib/inbound-mail/edielInboundProcessor.ts · R2 F05/F06; AI s.3  
**Status:** Öppen

## E046 · BI-export måste begränsas till nätföretagsrollen
**Evidens/prioritet:** Verifieringslucka / P1

**Observation:** BI är exponerad i generell exportmodell; end-to-end-rollspärr för leverantör har inte visats.

**Åtgärd:** Behörighets- och processmatris blockerar BI-sändning som elhandelsföretag. Mottagning behandlas enligt användningsfallet.

**Acceptans:** Supplier kan inte skapa eller skicka BI genom UI, API, jobb eller direkt byggarväg.

**Kod/källa:** lib/ediel/flows/aiListFlow.ts · R2 F06; AI s.3  
**Status:** Öppen

## E047 · Legacy-regler är aktiva trots dokumenterad avveckling
**Evidens/prioritet:** Konfigurationsavvikelse / P1

**Observation:** Fyra deadline-rader och en supplier_switch-policy var aktiva, fast dokumentationen beskriver dem som inaktiva historiska projektioner.

**Åtgärd:** Kartlägg konsumenter, migrera till auktoritativ källa och gör gamla projektioner icke-normerande. Bevara historik.

**Acceptans:** Runtime och databasprojektion stämmer vid hashjämförelse; ingen alternativ tabell kan överstyra det beslutade regelpaketet.

**Kod/källa:** docs/ediel/CANONICAL_SOURCE_INVENTORY.md · R1 §6; avlasta_systemfakta.json  
**Status:** Öppen

## E048 · Revisionsetiketter är inkonsekventa
**Evidens/prioritet:** Konfigurationsavvikelse / P1

**Observation:** Z01 snapshot/etikett 26-A:r26-A motsäger länkad PRODAT:Z01:L:26.A:r3. Paket-id/hash pekar enligt avläsningen på rätt paket.

**Åtgärd:** Typa guideversion, revision, wireversion och profilversion separat. Korrigera visning med spårbar komplettering, inte historikomskrivning.

**Acceptans:** UI och logg visar entydigt paket och revision; historiska råvärden kan fortfarande granskas.

**Kod/källa:** lib/ediel/rulebook/guideRegistry.ts · R1 §6  
**Status:** Öppen

## E049 · Readiness-beviset är gammalt för aktuell release
**Evidens/prioritet:** Konfigurationsavvikelse / P0

**Observation:** Avläst is_ready=true avser 14 augusti och annan deployment. Det bevisar inte den granskade releasen.

**Åtgärd:** Beredskap binds till deployment, schema/migrationer, regelpaket, tenantidentitet, rutt och säkerhetspolicy.

**Acceptans:** Ändrad beroendeversion gör tidigare bevis otillräckligt. Nya berörda tenantbevis skapas innan sändningsvägen öppnas.

**Kod/källa:**  · R1 §6; R3 föreslagen åtgärdsordning  
**Status:** Öppen

## E050 · CI och ren migrationsreplay var inte helt gröna
**Evidens/prioritet:** Verifieringslucka / P0

**Observation:** Tidigare kontrollerad PR310-körning34373283798 hade failure i verify och clean-migration-replay. Ingen ny helkörning genomfördes.

**Åtgärd:** Samma låsta commit ska klara relevanta CI-/migrations-/integrationsgater. Bevis knyts till exakt SHA; inga överhoppade krav markeras klara.

**Acceptans:** Ren databas kan byggas, migreras och testas; autentiserad RLS/E2E och relevanta CI-jobb gröna på releasens SHA.

**Kod/källa:**  · R1 §7; GitHub Actions run34373283798, historisk observation  
**Status:** Öppen

## E051 · Publicerad runtime–databasbindning saknar oberoende bevis
**Evidens/prioritet:** Verifieringslucka / P0

**Observation:** Projekt gridex-ops-dev har produktionsmärkta data. Det är inte ett säkert bevis för varje publicerad funktions anslutning.

**Åtgärd:** Icke-hemlig runtime-attestering av projektref, deployment, miljö, schemafingerprint och version; inga hemligheter i logg.

**Acceptans:** Webb, workers och API kan kopplas till rätt produktionsdatabas och SMTP-profil på samma release.

**Kod/källa:**  · R1/R2/R3 avgränsning  
**Status:** Öppen

## E052 · Hela affärskedjans nästa steg är inte E2E-godkänt
**Evidens/prioritet:** Verifieringslucka / P0

**Observation:** Z04-/datumguard finns och avläst Z01 har next_action, men hela kedjan per undertyp, kancellering och sena svar är inte bevisad.

**Åtgärd:** Deterministiska tillståndsmaskiner och en nästa-åtgärdsplanerare. Separera transport, syntaxkvittens, applikationskvittens och affärstillstånd.

**Acceptans:** Z02/SMTP250 aktiverar inte leverans. Korrelerad rätt Z04 och bekräftat datum styr byte; Z04 före APERAK fungerar. Behöriga undantagsflöden är separata.

**Kod/källa:** lib/ediel/flows/inboundBusinessStateMachine.ts · R1 §6–9; R3 §7; H kap.4; P kap.3 och bilaga1  
**Status:** Öppen

## E053 · Z15-referensens negativa APERAK är inte ett korrekt facit
**Evidens/prioritet:** Referensavvikelse / P1

**Observation:** 49285495 har tio ERC/FTX-grupper; åtta utan fältreferens och två med fel nummer, referenser bara i sista gruppen, samt UTF-8-tecken trots UNOC:3.

**Åtgärd:** Bevara oförändrad som adversariellt/negativt fall. Definiera korrekt svar oberoende mot källan och bevara bytekodningstest.

**Acceptans:** Testmanifest anger ursprung, syfte, förväntat fel och scope. Felaktig referens används inte för att göra validatorn godtyckligt grön.

**Kod/källa:**  · R1 §4; 49285469/49285495; P s.108 och kap.3  
**Status:** Öppen

## E054 · Z13 har positiv kvittens men avviker från specifikationen
**Evidens/prioritet:** Referensavvikelse / P1

**Observation:** 49267129 saknar DTM+90, använder DTM+92 och lägger energiprodukten i första i stället för andra 7110. Bifogade kvittenser är positiva.

**Åtgärd:** Registrera konflikt och koppla originalhash till testfall/protokoll. Inte antagande om att Gridex producerat filen.

**Acceptans:** Korrekt förväntat resultat kommer från godkänd källtolkning/testdefinition, inte enbart befintlig positiv kvittens.

**Kod/källa:**  · R1 §4; 49267129/49267130/49267131; P kap.2.6  
**Status:** Öppen

## E055 · UTILTS-referenser prövar skilda fel och dubbletter
**Evidens/prioritet:** Referensavvikelse / P1

**Observation:** 49229312 saknar DTM+597 på serienivå och har två negativa APERAK41/512. 49230015 har 88 av 96 förväntade kvartsvärden trots korrekt energisumma.

**Åtgärd:** Märk negativa/dubblettfall explicit. Kontrollera obligatorisk registreringstid och antal observationer oberoende av energiavstämning.

**Acceptans:** Saknat fält512 ger rätt anvisningsutfall. Ofullständig period får rätt funktionsutfall först när tidigare kontroller passerat. Dubblett-ACK är idempotent.

**Kod/källa:**  · R1 §4; R2 §4; U bilaga1–2; EDI-referenser  
**Status:** Öppen

## E056 · Referenskedjor och officiella testdefinitioner är ofullständiga
**Evidens/prioritet:** Verifieringslucka / P1

**Observation:** 49308012 saknar original E66-S i uppladdningen. Alla positiva/negativa och flerobjektskedjor har inte komplett testprotokoll.

**Åtgärd:** Spårbart manifest per original, scenario, guide, aktörsroll och förväntade efterföljande meddelanden. Hämta saknade kedjor.

**Acceptans:** Varje använd referens har ett uttryckligt syfte. Ofullständiga exempel med xxx/repetition påstås inte vara färdiga EDI-filer.

**Kod/källa:**  · R1 §4/8; R3 §8; OE bilaga3–4  
**Status:** Öppen

## E057 · Källdokument innehåller motsägelser
**Evidens/prioritet:** Källkonflikt / P1

**Observation:** PRODAT bilaga4 nämner E2SE5A trots aktuell huvudanvisning E2SE6A. Svensk UTILTS har footer25-A-5 men omslag revision4. Även översättningens ändringslogg har datumavvikelse.

**Åtgärd:** Behåll original, hash och ett explicit konflikt-/tolkningsbeslut med källa och ansvarig. Inga tysta ändringar av dokument eller automatiska versioner från filnamn.

**Acceptans:** Samma dokumentkonflikt kan inte ge olika regler i två konsumenter. Oklara beslut förblir synliga och berörda funktioner godkänns inte utan grund.

**Kod/källa:**  · R1 §1/5; R2 §3; R3 §8; P s.41/120; U omslag/ändringslogg  
**Status:** Öppen

## E058 · APERAK-källor och 16.B måste ha rätt omfattning
**Evidens/prioritet:** Konfigurationsavvikelse / P1

**Observation:** 26.A/16.B betecknar el/gas i PRODAT-dokumentet, inte en allmän APERAK-version. Kodregistret har tidigare visat APERAK guideRevision16-B med elassociation.

**Åtgärd:** Skilj APERAK-svar på PRODAT, på UTILTS och övriga familjer. Tillhörande wireprofil/version härleds från rätt originalfamilj.

**Acceptans:** UTILTS-APERAK D04A och PRODAT-APERAK D96A blandas inte; generic05.B.5 används inte som ersättning för deras egna anvisningar.

**Kod/källa:** lib/ediel/rulebook/guideRegistry.ts · Tidigare läst guideRegistry; R2 §3; T kap.1.5/2.2; P omslag; A05 kap.1.2  
**Status:** Öppen

## E059 · Fulltext för tidigare UTILTS och aggregerade exempel saknas
**Evidens/prioritet:** Verifieringslucka / P0

**Observation:** 25-A-4 är för oktober. Fulltext25-A-3 och aggregerade exempel5–6 samt exakt tillämpliga testfallsdefinitioner saknas i granskningen.

**Åtgärd:** Lägg till originalkällorna och källbelagt oktober-tillägg för kodlistor. Undvik att begära dubbletter som redan lästs.

**Acceptans:** Alla aktiverade regelpaket har tillräckligt originalunderlag för sin period och omfattning. Ändringslogg ersätter inte hela basguiden.

**Kod/källa:**  · R1–R3 kvarstående underlag; U kap.1.7/1.8  
**Status:** Öppen

## E060 · Isolerade gröna kontroller räcker inte för produktionsgodkännande
**Evidens/prioritet:** Verifieringslucka / P0

**Observation:** 90 kuvertkontroller, isolerade felreproduktioner och READY i Vercel är inte full certifiering av meddelande-, databas-, faktura- och transportkedjan.

**Åtgärd:** Oberoende källoracle, enhetstest, integrationsprov, ren migrationsreplay, tenanttester och kontrollerat motpartsprov per aktiverad kapabilitet.

**Acceptans:** Varje stängd kodavvikelse har rött-före/grönt-efter-bevis på exakt SHA och migrationsnivå. Inga testcase-specialundantag i produktionsregler.

**Kod/källa:**  · R1 §7/9; R2 §1; R3 slutstatus; T/P implementering och tester  
**Status:** Öppen

## E061 · Deadline före sändning är inte längre ett verifierat aktuellt fel
**Evidens/prioritet:** Förtydligande / P2

**Observation:** I de senaste avläsningarna ligger fristen 20:31:24 efter sändning20:01:24. Att systemet väntar på Z02 är inte samma sak som aktiv leverans.

**Åtgärd:** Behåll separat bevakning. Skilj mottagarens faktiska regelankare från egen sändarbaserad bevakning när mottagningstiden är okänd.

**Acceptans:** Ingen påstådd SLA-överträdelse beräknas från fel klocka. Försenad kontaktuppgift/kvittens kan inte nollställa en redan gällande frist.

**Kod/källa:**  · R1 §6; R2/R3 transportdata; P s.86–87/109  
**Status:** Klargjord

## E062 · Verifiera referensintegritet, index och säker datalivscykel
**Evidens/prioritet:** Byggförslag / P1

**Observation:** Ingen full tabell-/index-/raderingsaudit har genomförts i dessa Edielgranskningar. Detta är en kompletterande bygg- och verifieringspunkt, inte ett fastställt fel på varje tabell.

**Åtgärd:** Återanvänd befintliga auktoritativa tabeller; inför nödvändiga tenant-FK, unika nycklar, riktade index, revisionshistorik och dokumenterad gallring.

**Acceptans:** Ingen kors-tenant-referens, dubblettaffärseffekt eller orphan. Kundradering förstör inte meddelandebevis eller lagstadgad dokumentation; retention prövas separat.

**Kod/källa:**  · Arkitekturförslag utifrån granskningsluckor; inga generella lagringsfrister fastställda här  
**Status:** Öppen
