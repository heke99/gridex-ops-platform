# Elbolagets arbetsyta – rättningar och målbild

Baslinje: `bf32b7e01fbd0511972ba8977c61d412a018e416`. Implementationsgren: `codex/fix-final-audit-20261116`.

Samtliga 66 granskade poster har en kodrättning eller en uttrycklig förtydligad visning på arbetsgrenen. Paketens exakta källversioner har granskats av två oberoende granskare. Sammansatta lokala slutkontroller passerar; den sista sammanfogade källversionen slutgranskas separat. Ändringen är inte mergad eller driftsatt.

## Så ska elbolaget förstå systemet

De vanliga ingångarna följer arbetet: **Översikt & arbetskö, Kunder, Leveranser, Fakturering, Portfölj & analys samt Inställningar**. Behörighetsstyrda specialistfunktioner behåller sina befintliga adresser och rättigheter. Plattformens tekniska vy finns kvar.

Kundkortet behåller kundnummer, anläggning, nätägare, fullmakt, avtalstyp och datum som sammanhang. Nästa steg visar en tillåten affärshandling. Kvittens betyder att ett meddelande tagits emot; bekräftat byte och aktiverad leverans är separata tillstånd. Fakturans godkännande och överföringen till fakturapartner visas också separat.

Bolagsvyer visar affärsinformation. Payload, interna fel, tekniska nycklar och processdiagnostik hör till den auktoriserade plattformsvyn. Serverns behörighets-, bolags-, domän- och tillståndskontroller finns kvar även när en knapp döljs.

## Sju arkitekturområden

| Område | Målbild och genomförd riktning |
| --- | --- |
| ARK-01 – Sammanhängande arbetsyta | Behåll kundkortet som sammanhang och arbetskön som prioriterad att-göra-vy; gruppera huvudnavigationen efter uppgift och gör specialistvägar rollstyrda. |
| ARK-02 – Åtgärdspolicy i presentationen | Återanvänd actionens exakta any/all-villkor, plattformsundantag, bolagsstatus och domänkrav vid presentation; omvalidera vid klick. |
| ARK-03 – Kontinuitet mellan arbetssteg | Gör nästa steg till ett faktiskt tillåtet länkmål med kund-/anläggnings-/avtals-/periodkontext och tydligt kommandoresultat. |
| ARK-04 – Sanningsenligt läsunderlag | Inför konsekvent läsunderlag med faktisk period, fullständighet, aktualitet, enhet, källa och ordnad sidindelning. |
| ARK-05 – Status och säker återhämtning | Återanvänd gemensam affärstolkning och visa skilda statusaxlar. Definiera kvalitetsbesked och bevara historik och kontrollerad återhämtning. |
| ARK-06 – Affärsinformation och separat diagnostik | Välj uttryckliga affärsfält på servern och ge plattformen separat auktoriserad teknisk fördjupning. |
| ARK-07 – Sammanhängande verifiering av projektets arbetsflöden | Använd projektets egna arbetsuppgifter P-01–P-08 som avgränsade acceptansfall och dokumentera befintlig respektive återstående verifiering. |

## Samtliga fynd

Originalbedömning, förutsättningar, belägg, mål och verifieringskrav finns bevarade i [findings.json](findings.json). Källhänvisningarna i originalfynden gäller baslinjen ovan. En rättning på arbetsgrenen är ingen uppgift om driftsatt beteende.

| Fynd | Problem eller förbättring | Rättningspaket | Status |
| --- | --- | --- | --- |
| GUI-001 | Partnerexporter visar skrivformulär för läsare | Åtgärder och rättigheter | Rättad på arbetsgrenen |
| GUI-002 | Periodkontroll visas utan rätt åtgärdsbehörighet | Åtgärder och rättigheter | Rättad på arbetsgrenen |
| GUI-003 | Driftuppgifter visar statusknappar för läsare | Åtgärder och rättigheter | Rättad på arbetsgrenen |
| GUI-004 | Utskick visar flera åtgärder utan respektive skrivbehörighet | Åtgärder och rättigheter | Rättad på arbetsgrenen |
| GUI-005 | Anläggningsbegäran visar manuella skrivformulär för läsare | Åtgärder och rättigheter | Rättad på arbetsgrenen |
| GUI-006 | Fakturering erbjuder export/godkännande för fakturaläsare | Åtgärder och rättigheter | Rättad på arbetsgrenen |
| GUI-007 | Partnerexporter visar interna ID:n, råa koder och engelska statusar | Åtgärder och rättigheter | Rättad på arbetsgrenen |
| GUI-008 | Periodkontroll använder periodmotor/requests/cases och interna ID:n | Åtgärder och rättigheter | Rättad på arbetsgrenen |
| GUI-009 | Driftuppgifter har engelska rubriker och många statusknappar | Åtgärder och rättigheter | Rättad på arbetsgrenen |
| GUI-010 | Nollvärden ritas som positiva diagramstaplar | Analys och läsunderlag | Rättad på arbetsgrenen |
| GUI-011 | Säkerhet på 0 procent visas som saknad | Analys och läsunderlag | Rättad på arbetsgrenen |
| GUI-012 | Avvikelsekort säger totalt men räknar högst 50 poster | Analys och läsunderlag | Rättad på arbetsgrenen |
| GUI-013 | Prognosexport tappar sidans filter | Analys och läsunderlag | Rättad på arbetsgrenen |
| GUI-014 | Visa detaljer saknar länk för många avvikelseobjekt | Analys och läsunderlag | Rättad på arbetsgrenen |
| GUI-015 | Analystabeller kan klippa kolumner på mobil | Analys och läsunderlag | Rättad på arbetsgrenen |
| GUI-016 | Analysflikar saknar aria-current | Analys och läsunderlag | Rättad på arbetsgrenen |
| GUI-017 | Revisionsloggen visar tekniska kolumner och koder för bolag | Register och fakturaunderlag | Rättad på arbetsgrenen |
| GUI-018 | Fullmaktsregistret har Tenant-kolumn även för bolag | Fullmakter | Rättad på arbetsgrenen |
| GUI-019 | Kundtypsfilter i analys saknar Förening | Analys och läsunderlag | Rättad på arbetsgrenen |
| GUI-020 | Saknad analysrelation behandlas som noll/inga ärenden | Analys och läsunderlag | Rättad på arbetsgrenen |
| GUI-021 | Avtalskatalogens återkoppling använder readiness/canonical/immutable | Register och fakturaunderlag | Rättad på arbetsgrenen |
| GUI-022 | Avbrutna flyttar och byten räknas som pågående | Kundärenden och leveranser | Rättad på arbetsgrenen |
| GUI-023 | Arbetsköns kunduppslag kapas till 100 och kan utelämna jobb | Register och fakturaunderlag | Rättad på arbetsgrenen |
| GUI-024 | Läsfel för portalsvar blir tyst inga svar | Register och fakturaunderlag | Rättad på arbetsgrenen |
| GUI-025 | Begärandelistor visar högst tolv poster utan vidarevisning på sidan | Register och fakturaunderlag | Rättad på arbetsgrenen |
| GUI-026 | Saknad juridikprofil beskrivs som komplett | Bolagsinställningar | Rättad på arbetsgrenen |
| GUI-027 | Arbetskön visar råa tekniska fel för bolag | Register och fakturaunderlag | Rättad på arbetsgrenen |
| GUI-028 | Svarssammanfattning visar tekniska nycklar när fri text saknas | Register och fakturaunderlag | Rättad på arbetsgrenen |
| GUI-029 | Senaste faktureringsunderlag är 80 osorterade poster | Register och fakturaunderlag | Rättad på arbetsgrenen |
| GUI-030 | Prisberäkning väljs ur högst 200 osorterade körningar | Register och fakturaunderlag | Rättad på arbetsgrenen |
| GUI-031 | Prisrader kapas före körningsfilter men totalsumman är fullständig | Register och fakturaunderlag | Rättad på arbetsgrenen |
| GUI-032 | Fakturadetaljer visar tekniska ID:n, typkoder och hashvärden | Register och fakturaunderlag | Rättad på arbetsgrenen |
| GUI-033 | Förbättring av precision för små energivolymer i MWh | Analys och läsunderlag | Rättad på arbetsgrenen |
| GUI-034 | Analysens standardmånad blir fel vid svenskt månadsskifte | Analys och läsunderlag | Rättad på arbetsgrenen |
| GUI-035 | Fakturadetaljen saknar separat exportfel/leveransstatus | Register och fakturaunderlag | Rättad på arbetsgrenen |
| GUI-036 | Faktureringskontrollen döljer blockerare efter de tre första | Register och fakturaunderlag | Rättad på arbetsgrenen |
| GUI-037 | Partnerexporter har stort redigeringsformulär på varje rad | Åtgärder och rättigheter | Rättad på arbetsgrenen |
| GUI-038 | Partnerexporters filter saknar tydliga programmässiga etiketter | Åtgärder och rättigheter | Rättad på arbetsgrenen |
| GUI-039 | Prognoskorten tappar vald månad och nästa-månad-länken går till aktuell månad | Analys och läsunderlag | Rättad på arbetsgrenen |
| GUI-040 | Historisk analys kan visa dagens bestånd när månadsunderlag saknas | Analys och läsunderlag | Rättad på arbetsgrenen |
| GUI-041 | Elområdesdiagram blandar antal mätpunkter och kWh | Analys och läsunderlag | Rättad på arbetsgrenen |
| GUI-042 | Datakvalitetskortets definition och förklaring är oklara | Analys och läsunderlag | Rättad på arbetsgrenen |
| GUI-043 | Saknad månadsprognos ersätts med beräkningslös nolla | Analys och läsunderlag | Rättad på arbetsgrenen |
| GUI-044 | Kundintag erbjuder registrering/import för en läsbehörighet | Registrering och signering | Rättad på arbetsgrenen |
| GUI-045 | Signeringssidan visar skicka-formulär för avtalsläsare | Registrering och signering | Rättad på arbetsgrenen |
| GUI-046 | Nästa-steg-länk efter registrering leder till dold uppgiftsflik | Registrering och signering | Rättad på arbetsgrenen |
| GUI-047 | Skapa ny kund använder ett oanvänt återställningsargument | Registrering och signering | Rättad på arbetsgrenen |
| GUI-048 | Direkt uppgiftsbegäran efter kundskapande kräver en annan rättighet än UI visar | Registrering och signering | Rättad på arbetsgrenen |
| GUI-049 | Skapa begäran efter registrering saknar synlig resultatåterkoppling | Registrering och signering | Rättad på arbetsgrenen |
| GUI-050 | Datakvalitet visar tekniska termer och råfel i bolagsvyn | Register och fakturaunderlag | Rättad på arbetsgrenen |
| GUI-051 | Kundansökningar erbjuder en logglänk till en målvy användaren kan nekas | Åtgärder och rättigheter | Rättad på arbetsgrenen |
| GUI-052 | Integrationsläsare erbjuds testutskick, omsändning och ignorerande | Åtgärder och rättigheter | Rättad på arbetsgrenen |
| GUI-053 | Resultat efter webhookåtgärder skickas i URL men visas inte | Åtgärder och rättigheter | Rättad på arbetsgrenen |
| GUI-054 | Osignerad fullmakt kan samtidigt visas som registrerat godkännande | Fullmakter | Rättad på arbetsgrenen |
| GUI-055 | Fullmaktsregistrets dataläsning kan tappa acceptansbevis och visa fel status | Fullmakter | Rättad på arbetsgrenen |
| GUI-056 | Anslutningsloggen blandar engelska, råpayload och användaråtgärder för bolag | Åtgärder och rättigheter | Rättad på arbetsgrenen |
| GUI-057 | Genvägar mellan mätvärden, support, kundkort och fakturor saknar målbehörighet | Kundärenden och leveranser | Rättad på arbetsgrenen |
| GUI-058 | Byteslistan och aktiveringskön erbjuder skrivåtgärder till bytesläsare | Kundärenden och leveranser | Rättad på arbetsgrenen |
| GUI-059 | Manuellt statusval erbjuder marknadsstyrda tillstånd som servern alltid nekar | Kundärenden och leveranser | Rättad på arbetsgrenen |
| GUI-060 | Avbrutet före leveransstart tolkas som fortsatt handläggning i bytesvyer | Kundärenden och leveranser | Rättad på arbetsgrenen |
| GUI-061 | Supportdetaljen saknar den ursprungliga ärendebeskrivningen | Kundärenden och leveranser | Rättad på arbetsgrenen |
| GUI-062 | Supportens svenska kundstatusförklaring skriver ut engelska API-statusar | Kundärenden och leveranser | Rättad på arbetsgrenen |
| GUI-063 | Byteslistan använder teknisk arbetsmodell trots en affärsanpassad detaljvy | Kundärenden och leveranser | Rättad på arbetsgrenen |
| GUI-064 | Aktiveringskön visar önskat datum som startdatum trots ändrad bekräftad start | Kundärenden och leveranser | Rättad på arbetsgrenen |
| GUI-065 | Bytessökning och handläggningsfilter arbetar först efter ett urval på 200 ärenden | Kundärenden och leveranser | Rättad på arbetsgrenen |
| GUI-066 | Byteslistans handläggningsfilter saknar väntan på nätägarbekräftelse och startdatum | Kundärenden och leveranser | Rättad på arbetsgrenen |

GUI-042 förtydligas till faktisk **mätvärdestäckning**; en bredare kvalitetsdefinition har inte hittats på. GUI-015 och GUI-047 har verifierats i isolerad webbläsare med faktiska komponenter. Kundförvalet för GUI-046 verifieras i det faktiska uppgiftsformuläret, inklusive bolags-/kundgräns och återställning av beroende anläggning/mätpunkt.

## Projektets egna arbetsflöden

Ingen lösning eller bedömning utgår från systemdemot. Fallen nedan kommer från OPS main och täcks här genom källspårning, inerta regressioner och avgränsade komponentprov. Autentiserade helsystemskörningar mot databasen är inte utförda i denna ändring.

| Fall | Arbetsuppgift | Verifierad del och begränsning |
| --- | --- | --- |
| P-01 | Registrera kund | Läs-/skrivgräns, bevarad formulärdata, första och upprepad återställning; ingen verklig kund registreras i provet. |
| P-02 | Teckna och signera kundavtal | Signeringsbehörighet och bevarade serverkrav; ingen verklig signeringslänk skickas. |
| P-03 | Begära kund-/anläggningsuppgifter | Säkert kommandoresultat, målbehörighet, kundförval i rätt formulär och beroende resursval; inerta åtgärder. |
| P-04 | Följa leverantörsbyte eller inflytt | Affärsstatus, väntelägen, bekräftad start, terminalitet, sökning efter äldre kunder och stabil fortsättning. |
| P-05 | Förklara och hantera faktura | Komplett valt underlag, prisberäkningsrader, blockorsaker samt separat godkännande/överföring; inga riktiga fakturor skickas. |
| P-06 | Hantera kundkontakt | Ursprunglig beskrivning, svensk kundstatus och behörigt kundlänkmål; inget verkligt svar skickas. |
| P-07 | Anmäla utflytt och förstå historik | Avbrutna byten/flyttar räknas inte som aktiva; historik och befintliga domänspärrar bevaras. |
| P-08 | Analysera och följa upp | Period, historik, null/noll, fullständighet, mätvärdestäckning och export av valt urval; syntetiska läsportar. |

## Verifiering och leverans

Sammansatt verifiering: **440/440 tester i 23 filer**, full app-/test-/skripttypkontroll, lint (**0 fel, 164 varningar**), statisk RBAC (**24 kontroller, 0 varningar**) och produktionsbygge passerar. Slutlig testkörning, testtypkontroll och produktionsbygge använder projektets Node 22.23.5. De två sammansatta testtypfelen rättades genom uttrycklig rolltyp och komplett syntetisk mätvärdesrad; inga kontrollpåståenden togs bort. Paketens test- och webbläsarbevis har begränsats till exakt de källversioner som faktiskt provats. Tidigare större CI-/nativekörningar räknas inte som nya bevis för ändrad kod.

- App-, test- och skripttyper samt lint kontrolleras på den sammansatta grenen.
- Riktade affärs-, roll-, bolags-, null/noll-, cap-, sidindelnings- och återhämtningsregressioner körs.
- Faktiska komponenter provas i isolerad webbläsare på 320, 390 och/eller 1280 px efter relevant ändring.
- Produktionsbygge och statisk RBAC-kontroll körs utan schema-/producentändring.
- Två oberoende slutgranskare binder sina besked till den sammansatta slutversionen.
