# Bilaga D — acceptanskontrakt

Dessa är planerade beteendeprov, inte rapporterade genomförda tester. Varje scenario ska köras med oberoende facit och rätt miljö.

## SC-001 · Egen tenant med DDQ
**Givet:** Tenant A har legal aktör A, DDQ-profil och giltigt leveransavtal. B har annan aktör.

**När:** A beställer Z03L.

**Förväntat:** Partsidentitet A på wire, 23-DDQ-PRODAT, rätt objekt och L/Z22.

**Förbjuden effekt:** Gridex-id ersätter inte A:s aktör; ingen data från B.

**Regler:** TEN-02, TEN-05, ENV-06  
**Provnivå:** Integration/E2E  
**Status:** Inte körd mot systemet

## SC-002 · Egen tenant med DGI
**Givet:** Tenant B har egen legal ESCO-identitet och DSO-/kundavtal.

**När:** B beställer Z13V.

**Förväntat:** B:s juridisk aktör och 23-DGI-PRODAT; separat tillståndsärende.

**Förbjuden effekt:** Ingen Z03 och inget Gridex-ombud antas.

**Regler:** TEN-02, ESCO-01  
**Provnivå:** Integration/E2E  
**Status:** Inte körd mot systemet

## SC-003 · Provider ESCO för kundtenant
**Givet:** Provider P har legal ESCO; tenant K är avtalad beneficiary; uppdrag/kund/DSO-evidens finns.

**När:** K beställer mätvärdestillgång inom mandatet.

**Förväntat:** P agerar juridiskt i DGI; uppdrag kopplat till K internt.

**Förbjuden effekt:** K:s UUID skickas inte som legal Ediel-id; K får ingen obegränsad provideråtkomst.

**Regler:** TEN-03, TEN-14  
**Provnivå:** Integration/E2E  
**Status:** Inte körd mot systemet

## SC-004 · SaaS-tenant utan egen Edielregistrering
**Givet:** K är kund till ESCO-tjänsten och inte själv marknadsaktör.

**När:** K läser data efter giltigt grant.

**Förväntat:** Åtkomst genom explicit grant i P:s tjänst; inget krav på påhittad egen marknadsidentitet.

**Förbjuden effekt:** Skapa inte ett Ediel-id för att tillåta vanlig SaaS-användning.

**Regler:** TEN-03, TEN-08  
**Provnivå:** Integration/E2E  
**Status:** Inte körd mot systemet

## SC-005 · Två beneficiaries samma rättighetskälla
**Givet:** P har ett korrekt tillstånd och två självständigt giltiga uppdrag för samma objekt/period, K1 och K2.

**När:** En E66-DGI tas emot.

**Förväntat:** En upstream mottagning/disposition/kvittens, två behöriga interna projektioner.

**Förbjuden effekt:** Ingen dubbelt fakturerad energi eller dubbla kvittenser per beneficiary.

**Regler:** TEN-08, TEN-09  
**Provnivå:** Integration/E2E  
**Status:** Inte körd mot systemet

## SC-006 · En beneficiary avslutar
**Givet:** SC-005 men bara K1 säger upp uppdraget.

**När:** Avsluta K1:s interna grant.

**Förväntat:** K1:s framtida åtkomst spärras; K2:s rätt prövas separat och kan fortsätta.

**Förbjuden effekt:** Ingen automatisk Z18 som avslutar allas giltiga marknadstillstånd.

**Regler:** TEN-09, TEN-10  
**Provnivå:** Integration/E2E  
**Status:** Inte körd mot systemet

## SC-007 · Samma GSRN i annan tenant
**Givet:** K2 känner till anläggnings-id men saknar grant.

**När:** K2 anropar API/export med id:t.

**Förväntat:** Behörighetsavslag utan kunddata.

**Förbjuden effekt:** Global GSRN-matchning får inte ge åtkomst.

**Regler:** TEN-12  
**Provnivå:** Integration/E2E  
**Status:** Inte körd mot systemet

## SC-008 · Råfil med blandade behöriga objekt
**Givet:** P mottar fil med objekt för flera uppdrag; K har rätt till endast ett.

**När:** K begär råfil eller full export.

**Förväntat:** Filtrerad tillåten projektion; råfil bara för behörig operatör.

**Förbjuden effekt:** Övriga kunders innehåll lämnas inte ut.

**Regler:** TEN-07  
**Provnivå:** Integration/E2E  
**Status:** Inte körd mot systemet

## SC-009 · Tekniskt ombud skiljer sig från juridisk part
**Givet:** Registerpost har InterchangePartyId82150 och legalPartyId62110.

**När:** Routa eller ta emot enligt posten.

**Förväntat:** Identiteterna bevaras och behörig delegation kontrolleras.

**Förbjuden effekt:** Systemet kräver inte att parterna alltid är lika.

**Regler:** TEN-04, IMP-02  
**Provnivå:** Integration/E2E  
**Status:** Inte körd mot systemet

## SC-010 · Återkallelse under pågående exportjobb
**Givet:** Grant var aktivt vid köläggning men återkallat före läsning/sändning.

**När:** Jobbet tar lease och ska exportera.

**Förväntat:** Ompröva grantversion och stoppa otillåten export.

**Förbjuden effekt:** Ingen utdelning baserad bara på gamla cachevärden.

**Regler:** TEN-10, TEN-12  
**Provnivå:** Integration/E2E  
**Status:** Inte körd mot systemet

## SC-011 · Z15C efter separat intern återkallelse
**Givet:** Market permission återställs men beneficiary-grant har annan giltig återkallelse.

**När:** Ta emot korrekt Z15C.

**Förväntat:** Återställ market permission; beneficiary-grant förblir spärrat tills ny grund finns.

**Förbjuden effekt:** Alla beneficiaries återaktiveras inte automatiskt.

**Regler:** ESCO-09, TEN-10  
**Provnivå:** Integration/E2E  
**Status:** Inte körd mot systemet

## SC-012 · Samma aktör använder båda rollerna
**Givet:** Samma tenant/juridisk aktör har DDQ och DGI.

**När:** Behandla positiv Z14 och senare positiv Z04.

**Förväntat:** Z14 påverkar rättighet, Z04 leverans; separata state machines.

**Förbjuden effekt:** Inga korsvisa aktiveringar.

**Regler:** TEN-05  
**Provnivå:** Integration/E2E  
**Status:** Inte körd mot systemet

## SC-013 · UCI/LI-kollision mellan tenants
**Givet:** Två aktörer har liknande LI/BGM-referenser i olika namnrymder.

**När:** En kvittens för aktör B anländer till delad brevlåda.

**Förväntat:** Korrelation väljer B utifrån parter/marknad/roll/originalreferenser.

**Förbjuden effekt:** Tenant A:s ärende förblir oförändrat.

**Regler:** TEN-13, ACK-06  
**Provnivå:** Integration/E2E  
**Status:** Inte körd mot systemet

## SC-014 · Oattribuerbar mottagning
**Givet:** Teknisk mottagning lyckas men legal/tenantkontext är oklar.

**När:** MIME/EDI behandlas.

**Förväntat:** Skyddad staging och källstödd teknisk fel-/kvittenshantering där säkert möjlig.

**Förbjuden effekt:** Gissa inte tenant från första kundträffen; fabricera inte objektsfel på egen konfigbrist.

**Regler:** TEN-06, TEN-11  
**Provnivå:** Integration/E2E  
**Status:** Inte körd mot systemet

## SC-015 · Provider koordinerar pågående Z13
**Givet:** Samma P/kund/DSO har en väntande begäran från annat uppdrag.

**När:** K2 vill skicka ny Z13 för samma eller nya objekt.

**Förväntat:** Pröva Handbokens nya-objekt-/upprepningsfall och koordinerad begäran.

**Förbjuden effekt:** Beneficiary-id används inte för att kringgå21dagarsförloppet.

**Regler:** TEN-09, ESCO-06  
**Provnivå:** Integration/E2E  
**Status:** Inte körd mot systemet

## SC-016 · Delvis godkända ESCO-anläggningar
**Givet:** Z13 omfattar flera möjliga objekt; Z14 godkänner endast A.

**När:** Behandla Z14.

**Förväntat:** Permission/grants omfattar endast uttryckligen godkänd information.

**Förbjuden effekt:** B/C läggs inte till från kundregistret.

**Regler:** ESCO-04  
**Provnivå:** Integration/E2E  
**Status:** Inte körd mot systemet

## SC-017 · E66 saknar permission-id
**Givet:** Giltig DGI-serie kan identifieras via juridisk aktör, GSRN, produkt, period och tillståndskoppling.

**När:** Validera serie.

**Förväntat:** Korrelation utan påhittat wirefält; bara giltig kontext används.

**Förbjuden effekt:** Avvisa inte som saknat permission-id när det inte är föreskrivet fält.

**Regler:** ESCO-10  
**Provnivå:** Integration/E2E  
**Status:** Inte körd mot systemet

## SC-018 · DDQ-kundrelation utan ESCO-mandat
**Givet:** Elleverans finns men separat begärd ESCO-tjänst saknar tillstånd.

**När:** Skapa DGI-rättighet från kundkort.

**Förväntat:** Begär rätt underlag och följ tillståndsprocessen.

**Förbjuden effekt:** Aktiv elleverans blir inte automatiskt DGI-tillstånd.

**Regler:** TEN-05, ESCO-01  
**Provnivå:** Integration/E2E  
**Status:** Inte körd mot systemet

## SC-019 · DGI-värden till fakturering
**Givet:** Data mottagen i P:s DGI-roll och önskas användas av retailer K.

**När:** Bygg underlag.

**Förväntat:** Pröva datagrund/ändamål/leveransperiod/prismodell och bevara källproveniens.

**Förbjuden effekt:** Omskriv inte original som DDQ-E66 eller använd data utan rätt.

**Regler:** ESCO-11, DB-06  
**Provnivå:** Integration/E2E  
**Status:** Inte körd mot systemet

## SC-020 · Z13 positiv AP men ingen Z14
**Givet:** Begäran har positiv APERAK.

**När:** Kontrollera behörighet.

**Förväntat:** Ärendet väntar fortfarande på affärsbeslut.

**Förbjuden effekt:** Ingen mätvärdesåtkomst eller leveransaktivering.

**Regler:** ESCO-03  
**Provnivå:** Integration/E2E  
**Status:** Inte körd mot systemet

## SC-021 · Aktivt kontra passivt nekande
**Givet:** Giltiga Z14N med A13 respektive A76.

**När:** Behandla svaren var för sig.

**Förväntat:** Två särskilda nekandetillstånd med föreskrivna kvittenser.

**Förbjuden effekt:** Negativt affärssvar klassas inte som eget syntaxfel.

**Regler:** ESCO-05  
**Provnivå:** Integration/E2E  
**Status:** Inte körd mot systemet

## SC-022 · 21dagar utan svar
**Givet:** Utgående Z13 har inget Z14/N i retur efter bevakningsfrist.

**När:** Timer förfaller.

**Förväntat:** Overdue-uppgift och kontakt/spårning.

**Förbjuden effekt:** Inget lokalt fabricerat Z14N eller auto-godkännande.

**Regler:** ESCO-06, OPS-02  
**Provnivå:** Integration/E2E  
**Status:** Inte körd mot systemet

## SC-023 · Historikslut påverkar inte löpande tillstånd
**Givet:** Separata V- och VH-förlopp finns för samma objekt.

**När:** Ta emot Z15VH.

**Förväntat:** Historikjobbet avslutas/täckningen granskas; V fortsätter om giltigt.

**Förbjuden effekt:** Pågående V och DDQ-leverans avslutas inte.

**Regler:** ESCO-07  
**Provnivå:** Integration/E2E  
**Status:** Inte körd mot systemet

## SC-024 · Z14N utan positiv-Z14-fälten
**Givet:** Z14N har korrekt status men saknar IT/UD/tillstånds-id/rapporteringsfält som ej ska skickas.

**När:** Nationell validering.

**Förväntat:** Parentvillkor gör barnen ej tillämpliga.

**Förbjuden effekt:** Ingen falsk 41/316 eller 41/233 enbart från basmatrisens R.

**Regler:** P-04  
**Provnivå:** Integration/E2E  
**Status:** Inte körd mot systemet

## SC-025 · Z13 utan anläggnings-id
**Givet:** Korrekt tillståndsbegäran på kundnivå.

**När:** Bygg meddelandet.

**Förväntat:** LIN+1 finns; inget påhittat anläggnings-id, kundfält och rätt övriga villkor finns.

**Förbjuden effekt:** UUID får inte placeras som GSRN.

**Regler:** P-07, P-06  
**Provnivå:** Integration/E2E  
**Status:** Inte körd mot systemet

## SC-026 · Korrekt Z15 med DTM+164 och RFF+Z09
**Givet:** Ett Z15-fall innehåller känt tillstånds-id och rätt upphörandetid.

**När:** Validera den oförändrade meddelandestrukturen.

**Förväntat:** Fält 327 läses ur DTM+164 och fält 325 ur RFF+Z09.

**Förbjuden effekt:** Kräv inte DTM+273 eller RFF+ZPI och förväxla inte datumet med fält 321.

**Regler:** P-01  
**Provnivå:** Integration/E2E  
**Status:** Inte körd mot systemet

## SC-027 · Tidsbegränsat V-tillstånd jämfört med VH
**Givet:** Ett V-tillstånd har ett slutdatum, ett V gäller tills vidare och ett VH avser en historisk period.

**När:** Bygg varje tillämplig rapportperiod.

**Förväntat:** DTM+91 finns för tidsbegränsat V och för VH; utelämnas för V utan slutdatum.

**Förbjuden effekt:** Rapportslut får inte kopplas enbart till historiktypen.

**Regler:** ESCO-02, P-07  
**Provnivå:** Integration/E2E  
**Status:** Inte körd mot systemet

## SC-028 · Energiproduktens komponentposition
**Givet:** Z13 eller Z14 innehåller generiskt energiprodukt-id, fält 506.

**När:** Serialisera och parsa meddelandet.

**Förväntat:** Den andra förekomsten av 7110 bevaras som femte komponent i CAV.

**Förbjuden effekt:** Tomma komponenter får inte tas bort så att uppgiften flyttas till produktkod, fält 242.

**Regler:** ENV-02, P-07  
**Provnivå:** Integration/E2E  
**Status:** Inte körd mot systemet

## SC-029 · Z09D: start eller slut på avtal
**Givet:** Det finns separata korrekta avsikter för avtalsstart och avtalsslut.

**När:** Bygg dessa, och prova ett inkommande meddelande med båda datumen.

**Förväntat:** Använd DTM+92 eller DTM+93. Ett inkommande meddelande med båda ger P-APERAK med ERC 40 och särskild kod 109.

**Förbjuden effekt:** DTM+157 får inte ersätta avtalsdatumen.

**Regler:** P-08  
**Provnivå:** Integration/E2E  
**Status:** Inte körd mot systemet

## SC-030 · Z09E innehåller elanvändaren
**Givet:** Z09E gäller en kundhändelse som är tillåten i den valda processen.

**När:** Bygg Z09E enligt den specifika profilen.

**Förväntat:** NAD+UD och tillämpliga kunduppgifter finns med.

**Förbjuden effekt:** Ta inte bort UD för samtliga Z09-varianter.

**Regler:** P-09  
**Provnivå:** Integration/E2E  
**Status:** Inte körd mot systemet

## SC-031 · Extra, icke tillämpliga PRODAT-uppgifter
**Givet:** Syntaxen är giltig men meddelandet innehåller extra uppgifter som ska ignoreras enligt PRODAT-anvisningen.

**När:** Gör mottagningskontrollen.

**Förväntat:** Ingen negativ APERAK enbart för dessa extrauppgifter; uppgifterna påverkar inte affärsdata.

**Förbjuden effekt:** Mottagningstoleransen innebär inte att den egna byggaren ska börja skicka dessa uppgifter.

**Regler:** P-02  
**Provnivå:** Integration/E2E  
**Status:** Inte körd mot systemet

## SC-032 · Ett falskt D-villkor kan ge frivillig uppgift
**Givet:** Z06E eller Z06G innehåller ett fält vars specificerade villkor gör det obligatoriskt endast i Z06F och annars frivilligt.

**När:** Prova både med och utan fältet.

**Förväntat:** Den föreskrivna O-grenen används; falskt D-villkor gör inte alltid fältet till X.

**Förbjuden effekt:** Inför ingen strängare mottagningsregel utan källstöd.

**Regler:** P-03  
**Provnivå:** Integration/E2E  
**Status:** Inte körd mot systemet

## SC-033 · Flera register och flera objekt
**Givet:** Z04 eller Z10 innehåller flera mätarregister och två separata objekt.

**När:** Bygg och behandla meddelandet.

**Förväntat:** Globalt LIN-sekvensnummer, fält 314, och registerindex, fält 258, följer respektive regel. Register 2 och högre följer bilaga 2.

**Förbjuden effekt:** Ett fel i andra registret får inte döljas av första. Alla basmatrisens R-fält ska inte krävas upprepade gånger utan stöd.

**Regler:** P-05, ENV-02  
**Provnivå:** Integration/E2E  
**Status:** Inte körd mot systemet

## SC-034 · Felaktig LIN-sekvens
**Givet:** Första LIN-numret är 2, eller sekvensen har en lucka eller fel ordning. Syntaxen är i övrigt giltig.

**När:** Gör den nationella kontrollen.

**Förväntat:** Hela PRODAT-meddelandet avvisas med rätt P-APERAK och BGM/1225 = 27.

**Förbjuden effekt:** Korrekt UNH/UNT räcker inte för att godkänna den nationella sekvensen.

**Regler:** P-17  
**Provnivå:** Integration/E2E  
**Status:** Inte körd mot systemet

## SC-035 · Z02 verifierar uppgifter, inte leverans
**Givet:** En behörig uppgiftsförfrågan kan entydigt korreleras.

**När:** Ta emot ett giltigt Z02.

**Förväntat:** Lagra tillåten verifierad information och gör en separat prövning av nästa affärssteg.

**Förbjuden effekt:** Skapa inte aktiv leverans eller ett Z04-bekräftat tillstånd.

**Regler:** P-10  
**Provnivå:** Integration/E2E  
**Status:** Inte körd mot systemet

## SC-036 · Z04 anländer före positiv APERAK
**Givet:** Z03 har skickats. Ett korrekt korrelerat Z04 anländer före positiv APERAK.

**När:** Behandla först Z04 och sedan APERAK.

**Förväntat:** Registrera den bekräftade perioden. Den sena APERAK kompletterar kvittensstatus utan att backa affärstillståndet.

**Förbjuden effekt:** Avvisa inte Z04 enbart på grund av ankomstordningen.

**Regler:** P-11, ACK-06  
**Provnivå:** Integration/E2E  
**Status:** Inte körd mot systemet

## SC-037 · Leveransstart ligger i framtiden
**Givet:** Ett korrekt Z04 har mottagits med ett framtida startdatum.

**När:** Kör aktiveringsjobbet före och vid starttidpunkten.

**Förväntat:** Ingen förtida aktivering. Endast rätt, fortsatt giltiga period aktiveras vid rätt start.

**Förbjuden effekt:** SMTP-acceptans eller en teknisk kvittens får inte tidigarelägga startdatumet.

**Regler:** P-11  
**Provnivå:** Integration/E2E  
**Status:** Inte körd mot systemet

## SC-038 · Z04A och Z04D utan egen Z03
**Givet:** Rätt särskild grund för anvisning respektive mottagningspliktig produktion finns.

**När:** Ta emot respektive meddelande.

**Förväntat:** Använd särskild process och dess kontroller.

**Förbjuden effekt:** Ett generellt krav på en föregående egen Z03 får inte blockera dessa korrekta specialprocesser.

**Regler:** P-12  
**Provnivå:** Integration/E2E  
**Status:** Inte körd mot systemet

## SC-039 · Kancellering anländer före originalet
**Givet:** Original och kancellering kommer från rätt motpart men anländer i omvänd ordning.

**När:** Bearbeta enligt tillämplig korrelations- och kancelleringsregel.

**Förväntat:** Bevara båda meddelandena och deras orsakskedja. Eventuell intern väntan måste hålla föreskrivna kvittensfrister; annars krävs rätt externt utfall eller kontakt.

**Förbjuden effekt:** Ingen dubbel aktivering, tyst bortkastning eller gissad kompensation mot ett annat original.

**Regler:** P-14  
**Provnivå:** Integration/E2E  
**Status:** Inte körd mot systemet

## SC-040 · Rättelse efter negativ APERAK
**Givet:** En identifierad del av ett eget PRODAT har avvisats.

**När:** Rätta uppgiften och skapa en tillåten ny sändning.

**Förväntat:** Nytt BGM-id och spårbar relation till det oförändrat arkiverade originalet.

**Förbjuden effekt:** Återanvänd inte meddelandeidentiteten från den avvisade sändningen.

**Regler:** TR-05  
**Provnivå:** Integration/E2E  
**Status:** Inte körd mot systemet

## SC-041 · CONTRL-begäran och skydd mot kvittensloop
**Givet:** PRODAT, APERAK och CONTRL ska byggas.

**När:** Serialisera respektive kuvert.

**Förväntat:** UNB/0031 = 1 för kvittenspliktig PRODAT och APERAK. CONTRL begär inte en ny CONTRL och använder rätt UNH-version, CONTRL:2:2:UN.

**Förbjuden effekt:** BGM-koden AB ersätter inte UNB/0031. Ingen kvittensloop får skapas.

**Regler:** ENV-04, ACK-01  
**Provnivå:** Integration/E2E  
**Status:** Inte körd mot systemet

## SC-042 · De två APERAK-familjerna
**Givet:** Ett PRODAT-fel och ett UTILTS-fel ska besvaras.

**När:** Bygg respektive svar från originalets profil och utfall.

**Förväntat:** P-APERAK använder D96A, BGM/1225 34 eller 27 och originalreferenser enligt P. U-APERAK använder D04A, BGM/1001 312 eller 313 samt DOC och transaktionsreferenser där de ska finnas.

**Förbjuden effekt:** Blanda inte familjernas BGM-positioner, referenser eller gruppstrukturer.

**Regler:** ACK-02, ACK-03  
**Provnivå:** Integration/E2E  
**Status:** Inte körd mot systemet

## SC-043 · Rätt fältnummer i felmeddelandet
**Givet:** Ett PRODAT saknar fält 327 och ett UTILTS saknar fält 512 i fall där de är obligatoriska.

**När:** Skapa respektive negativa APERAK.

**Förväntat:** ERC 41 med fältreferens 327 respektive 512 i familjens rätta FTX-format.

**Förbjuden effekt:** Gissa inte 273 eller 597 genom att plocka siffror ur ett DTM-segmentnamn.

**Regler:** P-01, ACK-04  
**Provnivå:** Integration/E2E  
**Status:** Inte körd mot systemet

## SC-044 · Blandade UTILTS-transaktioner
**Givet:** IDE 1 är korrekt. IDE 2 har anvisningsfel. IDE 3 passerar anvisningskontrollen men har funktionsfel. Huvudet är korrekt.

**När:** Kör hela kontrollkedjan.

**Förväntat:** IDE 1 lagras och får positiv APERAK. IDE 2 får negativ APERAK. IDE 3 får UTILTS-ERR enligt tillämplig orsak.

**Förbjuden effekt:** En global klassificering får inte ersätta IDE 2:s anvisningsfel med ett senare funktionsfel.

**Regler:** U-03, ACK-08  
**Provnivå:** Integration/E2E  
**Status:** Inte körd mot systemet

## SC-045 · UTILTS har fel i huvudet
**Givet:** Ett obligatoriskt nationellt huvudfält är fel och det finns dessutom fel längre ned.

**När:** Validera meddelandet.

**Förväntat:** Negativ U-APERAK på huvudnivå. Inga efterföljande funktionskontroller och inga påhittade originaltransaktionsreferenser.

**Förbjuden effekt:** Välj inte exempelvis E10 innan huvudfelet hanterats.

**Regler:** U-03, ACK-03  
**Provnivå:** Integration/E2E  
**Status:** Inte körd mot systemet

## SC-046 · Äldre version av mätvärden anländer sist
**Givet:** En nyare godkänd dataversion finns. Den senare ankomsten har äldre registrerings-/uppdateringstidpunkt, fält 512 eller 532.

**När:** Behandla den äldre transaktionen som i övrigt är korrekt.

**Förväntat:** Positiv APERAK enligt regeln. Den nyare aktiva dataversionen skrivs inte över.

**Förbjuden effekt:** Ingen UTILTS-ERR eller tyst omfakturering enbart på grund av ankomstordningen.

**Regler:** U-04  
**Provnivå:** Integration/E2E  
**Status:** Inte körd mot systemet

## SC-047 · Okänt objekt i rätt mottagarsammanhang
**Givet:** Syntax och nationell anvisningskontroll har passerat. Rätt juridisk mottagare och roll är fastställda men objektet är okänt enligt den tillämpliga funktionskontrollen.

**När:** Pröva objektkontrollen.

**Förväntat:** UTILTS-ERR E10 där detta är kontrollens föreskrivna utfall.

**Förbjuden effekt:** Skapa inte ett nytt kundobjekt eller sök i andra tenants för att få kontrollen grön.

**Regler:** U-03, TEN-11  
**Provnivå:** Integration/E2E  
**Status:** Inte körd mot systemet

## SC-048 · Fel period men rätt objekt
**Givet:** Avsändare och objekt är korrekta men perioden bryter ett tillämpligt funktionsvillkor.

**När:** Pröva periodkontrollen efter föregående steg.

**Förväntat:** UTILTS-ERR E50 när denna kontroll är utlösande.

**Förbjuden effekt:** Använd inte E10 som generell kod för alla valideringsfel.

**Regler:** U-03  
**Provnivå:** Integration/E2E  
**Status:** Inte körd mot systemet

## SC-049 · ESCO saknar struktur som inte föreskrivits i Z14
**Givet:** Ett giltigt Z14 etablerar rätt objekt men innehåller inte mätar-/registeruppgifter som inte ska skickas i denna profil.

**När:** Validera E66 enligt källans tillämpliga villkor.

**Förväntat:** Använd villkoren för kontroll mot erhållen struktur. Lokalt saknade, ej föreskrivna fält får inte bli ett påhittat PRODAT-krav.

**Förbjuden effekt:** Ett godtyckligt E61 eller E62 på grund av lokal kunskapsbrist är inte ett godkänt testfacit.

**Regler:** U-08  
**Provnivå:** Integration/E2E  
**Status:** Inte körd mot systemet

## SC-050 · 88 av 96 kvartar
**Givet:** Ett helt 24-timmarsintervall i +0100 rapporteras med 15-minutersupplösning och 88 energivärden. Energisumman råkar stämma.

**När:** Kontrollera antal observationer efter att tidigare kontroller passerat.

**Förväntat:** UTILTS-ERR E87 där antalskontrollen är tillämplig; luckan synliggörs.

**Förbjuden effekt:** Korrekt energisumma får inte maskera saknade observationer.

**Regler:** U-10, U-11  
**Provnivå:** Integration/E2E  
**Status:** Inte körd mot systemet

## SC-051 · Versionsgränsen i oktober
**Givet:** Båda revisionerna använder UNH-koden E5SE5A men olika nationella regler gäller före och från 2026-10-01.

**När:** Prova mottagning, sändning, omsändning och historisk återspelning.

**Förväntat:** Ett sammanhållet, spårbart regelval per behandling. Nya 25-A-4-regler aktiveras inte före sin giltighet.

**Förbjuden effekt:** Oberoende datumval i olika lager får inte ge två motstridiga regelrevisioner.

**Regler:** GOV-04, GOV-05, GOV-06  
**Provnivå:** Integration/E2E  
**Status:** Inte körd mot systemet

## SC-052 · E73 begär E66 i DGI-rollen
**Givet:** ESCO har rätt omfattning, tillämpligt tillstånd och verifierad bilateral kapabilitet för begäran.

**När:** Bygg en begäran om saknade E66-värden.

**Förväntat:** Application Reference motsvarar den begärda E66-DGI-profilen. Efterfrågad meddelandetyp är uttrycklig.

**Förbjuden effekt:** Härled inte en generell E73-referens och anta inte rätt till S02 bara för att E73 kan begära S02 i en annan roll.

**Regler:** U-06  
**Provnivå:** Integration/E2E  
**Status:** Inte körd mot systemet

## SC-053 · NULL skiljs från noll
**Givet:** En observation saknas och representeras enligt profilens NULL-regel. En annan innehåller ett verifierat nollvärde.

**När:** Lagra data och bygg behörigt underlag.

**Förväntat:** Skilda värde- och kvalitetsrepresentationer; ingen automatisk nollifyllnad.

**Förbjuden effekt:** Mätarställning, energi och effekt får inte blandas ihop.

**Regler:** U-09  
**Provnivå:** Integration/E2E  
**Status:** Inte körd mot systemet

## SC-054 · Lagringen misslyckas
**Givet:** UTILTS-transaktionen är korrekt men databastransaktionen misslyckas.

**När:** Pröva skapandet av kvittensjobbet.

**Förväntat:** Ingen extern positiv APERAK före beständigt genomförd, föreskriven affärsbehandling. Fel och tidsfrist bevakas.

**Förbjuden effekt:** Enbart köstatus får inte betraktas som lagring i mottagande applikation.

**Regler:** U-14  
**Provnivå:** Integration/E2E  
**Status:** Inte körd mot systemet

## SC-055 · Kvittens hänvisar till en annan aktörs meddelande
**Givet:** APERAK har en liknande referens men kommer från fel juridisk motpart.

**När:** Försök korrelera kvittensen.

**Förväntat:** Ingen ändring i det felaktigt utpekade ärendet; loggad säker hantering.

**Förbjuden effekt:** Ingen tillståndsändring över tenantgränsen.

**Regler:** ACK-06  
**Provnivå:** Integration/E2E  
**Status:** Inte körd mot systemet

## SC-056 · Senare fel efter positiv APERAK
**Givet:** Ett internt fel upptäcks efter en giltig positiv APERAK för samma objekt/transaktion.

**När:** Pröva ny affärsvalidering.

**Förväntat:** Skapa incident och använd källstödd rättelse- eller kontaktprocess, inte en motsatt APERAK för samma tidigare utfall.

**Förbjuden effekt:** Ett återförsök får inte skriva om kvittenshistoriken.

**Regler:** ACK-07  
**Provnivå:** Integration/E2E  
**Status:** Inte körd mot systemet

## SC-057 · Registerimport är idempotent
**Givet:** Samma fil importeras två gånger. En senare registerversion innehåller tre motstridiga adressändringar.

**När:** Förhandsgranska och applicera kontrollerat.

**Förväntat:** Identiska data skapar inte dubbletter. Marknader, roller och rutter bevaras. Motstridiga ändringar får tydlig behandling och körningen får slutstatus.

**Förbjuden effekt:** En import med noll inlästa rutter får inte beskrivas som fullt sändningsklar. En avbruten körning får inte ligga obevakad som running.

**Regler:** IMP-01, IMP-02, IMP-03  
**Provnivå:** Integration/E2E  
**Status:** Inte körd mot systemet

## SC-058 · Samma aktör har olika SMTP för EL och GAS
**Givet:** Exporten har skilda PRODAT-adresser på de två marknaderna.

**När:** Välj rutt för ett EL-meddelande.

**Förväntat:** Använd EL-adressen; GAS är inte reservrutt.

**Förbjuden effekt:** Använd inte en marknadslös sökning som väljer första träffen.

**Regler:** IMP-02  
**Provnivå:** Integration/E2E  
**Status:** Inte körd mot systemet

## SC-059 · Tom registrerad subadress
**Givet:** Registerversionen anger ingen subadress för den valda aktören och trafiken.

**När:** Bygg rutt- och kuvertprofilen.

**Förväntat:** Tom subadress bevaras; ingen universell GRIDEX- eller SCH-standard införs.

**Förbjuden effekt:** Ändra inte Mjölbys registrerade PRODAT-subadress utan registerstöd.

**Regler:** IMP-04  
**Provnivå:** Integration/E2E  
**Status:** Inte körd mot systemet

## SC-060 · Certifikatets exakta giltighet
**Givet:** Ett certifikat gick ut för en timme sedan, ett börjar gälla i morgon och ett är spärrat.

**När:** Pröva både direkt valt certifikat-id och automatisk kandidatsökning.

**Förväntat:** Samtliga dessa certifikat underkänns enligt exakt giltighet och status. Eventuellt reservförfarande prövas separat enligt T.

**Förbjuden effekt:** Runda inte upp giltighetstiden till noll dagar och kringgå inte kontrollen genom direkt id-val.

**Regler:** TR-06  
**Provnivå:** Integration/E2E  
**Status:** Inte körd mot systemet

## SC-061 · Överlappande mottagarcertifikat
**Givet:** Två giltiga certifikat finns för samma verifierade mottagaromfattning.

**När:** Skapa S/MIME-kuvertet.

**Förväntat:** Ta med de mottagarcertifikat som föreskrivs vid överlapp.

**Förbjuden effekt:** Välj inte enbart senaste certifikat-id som generell regel.

**Regler:** TR-07  
**Provnivå:** Integration/E2E  
**Status:** Inte körd mot systemet

## SC-062 · SMTP accepterar men leveransrapport visar fel
**Givet:** Meddelandet accepteras för köläggning men slutleveransen misslyckas.

**När:** Behandla den inkomna DSN-rapporten.

**Förväntat:** Registrera leveransfelet mot rätt sändningsförsök; ingen affärsaktivering.

**Förbjuden effekt:** Originalets EDIFACT-bilaga i returbrevet får inte importeras som ny marknadstrafik.

**Regler:** TR-02, TR-04  
**Provnivå:** Integration/E2E  
**Status:** Inte körd mot systemet

## SC-063 · Okänt sändningsutfall efter DATA
**Givet:** Förbindelsen bryts efter att meddelandet kan ha accepterats av SMTP-servern.

**När:** Återstarta arbetaren.

**Förväntat:** Registrera submission_unknown och spåra utfallet innan ett affärsmässigt återförsök bedöms.

**Förbjuden effekt:** Ingen blind omsändning av Z03 och inget löfte om exakt en SMTP-leverans.

**Regler:** TR-10  
**Provnivå:** Integration/E2E  
**Status:** Inte körd mot systemet

## SC-064 · Regel eller behörighet förändras i kön
**Givet:** En avsikt byggs under version 1. Före sändning ändras en relevant policy, rutt eller rättighet.

**När:** Kör kontrollen före sändning.

**Förväntat:** Ompröva och lagra ett nytt spårbart beslut, eller blockera den berörda åtgärden.

**Förbjuden effekt:** Skicka inte ett inaktuellt innehåll med ett gammalt behörighetsbeslut.

**Regler:** GOV-04, OPS-01  
**Provnivå:** Integration/E2E  
**Status:** Inte körd mot systemet

## SC-065 · AI-lista från leverantör
**Givet:** En DDQ-tenant exporterar en månads avstämningsuppgifter.

**När:** Bygg AI-listans CSV.

**Förväntat:** Nätföretaget står först i huvudet. De sex leverantörstomma fälten lämnas tomma. Rätt kundidentitet, namn och avslutande semikolon används.

**Förbjuden effekt:** Inga interna UUID som GSRN och inget generiskt energiprodukt-id som tidsserieprodukt.

**Regler:** AI-01, AI-02  
**Provnivå:** Integration/E2E  
**Status:** Inte körd mot systemet

## SC-066 · AI-listans historik och avvikelser
**Givet:** En anläggning har ändrats under perioden och leveransen omfattar bara en del av perioden. En inkommande lista avviker från databasen.

**När:** Exportera perioduppgifterna och läs in avstämningen.

**Förväntat:** Rätt detaljrader och giltighetsperioder. Avvikelser leder till utredning.

**Förbjuden effekt:** Ingen automatisk överskrivning av grunddata från AI-listan.

**Regler:** AI-03, AI-04  
**Provnivå:** Integration/E2E  
**Status:** Inte körd mot systemet

## SC-067 · BI-export i DDQ- eller DGI-roll
**Givet:** En användare vill skapa en BI-lista men agerar inte som elnätsföretag.

**När:** Begär export.

**Förväntat:** Blockera rollen även om systemet kan läsa filformatet.

**Förbjuden effekt:** Plattformen får inte uppträda som nätägare utan rätt roll och underlag.

**Regler:** AI-05  
**Provnivå:** Integration/E2E  
**Status:** Inte körd mot systemet

## SC-068 · Test och återspelning når inte produktion
**Givet:** En referensfil använder testidentitet eller ett beslut har läget historical_replay.

**När:** Försök skapa automatisk produktionssändning eller kundändring.

**Förväntat:** Ingen extern produktionssändning och ingen produktionsmutation.

**Förbjuden effekt:** catalog_evidence får inte användas som operativ sändningsauktoritet.

**Regler:** ENV-05, GOV-08  
**Provnivå:** Integration/E2E  
**Status:** Inte körd mot systemet

## SC-069 · Ny beredskapsverifiering för berört scope
**Givet:** En DGI-regel ändras för en viss omfattning medan DDQ är opåverkad.

**När:** Skapa releasebevis.

**Förväntat:** Nytt bevis för berörd tenant, aktör, roll och kapabilitet. Fortsatt säker mottagning och föreskriven kvittensdrift hålls tillgänglig.

**Förbjuden effekt:** Ett gammalt globalt is_ready får inte godkänna alla roller och profiler.

**Regler:** OPS-01  
**Provnivå:** Integration/E2E  
**Status:** Inte körd mot systemet

## SC-070 · Kundavslut med bevarandekrav
**Givet:** En kund avslutar. Vissa journaluppgifter behöver bevaras enligt beslutad lagringsklass.

**När:** Kör datalivscykeln.

**Förväntat:** Operativt avslut, återkallade rättigheter och tillåten radering eller pseudonymisering genomförs med spårbar lagringsgrund.

**Förbjuden effekt:** Ingen blind CASCADE-radering av mätdata, fakturor och kvittenshistorik.

**Regler:** DB-05  
**Provnivå:** Integration/E2E  
**Status:** Inte körd mot systemet

## SC-071 · Samtidig återkallelse och distribution
**Givet:** Ett åtkomstgrant återkallas samtidigt som ett E66-resultat ska delas internt.

**När:** Kör exportjobb och rättighetsändring parallellt.

**Förväntat:** Kontroll av aktuell version och transaktionsgräns hindrar utlämning utan giltig rätt.

**Förbjuden effekt:** Ett tidigare behörighetsbeslut får inte användas efter relevant återkallelse.

**Regler:** TEN-10, TEN-12  
**Provnivå:** Integration/E2E  
**Status:** Inte körd mot systemet

## SC-072 · Oberoende test avslöjar gemensamt mappningsfel
**Givet:** Byggare och validator använder samma felaktiga fältmappning.

**När:** Kör referenstest med facit från en oberoende, versionsriktig källa.

**Förväntat:** Felet upptäcks även om egen serialisering och parsning ger en lyckad rundtur.

**Förbjuden effekt:** Enbart rundtur med egen parser bevisar inte överensstämmelse med Ediel.

**Regler:** GOV-08, OPS-03  
**Provnivå:** Integration/E2E  
**Status:** Inte körd mot systemet

## AT-GOV-01 · Regelkontrakt: GOV-01
**Givet:** Alla profiler

**När:** Publicering av regelpaket – prova både uppfyllt villkor och relevant fel-/gränsfall.

**Förväntat:** Varje normativ regel har dokumenthash, version/revision, sida/avsnitt, giltighet och exakt omfattning. → Publicera immutabel regelversion med granskningsspår.

**Förbjuden effekt:** Ej styrkt regel ska inte generera nya externa meddelanden eller påhittade felkoder.

**Regler:** GOV-01  
**Provnivå:** Planerat regelbeteendeprov  
**Status:** Inte körd mot systemet

## AT-GOV-02 · Regelkontrakt: GOV-02
**Givet:** PRODAT

**När:** Komposition av fältprofil – prova både uppfyllt villkor och relevant fel-/gränsfall.

**Förväntat:** P §2.2 har företräde framför motstridiga bilaga4-villkor; första register och register2+ har skilda regler. → Tillämpa basprofil + subtype + parent + registeroverlay.

**Förbjuden effekt:** Ingen automatisk kopiering av gamla bilaga4-koder eller bas-R till alla register.

**Regler:** GOV-02  
**Provnivå:** Planerat regelbeteendeprov  
**Status:** Inte körd mot systemet

## AT-GOV-03 · Regelkontrakt: GOV-03
**Givet:** PRODAT/AP/UTILTS

**När:** Val av guide – prova både uppfyllt villkor och relevant fel-/gränsfall.

**Förväntat:** Elprofil26.A och tillhörande APERAK skiljs från gasprofil16.B; generisk AP05.B.5 ersätter inte P-/U-specifika APERAK. → Välj APERAK enligt ursprungsfamilj och dess guide.

**Förbjuden effekt:** Stoppa sammanblandad wireversion; ingen generell APERAK16.B-profil för EL.

**Regler:** GOV-03  
**Provnivå:** Planerat regelbeteendeprov  
**Status:** Inte körd mot systemet

## AT-GOV-04 · Regelkontrakt: GOV-04
**Givet:** Utgående meddelande och omsändning

**När:** Före varje extern sändning – prova både uppfyllt villkor och relevant fel-/gränsfall.

**Förväntat:** Använd då gällande anvisning; avvikande omsändning endast där giltig bilateral överenskommelse tillåter. → Ny prövning efter versionsgräns; behåll tidigare payload och beslut som historik.

**Förbjuden effekt:** Skicka inte gammal köpayload med ny versionsetikett.

**Regler:** GOV-04  
**Provnivå:** Planerat regelbeteendeprov  
**Status:** Inte körd mot systemet

## AT-GOV-05 · Regelkontrakt: GOV-05
**Givet:** Mottagning

**När:** Ny anvisning börjar gälla – prova både uppfyllt villkor och relevant fel-/gränsfall.

**Förväntat:** Hantera närmast föregående giltiga anvisning under tvåveckorsövergång, med hänsyn till överordnade regler. → Använd ett komplett kompatibelt regelpaket per prövning, logga vald tolkning.

**Förbjuden effekt:** Plocka inte gynnsamma enstaka kontroller från olika versioner; samma UNH-kod är inte revisionsbevis.

**Regler:** GOV-05  
**Provnivå:** Planerat regelbeteendeprov  
**Status:** Inte körd mot systemet

## AT-GOV-06 · Regelkontrakt: GOV-06
**Givet:** UTILTS

**När:** Gemensam runtimevalidering – prova både uppfyllt villkor och relevant fel-/gränsfall.

**Förväntat:** Format-/övergångstid, dokumentdatum, leveransperiod och replaytid är separata tidsbegrepp som beslutet bär. → För explicit versionsbeslut till utiltsEngine; inget nytt implicit now().

**Förbjuden effekt:** Avvisa lokalt osammanhängande beslut före mutation; inte externt fältfel om orsaken är egen kod.

**Regler:** GOV-06  
**Provnivå:** Planerat regelbeteendeprov  
**Status:** Inte körd mot systemet

## AT-GOV-07 · Regelkontrakt: GOV-07
**Givet:** Energidelning/2027-förslag

**När:** Kapabilitet aktiveras – prova både uppfyllt villkor och relevant fel-/gränsfall.

**Förväntat:** P §2.3 anger användning från 2027-01-01; S18 ej, endast15min och produktion; framtida nya koder är inte antagna. → Håll egen framtida profil avstängd före datum och före separata legala/processuella verifieringar.

**Förbjuden effekt:** Ingen aktivering bara för att PDF är publicerad.

**Regler:** GOV-07  
**Provnivå:** Planerat regelbeteendeprov  
**Status:** Inte körd mot systemet

## AT-GOV-08 · Regelkontrakt: GOV-08
**Givet:** Referenser och TGT

**När:** Inför acceptanstest – prova både uppfyllt villkor och relevant fel-/gränsfall.

**Förväntat:** Knyt originalfilhash till källa, testfall, revision, roll och förväntat positivt/negativt resultat. → Bevara negativa referenser som negativa; dokumentera konflikt.

**Förbjuden effekt:** Ändra inte referensen för att passa egen renderer.

**Regler:** GOV-08  
**Provnivå:** Planerat regelbeteendeprov  
**Status:** Inte körd mot systemet

## AT-TEN-01 · Regelkontrakt: TEN-01
**Givet:** Alla affärsoperationer

**När:** Command skapas eller meddelande attribueras – prova både uppfyllt villkor och relevant fel-/gränsfall.

**Förväntat:** Tenant, juridisk aktör, operativ roll och teknisk identitet är olika typer. → Skapa verifierat execution context före kundmutation.

**Förbjuden effekt:** Tenantens namn/domän/mejl får inte ersätta marknadsidentitet.

**Regler:** TEN-01  
**Provnivå:** Planerat regelbeteendeprov  
**Status:** Inte körd mot systemet

## AT-TEN-02 · Regelkontrakt: TEN-02
**Givet:** Tenant med egen leverantör/ESCO

**När:** Utgående/inkommande trafik – prova både uppfyllt villkor och relevant fel-/gränsfall.

**Förväntat:** Tenantens verifierade juridiska Ediel-id används; gemensam brevlåda är en transportegenskap. → Bevara befintligt beslut om egna Ediel-id; separata aktörsprofiler för DDQ/DGI.

**Förbjuden effekt:** Byt inte alla till Gridex-id eller registrera tekniskt ombud automatiskt.

**Regler:** TEN-02  
**Provnivå:** Planerat regelbeteendeprov  
**Status:** Inte körd mot systemet

## AT-TEN-03 · Regelkontrakt: TEN-03
**Givet:** Gridex är legal ESCO åt beneficiary tenant

**När:** Z13 beställs av annan tenant – prova både uppfyllt villkor och relevant fel-/gränsfall.

**Förväntat:** Operating tenant/actor=ESCO-leverantören; beneficiary tenant uttrycklig; kund- och DSO-avtal ger marknadsgrund. → Z13 sänds i den verkliga ESCO-aktörens DGI-roll, utan interna tenant-id i EDIFACT.

**Förbjuden effekt:** SaaS-avtal/ägande av plattformen ger inte mätvärdestillstånd.

**Regler:** TEN-03  
**Provnivå:** Planerat regelbeteendeprov  
**Status:** Inte körd mot systemet

## AT-TEN-04 · Regelkontrakt: TEN-04
**Givet:** Verkligt registrerat ombudsförhållande

**När:** Adressmatchning – prova både uppfyllt villkor och relevant fel-/gränsfall.

**Förväntat:** InterchangePartyId och juridisk PartyId bevaras var för sig; stöd endast uttryckligen dokumenterad relation. → Routa tekniskt via ombud utan att byta juridisk aktör.

**Förbjuden effekt:** Tvinga inte teknisk==juridisk; anta inte att delad SMTP betyder ombudsmandat.

**Regler:** TEN-04  
**Provnivå:** Planerat regelbeteendeprov  
**Status:** Inte körd mot systemet

## AT-TEN-05 · Regelkontrakt: TEN-05
**Givet:** Aktör både DDQ och DGI

**När:** Varje affärshändelse – prova både uppfyllt villkor och relevant fel-/gränsfall.

**Förväntat:** Roll bestäms av affärsprocess, inte globalt standardfält. → 23-DDQ-PRODAT för leverantörsprocess;23-DGI-PRODAT för tillståndsprocess.

**Förbjuden effekt:** Z14 får inte aktivera leverans; Z04 ger inte generellt ESCO-tillstånd.

**Regler:** TEN-05  
**Provnivå:** Planerat regelbeteendeprov  
**Status:** Inte körd mot systemet

## AT-TEN-06 · Regelkontrakt: TEN-06
**Givet:** Inkommande EDIFACT

**När:** Efter säker MIME-/syntaxklassificering – prova både uppfyllt villkor och relevant fel-/gränsfall.

**Förväntat:** Attribuera teknisk mottagare, juridisk mottagare, roll/marknad och ursprungssammanhang där sådant finns. → Identifiera en juridiskt ansvarig aktör; därifrån korrekt tenant-/servicekontext.

**Förbjuden effekt:** Oklar attribution hålls i skyddad karantän; ingen gissad tenant från kund-id.

**Regler:** TEN-06  
**Provnivå:** Planerat regelbeteendeprov  
**Status:** Inte körd mot systemet

## AT-TEN-07 · Regelkontrakt: TEN-07
**Givet:** Flera objekt/meddelanden i fil

**När:** Efter juridisk mottagarattribution – prova både uppfyllt villkor och relevant fel-/gränsfall.

**Förväntat:** Varje nyttig datadel matchas mot tillstånd och serviceuppdrag; transportkuvert och affärsgrants är inte samma omfattning. → Ägaraktören behåller råfil; beneficiaries ser bara tillåtna objekt/perioder/fält.

**Förbjuden effekt:** Ge inte hela EML/filen till en tenant som bara har rätt till en transaktion.

**Regler:** TEN-07  
**Provnivå:** Planerat regelbeteendeprov  
**Status:** Inte körd mot systemet

## AT-TEN-08 · Regelkontrakt: TEN-08
**Givet:** En ESCO-mätserie har flera giltiga mottagartenants

**När:** Efter accepterad lagring – prova både uppfyllt villkor och relevant fel-/gränsfall.

**Förväntat:** Separata data_access_grants för varje beneficiary, ändamål, objekt, produkt och tidsintervall. → En marknadsmottagning och kvittens; därefter separat intern distribution per giltigt grant.

**Förbjuden effekt:** Ingen automatisk kopiering till alla tenants med samma GSRN.

**Regler:** TEN-08  
**Provnivå:** Planerat regelbeteendeprov  
**Status:** Inte körd mot systemet

## AT-TEN-09 · Regelkontrakt: TEN-09
**Givet:** Samma legal ESCO/kund/DSO

**När:** Ny begäran eller uppsägning – prova både uppfyllt villkor och relevant fel-/gränsfall.

**Förväntat:** Koordinera market_permission över serviceuppdrag; beneficiary-id är inte en ny marknadsaktör. → Återanvänd enbart rättsligt och semantiskt kompatibelt tillstånd; håll uppdragsgrants separata.

**Förbjuden effekt:** En tenant får inte starta dubblett-Z13 eller avsluta delat tillstånd för andra.

**Regler:** TEN-09  
**Provnivå:** Planerat regelbeteendeprov  
**Status:** Inte körd mot systemet

## AT-TEN-10 · Regelkontrakt: TEN-10
**Givet:** Market permission eller internt grant ändras

**När:** API-läsning, export och jobbverkställighet – prova både uppfyllt villkor och relevant fel-/gränsfall.

**Förväntat:** Åtkomst prövas mot aktuella grantversioner; marknadsslut och intern tenantåterkallelse olika händelser. → Stoppa framtida otillåten användning; bevara tillåten historik/audit enligt lagringspolicy.

**Förbjuden effekt:** Ingen återaktivering av återkallat beneficiary-grant bara för att Z15C återställer marknadstillstånd.

**Regler:** TEN-10  
**Provnivå:** Planerat regelbeteendeprov  
**Status:** Inte körd mot systemet

## AT-TEN-11 · Regelkontrakt: TEN-11
**Givet:** Okänd lokal entitlement

**När:** Inkommande giltig marknadstrafik – prova både uppfyllt villkor och relevant fel-/gränsfall.

**Förväntat:** Skilj eget konfigurationsfel från avsändarens anvisnings-/funktionsfel. → Behåll föreskriven teknisk kvittens där säkert möjlig; utred egen behörighetskonfiguration utan dataexponering.

**Förbjuden effekt:** Skicka inte E10 eller42/209 enbart för att fel tenant valts lokalt.

**Regler:** TEN-11  
**Provnivå:** Planerat regelbeteendeprov  
**Status:** Inte körd mot systemet

## AT-TEN-12 · Regelkontrakt: TEN-12
**Givet:** DB/API/job/cache

**När:** Varje åtkomst – prova både uppfyllt villkor och relevant fel-/gränsfall.

**Förväntat:** Sammansatta tenant-referenser, explicit delegation och grantfilter; service credentials inte synonymt med global behörighet. → RLS/RPC verifierar actor/role/tenant även i bakgrundsjobb; isolera cache/sök/export.

**Förbjuden effekt:** Ingen OR-villkorsbaserad superadminläcka till beneficiaries.

**Regler:** TEN-12  
**Provnivå:** Planerat regelbeteendeprov  
**Status:** Inte körd mot systemet

## AT-TEN-13 · Regelkontrakt: TEN-13
**Givet:** BGM/UNB/IDE/tillstånd

**När:** Allokering och korrelation – prova både uppfyllt villkor och relevant fel-/gränsfall.

**Förväntat:** Unikhet i protokollets avsändar-/applikationsutrymme även när flera tenants nyttjar samma juridiska ESCO. → Lagra interna UUID och wire-id separat; entydigt ursprung för kvittenser.

**Förbjuden effekt:** Tenantlokala räknare får inte krocka externt; LI ensam är inte tenantnyckel.

**Regler:** TEN-13  
**Provnivå:** Planerat regelbeteendeprov  
**Status:** Inte körd mot systemet

## AT-TEN-14 · Regelkontrakt: TEN-14
**Givet:** Cross-tenant ESCO

**När:** Uppdrag aktiveras – prova både uppfyllt villkor och relevant fel-/gränsfall.

**Förväntat:** Fastställ vem som är ESCO, berättigad mottagare, avtalspart och tillåten intern mottagare; dokumentera dataskyddsroller. → Tillåt avgränsad aktivering efter evidens.

**Förbjuden effekt:** Lämna uppdrag spärrat tills konkreta rättigheter finns; rollnamn är inte juridiskt bevis.

**Regler:** TEN-14  
**Provnivå:** Planerat regelbeteendeprov  
**Status:** Inte körd mot systemet

## AT-IMP-01 · Regelkontrakt: IMP-01
**Givet:** XML/TXT

**När:** Fil läses – prova både uppfyllt villkor och relevant fel-/gränsfall.

**Förväntat:** Officiell struktur: Market/Company/Identifiers/Key Type/EDIFACTDetails; TXT har egna familjeblock och kan innehålla radbrytningar. → En importerande kärna med separata formatadaptrar och gemensam typad utdata.

**Förbjuden effekt:** Avvisa oläsbar post med diagnos; acceptera inte0routes som framgång.

**Regler:** IMP-01  
**Provnivå:** Planerat regelbeteendeprov  
**Status:** Inte körd mot systemet

## AT-IMP-02 · Regelkontrakt: IMP-02
**Givet:** EL/GAS och roller

**När:** Normalisering – prova både uppfyllt villkor och relevant fel-/gränsfall.

**Förväntat:** Bevara marknad, originalkod, land, roller, teknik/juridik, familj, subadress och transporttyp. → Matcha rätt rutt inom rätt marknad; GAS kan lagras som referens men inte köras i EL-profil.

**Förbjuden effekt:** Slå inte ihop aktörer endast på namn/orgnr eller tappa familjekvalificerare.

**Regler:** IMP-02  
**Provnivå:** Planerat regelbeteendeprov  
**Status:** Inte körd mot systemet

## AT-IMP-03 · Regelkontrakt: IMP-03
**Givet:** Ruttändring

**När:** Preview/apply – prova både uppfyllt villkor och relevant fel-/gränsfall.

**Förväntat:** Diff mot giltig snapshot; separation av registeruppgift, granskning och autosändningsberedskap. → Atomär/idempotent import med kvarstående konflikter och ny ruttversion.

**Förbjuden effekt:** Importerad adress betyder inte giltigt certifikat eller klar produktion.

**Regler:** IMP-03  
**Provnivå:** Planerat regelbeteendeprov  
**Status:** Inte körd mot systemet

## AT-IMP-04 · Regelkontrakt: IMP-04
**Givet:** Subadresser

**När:** Ruttbeslut – prova både uppfyllt villkor och relevant fel-/gränsfall.

**Förväntat:** Tom registrerad subadress är ett giltigt värde; UTILTS använder inte subadress. → Bevara exakt registrerat värde; återverifiera Gridex GRIDEX-avvikelsen.

**Förbjuden effekt:** Hitta inte på PRODAT/SCH/GRIDEX för alla.

**Regler:** IMP-04  
**Provnivå:** Planerat regelbeteendeprov  
**Status:** Inte körd mot systemet

## AT-IMP-05 · Regelkontrakt: IMP-05
**Givet:** Certifikat-/SMTP-byte

**När:** Ny ruttversion – prova både uppfyllt villkor och relevant fel-/gränsfall.

**Förväntat:** Säkerhetsidentitet och registrerad adress verifieras tillsammans; bevara gammal version för historik. → Invalidate berörda aktörers/tenants readiness och verifiera returväg.

**Förbjuden effekt:** Skicka inte med nytt mejlmål och gammalt obestämt certifikatscope.

**Regler:** IMP-05  
**Provnivå:** Planerat regelbeteendeprov  
**Status:** Inte körd mot systemet

## AT-ENV-01 · Regelkontrakt: ENV-01
**Givet:** PRODAT/UTILTS/AP för dessa

**När:** Serialisering – prova både uppfyllt villkor och relevant fel-/gränsfall.

**Förväntat:** UNOC:3 och faktiska ISO8859-1-byte; escaping enligt UNA före sammanfogning. → Detektera tecken som inte kan representeras; bevara original och dokumenterad tillåten konvertering.

**Förbjuden effekt:** Maskera inte UTF8-byte som UNOC; trunkera inte kund-id.

**Regler:** ENV-01  
**Provnivå:** Planerat regelbeteendeprov  
**Status:** Inte körd mot systemet

## AT-ENV-02 · Regelkontrakt: ENV-02
**Givet:** Alla EDIFACT

**När:** Parse/render – prova både uppfyllt villkor och relevant fel-/gränsfall.

**Förväntat:** Alternativa UNA-separatorer, releasechar och tomma komponentpositioner bevaras; releasechar räknas inte i fältlängd. → Positionsstabilt AST med span/segmentgrupp/objekt/register.

**Förbjuden effekt:** Ingen split/filter(Boolean) som flyttar CAV-komponenter.

**Regler:** ENV-02  
**Provnivå:** Planerat regelbeteendeprov  
**Status:** Inte körd mot systemet

## AT-ENV-03 · Regelkontrakt: ENV-03
**Givet:** UNB/UNH/UNT/UNZ

**När:** Färdig payload – prova både uppfyllt villkor och relevant fel-/gränsfall.

**Förväntat:** Unika tekniska referenser; UNT inkluderar UNH/UNT; UNZ count och ref stämmer;0010/0017/0019 enligt profil. → Beräkna räknare från faktiskt serialiserad struktur.

**Förbjuden effekt:** Återanvänd inte filnamn som tekniskt id; inga handskrivna stale segmentantal.

**Regler:** ENV-03  
**Provnivå:** Planerat regelbeteendeprov  
**Status:** Inte körd mot systemet

## AT-ENV-04 · Regelkontrakt: ENV-04
**Givet:** UNB

**När:** Utgående – prova både uppfyllt villkor och relevant fel-/gränsfall.

**Förväntat:** UNB/0031=1 när CONTRL ska begäras; utelämna för CONTRL. → Samma kvittensbeslut används i kuvert och bevakning.

**Förbjuden effekt:** AB i BGM ersätter inte0031; skapa inte kvittensloop.

**Regler:** ENV-04  
**Provnivå:** Planerat regelbeteendeprov  
**Status:** Inte körd mot systemet

## AT-ENV-05 · Regelkontrakt: ENV-05
**Givet:** UNB testflagga

**När:** Parse/render – prova både uppfyllt villkor och relevant fel-/gränsfall.

**Förväntat:** 0035=1 för test; produktion utelämnar flaggan. → Separata identiteter, routing, dedupe och transportspärrar för test/replay/produktion.

**Förbjuden effekt:** Sätt inte0 som ersättning; kör aldrig TGTreferens som produktionsaffär.

**Regler:** ENV-05  
**Provnivå:** Planerat regelbeteendeprov  
**Status:** Inte körd mot systemet

## AT-ENV-06 · Regelkontrakt: ENV-06
**Givet:** PRODAT

**När:** BGM/CCI byggs – prova både uppfyllt villkor och relevant fel-/gränsfall.

**Förväntat:** BGM bär Z-funktion utan suffix; CCI Z13/CAV bär treteckenskod för undertyp. → Z03 + Z22 betyder Z03L, inte BGM+Z03L.

**Förbjuden effekt:** Avvisa fel kombination på rätt kontrollnivå.

**Regler:** ENV-06  
**Provnivå:** Planerat regelbeteendeprov  
**Status:** Inte körd mot systemet

## AT-ENV-07 · Regelkontrakt: ENV-07
**Givet:** PRODAT

**När:** Batchning – prova både uppfyllt villkor och relevant fel-/gränsfall.

**Förväntat:** Blanda inte olika PRODAT-funktioner i samma UNB–UNZ. → Batcha kompatibla objekt med gemensam aktör/profil/roll; tenantseparation som extra internt skydd.

**Förbjuden effekt:** Dela batchen; inte generisk multi-message-blandning.

**Regler:** ENV-07  
**Provnivå:** Planerat regelbeteendeprov  
**Status:** Inte körd mot systemet

## AT-ENV-08 · Regelkontrakt: ENV-08
**Givet:** PRODAT/UTILTS och UNB

**När:** Datumkodning – prova både uppfyllt villkor och relevant fel-/gränsfall.

**Förväntat:** Payload fast normaltid: P DTMZZZ=1:805, U DTM735=+0100:406; UNB lokal tid enligt regeln. → Lagra UTC plus originaloffset/format och affärsdatum; konvertera uttryckligt.

**Förbjuden effekt:** Använd inte sommartid för varje payloadperiod eller92/100 kvartar per fast-CET-dygn.

**Regler:** ENV-08  
**Provnivå:** Planerat regelbeteendeprov  
**Status:** Inte körd mot systemet

## AT-ENV-09 · Regelkontrakt: ENV-09
**Givet:** Alla familjer

**När:** Syntaxkontroll – prova både uppfyllt villkor och relevant fel-/gränsfall.

**Förväntat:** Nationella segmenttabeller kan utelämna senare ej använda element; full UNSM-grammatik krävs för riktig syntax-M/kardinalitet. → Versionera parsergrammatik separat från nationell fältanvändning.

**Förbjuden effekt:** En kort svensk tabell får inte bli falskt strikt UNECE-syntax.

**Regler:** ENV-09  
**Provnivå:** Planerat regelbeteendeprov  
**Status:** Inte körd mot systemet

## AT-P-01 · Regelkontrakt: P-01
**Givet:** Alla P

**När:** Fältkontroll – prova både uppfyllt villkor och relevant fel-/gränsfall.

**Förväntat:** 74 numeriska fält +3 parentgrupper;110bas-D-celler och registeroverlay hanteras uttryckligt. → Fältresultat bär riktigt fältnummer, grupp/komponent, objekt/ärende och källregel.

**Förbjuden effekt:** Inget fältnummer från regex över DTM/RFF-text.

**Regler:** P-01  
**Provnivå:** Planerat regelbeteendeprov  
**Status:** Inte körd mot systemet

## AT-P-02 · Regelkontrakt: P-02
**Givet:** Extra X/icke-tillämplig D

**När:** Giltig syntax och extra data – prova både uppfyllt villkor och relevant fel-/gränsfall.

**Förväntat:** Nationell extra information som ska ignoreras får inte utlösa negativ APERAK. → Ignorera för affärsprojektion; bevara råpayload.

**Förbjuden effekt:** Skilj verkligt för många syntaxelement från tillåtna men ej använda nationella fält.

**Regler:** P-02  
**Provnivå:** Planerat regelbeteendeprov  
**Status:** Inte körd mot systemet

## AT-P-03 · Regelkontrakt: P-03
**Givet:** D-villkor

**När:** Utgående profil – prova både uppfyllt villkor och relevant fel-/gränsfall.

**Förväntat:** Treutfall: sant/falskt/okänt; falskt kan vara O eller X enligt specifik notering. → Rfält fylls från auktoritativa fakta; Ofält enligt medvetet val.

**Förbjuden effekt:** Ingen blanketregel Dfalse=forbidden; saknad lokal fakta blockerar egen sändning.

**Regler:** P-03  
**Provnivå:** Planerat regelbeteendeprov  
**Status:** Inte körd mot systemet

## AT-P-04 · Regelkontrakt: P-04
**Givet:** Z14N/NAD

**När:** Fältkontroll – prova både uppfyllt villkor och relevant fel-/gränsfall.

**Förväntat:** Inaktiv grupp gör barnfälten icke-tillämpliga även om basmatrisen visarR. → Z14N kan vara giltig utan UD/IT/tillståndsid/positiva tillståndsfält.

**Förbjuden effekt:** Kräv inte land316 ellerIT233/234 utan grupp.

**Regler:** P-04  
**Provnivå:** Planerat regelbeteendeprov  
**Status:** Inte körd mot systemet

## AT-P-05 · Regelkontrakt: P-05
**Givet:** Z04/Z06/Z10

**När:** LIN-grupper behandlas – prova både uppfyllt villkor och relevant fel-/gränsfall.

**Förväntat:** 314ärglobaltsekvensnr;258registerindex per objekt; alla register och villkor enligt bilaga2. → Kontrollera registerspecifika kärnfält, ärv tillåten första-registerinformation.

**Förbjuden effekt:** Kopiera inte basmatrisens allaR till register2+; ignorera extra upprepade icke-styrande fält där guiden säger det.

**Regler:** P-05  
**Provnivå:** Planerat regelbeteendeprov  
**Status:** Inte körd mot systemet

## AT-P-06 · Regelkontrakt: P-06
**Givet:** Kund och anläggning

**När:** Render/validate – prova både uppfyllt villkor och relevant fel-/gränsfall.

**Förväntat:** NADUD SE1/SE2 kodlisteansvarig260 i aktuellprofil; Z13 använder inte födelsedatum som kund-id. → Bevara verifierad kundidentitet och skyddade-identitetsregler.

**Förbjuden effekt:** Ingen UUID-fallback/namngissning; ändra inte allaZZZglobalt.

**Regler:** P-06  
**Provnivå:** Planerat regelbeteendeprov  
**Status:** Inte körd mot systemet

## AT-P-07 · Regelkontrakt: P-07
**Givet:** Z13/Z14

**När:** Energi-id och rapportperiod – prova både uppfyllt villkor och relevant fel-/gränsfall.

**Förväntat:** Energiprodukt506 i andra7110; rapportstart90,slut91; detta är inte242aggregatprodukt eller avtals92/93. → CAV+::::energi-id, rätt DTM och faktisktLIN även utan objekt-id.

**Förbjuden effekt:** Saknad/feluppgift klassificeras perfält; referensexempel med positiv kvittens är inte automatisk norm.

**Regler:** P-07  
**Provnivå:** Planerat regelbeteendeprov  
**Status:** Inte körd mot systemet

## AT-P-08 · Regelkontrakt: P-08
**Givet:** Z09D

**När:** Start eller slut produktionsavtal – prova både uppfyllt villkor och relevant fel-/gränsfall.

**Förväntat:** 210 XOR211; inte216 i stället. → Bygg92eller93; vid giltig mottagning uppdatera rätt produktionsrelation.

**Förbjuden effekt:** Båda: P-APERAK40/109; ingen generell157.

**Regler:** P-08  
**Provnivå:** Planerat regelbeteendeprov  
**Status:** Inte körd mot systemet

## AT-P-09 · Regelkontrakt: P-09
**Givet:** Z06E/Z09E

**När:** Kundlivshändelse – prova både uppfyllt villkor och relevant fel-/gränsfall.

**Förväntat:** Fält310ärdödsfallsstatus; andraE34-fall behöver rätt process/överenskommelse. → Z09E inkluderarUD; Z06E gör bara behöriga och källstödda uppdateringar.

**Förbjuden effekt:** Konkurs ska inte automatiskt bli dödsfall; övrigaZ09ska inte fåUD.

**Regler:** P-09  
**Provnivå:** Planerat regelbeteendeprov  
**Status:** Inte körd mot systemet

## AT-P-10 · Regelkontrakt: P-10
**Givet:** Z01/Z02 i leverantörsrollen

**När:** Uppgiftskontroll – prova både uppfyllt villkor och relevant fel-/gränsfall.

**Förväntat:** Korrelera Z02 till Z01 med LI, parter, objekt, nätområde och kundidentitet. Z02 är inte en startbekräftelse. → Verifiera uppgifterna; gör därefter en separat prövning av om en Z03 ska skapas.

**Förbjuden effekt:** Ingen aktiv leverans och ingen automatisk Z03 utan återstående avtals- och datumkontroller.

**Regler:** P-10  
**Provnivå:** Planerat regelbeteendeprov  
**Status:** Inte körd mot systemet

## AT-P-11 · Regelkontrakt: P-11
**Givet:** Z03/Z04 av typen L eller LK

**När:** Bekräftelse av byte eller flytt – prova både uppfyllt villkor och relevant fel-/gränsfall.

**Förväntat:** Kontrollera rätt objekt, parter, LI, undertyp och datum. En giltig Z04 kan komma före positiv APERAK. → Registrera bekräftad framtida leverans; aktivera vid rätt tid om ärendet fortfarande är giltigt.

**Förbjuden effekt:** SMTP250, CONTRL, APERAK och Z02 räcker inte för aktivering. Sena kvittenser får inte backa ett giltigt affärstillstånd.

**Regler:** P-11  
**Provnivå:** Planerat regelbeteendeprov  
**Status:** Inte körd mot systemet

## AT-P-12 · Regelkontrakt: P-12
**Givet:** Z04A och Z04D

**När:** Anvisning eller mottagningsplikt – prova både uppfyllt villkor och relevant fel-/gränsfall.

**Förväntat:** Verifiera respektive roll, avtal, nätområde och produktionskoppling. → Använd en särskild transitionsprofil som inte kräver en vanlig egen Z03.

**Förbjuden effekt:** Kräv inte samma förutsättningar som Z04L, men kringgå inte de särskilda behörighetskraven.

**Regler:** P-12  
**Provnivå:** Planerat regelbeteendeprov  
**Status:** Inte körd mot systemet

## AT-P-13 · Regelkontrakt: P-13
**Givet:** Z05 och Z08

**När:** Leveransslut – prova både uppfyllt villkor och relevant fel-/gränsfall.

**Förväntat:** Matcha den leveransrelation och den tidshändelse som faktiskt avses. → Versionera slutet, bevara historiken och initiera relevant slutvärdes- och fakturauppföljning.

**Förbjuden effekt:** Radera inte kunden, andra anläggningar eller ESCO-grants.

**Regler:** P-13  
**Provnivå:** Planerat regelbeteendeprov  
**Status:** Inte körd mot systemet

## AT-P-14 · Regelkontrakt: P-14
**Givet:** Z03C, Z04C, Z05C och Z15C

**När:** Återtag – prova både uppfyllt villkor och relevant fel-/gränsfall.

**Förväntat:** Bind till rätt original. Hantera ordningsfel utan dubbel affärseffekt. → Gör endast den kancellering eller kompensation som hör till processen.

**Förbjuden effekt:** Skapa inte Z13C/Z14C och använd inte en generell C-variant för alla Z-funktioner.

**Regler:** P-14  
**Provnivå:** Planerat regelbeteendeprov  
**Status:** Inte körd mot systemet

## AT-P-15 · Regelkontrakt: P-15
**Givet:** Z06 och Z10

**När:** Giltig strukturändring – prova både uppfyllt villkor och relevant fel-/gränsfall.

**Förväntat:** Lagra giltighetstid och mottagningstid separat. En framtida leverantör kan behöva struktur före start. → Använd rätt mätare, register och produkt för varje tidsperiod.

**Förbjuden effekt:** Skriv inte över historiken i en enda global rad och dubbelräkna inte registerenergi.

**Regler:** P-15  
**Provnivå:** Planerat regelbeteendeprov  
**Status:** Inte körd mot systemet

## AT-P-16 · Regelkontrakt: P-16
**Givet:** Z08LK, Z03H, Z04H, Z05H, Z04A och andra E34-fall

**När:** Kapabilitetsprövning – prova både uppfyllt villkor och relevant fel-/gränsfall.

**Förväntat:** Kombinationen ska vara tillåten och omfattas av dokumenterad motpartsspecifik överenskommelse och implementation. → Aktivera bara avtalad omfattning och giltighet.

**Förbjuden effekt:** Ett globalt bilateral=true eller ett testgodkännande för annan aktör räcker inte.

**Regler:** P-16  
**Provnivå:** Planerat regelbeteendeprov  
**Status:** Inte körd mot systemet

## AT-P-17 · Regelkontrakt: P-17
**Givet:** PRODAT med LIN-grupper

**När:** Sekvenskontroll – prova både uppfyllt villkor och relevant fel-/gränsfall.

**Förväntat:** Första fält 314 ska vara 1 och följande nummer ska vara obrutet stigande. → Fortsätt genom samtliga relevanta objekt och register.

**Förbjuden effekt:** Avvisa hela meddelandet med P-APERAK BGM27 och relevant felinformation; tolka inte sekvensfelet som fel anläggnings-id.

**Regler:** P-17  
**Provnivå:** Planerat regelbeteendeprov  
**Status:** Inte körd mot systemet

## AT-ESCO-01 · Regelkontrakt: ESCO-01
**Givet:** Z13

**När:** Ny rättighetsbegäran – prova både uppfyllt villkor och relevant fel-/gränsfall.

**Förväntat:** Verifiera legal DGI-aktör, slutkundsavtal, DSO-avtal och avsedd omfattning av objekt, period, produkter och ändamål. → Skapa väntande begäran, knyt service_assignment och skicka rätt V/VH.

**Förbjuden effekt:** Ett avtal med beneficiary-tenant ger inte ensamt rätt till kundens mätvärden.

**Regler:** ESCO-01  
**Provnivå:** Planerat regelbeteendeprov  
**Status:** Inte körd mot systemet

## AT-ESCO-02 · Regelkontrakt: ESCO-02
**Givet:** Z13V respektive Z13VH

**När:** Rapportperiod väljs – prova både uppfyllt villkor och relevant fel-/gränsfall.

**Förväntat:** V är löpande och VH avgränsad historik. Pröva treårsgräns och relevant nätavtalsperiod; VH kräver slutdatum. → Behåll separata processer, timers och samordning av rättigheter.

**Förbjuden effekt:** Använd inte VH för löpande rapportering och anta inte att slutkundens godkännande redan finns.

**Regler:** ESCO-02  
**Provnivå:** Planerat regelbeteendeprov  
**Status:** Inte körd mot systemet

## AT-ESCO-03 · Regelkontrakt: ESCO-03
**Givet:** Positiv APERAK på Z13

**När:** Kvittens tas emot – prova både uppfyllt villkor och relevant fel-/gränsfall.

**Förväntat:** Kvittensen godkänner att begäran behandlas, inte slutkundens medgivande. → Sätt awaiting_customer_decision och bevaka Z14/Z14N.

**Förbjuden effekt:** Skapa varken market_permission eller aktiv elleverans enbart från APERAK.

**Regler:** ESCO-03  
**Provnivå:** Planerat regelbeteendeprov  
**Status:** Inte körd mot systemet

## AT-ESCO-04 · Regelkontrakt: ESCO-04
**Givet:** Z14V/Z14VH

**När:** Positivt affärssvar – prova både uppfyllt villkor och relevant fel-/gränsfall.

**Förväntat:** A74 och rätt LI, aktör och kund. Föreskrivna objekt-, adress-, tillstånds- och perioduppgifter ska stämma. Bara godkända objekt omfattas. → Skapa avgränsat market_permission; anslut därefter separat godkänd intern distribution.

**Förbjuden effekt:** Bredda inte till samtliga kundens anläggningar eller andra tenants från ett godkänt objekt.

**Regler:** ESCO-04  
**Provnivå:** Planerat regelbeteendeprov  
**Status:** Inte körd mot systemet

## AT-ESCO-05 · Regelkontrakt: ESCO-05
**Givet:** Z14N

**När:** Aktivt eller passivt nekande – prova både uppfyllt villkor och relevant fel-/gränsfall.

**Förväntat:** A13 anger aktivt och A76 passivt nekande. Ett korrekt negativt affärssvar är inte ett protokollfel. → Neka berörd begäran och informera ansvarig utan att exponera andra tenants.

**Förbjuden effekt:** Skapa inte tillstånd eller negativ APERAK enbart för att nätägaren nekar begäran.

**Regler:** ESCO-05  
**Provnivå:** Planerat regelbeteendeprov  
**Status:** Inte körd mot systemet

## AT-ESCO-06 · Regelkontrakt: ESCO-06
**Givet:** Nya objekt under pågående Z13-begäran

**När:** Ny Z13 önskas – prova både uppfyllt villkor och relevant fel-/gränsfall.

**Förväntat:** Koordinera samma aktör, kund och DSO. Tillkommande objekt kan kräva ny begäran; upprepning bedöms enligt Handboken, inte ett universellt negativt APERAK. → Tillåt en relevant ny begäran med spårbar koppling till tidigare förlopp.

**Förbjuden effekt:** Inför inte ett generellt förbud mot varje ny Z13 före 21 dagar och kringgå inte reglerna genom ett nytt internt tenant-id.

**Regler:** ESCO-06  
**Provnivå:** Planerat regelbeteendeprov  
**Status:** Inte körd mot systemet

## AT-ESCO-07 · Regelkontrakt: ESCO-07
**Givet:** Z15V/Z15VH

**När:** Upphörande eller historikslut – prova både uppfyllt villkor och relevant fel-/gränsfall.

**Förväntat:** Tillstånd, orsak, tidpunkt och process ska vara kända och överensstämmande. → Avsluta bara berört marknadstillstånd eller historikjobb; bevara andra separata rättigheter.

**Förbjuden effekt:** Historikslut får inte upphäva ett separat V-tillstånd. DDQ-leverans ska vara oförändrad.

**Regler:** ESCO-07  
**Provnivå:** Planerat regelbeteendeprov  
**Status:** Inte körd mot systemet

## AT-ESCO-08 · Regelkontrakt: ESCO-08
**Givet:** Z18V

**När:** Begäran om avslut – prova både uppfyllt villkor och relevant fel-/gränsfall.

**Förväntat:** Behörig aktör ska avse rätt market_permission. Samordna beroenden från flera beneficiary-uppdrag. → Skicka fält 327/324/325 och bevaka Z15. Begränsa intern åtkomst enligt aktuellt mandat.

**Förbjuden effekt:** Säg inte upp ett gemensamt tillstånd på ett enskilt UI-klick utan kontroll av andra giltiga uppdrag.

**Regler:** ESCO-08  
**Provnivå:** Planerat regelbeteendeprov  
**Status:** Inte körd mot systemet

## AT-ESCO-09 · Regelkontrakt: ESCO-09
**Givet:** Z15C

**När:** Tidigare upphörande återtas – prova både uppfyllt villkor och relevant fel-/gränsfall.

**Förväntat:** Kontrollera rätt ursprung och källstödda återställningsvillkor. → Återställ marknadsrelationen; ompröva varje downstream-grant självständigt.

**Förbjuden effekt:** Återuppliva inte utgångna kundavtal eller uttryckligen återkallade tenantbehörigheter.

**Regler:** ESCO-09  
**Provnivå:** Planerat regelbeteendeprov  
**Status:** Inte körd mot systemet

## AT-ESCO-10 · Regelkontrakt: ESCO-10
**Givet:** E66 i DGI-rollen

**När:** Mätvärden tas emot – prova både uppfyllt villkor och relevant fel-/gränsfall.

**Förväntat:** E66 kan sakna direkt tillstånds-id. Matcha juridisk relation, objekt, produkt, period och giltig tillstånds-/grantkoppling. → Lagra mottagningsbevis och distribuera endast till uttryckligen berättigade tenants.

**Förbjuden effekt:** Kräv inte ett påhittat permission-fält i E66. Matcha inte enbart på GSRN eller SMTP-adress.

**Regler:** ESCO-10  
**Provnivå:** Planerat regelbeteendeprov  
**Status:** Inte körd mot systemet

## AT-ESCO-11 · Regelkontrakt: ESCO-11
**Givet:** Intern vidareanvändning av E66-DGI

**När:** Data används i annan tjänst – prova både uppfyllt villkor och relevant fel-/gränsfall.

**Förväntat:** Tillåtet ändamål, rättslig/datamässig grund och processtillämplighet ska verifieras uttryckligen. → Bevara originalets DGI-roll, avsändare, kvalitet och syfte i varje härledd projektion.

**Förbjuden effekt:** Skriv inte om DGI till DDQ och skapa inte en falsk E66 från nätägaren för att passa faktureringen.

**Regler:** ESCO-11  
**Provnivå:** Planerat regelbeteendeprov  
**Status:** Inte körd mot systemet

## AT-ACK-01 · Regelkontrakt: ACK-01
**Givet:** Alla inkommande EDIFACT utom CONTRL

**När:** Syntaxresultat finns – prova både uppfyllt villkor och relevant fel-/gränsfall.

**Förväntat:** Använd CONTRL:2:2:UN och resultatkod 1/4 på rätt korrelationsnivå. → Larma vid negativt resultat och undvik kvittensloop.

**Förbjuden effekt:** Lägg inte nationell APERAK-kontroll i CONTRL.

**Regler:** ACK-01  
**Provnivå:** Planerat regelbeteendeprov  
**Status:** Inte körd mot systemet

## AT-ACK-02 · Regelkontrakt: ACK-02
**Givet:** APERAK på PRODAT

**När:** Applikationsresultat finns – prova både uppfyllt villkor och relevant fel-/gränsfall.

**Förväntat:** D96A/E2SE6A; BGM27 för avvisat helt meddelande eller 34 för behandlat; ERC40/41/42/100 och ACW till originalets BGM-id. → Bygg RFF+Z07/LI när uppgifterna finns och korrekt fält- eller särskild felreferens.

**Förbjuden effekt:** Använd inte UTILTS-APERAK:s BGM312/313 eller dess transaktions-ACW för PRODAT.

**Regler:** ACK-02  
**Provnivå:** Planerat regelbeteendeprov  
**Status:** Inte körd mot systemet

## AT-ACK-03 · Regelkontrakt: ACK-03
**Givet:** APERAK på UTILTS

**När:** Anvisnings-/funktionsutfall finns – prova både uppfyllt villkor och relevant fel-/gränsfall.

**Förväntat:** D04A/E5SE5A; BGM312 positivt eller313 negativt; DOC till originaltyp/BGM, DM för eget transaktions-id och ACW till originalets IDE-id. → Håll positiva och negativa transaktioner i skilda APERAK. Ange inte påhittad IDE-referens vid huvudfel.

**Förbjuden effekt:** Använd inte PRODAT-BGM34 eller generiska ERC40-specialkoder utan stöd i UTILTS-guiden.

**Regler:** ACK-03  
**Provnivå:** Planerat regelbeteendeprov  
**Status:** Inte körd mot systemet

## AT-ACK-04 · Regelkontrakt: ACK-04
**Givet:** UTILTS-APERAK ERC/FTX

**När:** Svar byggs – prova både uppfyllt villkor och relevant fel-/gränsfall.

**Förväntat:** ERC100 ger OK; 41 ger MANDATORY FIELD MISSING; 42 ger INCORRECT DATA XXX. Riktig fältreferens krävs vid41/42. → Bygg exakt referens och korrekt frisläppning; begränsa känsliga uppgifter i loggar.

**Förbjuden effekt:** Härled inte ett fältnummer ur siffrorna i ett segmentnamn.

**Regler:** ACK-04  
**Provnivå:** Planerat regelbeteendeprov  
**Status:** Inte körd mot systemet

## AT-ACK-05 · Regelkontrakt: ACK-05
**Givet:** UTILTS-ERR

**När:** Godkänd anvisningskontroll men funktionsfel – prova både uppfyllt villkor och relevant fel-/gränsfall.

**Förväntat:** Wirefamiljen är UTILTS med BGM ERR. Referera rätt originaltyp, BGM-id och transaktions-id samt avvisningsorsak. → Begär föreskriven APERAK och CONTRL på ERR; följ ERR:s egna fältvillkor.

**Förbjuden effekt:** Skapa inte ERR på ERR eller APERAK på APERAK.

**Regler:** ACK-05  
**Provnivå:** Planerat regelbeteendeprov  
**Status:** Inte körd mot systemet

## AT-ACK-06 · Regelkontrakt: ACK-06
**Givet:** Mottagna kvittenser

**När:** CONTRL/APERAK tas emot – prova både uppfyllt villkor och relevant fel-/gränsfall.

**Förväntat:** Bind föreskrivna referenser tillsammans med parter, marknad, roll, miljö och ursprungsfamilj. → Uppdatera endast rätt kvitterade delar och deras delstatus.

**Förbjuden effekt:** UCI, ACW eller LI utan aktörsscope får inte kopplas till en annan tenant.

**Regler:** ACK-06  
**Provnivå:** Planerat regelbeteendeprov  
**Status:** Inte körd mot systemet

## AT-ACK-07 · Regelkontrakt: ACK-07
**Givet:** Redan kvitterat objekt/transaktion

**När:** Senare kontroll upptäcker annat fel – prova både uppfyllt villkor och relevant fel-/gränsfall.

**Förväntat:** Ändra inte ett slutligt kvittensutfall genom att skicka motsatt APERAK på samma objekt/transaktion. → Skapa incident och föreskriven kontakt; använd rätt rättelseprocess för ett nytt meddelande.

**Förbjuden effekt:** Gör inte rollback följt av motsatt APERAK bara på grund av ett internt återförsök.

**Regler:** ACK-07  
**Provnivå:** Planerat regelbeteendeprov  
**Status:** Inte körd mot systemet

## AT-ACK-08 · Regelkontrakt: ACK-08
**Givet:** Flera objekt/transaktioner

**När:** En del är fel – prova både uppfyllt villkor och relevant fel-/gränsfall.

**Förväntat:** PRODAT och UTILTS har skilda svarsstrukturer; huvudfel och delutfall separeras. → Mutera och kvittera rätt omfattning. UTILTS positiva/negativa svar hålls åtskilda.

**Förbjuden effekt:** Låt inte global hasFunctionalError välja en felklass för alla transaktioner.

**Regler:** ACK-08  
**Provnivå:** Planerat regelbeteendeprov  
**Status:** Inte körd mot systemet

## AT-ACK-09 · Regelkontrakt: ACK-09
**Givet:** Återleverans och dubbletter

**När:** Inkommande identitet finns redan – prova både uppfyllt villkor och relevant fel-/gränsfall.

**Förväntat:** Skilj intern återkörning av sparad mottagning från en ny mottagen protokolldubblett. → Undvik dubbla affärseffekter och ge det protokollföreskrivna dubblettsvaret.

**Förbjuden effekt:** Idempotens får inte innebära att kvittenspliktig mottagning bara slängs tyst.

**Regler:** ACK-09  
**Provnivå:** Planerat regelbeteendeprov  
**Status:** Inte körd mot systemet

## AT-U-01 · Regelkontrakt: U-01
**Givet:** E66, S02, E31, S05 och requests

**När:** Profil väljs – prova både uppfyllt villkor och relevant fel-/gränsfall.

**Förväntat:** Objektvärden, prognoser, aggregat och requests är uttryckligen skilda. Kontrollera aktuell roll, inte alltid en Supplier-gate. → Tillåt stödd roll, funktion, riktning och produkt med rätt bevis.

**Förbjuden effekt:** Parserstöd eller en exempel-E66 ger inte rätt att sända nätägarens E66 i produktion.

**Regler:** U-01  
**Provnivå:** Planerat regelbeteendeprov  
**Status:** Inte körd mot systemet

## AT-U-02 · Regelkontrakt: U-02
**Givet:** Samtliga UTILTS

**När:** Parsning – prova både uppfyllt villkor och relevant fel-/gränsfall.

**Förväntat:** Bevara huvud, SG5/IDE-transaktion och SEQ-observation samt varje upprepad grupp. → En disposition per ursprungstransaktion; mätarställningar och energier separata.

**Förbjuden effekt:** Använd inte första LOC eller QTY i hela filen för samtliga objekt.

**Regler:** U-02  
**Provnivå:** Planerat regelbeteendeprov  
**Status:** Inte körd mot systemet

## AT-U-03 · Regelkontrakt: U-03
**Givet:** Samtliga UTILTS

**När:** Validering – prova både uppfyllt villkor och relevant fel-/gränsfall.

**Förväntat:** Syntax följs av huvudets anvisningskontroll, transaktionens anvisningskontroll och därefter funktionskontroll endast för godkänd transaktion. → Lagra godkända transaktioner och kvittera varje utfall på rätt nivå.

**Förbjuden effekt:** Ett guidefel för samma IDE får inte ersättas av ett senare E10/E50-funktionsfel.

**Regler:** U-03  
**Provnivå:** Planerat regelbeteendeprov  
**Status:** Inte körd mot systemet

## AT-U-04 · Regelkontrakt: U-04
**Givet:** Äldre men i övrigt giltiga mätdata

**När:** Sen leverans – prova både uppfyllt villkor och relevant fel-/gränsfall.

**Förväntat:** Ankomstordning ensam är inte avvisningsskäl. Använd registrerings-/uppdateringstid 512/532 för dataversionen. → Sänd positiv APERAK när andra kontroller passerar och bevara äldre historik utan att skriva över nyare data.

**Förbjuden effekt:** Skapa inte ERR eller retroaktiv fakturaändring enbart för att data anländer sent.

**Regler:** U-04  
**Provnivå:** Planerat regelbeteendeprov  
**Status:** Inte körd mot systemet

## AT-U-05 · Regelkontrakt: U-05
**Givet:** E66 i DGI-rollen

**När:** Periodisk rapportering – prova både uppfyllt villkor och relevant fel-/gränsfall.

**Förväntat:** Anledning ska vara E23, inte E88, om inte annat är uttryckligen överenskommet. → Kontrollera roll, Application Reference, underordnad roll och behörigheter.

**Förbjuden effekt:** Påför inte en global E88-fakturaprofil på DGI-trafik.

**Regler:** U-05  
**Provnivå:** Planerat regelbeteendeprov  
**Status:** Inte körd mot systemet

## AT-U-06 · Regelkontrakt: U-06
**Givet:** E73 och E74

**När:** Saknade värden identifieras – prova både uppfyllt villkor och relevant fel-/gränsfall.

**Förväntat:** Application Reference avser begärd S02/E66 respektive S03/E31. Objekt/områden, parter, produkt och period ska motsvara begäran. → Skicka bara behörig request med tillämplig överenskommelse och bevaka resultatet.

**Förbjuden effekt:** Bygg inte en generell 23-DGI-E73-referens och begär inte all data utan mandat.

**Regler:** U-06  
**Provnivå:** Planerat regelbeteendeprov  
**Status:** Inte körd mot systemet

## AT-U-07 · Regelkontrakt: U-07
**Givet:** S06, S08, E30, S01 och S04

**När:** Kapabilitet prövas – prova både uppfyllt villkor och relevant fel-/gränsfall.

**Förväntat:** S06 är inte i bruk, S08 är avvecklat och andra profiler kräver andra roller än standard-DDQ/DGI. → Håll historiska/diagnostiska adaptrar åtskilda från produktionsfunktioner.

**Förbjuden effekt:** Giltig syntax innebär inte tillåten marknadsriktning.

**Regler:** U-07  
**Provnivå:** Planerat regelbeteendeprov  
**Status:** Inte körd mot systemet

## AT-U-08 · Regelkontrakt: U-08
**Givet:** E66 med mätare/register

**När:** Funktionskontroll – prova både uppfyllt villkor och relevant fel-/gränsfall.

**Förväntat:** Kontrollera mot faktiskt erhållen strukturinformation för perioden. ESCO-Z14 innehåller inte nödvändigtvis hela mätarstrukturen. → Hantera eget strukturbevisgap internt när kontrollen är villkorad enligt guiden.

**Förbjuden effekt:** Kräv inte hela leverantörens PRODAT-struktur av varje ESCO-mottagare.

**Regler:** U-08  
**Provnivå:** Planerat regelbeteendeprov  
**Status:** Inte körd mot systemet

## AT-U-09 · Regelkontrakt: U-09
**Givet:** Mätvärdesobservationer

**När:** Lagring och fakturaunderlag – prova både uppfyllt villkor och relevant fel-/gränsfall.

**Förväntat:** NULL/saknat, noll, tecken, ställning, energi, effekt, kvalitet och upplösning är olika typer. → Lagra decimaler och källkvalitet exakt med korrektionsspår.

**Förbjuden effekt:** Fyll inte saknade värden med noll och använd inte årsprognos som faktisk kvartsenergi.

**Regler:** U-09  
**Provnivå:** Planerat regelbeteendeprov  
**Status:** Inte körd mot systemet

## AT-U-10 · Regelkontrakt: U-10
**Givet:** Period 245 och upplösning508

**När:** Periodvalidering – prova både uppfyllt villkor och relevant fel-/gränsfall.

**Förväntat:** Beräkna intervall från faktisk period, produkt och fast tidszon. En kalendermånad är inte alltid30 dygn. → Ett fullständigt24h-dygn i+CET har96 kvartar; andra perioder räknas uttryckligt.

**Förbjuden effekt:** Hårdkoda inte96 för varje serie och använd inte energisumma som bevis på fullständighet.

**Regler:** U-10  
**Provnivå:** Planerat regelbeteendeprov  
**Status:** Inte körd mot systemet

## AT-U-11 · Regelkontrakt: U-11
**Givet:** UTILTS25-A-4

**När:** Datumstyrd aktivering – prova både uppfyllt villkor och relevant fel-/gränsfall.

**Förväntat:** E19 och ställnings-/energijämförelsen utgår. Energivärdeskontroller E97/E98/E90 avgränsas enligt guiden till E30/aggregat. → Behåll obligatoriska fält, E87 och övriga tillämpliga kontroller oberoende av ändringen.

**Förbjuden effekt:** En ofullständig kvartserie blir inte korrekt bara för att E19 försvinner.

**Regler:** U-11  
**Provnivå:** Planerat regelbeteendeprov  
**Status:** Inte körd mot systemet

## AT-U-12 · Regelkontrakt: U-12
**Givet:** UTILTS-batch

**När:** Paketering – prova både uppfyllt villkor och relevant fel-/gränsfall.

**Förväntat:** Anledning till transaktionen är samma i meddelandet. Mätarbyte och olika skeden kan kräva separata underlag. → Dela endast kompatibla grupper och bevara referenser och periodtäckning.

**Förbjuden effekt:** Blanda inte E23/E88 bara för att anläggningen är densamma.

**Regler:** U-12  
**Provnivå:** Planerat regelbeteendeprov  
**Status:** Inte körd mot systemet

## AT-U-13 · Regelkontrakt: U-13
**Givet:** UTILTS-BGM

**När:** Huvud byggs eller läses – prova både uppfyllt villkor och relevant fel-/gränsfall.

**Förväntat:** Skicka funktionskod9; ta emot5 utan avvisning enbart därför. Skicka AB; NA ensam är inte avvisningsgrund. → Håll mottagningstolerans skild från utgående profil.

**Förbjuden effekt:** Inför inte egna fel för värden guiden kräver att mottagaren kan hantera.

**Regler:** U-13  
**Provnivå:** Planerat regelbeteendeprov  
**Status:** Inte körd mot systemet

## AT-U-14 · Regelkontrakt: U-14
**Givet:** Positiv APERAK på UTILTS

**När:** Svar planeras – prova både uppfyllt villkor och relevant fel-/gränsfall.

**Förväntat:** Godkänd affärsbehandling och beständig lagring ska vara klara före extern positiv APERAK. → Gör atomär lagring av accepterad data, disposition och ACK-avsikt.

**Förbjuden effekt:** Kölagt eller bara mottaget är inte bevis på lagrade mätvärden.

**Regler:** U-14  
**Provnivå:** Planerat regelbeteendeprov  
**Status:** Inte körd mot systemet

## AT-TR-01 · Regelkontrakt: TR-01
**Givet:** Edieltrafik respektive applikationsmejl

**När:** Sändning – prova både uppfyllt villkor och relevant fel-/gränsfall.

**Förväntat:** PRODAT använder SMTP/MIME/S-MIME enligt register och säkerhetsprofil. Resend-kundmejl är en separat kanal utan tyst fallback. → Använd konfigurerad Edieltransport och rätt motpart.

**Förbjuden effekt:** Skicka inte bytesfiler till Edielportalens testmottagare i produktion.

**Regler:** TR-01  
**Provnivå:** Planerat regelbeteendeprov  
**Status:** Inte körd mot systemet

## AT-TR-02 · Regelkontrakt: TR-02
**Givet:** SMTP-försök

**När:** 250/4xx/5xx/timeout – prova både uppfyllt villkor och relevant fel-/gränsfall.

**Förväntat:** SMTP-acceptans, slutlig transportleverans, CONTRL, APERAK och affärssvar är separata observationer. → Spara kö-id, SMTP-status, RFC Message-ID, payloadhash och exakt försök.

**Förbjuden effekt:** Låt inte sent betyda leveransaktiv. Okänt sändningsutfall ska förbli uttryckligen okänt.

**Regler:** TR-02  
**Provnivå:** Planerat regelbeteendeprov  
**Status:** Inte körd mot systemet

## AT-TR-03 · Regelkontrakt: TR-03
**Givet:** MIME-arkiv

**När:** Före första sändning – prova både uppfyllt villkor och relevant fel-/gränsfall.

**Förväntat:** En stabil RFC Message-ID ska finnas i innehållet. Bevara exakta rå-EML-byte i skyddat arkiv. → Lagra provider-id separat och sammanhåll identiteterna.

**Förbjuden effekt:** Spara inte enbart förhandsvisning eller en pseudoreferens utan hämtningsbart innehåll.

**Regler:** TR-03  
**Provnivå:** Planerat regelbeteendeprov  
**Status:** Inte körd mot systemet

## AT-TR-04 · Regelkontrakt: TR-04
**Givet:** SMTP-returbrev

**När:** Inkommande e-post – prova både uppfyllt villkor och relevant fel-/gränsfall.

**Förväntat:** Klassificera multipart/report och delivery-status före EDIFACT-utdrag. → Knyt Final-Recipient, Action, Status, Diagnostic-Code och originalidentiteter till rätt försök.

**Förbjuden effekt:** En inbäddad originalfil får inte skapa ett nytt inkommande affärsärende.

**Regler:** TR-04  
**Provnivå:** Planerat regelbeteendeprov  
**Status:** Inte körd mot systemet

## AT-TR-05 · Regelkontrakt: TR-05
**Givet:** PRODAT-omsändning/rättelse

**När:** Fel eller timeout – prova både uppfyllt villkor och relevant fel-/gränsfall.

**Förväntat:** Omsändning tillåts vid verifierad överföringsförlust. Negativ CONTRL medför rättelse av hela meddelandet; negativ APERAK följer särskild rättelse med nytt BGM-id. → Bevara lineage och pröva aktuell anvisning på nytt.

**Förbjuden effekt:** En utgången timer ensam är inget tillstånd till automatisk ny sändning.

**Regler:** TR-05  
**Provnivå:** Planerat regelbeteendeprov  
**Status:** Inte körd mot systemet

## AT-TR-06 · Regelkontrakt: TR-06
**Givet:** Mottagarcertifikat

**När:** Före sändning – prova både uppfyllt villkor och relevant fel-/gränsfall.

**Förväntat:** Kontrollera exakta giltighetsgränser, status, ändamål och ägarscope mot verklig teknisk/juridisk rutt. → Verifiera kedja och spärrpolicy med samma guard för direkt id-val och kandidatsökning.

**Förbjuden effekt:** Utgånget, spärrat eller ännu inte giltigt certifikat får inte passera genom dagsavrundning.

**Regler:** TR-06  
**Provnivå:** Planerat regelbeteendeprov  
**Status:** Inte körd mot systemet

## AT-TR-07 · Regelkontrakt: TR-07
**Givet:** Överlappande certifikat

**När:** S/MIME byggs – prova både uppfyllt villkor och relevant fel-/gränsfall.

**Förväntat:** Följ anvisningens fler-certifikatfall inom korrekt mottagarscope. → Kryptera för de giltiga mottagarcertifikat som regeln kräver.

**Förbjuden effekt:** Välj inte slumpmässigt bara det senast registrerade certifikatet.

**Regler:** TR-07  
**Provnivå:** Planerat regelbeteendeprov  
**Status:** Inte körd mot systemet

## AT-TR-08 · Regelkontrakt: TR-08
**Givet:** SMTP-reläer

**När:** Kommunikation – prova både uppfyllt villkor och relevant fel-/gränsfall.

**Förväntat:** Verifiera relä-TLS och SPF. TLS till första servern bevisar inte nästa serverhopp. → Kontrollera providerpolicy och verkligt leveransspår.

**Förbjuden effekt:** Deklarera inte hela transporten verifierad bara för att port465 kan nås.

**Regler:** TR-08  
**Provnivå:** Planerat regelbeteendeprov  
**Status:** Inte körd mot systemet

## AT-TR-09 · Regelkontrakt: TR-09
**Givet:** Tillfälligt krypterings-/CRLproblem

**När:** Reservförfarande prövas – prova både uppfyllt villkor och relevant fel-/gränsfall.

**Förväntat:** Endast uttryckligen specificerade undantagsfall i T får användas med respektive villkor/larm och fortsatt obligatorisk TLS. → Skapa separat avvikelsejournal och avgränsad driftåtgärd.

**Förbjuden effekt:** Ingen generell switch för oskyddad trafik och inga påhittade undantag.

**Regler:** TR-09  
**Provnivå:** Planerat regelbeteendeprov  
**Status:** Inte körd mot systemet

## AT-TR-10 · Regelkontrakt: TR-10
**Givet:** Köjobb och krasch

**När:** Jobbstart, timeout eller leasebyte – prova både uppfyllt villkor och relevant fel-/gränsfall.

**Förväntat:** SMTP och DB är inte atomiska. Använd lease/fencing och särskilt unknown_after_submission. → Försök igen endast när det säkert inte skickats eller föreskrivet beslut finns; spåra okända utfall.

**Förbjuden effekt:** Lova inte exakt-en-gång över SMTP och gör inte rekursiva blind-retries.

**Regler:** TR-10  
**Provnivå:** Planerat regelbeteendeprov  
**Status:** Inte körd mot systemet

## AT-TR-11 · Regelkontrakt: TR-11
**Givet:** Skickat-mappen

**När:** Administrativ inspektion – prova både uppfyllt villkor och relevant fel-/gränsfall.

**Förväntat:** En Skickat-kopia är en separat IMAP-/arkivfunktion. → Använd transportjournalen som beviskälla; erbjud kopia som driftfunktion.

**Förbjuden effekt:** En tom mapp ska inte utlösa omsändning eller betraktas som bevis på förlust.

**Regler:** TR-11  
**Provnivå:** Planerat regelbeteendeprov  
**Status:** Inte körd mot systemet

## AT-AI-01 · Regelkontrakt: AI-01
**Givet:** AI-lista

**När:** Fil skapas eller läses – prova både uppfyllt villkor och relevant fel-/gränsfall.

**Förväntat:** Använd separat semikolonformat Ver20140401, CSV från 2025-10-01 och huvud med nätföretag först/elhandelsföretag sedan. → Identifiera format och behörig avstämningsomfattning före bearbetning.

**Förbjuden effekt:** Skapa inte EDIFACT-kvittenser på en AI-fil.

**Regler:** AI-01  
**Provnivå:** Planerat regelbeteendeprov  
**Status:** Inte körd mot systemet

## AT-AI-02 · Regelkontrakt: AI-02
**Givet:** Utgående AI från elhandelsföretag

**När:** Detaljrader byggs – prova både uppfyllt villkor och relevant fel-/gränsfall.

**Förväntat:** Lämna mätarnummer, avräkningsmetod, årsenergi, rapporteringsfrekvens, mätmetod och produktkod tomma. → Fyll övriga tillämpliga verifierade marknads-/kunduppgifter och avslutande semikolon.

**Förbjuden effekt:** Interna UUID eller site_name får inte ersätta kund-id eller kundnamn.

**Regler:** AI-02  
**Provnivå:** Planerat regelbeteendeprov  
**Status:** Inte körd mot systemet

## AT-AI-03 · Regelkontrakt: AI-03
**Givet:** AI-listans periodurval

**När:** Historik projiceras – prova både uppfyllt villkor och relevant fel-/gränsfall.

**Förväntat:** Ta med alla relevanta anläggningar under [från,till). Delperioder och strukturändringar ger flera detaljrader. → Sortera objektrader i tid med tomt från först och tomt till sist. Skilj sökperiod från detaljens giltighet.

**Förbjuden effekt:** Endast dagens aktiva objekt eller ett enda värde per kund är inte tillräckligt.

**Regler:** AI-03  
**Provnivå:** Planerat regelbeteendeprov  
**Status:** Inte körd mot systemet

## AT-AI-04 · Regelkontrakt: AI-04
**Givet:** Inkommande AI

**När:** Avvikelse upptäcks – prova både uppfyllt villkor och relevant fel-/gränsfall.

**Förväntat:** Listan är avstämningsunderlag, inte ett automatiskt masterdatafacit. → Skapa utredningspost med källbevis; en senare ändring får en egen behörig process.

**Förbjuden effekt:** Uppdatera inte kund, objekt eller BRP direkt från listan.

**Regler:** AI-04  
**Provnivå:** Planerat regelbeteendeprov  
**Status:** Inte körd mot systemet

## AT-AI-05 · Regelkontrakt: AI-05
**Givet:** BI i DDQ/DGI-plattform

**När:** Export begärs – prova både uppfyllt villkor och relevant fel-/gränsfall.

**Förväntat:** BI används enbart av nätföretag för angivna strukturändringar. → Stöd behörig mottagning/utredning; spärra utgående BI i DDQ/DGI.

**Förbjuden effekt:** Känd CSV-struktur ger ingen marknadsbehörighet.

**Regler:** AI-05  
**Provnivå:** Planerat regelbeteendeprov  
**Status:** Inte körd mot systemet

## AT-DB-01 · Regelkontrakt: DB-01
**Givet:** Affärsdata och protokolljournal

**När:** Schema ändras – prova både uppfyllt villkor och relevant fel-/gränsfall.

**Förväntat:** Identifiera befintlig auktoritativ tabell för varje uppgift innan något nytt skapas. → Utöka med expand, backfill, validate och först därefter contract.

**Förbjuden effekt:** Skapa inte parallella kund-, regel- eller ruttauktoriteter.

**Regler:** DB-01  
**Provnivå:** Planerat regelbeteendeprov  
**Status:** Inte körd mot systemet

## AT-DB-02 · Regelkontrakt: DB-02
**Givet:** Tenantägda relationer

**När:** Insert/update – prova både uppfyllt villkor och relevant fel-/gränsfall.

**Förväntat:** Verifiera tenant+id-referenser, unika idempotensnycklar och tillämpliga datum-/aktörsrelationer. → Förhindra korskoppling och motstridiga aktiva perioder med constraints/RPC.

**Förbjuden effekt:** Frontendvalidering och ett UUID utan kontroll av parent räcker inte.

**Regler:** DB-02  
**Provnivå:** Planerat regelbeteendeprov  
**Status:** Inte körd mot systemet

## AT-DB-03 · Regelkontrakt: DB-03
**Givet:** Mät- och strukturrättelser

**När:** Godkänd ändring lagras – prova både uppfyllt villkor och relevant fel-/gränsfall.

**Förväntat:** Bevara giltighetsperiod, registreringstid, mottagningstid och källmeddelande/IDE/regelbeslut. → Skapa ny version och daterad projektion.

**Förbjuden effekt:** Förlora inte historiken eller ändra fastställt fakturaunderlag osynligt.

**Regler:** DB-03  
**Provnivå:** Planerat regelbeteendeprov  
**Status:** Inte körd mot systemet

## AT-DB-04 · Regelkontrakt: DB-04
**Givet:** Index och frågor

**När:** Migration/prestandaprov – prova både uppfyllt villkor och relevant fel-/gränsfall.

**Förväntat:** Utgå från faktiska urval för tenant/aktör, status/tidsfrist, referenser, objekt/period/version och foreign keys. → Verifiera planer och belastning med EXPLAIN och representativ data.

**Förbjuden effekt:** Index på alla kolumner ersätter inte en mätt prestandaplan.

**Regler:** DB-04  
**Provnivå:** Planerat regelbeteendeprov  
**Status:** Inte körd mot systemet

## AT-DB-05 · Regelkontrakt: DB-05
**Givet:** Kund, tenant eller uppdrag avslutas

**När:** Raderingsbegäran – prova både uppfyllt villkor och relevant fel-/gränsfall.

**Förväntat:** Skilj operativ avveckling, åtkomstrevoke, persondatagallring och skyldighet att bevara journal/avräkningsunderlag. → Använd en beslutad workflow per retentionklass och behörigt underlag.

**Förbjuden effekt:** Radera inte all historik med CASCADE och spara inte allt för alltid utan rättslig grund.

**Regler:** DB-05  
**Provnivå:** Planerat regelbeteendeprov  
**Status:** Inte körd mot systemet

## AT-DB-06 · Regelkontrakt: DB-06
**Givet:** Fakturaunderlag i leverantörsrollen

**När:** Underlag fastställs – prova både uppfyllt villkor och relevant fel-/gränsfall.

**Förväntat:** Verifiera kvantitetstyp, produkt, period, leveransrelation, dataversion, prisversion och kvalitet. → Lås spårbart underlag och skapa särskild rättelsejournal vid nya data.

**Förbjuden effekt:** S02-prognos, E31-aggregat eller DGI-leverans blir inte automatiskt individuell faktura.

**Regler:** DB-06  
**Provnivå:** Planerat regelbeteendeprov  
**Status:** Inte körd mot systemet

## AT-OPS-01 · Regelkontrakt: OPS-01
**Givet:** Ny regel, rutt, schema eller release

**När:** Publicering/konfigurationsändring – prova både uppfyllt villkor och relevant fel-/gränsfall.

**Förväntat:** Skapa nytt bevis per berörd tenant, aktörsroll och kapabilitet med versionslåst dependencyhash. → Ogiltigförklara berörda bevis och gör ny prövning; skydda samtidigt fortsatt mottagnings-/kvittenshantering.

**Förbjuden effekt:** Ett gammalt globalt is_ready godkänner inte nya funktioner eller tenants.

**Regler:** OPS-01  
**Provnivå:** Planerat regelbeteendeprov  
**Status:** Inte körd mot systemet

## AT-OPS-02 · Regelkontrakt: OPS-02
**Givet:** Öppna ärenden

**När:** Varje händelse eller timer – prova både uppfyllt villkor och relevant fel-/gränsfall.

**Förväntat:** Beräkna nästa åtgärd från processbeslutet med orsak, tidsgrund, ansvar och blockerare. → Visa vad systemet väntar på och vilka åtgärder som faktiskt är tillåtna.

**Förbjuden effekt:** Ett statiskt waiting_for_contrl-fält får inte styra hela affärskedjan.

**Regler:** OPS-02  
**Provnivå:** Planerat regelbeteendeprov  
**Status:** Inte körd mot systemet

## AT-OPS-03 · Regelkontrakt: OPS-03
**Givet:** Releasegodkännande

**När:** Tester sammanställs – prova både uppfyllt villkor och relevant fel-/gränsfall.

**Förväntat:** Håll dokumenttäckning, enhetstest, integration, tenant-E2E, transport och TGT som separata bevis. → Lås release till exakt head och testa flera tenants, DDQ, DGI och cross-tenantuppdrag.

**Förbjuden effekt:** Specifikations-JSON som validerar är inte produktions-E2E eller formellt Edielgodkännande.

**Regler:** OPS-03  
**Provnivå:** Planerat regelbeteendeprov  
**Status:** Inte körd mot systemet

## AT-OPS-04 · Regelkontrakt: OPS-04
**Givet:** Kontrollerad produktionstest

**När:** Efter rättelse – prova både uppfyllt villkor och relevant fel-/gränsfall.

**Förväntat:** Verifiera incidentspår, rutt, certifikat, profil och tenantkontext samt ett överenskommet motpartsprov. → Genomför ett kontrollerat verkligt förlopp i rätt miljö.

**Förbjuden effekt:** Massimport av referenser eller blinda omsändningar är inte en teststrategi.

**Regler:** OPS-04  
**Provnivå:** Planerat regelbeteendeprov  
**Status:** Inte körd mot systemet

## AT-OPS-05 · Regelkontrakt: OPS-05
**Givet:** Internt fel eller okänd kontext

**När:** Runtimefel – prova både uppfyllt villkor och relevant fel-/gränsfall.

**Förväntat:** Skilj protocol_rejection från internal_failure, security_quarantine och unsupported_capability. → Larma, bevara original och kvittensstatus och ge bara källstödda externa svar.

**Förbjuden effekt:** Hitta inte på APERAK-fält42/xxx därför att den egna applikationen kraschar.

**Regler:** OPS-05  
**Provnivå:** Planerat regelbeteendeprov  
**Status:** Inte körd mot systemet

## AT-ENV-10 · Regelkontrakt: ENV-10
**Givet:** PRODAT CCI kontra UTILTS CCI

**När:** Fältlokalisering – prova både uppfyllt villkor och relevant fel-/gränsfall.

**Förväntat:** PRODAT använder SG14/CCI/C502/6313 för Z-egenskapen. UTILTS använder normalt C240/7037. Samma segmentnamn betyder inte samma elementlayout. → Bind till familjens/releasens fulla segmentdefinition.

**Förbjuden effekt:** Använd inte en gemensam CCI-position som flyttar PRODAT-egenskaper.

**Regler:** ENV-10  
**Provnivå:** Planerat regelbeteendeprov  
**Status:** Inte körd mot systemet

## AT-ACK-10 · Regelkontrakt: ACK-10
**Givet:** APERAK på PRODAT

**När:** Byggare/korrelation – prova både uppfyllt villkor och relevant fel-/gränsfall.

**Förväntat:** BGM/1225 bär27/34; BGM/1001 och1004 används inte. Exempel på struktur är BGM+++34. → Använd RFF+ACW till originaletsBGM och eget teknisktUNH/arkiv-id.

**Förbjuden effekt:** Placera inte27/34 i1001 eller kräv eget P-APERAKBGM-id.

**Regler:** ACK-10  
**Provnivå:** Planerat regelbeteendeprov  
**Status:** Inte körd mot systemet

## AT-U-15 · Regelkontrakt: U-15
**Givet:** Utgående och inkommande UTILTS

**När:** Batch och validering – prova både uppfyllt villkor och relevant fel-/gränsfall.

**Förväntat:** En UTILTS-överföring UNB–UNZ innehåller endast ett meddelande UNH–UNT och en juridisk mottagare. Blanda inte skeden, anledning eller kvart-/månadsupplösning enligt Application Reference. → Paketera kompatibla transaktioner till rätt mottagare inom tillåtna gränser.

**Förbjuden effekt:** En generell multi-message-codec får inte kringgå UTILTS specifika paketeringsregel.

**Regler:** U-15  
**Provnivå:** Planerat regelbeteendeprov  
**Status:** Inte körd mot systemet

## AT-U-16 · Regelkontrakt: U-16
**Givet:** UTILTS och allmänna Ediel-filer

**När:** Paketering/kapacitetsplan – prova både uppfyllt villkor och relevant fel-/gränsfall.

**Förväntat:** T anger rekommenderad maxstorlek10MB; U anger fortfarande1MB och999transaktioner. Skilj rekommendation från syntax/nationell kardinalitet. → Utgående U kan hållas inom1MB och999 för att uppfylla båda; dokumentera mottagarkapacitet och fulla grammatikgränser.

**Förbjuden effekt:** Avvisa inte automatiskt meddelande över en rekommendation med påhittad syntaxfelkod.

**Regler:** U-16  
**Provnivå:** Planerat regelbeteendeprov  
**Status:** Inte körd mot systemet

## AT-U-17 · Regelkontrakt: U-17
**Givet:** UTILTS guidefel utan direkt numrerat fält

**När:** Felreferens byggs – prova både uppfyllt villkor och relevant fel-/gränsfall.

**Förväntat:** När bilaga1 säger om möjligt används i första hand fältnummer; annars, om möjligt, angiven segment-/elementreferens med max17tecken. → Behåll källstyrd hänvisning såsom DTM/2005 i tillämpligt fall.

**Förbjuden effekt:** Påstå inte att alla fel måste ha ett numeriskt fältnummer eller gissa ett från kvalificeraren.

**Regler:** U-17  
**Provnivå:** Planerat regelbeteendeprov  
**Status:** Inte körd mot systemet

## AT-U-18 · Regelkontrakt: U-18
**Givet:** UTILTS med ställningar och energi

**När:** Observationer parsas/byggs – prova både uppfyllt villkor och relevant fel-/gränsfall.

**Förväntat:** Håll energier sammanhängande och tidsordnade; ställningar sammanhängande och tidsordnade. Blockens inbördes ordning är valfri. Samma ställning med tid får inte dupliceras inom transaktionen. → Bevara observationernas typ och ordning enligt gruppen.

**Förbjuden effekt:** Kräv inte alltid ställningar först och blanda inte ställningar mellan energivärden.

**Regler:** U-18  
**Provnivå:** Planerat regelbeteendeprov  
**Status:** Inte körd mot systemet

## AT-U-19 · Regelkontrakt: U-19
**Givet:** RFF med referensfält226

**När:** Nationell kontroll – prova både uppfyllt villkor och relevant fel-/gränsfall.

**Förväntat:** Referens till PRODAT-ärende används för korrelation där den går att knyta; bilaga1 anger inga kontroller av värdet och ingen avvisning om kvalificeraren inte är TN. → Använd referensen för möjlig korrelation utan att göra den till obligatorisk auktoriseringsnyckel för alla serier.

**Förbjuden effekt:** Avvisa inte giltig E66 enbart för avsaknad/fel korrelationsreferens där guiden inte föreskriver det.

**Regler:** U-19  
**Provnivå:** Planerat regelbeteendeprov  
**Status:** Inte körd mot systemet

## AT-Z01L-SUPPLIER · Meddelandefall Z01L
**Givet:** SUPPLIER; Kund/fullmakt, anläggning, nätområde och avtalad tilltänkt start enligt fältprofil.

**När:** Behörig kontroll av kundens nätavtalsuppgifter inför möjlig start; inte obligatoriskt om korrekta uppgifter redan finns.

**Förväntat:** 23-DDQ-PRODAT; BGM=Z01; fält223=Z22; CONTRL; Z02 eller negativ APERAK. AB kan begäras men positiv APERAK är ingen startspärr.; Skapa uppgiftsärende och bevakning; ingen leveransaktivering.

**Förbjuden effekt:** Fel roll, fel riktning, saknade R/D-fält, felaktig korrelation eller mutation ska inte verkställas.

**Regler:** TEN-05, P-01, ENV-06  
**Provnivå:** Planerat meddelande-/rollprov  
**Status:** Inte körd mot systemet

## AT-Z02L-SUPPLIER · Meddelandefall Z02L
**Givet:** SUPPLIER; Inte Z03 eller Z04; får inte aktivera leverans.

**När:** Svar på egen korrelerad Z01.

**Förväntat:** 23-DDQ-PRODAT; BGM=Z02; fält223=Z22; Generera CONTRL och tillämplig APERAK; inget automatiskt kvittenskrav före behandling.; Validera rätt kund/objekt/nätområde/LI; lagra verifierade uppgifter; pröva därefter om separat Z03-kommando är redo.

**Förbjuden effekt:** Fel roll, fel riktning, saknade R/D-fält, felaktig korrelation eller mutation ska inte verkställas.

**Regler:** TEN-05, P-01, ENV-06  
**Provnivå:** Planerat meddelande-/rollprov  
**Status:** Inte körd mot systemet

## AT-Z03L-SUPPLIER · Meddelandefall Z03L
**Givet:** SUPPLIER; Startfönster L D-14 dagar; LK senast inflyttningsdagen; max14 kalendermånader före.

**När:** Nytt giltigt leveransavtal; L=leverantörsbyte, LK=kund- och leverantörsbyte/flytt.

**Förväntat:** 23-DDQ-PRODAT; BGM=Z03; fält223=Z22; CONTRL, APERAK, rätt Z04L/LK; dessa är olika förväntningar.; Skapa bytes-/flyttärende och tillåtna timers, inte aktiv leverans.

**Förbjuden effekt:** Fel roll, fel riktning, saknade R/D-fält, felaktig korrelation eller mutation ska inte verkställas.

**Regler:** TEN-05, P-01, ENV-06  
**Provnivå:** Planerat meddelande-/rollprov  
**Status:** Inte körd mot systemet

## AT-Z04L-SUPPLIER · Meddelandefall Z04L
**Givet:** SUPPLIER; Z04 får komma före positiv APERAK. Samma LI ensamt räcker inte för korrelation.

**När:** Nätägarens affärsbekräftelse på egen Z03.

**Förväntat:** 23-DDQ-PRODAT; BGM=Z04; fält223=Z22; CONTRL och tillämplig APERAK i retur.; Skapa bekräftad framtida leveransperiod; aktivera först vid korrekt start och oförändrat giltigt ärende.

**Förbjuden effekt:** Fel roll, fel riktning, saknade R/D-fält, felaktig korrelation eller mutation ska inte verkställas.

**Regler:** TEN-05, P-01, ENV-06  
**Provnivå:** Planerat meddelande-/rollprov  
**Status:** Inte körd mot systemet

## AT-Z05L-SUPPLIER · Meddelandefall Z05L
**Givet:** SUPPLIER; Z05L kan referera till Z08H; Z05LK kan vara följd av utflytt efter Z09E men är inte Z09E-svar.

**När:** Nätägarens information till tidigare leverantör.

**Förväntat:** 23-DDQ-PRODAT; BGM=Z05; fält223=Z22; CONTRL och tillämplig APERAK; normalt ingen egen affärsbekräftelse tillbaka.; Avsluta berörd leveransperiod vid angivet giltigt slut, planera slutvärden/slutunderlag; behåll historik.

**Förbjuden effekt:** Fel roll, fel riktning, saknade R/D-fält, felaktig korrelation eller mutation ska inte verkställas.

**Regler:** TEN-05, P-01, ENV-06  
**Provnivå:** Planerat meddelande-/rollprov  
**Status:** Inte körd mot systemet

## AT-Z01LK-SUPPLIER · Meddelandefall Z01LK
**Givet:** SUPPLIER; Kund/fullmakt, anläggning, nätområde och avtalad tilltänkt start enligt fältprofil.

**När:** Behörig kontroll av kundens nätavtalsuppgifter inför möjlig start; inte obligatoriskt om korrekta uppgifter redan finns.

**Förväntat:** 23-DDQ-PRODAT; BGM=Z01; fält223=Z23; CONTRL; Z02 eller negativ APERAK. AB kan begäras men positiv APERAK är ingen startspärr.; Skapa uppgiftsärende och bevakning; ingen leveransaktivering.

**Förbjuden effekt:** Fel roll, fel riktning, saknade R/D-fält, felaktig korrelation eller mutation ska inte verkställas.

**Regler:** TEN-05, P-01, ENV-06  
**Provnivå:** Planerat meddelande-/rollprov  
**Status:** Inte körd mot systemet

## AT-Z02LK-SUPPLIER · Meddelandefall Z02LK
**Givet:** SUPPLIER; Inte Z03 eller Z04; får inte aktivera leverans.

**När:** Svar på egen korrelerad Z01.

**Förväntat:** 23-DDQ-PRODAT; BGM=Z02; fält223=Z23; Generera CONTRL och tillämplig APERAK; inget automatiskt kvittenskrav före behandling.; Validera rätt kund/objekt/nätområde/LI; lagra verifierade uppgifter; pröva därefter om separat Z03-kommando är redo.

**Förbjuden effekt:** Fel roll, fel riktning, saknade R/D-fält, felaktig korrelation eller mutation ska inte verkställas.

**Regler:** TEN-05, P-01, ENV-06  
**Provnivå:** Planerat meddelande-/rollprov  
**Status:** Inte körd mot systemet

## AT-Z03LK-SUPPLIER · Meddelandefall Z03LK
**Givet:** SUPPLIER; Startfönster L D-14 dagar; LK senast inflyttningsdagen; max14 kalendermånader före.

**När:** Nytt giltigt leveransavtal; L=leverantörsbyte, LK=kund- och leverantörsbyte/flytt.

**Förväntat:** 23-DDQ-PRODAT; BGM=Z03; fält223=Z23; CONTRL, APERAK, rätt Z04L/LK; dessa är olika förväntningar.; Skapa bytes-/flyttärende och tillåtna timers, inte aktiv leverans.

**Förbjuden effekt:** Fel roll, fel riktning, saknade R/D-fält, felaktig korrelation eller mutation ska inte verkställas.

**Regler:** TEN-05, P-01, ENV-06  
**Provnivå:** Planerat meddelande-/rollprov  
**Status:** Inte körd mot systemet

## AT-Z04LK-SUPPLIER · Meddelandefall Z04LK
**Givet:** SUPPLIER; Z04 får komma före positiv APERAK. Samma LI ensamt räcker inte för korrelation.

**När:** Nätägarens affärsbekräftelse på egen Z03.

**Förväntat:** 23-DDQ-PRODAT; BGM=Z04; fält223=Z23; CONTRL och tillämplig APERAK i retur.; Skapa bekräftad framtida leveransperiod; aktivera först vid korrekt start och oförändrat giltigt ärende.

**Förbjuden effekt:** Fel roll, fel riktning, saknade R/D-fält, felaktig korrelation eller mutation ska inte verkställas.

**Regler:** TEN-05, P-01, ENV-06  
**Provnivå:** Planerat meddelande-/rollprov  
**Status:** Inte körd mot systemet

## AT-Z05LK-SUPPLIER · Meddelandefall Z05LK
**Givet:** SUPPLIER; Z05L kan referera till Z08H; Z05LK kan vara följd av utflytt efter Z09E men är inte Z09E-svar.

**När:** Nätägarens information till tidigare leverantör.

**Förväntat:** 23-DDQ-PRODAT; BGM=Z05; fält223=Z23; CONTRL och tillämplig APERAK; normalt ingen egen affärsbekräftelse tillbaka.; Avsluta berörd leveransperiod vid angivet giltigt slut, planera slutvärden/slutunderlag; behåll historik.

**Förbjuden effekt:** Fel roll, fel riktning, saknade R/D-fält, felaktig korrelation eller mutation ska inte verkställas.

**Regler:** TEN-05, P-01, ENV-06  
**Provnivå:** Planerat meddelande-/rollprov  
**Status:** Inte körd mot systemet

## AT-Z03C-SUPPLIER · Meddelandefall Z03C
**Givet:** SUPPLIER; Referera rätt originalärende/objekt/kund; L senast4dagar före, LK senast inflyttningsdagen.

**När:** Återtag av eget bytes-/flyttärende inom kancelleringsfönstret.

**Förväntat:** 23-DDQ-PRODAT; BGM=Z03; fält223=Z24; CONTRL, APERAK och enligt förloppet Z04C.; Markera kancellering begärd; inte färdig enbart på SMTP250.

**Förbjuden effekt:** Fel roll, fel riktning, saknade R/D-fält, felaktig korrelation eller mutation ska inte verkställas.

**Regler:** TEN-05, P-01, ENV-06  
**Provnivå:** Planerat meddelande-/rollprov  
**Status:** Inte körd mot systemet

## AT-Z04C-SUPPLIER · Meddelandefall Z04C
**Givet:** SUPPLIER; Bevara original- och kancelleringsordning; kancellering före original lagras för begränsad korrelation, ingen godtycklig aktivering.

**När:** Bekräftelse/korrigering som upphäver berört startförlopp.

**Förväntat:** 23-DDQ-PRODAT; BGM=Z04; fält223=Z24; CONTRL och tillämplig APERAK.; Upphäv endast rätt bekräftade/framtida period; vid redan verkställd effekt starta kontrollerad kompensation.

**Förbjuden effekt:** Fel roll, fel riktning, saknade R/D-fält, felaktig korrelation eller mutation ska inte verkställas.

**Regler:** TEN-05, P-01, ENV-06  
**Provnivå:** Planerat meddelande-/rollprov  
**Status:** Inte körd mot systemet

## AT-Z05C-SUPPLIER · Meddelandefall Z05C
**Givet:** SUPPLIER; Skilj återtag av leveransslut från ESCO Z15C.

**När:** Tidigare meddelat leveransslut återtas.

**Förväntat:** 23-DDQ-PRODAT; BGM=Z05; fält223=Z24; CONTRL och tillämplig APERAK.; Återställ rätt avslutsbeslut efter kontroll; skapa inte duplicerad leveransperiod.

**Förbjuden effekt:** Fel roll, fel riktning, saknade R/D-fält, felaktig korrelation eller mutation ska inte verkställas.

**Regler:** TEN-05, P-01, ENV-06  
**Provnivå:** Planerat meddelande-/rollprov  
**Status:** Inte körd mot systemet

## AT-Z04A-SUPPLIER · Meddelandefall Z04A
**Givet:** SUPPLIER; Dokumenterad anvisningsöverenskommelse i rätt nätområde; kräver inte egen Z03.

**När:** Nätägarens anvisning när aktören är behörig anvisad leverantör.

**Förväntat:** 23-DDQ-PRODAT; BGM=Z04; fält223=Z26; CONTRL och tillämplig APERAK.; Registrera anvisningsprocess och korrekt start.

**Förbjuden effekt:** Fel roll, fel riktning, saknade R/D-fält, felaktig korrelation eller mutation ska inte verkställas.

**Regler:** TEN-05, P-01, ENV-06  
**Provnivå:** Planerat meddelande-/rollprov  
**Status:** Inte körd mot systemet

## AT-Z04D-SUPPLIER · Meddelandefall Z04D
**Givet:** SUPPLIER; Inte bara mikroproduktion; inte generell Z03-guard eller konsumentaktivering.

**När:** Mottagningsplikt för produktion enligt tillämpligt produktionsförlopp.

**Förväntat:** 23-DDQ-PRODAT; BGM=Z04; fält223=Z70; CONTRL och tillämplig APERAK.; Skapa separat produktions-/mottagningsrelation, knyt till förbrukningsobjekt via319.

**Förbjuden effekt:** Fel roll, fel riktning, saknade R/D-fält, felaktig korrelation eller mutation ska inte verkställas.

**Regler:** TEN-05, P-01, ENV-06  
**Provnivå:** Planerat meddelande-/rollprov  
**Status:** Inte körd mot systemet

## AT-Z03H-SUPPLIER · Meddelandefall Z03H
**Givet:** SUPPLIER; Känd kod ≠ generell produktionsbehörighet; konkret avtal och exakta fält/timers krävs.

**När:** Särskilt avtalad användning av ospecificerad/hävningsanknuten transaktion.

**Förväntat:** 23-DDQ-PRODAT; BGM=Z03; fält223=Z25; Kvittens och affärsförlopp enligt uttrycklig bilateral process.; Ingen automatisk standardeffekt utan fastställd bilateral transitionsprofil.

**Förbjuden effekt:** Fel roll, fel riktning, saknade R/D-fält, felaktig korrelation eller mutation ska inte verkställas.

**Regler:** TEN-05, P-01, ENV-06  
**Provnivå:** Planerat meddelande-/rollprov  
**Status:** Inte körd mot systemet

## AT-Z04H-SUPPLIER · Meddelandefall Z04H
**Givet:** SUPPLIER; Känd kod ≠ generell produktionsbehörighet; konkret avtal och exakta fält/timers krävs.

**När:** Särskilt avtalad användning av ospecificerad/hävningsanknuten transaktion.

**Förväntat:** 23-DDQ-PRODAT; BGM=Z04; fält223=Z25; Kvittens och affärsförlopp enligt uttrycklig bilateral process.; Ingen automatisk standardeffekt utan fastställd bilateral transitionsprofil.

**Förbjuden effekt:** Fel roll, fel riktning, saknade R/D-fält, felaktig korrelation eller mutation ska inte verkställas.

**Regler:** TEN-05, P-01, ENV-06  
**Provnivå:** Planerat meddelande-/rollprov  
**Status:** Inte körd mot systemet

## AT-Z05H-SUPPLIER · Meddelandefall Z05H
**Givet:** SUPPLIER; Känd kod ≠ generell produktionsbehörighet; konkret avtal och exakta fält/timers krävs.

**När:** Särskilt avtalad användning av ospecificerad/hävningsanknuten transaktion.

**Förväntat:** 23-DDQ-PRODAT; BGM=Z05; fält223=Z25; Kvittens och affärsförlopp enligt uttrycklig bilateral process.; Ingen automatisk standardeffekt utan fastställd bilateral transitionsprofil.

**Förbjuden effekt:** Fel roll, fel riktning, saknade R/D-fält, felaktig korrelation eller mutation ska inte verkställas.

**Regler:** TEN-05, P-01, ENV-06  
**Provnivå:** Planerat meddelande-/rollprov  
**Status:** Inte körd mot systemet

## AT-Z08H-SUPPLIER · Meddelandefall Z08H
**Givet:** SUPPLIER; Juridiska förutsättningar för hävning måste vara dokumenterade; ingen automatisk hävning enbart vid betalningsflagga.

**När:** Behörigt avslut/hävning av elhandelsavtal.

**Förväntat:** 23-DDQ-PRODAT; BGM=Z08; fält223=Z25; CONTRL, APERAK och relevant Z05L enligt förlopp.; Bevakad avslutsbegäran och kontrollerat leveransslut.

**Förbjuden effekt:** Fel roll, fel riktning, saknade R/D-fält, felaktig korrelation eller mutation ska inte verkställas.

**Regler:** TEN-05, P-01, ENV-06  
**Provnivå:** Planerat meddelande-/rollprov  
**Status:** Inte körd mot systemet

## AT-Z08LK-SUPPLIER · Meddelandefall Z08LK
**Givet:** SUPPLIER; Inte universell ersättning för Z03LK.

**När:** Bilateral användning för kund-/leverantörsbyte.

**Förväntat:** 23-DDQ-PRODAT; BGM=Z08; fält223=Z23; Svar enligt uttryckligt avtal.; Bara den överenskomna avsluts-/flyttprocessen.

**Förbjuden effekt:** Fel roll, fel riktning, saknade R/D-fält, felaktig korrelation eller mutation ska inte verkställas.

**Regler:** TEN-05, P-01, ENV-06  
**Provnivå:** Planerat meddelande-/rollprov  
**Status:** Inte körd mot systemet

## AT-Z06E-SUPPLIER · Meddelandefall Z06E
**Givet:** SUPPLIER; Z06E utanför fastställd standardlivshändelse kräver bilateral grund. Z06F/G får inte skriva kundidentitet från förbjuden NAD+UD.

**När:** Nätägarens kund-/anläggningsuppdatering.

**Förväntat:** 23-DDQ-PRODAT; BGM=Z06; fält223=E34; CONTRL och APERAK enligt guide; ytterligare UTILTS för F enligt ändring och Handbok.; Uppdatera tillåtna kunduppgifter i rätt livshändelse; dödsfalls- och konkursärenden separata.

**Förbjuden effekt:** Fel roll, fel riktning, saknade R/D-fält, felaktig korrelation eller mutation ska inte verkställas.

**Regler:** TEN-05, P-01, ENV-06  
**Provnivå:** Planerat meddelande-/rollprov  
**Status:** Inte körd mot systemet

## AT-Z09E-SUPPLIER · Meddelandefall Z09E
**Givet:** SUPPLIER; Z09E har NAD+UD; Z09F/G använder respektive217 Z04/Z03 och giltighetsdatum157; inte automatiskt kundbyte.

**När:** Anmäl rätt kundlivshändelse/överenskommen uppgiftsändring.

**Förväntat:** 23-DDQ-PRODAT; BGM=Z09; fält223=E34; CONTRL, APERAK och enligt processen senare Z06; inget påhittat direkt affärssvar.; Registrera önskad förändring; mottagen bekräftad struktur har egen versionshantering.

**Förbjuden effekt:** Fel roll, fel riktning, saknade R/D-fält, felaktig korrelation eller mutation ska inte verkställas.

**Regler:** TEN-05, P-01, ENV-06  
**Provnivå:** Planerat meddelande-/rollprov  
**Status:** Inte körd mot systemet

## AT-Z06F-SUPPLIER · Meddelandefall Z06F
**Givet:** SUPPLIER; Z06E utanför fastställd standardlivshändelse kräver bilateral grund. Z06F/G får inte skriva kundidentitet från förbjuden NAD+UD.

**När:** Nätägarens kund-/anläggningsuppdatering.

**Förväntat:** 23-DDQ-PRODAT; BGM=Z06; fält223=E64; CONTRL och APERAK enligt guide; ytterligare UTILTS för F enligt ändring och Handbok.; Versionera struktur och avläsningsutlösande ändring; kontrollera berörda mätvärdesförväntningar.

**Förbjuden effekt:** Fel roll, fel riktning, saknade R/D-fält, felaktig korrelation eller mutation ska inte verkställas.

**Regler:** TEN-05, P-01, ENV-06  
**Provnivå:** Planerat meddelande-/rollprov  
**Status:** Inte körd mot systemet

## AT-Z09F-SUPPLIER · Meddelandefall Z09F
**Givet:** SUPPLIER; Z09E har NAD+UD; Z09F/G använder respektive217 Z04/Z03 och giltighetsdatum157; inte automatiskt kundbyte.

**När:** Begär kvartsmätning enligt kundavtal.

**Förväntat:** 23-DDQ-PRODAT; BGM=Z09; fält223=E64; CONTRL, APERAK och enligt processen senare Z06; inget påhittat direkt affärssvar.; Registrera önskad förändring; mottagen bekräftad struktur har egen versionshantering.

**Förbjuden effekt:** Fel roll, fel riktning, saknade R/D-fält, felaktig korrelation eller mutation ska inte verkställas.

**Regler:** TEN-05, P-01, ENV-06  
**Provnivå:** Planerat meddelande-/rollprov  
**Status:** Inte körd mot systemet

## AT-Z06G-SUPPLIER · Meddelandefall Z06G
**Givet:** SUPPLIER; Z06E utanför fastställd standardlivshändelse kräver bilateral grund. Z06F/G får inte skriva kundidentitet från förbjuden NAD+UD.

**När:** Nätägarens kund-/anläggningsuppdatering.

**Förväntat:** 23-DDQ-PRODAT; BGM=Z06; fält223=E32; CONTRL och APERAK enligt guide; ytterligare UTILTS för F enligt ändring och Handbok.; Versionera ändrad struktur utan att påhittad avläsning krävs.

**Förbjuden effekt:** Fel roll, fel riktning, saknade R/D-fält, felaktig korrelation eller mutation ska inte verkställas.

**Regler:** TEN-05, P-01, ENV-06  
**Provnivå:** Planerat meddelande-/rollprov  
**Status:** Inte körd mot systemet

## AT-Z09G-SUPPLIER · Meddelandefall Z09G
**Givet:** SUPPLIER; Z09E har NAD+UD; Z09F/G använder respektive217 Z04/Z03 och giltighetsdatum157; inte automatiskt kundbyte.

**När:** Informera att nätägaren ska avgöra mätmetoden enligt ändrat avtal.

**Förväntat:** 23-DDQ-PRODAT; BGM=Z09; fält223=E32; CONTRL, APERAK och enligt processen senare Z06; inget påhittat direkt affärssvar.; Registrera önskad förändring; mottagen bekräftad struktur har egen versionshantering.

**Förbjuden effekt:** Fel roll, fel riktning, saknade R/D-fält, felaktig korrelation eller mutation ska inte verkställas.

**Regler:** TEN-05, P-01, ENV-06  
**Provnivå:** Planerat meddelande-/rollprov  
**Status:** Inte körd mot systemet

## AT-Z09B-SUPPLIER · Meddelandefall Z09B
**Givet:** SUPPLIER; Senast en kalendermånad före; rätt aktör/område/avtal; AI-lista ersätter inte Z09B.

**När:** Byte av balansansvarig för berörda leveransrelationer.

**Förväntat:** 23-DDQ-PRODAT; BGM=Z09; fält223=Z27; CONTRL och APERAK; uppdatering enligt BRP-förloppet.; Versionera BRP-ansvar vid datumet, inte tenantglobal överlagring av historiken.

**Förbjuden effekt:** Fel roll, fel riktning, saknade R/D-fält, felaktig korrelation eller mutation ska inte verkställas.

**Regler:** TEN-05, P-01, ENV-06  
**Provnivå:** Planerat meddelande-/rollprov  
**Status:** Inte körd mot systemet

## AT-Z09D-SUPPLIER · Meddelandefall Z09D
**Givet:** SUPPLIER; 210 XOR 211, aldrig DTM157 som ersättning; inte NAD+UD på Z09D.

**När:** Produktionsavtal tecknas eller upphör.

**Förväntat:** 23-DDQ-PRODAT; BGM=Z09; fält223=Z70; CONTRL och APERAK; eventuella efterföljande mottagningspliktsförlopp separat.; Starta/avsluta rätt produktionsavtal.

**Förbjuden effekt:** Fel roll, fel riktning, saknade R/D-fält, felaktig korrelation eller mutation ska inte verkställas.

**Regler:** TEN-05, P-01, ENV-06  
**Provnivå:** Planerat meddelande-/rollprov  
**Status:** Inte körd mot systemet

## AT-Z10M-SUPPLIER · Meddelandefall Z10M
**Givet:** SUPPLIER; Gamla/nya mätarnummer olika; flerregisteroverlay; tio vardagar som sändningsfrist för nätägaren.

**När:** Nätägarens mätarbyte.

**Förväntat:** 23-DDQ-PRODAT; BGM=Z10; fält223=E58; CONTRL och APERAK; avläsningar/energier via relevanta UTILTS-transaktioner.; Versionera ny/gammal mätare/register och gränstid, bevara tidigare mätvärden.

**Förbjuden effekt:** Fel roll, fel riktning, saknade R/D-fält, felaktig korrelation eller mutation ska inte verkställas.

**Regler:** TEN-05, P-01, ENV-06  
**Provnivå:** Planerat meddelande-/rollprov  
**Status:** Inte körd mot systemet

## AT-Z13V-ESCO · Meddelandefall Z13V
**Givet:** ESCO; Kundidentitet ej födelsedatum; Z13 behöver inte anläggnings-id men LIN+1 finns; scope/roll/avtal/beneficiary separat.

**När:** Avtal med slutkund och DSO finns; begär fortlöpande rapportering.

**Förväntat:** 23-DGI-PRODAT; BGM=Z13; fält223=S17; CONTRL, APERAK för begäran; därefter Z14 eller Z14N.; Skapa begäran och objektrelaterade rättigheter först efter positivt Z14; inte elleverans.

**Förbjuden effekt:** Fel roll, fel riktning, saknade R/D-fält, felaktig korrelation eller mutation ska inte verkställas.

**Regler:** TEN-05, P-01, ENV-06  
**Provnivå:** Planerat meddelande-/rollprov  
**Status:** Inte körd mot systemet

## AT-Z14V-ESCO · Meddelandefall Z14V
**Givet:** ESCO; A74; tillstånds-id; rättLI; ej bredda kund-/tids-/produktomfattning från antaganden. Förvänta inte Z04.

**När:** DSO godkänner tillgång för angivna godkända anläggningar.

**Förväntat:** 23-DGI-PRODAT; BGM=Z14; fält223=S17; CONTRL och APERAK; E66 enligt bekräftade villkor och vid historik slut viaZ15VH.; Skapa/versionera market_permission och objektscope; projektionsåtkomst bara till uttryckligen berättigade tenants.

**Förbjuden effekt:** Fel roll, fel riktning, saknade R/D-fält, felaktig korrelation eller mutation ska inte verkställas.

**Regler:** TEN-05, P-01, ENV-06  
**Provnivå:** Planerat meddelande-/rollprov  
**Status:** Inte körd mot systemet

## AT-Z15V-ESCO · Meddelandefall Z15V
**Givet:** ESCO; Datum164, idZ09, status/orsak; får inte avsluta annan tenant eller DDQ-leverans.

**När:** Fortlöpande tillstånd upphör.

**Förväntat:** 23-DGI-PRODAT; BGM=Z15; fält223=S17; CONTRL och APERAK; inget nytt automatiskt Z13.; Avsluta rätt rapporterings-/tillståndsförlopp; VH slutför historikjobbet, inte separat V-tillstånd.

**Förbjuden effekt:** Fel roll, fel riktning, saknade R/D-fält, felaktig korrelation eller mutation ska inte verkställas.

**Regler:** TEN-05, P-01, ENV-06  
**Provnivå:** Planerat meddelande-/rollprov  
**Status:** Inte körd mot systemet

## AT-Z13VH-ESCO · Meddelandefall Z13VH
**Givet:** ESCO; Kundidentitet ej födelsedatum; Z13 behöver inte anläggnings-id men LIN+1 finns; scope/roll/avtal/beneficiary separat.

**När:** Avtal med slutkund och DSO finns; begär avgränsad historik.

**Förväntat:** 23-DGI-PRODAT; BGM=Z13; fält223=S18; CONTRL, APERAK för begäran; därefter Z14 eller Z14N.; Skapa begäran och objektrelaterade rättigheter först efter positivt Z14; inte elleverans.

**Förbjuden effekt:** Fel roll, fel riktning, saknade R/D-fält, felaktig korrelation eller mutation ska inte verkställas.

**Regler:** TEN-05, P-01, ENV-06  
**Provnivå:** Planerat meddelande-/rollprov  
**Status:** Inte körd mot systemet

## AT-Z14VH-ESCO · Meddelandefall Z14VH
**Givet:** ESCO; A74; tillstånds-id; rättLI; ej bredda kund-/tids-/produktomfattning från antaganden. Förvänta inte Z04.

**När:** DSO godkänner tillgång för angivna godkända anläggningar.

**Förväntat:** 23-DGI-PRODAT; BGM=Z14; fält223=S18; CONTRL och APERAK; E66 enligt bekräftade villkor och vid historik slut viaZ15VH.; Skapa/versionera market_permission och objektscope; projektionsåtkomst bara till uttryckligen berättigade tenants.

**Förbjuden effekt:** Fel roll, fel riktning, saknade R/D-fält, felaktig korrelation eller mutation ska inte verkställas.

**Regler:** TEN-05, P-01, ENV-06  
**Provnivå:** Planerat meddelande-/rollprov  
**Status:** Inte körd mot systemet

## AT-Z15VH-ESCO · Meddelandefall Z15VH
**Givet:** ESCO; Datum164, idZ09, status/orsak; får inte avsluta annan tenant eller DDQ-leverans.

**När:** Historikleveransen har avslutats.

**Förväntat:** 23-DGI-PRODAT; BGM=Z15; fält223=S18; CONTRL och APERAK; inget nytt automatiskt Z13.; Avsluta rätt rapporterings-/tillståndsförlopp; VH slutför historikjobbet, inte separat V-tillstånd.

**Förbjuden effekt:** Fel roll, fel riktning, saknade R/D-fält, felaktig korrelation eller mutation ska inte verkställas.

**Regler:** TEN-05, P-01, ENV-06  
**Provnivå:** Planerat meddelande-/rollprov  
**Status:** Inte körd mot systemet

## AT-Z14N-ESCO · Meddelandefall Z14N
**Givet:** ESCO; A13 aktivt nekat; A76 passivt nekat; många positiva-Z14-fält ska utelämnas. Förväxla inte negativt affärssvar med syntaktiskt fel.

**När:** Aktivt eller passivt nekat tillstånd.

**Förväntat:** 23-DGI-PRODAT; BGM=Z14; fält223=Z96; CONTRL och APERAK på själva Z14N om korrekt; ingen datarapportering.; Neka berörd begäran; lägg ingen market_permission för åtkomst.

**Förbjuden effekt:** Fel roll, fel riktning, saknade R/D-fält, felaktig korrelation eller mutation ska inte verkställas.

**Regler:** TEN-05, P-01, ENV-06  
**Provnivå:** Planerat meddelande-/rollprov  
**Status:** Inte körd mot systemet

## AT-Z15C-ESCO · Meddelandefall Z15C
**Givet:** ESCO; Status och datum enligt fältspecifikation; kräver inte generell egen Z18.

**När:** Återtag av felaktigt tillståndsupphörande, t.ex. rättad utflytt.

**Förväntat:** 23-DGI-PRODAT; BGM=Z15; fält223=Z24; CONTRL och APERAK.; Återställ berört market_permission efter rätt korrelation. Återuppliva inte ett separat återkallat tenantåtkomstgrant.

**Förbjuden effekt:** Fel roll, fel riktning, saknade R/D-fält, felaktig korrelation eller mutation ska inte verkställas.

**Regler:** TEN-05, P-01, ENV-06  
**Provnivå:** Planerat meddelande-/rollprov  
**Status:** Inte körd mot systemet

## AT-Z18V-ESCO · Meddelandefall Z18V
**Givet:** ESCO; 327/324/325 krävs; beneficiarys UI-avslut av ett deluppdrag ≠ avslut för samtliga tenants.

**När:** Behörig begäran att avsluta rapportering.

**Förväntat:** 23-DGI-PRODAT; BGM=Z18; fält223=S17; CONTRL, APERAK, tillämplig Z15.; Begär avslut av rätt marknadstillstånd; kontrollera andra giltiga serviceuppdrag innan gemensamt tillstånd sägs upp.

**Förbjuden effekt:** Fel roll, fel riktning, saknade R/D-fält, felaktig korrelation eller mutation ska inte verkställas.

**Regler:** TEN-05, P-01, ENV-06  
**Provnivå:** Planerat meddelande-/rollprov  
**Status:** Inte körd mot systemet
