# Bilaga A — regelkort

Version2.0. Varje kort är en specificerad regel med källtyp; implementeringen är inte verifierad av dokumentet.

## GOV-01 · Källstyrning
**Typ:** Intern arkitektur  
**Gäller:** Alla profiler  
**När:** Publicering av regelpaket

**Villkor:** Varje normativ regel har dokumenthash, version/revision, sida/avsnitt, giltighet och exakt omfattning.

**När det stämmer:** Publicera immutabel regelversion med granskningsspår.

**När det inte stämmer / förbjudet:** Ej styrkt regel ska inte generera nya externa meddelanden eller påhittade felkoder.

**Anropsägare:** `guideRegistry / canonicalRulePackRegistry`  
**Källa:** T §1.2,1.4; P §1.3  
**Grind:** Implementering och beteendeprov krävs; inte produktionsgodkänt av detta dokument.  
**Provkontrakt:** AT-GOV-01 — ej kört mot systemet.

## GOV-02 · Källstyrning
**Typ:** Ediel/Handbok  
**Gäller:** PRODAT  
**När:** Komposition av fältprofil

**Villkor:** P §2.2 har företräde framför motstridiga bilaga4-villkor; första register och register2+ har skilda regler.

**När det stämmer:** Tillämpa basprofil + subtype + parent + registeroverlay.

**När det inte stämmer / förbjudet:** Ingen automatisk kopiering av gamla bilaga4-koder eller bas-R till alla register.

**Anropsägare:** `canonicalPolicyFieldValidator / prodat26AFieldMatrix`  
**Källa:** P §2.2 s.15; bilaga2  
**Grind:** Implementering och beteendeprov krävs; inte produktionsgodkänt av detta dokument.  
**Provkontrakt:** AT-GOV-02 — ej kört mot systemet.

## GOV-03 · Källstyrning
**Typ:** Ediel/Handbok  
**Gäller:** PRODAT/AP/UTILTS  
**När:** Val av guide

**Villkor:** Elprofil26.A och tillhörande APERAK skiljs från gasprofil16.B; generisk AP05.B.5 ersätter inte P-/U-specifika APERAK.

**När det stämmer:** Välj APERAK enligt ursprungsfamilj och dess guide.

**När det inte stämmer / förbjudet:** Stoppa sammanblandad wireversion; ingen generell APERAK16.B-profil för EL.

**Anropsägare:** `guideRegistry / acknowledgement-profile selector`  
**Källa:** T §1.5,2.2; P omslag; AP §1.2  
**Grind:** Implementering och beteendeprov krävs; inte produktionsgodkänt av detta dokument.  
**Provkontrakt:** AT-GOV-03 — ej kört mot systemet.

## GOV-04 · Versioner
**Typ:** Ediel/Handbok  
**Gäller:** Utgående meddelande och omsändning  
**När:** Före varje extern sändning

**Villkor:** Använd då gällande anvisning; avvikande omsändning endast där giltig bilateral överenskommelse tillåter.

**När det stämmer:** Ny prövning efter versionsgräns; behåll tidigare payload och beslut som historik.

**När det inte stämmer / förbjudet:** Skicka inte gammal köpayload med ny versionsetikett.

**Anropsägare:** `pre-send policy gate`  
**Källa:** T §1.4 s.4  
**Grind:** Implementering och beteendeprov krävs; inte produktionsgodkänt av detta dokument.  
**Provkontrakt:** AT-GOV-04 — ej kört mot systemet.

## GOV-05 · Versioner
**Typ:** Ediel/Handbok  
**Gäller:** Mottagning  
**När:** Ny anvisning börjar gälla

**Villkor:** Hantera närmast föregående giltiga anvisning under tvåveckorsövergång, med hänsyn till överordnade regler.

**När det stämmer:** Använd ett komplett kompatibelt regelpaket per prövning, logga vald tolkning.

**När det inte stämmer / förbjudet:** Plocka inte gynnsamma enstaka kontroller från olika versioner; samma UNH-kod är inte revisionsbevis.

**Anropsägare:** `guideRegistry / runtimeDecision`  
**Källa:** T §1.4; U/UE omslag  
**Grind:** Implementering och beteendeprov krävs; inte produktionsgodkänt av detta dokument.  
**Provkontrakt:** AT-GOV-05 — ej kört mot systemet.

## GOV-06 · Versioner
**Typ:** Intern arkitektur  
**Gäller:** UTILTS  
**När:** Gemensam runtimevalidering

**Villkor:** Format-/övergångstid, dokumentdatum, leveransperiod och replaytid är separata tidsbegrepp som beslutet bär.

**När det stämmer:** För explicit versionsbeslut till utiltsEngine; inget nytt implicit now().

**När det inte stämmer / förbjudet:** Avvisa lokalt osammanhängande beslut före mutation; inte externt fältfel om orsaken är egen kod.

**Anropsägare:** `runtimeDecision → utiltsEngine`  
**Källa:** CODE canonicalEdielPolicy/runtimeDecision; SYS  
**Grind:** Implementering och beteendeprov krävs; inte produktionsgodkänt av detta dokument.  
**Provkontrakt:** AT-GOV-06 — ej kört mot systemet.

## GOV-07 · Framtida regler
**Typ:** Ediel/Handbok  
**Gäller:** Energidelning/2027-förslag  
**När:** Kapabilitet aktiveras

**Villkor:** P §2.3 anger användning från 2027-01-01; S18 ej, endast15min och produktion; framtida nya koder är inte antagna.

**När det stämmer:** Håll egen framtida profil avstängd före datum och före separata legala/processuella verifieringar.

**När det inte stämmer / förbjudet:** Ingen aktivering bara för att PDF är publicerad.

**Anropsägare:** `capability registry / guideRegistry`  
**Källa:** P §2.3 s.35; P/U inledning  
**Grind:** Implementering och beteendeprov krävs; inte produktionsgodkänt av detta dokument.  
**Provkontrakt:** AT-GOV-07 — ej kört mot systemet.

## GOV-08 · Testdata
**Typ:** Intern arkitektur  
**Gäller:** Referenser och TGT  
**När:** Inför acceptanstest

**Villkor:** Knyt originalfilhash till källa, testfall, revision, roll och förväntat positivt/negativt resultat.

**När det stämmer:** Bevara negativa referenser som negativa; dokumentera konflikt.

**När det inte stämmer / förbjudet:** Ändra inte referensen för att passa egen renderer.

**Anropsägare:** `test fixtures / source inventory`  
**Källa:** P §1.3; U §1.5; TGT lista  
**Grind:** Implementering och beteendeprov krävs; inte produktionsgodkänt av detta dokument.  
**Provkontrakt:** AT-GOV-08 — ej kört mot systemet.

## TEN-01 · Tenant och aktör
**Typ:** Intern arkitektur  
**Gäller:** Alla affärsoperationer  
**När:** Command skapas eller meddelande attribueras

**Villkor:** Tenant, juridisk aktör, operativ roll och teknisk identitet är olika typer.

**När det stämmer:** Skapa verifierat execution context före kundmutation.

**När det inte stämmer / förbjudet:** Tenantens namn/domän/mejl får inte ersätta marknadsidentitet.

**Anropsägare:** `authorizeEdielContext (föreslaget lager)`  
**Källa:** SYS; T §5  
**Grind:** Implementering och beteendeprov krävs; inte produktionsgodkänt av detta dokument.  
**Provkontrakt:** AT-TEN-01 — ej kört mot systemet.

## TEN-02 · Egen marknadsidentitet
**Typ:** Intern arkitektur  
**Gäller:** Tenant med egen leverantör/ESCO  
**När:** Utgående/inkommande trafik

**Villkor:** Tenantens verifierade juridiska Ediel-id används; gemensam brevlåda är en transportegenskap.

**När det stämmer:** Bevara befintligt beslut om egna Ediel-id; separata aktörsprofiler för DDQ/DGI.

**När det inte stämmer / förbjudet:** Byt inte alla till Gridex-id eller registrera tekniskt ombud automatiskt.

**Anropsägare:** `tenant actor registry / route resolver`  
**Källa:** Användarbeslut; T §5  
**Grind:** Implementering och beteendeprov krävs; inte produktionsgodkänt av detta dokument.  
**Provkontrakt:** AT-TEN-02 — ej kört mot systemet.

## TEN-03 · ESCO för andra tenants
**Typ:** Intern arkitektur  
**Gäller:** Gridex är legal ESCO åt beneficiary tenant  
**När:** Z13 beställs av annan tenant

**Villkor:** Operating tenant/actor=ESCO-leverantören; beneficiary tenant uttrycklig; kund- och DSO-avtal ger marknadsgrund.

**När det stämmer:** Z13 sänds i den verkliga ESCO-aktörens DGI-roll, utan interna tenant-id i EDIFACT.

**När det inte stämmer / förbjudet:** SaaS-avtal/ägande av plattformen ger inte mätvärdestillstånd.

**Anropsägare:** `service_assignment + permission command`  
**Källa:** HB kap.11; SYS  
**Grind:** Implementering och beteendeprov krävs; inte produktionsgodkänt av detta dokument.  
**Provkontrakt:** AT-TEN-03 — ej kört mot systemet.

## TEN-04 · Tekniskt ombud
**Typ:** Ediel/Handbok  
**Gäller:** Verkligt registrerat ombudsförhållande  
**När:** Adressmatchning

**Villkor:** InterchangePartyId och juridisk PartyId bevaras var för sig; stöd endast uttryckligen dokumenterad relation.

**När det stämmer:** Routa tekniskt via ombud utan att byta juridisk aktör.

**När det inte stämmer / förbjudet:** Tvinga inte teknisk==juridisk; anta inte att delad SMTP betyder ombudsmandat.

**Anropsägare:** `registry importer / route resolver`  
**Källa:** T §5; companies.xml  
**Grind:** Implementering och beteendeprov krävs; inte produktionsgodkänt av detta dokument.  
**Provkontrakt:** AT-TEN-04 — ej kört mot systemet.

## TEN-05 · Separata verksamhetsroller
**Typ:** Ediel/Handbok  
**Gäller:** Aktör både DDQ och DGI  
**När:** Varje affärshändelse

**Villkor:** Roll bestäms av affärsprocess, inte globalt standardfält.

**När det stämmer:** 23-DDQ-PRODAT för leverantörsprocess;23-DGI-PRODAT för tillståndsprocess.

**När det inte stämmer / förbjudet:** Z14 får inte aktivera leverans; Z04 ger inte generellt ESCO-tillstånd.

**Anropsägare:** `policy context / prodat application reference`  
**Källa:** T §5.2.3; P §2.1; SYS  
**Grind:** Implementering och beteendeprov krävs; inte produktionsgodkänt av detta dokument.  
**Provkontrakt:** AT-TEN-05 — ej kört mot systemet.

## TEN-06 · Delad brevlåda
**Typ:** Intern arkitektur  
**Gäller:** Inkommande EDIFACT  
**När:** Efter säker MIME-/syntaxklassificering

**Villkor:** Attribuera teknisk mottagare, juridisk mottagare, roll/marknad och ursprungssammanhang där sådant finns.

**När det stämmer:** Identifiera en juridiskt ansvarig aktör; därifrån korrekt tenant-/servicekontext.

**När det inte stämmer / förbjudet:** Oklar attribution hålls i skyddad karantän; ingen gissad tenant från kund-id.

**Anropsägare:** `inbound actor resolver`  
**Källa:** T §5; SYS  
**Grind:** Implementering och beteendeprov krävs; inte produktionsgodkänt av detta dokument.  
**Provkontrakt:** AT-TEN-06 — ej kört mot systemet.

## TEN-07 · Transaktionsvis åtkomst
**Typ:** Intern arkitektur  
**Gäller:** Flera objekt/meddelanden i fil  
**När:** Efter juridisk mottagarattribution

**Villkor:** Varje nyttig datadel matchas mot tillstånd och serviceuppdrag; transportkuvert och affärsgrants är inte samma omfattning.

**När det stämmer:** Ägaraktören behåller råfil; beneficiaries ser bara tillåtna objekt/perioder/fält.

**När det inte stämmer / förbjudet:** Ge inte hela EML/filen till en tenant som bara har rätt till en transaktion.

**Anropsägare:** `inbox → access projections`  
**Källa:** SYS  
**Grind:** Implementering och beteendeprov krävs; inte produktionsgodkänt av detta dokument.  
**Provkontrakt:** AT-TEN-07 — ej kört mot systemet.

## TEN-08 · Grantstyrd fan-out
**Typ:** Intern arkitektur  
**Gäller:** En ESCO-mätserie har flera giltiga mottagartenants  
**När:** Efter accepterad lagring

**Villkor:** Separata data_access_grants för varje beneficiary, ändamål, objekt, produkt och tidsintervall.

**När det stämmer:** En marknadsmottagning och kvittens; därefter separat intern distribution per giltigt grant.

**När det inte stämmer / förbjudet:** Ingen automatisk kopiering till alla tenants med samma GSRN.

**Anropsägare:** `grant evaluator / projections`  
**Källa:** HB kap.11; SYS  
**Grind:** Implementering och beteendeprov krävs; inte produktionsgodkänt av detta dokument.  
**Provkontrakt:** AT-TEN-08 — ej kört mot systemet.

## TEN-09 · Överlappande ESCO-uppdrag
**Typ:** Intern arkitektur  
**Gäller:** Samma legal ESCO/kund/DSO  
**När:** Ny begäran eller uppsägning

**Villkor:** Koordinera market_permission över serviceuppdrag; beneficiary-id är inte en ny marknadsaktör.

**När det stämmer:** Återanvänd enbart rättsligt och semantiskt kompatibelt tillstånd; håll uppdragsgrants separata.

**När det inte stämmer / förbjudet:** En tenant får inte starta dubblett-Z13 eller avsluta delat tillstånd för andra.

**Anropsägare:** `ESCO coordinator`  
**Källa:** HB kap.11; SYS  
**Grind:** Implementering och beteendeprov krävs; inte produktionsgodkänt av detta dokument.  
**Provkontrakt:** AT-TEN-09 — ej kört mot systemet.

## TEN-10 · Återkallelse
**Typ:** Intern arkitektur  
**Gäller:** Market permission eller internt grant ändras  
**När:** API-läsning, export och jobbverkställighet

**Villkor:** Åtkomst prövas mot aktuella grantversioner; marknadsslut och intern tenantåterkallelse olika händelser.

**När det stämmer:** Stoppa framtida otillåten användning; bevara tillåten historik/audit enligt lagringspolicy.

**När det inte stämmer / förbjudet:** Ingen återaktivering av återkallat beneficiary-grant bara för att Z15C återställer marknadstillstånd.

**Anropsägare:** `RLS/RPC/access service`  
**Källa:** SYS  
**Grind:** Implementering och beteendeprov krävs; inte produktionsgodkänt av detta dokument.  
**Provkontrakt:** AT-TEN-10 — ej kört mot systemet.

## TEN-11 · Inga fabricerade protokollfel
**Typ:** Intern arkitektur  
**Gäller:** Okänd lokal entitlement  
**När:** Inkommande giltig marknadstrafik

**Villkor:** Skilj eget konfigurationsfel från avsändarens anvisnings-/funktionsfel.

**När det stämmer:** Behåll föreskriven teknisk kvittens där säkert möjlig; utred egen behörighetskonfiguration utan dataexponering.

**När det inte stämmer / förbjudet:** Skicka inte E10 eller42/209 enbart för att fel tenant valts lokalt.

**Anropsägare:** `decision/error classifier`  
**Källa:** U bilaga1–2; T §2; SYS  
**Grind:** Implementering och beteendeprov krävs; inte produktionsgodkänt av detta dokument.  
**Provkontrakt:** AT-TEN-11 — ej kört mot systemet.

## TEN-12 · Isolering
**Typ:** Intern arkitektur  
**Gäller:** DB/API/job/cache  
**När:** Varje åtkomst

**Villkor:** Sammansatta tenant-referenser, explicit delegation och grantfilter; service credentials inte synonymt med global behörighet.

**När det stämmer:** RLS/RPC verifierar actor/role/tenant även i bakgrundsjobb; isolera cache/sök/export.

**När det inte stämmer / förbjudet:** Ingen OR-villkorsbaserad superadminläcka till beneficiaries.

**Anropsägare:** `DB grants / API guards`  
**Källa:** SYS  
**Grind:** Implementering och beteendeprov krävs; inte produktionsgodkänt av detta dokument.  
**Provkontrakt:** AT-TEN-12 — ej kört mot systemet.

## TEN-13 · Identifierarutrymme
**Typ:** Normkrav + intern verkställighet  
**Gäller:** BGM/UNB/IDE/tillstånd  
**När:** Allokering och korrelation

**Villkor:** Unikhet i protokollets avsändar-/applikationsutrymme även när flera tenants nyttjar samma juridiska ESCO.

**När det stämmer:** Lagra interna UUID och wire-id separat; entydigt ursprung för kvittenser.

**När det inte stämmer / förbjudet:** Tenantlokala räknare får inte krocka externt; LI ensam är inte tenantnyckel.

**Anropsägare:** `identity allocator / correlator`  
**Källa:** P §2.2,3; U §3.9,5.5; SYS  
**Grind:** Implementering och beteendeprov krävs; inte produktionsgodkänt av detta dokument.  
**Provkontrakt:** AT-TEN-13 — ej kört mot systemet.

## TEN-14 · Avtal och dataansvar
**Typ:** Intern arkitektur  
**Gäller:** Cross-tenant ESCO  
**När:** Uppdrag aktiveras

**Villkor:** Fastställ vem som är ESCO, berättigad mottagare, avtalspart och tillåten intern mottagare; dokumentera dataskyddsroller.

**När det stämmer:** Tillåt avgränsad aktivering efter evidens.

**När det inte stämmer / förbjudet:** Lämna uppdrag spärrat tills konkreta rättigheter finns; rollnamn är inte juridiskt bevis.

**Anropsägare:** `assignment approval`  
**Källa:** HB kap.11; rättslig verifiering G04  
**Grind:** Implementering och beteendeprov krävs; inte produktionsgodkänt av detta dokument.  
**Provkontrakt:** AT-TEN-14 — ej kört mot systemet.

## IMP-01 · Registerimport
**Typ:** Intern arkitektur  
**Gäller:** XML/TXT  
**När:** Fil läses

**Villkor:** Officiell struktur: Market/Company/Identifiers/Key Type/EDIFACTDetails; TXT har egna familjeblock och kan innehålla radbrytningar.

**När det stämmer:** En importerande kärna med separata formatadaptrar och gemensam typad utdata.

**När det inte stämmer / förbjudet:** Avvisa oläsbar post med diagnos; acceptera inte0routes som framgång.

**Anropsägare:** `parseActorRegistryXml / import adapters`  
**Källa:** companies.xml/companies.txt; SYS  
**Grind:** Implementering och beteendeprov krävs; inte produktionsgodkänt av detta dokument.  
**Provkontrakt:** AT-IMP-01 — ej kört mot systemet.

## IMP-02 · Registerimport
**Typ:** Ediel/Handbok  
**Gäller:** EL/GAS och roller  
**När:** Normalisering

**Villkor:** Bevara marknad, originalkod, land, roller, teknik/juridik, familj, subadress och transporttyp.

**När det stämmer:** Matcha rätt rutt inom rätt marknad; GAS kan lagras som referens men inte köras i EL-profil.

**När det inte stämmer / förbjudet:** Slå inte ihop aktörer endast på namn/orgnr eller tappa familjekvalificerare.

**Anropsägare:** `registry normalizer`  
**Källa:** T §5; companies.xml  
**Grind:** Implementering och beteendeprov krävs; inte produktionsgodkänt av detta dokument.  
**Provkontrakt:** AT-IMP-02 — ej kört mot systemet.

## IMP-03 · Registerimport
**Typ:** Intern arkitektur  
**Gäller:** Ruttändring  
**När:** Preview/apply

**Villkor:** Diff mot giltig snapshot; separation av registeruppgift, granskning och autosändningsberedskap.

**När det stämmer:** Atomär/idempotent import med kvarstående konflikter och ny ruttversion.

**När det inte stämmer / förbjudet:** Importerad adress betyder inte giltigt certifikat eller klar produktion.

**Anropsägare:** `importActorRegistry / readiness`  
**Källa:** SYS  
**Grind:** Implementering och beteendeprov krävs; inte produktionsgodkänt av detta dokument.  
**Provkontrakt:** AT-IMP-03 — ej kört mot systemet.

## IMP-04 · Registerimport
**Typ:** Ediel/Handbok  
**Gäller:** Subadresser  
**När:** Ruttbeslut

**Villkor:** Tom registrerad subadress är ett giltigt värde; UTILTS använder inte subadress.

**När det stämmer:** Bevara exakt registrerat värde; återverifiera Gridex GRIDEX-avvikelsen.

**När det inte stämmer / förbjudet:** Hitta inte på PRODAT/SCH/GRIDEX för alla.

**Anropsägare:** `route resolver`  
**Källa:** T §5; companies.xml  
**Grind:** Implementering och beteendeprov krävs; inte produktionsgodkänt av detta dokument.  
**Provkontrakt:** AT-IMP-04 — ej kört mot systemet.

## IMP-05 · Registerimport
**Typ:** Ediel/Handbok  
**Gäller:** Certifikat-/SMTP-byte  
**När:** Ny ruttversion

**Villkor:** Säkerhetsidentitet och registrerad adress verifieras tillsammans; bevara gammal version för historik.

**När det stämmer:** Invalidate berörda aktörers/tenants readiness och verifiera returväg.

**När det inte stämmer / förbjudet:** Skicka inte med nytt mejlmål och gammalt obestämt certifikatscope.

**Anropsägare:** `routeMaterializer / certificate resolver`  
**Källa:** T bilagaA; SYS  
**Grind:** Implementering och beteendeprov krävs; inte produktionsgodkänt av detta dokument.  
**Provkontrakt:** AT-IMP-05 — ej kört mot systemet.

## ENV-01 · Kuvert
**Typ:** Ediel/Handbok  
**Gäller:** PRODAT/UTILTS/AP för dessa  
**När:** Serialisering

**Villkor:** UNOC:3 och faktiska ISO8859-1-byte; escaping enligt UNA före sammanfogning.

**När det stämmer:** Detektera tecken som inte kan representeras; bevara original och dokumenterad tillåten konvertering.

**När det inte stämmer / förbjudet:** Maskera inte UTF8-byte som UNOC; trunkera inte kund-id.

**Anropsägare:** `edifactEnvelopeCodec / MIME encoder`  
**Källa:** T §4,6; P §4.2  
**Grind:** Implementering och beteendeprov krävs; inte produktionsgodkänt av detta dokument.  
**Provkontrakt:** AT-ENV-01 — ej kört mot systemet.

## ENV-02 · Kuvert
**Typ:** Ediel/Handbok  
**Gäller:** Alla EDIFACT  
**När:** Parse/render

**Villkor:** Alternativa UNA-separatorer, releasechar och tomma komponentpositioner bevaras; releasechar räknas inte i fältlängd.

**När det stämmer:** Positionsstabilt AST med span/segmentgrupp/objekt/register.

**När det inte stämmer / förbjudet:** Ingen split/filter(Boolean) som flyttar CAV-komponenter.

**Anropsägare:** `edifactTokenizer / canonicalEdifactAst`  
**Källa:** T §4.1,6,7.5  
**Grind:** Implementering och beteendeprov krävs; inte produktionsgodkänt av detta dokument.  
**Provkontrakt:** AT-ENV-02 — ej kört mot systemet.

## ENV-03 · Kuvert
**Typ:** Ediel/Handbok  
**Gäller:** UNB/UNH/UNT/UNZ  
**När:** Färdig payload

**Villkor:** Unika tekniska referenser; UNT inkluderar UNH/UNT; UNZ count och ref stämmer;0010/0017/0019 enligt profil.

**När det stämmer:** Beräkna räknare från faktiskt serialiserad struktur.

**När det inte stämmer / förbjudet:** Återanvänd inte filnamn som tekniskt id; inga handskrivna stale segmentantal.

**Anropsägare:** `edifactEnvelopeCodec`  
**Källa:** T §4; P/U segmenttabeller  
**Grind:** Implementering och beteendeprov krävs; inte produktionsgodkänt av detta dokument.  
**Provkontrakt:** AT-ENV-03 — ej kört mot systemet.

## ENV-04 · Kvittensbegäran
**Typ:** Ediel/Handbok  
**Gäller:** UNB  
**När:** Utgående

**Villkor:** UNB/0031=1 när CONTRL ska begäras; utelämna för CONTRL.

**När det stämmer:** Samma kvittensbeslut används i kuvert och bevakning.

**När det inte stämmer / förbjudet:** AB i BGM ersätter inte0031; skapa inte kvittensloop.

**Anropsägare:** `canonicalAckEngine → envelope`  
**Källa:** T §2.1,4.2  
**Grind:** Implementering och beteendeprov krävs; inte produktionsgodkänt av detta dokument.  
**Provkontrakt:** AT-ENV-04 — ej kört mot systemet.

## ENV-05 · Miljö
**Typ:** Ediel/Handbok  
**Gäller:** UNB testflagga  
**När:** Parse/render

**Villkor:** 0035=1 för test; produktion utelämnar flaggan.

**När det stämmer:** Separata identiteter, routing, dedupe och transportspärrar för test/replay/produktion.

**När det inte stämmer / förbjudet:** Sätt inte0 som ersättning; kör aldrig TGTreferens som produktionsaffär.

**Anropsägare:** `envelope / environment gate`  
**Källa:** T §4.2; SYS  
**Grind:** Implementering och beteendeprov krävs; inte produktionsgodkänt av detta dokument.  
**Provkontrakt:** AT-ENV-05 — ej kört mot systemet.

## ENV-06 · Meddelandeprofil
**Typ:** Ediel/Handbok  
**Gäller:** PRODAT  
**När:** BGM/CCI byggs

**Villkor:** BGM bär Z-funktion utan suffix; CCI Z13/CAV bär treteckenskod för undertyp.

**När det stämmer:** Z03 + Z22 betyder Z03L, inte BGM+Z03L.

**När det inte stämmer / förbjudet:** Avvisa fel kombination på rätt kontrollnivå.

**Anropsägare:** `profileRenderer / subtypeRegistry`  
**Källa:** P §2.1,2.6  
**Grind:** Implementering och beteendeprov krävs; inte produktionsgodkänt av detta dokument.  
**Provkontrakt:** AT-ENV-06 — ej kört mot systemet.

## ENV-07 · Paketering
**Typ:** Ediel/Handbok  
**Gäller:** PRODAT  
**När:** Batchning

**Villkor:** Blanda inte olika PRODAT-funktioner i samma UNB–UNZ.

**När det stämmer:** Batcha kompatibla objekt med gemensam aktör/profil/roll; tenantseparation som extra internt skydd.

**När det inte stämmer / förbjudet:** Dela batchen; inte generisk multi-message-blandning.

**Anropsägare:** `outbox batch planner`  
**Källa:** P s.14; SYS  
**Grind:** Implementering och beteendeprov krävs; inte produktionsgodkänt av detta dokument.  
**Provkontrakt:** AT-ENV-07 — ej kört mot systemet.

## ENV-08 · Tid
**Typ:** Ediel/Handbok  
**Gäller:** PRODAT/UTILTS och UNB  
**När:** Datumkodning

**Villkor:** Payload fast normaltid: P DTMZZZ=1:805, U DTM735=+0100:406; UNB lokal tid enligt regeln.

**När det stämmer:** Lagra UTC plus originaloffset/format och affärsdatum; konvertera uttryckligt.

**När det inte stämmer / förbjudet:** Använd inte sommartid för varje payloadperiod eller92/100 kvartar per fast-CET-dygn.

**Anropsägare:** `time codec / timer policy`  
**Källa:** T §4.2,7.9; P206; U §3.6.1,3.9  
**Grind:** Implementering och beteendeprov krävs; inte produktionsgodkänt av detta dokument.  
**Provkontrakt:** AT-ENV-08 — ej kört mot systemet.

## ENV-09 · Grammatik
**Typ:** Ediel/Handbok  
**Gäller:** Alla familjer  
**När:** Syntaxkontroll

**Villkor:** Nationella segmenttabeller kan utelämna senare ej använda element; full UNSM-grammatik krävs för riktig syntax-M/kardinalitet.

**När det stämmer:** Versionera parsergrammatik separat från nationell fältanvändning.

**När det inte stämmer / förbjudet:** En kort svensk tabell får inte bli falskt strikt UNECE-syntax.

**Anropsägare:** `grammar registry`  
**Källa:** T §2.1; P §2.6; U §3.9,5.5  
**Grind:** Implementering och beteendeprov krävs; inte produktionsgodkänt av detta dokument.  
**Provkontrakt:** AT-ENV-09 — ej kört mot systemet.

## P-01 · PRODAT-fält
**Typ:** Ediel/Handbok  
**Gäller:** Alla P  
**När:** Fältkontroll

**Villkor:** 74 numeriska fält +3 parentgrupper;110bas-D-celler och registeroverlay hanteras uttryckligt.

**När det stämmer:** Fältresultat bär riktigt fältnummer, grupp/komponent, objekt/ärende och källregel.

**När det inte stämmer / förbjudet:** Inget fältnummer från regex över DTM/RFF-text.

**Anropsägare:** `fieldMatrix / canonicalPolicyFieldValidator`  
**Källa:** P §2.2,2.6,3.3  
**Grind:** Implementering och beteendeprov krävs; inte produktionsgodkänt av detta dokument.  
**Provkontrakt:** AT-P-01 — ej kört mot systemet.

## P-02 · PRODAT-mottagning
**Typ:** Ediel/Handbok  
**Gäller:** Extra X/icke-tillämplig D  
**När:** Giltig syntax och extra data

**Villkor:** Nationell extra information som ska ignoreras får inte utlösa negativ APERAK.

**När det stämmer:** Ignorera för affärsprojektion; bevara råpayload.

**När det inte stämmer / förbjudet:** Skilj verkligt för många syntaxelement från tillåtna men ej använda nationella fält.

**Anropsägare:** `inbound field validator`  
**Källa:** P bilaga4 s.119  
**Grind:** Implementering och beteendeprov krävs; inte produktionsgodkänt av detta dokument.  
**Provkontrakt:** AT-P-02 — ej kört mot systemet.

## P-03 · PRODAT-sändning
**Typ:** Ediel/Handbok  
**Gäller:** D-villkor  
**När:** Utgående profil

**Villkor:** Treutfall: sant/falskt/okänt; falskt kan vara O eller X enligt specifik notering.

**När det stämmer:** Rfält fylls från auktoritativa fakta; Ofält enligt medvetet val.

**När det inte stämmer / förbjudet:** Ingen blanketregel Dfalse=forbidden; saknad lokal fakta blockerar egen sändning.

**Anropsägare:** `dependentConditionEngine`  
**Källa:** P §2.2  
**Grind:** Implementering och beteendeprov krävs; inte produktionsgodkänt av detta dokument.  
**Provkontrakt:** AT-P-03 — ej kört mot systemet.

## P-04 · Parentgrupper
**Typ:** Ediel/Handbok  
**Gäller:** Z14N/NAD  
**När:** Fältkontroll

**Villkor:** Inaktiv grupp gör barnfälten icke-tillämpliga även om basmatrisen visarR.

**När det stämmer:** Z14N kan vara giltig utan UD/IT/tillståndsid/positiva tillståndsfält.

**När det inte stämmer / förbjudet:** Kräv inte land316 ellerIT233/234 utan grupp.

**Anropsägare:** `field profile compiler`  
**Källa:** P §2.2 s.20–22  
**Grind:** Implementering och beteendeprov krävs; inte produktionsgodkänt av detta dokument.  
**Provkontrakt:** AT-P-04 — ej kört mot systemet.

## P-05 · Flera register
**Typ:** Ediel/Handbok  
**Gäller:** Z04/Z06/Z10  
**När:** LIN-grupper behandlas

**Villkor:** 314ärglobaltsekvensnr;258registerindex per objekt; alla register och villkor enligt bilaga2.

**När det stämmer:** Kontrollera registerspecifika kärnfält, ärv tillåten första-registerinformation.

**När det inte stämmer / förbjudet:** Kopiera inte basmatrisens allaR till register2+; ignorera extra upprepade icke-styrande fält där guiden säger det.

**Anropsägare:** `AST / register overlay`  
**Källa:** P bilaga2 s.114–116  
**Grind:** Implementering och beteendeprov krävs; inte produktionsgodkänt av detta dokument.  
**Provkontrakt:** AT-P-05 — ej kört mot systemet.

## P-06 · Identiteter
**Typ:** Ediel/Handbok  
**Gäller:** Kund och anläggning  
**När:** Render/validate

**Villkor:** NADUD SE1/SE2 kodlisteansvarig260 i aktuellprofil; Z13 använder inte födelsedatum som kund-id.

**När det stämmer:** Bevara verifierad kundidentitet och skyddade-identitetsregler.

**När det inte stämmer / förbjudet:** Ingen UUID-fallback/namngissning; ändra inte allaZZZglobalt.

**Anropsägare:** `prodat/render/segments`  
**Källa:** P s.79–80; bilaga3  
**Grind:** Implementering och beteendeprov krävs; inte produktionsgodkänt av detta dokument.  
**Provkontrakt:** AT-P-06 — ej kört mot systemet.

## P-07 · Fältplacering
**Typ:** Ediel/Handbok  
**Gäller:** Z13/Z14  
**När:** Energi-id och rapportperiod

**Villkor:** Energiprodukt506 i andra7110; rapportstart90,slut91; detta är inte242aggregatprodukt eller avtals92/93.

**När det stämmer:** CAV+::::energi-id, rätt DTM och faktisktLIN även utan objekt-id.

**När det inte stämmer / förbjudet:** Saknad/feluppgift klassificeras perfält; referensexempel med positiv kvittens är inte automatisk norm.

**Anropsägare:** `profileRenderer`  
**Källa:** P s.49–52,69–72  
**Grind:** Implementering och beteendeprov krävs; inte produktionsgodkänt av detta dokument.  
**Provkontrakt:** AT-P-07 — ej kört mot systemet.

## P-08 · Avtal
**Typ:** Ediel/Handbok  
**Gäller:** Z09D  
**När:** Start eller slut produktionsavtal

**Villkor:** 210 XOR211; inte216 i stället.

**När det stämmer:** Bygg92eller93; vid giltig mottagning uppdatera rätt produktionsrelation.

**När det inte stämmer / förbjudet:** Båda: P-APERAK40/109; ingen generell157.

**Anropsägare:** `profileRenderer / lifecycle`  
**Källa:** P §2.2,3.3  
**Grind:** Implementering och beteendeprov krävs; inte produktionsgodkänt av detta dokument.  
**Provkontrakt:** AT-P-08 — ej kört mot systemet.

## P-09 · Kunddata
**Typ:** Ediel/Handbok  
**Gäller:** Z06E/Z09E  
**När:** Kundlivshändelse

**Villkor:** Fält310ärdödsfallsstatus; andraE34-fall behöver rätt process/överenskommelse.

**När det stämmer:** Z09E inkluderarUD; Z06E gör bara behöriga och källstödda uppdateringar.

**När det inte stämmer / förbjudet:** Konkurs ska inte automatiskt bli dödsfall; övrigaZ09ska inte fåUD.

**Anropsägare:** `prodat business context`  
**Källa:** P §2.2,2.6,bilaga1; HB kap.4.4  
**Grind:** Implementering och beteendeprov krävs; inte produktionsgodkänt av detta dokument.  
**Provkontrakt:** AT-P-09 — ej kört mot systemet.

## P-10 · Z01/Z02
**Typ:** Ediel/Handbok  
**Gäller:** Z01/Z02 i leverantörsrollen  
**När:** Uppgiftskontroll

**Villkor:** Korrelera Z02 till Z01 med LI, parter, objekt, nätområde och kundidentitet. Z02 är inte en startbekräftelse.

**När det stämmer:** Verifiera uppgifterna; gör därefter en separat prövning av om en Z03 ska skapas.

**När det inte stämmer / förbjudet:** Ingen aktiv leverans och ingen automatisk Z03 utan återstående avtals- och datumkontroller.

**Anropsägare:** `customer info flow`  
**Källa:** P bilaga1; HB kap.4  
**Grind:** Implementering och beteendeprov krävs; inte produktionsgodkänt av detta dokument.  
**Provkontrakt:** AT-P-10 — ej kört mot systemet.

## P-11 · Z03/Z04
**Typ:** Ediel/Handbok  
**Gäller:** Z03/Z04 av typen L eller LK  
**När:** Bekräftelse av byte eller flytt

**Villkor:** Kontrollera rätt objekt, parter, LI, undertyp och datum. En giltig Z04 kan komma före positiv APERAK.

**När det stämmer:** Registrera bekräftad framtida leverans; aktivera vid rätt tid om ärendet fortfarande är giltigt.

**När det inte stämmer / förbjudet:** SMTP250, CONTRL, APERAK och Z02 räcker inte för aktivering. Sena kvittenser får inte backa ett giltigt affärstillstånd.

**Anropsägare:** `prodatLifecycle / supply period service`  
**Källa:** P §3.2; HB kap.4  
**Grind:** Implementering och beteendeprov krävs; inte produktionsgodkänt av detta dokument.  
**Provkontrakt:** AT-P-11 — ej kört mot systemet.

## P-12 · Z04A/D
**Typ:** Ediel/Handbok  
**Gäller:** Z04A och Z04D  
**När:** Anvisning eller mottagningsplikt

**Villkor:** Verifiera respektive roll, avtal, nätområde och produktionskoppling.

**När det stämmer:** Använd en särskild transitionsprofil som inte kräver en vanlig egen Z03.

**När det inte stämmer / förbjudet:** Kräv inte samma förutsättningar som Z04L, men kringgå inte de särskilda behörighetskraven.

**Anropsägare:** `prodatLifecycle`  
**Källa:** P §2.1–2.2; HB kap.4,10  
**Grind:** Implementering och beteendeprov krävs; inte produktionsgodkänt av detta dokument.  
**Provkontrakt:** AT-P-12 — ej kört mot systemet.

## P-13 · Upphörande
**Typ:** Ediel/Handbok  
**Gäller:** Z05 och Z08  
**När:** Leveransslut

**Villkor:** Matcha den leveransrelation och den tidshändelse som faktiskt avses.

**När det stämmer:** Versionera slutet, bevara historiken och initiera relevant slutvärdes- och fakturauppföljning.

**När det inte stämmer / förbjudet:** Radera inte kunden, andra anläggningar eller ESCO-grants.

**Anropsägare:** `supply period service`  
**Källa:** P §2; HB kap.4; SYS  
**Grind:** Implementering och beteendeprov krävs; inte produktionsgodkänt av detta dokument.  
**Provkontrakt:** AT-P-13 — ej kört mot systemet.

## P-14 · Kancellering
**Typ:** Ediel/Handbok  
**Gäller:** Z03C, Z04C, Z05C och Z15C  
**När:** Återtag

**Villkor:** Bind till rätt original. Hantera ordningsfel utan dubbel affärseffekt.

**När det stämmer:** Gör endast den kancellering eller kompensation som hör till processen.

**När det inte stämmer / förbjudet:** Skapa inte Z13C/Z14C och använd inte en generell C-variant för alla Z-funktioner.

**Anropsägare:** `cancellation coordinator`  
**Källa:** P §2.1,2.2,1.7; HB kap.4,11  
**Grind:** Implementering och beteendeprov krävs; inte produktionsgodkänt av detta dokument.  
**Provkontrakt:** AT-P-14 — ej kört mot systemet.

## P-15 · Strukturhistorik
**Typ:** Ediel/Handbok  
**Gäller:** Z06 och Z10  
**När:** Giltig strukturändring

**Villkor:** Lagra giltighetstid och mottagningstid separat. En framtida leverantör kan behöva struktur före start.

**När det stämmer:** Använd rätt mätare, register och produkt för varje tidsperiod.

**När det inte stämmer / förbjudet:** Skriv inte över historiken i en enda global rad och dubbelräkna inte registerenergi.

**Anropsägare:** `structural mutation service`  
**Källa:** P §2.2; U §3.6.10,3.6.13  
**Grind:** Implementering och beteendeprov krävs; inte produktionsgodkänt av detta dokument.  
**Provkontrakt:** AT-P-15 — ej kört mot systemet.

## P-16 · Bilateralt
**Typ:** Ediel/Handbok  
**Gäller:** Z08LK, Z03H, Z04H, Z05H, Z04A och andra E34-fall  
**När:** Kapabilitetsprövning

**Villkor:** Kombinationen ska vara tillåten och omfattas av dokumenterad motpartsspecifik överenskommelse och implementation.

**När det stämmer:** Aktivera bara avtalad omfattning och giltighet.

**När det inte stämmer / förbjudet:** Ett globalt bilateral=true eller ett testgodkännande för annan aktör räcker inte.

**Anropsägare:** `capability registry`  
**Källa:** P s.65; SYS  
**Grind:** Implementering och beteendeprov krävs; inte produktionsgodkänt av detta dokument.  
**Provkontrakt:** AT-P-16 — ej kört mot systemet.

## P-17 · Sekvensfel
**Typ:** Ediel/Handbok  
**Gäller:** PRODAT med LIN-grupper  
**När:** Sekvenskontroll

**Villkor:** Första fält 314 ska vara 1 och följande nummer ska vara obrutet stigande.

**När det stämmer:** Fortsätt genom samtliga relevanta objekt och register.

**När det inte stämmer / förbjudet:** Avvisa hela meddelandet med P-APERAK BGM27 och relevant felinformation; tolka inte sekvensfelet som fel anläggnings-id.

**Anropsägare:** `header validator`  
**Källa:** P bilaga4 s.119  
**Grind:** Implementering och beteendeprov krävs; inte produktionsgodkänt av detta dokument.  
**Provkontrakt:** AT-P-17 — ej kört mot systemet.

## ESCO-01 · Tillstånd
**Typ:** Ediel/Handbok  
**Gäller:** Z13  
**När:** Ny rättighetsbegäran

**Villkor:** Verifiera legal DGI-aktör, slutkundsavtal, DSO-avtal och avsedd omfattning av objekt, period, produkter och ändamål.

**När det stämmer:** Skapa väntande begäran, knyt service_assignment och skicka rätt V/VH.

**När det inte stämmer / förbjudet:** Ett avtal med beneficiary-tenant ger inte ensamt rätt till kundens mätvärden.

**Anropsägare:** `ESCO command service`  
**Källa:** P §2.1,bilaga4; HB kap.11  
**Grind:** Implementering och beteendeprov krävs; inte produktionsgodkänt av detta dokument.  
**Provkontrakt:** AT-ESCO-01 — ej kört mot systemet.

## ESCO-02 · Tillstånd
**Typ:** Ediel/Handbok  
**Gäller:** Z13V respektive Z13VH  
**När:** Rapportperiod väljs

**Villkor:** V är löpande och VH avgränsad historik. Pröva treårsgräns och relevant nätavtalsperiod; VH kräver slutdatum.

**När det stämmer:** Behåll separata processer, timers och samordning av rättigheter.

**När det inte stämmer / förbjudet:** Använd inte VH för löpande rapportering och anta inte att slutkundens godkännande redan finns.

**Anropsägare:** `ESCO permission state machine`  
**Källa:** HB kap.11; P §2.2  
**Grind:** Implementering och beteendeprov krävs; inte produktionsgodkänt av detta dokument.  
**Provkontrakt:** AT-ESCO-02 — ej kört mot systemet.

## ESCO-03 · Tillstånd
**Typ:** Ediel/Handbok  
**Gäller:** Positiv APERAK på Z13  
**När:** Kvittens tas emot

**Villkor:** Kvittensen godkänner att begäran behandlas, inte slutkundens medgivande.

**När det stämmer:** Sätt awaiting_customer_decision och bevaka Z14/Z14N.

**När det inte stämmer / förbjudet:** Skapa varken market_permission eller aktiv elleverans enbart från APERAK.

**Anropsägare:** `ACK→ESCO reducer`  
**Källa:** HB kap.11  
**Grind:** Implementering och beteendeprov krävs; inte produktionsgodkänt av detta dokument.  
**Provkontrakt:** AT-ESCO-03 — ej kört mot systemet.

## ESCO-04 · Tillstånd
**Typ:** Ediel/Handbok  
**Gäller:** Z14V/Z14VH  
**När:** Positivt affärssvar

**Villkor:** A74 och rätt LI, aktör och kund. Föreskrivna objekt-, adress-, tillstånds- och perioduppgifter ska stämma. Bara godkända objekt omfattas.

**När det stämmer:** Skapa avgränsat market_permission; anslut därefter separat godkänd intern distribution.

**När det inte stämmer / förbjudet:** Bredda inte till samtliga kundens anläggningar eller andra tenants från ett godkänt objekt.

**Anropsägare:** `ESCO reducer / grant gate`  
**Källa:** P §2.2; HB kap.11  
**Grind:** Implementering och beteendeprov krävs; inte produktionsgodkänt av detta dokument.  
**Provkontrakt:** AT-ESCO-04 — ej kört mot systemet.

## ESCO-05 · Tillstånd
**Typ:** Ediel/Handbok  
**Gäller:** Z14N  
**När:** Aktivt eller passivt nekande

**Villkor:** A13 anger aktivt och A76 passivt nekande. Ett korrekt negativt affärssvar är inte ett protokollfel.

**När det stämmer:** Neka berörd begäran och informera ansvarig utan att exponera andra tenants.

**När det inte stämmer / förbjudet:** Skapa inte tillstånd eller negativ APERAK enbart för att nätägaren nekar begäran.

**Anropsägare:** `ESCO reducer`  
**Källa:** P §2.6; HB kap.11  
**Grind:** Implementering och beteendeprov krävs; inte produktionsgodkänt av detta dokument.  
**Provkontrakt:** AT-ESCO-05 — ej kört mot systemet.

## ESCO-06 · Tillstånd
**Typ:** Ediel/Handbok  
**Gäller:** Nya objekt under pågående Z13-begäran  
**När:** Ny Z13 önskas

**Villkor:** Koordinera samma aktör, kund och DSO. Tillkommande objekt kan kräva ny begäran; upprepning bedöms enligt Handboken, inte ett universellt negativt APERAK.

**När det stämmer:** Tillåt en relevant ny begäran med spårbar koppling till tidigare förlopp.

**När det inte stämmer / förbjudet:** Inför inte ett generellt förbud mot varje ny Z13 före 21 dagar och kringgå inte reglerna genom ett nytt internt tenant-id.

**Anropsägare:** `ESCO coordinator`  
**Källa:** P ändringslogg; HB kap.11  
**Grind:** Implementering och beteendeprov krävs; inte produktionsgodkänt av detta dokument.  
**Provkontrakt:** AT-ESCO-06 — ej kört mot systemet.

## ESCO-07 · Tillstånd
**Typ:** Ediel/Handbok  
**Gäller:** Z15V/Z15VH  
**När:** Upphörande eller historikslut

**Villkor:** Tillstånd, orsak, tidpunkt och process ska vara kända och överensstämmande.

**När det stämmer:** Avsluta bara berört marknadstillstånd eller historikjobb; bevara andra separata rättigheter.

**När det inte stämmer / förbjudet:** Historikslut får inte upphäva ett separat V-tillstånd. DDQ-leverans ska vara oförändrad.

**Anropsägare:** `ESCO reducer`  
**Källa:** P §2.2; HB kap.11  
**Grind:** Implementering och beteendeprov krävs; inte produktionsgodkänt av detta dokument.  
**Provkontrakt:** AT-ESCO-07 — ej kört mot systemet.

## ESCO-08 · Tillstånd
**Typ:** Normkrav + intern verkställighet  
**Gäller:** Z18V  
**När:** Begäran om avslut

**Villkor:** Behörig aktör ska avse rätt market_permission. Samordna beroenden från flera beneficiary-uppdrag.

**När det stämmer:** Skicka fält 327/324/325 och bevaka Z15. Begränsa intern åtkomst enligt aktuellt mandat.

**När det inte stämmer / förbjudet:** Säg inte upp ett gemensamt tillstånd på ett enskilt UI-klick utan kontroll av andra giltiga uppdrag.

**Anropsägare:** `ESCO termination coordinator`  
**Källa:** P §2.2; SYS  
**Grind:** Implementering och beteendeprov krävs; inte produktionsgodkänt av detta dokument.  
**Provkontrakt:** AT-ESCO-08 — ej kört mot systemet.

## ESCO-09 · Tillstånd
**Typ:** Ediel/Handbok  
**Gäller:** Z15C  
**När:** Tidigare upphörande återtas

**Villkor:** Kontrollera rätt ursprung och källstödda återställningsvillkor.

**När det stämmer:** Återställ marknadsrelationen; ompröva varje downstream-grant självständigt.

**När det inte stämmer / förbjudet:** Återuppliva inte utgångna kundavtal eller uttryckligen återkallade tenantbehörigheter.

**Anropsägare:** `ESCO reducer / access grants`  
**Källa:** P Z15C; HB kap.11; SYS  
**Grind:** Implementering och beteendeprov krävs; inte produktionsgodkänt av detta dokument.  
**Provkontrakt:** AT-ESCO-09 — ej kört mot systemet.

## ESCO-10 · Datadistribution
**Typ:** Ediel/Handbok  
**Gäller:** E66 i DGI-rollen  
**När:** Mätvärden tas emot

**Villkor:** E66 kan sakna direkt tillstånds-id. Matcha juridisk relation, objekt, produkt, period och giltig tillstånds-/grantkoppling.

**När det stämmer:** Lagra mottagningsbevis och distribuera endast till uttryckligen berättigade tenants.

**När det inte stämmer / förbjudet:** Kräv inte ett påhittat permission-fält i E66. Matcha inte enbart på GSRN eller SMTP-adress.

**Anropsägare:** `UTILTS resolver / grants`  
**Källa:** U §3.7–3.9; SYS  
**Grind:** Implementering och beteendeprov krävs; inte produktionsgodkänt av detta dokument.  
**Provkontrakt:** AT-ESCO-10 — ej kört mot systemet.

## ESCO-11 · Datadistribution
**Typ:** Intern arkitektur  
**Gäller:** Intern vidareanvändning av E66-DGI  
**När:** Data används i annan tjänst

**Villkor:** Tillåtet ändamål, rättslig/datamässig grund och processtillämplighet ska verifieras uttryckligen.

**När det stämmer:** Bevara originalets DGI-roll, avsändare, kvalitet och syfte i varje härledd projektion.

**När det inte stämmer / förbjudet:** Skriv inte om DGI till DDQ och skapa inte en falsk E66 från nätägaren för att passa faktureringen.

**Anropsägare:** `data usage policy`  
**Källa:** HB kap.11; SYS  
**Grind:** Implementering och beteendeprov krävs; inte produktionsgodkänt av detta dokument.  
**Provkontrakt:** AT-ESCO-11 — ej kört mot systemet.

## ACK-01 · CONTRL
**Typ:** Ediel/Handbok  
**Gäller:** Alla inkommande EDIFACT utom CONTRL  
**När:** Syntaxresultat finns

**Villkor:** Använd CONTRL:2:2:UN och resultatkod 1/4 på rätt korrelationsnivå.

**När det stämmer:** Larma vid negativt resultat och undvik kvittensloop.

**När det inte stämmer / förbjudet:** Lägg inte nationell APERAK-kontroll i CONTRL.

**Anropsägare:** `canonicalAckEngine / syntax engine`  
**Källa:** T §2.1  
**Grind:** Implementering och beteendeprov krävs; inte produktionsgodkänt av detta dokument.  
**Provkontrakt:** AT-ACK-01 — ej kört mot systemet.

## ACK-02 · P-APERAK
**Typ:** Ediel/Handbok  
**Gäller:** APERAK på PRODAT  
**När:** Applikationsresultat finns

**Villkor:** D96A/E2SE6A; BGM27 för avvisat helt meddelande eller 34 för behandlat; ERC40/41/42/100 och ACW till originalets BGM-id.

**När det stämmer:** Bygg RFF+Z07/LI när uppgifterna finns och korrekt fält- eller särskild felreferens.

**När det inte stämmer / förbjudet:** Använd inte UTILTS-APERAK:s BGM312/313 eller dess transaktions-ACW för PRODAT.

**Anropsägare:** `P acknowledgement builder`  
**Källa:** P §3.3–3.5  
**Grind:** Implementering och beteendeprov krävs; inte produktionsgodkänt av detta dokument.  
**Provkontrakt:** AT-ACK-02 — ej kört mot systemet.

## ACK-03 · U-APERAK
**Typ:** Ediel/Handbok  
**Gäller:** APERAK på UTILTS  
**När:** Anvisnings-/funktionsutfall finns

**Villkor:** D04A/E5SE5A; BGM312 positivt eller313 negativt; DOC till originaltyp/BGM, DM för eget transaktions-id och ACW till originalets IDE-id.

**När det stämmer:** Håll positiva och negativa transaktioner i skilda APERAK. Ange inte påhittad IDE-referens vid huvudfel.

**När det inte stämmer / förbjudet:** Använd inte PRODAT-BGM34 eller generiska ERC40-specialkoder utan stöd i UTILTS-guiden.

**Anropsägare:** `U acknowledgement builder`  
**Källa:** U §5.3–5.5  
**Grind:** Implementering och beteendeprov krävs; inte produktionsgodkänt av detta dokument.  
**Provkontrakt:** AT-ACK-03 — ej kört mot systemet.

## ACK-04 · U-APERAK
**Typ:** Ediel/Handbok  
**Gäller:** UTILTS-APERAK ERC/FTX  
**När:** Svar byggs

**Villkor:** ERC100 ger OK; 41 ger MANDATORY FIELD MISSING; 42 ger INCORRECT DATA XXX. Riktig fältreferens krävs vid41/42.

**När det stämmer:** Bygg exakt referens och korrekt frisläppning; begränsa känsliga uppgifter i loggar.

**När det inte stämmer / förbjudet:** Härled inte ett fältnummer ur siffrorna i ett segmentnamn.

**Anropsägare:** `error mapper`  
**Källa:** U s.117–119  
**Grind:** Implementering och beteendeprov krävs; inte produktionsgodkänt av detta dokument.  
**Provkontrakt:** AT-ACK-04 — ej kört mot systemet.

## ACK-05 · UTILTS-ERR
**Typ:** Ediel/Handbok  
**Gäller:** UTILTS-ERR  
**När:** Godkänd anvisningskontroll men funktionsfel

**Villkor:** Wirefamiljen är UTILTS med BGM ERR. Referera rätt originaltyp, BGM-id och transaktions-id samt avvisningsorsak.

**När det stämmer:** Begär föreskriven APERAK och CONTRL på ERR; följ ERR:s egna fältvillkor.

**När det inte stämmer / förbjudet:** Skapa inte ERR på ERR eller APERAK på APERAK.

**Anropsägare:** `UTILTS ERR builder / ACK graph`  
**Källa:** U §3.4,4,5  
**Grind:** Implementering och beteendeprov krävs; inte produktionsgodkänt av detta dokument.  
**Provkontrakt:** AT-ACK-05 — ej kört mot systemet.

## ACK-06 · Korrelation
**Typ:** Ediel/Handbok  
**Gäller:** Mottagna kvittenser  
**När:** CONTRL/APERAK tas emot

**Villkor:** Bind föreskrivna referenser tillsammans med parter, marknad, roll, miljö och ursprungsfamilj.

**När det stämmer:** Uppdatera endast rätt kvitterade delar och deras delstatus.

**När det inte stämmer / förbjudet:** UCI, ACW eller LI utan aktörsscope får inte kopplas till en annan tenant.

**Anropsägare:** `ACK correlator`  
**Källa:** T §5.5; P §3; U §5  
**Grind:** Implementering och beteendeprov krävs; inte produktionsgodkänt av detta dokument.  
**Provkontrakt:** AT-ACK-06 — ej kört mot systemet.

## ACK-07 · Kvittenssanning
**Typ:** Ediel/Handbok  
**Gäller:** Redan kvitterat objekt/transaktion  
**När:** Senare kontroll upptäcker annat fel

**Villkor:** Ändra inte ett slutligt kvittensutfall genom att skicka motsatt APERAK på samma objekt/transaktion.

**När det stämmer:** Skapa incident och föreskriven kontakt; använd rätt rättelseprocess för ett nytt meddelande.

**När det inte stämmer / förbjudet:** Gör inte rollback följt av motsatt APERAK bara på grund av ett internt återförsök.

**Anropsägare:** `ACK ledger / incidents`  
**Källa:** P §3.2; U §5.2; T §2  
**Grind:** Implementering och beteendeprov krävs; inte produktionsgodkänt av detta dokument.  
**Provkontrakt:** AT-ACK-07 — ej kört mot systemet.

## ACK-08 · Delutfall
**Typ:** Ediel/Handbok  
**Gäller:** Flera objekt/transaktioner  
**När:** En del är fel

**Villkor:** PRODAT och UTILTS har skilda svarsstrukturer; huvudfel och delutfall separeras.

**När det stämmer:** Mutera och kvittera rätt omfattning. UTILTS positiva/negativa svar hålls åtskilda.

**När det inte stämmer / förbjudet:** Låt inte global hasFunctionalError välja en felklass för alla transaktioner.

**Anropsägare:** `runtimeDecision / utiltsEngine`  
**Källa:** P §3; U §5.2  
**Grind:** Implementering och beteendeprov krävs; inte produktionsgodkänt av detta dokument.  
**Provkontrakt:** AT-ACK-08 — ej kört mot systemet.

## ACK-09 · Dubbletter
**Typ:** Ediel/Handbok  
**Gäller:** Återleverans och dubbletter  
**När:** Inkommande identitet finns redan

**Villkor:** Skilj intern återkörning av sparad mottagning från en ny mottagen protokolldubblett.

**När det stämmer:** Undvik dubbla affärseffekter och ge det protokollföreskrivna dubblettsvaret.

**När det inte stämmer / förbjudet:** Idempotens får inte innebära att kvittenspliktig mottagning bara slängs tyst.

**Anropsägare:** `inbox identity / ACK ledger`  
**Källa:** T §2.1; P §3.2; SYS  
**Grind:** Implementering och beteendeprov krävs; inte produktionsgodkänt av detta dokument.  
**Provkontrakt:** AT-ACK-09 — ej kört mot systemet.

## U-01 · UTILTSroller
**Typ:** Ediel/Handbok  
**Gäller:** E66, S02, E31, S05 och requests  
**När:** Profil väljs

**Villkor:** Objektvärden, prognoser, aggregat och requests är uttryckligen skilda. Kontrollera aktuell roll, inte alltid en Supplier-gate.

**När det stämmer:** Tillåt stödd roll, funktion, riktning och produkt med rätt bevis.

**När det inte stämmer / förbjudet:** Parserstöd eller en exempel-E66 ger inte rätt att sända nätägarens E66 i produktion.

**Anropsägare:** `utiltsMarketSemantics / context`  
**Källa:** U §3.1; CODE; SYS  
**Grind:** Implementering och beteendeprov krävs; inte produktionsgodkänt av detta dokument.  
**Provkontrakt:** AT-U-01 — ej kört mot systemet.

## U-02 · UTILTSnivåer
**Typ:** Ediel/Handbok  
**Gäller:** Samtliga UTILTS  
**När:** Parsning

**Villkor:** Bevara huvud, SG5/IDE-transaktion och SEQ-observation samt varje upprepad grupp.

**När det stämmer:** En disposition per ursprungstransaktion; mätarställningar och energier separata.

**När det inte stämmer / förbjudet:** Använd inte första LOC eller QTY i hela filen för samtliga objekt.

**Anropsägare:** `canonicalEdifactAst / UTILTS parser`  
**Källa:** U §2,3.8–3.9  
**Grind:** Implementering och beteendeprov krävs; inte produktionsgodkänt av detta dokument.  
**Provkontrakt:** AT-U-02 — ej kört mot systemet.

## U-03 · UTILTSkontrollordning
**Typ:** Ediel/Handbok  
**Gäller:** Samtliga UTILTS  
**När:** Validering

**Villkor:** Syntax följs av huvudets anvisningskontroll, transaktionens anvisningskontroll och därefter funktionskontroll endast för godkänd transaktion.

**När det stämmer:** Lagra godkända transaktioner och kvittera varje utfall på rätt nivå.

**När det inte stämmer / förbjudet:** Ett guidefel för samma IDE får inte ersättas av ett senare E10/E50-funktionsfel.

**Anropsägare:** `utiltsEngine / runtimeDecision`  
**Källa:** U §5.2 s.107; bilaga1–2  
**Grind:** Implementering och beteendeprov krävs; inte produktionsgodkänt av detta dokument.  
**Provkontrakt:** AT-U-03 — ej kört mot systemet.

## U-04 · Äldredata
**Typ:** Ediel/Handbok  
**Gäller:** Äldre men i övrigt giltiga mätdata  
**När:** Sen leverans

**Villkor:** Ankomstordning ensam är inte avvisningsskäl. Använd registrerings-/uppdateringstid 512/532 för dataversionen.

**När det stämmer:** Sänd positiv APERAK när andra kontroller passerar och bevara äldre historik utan att skriva över nyare data.

**När det inte stämmer / förbjudet:** Skapa inte ERR eller retroaktiv fakturaändring enbart för att data anländer sent.

**Anropsägare:** `measurement revision service`  
**Källa:** U §3.6.14,5.2  
**Grind:** Implementering och beteendeprov krävs; inte produktionsgodkänt av detta dokument.  
**Provkontrakt:** AT-U-04 — ej kört mot systemet.

## U-05 · ESCOE66
**Typ:** Ediel/Handbok  
**Gäller:** E66 i DGI-rollen  
**När:** Periodisk rapportering

**Villkor:** Anledning ska vara E23, inte E88, om inte annat är uttryckligen överenskommet.

**När det stämmer:** Kontrollera roll, Application Reference, underordnad roll och behörigheter.

**När det inte stämmer / förbjudet:** Påför inte en global E88-fakturaprofil på DGI-trafik.

**Anropsägare:** `utilts profile selector`  
**Källa:** U ändringslogg25.A.2; OE exempel2g  
**Grind:** Implementering och beteendeprov krävs; inte produktionsgodkänt av detta dokument.  
**Provkontrakt:** AT-U-05 — ej kört mot systemet.

## U-06 · Request
**Typ:** Ediel/Handbok  
**Gäller:** E73 och E74  
**När:** Saknade värden identifieras

**Villkor:** Application Reference avser begärd S02/E66 respektive S03/E31. Objekt/områden, parter, produkt och period ska motsvara begäran.

**När det stämmer:** Skicka bara behörig request med tillämplig överenskommelse och bevaka resultatet.

**När det inte stämmer / förbjudet:** Bygg inte en generell 23-DGI-E73-referens och begär inte all data utan mandat.

**Anropsägare:** `request planner / utiltsApplicationReference`  
**Källa:** U §3.3,3.7.3  
**Grind:** Implementering och beteendeprov krävs; inte produktionsgodkänt av detta dokument.  
**Provkontrakt:** AT-U-06 — ej kört mot systemet.

## U-07 · Kapabilitet
**Typ:** Ediel/Handbok  
**Gäller:** S06, S08, E30, S01 och S04  
**När:** Kapabilitet prövas

**Villkor:** S06 är inte i bruk, S08 är avvecklat och andra profiler kräver andra roller än standard-DDQ/DGI.

**När det stämmer:** Håll historiska/diagnostiska adaptrar åtskilda från produktionsfunktioner.

**När det inte stämmer / förbjudet:** Giltig syntax innebär inte tillåten marknadsriktning.

**Anropsägare:** `capability registry`  
**Källa:** U §1.8,3.1  
**Grind:** Implementering och beteendeprov krävs; inte produktionsgodkänt av detta dokument.  
**Provkontrakt:** AT-U-07 — ej kört mot systemet.

## U-08 · Mätarstruktur
**Typ:** Ediel/Handbok  
**Gäller:** E66 med mätare/register  
**När:** Funktionskontroll

**Villkor:** Kontrollera mot faktiskt erhållen strukturinformation för perioden. ESCO-Z14 innehåller inte nödvändigtvis hela mätarstrukturen.

**När det stämmer:** Hantera eget strukturbevisgap internt när kontrollen är villkorad enligt guiden.

**När det inte stämmer / förbjudet:** Kräv inte hela leverantörens PRODAT-struktur av varje ESCO-mottagare.

**Anropsägare:** `structure facts resolver`  
**Källa:** U bilaga2 s.131; PZ14fält  
**Grind:** Implementering och beteendeprov krävs; inte produktionsgodkänt av detta dokument.  
**Provkontrakt:** AT-U-08 — ej kört mot systemet.

## U-09 · Observationer
**Typ:** Ediel/Handbok  
**Gäller:** Mätvärdesobservationer  
**När:** Lagring och fakturaunderlag

**Villkor:** NULL/saknat, noll, tecken, ställning, energi, effekt, kvalitet och upplösning är olika typer.

**När det stämmer:** Lagra decimaler och källkvalitet exakt med korrektionsspår.

**När det inte stämmer / förbjudet:** Fyll inte saknade värden med noll och använd inte årsprognos som faktisk kvartsenergi.

**Anropsägare:** `measurement model / billing input`  
**Källa:** U §3.6,3.7; SYS  
**Grind:** Implementering och beteendeprov krävs; inte produktionsgodkänt av detta dokument.  
**Provkontrakt:** AT-U-09 — ej kört mot systemet.

## U-10 · Periodregler
**Typ:** Ediel/Handbok  
**Gäller:** Period 245 och upplösning508  
**När:** Periodvalidering

**Villkor:** Beräkna intervall från faktisk period, produkt och fast tidszon. En kalendermånad är inte alltid30 dygn.

**När det stämmer:** Ett fullständigt24h-dygn i+CET har96 kvartar; andra perioder räknas uttryckligt.

**När det inte stämmer / förbjudet:** Hårdkoda inte96 för varje serie och använd inte energisumma som bevis på fullständighet.

**Anropsägare:** `period validator`  
**Källa:** U §3.6.18; bilaga2  
**Grind:** Implementering och beteendeprov krävs; inte produktionsgodkänt av detta dokument.  
**Provkontrakt:** AT-U-10 — ej kört mot systemet.

## U-11 · Oktoberregler
**Typ:** Ediel/Handbok  
**Gäller:** UTILTS25-A-4  
**När:** Datumstyrd aktivering

**Villkor:** E19 och ställnings-/energijämförelsen utgår. Energivärdeskontroller E97/E98/E90 avgränsas enligt guiden till E30/aggregat.

**När det stämmer:** Behåll obligatoriska fält, E87 och övriga tillämpliga kontroller oberoende av ändringen.

**När det inte stämmer / förbjudet:** En ofullständig kvartserie blir inte korrekt bara för att E19 försvinner.

**Anropsägare:** `utilts25A4 / field validator`  
**Källa:** U §1.8; bilaga2  
**Grind:** Tidigast 2026-10-01; före-datum-profilkräver25-A-3 originalkälla G01  
**Provkontrakt:** AT-U-11 — ej kört mot systemet.

## U-12 · Rapportering
**Typ:** Ediel/Handbok  
**Gäller:** UTILTS-batch  
**När:** Paketering

**Villkor:** Anledning till transaktionen är samma i meddelandet. Mätarbyte och olika skeden kan kräva separata underlag.

**När det stämmer:** Dela endast kompatibla grupper och bevara referenser och periodtäckning.

**När det inte stämmer / förbjudet:** Blanda inte E23/E88 bara för att anläggningen är densamma.

**Anropsägare:** `UTILTS batch planner`  
**Källa:** U §2,3.6.11,3.6.19  
**Grind:** Implementering och beteendeprov krävs; inte produktionsgodkänt av detta dokument.  
**Provkontrakt:** AT-U-12 — ej kört mot systemet.

## U-13 · Funktionskod
**Typ:** Ediel/Handbok  
**Gäller:** UTILTS-BGM  
**När:** Huvud byggs eller läses

**Villkor:** Skicka funktionskod9; ta emot5 utan avvisning enbart därför. Skicka AB; NA ensam är inte avvisningsgrund.

**När det stämmer:** Håll mottagningstolerans skild från utgående profil.

**När det inte stämmer / förbjudet:** Inför inte egna fel för värden guiden kräver att mottagaren kan hantera.

**Anropsägare:** `UTILTS header validator`  
**Källa:** U §3.9 BGM s.72  
**Grind:** Implementering och beteendeprov krävs; inte produktionsgodkänt av detta dokument.  
**Provkontrakt:** AT-U-13 — ej kört mot systemet.

## U-14 · Kvittensförelagring
**Typ:** Ediel/Handbok  
**Gäller:** Positiv APERAK på UTILTS  
**När:** Svar planeras

**Villkor:** Godkänd affärsbehandling och beständig lagring ska vara klara före extern positiv APERAK.

**När det stämmer:** Gör atomär lagring av accepterad data, disposition och ACK-avsikt.

**När det inte stämmer / förbjudet:** Kölagt eller bara mottaget är inte bevis på lagrade mätvärden.

**Anropsägare:** `inbox transaction service`  
**Källa:** U §5.2; SYS  
**Grind:** Implementering och beteendeprov krävs; inte produktionsgodkänt av detta dokument.  
**Provkontrakt:** AT-U-14 — ej kört mot systemet.

## TR-01 · Transport
**Typ:** Ediel/Handbok  
**Gäller:** Edieltrafik respektive applikationsmejl  
**När:** Sändning

**Villkor:** PRODAT använder SMTP/MIME/S-MIME enligt register och säkerhetsprofil. Resend-kundmejl är en separat kanal utan tyst fallback.

**När det stämmer:** Använd konfigurerad Edieltransport och rätt motpart.

**När det inte stämmer / förbjudet:** Skicka inte bytesfiler till Edielportalens testmottagare i produktion.

**Anropsägare:** `sendEdielEmail / transport adapter`  
**Källa:** T §3,5,bilagaA; befintlig kod  
**Grind:** Implementering och beteendeprov krävs; inte produktionsgodkänt av detta dokument.  
**Provkontrakt:** AT-TR-01 — ej kört mot systemet.

## TR-02 · Transportbevis
**Typ:** Ediel/Handbok  
**Gäller:** SMTP-försök  
**När:** 250/4xx/5xx/timeout

**Villkor:** SMTP-acceptans, slutlig transportleverans, CONTRL, APERAK och affärssvar är separata observationer.

**När det stämmer:** Spara kö-id, SMTP-status, RFC Message-ID, payloadhash och exakt försök.

**När det inte stämmer / förbjudet:** Låt inte sent betyda leveransaktiv. Okänt sändningsutfall ska förbli uttryckligen okänt.

**Anropsägare:** `transport attempt ledger`  
**Källa:** T §2,7.7; SYS  
**Grind:** Implementering och beteendeprov krävs; inte produktionsgodkänt av detta dokument.  
**Provkontrakt:** AT-TR-02 — ej kört mot systemet.

## TR-03 · Transportbevis
**Typ:** Intern arkitektur  
**Gäller:** MIME-arkiv  
**När:** Före första sändning

**Villkor:** En stabil RFC Message-ID ska finnas i innehållet. Bevara exakta rå-EML-byte i skyddat arkiv.

**När det stämmer:** Lagra provider-id separat och sammanhåll identiteterna.

**När det inte stämmer / förbjudet:** Spara inte enbart förhandsvisning eller en pseudoreferens utan hämtningsbart innehåll.

**Anropsägare:** `MIME builder / archive`  
**Källa:** SYS; T §7.7  
**Grind:** Implementering och beteendeprov krävs; inte produktionsgodkänt av detta dokument.  
**Provkontrakt:** AT-TR-03 — ej kört mot systemet.

## TR-04 · SMTP/DSN
**Typ:** Ediel/Handbok  
**Gäller:** SMTP-returbrev  
**När:** Inkommande e-post

**Villkor:** Klassificera multipart/report och delivery-status före EDIFACT-utdrag.

**När det stämmer:** Knyt Final-Recipient, Action, Status, Diagnostic-Code och originalidentiteter till rätt försök.

**När det inte stämmer / förbjudet:** En inbäddad originalfil får inte skapa ett nytt inkommande affärsärende.

**Anropsägare:** `inbound-mail processor`  
**Källa:** T bilagaA s.55–56; SYS  
**Grind:** Implementering och beteendeprov krävs; inte produktionsgodkänt av detta dokument.  
**Provkontrakt:** AT-TR-04 — ej kört mot systemet.

## TR-05 · Omsändning
**Typ:** Ediel/Handbok  
**Gäller:** PRODAT-omsändning/rättelse  
**När:** Fel eller timeout

**Villkor:** Omsändning tillåts vid verifierad överföringsförlust. Negativ CONTRL medför rättelse av hela meddelandet; negativ APERAK följer särskild rättelse med nytt BGM-id.

**När det stämmer:** Bevara lineage och pröva aktuell anvisning på nytt.

**När det inte stämmer / förbjudet:** En utgången timer ensam är inget tillstånd till automatisk ny sändning.

**Anropsägare:** `retry coordinator`  
**Källa:** P §4.1 s.107–108; §3.2; T §1.4  
**Grind:** Implementering och beteendeprov krävs; inte produktionsgodkänt av detta dokument.  
**Provkontrakt:** AT-TR-05 — ej kört mot systemet.

## TR-06 · Certifikat
**Typ:** Ediel/Handbok  
**Gäller:** Mottagarcertifikat  
**När:** Före sändning

**Villkor:** Kontrollera exakta giltighetsgränser, status, ändamål och ägarscope mot verklig teknisk/juridisk rutt.

**När det stämmer:** Verifiera kedja och spärrpolicy med samma guard för direkt id-val och kandidatsökning.

**När det inte stämmer / förbjudet:** Utgånget, spärrat eller ännu inte giltigt certifikat får inte passera genom dagsavrundning.

**Anropsägare:** `certificateStatus / recipient resolver`  
**Källa:** T bilagaA §A.3  
**Grind:** Implementering och beteendeprov krävs; inte produktionsgodkänt av detta dokument.  
**Provkontrakt:** AT-TR-06 — ej kört mot systemet.

## TR-07 · Certifikatöverlapp
**Typ:** Ediel/Handbok  
**Gäller:** Överlappande certifikat  
**När:** S/MIME byggs

**Villkor:** Följ anvisningens fler-certifikatfall inom korrekt mottagarscope.

**När det stämmer:** Kryptera för de giltiga mottagarcertifikat som regeln kräver.

**När det inte stämmer / förbjudet:** Välj inte slumpmässigt bara det senast registrerade certifikatet.

**Anropsägare:** `S/MIME envelope`  
**Källa:** T bilagaA §A.3  
**Grind:** Implementering och beteendeprov krävs; inte produktionsgodkänt av detta dokument.  
**Provkontrakt:** AT-TR-07 — ej kört mot systemet.

## TR-08 · TLS/SPF
**Typ:** Ediel/Handbok  
**Gäller:** SMTP-reläer  
**När:** Kommunikation

**Villkor:** Verifiera relä-TLS och SPF. TLS till första servern bevisar inte nästa serverhopp.

**När det stämmer:** Kontrollera providerpolicy och verkligt leveransspår.

**När det inte stämmer / förbjudet:** Deklarera inte hela transporten verifierad bara för att port465 kan nås.

**Anropsägare:** `transport security readiness`  
**Källa:** T §3.1,bilagaA  
**Grind:** Implementering och beteendeprov krävs; inte produktionsgodkänt av detta dokument.  
**Provkontrakt:** AT-TR-08 — ej kört mot systemet.

## TR-09 · Reservförfarande
**Typ:** Ediel/Handbok  
**Gäller:** Tillfälligt krypterings-/CRLproblem  
**När:** Reservförfarande prövas

**Villkor:** Endast uttryckligen specificerade undantagsfall i T får användas med respektive villkor/larm och fortsatt obligatorisk TLS.

**När det stämmer:** Skapa separat avvikelsejournal och avgränsad driftåtgärd.

**När det inte stämmer / förbjudet:** Ingen generell switch för oskyddad trafik och inga påhittade undantag.

**Anropsägare:** `transport exception policy`  
**Källa:** T §3.1,bilagaA  
**Grind:** Implementering och beteendeprov krävs; inte produktionsgodkänt av detta dokument.  
**Provkontrakt:** AT-TR-09 — ej kört mot systemet.

## TR-10 · Köochkrasch
**Typ:** Intern arkitektur  
**Gäller:** Köjobb och krasch  
**När:** Jobbstart, timeout eller leasebyte

**Villkor:** SMTP och DB är inte atomiska. Använd lease/fencing och särskilt unknown_after_submission.

**När det stämmer:** Försök igen endast när det säkert inte skickats eller föreskrivet beslut finns; spåra okända utfall.

**När det inte stämmer / förbjudet:** Lova inte exakt-en-gång över SMTP och gör inte rekursiva blind-retries.

**Anropsägare:** `outbox worker`  
**Källa:** SYS  
**Grind:** Implementering och beteendeprov krävs; inte produktionsgodkänt av detta dokument.  
**Provkontrakt:** AT-TR-10 — ej kört mot systemet.

## TR-11 · Skickat-mapp
**Typ:** Intern arkitektur  
**Gäller:** Skickat-mappen  
**När:** Administrativ inspektion

**Villkor:** En Skickat-kopia är en separat IMAP-/arkivfunktion.

**När det stämmer:** Använd transportjournalen som beviskälla; erbjud kopia som driftfunktion.

**När det inte stämmer / förbjudet:** En tom mapp ska inte utlösa omsändning eller betraktas som bevis på förlust.

**Anropsägare:** `operations UI`  
**Källa:** BefintligsendEdielEmail; SYS  
**Grind:** Implementering och beteendeprov krävs; inte produktionsgodkänt av detta dokument.  
**Provkontrakt:** AT-TR-11 — ej kört mot systemet.

## AI-01 · AI-lista
**Typ:** Ediel/Handbok  
**Gäller:** AI-lista  
**När:** Fil skapas eller läses

**Villkor:** Använd separat semikolonformat Ver20140401, CSV från 2025-10-01 och huvud med nätföretag först/elhandelsföretag sedan.

**När det stämmer:** Identifiera format och behörig avstämningsomfattning före bearbetning.

**När det inte stämmer / förbjudet:** Skapa inte EDIFACT-kvittenser på en AI-fil.

**Anropsägare:** `AI adapter`  
**Källa:** AI §2–3  
**Grind:** Implementering och beteendeprov krävs; inte produktionsgodkänt av detta dokument.  
**Provkontrakt:** AT-AI-01 — ej kört mot systemet.

## AI-02 · AI-lista
**Typ:** Ediel/Handbok  
**Gäller:** Utgående AI från elhandelsföretag  
**När:** Detaljrader byggs

**Villkor:** Lämna mätarnummer, avräkningsmetod, årsenergi, rapporteringsfrekvens, mätmetod och produktkod tomma.

**När det stämmer:** Fyll övriga tillämpliga verifierade marknads-/kunduppgifter och avslutande semikolon.

**När det inte stämmer / förbjudet:** Interna UUID eller site_name får inte ersätta kund-id eller kundnamn.

**Anropsägare:** `aiList builder`  
**Källa:** AI §3.1 s.8–9  
**Grind:** Implementering och beteendeprov krävs; inte produktionsgodkänt av detta dokument.  
**Provkontrakt:** AT-AI-02 — ej kört mot systemet.

## AI-03 · AI-lista
**Typ:** Ediel/Handbok  
**Gäller:** AI-listans periodurval  
**När:** Historik projiceras

**Villkor:** Ta med alla relevanta anläggningar under [från,till). Delperioder och strukturändringar ger flera detaljrader.

**När det stämmer:** Sortera objektrader i tid med tomt från först och tomt till sist. Skilj sökperiod från detaljens giltighet.

**När det inte stämmer / förbjudet:** Endast dagens aktiva objekt eller ett enda värde per kund är inte tillräckligt.

**Anropsägare:** `AI history projection`  
**Källa:** AI §2.1 s.6–7  
**Grind:** Implementering och beteendeprov krävs; inte produktionsgodkänt av detta dokument.  
**Provkontrakt:** AT-AI-03 — ej kört mot systemet.

## AI-04 · AI-lista
**Typ:** Ediel/Handbok  
**Gäller:** Inkommande AI  
**När:** Avvikelse upptäcks

**Villkor:** Listan är avstämningsunderlag, inte ett automatiskt masterdatafacit.

**När det stämmer:** Skapa utredningspost med källbevis; en senare ändring får en egen behörig process.

**När det inte stämmer / förbjudet:** Uppdatera inte kund, objekt eller BRP direkt från listan.

**Anropsägare:** `AI reconciliation`  
**Källa:** AI §1.1  
**Grind:** Implementering och beteendeprov krävs; inte produktionsgodkänt av detta dokument.  
**Provkontrakt:** AT-AI-04 — ej kört mot systemet.

## AI-05 · BI-lista
**Typ:** Ediel/Handbok  
**Gäller:** BI i DDQ/DGI-plattform  
**När:** Export begärs

**Villkor:** BI används enbart av nätföretag för angivna strukturändringar.

**När det stämmer:** Stöd behörig mottagning/utredning; spärra utgående BI i DDQ/DGI.

**När det inte stämmer / förbjudet:** Känd CSV-struktur ger ingen marknadsbehörighet.

**Anropsägare:** `BI capability gate`  
**Källa:** AI §1.1,3.2  
**Grind:** Implementering och beteendeprov krävs; inte produktionsgodkänt av detta dokument.  
**Provkontrakt:** AT-AI-05 — ej kört mot systemet.

## DB-01 · Datamodell
**Typ:** Intern arkitektur  
**Gäller:** Affärsdata och protokolljournal  
**När:** Schema ändras

**Villkor:** Identifiera befintlig auktoritativ tabell för varje uppgift innan något nytt skapas.

**När det stämmer:** Utöka med expand, backfill, validate och först därefter contract.

**När det inte stämmer / förbjudet:** Skapa inte parallella kund-, regel- eller ruttauktoriteter.

**Anropsägare:** `migration design`  
**Källa:** SYS  
**Grind:** Implementering och beteendeprov krävs; inte produktionsgodkänt av detta dokument.  
**Provkontrakt:** AT-DB-01 — ej kört mot systemet.

## DB-02 · Referensintegritet
**Typ:** Intern arkitektur  
**Gäller:** Tenantägda relationer  
**När:** Insert/update

**Villkor:** Verifiera tenant+id-referenser, unika idempotensnycklar och tillämpliga datum-/aktörsrelationer.

**När det stämmer:** Förhindra korskoppling och motstridiga aktiva perioder med constraints/RPC.

**När det inte stämmer / förbjudet:** Frontendvalidering och ett UUID utan kontroll av parent räcker inte.

**Anropsägare:** `DB constraints / RPC`  
**Källa:** SYS  
**Grind:** Implementering och beteendeprov krävs; inte produktionsgodkänt av detta dokument.  
**Provkontrakt:** AT-DB-02 — ej kört mot systemet.

## DB-03 · Lagring
**Typ:** Normkrav + intern verkställighet  
**Gäller:** Mät- och strukturrättelser  
**När:** Godkänd ändring lagras

**Villkor:** Bevara giltighetsperiod, registreringstid, mottagningstid och källmeddelande/IDE/regelbeslut.

**När det stämmer:** Skapa ny version och daterad projektion.

**När det inte stämmer / förbjudet:** Förlora inte historiken eller ändra fastställt fakturaunderlag osynligt.

**Anropsägare:** `history / measurement storage`  
**Källa:** U §3.6.14; SYS  
**Grind:** Implementering och beteendeprov krävs; inte produktionsgodkänt av detta dokument.  
**Provkontrakt:** AT-DB-03 — ej kört mot systemet.

## DB-04 · Index
**Typ:** Intern arkitektur  
**Gäller:** Index och frågor  
**När:** Migration/prestandaprov

**Villkor:** Utgå från faktiska urval för tenant/aktör, status/tidsfrist, referenser, objekt/period/version och foreign keys.

**När det stämmer:** Verifiera planer och belastning med EXPLAIN och representativ data.

**När det inte stämmer / förbjudet:** Index på alla kolumner ersätter inte en mätt prestandaplan.

**Anropsägare:** `DB migration / CI`  
**Källa:** SYS  
**Grind:** Implementering och beteendeprov krävs; inte produktionsgodkänt av detta dokument.  
**Provkontrakt:** AT-DB-04 — ej kört mot systemet.

## DB-05 · Radering
**Typ:** Intern arkitektur  
**Gäller:** Kund, tenant eller uppdrag avslutas  
**När:** Raderingsbegäran

**Villkor:** Skilj operativ avveckling, åtkomstrevoke, persondatagallring och skyldighet att bevara journal/avräkningsunderlag.

**När det stämmer:** Använd en beslutad workflow per retentionklass och behörigt underlag.

**När det inte stämmer / förbjudet:** Radera inte all historik med CASCADE och spara inte allt för alltid utan rättslig grund.

**Anropsägare:** `data lifecycle service`  
**Källa:** SYS; juridiskretentionG04  
**Grind:** Implementering och beteendeprov krävs; inte produktionsgodkänt av detta dokument.  
**Provkontrakt:** AT-DB-05 — ej kört mot systemet.

## DB-06 · Fakturaunderlag
**Typ:** Intern arkitektur  
**Gäller:** Fakturaunderlag i leverantörsrollen  
**När:** Underlag fastställs

**Villkor:** Verifiera kvantitetstyp, produkt, period, leveransrelation, dataversion, prisversion och kvalitet.

**När det stämmer:** Lås spårbart underlag och skapa särskild rättelsejournal vid nya data.

**När det inte stämmer / förbjudet:** S02-prognos, E31-aggregat eller DGI-leverans blir inte automatiskt individuell faktura.

**Anropsägare:** `billing input assembler`  
**Källa:** U §3.1–3.2; SYS  
**Grind:** Implementering och beteendeprov krävs; inte produktionsgodkänt av detta dokument.  
**Provkontrakt:** AT-DB-06 — ej kört mot systemet.

## OPS-01 · Readiness
**Typ:** Intern arkitektur  
**Gäller:** Ny regel, rutt, schema eller release  
**När:** Publicering/konfigurationsändring

**Villkor:** Skapa nytt bevis per berörd tenant, aktörsroll och kapabilitet med versionslåst dependencyhash.

**När det stämmer:** Ogiltigförklara berörda bevis och gör ny prövning; skydda samtidigt fortsatt mottagnings-/kvittenshantering.

**När det inte stämmer / förbjudet:** Ett gammalt globalt is_ready godkänner inte nya funktioner eller tenants.

**Anropsägare:** `readiness service`  
**Källa:** SYS  
**Grind:** Implementering och beteendeprov krävs; inte produktionsgodkänt av detta dokument.  
**Provkontrakt:** AT-OPS-01 — ej kört mot systemet.

## OPS-02 · Nästaåtgärd
**Typ:** Intern arkitektur  
**Gäller:** Öppna ärenden  
**När:** Varje händelse eller timer

**Villkor:** Beräkna nästa åtgärd från processbeslutet med orsak, tidsgrund, ansvar och blockerare.

**När det stämmer:** Visa vad systemet väntar på och vilka åtgärder som faktiskt är tillåtna.

**När det inte stämmer / förbjudet:** Ett statiskt waiting_for_contrl-fält får inte styra hela affärskedjan.

**Anropsägare:** `process reducer / UI projections`  
**Källa:** SYS  
**Grind:** Implementering och beteendeprov krävs; inte produktionsgodkänt av detta dokument.  
**Provkontrakt:** AT-OPS-02 — ej kört mot systemet.

## OPS-03 · Certifiering
**Typ:** Normkrav + intern verkställighet  
**Gäller:** Releasegodkännande  
**När:** Tester sammanställs

**Villkor:** Håll dokumenttäckning, enhetstest, integration, tenant-E2E, transport och TGT som separata bevis.

**När det stämmer:** Lås release till exakt head och testa flera tenants, DDQ, DGI och cross-tenantuppdrag.

**När det inte stämmer / förbjudet:** Specifikations-JSON som validerar är inte produktions-E2E eller formellt Edielgodkännande.

**Anropsägare:** `CI / release manifest`  
**Källa:** P §1.3; U §1.5; TGT; SYS  
**Grind:** Implementering och beteendeprov krävs; inte produktionsgodkänt av detta dokument.  
**Provkontrakt:** AT-OPS-03 — ej kört mot systemet.

## OPS-04 · Begränsadliveverifiering
**Typ:** Intern arkitektur  
**Gäller:** Kontrollerad produktionstest  
**När:** Efter rättelse

**Villkor:** Verifiera incidentspår, rutt, certifikat, profil och tenantkontext samt ett överenskommet motpartsprov.

**När det stämmer:** Genomför ett kontrollerat verkligt förlopp i rätt miljö.

**När det inte stämmer / förbjudet:** Massimport av referenser eller blinda omsändningar är inte en teststrategi.

**Anropsägare:** `release runbook`  
**Källa:** TGT; SYS  
**Grind:** Implementering och beteendeprov krävs; inte produktionsgodkänt av detta dokument.  
**Provkontrakt:** AT-OPS-04 — ej kört mot systemet.

## OPS-05 · Internafel
**Typ:** Intern arkitektur  
**Gäller:** Internt fel eller okänd kontext  
**När:** Runtimefel

**Villkor:** Skilj protocol_rejection från internal_failure, security_quarantine och unsupported_capability.

**När det stämmer:** Larma, bevara original och kvittensstatus och ge bara källstödda externa svar.

**När det inte stämmer / förbjudet:** Hitta inte på APERAK-fält42/xxx därför att den egna applikationen kraschar.

**Anropsägare:** `error algebra / observability`  
**Källa:** SYS  
**Grind:** Implementering och beteendeprov krävs; inte produktionsgodkänt av detta dokument.  
**Provkontrakt:** AT-OPS-05 — ej kört mot systemet.

## ENV-10 · Positionsnamn
**Typ:** Ediel/Handbok  
**Gäller:** PRODAT CCI kontra UTILTS CCI  
**När:** Fältlokalisering

**Villkor:** PRODAT använder SG14/CCI/C502/6313 för Z-egenskapen. UTILTS använder normalt C240/7037. Samma segmentnamn betyder inte samma elementlayout.

**När det stämmer:** Bind till familjens/releasens fulla segmentdefinition.

**När det inte stämmer / förbjudet:** Använd inte en gemensam CCI-position som flyttar PRODAT-egenskaper.

**Anropsägare:** `field locator compiler`  
**Källa:** P §2.6; U §3.9  
**Grind:** Implementering och beteendeprov krävs; inte produktionsgodkänt av detta dokument.  
**Provkontrakt:** AT-ENV-10 — ej kört mot systemet.

## ACK-10 · P-APERAK BGM
**Typ:** Ediel/Handbok  
**Gäller:** APERAK på PRODAT  
**När:** Byggare/korrelation

**Villkor:** BGM/1225 bär27/34; BGM/1001 och1004 används inte. Exempel på struktur är BGM+++34.

**När det stämmer:** Använd RFF+ACW till originaletsBGM och eget teknisktUNH/arkiv-id.

**När det inte stämmer / förbjudet:** Placera inte27/34 i1001 eller kräv eget P-APERAKBGM-id.

**Anropsägare:** `P acknowledgement builder`  
**Källa:** P s.98–100  
**Grind:** Implementering och beteendeprov krävs; inte produktionsgodkänt av detta dokument.  
**Provkontrakt:** AT-ACK-10 — ej kört mot systemet.

## U-15 · UTILTS-paketering
**Typ:** Ediel/Handbok  
**Gäller:** Utgående och inkommande UTILTS  
**När:** Batch och validering

**Villkor:** En UTILTS-överföring UNB–UNZ innehåller endast ett meddelande UNH–UNT och en juridisk mottagare. Blanda inte skeden, anledning eller kvart-/månadsupplösning enligt Application Reference.

**När det stämmer:** Paketera kompatibla transaktioner till rätt mottagare inom tillåtna gränser.

**När det inte stämmer / förbjudet:** En generell multi-message-codec får inte kringgå UTILTS specifika paketeringsregel.

**Anropsägare:** `UTILTS batch planner / validator`  
**Källa:** U §3.6.19 s.48  
**Grind:** Implementering och beteendeprov krävs; inte produktionsgodkänt av detta dokument.  
**Provkontrakt:** AT-U-15 — ej kört mot systemet.

## U-16 · Storlekar
**Typ:** Ediel/Handbok  
**Gäller:** UTILTS och allmänna Ediel-filer  
**När:** Paketering/kapacitetsplan

**Villkor:** T anger rekommenderad maxstorlek10MB; U anger fortfarande1MB och999transaktioner. Skilj rekommendation från syntax/nationell kardinalitet.

**När det stämmer:** Utgående U kan hållas inom1MB och999 för att uppfylla båda; dokumentera mottagarkapacitet och fulla grammatikgränser.

**När det inte stämmer / förbjudet:** Avvisa inte automatiskt meddelande över en rekommendation med påhittad syntaxfelkod.

**Anropsägare:** `batch limits / source conflict registry`  
**Källa:** T §7.6; U §3.6.20 s.48–49  
**Grind:** Implementering och beteendeprov krävs; inte produktionsgodkänt av detta dokument.  
**Provkontrakt:** AT-U-16 — ej kört mot systemet.

## U-17 · APERAK-fältreferens
**Typ:** Ediel/Handbok  
**Gäller:** UTILTS guidefel utan direkt numrerat fält  
**När:** Felreferens byggs

**Villkor:** När bilaga1 säger om möjligt används i första hand fältnummer; annars, om möjligt, angiven segment-/elementreferens med max17tecken.

**När det stämmer:** Behåll källstyrd hänvisning såsom DTM/2005 i tillämpligt fall.

**När det inte stämmer / förbjudet:** Påstå inte att alla fel måste ha ett numeriskt fältnummer eller gissa ett från kvalificeraren.

**Anropsägare:** `U error mapper`  
**Källa:** U bilaga1 s.121  
**Grind:** Implementering och beteendeprov krävs; inte produktionsgodkänt av detta dokument.  
**Provkontrakt:** AT-U-17 — ej kört mot systemet.

## U-18 · Observationsordning
**Typ:** Ediel/Handbok  
**Gäller:** UTILTS med ställningar och energi  
**När:** Observationer parsas/byggs

**Villkor:** Håll energier sammanhängande och tidsordnade; ställningar sammanhängande och tidsordnade. Blockens inbördes ordning är valfri. Samma ställning med tid får inte dupliceras inom transaktionen.

**När det stämmer:** Bevara observationernas typ och ordning enligt gruppen.

**När det inte stämmer / förbjudet:** Kräv inte alltid ställningar först och blanda inte ställningar mellan energivärden.

**Anropsägare:** `observation parser / builder`  
**Källa:** U §3.6.18 s.47  
**Grind:** Implementering och beteendeprov krävs; inte produktionsgodkänt av detta dokument.  
**Provkontrakt:** AT-U-18 — ej kört mot systemet.

## U-19 · PRODAT-referens i UTILTS
**Typ:** Ediel/Handbok  
**Gäller:** RFF med referensfält226  
**När:** Nationell kontroll

**Villkor:** Referens till PRODAT-ärende används för korrelation där den går att knyta; bilaga1 anger inga kontroller av värdet och ingen avvisning om kvalificeraren inte är TN.

**När det stämmer:** Använd referensen för möjlig korrelation utan att göra den till obligatorisk auktoriseringsnyckel för alla serier.

**När det inte stämmer / förbjudet:** Avvisa inte giltig E66 enbart för avsaknad/fel korrelationsreferens där guiden inte föreskriver det.

**Anropsägare:** `UTILTS national validator / correlator`  
**Källa:** U §3.6.12; bilaga1 s.126  
**Grind:** Implementering och beteendeprov krävs; inte produktionsgodkänt av detta dokument.  
**Provkontrakt:** AT-U-19 — ej kört mot systemet.
