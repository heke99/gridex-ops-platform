
-- Gridex OPS legal defaults, effective-source readiness, legal-profile repair
-- and canonical email automation completion.
-- Forward-only migration: never modifies already locked legal versions.

begin;
create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;
set local search_path=public,extensions,pg_temp;

-- Seed rows are embedded directly in atomic statements below.
-- No TEMP, UNLOGGED, staging-schema or migration-only relation is used.
-- This is safe in Supabase SQL Editor, CLI and normal migration runners.

do $gridex_legal_seed$
declare
  r record;
  v_template_id uuid;
  v_hash text;
  v_version integer;
begin
  for r in
    select *
    from (values
      ($gridex$general_consumer_terms$gridex$,$gridex$Allmänna konsumentvillkor$gridex$,$gridex$Grundvillkor för privatkund$gridex$,$gridex$Allmänna konsumentvillkor$gridex$,$gridex$1. Tillämpning och avtalspart
Dessa villkor gäller för elleverans till privatkund mellan {{legal_name}}, organisationsnummer {{organization_number}}, med adress {{company_address}}, och den kund som anges i avtalsbekräftelsen. Villkoren kompletteras av produktversionen, den låsta prisversionen, förköpsinformationen och övriga dokument som kunden accepterar. Vid motstridighet gäller tvingande lag före avtalet och särskilda, uttryckligen angivna villkor före allmänna villkor.

2. Avtalets ingående och omfattning
Avtalet blir bindande när kundens accept har registrerats, nödvändiga identitets- och anläggningsuppgifter har kontrollerats och {{legal_name}} har skickat avtalsbekräftelse i varaktig form. Avtalet gäller endast den eller de anläggningar, prisområden och leveransperioder som framgår av avtalsbekräftelsen. Kunden ansvarar för att lämnade uppgifter är riktiga och för att meddela ändringar utan dröjsmål.

3. Leverans, mätvärden och nätberoenden
Elleveransen förutsätter ett giltigt nätavtal och att nätägaren kan genomföra marknadsprocesserna. Nätägaren ansvarar för elnät, mätare och rapportering av mätvärden. {{legal_name}} använder nätägarens validerade mätvärden och får korrigera fakturering när mätvärden rättas eller kompletteras.

4. Pris, avgifter och betalning
Kunden betalar de priser, påslag, fasta avgifter, skatter och övriga komponenter som finns i den låsta prisversionen. Faktura ska betalas senast på förfallodagen. Invändningar mot faktura ska göras så snart som möjligt. Ostridigt belopp ska betalas även om en del av fakturan bestrids.

5. Kundens skyldigheter
Kunden ska ge tillträde och information som krävs för leveransen, inte manipulera mätutrustning och utan dröjsmål informera om flytt, ägarbyte eller andra förändringar. Kunden ansvarar för kostnader som uppkommer på grund av väsentligt felaktiga eller ofullständiga uppgifter i den utsträckning lag medger.

6. Uppsägning, avtalsbrott och avstängning
Uppsägningstid, bindningstid och eventuell brytavgift framgår av avtalsbekräftelsen. Vid utebliven betalning eller annat väsentligt avtalsbrott får {{legal_name}} vidta påminnelse-, inkasso- och övriga åtgärder enligt lag. Avstängning får endast ske när tillämpliga rättsliga krav och marknadsprocesser är uppfyllda.

7. Ansvar och force majeure
Parterna ansvarar för direkt skada som orsakats genom avtalsbrott enligt tvingande rätt. {{legal_name}} ansvarar inte för fel i nätägarens anläggning, marknadsaktörers system eller andra omständigheter utanför rimlig kontroll, men ska vidta skäliga åtgärder för att begränsa konsekvenserna.

8. Kontakt, klagomål och personuppgifter
Kundservice nås på {{customer_service_email}}, telefon {{phone}} och {{website}}. Klagomål lämnas till {{complaints_email}}. Personuppgifter behandlas enligt den versionslåsta integritetspolicyn. Dessa villkor gäller från den tidpunkt som anges i avtalsbekräftelsen och ändras inte retroaktivt för redan ingångna avtal.$gridex$,true),
      ($gridex$general_business_terms$gridex$,$gridex$Allmänna företagsvillkor$gridex$,$gridex$Grundvillkor för företagskund$gridex$,$gridex$Allmänna företagsvillkor$gridex$,$gridex$1. Parter och tillämpning
Dessa villkor gäller mellan {{legal_name}}, organisationsnummer {{organization_number}}, och den företagskund som anges i avtalsbekräftelsen. Avtalet består av avtalsbekräftelsen, produktversionen, prisversionen, eventuella särskilda villkor och dessa allmänna företagsvillkor. Särskilda skriftliga villkor har företräde framför allmänna villkor.

2. Behörighet och avtalets ingående
Den som accepterar avtalet för kundens räkning försäkrar att behörighet finns. {{legal_name}} får begära registreringsbevis, fullmakt eller annan dokumentation. Avtalet blir bindande när accepten har registrerats och bekräftats. Kunden ansvarar för korrekta bolags-, kontakt-, kredit- och anläggningsuppgifter.

3. Leveransomfattning
Leveransen avser angivna anläggningar och förutsätter giltigt nätavtal. Nätägaren ansvarar för nät, mätning och mätvärdesrapportering. Förändringar i anläggningsbestånd, förbrukningsprofil eller verksamhet ska meddelas utan dröjsmål när de kan påverka pris, risk eller leverans.

4. Pris och kommersiella komponenter
Priset bestäms av den låsta prisversionen och kan innehålla spot-, fast-, portfölj- eller mixkomponenter, påslag, fasta avgifter, profilkostnader, kreditkostnader, skatter och moms. Kunden har inte rätt att åberopa senare publicerade prisversioner. Rättelser av mätvärden kan medföra efterdebitering eller kreditering.

5. Fakturering och betalning
Fakturering sker enligt avtalad period. Betalning ska vara {{legal_name}} tillhanda senast på förfallodagen. Vid dröjsmål får dröjsmålsränta, påminnelse- och inkassokostnader tas ut enligt lag och avtal. {{legal_name}} får begära säkerhet, förskottsbetalning eller ändrade betalningsvillkor vid försämrad kreditvärdighet.

6. Prognoser och avvikelser
Om avtalet bygger på prognostiserad volym eller profil ska kunden lämna rimliga och uppdaterade prognoser. Väsentliga avvikelser får hanteras enligt den låsta prisversionen och särskilda volymvillkor. Kunden ska informera om planerade förändringar som väsentligt påverkar uttag eller produktion.

7. Avtalsbrott och upphörande
Part får säga upp eller häva avtalet vid väsentligt avtalsbrott som inte rättas inom skälig tid efter skriftlig anmodan. Omedelbara åtgärder får vidtas vid insolvens, otillåten användning, väsentligt felaktiga uppgifter eller annan allvarlig risk. Betalnings- och sekretessförpliktelser som till sin natur ska bestå gäller efter avtalets slut.

8. Ansvar
Parts ansvar omfattar styrkt direkt skada som orsakats genom vårdslöshet eller avtalsbrott. Indirekt skada, utebliven vinst eller produktionsbortfall ersätts endast vid uppsåt, grov vårdslöshet eller när tvingande lag kräver det. Ansvarsbegränsningar gäller inte personskada eller annat ansvar som inte lagligen kan begränsas.

9. Kommunikation och tvist
Meddelanden skickas till registrerade kontaktuppgifter. Kunden ska hålla dem aktuella. Klagomål lämnas till {{complaints_email}}. Tvistlösning sker enligt {{dispute_resolution_information}} och svensk rätt, om inte särskilt avtalats. Kontakt: {{customer_service_email}}, {{phone}}, {{website}}.$gridex$,true),
      ($gridex$variable_price_terms$gridex$,$gridex$Månadsprisvillkor$gridex$,$gridex$Prisförklaring för månadsrörligt avtal$gridex$,$gridex$Särskilda villkor för månadspris$gridex$,$gridex$1. Prismodell
Månadspriset baseras på det spotmedel som anges i den låsta prisversionen för kundens elområde och kalendermånad. Prisversionen anger om medlet är enkelt, volymvägt, profilvägt eller beräknat enligt annan uttryckligen definierad metod.

2. Prisområde och tidsperiod
Kundens prisområde följer anläggningens nätområde och den marknadsindelning som gäller under leveransperioden. Om en anläggning flyttas till ett annat prisområde används det nya området från den tidpunkt marknadsdata och nätägarens registrering visar.

3. Påslag och avgifter
Spotmedlet justeras med avtalade påslag, fasta månadsavgifter, profil- eller balanskostnader, ursprungsgarantier, skatter, moms och andra uttryckligen angivna komponenter. Inga ej versionslåsta avgifter får läggas till kundens avtal.

4. Fastställande och publicering
Priset kan fastställas först när fullständiga marknadsdata och mätvärden finns. Faktura kan därför innehålla preliminära värden som senare rättas. Metod, datakälla och avrundningsregler ska vara desamma som i den prisversion kunden accepterade.

5. Negativa priser och korrigeringar
Negativa spotpriser hanteras enligt prisversionens uttryckliga regel. Korrigerade marknads- eller mätvärden kan medföra kreditering eller efterdebitering. Rättelsen ska kunna härledas till period, prisområde och använd dataversion.

6. Avtalets fortsatta giltighet
Ändring av OPS-standardmall, publicerad prisplan eller framtida påslag påverkar inte redan ingångna avtal. En ändring för kunden kräver ny avtals- eller prisversion och rättsligt giltig information eller accept.$gridex$,false),
      ($gridex$hourly_price_terms$gridex$,$gridex$Timprisvillkor$gridex$,$gridex$Prisförklaring för timavräknat avtal$gridex$,$gridex$Särskilda villkor för timpris$gridex$,$gridex$1. Timvis prissättning
Varje validerat förbrukningsvärde prissätts mot spotpriset för motsvarande leveranstimme i kundens elområde. Prisversionen anger datakälla, valuta, enhet, påslag och övriga komponenter.

2. Mätvärden
Nätägarens validerade timvärden är grund för avräkning. Om timvärden saknas får preliminära, estimerade eller aggregerade värden användas enligt marknadsregler. När slutliga värden blir tillgängliga får fakturan korrigeras.

3. Sommar- och vintertid
Tidsstämplar följer marknadens officiella tidszon och dygn kan därför innehålla 23, 24 eller 25 timmar. Varje marknadsperiod kopplas till motsvarande mätperiod utan dubbelräkning eller bortfall.

4. Kostnadskomponenter
Spotkostnaden kompletteras med avtalat påslag, fasta avgifter, profil- och balanskostnader, ursprungsrelaterade kostnader, skatter och moms enligt den låsta prisversionen.

5. Datakvalitet och rättelser
Om marknadsdata eller mätvärden ändras ska rättelsen vara spårbar till den ursprungliga perioden. Kunden kan begära underlag över använda timvärden, priser och beräkningskomponenter i den utsträckning data får lämnas ut.

6. Kundens förutsättningar
Timpris förutsätter att anläggningen kan mätas och rapporteras med nödvändig upplösning. Om detta inte längre är möjligt ska kunden informeras och får erbjudas ny prismodell genom en ny avtalsversion.$gridex$,false),
      ($gridex$quarterly_price_terms$gridex$,$gridex$Kvartsprisvillkor$gridex$,$gridex$Prisförklaring för kvartsmätt avtal$gridex$,$gridex$Särskilda villkor för kvartspris$gridex$,$gridex$1. Kvartsvis prissättning
Förbrukning eller produktion prissätts per marknadskvart mot priset för samma kvart och elområde. Varje kvart ska kunna kopplas till nätägarens validerade mätvärde och marknadens prisdataversion.

2. Upplösning och tidsstämplar
Avräkningen följer gällande svensk och europeisk marknadsupplösning. Övergångar mellan tidsupplösningar, sommartid och vintertid ska hanteras utan att energi dupliceras eller förloras.

3. Saknade eller bristfälliga värden
Om kvartsvärden saknas, försenas eller underkänns får nätägarens estimat eller annan tillåten avräkningsmetod användas preliminärt. När validerade värden erhålls görs korrigering.

4. Prisets beståndsdelar
Kvartspriset kompletteras med påslag, fasta avgifter, profil- och balanskostnader, skatter, moms och övriga komponenter i den låsta prisversionen. Negativa priser hanteras enligt samma version.

5. Transparens
Fakturaunderlaget ska göra det möjligt att följa period, energi, spotpris, påslag och avrundning. Sammanställningar får visas aggregerat men underliggande bevis ska bevaras.

6. Tekniska förutsättningar
Kvartspris får endast publiceras när juridikregel, prisregel och mätförutsättningar finns. Om tillräcklig upplösning saknas ska publicering eller fortsatt tillämpning blockeras tills en giltig lösning finns.$gridex$,false),
      ($gridex$fixed_price_terms$gridex$,$gridex$Fastprisvillkor$gridex$,$gridex$Pris, bindning och giltighet för fastpris$gridex$,$gridex$Särskilda villkor för fastpris$gridex$,$gridex$1. Fast pris
Kunden betalar det fasta energipris per kWh och de fasta avgifter som anges i den låsta prisversionen. Priset gäller för angiven leveransperiod, anläggning och eventuella volymförutsättningar.

2. Bindningstid och giltighet
Startdatum, slutdatum, bindningstid och sista giltighetsdag för erbjudandet framgår av avtalsbekräftelsen. Ett erbjudande som accepteras efter giltighetstidens slut kräver ny bekräftad version.

3. Skatter och reglerade avgifter
Skatter, moms och myndighetsbeslutade kostnader hanteras enligt prisversionen och tillämplig lag. En reglerad förändring får vidareföras endast när avtalet eller tvingande rätt medger det och kunden informeras korrekt.

4. Volym och användning
Om fastpriset förutsätter angiven volym eller profil framgår toleranser och avvikelsekostnader av pris- och volymvillkoren. Väsentligt ändrad verksamhet ska meddelas utan dröjsmål.

5. Förtida upphörande
Eventuell brytavgift ska vara tydligt angiven eller beräkningsbar enligt avtalet. För privatkund tillämpas endast avgifter som är skäliga och tillåtna. Vid flytt eller annan särskild situation gäller vad avtalet och lag anger.

6. Efter bindningstid
Avtalsbekräftelsen anger om avtalet upphör, förlängs eller övergår till annan prismodell. Automatisk övergång kräver att informations- och uppsägningsregler följs. En framtida prisversion påverkar inte perioden med låst fastpris.$gridex$,false),
      ($gridex$mixed_price_terms$gridex$,$gridex$Mixprisvillkor$gridex$,$gridex$Prisvillkor för kombinerade prismodeller$gridex$,$gridex$Särskilda villkor för mixpris$gridex$,$gridex$1. Mixens sammansättning
Mixpriset består av två eller flera prisdelar som anges i den låsta prisversionen, exempelvis spot, fast pris och portföljpris. Vikterna ska tillsammans vara exakt 100 procent.

2. Beräkning
Varje prisdel beräknas enligt sin egen definierade metod för samma leveransperiod och elområde. Resultaten multipliceras med respektive vikt och summeras före påslag, fasta avgifter, skatter och moms, om prisversionen inte uttryckligen anger annan ordning.

3. Ändring av vikter
Vikter och komponenter är låsta för kundens version. De får inte ändras genom att administratören redigerar en senare prisplan. Ändring kräver ny pris- och avtalsversion samt giltig information eller accept.

4. Mätvärden och datakvalitet
Den upplösning som krävs av respektive komponent ska finnas. Saknade värden hanteras enligt den mest detaljerade tillämpliga mätregeln och rättas när validerade data erhålls.

5. Avgifter och negativa priser
Påslag, fasta avgifter, profilkostnader, negativa priser och andra komponenter hanteras enligt prisversionen. Samma kostnad får inte tas ut dubbelt i flera delar av mixen.

6. Redovisning
Avtalsbekräftelse och fakturaunderlag ska visa vikter, komponenternas metod och den sammanlagda beräkningen så att priset kan kontrolleras i efterhand.$gridex$,false),
      ($gridex$portfolio_terms$gridex$,$gridex$Portföljvillkor$gridex$,$gridex$Prisvillkor för spot- och portföljmix$gridex$,$gridex$Särskilda villkor för portföljavtal$gridex$,$gridex$1. Portföljmodell
Månadspriset beräknas som månadens definierade spotmedel multiplicerat med spotandelen plus månadens portföljpris multiplicerat med portföljandelen. Andelarna finns i den låsta prisversionen och ska tillsammans motsvara 100 procent.

2. Spotdel
Spotdelen använder det elområde, den tidsperiod, datakälla och den viktning som anges i prisversionen. Påslag och avgifter ska anges separat eller uttryckligen ingå i formeln.

3. Portföljdel
Portföljpriset fastställs enligt den dokumenterade inköps-, säkrings- eller indexmetod som hör till prisversionen. Metoden ska ange vilka kostnader som ingår, hur valutahantering och avrundning sker och när priset blir slutligt.

4. Transparens och intressekonflikter
{{legal_name}} ska kunna beskriva beräkningsmetoden utan att behöva lämna ut affärshemlig transaktionsinformation. Metoden får inte ändras retroaktivt. Intressekonflikter ska hanteras så att kunden inte belastas med kostnader utanför avtalet.

5. Volym och avvikelser
Om portföljpriset bygger på prognostiserad volym ska toleranser, ombalansering och avvikelsekostnader framgå av pris- eller volymvillkoren. Rättelser ska vara spårbara.

6. Fakturering
Fakturering kan vara preliminär tills slutliga portfölj- och mätdata finns. Slutlig korrigering ska referera till samma låsta metod, vikter och leveransperiod.$gridex$,false),
      ($gridex$price_terms$gridex$,$gridex$Pris- och betalningsvillkor$gridex$,$gridex$Gemensamma kommersiella villkor$gridex$,$gridex$Pris- och betalningsvillkor$gridex$,$gridex$1. Låst kommersiell version
Kundens priser bestäms uteslutande av den prisversion och de priskomponenter som låstes när avtalet ingicks. Senare redigeringar av produktnamn, prisplan eller standardvärden påverkar inte avtalet.

2. Prisets komponenter
Prisversionen ska redovisa energipris, spot- eller indexreferens, påslag, fasta avgifter, rabatter, profil- och balanskostnader, ursprungsrelaterade kostnader, skatter, moms och övriga tillägg. En komponent som inte finns i versionen får inte debiteras.

3. Enheter och avrundning
Varje komponent ska ha enhet, valuta, momsbehandling och avrundningsregel. Summering ska ske på ett konsekvent sätt och kunna reproduceras från bevarade mät- och prisdata.

4. Betalning
Faktura ska betalas på förfallodagen till angivet betalningssätt. Kunden ansvarar för att kontakt- och faktureringsuppgifter är aktuella. Betalning anses genomförd när beloppet kommit mottagaren tillhanda.

5. Invändningar och rättelser
Fakturainvändning ska göras utan oskäligt dröjsmål och ange vilken post som ifrågasätts. Ostridigt belopp ska betalas. Felaktig debitering korrigeras genom kredit, tilläggsfaktura eller justering på kommande faktura.

6. Prisändringar
Prisändring under löpande avtal får endast ske när avtalet och lag medger det. Kunden ska få den information, framförhållning och uppsägningsmöjlighet som krävs. Ändringen ska skapa ny version eller annan spårbar rättslig grund.

7. Kontakt
Frågor om pris och betalning hanteras enligt {{billing_information}} eller via {{customer_service_email}}.$gridex$,true),
      ($gridex$billing_terms$gridex$,$gridex$Faktureringsvillkor$gridex$,$gridex$Fakturering, rättelser och betalning$gridex$,$gridex$Faktureringsvillkor$gridex$,$gridex$1. Faktureringsperiod
Fakturering sker månadsvis eller enligt den period som anges i avtalsbekräftelsen. Fakturan ska identifiera kund, anläggning, period, använd prisversion och relevanta mätvärden.

2. Mätvärden
Faktura baseras på nätägarens validerade värden. Om slutliga värden saknas får preliminär eller estimerad fakturering användas när marknadsregler medger det. När slutliga värden kommer görs en spårbar korrigering.

3. Fakturans innehåll
Fakturan ska visa energi, pris, påslag, fasta avgifter, skatter, moms, rabatter, tidigare saldo och förfallodag. För dynamiska priser ska tillräckligt underlag eller hänvisning finnas för att kunden ska kunna kontrollera beräkningen.

4. Leveranssätt
Faktura skickas till registrerad e-post, e-fakturaadress, postadress eller annat avtalat medium. Kunden ska meddela ändrade uppgifter. Utebliven mottagning befriar inte från betalning när fakturan skickats till avtalad adress.

5. Betalning och dröjsmål
Betalning ska vara mottagaren tillhanda senast på förfallodagen. Vid dröjsmål kan ränta, påminnelseavgift och inkassokostnader tas ut enligt lag och avtalet.

6. Rättelser och återbetalning
Felaktigt belopp korrigeras utan onödigt dröjsmål. Återbetalning eller kvittning ska kunna kopplas till ursprungsfakturan. Efterdebitering ska följa tillämpliga preskriptions- och konsumentskyddsregler.

7. Faktureringskontakt
Tenantens faktureringsinformation är: {{billing_information}}. Frågor kan även skickas till {{customer_service_email}}.$gridex$,true),
      ($gridex$pre_contract_information$gridex$,$gridex$Förköpsinformation$gridex$,$gridex$Information innan privatkund ingår avtal$gridex$,$gridex$Förköpsinformation$gridex$,$gridex$Innan kunden accepterar avtalet ska följande visas tydligt och kunna sparas:

1. Avtalspart
{{legal_name}}, organisationsnummer {{organization_number}}, adress {{company_address}}, kontakt {{customer_service_email}}, telefon {{phone}} och webbplats {{website}}.

2. Produkt och leverans
Produktens namn, kundtyp, prismodell, elområde, förväntat startdatum, avtalstid, bindningstid, uppsägningstid, automatisk förlängning och om fullmakt krävs.

3. Pris
Samtliga prisdelar, enheter, påslag, fasta avgifter, rabatter, skatter, moms och sättet för framtida prisberäkning. För rörligt pris ska referensmarknad och tidsupplösning framgå.

4. Fakturering och betalning
Faktureringsperiod, betalningssätt, förfallotid, rättelseprinciper och konsekvenser av utebliven betalning.

5. Ångerrätt och leverans under ångerfrist
När ångerrätt gäller ska frist, starttidpunkt, ångerblankett och kontaktväg visas. Om kunden begär leverans under ångerfristen ska konsekvenserna förklaras.

6. Klagomål och tvist
Klagomålsväg, dataskyddskontakt och tillämplig tvistlösning ska anges.

7. Varaktigt bevis
Den information kunden såg ska låsas tillsammans med avtals-, pris- och juridikversionerna och återges i avtalsbekräftelsen eller bilagor.$gridex$,false),
      ($gridex$distance_contract_information$gridex$,$gridex$Information om distansavtal$gridex$,$gridex$Information för avtal som ingås på distans$gridex$,$gridex$Information om distansavtal$gridex$,$gridex$1. Distansförfarande
Avtalet ingås utan att parterna samtidigt är fysiskt närvarande, exempelvis via webb, telefon eller e-post. Kunden ska före accept få all obligatorisk information på ett klart och begripligt sätt.

2. Identifiering av avtalspart
Avtalspart är {{legal_name}}, organisationsnummer {{organization_number}}, adress {{company_address}}. Kundservice nås via {{customer_service_email}}, {{phone}} och {{website}}.

3. Beställningssteg
Kunden ska kunna kontrollera och korrigera uppgifter innan bindande accept. Den knapp eller åtgärd som slutför beställningen ska tydligt ange att den medför betalningsskyldighet när detta krävs.

4. Bekräftelse
Efter accept skickas en avtalsbekräftelse i varaktig form med produkt, pris, startdatum, juridiska dokument, ångerrätt och bevisreferens. Bekräftelsen ska gå att återöppna under avtalets och bevisets lagringstid.

5. Ångerrätt
När kunden har lagstadgad ångerrätt gäller den versionslåsta informationen om ångerrätt och ångerblanketten. Begäran om leverans under ångerfristen ska registreras separat när det krävs.

6. Kommunikation
Elektroniska meddelanden skickas till den adress kunden angett. Kunden ansvarar för att adressen är korrekt men {{legal_name}} ska logga utskick och bevara innehåll, mallversion och leveransstatus.$gridex$,false),
      ($gridex$withdrawal_right$gridex$,$gridex$Ångerrätt$gridex$,$gridex$Konsumentens ångerrätt$gridex$,$gridex$Information om ångerrätt$gridex$,$gridex$1. Rätt att frånträda
När distansavtalslagen eller annan tvingande rätt är tillämplig har privatkunden rätt att frånträda avtalet inom den ångerfrist som anges i avtalsbekräftelsen, normalt räknad från den dag kunden fått fullständig information och bekräftelse.

2. Hur ånger utövas
Kunden ska lämna ett klart meddelande om beslutet att frånträda avtalet. Meddelandet kan skickas till {{customer_service_email}} eller den kontaktväg som anges i avtalsbekräftelsen. Kunden kan använda ångerblanketten men det är inte ett krav.

3. Uppgifter i meddelandet
Meddelandet bör innehålla kundens namn, avtalsnummer, anläggningsadress eller anläggnings-ID och datum. {{legal_name}} ska bekräfta mottagen ånger i varaktig form.

4. Leverans under ångerfristen
Om kunden uttryckligen har begärt att leveransen ska börja under ångerfristen kan kunden, i den utsträckning lag medger, bli skyldig att betala ett proportionellt belopp för redan utförd leverans fram till ångermeddelandet.

5. Återbetalning
Belopp som ska återbetalas återbetalas utan onödigt dröjsmål och enligt lagens tidsfrister, med samma betalningssätt om inte annat överenskommits utan kostnad för kunden.

6. Bevis
Tidpunkt för information, kundens begäran om tidig leverans, ångermeddelande och bekräftelse ska loggas och kopplas till kundens låsta avtalsversion.$gridex$,false),
      ($gridex$withdrawal_form$gridex$,$gridex$Ångerblankett$gridex$,$gridex$Mall för konsumentens ånger$gridex$,$gridex$Ångerblankett$gridex$,$gridex$Till: {{legal_name}}, {{company_address}}
E-post: {{customer_service_email}}

Jag meddelar härmed att jag frånträder mitt avtal om elleverans.

Kundens namn: ______________________________________
Person-/kundnummer: _________________________________
Avtalsnummer eller offer reference: __________________
Anläggningsadress: __________________________________
Anläggnings-ID/mätpunkts-ID: __________________________
Datum då avtalet ingicks: _____________________________
Datum då ångermeddelandet lämnas: _____________________

Önskad kontaktväg för bekräftelse: _____________________

Ort och datum: ______________________________________
Kundens underskrift, endast om blanketten lämnas på papper:
____________________________________________________

Blanketten är frivillig. Kunden kan även lämna ett annat tydligt meddelande om att avtalet frånträds. {{legal_name}} bekräftar mottagandet i varaktig form.$gridex$,false),
      ($gridex$privacy_policy$gridex$,$gridex$Integritetspolicy$gridex$,$gridex$Personuppgiftsbehandling$gridex$,$gridex$Integritetspolicy$gridex$,$gridex$1. Personuppgiftsansvarig
{{legal_name}}, organisationsnummer {{organization_number}}, är personuppgiftsansvarig för behandling som sker för egna ändamål. Kontakt för dataskyddsfrågor: {{data_protection_email}}.

2. Uppgifter som behandlas
Behandlingen kan omfatta identitets- och kontaktuppgifter, kund- och avtalsnummer, anläggnings- och mätpunktsuppgifter, mätvärden, pris- och fakturauppgifter, betalningshistorik, fullmakter, kommunikation, tekniska loggar och uppgifter som krävs för marknadsprocesser.

3. Ändamål och rättslig grund
Uppgifter behandlas för att ingå och fullgöra avtal, genomföra leverantörsbyte, fakturera, ge kundservice, hantera klagomål, uppfylla rättsliga skyldigheter, förebygga missbruk och tillvarata berättigade intressen. Samtycke används endast när det är den korrekta rättsliga grunden.

4. Mottagare
Uppgifter kan lämnas till nätägare, systemoperatörer, balansansvariga, mät- och fakturaleverantörer, betalnings- och inkassopartner, myndigheter och personuppgiftsbiträden när det är nödvändigt och lagligt. Biträden ska omfattas av avtal och säkerhetskrav.

5. Lagring
Uppgifter sparas så länge de behövs för avtalet, rättsliga skyldigheter, preskription, bokföring och bevis. Versionslåsta avtals- och kommunikationsbevis får bevaras längre när det krävs för rättsliga anspråk.

6. Kundens rättigheter
Den registrerade kan begära tillgång, rättelse, radering, begränsning, dataportabilitet och invända mot viss behandling när förutsättningarna är uppfyllda. Klagomål kan lämnas till Integritetsskyddsmyndigheten.

7. Säkerhet och incidenter
{{legal_name}} ska använda lämpliga tekniska och organisatoriska säkerhetsåtgärder, behörighetsstyrning, loggning och incidenthantering. Personuppgiftsincidenter anmäls och kommuniceras enligt tillämpliga regler.

8. Kontakt och version
Frågor skickas till {{data_protection_email}}. Den policyversion som kunden fick vid avtalets ingående bevaras som avtalsbevis. Framtida policyuppdateringar ändrar inte historiskt bevis.$gridex$,true),
      ($gridex$power_of_attorney$gridex$,$gridex$Fullmakt$gridex$,$gridex$Fullmakt när leverantörsbyte kräver det$gridex$,$gridex$Fullmakt$gridex$,$gridex$1. Fullmaktsgivare och fullmaktshavare
Kunden ger {{legal_name}}, organisationsnummer {{organization_number}}, rätt att för kundens räkning vidta de åtgärder som uttryckligen anges i den signerade fullmaktssnapshoten.

2. Omfattning
Fullmakten kan omfatta att inhämta anläggnings-, mätpunkts-, avtals- och leverantörsuppgifter, kommunicera med nätägare och nuvarande leverantör, säga upp befintligt elleveransavtal när detta uttryckligen omfattas och initiera leverantörsbyte.

3. Begränsningar
Fullmakten gäller endast angivna anläggningar, syften och giltighetstid. Den ger inte rätt att ingå andra avtal, ändra äganderätt, hantera bankmedel eller företräda kunden utanför den angivna energimarknadsprocessen.

4. Giltighet och återkallelse
Start- och slutdatum framgår av fullmaktsbeviset. Kunden kan återkalla fullmakten genom meddelande till {{customer_service_email}}. Återkallelsen påverkar inte åtgärder som redan genomförts innan den kunde registreras.

5. Uppgifter och sekretess
Uppgifter som inhämtas får endast användas för fullmaktens syfte, avtalsadministration och rättsliga skyldigheter. Behandlingen omfattas av integritetspolicyn.

6. Signering och bevis
Fullmakten ska kopplas till signerande person, behörighet, tidpunkt, IP- och användaragent när tillämpligt, dokumentversion, anläggning och bevis-ID. Om power_of_attorney_required är false får denna modul inte krävas eller signeras som villkor för publicering.$gridex$,false),
      ($gridex$supplier_switch_terms$gridex$,$gridex$Leveransstart och leverantörsbyte$gridex$,$gridex$Process och beroenden för leverantörsbyte$gridex$,$gridex$Leveransstart och leverantörsbyte$gridex$,$gridex$1. Önskat och bekräftat startdatum
Kundens önskade startdatum är preliminärt tills nätägaren och marknadsprocesserna har accepterat bytet. Bindande startdatum är det datum som bekräftas i systemets leverantörsbytesstatus eller senare meddelande.

2. Förutsättningar
Bytet kräver korrekta kund-, anläggnings- och mätpunktsuppgifter, giltigt nätavtal, behörighet och eventuell fullmakt. Befintlig bindningstid eller uppsägningstid kan påverka startdatum och kostnader.

3. Marknadsmeddelanden
{{legal_name}} får skicka och ta emot nödvändiga marknadsmeddelanden via godkända aktörer. Tekniska kvittenser, avslag och kompletteringskrav loggas mot kundens operation.

4. Komplettering
Om uppgifter saknas eller inte stämmer kontaktas kunden via registrerad e-post eller annan avtalad kanal. Bytet får pausas tills tillräckliga uppgifter finns. Kunden ska svara inom angiven tid.

5. Avslag eller försening
Avslag från nätägare eller marknadsaktör betyder inte automatiskt att kundavtalet upphör. {{legal_name}} ska bedöma om rättelse, nytt datum eller manuell handläggning krävs och informera kunden.

6. Befintligt avtal
Kunden ansvarar för att upplysa om känd bindningstid och eventuella kostnader hos tidigare leverantör. När fullmakt omfattar uppsägning ska den användas endast enligt sin ordalydelse.

7. Bevis och kommunikation
Start, statusändringar, kvittenser och kundmeddelanden ska bevaras med correlation ID och kopplas till den låsta avtalsversionen. Kontakt: {{customer_service_email}}.$gridex$,true),
      ($gridex$automatic_renewal$gridex$,$gridex$Automatisk förlängning$gridex$,$gridex$Förlängning, uppsägning och information$gridex$,$gridex$Automatisk förlängning$gridex$,$gridex$1. När modulen gäller
Dessa villkor gäller endast när avtalsversionen uttryckligen anger automatic_renewal=true. Om automatisk förlängning är avstängd får modulen inte läggas till som krav.

2. Förlängningsperiod
Avtalsbekräftelsen anger hur länge varje förlängningsperiod gäller och om avtalet övergår till tillsvidareavtal eller ny bestämd period.

3. Information före förlängning
{{legal_name}} ska inom den tid som lag och avtal kräver informera om kommande förlängning, nytt pris eller nya villkor, sista uppsägningsdag och hur uppsägning görs. Informationen ska skickas i varaktig form och loggas.

4. Kundens rätt att säga upp
Kunden får säga upp avtalet enligt angiven uppsägningstid. För privatkund gäller tvingande konsumentskydd och eventuella begränsningar av automatisk förlängning.

5. Pris och villkor efter förlängning
Nytt pris eller nya villkor får inte tillämpas retroaktivt. De ska vara versionshanterade och ha rättslig grund genom avtal, information och eventuell accept.

6. Bevis
Systemet ska bevara vilken förlängningsregel, mallversion, informationstidpunkt och leveransstatus som användes för varje kund.$gridex$,false),
      ($gridex$termination_and_breach$gridex$,$gridex$Uppsägning och avtalsbrott$gridex$,$gridex$Uppsägning, hävning och avtalsbrott$gridex$,$gridex$Uppsägning och avtalsbrott$gridex$,$gridex$1. Ordinarie uppsägning
Kunden och {{legal_name}} får säga upp avtalet enligt bindnings- och uppsägningstid i avtalsbekräftelsen. Uppsägning bör lämnas via spårbar kanal och ska bekräftas.

2. Flytt och anläggningsförändring
Kunden ska meddela flytt eller överlåtelse i god tid. Om avtalet inte kan fortsätta på ny anläggning hanteras avslut, slutavräkning och eventuell avgift enligt avtalet och lag.

3. Väsentligt avtalsbrott
Väsentligt avtalsbrott kan vara utebliven betalning, väsentligt felaktiga uppgifter, obehörig användning, vägran att medverka till nödvändiga marknadsprocesser eller annat allvarligt brott mot avtalet. Normalt ska den felande parten få skälig tid att rätta felet.

4. Hävning och avstängning
Hävning eller avstängning får endast ske när avtalet och tillämplig rätt medger det. För konsument ska särskilda underrättelse-, proportionalitets- och sociala skyddsregler följas.

5. Slutavräkning
Efter avtalets slut görs slutlig avräkning när validerade mätvärden finns. Betalningsskyldigheter, rättelser, återbetalning och rättsliga anspråk kvarstår i tillämplig omfattning.

6. Dokumentation
Uppsägning, rättelseanmaning, hävning och avslut ska loggas med orsak, aktör, tidpunkt och avtalsversion.$gridex$,true),
      ($gridex$complaints_and_disputes$gridex$,$gridex$Klagomål och tvistlösning$gridex$,$gridex$Klagomål, ARN och domstol$gridex$,$gridex$Klagomål och tvistlösning$gridex$,$gridex$1. Klagomål till bolaget
Klagomål lämnas i första hand till {{complaints_email}}. Kunden bör ange kund- eller avtalsnummer, berörd period, vad som ifrågasätts och önskad rättelse. {{legal_name}} ska registrera ärendet och bekräfta mottagandet.

2. Utredning
Ärendet ska utredas sakligt och utan onödigt dröjsmål. Relevanta avtals-, pris-, mät-, faktura- och kommunikationsbevis ska hämtas från de låsta versionerna. Kunden ska få ett begripligt svar och information om eventuell rättelse.

3. Fortsatt prövning för privatkund
Om parterna inte kommer överens kan privatkund, när nämndens regler är uppfyllda, vända sig till Allmänna reklamationsnämnden. Kunden kan även få vägledning från kommunal konsumentvägledning, Konsumenternas Energimarknadsbyrå eller annan behörig aktör.

4. Myndigheter och tillsyn
Kunden kan kontakta relevanta tillsynsmyndigheter i frågor som faller inom deras ansvarsområde. Ett tillsynsärende ersätter inte alltid prövning av kundens individuella betalnings- eller skadeståndskrav.

5. Företagskund och domstol
Tvist med företagskund avgörs enligt den tvistlösning som anges i avtalet. Om inget annat avtalats tillämpas svensk rätt och svensk allmän domstol.

6. Tenantens information
Aktuell tvistlösningsinformation är: {{dispute_resolution_information}}. Den version som gällde när avtalet ingicks bevaras.$gridex$,true),
      ($gridex$company_information$gridex$,$gridex$Bolags- och kontaktinformation$gridex$,$gridex$Avtalspart och kontaktuppgifter$gridex$,$gridex$Bolags- och kontaktinformation$gridex$,$gridex$Avtalspart: {{legal_name}}
Organisationsnummer: {{organization_number}}
Postadress: {{company_address}}
Kundservice: {{customer_service_email}}
Telefon: {{phone}}
Webbplats: {{website}}
Klagomål: {{complaints_email}}
Dataskydd: {{data_protection_email}}

1. Rätt avtalspart
Ovanstående juridiska person är avtalspart. Gridex eller annan teknisk plattform är inte avtalspart om detta inte uttryckligen anges i avtalsbekräftelsen.

2. Kommunikation
Kunden ska använda angivna kontaktvägar och hålla sina egna uppgifter aktuella. {{legal_name}} får skicka avtalsrelaterad kommunikation till registrerade adresser och ska bevara mallversion och utskicksbevis.

3. Ändrade bolagsuppgifter
Om kontaktuppgifter ändras ska nya uppgifter publiceras. Historiska avtalsbevis ska ändå visa de uppgifter som låstes när avtalet ingicks, med separat information om aktuell kontaktväg när det behövs.$gridex$,true),
      ($gridex$agreement_confirmation$gridex$,$gridex$Avtalsbekräftelse$gridex$,$gridex$Innehåll och bevis för ingånget avtal$gridex$,$gridex$Avtalsbekräftelse$gridex$,$gridex$Avtalsbekräftelsen ska minst innehålla:

1. Parter och identitet
Juridisk avtalspart, organisationsnummer, kundens identitet eller bolag, kontaktuppgifter, kundnummer och avtalsnummer.

2. Anläggning och leverans
Anläggningsadress, anläggnings-ID eller mätpunkts-ID när tillgängligt, elområde, önskat och bekräftat startdatum samt leveransstatus.

3. Produkt och pris
Produktnamn, avtalstyp, kundtyp, bindnings- och uppsägningstid, automatisk förlängning, fullmaktskrav och samtliga pris- och avgiftskomponenter eller en fullständig hänvisning till bifogad låst prisversion.

4. Juridiska dokument
Lista över accepterade juridikmoduler, dokument-ID, versioner och hash samt särskild information om ångerrätt när den gäller.

5. Signeringsbevis
Tidpunkt, kanal, offer reference, publiceringsversions-ID, bevis-ID och de tekniska uppgifter som lagligen får bevaras för att styrka accept.

6. PDF och historik
Bekräftelsen och avtals-PDF ska skapas från samma kundavtal, publiceringsversion, prisversion, juridikversion och tenantsnapshot. Dokumentet ska lagras immutable och kunna verifieras med hash.

7. Kontakt
Frågor hanteras av {{legal_name}} via {{customer_service_email}}.$gridex$,true),
      ($gridex$terms_change_notice$gridex$,$gridex$Ändring av villkor$gridex$,$gridex$Information och versionering vid villkorsändring$gridex$,$gridex$Ändring av villkor$gridex$,$gridex$1. Grundprincip
Publicerade och accepterade juridik-, pris- och avtalsversioner är immutable. En ändring ska skapa en ny version och får inte skriva om historiska kundbevis.

2. Tillåtna ändringar
Villkor får ändras endast när avtalet och lag ger rätt till det, exempelvis på grund av reglering, myndighetsbeslut, tydligt avtalad indexering eller annan angiven grund. Ändringen ska vara sakligt motiverad och proportionerlig.

3. Information till kunden
Meddelandet ska tydligt beskriva nuvarande villkor, nytt villkor, skäl, ikraftträdandedatum, ekonomisk effekt, kundens rättigheter och hur uppsägning eller invändning görs. Information ska lämnas inom föreskriven tid och i varaktig form.

4. Accept när det krävs
Om ändringen inte kan göras ensidigt krävs uttrycklig kundaccept och ny avtalsversion. Passivitet får endast ges betydelse när lag och avtalet tydligt medger det.

5. Bevis
Systemet ska logga mallversion, mottagare, skickat datum, leveransstatus och vilken kundversion ändringen avser. Gamla dokument ska fortsätta vara läsbara.$gridex$,true),
      ($gridex$authorized_signatory$gridex$,$gridex$Behörig firmatecknare$gridex$,$gridex$Behörighetskrav för företagsavtal$gridex$,$gridex$Behörig firmatecknare$gridex$,$gridex$1. Behörighetskrav
Företagsavtal ska accepteras av registrerad firmatecknare eller annan person med giltig fullmakt. Den signerande personen försäkrar att lämnade uppgifter är riktiga och att behörigheten omfattar avtalet.

2. Kontroll
{{legal_name}} får kontrollera organisationsnummer, firmateckning, befattning, fullmakt och identitet genom tillåtna register och dokument. Kontrollen ska vara proportionerlig och dokumenterad.

3. Bristande behörighet
Om behörighet inte kan styrkas får avtalet pausas för komplettering eller avslås. Ett redan genomfört leverantörsbyte ska hanteras enligt lag och marknadsregler utan att felaktigt radera historik.

4. Fullmakt
Fullmakt ska ange fullmaktsgivare, fullmaktshavare, omfattning, giltighet och eventuell rätt att delegera. Dokumentet låses som juridiskt bevis.

5. Dataskydd
Behörighetsunderlag behandlas endast för avtals-, kontroll- och bevisändamål och sparas så länge rättsligt behov finns.$gridex$,false),
      ($gridex$credit_and_late_payment$gridex$,$gridex$Kredit, dröjsmål och avstängning$gridex$,$gridex$Kreditbedömning, säkerhet och betalningsdröjsmål$gridex$,$gridex$Kredit, dröjsmål och avstängning$gridex$,$gridex$1. Kreditbedömning
För företagskund och när lag medger det får {{legal_name}} göra kreditbedömning före och under avtalet. Bedömningen ska vara relevant, proportionerlig och följa dataskyddsregler.

2. Säkerhet och betalningsvillkor
Vid förhöjd kreditrisk får skälig säkerhet, deposition, förskottsbetalning eller kortare betalningstid begäras när avtalet medger det. Kunden ska informeras om krav och konsekvenser.

3. Dröjsmål
Vid sen betalning får dröjsmålsränta, påminnelseavgift och inkassokostnader tas ut enligt lag och avtal. Betalningar avräknas enligt angiven ordning.

4. Rättelsefrist
Innan väsentliga åtgärder ska kunden normalt få tydlig underrättelse och skälig möjlighet att betala eller invända. Särskilda konsumentskyddsregler gäller för privatkund.

5. Avstängning eller uppsägning
Avstängning eller avslut får endast ske när materiella och processuella krav är uppfyllda. Åtgärden ska dokumenteras med skuld, underrättelser, datum och beslutsgrund.

6. Återupptagande
När blockerande orsak har lösts ska fortsatt leverans eller annan åtgärd bedömas utan onödigt dröjsmål enligt marknadsprocesserna.$gridex$,false),
      ($gridex$liability_limitation$gridex$,$gridex$Ansvar och ansvarsbegränsning$gridex$,$gridex$Ansvarsfördelning och begränsningar$gridex$,$gridex$Ansvar och ansvarsbegränsning$gridex$,$gridex$1. Allmän ansvarsfördelning
Part ansvarar för styrkt skada som orsakats genom avtalsbrott eller vårdslöshet i den omfattning lag och avtal anger. Den skadelidande parten ska vidta skäliga åtgärder för att begränsa skadan.

2. Nät och marknadsaktörer
Nätägaren ansvarar för nätets drift, mätning och avbrott inom sitt ansvarsområde. {{legal_name}} ansvarar inte för annan aktörs fel men ska hantera information, krav och marknadsmeddelanden korrekt.

3. Indirekt skada
För företagskund ersätts indirekt skada, utebliven vinst, produktionsbortfall eller följdskada endast vid uppsåt, grov vårdslöshet eller när särskilt avtalats. Begränsningen gäller inte ansvar som inte lagligen kan begränsas.

4. Ansvarstak
Eventuellt ansvarstak ska anges i avtalsbekräftelsen eller särskilda villkor och vara skäligt i förhållande till avtalets risk. Flera krav med samma orsak behandlas enligt avtalad aggregeringsregel.

5. Force majeure
Part är befriad från ansvar för underlåtenhet som beror på ett oförutsebart hinder utanför rimlig kontroll, under förutsättning att motparten informeras och skäliga begränsningsåtgärder vidtas.

6. Tvingande rätt
Ingenting i dessa villkor begränsar privatkundens tvingande rättigheter, ansvar för personskada eller ansvar som följer av uppsåt eller grov vårdslöshet.$gridex$,false),
      ($gridex$volume_forecast_responsibility$gridex$,$gridex$Volymprognos och avvikelseansvar$gridex$,$gridex$Prognoser, toleranser och avvikelser$gridex$,$gridex$Volymprognos och avvikelseansvar$gridex$,$gridex$1. Prognosunderlag
När pris eller riskhantering bygger på prognos ska företagskunden lämna rimliga uppgifter om förväntad årsförbrukning, säsongsprofil, effekt, driftstider och planerade förändringar.

2. Uppdateringsskyldighet
Kunden ska informera om väsentliga förändringar, exempelvis expansion, nedläggning, ny produktion eller ändrade driftmönster. Uppgifterna ska lämnas i tid för att rimliga anpassningar ska kunna göras.

3. Tolerans
Prisversionen eller särskilt avtal ska ange tillåtet avvikelseintervall, beräkningsperiod och om upp- och nedavvikelse behandlas olika. Otydliga eller saknade toleranser får inte efterkonstrueras.

4. Avvikelsekostnad
Avvikelsekostnad får endast tas ut enligt en på förhand definierad och låst metod. Beräkningen ska baseras på verifierbar faktisk volym, prognos, tolerans och relevanta marknadskostnader.

5. Exceptionella händelser
Parterna ska skäligt beakta dokumenterade force-majeure-liknande eller regulatoriska händelser enligt avtalet. En sådan bedömning ska loggas och tillämpas konsekvent.

6. Underlag och kontroll
Kunden ska på begäran kunna få en sammanställning över prognos, faktisk volym, tolerans och debiterad avvikelse utan att affärshemlig information röjs i större omfattning än nödvändigt.$gridex$,false),
      ($gridex$production_terms$gridex$,$gridex$Produktionsvillkor$gridex$,$gridex$Ersättning och avräkning för mikroproduktion$gridex$,$gridex$Produktionsvillkor$gridex$,$gridex$1. Tillämpning
Dessa villkor gäller endast när avtalet uttryckligen anger att produktion är aktiverad och omfattar köp av inmatad el från kundens produktionsanläggning. Förbrukningsavtal och produktionsavtal kan vara separata juridiska relationer även om de administreras tillsammans.

2. Behörighet och anläggning
Kunden ska ha rätt att förfoga över produktionen och lämna korrekta uppgifter om anläggning, effekt, energislag, nätanslutning och skatte-/momsstatus. Nätägaren ska ha registrerat mätpunkten för produktion.

3. Ersättningsmodell
Ersättningen kan vara fast, spotbaserad eller annan framtida modell enligt den låsta prisversionen. Versionen ska ange elområde, tidsupplösning, påslag eller avdrag, prisgolv, hantering av negativa priser och eventuella ursprungsvärden.

4. Mätvärden och avräkning
Ersättning baseras på nätägarens validerade inmatningsvärden. Preliminära värden kan rättas när slutliga data finns. Produktion och förbrukning får inte nettas annat än när marknads- och avtalsregler uttryckligen medger det.

5. Moms och skatt
Kunden ansvarar för riktiga uppgifter om momsregistrering och skattskyldighet. Avräkningsnota, kreditfaktura eller självfakturering används enligt avtalad modell och rättsliga krav. Förändrad status ska meddelas utan dröjsmål.

6. Negativa priser och begränsning
Prisversionen ska ange om negativt marknadspris kan ge negativ ersättning, nollersättning eller annan effekt. Produktionsbegränsning eller frånkoppling följer nätägarens och myndigheters regler; {{legal_name}} ansvarar inte för nätbeslut men ska hantera avräkning korrekt.

7. Ursprungsgarantier och miljövärden
Överlåtelse av ursprungsgarantier eller andra miljövärden kräver uttryckligt avtal. Om de inte nämns behåller kunden rättigheter enligt lag och separat registrering.

8. Uppsägning och ändringar
Giltighet, uppsägning och eventuell koppling till förbrukningsavtal framgår av avtalsbekräftelsen. Ändrad ersättningsmodell kräver ny versionslåst grund och korrekt information.$gridex$,false)
    ) as seed(module_key,name,description,title,body,mandatory)
    order by module_key
  loop
    insert into public.legal_templates(module_key,name,description,mandatory,status)
    values(r.module_key,r.name,r.description,r.mandatory,'active')
    on conflict(module_key) do update set
      name=excluded.name,
      description=excluded.description,
      mandatory=excluded.mandatory,
      status='active',
      updated_at=now()
    returning id into v_template_id;

    v_hash:=encode(extensions.digest(convert_to(r.title || E'\n' || r.body,'UTF8'),'sha256'::text),'hex');
    if not exists(
      select 1 from public.legal_template_versions
      where legal_template_id=v_template_id and content_sha256=v_hash
    ) then
      select coalesce(max(version_number),0)+1 into v_version
      from public.legal_template_versions where legal_template_id=v_template_id;

      insert into public.legal_template_versions(
        legal_template_id,version_number,version_label,title,body,variables,
        content_sha256,status,published_at,locked_at,created_at
      ) values(
        v_template_id,v_version,'ops-standard-2026-07-v2',r.title,r.body,
        coalesce(array(
          select distinct match[1]
          from regexp_matches(r.title || E'\n' || r.body,'\{\{[[:space:]]*([a-zA-Z0-9_.-]+)[[:space:]]*\}\}','g') match
          order by 1
        ),'{}'::text[]),
        v_hash,'published',now(),now(),now()
      );
    end if;
  end loop;
end
$gridex_legal_seed$;

-- One effective legal source per tenant and module. Replacement overrides win;
-- addenda require a platform master and are combined during publication.
create or replace view public.gridex_tenant_effective_legal_sources_v
with (security_invoker=true)
as
with latest_platform as (
  select distinct on (t.module_key)
    t.module_key,
    v.id as platform_template_version_id,
    coalesce(v.version_label,v.version_number::text) as platform_version,
    v.title as platform_title,
    v.content_sha256 as platform_sha256
  from public.legal_templates t
  join public.legal_template_versions v on v.legal_template_id=t.id
  where t.status='active' and v.status='published' and v.locked_at is not null
  order by t.module_key,v.version_number desc,v.published_at desc nulls last,v.created_at desc
), latest_override as (
  select distinct on (o.company_id,o.module_key)
    o.company_id,o.module_key,o.id as tenant_override_id,
    coalesce(o.version_label,to_char(o.created_at at time zone 'UTC','YYYY-MM-DD-HH24MISS'),left(o.content_sha256,12)) as tenant_override_version,
    o.legal_mode as tenant_override_mode,o.title as tenant_override_title,o.content_sha256 as tenant_override_sha256
  from public.tenant_legal_overrides o
  where o.status in('approved','published') and o.locked_at is not null
  order by o.company_id,o.module_key,o.reviewed_at desc nulls last,o.created_at desc
)
select
  c.id as company_id,
  t.module_key,
  p.platform_template_version_id,
  p.platform_version,
  p.platform_title,
  p.platform_sha256,
  o.tenant_override_id,
  o.tenant_override_version,
  o.tenant_override_mode,
  o.tenant_override_title,
  o.tenant_override_sha256,
  case
    when o.tenant_override_id is not null and o.tenant_override_mode='replacement' then 'tenant_replacement'
    when p.platform_template_version_id is not null and o.tenant_override_id is not null and o.tenant_override_mode='addendum' then 'platform_template_with_tenant_addendum'
    when p.platform_template_version_id is not null then 'platform_template'
    else 'missing'
  end as effective_source,
  case
    when o.tenant_override_id is not null and o.tenant_override_mode='replacement' then true
    when p.platform_template_version_id is not null then true
    else false
  end as effective_available
from public.companies c
cross join public.legal_templates t
left join latest_platform p on p.module_key=t.module_key
left join latest_override o on o.company_id=c.id and o.module_key=t.module_key
where t.status='active';

-- Strict completeness: an address must contain an actual street/address or
-- a meaningful combined address string, not only an empty object, postal code
-- or city name. The same predicate is reused by backfill and readiness.
create or replace function public.gridex_postal_address_has_street(p_value jsonb)
returns boolean
language plpgsql
immutable
set search_path=public,pg_temp
as $$
declare
  v_address_text text:=nullif(btrim(coalesce(p_value->>'text','')),'');
begin
  return public.gridex_jsonb_nonblank(p_value,array['address_line_1','street','address'])
    or (v_address_text is not null and length(v_address_text)>=8 and v_address_text ~ '[0-9]');
end $$;

create or replace function public.gridex_tenant_legal_profile_missing_fields(p_profile public.tenant_legal_profiles)
returns text[]
language plpgsql
immutable
set search_path=public,pg_temp
as $$
declare
  v_missing text[]:='{}';
begin
  if length(btrim(coalesce(p_profile.legal_name,'')))<2 then v_missing:=array_append(v_missing,'legal_name'); end if;
  if length(regexp_replace(coalesce(p_profile.organization_number,''),'[^0-9]','','g'))<>10 then v_missing:=array_append(v_missing,'organization_number'); end if;
  if not public.gridex_postal_address_has_street(p_profile.postal_address) then v_missing:=array_append(v_missing,'postal_address'); end if;
  if nullif(btrim(coalesce(p_profile.customer_service_email,'')),'') is null
     or p_profile.customer_service_email !~* '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'
    then v_missing:=array_append(v_missing,'customer_service_email'); end if;
  if length(regexp_replace(coalesce(p_profile.phone,''),'[^0-9]','','g'))<7 then v_missing:=array_append(v_missing,'phone'); end if;
  if nullif(btrim(coalesce(p_profile.website,'')),'') is null
     or p_profile.website !~* '^(https?://)?([a-z0-9-]+\.)+[a-z]{2,}([/:?#].*)?$'
    then v_missing:=array_append(v_missing,'website'); end if;
  if not public.gridex_jsonb_nonblank(p_profile.complaints_contact,array['text','email','address']) then v_missing:=array_append(v_missing,'complaints_contact'); end if;
  if not public.gridex_jsonb_nonblank(p_profile.data_protection_contact,array['text','email','address']) then v_missing:=array_append(v_missing,'data_protection_contact'); end if;
  if not public.gridex_jsonb_nonblank(p_profile.billing_information,array['text','email','address','bankgiro']) then v_missing:=array_append(v_missing,'billing_information'); end if;
  if not public.gridex_jsonb_nonblank(p_profile.dispute_resolution_information,array['text','url','authority']) then v_missing:=array_append(v_missing,'dispute_resolution_information'); end if;
  return v_missing;
end $$;

-- Deterministic legal-profile defaults from canonical company columns.
create or replace function public.gridex_company_legal_profile_defaults(p_company jsonb)
returns jsonb
language plpgsql
stable
set search_path=public,extensions,pg_temp
as $$
declare
  j jsonb:=coalesce(p_company,'{}'::jsonb);
  m jsonb:=coalesce(j->'metadata','{}'::jsonb);
  v_name text;
  v_org text;
  v_line1 text;
  v_line2 text;
  v_postal text;
  v_city text;
  v_country text;
  v_address_text text;
  v_service_email text;
  v_complaints_email text;
  v_privacy_email text;
  v_billing_email text;
  v_phone text;
  v_website text;
  v_postal_json jsonb;
  v_snapshot jsonb;
begin
  v_name:=coalesce(nullif(j->>'legal_name',''),nullif(j->>'name',''));
  v_org:=coalesce(nullif(j->>'organization_number',''),nullif(j->>'org_number',''));
  v_line1:=coalesce(nullif(j->>'address_line_1',''),nullif(j->>'address',''),nullif(m->>'address_line_1',''));
  v_line2:=coalesce(nullif(j->>'address_line_2',''),nullif(m->>'address_line_2',''));
  v_postal:=coalesce(nullif(j->>'postal_code',''),nullif(m->>'postal_code',''));
  v_city:=coalesce(nullif(j->>'city',''),nullif(m->>'city',''));
  v_country:=coalesce(nullif(j->>'country_code',''),nullif(m->>'country_code',''),'SE');
  v_address_text:=nullif(concat_ws(', ',v_line1,v_line2,nullif(concat_ws(' ',v_postal,v_city),''),v_country),'');
  if v_line1 is null and v_city is null and v_postal is null then v_address_text:=null; end if;
  v_service_email:=coalesce(nullif(j->>'support_email',''),nullif(j->>'primary_contact_email',''),nullif(j->>'email',''),nullif(m->>'support_email',''));
  v_complaints_email:=coalesce(nullif(m->>'complaints_email',''),nullif(m->>'complaint_email',''),v_service_email);
  v_privacy_email:=coalesce(nullif(m->>'data_protection_email',''),nullif(m->>'privacy_email',''),nullif(m->>'dpo_email',''),v_service_email);
  v_billing_email:=coalesce(nullif(j->>'billing_contact_email',''),nullif(m->>'billing_email',''),nullif(m->>'invoice_email',''),nullif(m->>'finance_email',''),v_service_email);
  v_phone:=coalesce(nullif(j->>'phone',''),nullif(j->>'primary_contact_phone',''),nullif(m->>'phone',''));
  v_website:=coalesce(nullif(j->>'website',''),nullif(m->>'website',''));
  v_postal_json:=case when v_address_text is null then '{}'::jsonb else jsonb_strip_nulls(jsonb_build_object(
    'text',v_address_text,'address_line_1',v_line1,'address_line_2',v_line2,'postal_code',v_postal,'city',v_city,'country_code',v_country
  )) end;
  v_snapshot:=jsonb_strip_nulls(jsonb_build_object(
    'legal_name',v_name,'organization_number',v_org,'address_line_1',v_line1,'address_line_2',v_line2,
    'postal_code',v_postal,'city',v_city,'country_code',v_country,'support_email',v_service_email,
    'complaints_email',v_complaints_email,'data_protection_email',v_privacy_email,'billing_email',v_billing_email,
    'phone',v_phone,'website',v_website
  ));
  return jsonb_build_object(
    'legal_name',v_name,
    'organization_number',v_org,
    'postal_address',v_postal_json,
    'customer_service_address',v_postal_json,
    'customer_service_email',v_service_email,
    'phone',v_phone,
    'website',v_website,
    'complaints_contact',case when v_complaints_email is null then '{}'::jsonb else jsonb_build_object('email',v_complaints_email,'text',v_complaints_email) end,
    'data_protection_contact',case when v_privacy_email is null then '{}'::jsonb else jsonb_build_object('email',v_privacy_email,'text','Dataskyddsfrågor och rättighetsbegäran hanteras via '||v_privacy_email) end,
    'billing_information',jsonb_strip_nulls(jsonb_build_object(
      'email',v_billing_email,
      'text','Fakturering sker enligt avtalad period och den låsta prisversionen. Preliminära mätvärden får rättas när validerade värden erhålls. Fakturafrågor hanteras'||case when v_billing_email is null then ' via bolagets kundservice.' else ' via '||v_billing_email||'.' end
    )),
    'dispute_resolution_information',jsonb_build_object(
      'authority','Allmänna reklamationsnämnden för behöriga konsumenttvister',
      'url','https://www.arn.se',
      'text','Klagomål lämnas först till bolagets klagomålskontakt. Privatkund kan, när ARN:s regler är uppfyllda, vända sig till Allmänna reklamationsnämnden. Tvist avgörs i övrigt enligt svensk rätt och behörig svensk domstol om inget annat avtalats för företagskund.'
    ),
    'source_company_snapshot',v_snapshot,
    'source_company_snapshot_sha256',encode(digest(convert_to(v_snapshot::text,'UTF8'),'sha256'::text),'hex')
  );
end $$;

create or replace function public.gridex_upsert_company_legal_profile_defaults(p_company_id uuid)
returns jsonb
language plpgsql
security definer
set search_path=public,pg_temp
as $$
declare
  v_company jsonb;
  v_defaults jsonb;
  v_profile public.tenant_legal_profiles%rowtype;
begin
  select to_jsonb(c) into v_company from public.companies c where c.id=p_company_id;
  if v_company is null then raise exception using errcode='P0002',message='company_not_found'; end if;
  v_defaults:=public.gridex_company_legal_profile_defaults(v_company);

  insert into public.tenant_legal_profiles(
    company_id,legal_name,organization_number,postal_address,customer_service_address,
    customer_service_email,phone,website,complaints_contact,data_protection_contact,
    billing_information,dispute_resolution_information,source_company_snapshot,
    source_company_snapshot_sha256,source_company_updated_at,review_required
  ) values(
    p_company_id,v_defaults->>'legal_name',v_defaults->>'organization_number',
    v_defaults->'postal_address',v_defaults->'customer_service_address',v_defaults->>'customer_service_email',
    v_defaults->>'phone',v_defaults->>'website',v_defaults->'complaints_contact',v_defaults->'data_protection_contact',
    v_defaults->'billing_information',v_defaults->'dispute_resolution_information',v_defaults->'source_company_snapshot',
    v_defaults->>'source_company_snapshot_sha256',now(),false
  )
  on conflict(company_id) do update set
    legal_name=coalesce(nullif(public.tenant_legal_profiles.legal_name,''),excluded.legal_name),
    organization_number=coalesce(nullif(public.tenant_legal_profiles.organization_number,''),excluded.organization_number),
    postal_address=case when not public.gridex_postal_address_has_street(public.tenant_legal_profiles.postal_address) then excluded.postal_address else public.tenant_legal_profiles.postal_address end,
    customer_service_address=case when not public.gridex_postal_address_has_street(public.tenant_legal_profiles.customer_service_address) then excluded.customer_service_address else public.tenant_legal_profiles.customer_service_address end,
    customer_service_email=coalesce(nullif(public.tenant_legal_profiles.customer_service_email,''),excluded.customer_service_email),
    phone=coalesce(nullif(public.tenant_legal_profiles.phone,''),excluded.phone),
    website=coalesce(nullif(public.tenant_legal_profiles.website,''),excluded.website),
    complaints_contact=case when not public.gridex_jsonb_nonblank(public.tenant_legal_profiles.complaints_contact,array['text','email','address']) then excluded.complaints_contact else public.tenant_legal_profiles.complaints_contact end,
    data_protection_contact=case when not public.gridex_jsonb_nonblank(public.tenant_legal_profiles.data_protection_contact,array['text','email','address']) then excluded.data_protection_contact else public.tenant_legal_profiles.data_protection_contact end,
    billing_information=case when not public.gridex_jsonb_nonblank(public.tenant_legal_profiles.billing_information,array['text','email','address','bankgiro']) then excluded.billing_information else public.tenant_legal_profiles.billing_information end,
    dispute_resolution_information=case when not public.gridex_jsonb_nonblank(public.tenant_legal_profiles.dispute_resolution_information,array['text','url','authority']) then excluded.dispute_resolution_information else public.tenant_legal_profiles.dispute_resolution_information end,
    review_required=public.tenant_legal_profiles.review_required or (
      public.tenant_legal_profiles.source_company_snapshot_sha256 is not null and
      public.tenant_legal_profiles.source_company_snapshot_sha256 is distinct from excluded.source_company_snapshot_sha256
    ),
    verified_at=case when public.tenant_legal_profiles.verified_at is not null and public.tenant_legal_profiles.source_company_snapshot_sha256 is distinct from excluded.source_company_snapshot_sha256 then null else public.tenant_legal_profiles.verified_at end,
    verified_by=case when public.tenant_legal_profiles.verified_at is not null and public.tenant_legal_profiles.source_company_snapshot_sha256 is distinct from excluded.source_company_snapshot_sha256 then null else public.tenant_legal_profiles.verified_by end,
    source_company_snapshot=excluded.source_company_snapshot,
    source_company_snapshot_sha256=excluded.source_company_snapshot_sha256,
    source_company_updated_at=now();

  select * into v_profile from public.tenant_legal_profiles where company_id=p_company_id;
  return jsonb_build_object(
    'company_id',p_company_id,'completeness_status',v_profile.completeness_status,
    'missing_fields',v_profile.missing_fields,'review_required',v_profile.review_required
  );
end $$;

create or replace function public.gridex_sync_company_legal_profile_review()
returns trigger
language plpgsql
security definer
set search_path=public,pg_temp
as $$
begin
  perform public.gridex_upsert_company_legal_profile_defaults(new.id);
  return new;
end $$;

drop trigger if exists companies_sync_legal_profile_review on public.companies;
create trigger companies_sync_legal_profile_review
after insert or update on public.companies
for each row execute function public.gridex_sync_company_legal_profile_review();

-- Backfill and repair all existing profiles. Preserve review blockers for
-- profiles that were verified before this migration, while unverified profiles
-- may accept deterministic OPS defaults without a false migration-only blocker.
do $gridex_profile_repair$
declare
  r record;
  v_preverified_company_ids uuid[];
begin
  select coalesce(array_agg(company_id),'{}'::uuid[])
  into v_preverified_company_ids
  from public.tenant_legal_profiles
  where verified_at is not null or verified_by is not null;

  for r in select id from public.companies loop
    perform public.gridex_upsert_company_legal_profile_defaults(r.id);
  end loop;

  update public.tenant_legal_profiles p
  set review_required=false
  where p.review_required=true
    and not (p.company_id = any(v_preverified_company_ids));
end
$gridex_profile_repair$;
update public.tenant_legal_profiles set updated_at=updated_at;

-- Canonical tenant email defaults. Existing nonblank tenant copy is preserved;
-- missing fields and inactive rows are repaired.
with email_template_seed(template_key,name,subject,body_html,body_text) as (
  values
    ($gridex$contract.application_received$gridex$,$gridex$Ansökan mottagen$gridex$,$gridex$Vi har tagit emot din ansökan hos {{company_name}}$gridex$,$gridex$<p>Hej {{customer_name}},</p><p>Vi har tagit emot din ansökan om {{contract_name}} hos {{company_name}}.</p><p>Kundnummer: {{customer_number}}. Referens: {{offer_reference}}.</p><p>Vi kontrollerar uppgifterna och återkommer om något behöver kompletteras.</p><p>Frågor: {{support_email}}.</p>$gridex$,$gridex$Hej {{customer_name}}, vi har tagit emot din ansökan om {{contract_name}} hos {{company_name}}. Kundnummer: {{customer_number}}. Referens: {{offer_reference}}.$gridex$),
    ($gridex$contract.confirmation_sent$gridex$,$gridex$Avtalsbekräftelse$gridex$,$gridex$Din avtalsbekräftelse från {{company_name}}$gridex$,$gridex$<p>Hej {{customer_name}},</p><p>Ditt avtal {{contract_name}} hos {{company_name}} är tecknat.</p><p>Avtalsnummer: {{contract_number}}. Kundnummer: {{customer_number}}. Tecknat: {{signed_at}}. Startdatum: {{start_date}}.</p><p>Pris: {{price_summary}}</p><p>Juridiska versioner: {{legal_versions_summary}}</p><p>Referens: {{offer_reference}}</p><p>{{agreement_pdf_note}}</p>$gridex$,$gridex$Hej {{customer_name}}, ditt avtal {{contract_name}} hos {{company_name}} är tecknat. Avtalsnummer: {{contract_number}}. Pris: {{price_summary}}. Referens: {{offer_reference}}.$gridex$),
    ($gridex$contract.cooling_off_sent$gridex$,$gridex$Ångerrätt$gridex$,$gridex$Information om ångerrätt från {{company_name}}$gridex$,$gridex$<p>Hej {{customer_name}},</p><p>Här kommer information om ångerrätten för ditt avtal hos {{company_name}}.</p><p>Ångerfristen gäller till {{cancellation_deadline}}.</p><p>Frågor: {{support_email}}.</p>$gridex$,$gridex$Hej {{customer_name}}, ångerfristen för ditt avtal hos {{company_name}} gäller till {{cancellation_deadline}}.$gridex$),
    ($gridex$contract.power_of_attorney_required$gridex$,$gridex$Begäran om fullmakt$gridex$,$gridex$Fullmakt behövs för ditt avtal hos {{company_name}}$gridex$,$gridex$<p>Hej {{customer_name}},</p><p>För att fortsätta avtalet {{contract_name}} behöver du lämna eller signera fullmakt.</p><p>{{power_of_attorney_url}}</p><p>Frågor: {{support_email}}.</p>$gridex$,$gridex$Hej {{customer_name}}, fullmakt behövs för avtalet {{contract_name}}. Länk: {{power_of_attorney_url}}.$gridex$),
    ($gridex$contract.facility_id_required$gridex$,$gridex$Begäran om anläggnings-ID$gridex$,$gridex$Vi behöver ditt anläggnings-ID$gridex$,$gridex$<p>Hej {{customer_name}},</p><p>Vi behöver anläggnings-ID eller mätpunkts-ID för att fortsätta avtalet hos {{company_name}}.</p><p>Komplettera via {{portal_url}}.</p>$gridex$,$gridex$Hej {{customer_name}}, vi behöver anläggnings-ID eller mätpunkts-ID. Komplettera via {{portal_url}}.$gridex$),
    ($gridex$contract.customer_information_required$gridex$,$gridex$Begäran om kunduppgifter$gridex$,$gridex$Ditt avtal behöver kompletteras$gridex$,$gridex$<p>Hej {{customer_name}},</p><p>Vi behöver följande uppgifter: {{required_information}}</p><p>Komplettera via {{portal_url}}.</p>$gridex$,$gridex$Hej {{customer_name}}, avtalet behöver kompletteras med: {{required_information}}. {{portal_url}}.$gridex$),
    ($gridex$contract.completion_reminder$gridex$,$gridex$Påminnelse om komplettering$gridex$,$gridex$Påminnelse: komplettera ditt avtal$gridex$,$gridex$<p>Hej {{customer_name}},</p><p>Följande återstår för {{contract_name}}: {{required_information}}</p><p>Komplettera senast {{completion_deadline}} via {{portal_url}}.</p>$gridex$,$gridex$Hej {{customer_name}}, komplettera {{contract_name}} senast {{completion_deadline}}: {{required_information}}.$gridex$),
    ($gridex$contract.rejected$gridex$,$gridex$Avtal avslaget$gridex$,$gridex$Information om din avtalsansökan$gridex$,$gridex$<p>Hej {{customer_name}},</p><p>Vi kan inte godkänna ansökan om {{contract_name}} i nuvarande form.</p><p>Orsak: {{review_reason}}</p><p>Frågor: {{support_email}}.</p>$gridex$,$gridex$Hej {{customer_name}}, ansökan om {{contract_name}} kan inte godkännas. Orsak: {{review_reason}}.$gridex$),
    ($gridex$contract.manual_review$gridex$,$gridex$Manuell granskning$gridex$,$gridex$Din avtalsansökan granskas manuellt$gridex$,$gridex$<p>Hej {{customer_name}},</p><p>Din ansökan om {{contract_name}} behöver granskas manuellt.</p><p>Orsak: {{review_reason}}</p><p>Vi återkommer när granskningen är klar.</p>$gridex$,$gridex$Hej {{customer_name}}, ansökan om {{contract_name}} granskas manuellt. Orsak: {{review_reason}}.$gridex$),
    ($gridex$switch.started$gridex$,$gridex$Leverantörsbyte startat$gridex$,$gridex$Ditt leverantörsbyte är startat$gridex$,$gridex$<p>Hej {{customer_name}},</p><p>Vi har startat leverantörsbytet till {{company_name}}.</p><p>Anläggning: {{facility_id}}. Mätpunkt: {{metering_point_id}}.</p>$gridex$,$gridex$Hej {{customer_name}}, leverantörsbytet till {{company_name}} är startat.$gridex$),
    ($gridex$switch.confirmed$gridex$,$gridex$Leverantörsbyte bekräftat$gridex$,$gridex$Ditt leverantörsbyte är bekräftat$gridex$,$gridex$<p>Hej {{customer_name}},</p><p>Leverantörsbytet är bekräftat och leveransen startar {{start_date}}.</p><p>Anläggning: {{facility_id}}.</p>$gridex$,$gridex$Hej {{customer_name}}, leverantörsbytet är bekräftat. Startdatum: {{start_date}}.$gridex$),
    ($gridex$switch.action_required$gridex$,$gridex$Komplettering behövs$gridex$,$gridex$Vi behöver komplettera ditt leverantörsbyte$gridex$,$gridex$<p>Hej {{customer_name}},</p><p>Leverantörsbytet kräver komplettering innan det kan fortsätta.</p><p>{{required_information}}</p><p>Frågor: {{support_email}}.</p>$gridex$,$gridex$Hej {{customer_name}}, leverantörsbytet kräver komplettering: {{required_information}}.$gridex$),
    ($gridex$customer.welcome_active$gridex$,$gridex$Välkommen som kund$gridex$,$gridex$Välkommen som kund hos {{company_name}}$gridex$,$gridex$<p>Hej {{customer_name}},</p><p>Välkommen som aktiv kund hos {{company_name}}.</p><p>Ditt kundnummer är {{customer_number}}.</p><p>Frågor: {{support_email}}.</p>$gridex$,$gridex$Hej {{customer_name}}, välkommen som kund hos {{company_name}}. Kundnummer: {{customer_number}}.$gridex$)
)
insert into public.company_email_templates(company_id,template_key,name,subject,body_html,body_text,language,is_active,updated_at)
select c.id,s.template_key,s.name,s.subject,s.body_html,s.body_text,'sv',true,now()
from public.companies c cross join email_template_seed s
on conflict(company_id,template_key,language) do update set
  name=case when nullif(btrim(public.company_email_templates.name),'') is null then excluded.name else public.company_email_templates.name end,
  subject=case when nullif(btrim(public.company_email_templates.subject),'') is null then excluded.subject else public.company_email_templates.subject end,
  body_html=case when nullif(btrim(coalesce(public.company_email_templates.body_html,'')),'') is null then excluded.body_html else public.company_email_templates.body_html end,
  body_text=case when nullif(btrim(coalesce(public.company_email_templates.body_text,'')),'') is null then excluded.body_text else public.company_email_templates.body_text end,
  is_active=true,
  updated_at=now();

with canonical_email_rules(event_key,template_key,event_label,legal_or_critical) as (
  values
    ('contract.application_received','contract.application_received','Ansökan mottagen',false),
 ('contract.confirmation_sent','contract.confirmation_sent','Avtalsbekräftelse',true),
 ('contract.cooling_off_sent','contract.cooling_off_sent','Ångerrätt',true),
 ('contract.power_of_attorney_required','contract.power_of_attorney_required','Begäran om fullmakt',true),
 ('contract.facility_id_required','contract.facility_id_required','Begäran om anläggnings-ID',true),
 ('contract.customer_information_required','contract.customer_information_required','Begäran om kunduppgifter',true),
 ('contract.completion_reminder','contract.completion_reminder','Påminnelse om komplettering',true),
 ('contract.rejected','contract.rejected','Avtal avslaget',true),
 ('contract.manual_review','contract.manual_review','Manuell granskning',true),
 ('switch.started','switch.started','Leverantörsbyte startat',true),
 ('switch.confirmed','switch.confirmed','Leverantörsbyte bekräftat',true),
 ('switch.action_required','switch.action_required','Komplettering behövs',true),
 ('customer.welcome_active','customer.welcome_active','Välkommen som kund',true)
)
insert into public.email_event_rules(company_id,event_key,template_key,enabled,is_active,delay_minutes,send_to_customer,send_to_admin,updated_at)
select c.id,r.event_key,r.template_key,true,true,0,true,false,now()
from public.companies c cross join canonical_email_rules r
on conflict(company_id,event_key,template_key) do update set
  enabled=true,is_active=true,send_to_customer=true,updated_at=now();

with canonical_email_rules(event_key,template_key,event_label,legal_or_critical) as (
  values
    ('contract.application_received','contract.application_received','Ansökan mottagen',false),
 ('contract.confirmation_sent','contract.confirmation_sent','Avtalsbekräftelse',true),
 ('contract.cooling_off_sent','contract.cooling_off_sent','Ångerrätt',true),
 ('contract.power_of_attorney_required','contract.power_of_attorney_required','Begäran om fullmakt',true),
 ('contract.facility_id_required','contract.facility_id_required','Begäran om anläggnings-ID',true),
 ('contract.customer_information_required','contract.customer_information_required','Begäran om kunduppgifter',true),
 ('contract.completion_reminder','contract.completion_reminder','Påminnelse om komplettering',true),
 ('contract.rejected','contract.rejected','Avtal avslaget',true),
 ('contract.manual_review','contract.manual_review','Manuell granskning',true),
 ('switch.started','switch.started','Leverantörsbyte startat',true),
 ('switch.confirmed','switch.confirmed','Leverantörsbyte bekräftat',true),
 ('switch.action_required','switch.action_required','Komplettering behövs',true),
 ('customer.welcome_active','customer.welcome_active','Välkommen som kund',true)
)
update public.email_event_rules e
set enabled=false,is_active=false,updated_at=now()
where exists(
  select 1 from canonical_email_rules r
  where r.event_key=e.event_key and r.template_key<>e.template_key
)
   or e.template_key in('contract_confirmation','cancellation_right','cancellation_right_started');

-- The view cannot depend on a temporary table after commit. Recreate with an
-- inline canonical list for durable runtime use.
create or replace view public.gridex_tenant_email_dispatch_readiness_v as
with canonical_rules(event_key,template_key,event_label,legal_or_critical) as (
  values
    ('contract.application_received','contract.application_received','Ansökan mottagen',false),
    ('contract.confirmation_sent','contract.confirmation_sent','Avtalsbekräftelse',true),
    ('contract.cooling_off_sent','contract.cooling_off_sent','Ångerrätt',true),
    ('contract.power_of_attorney_required','contract.power_of_attorney_required','Begäran om fullmakt',true),
    ('contract.facility_id_required','contract.facility_id_required','Begäran om anläggnings-ID',true),
    ('contract.customer_information_required','contract.customer_information_required','Begäran om kunduppgifter',true),
    ('contract.completion_reminder','contract.completion_reminder','Påminnelse om komplettering',true),
    ('contract.rejected','contract.rejected','Avtal avslaget',true),
    ('contract.manual_review','contract.manual_review','Manuell granskning',true),
    ('switch.started','switch.started','Leverantörsbyte startat',true),
    ('switch.confirmed','switch.confirmed','Leverantörsbyte bekräftat',true),
    ('switch.action_required','switch.action_required','Komplettering behövs',true),
    ('customer.welcome_active','customer.welcome_active','Välkommen som kund',true)
), raw as (
  select
    c.id as company_id,c.name as company_name,cr.event_key,cr.template_key,cr.event_label,cr.legal_or_critical,
    coalesce(e.enabled,true) as enabled,coalesce(e.is_active,e.enabled,true) as rule_active,
    t.id as template_id,coalesce(t.name,cr.event_label) as template_name,t.subject,t.body_html,t.body_text,
    coalesce(t.is_active,false) as template_active,s.id as settings_id,s.sender_name,s.sender_email,s.reply_to_email,s.domain,
    coalesce(s.verification_status,'not_started') as domain_status,coalesce(s.is_active,true) as sender_is_active,
    coalesce(s.fallback_allowed,s.id is null) as fallback_allowed,coalesce(s.sender_mode,'fallback_platform_sender') as sender_mode,
    coalesce(s.block_legal_mail_when_unverified,true) as block_legal_mail_when_unverified,
    coalesce(e.updated_at,t.updated_at) as event_rule_updated_at,t.updated_at as template_updated_at
  from public.companies c
  cross join canonical_rules cr
  left join public.email_event_rules e on e.company_id=c.id and e.event_key=cr.event_key and e.template_key=cr.template_key
  left join public.company_email_templates t on t.company_id=c.id and t.template_key=cr.template_key and t.language='sv'
  left join public.company_email_settings s on s.company_id=c.id
), evaluated as (
  select raw.*,
    (sender_is_active=true and lower(coalesce(domain_status,'')) in('verified','active','ready') and nullif(coalesce(sender_email,''),'') is not null and nullif(coalesce(sender_name,''),'') is not null) as has_verified_sender,
    (sender_is_active=true and fallback_allowed=true and sender_mode<>'disabled') as fallback_permitted
  from raw
)
select
  company_id,company_name,event_key,template_key,enabled,template_id,template_name,subject,template_active,
  sender_email,reply_to_email,domain,domain_status,
  case
    when enabled is not true or rule_active is not true then false
    when template_id is null or template_active is not true then false
    when nullif(coalesce(subject,''),'') is null or nullif(coalesce(body_html,body_text,''),'') is null then false
    when sender_is_active is not true then false
    when legal_or_critical=true then has_verified_sender
    when has_verified_sender=true or fallback_permitted=true then true
    else false
  end as can_send,
  array_remove(array[
    case when enabled is not true or rule_active is not true then 'Utskicket är avstängt' end,
    case when template_id is null then 'Mailmall saknas' end,
    case when template_active is not true then 'Mailmallen är inaktiv' end,
    case when nullif(coalesce(subject,''),'') is null then 'Ämnesrad saknas' end,
    case when nullif(coalesce(body_html,body_text,''),'') is null then 'Mallinnehåll saknas' end,
    case when sender_is_active is not true then 'Avsändaren är avstängd' end,
    case when legal_or_critical=true and has_verified_sender is not true then 'Juridiska eller kritiska mail kräver verifierad bolagsdomän och avsändare' end,
    case when legal_or_critical=false and has_verified_sender is not true and fallback_permitted=true then 'Skickas via plattformens fallback-avsändare' end,
    case when legal_or_critical=false and has_verified_sender is not true and fallback_permitted is not true then 'Verifierad avsändare saknas och fallback är avstängd' end,
    case when has_verified_sender is not true and nullif(coalesce(sender_email,''),'') is null then 'Bolagets verifierade avsändarmail saknas' end,
    case when has_verified_sender is not true and nullif(coalesce(sender_name,''),'') is null then 'Avsändarnamn saknas' end
  ],null) as issues,
  event_rule_updated_at,template_updated_at,sender_mode,fallback_allowed,legal_or_critical,
  (legal_or_critical=false and has_verified_sender is not true and fallback_permitted=true) as requires_platform_fallback
from evaluated;

-- Seed statements are self-contained; no staging objects require cleanup.
grant select on public.gridex_tenant_effective_legal_sources_v to authenticated,service_role;
grant select on public.gridex_tenant_email_dispatch_readiness_v to authenticated,service_role;
grant execute on function public.gridex_company_legal_profile_defaults(jsonb) to service_role;
grant execute on function public.gridex_upsert_company_legal_profile_defaults(uuid) to service_role;

commit;
