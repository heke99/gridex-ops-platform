# Gridex — master-masterplan för Ediel
## Version 2.0 · regel-, process- och implementationsspecifikation
**Datum:** 2026-09-10  
**Omfattning:** svensk elmarknad; multitenantplattform; elhandelsföretag (DDQ); energitjänsteföretag (DGI); ESCO-tjänster åt andra tenants.  
**Koppling till kodgranskning:** `heke99/gridex-ops-platform`, granskad bas `eb9a25bc989c6de808903f41c2314d5465e9c07b`. Detta dokument ändrar inte repository, databas eller trafik.  
**Status:** utökad byggspecifikation med ifyllda matriser och uttryckliga käll-/bevisgrindar. Inte ett intyg om komplett regelcertifiering, färdig implementation eller godkänd produktion.

## Läsordning och leveransens gräns
Läs först avsnitt 1–6 för scope, juridisk roll och central beslutskedja. Avsnitt 7–14 bestämmer meddelandenas uppbyggnad och behandling. Avsnitt 15–21 bestämmer databas, intern distribution, genomförande och verifiering. Bilagorna innehåller ifyllda regelkort, fältmatriser, villkor och acceptanskontrakt.

Denna version ersätter v1.0:s målarkitektur där den är mer precis. De 62 tidigare granskningspunkterna finns kvar som historiskt fel-/bevisregister och är **inte** markerade lösta. En genomförd dokumentkontroll räknas inte som ett systemtest. Saknat källunderlag begränsar berörd kapabilitet, inte automatiskt hela plattformen.

**Normativa krav** hämtas från Ediel och Handboken. **Intern arkitektur** beskriver hur vår plattform ska genomföra kraven och isolera tenants. En regelrad kan kombinera ett normkrav med en föreslagen intern verkställighet; våra tabellnamn, hashkrav och test-id är inte fält som Ediel föreskriver. Egna säkerhets-/kapabilitetsgränser får inte kläs ut till en påhittad extern Ediel-felkod.

### Viktigt om fullständighet
Detta är en konkret specifikation för de identifierade och källbelagda tillämpliga reglerna, inte ett påstående att varje möjlig framtida, bilateral eller ännu ej tillgänglig regel har kodifierats. Framför allt behöver den äldre UTILTS 25-A-3-fulltexten, vissa aggregat-/testunderlag och de verkliga cross-tenantavtalen stänga sina bevisgrindar. **Ingen utvecklare får fylla de luckorna med antaganden för att få en grön byggstatus.**

### Vad som är ifyllt i v2
| Register | Omfattning | Tolkning |
| --- | --- | --- |
| Regelkort | 121 | Konkreta villkor, utfall, ansvarig modul, källa och provkoppling; både branschkrav och interna krav. |
| PRODAT-fall | 38 | Samtliga kartlagda funktion/undertypkombinationer inklusive bilateralt avgränsade fall. |
| PRODAT-fält | 74 numeriska fält + 3 parentgrupper | 13 funktioners användningsklass, exakt locator och segmenttabellbevis. |
| PRODAT D-celler | 110 | Varje D-cell i basmatrisen har uttryckligt villkor; underordnad parent-/registerregel gäller dessutom. |
| UTILTS applikationsrader | 152 | Kontextberoende rader från kapitel 3.7; samma fältnr återkommer i olika profiler. |
| UTILTS kodkontroller | 115 | Nationella locator-/kod-/villkorsrader ur bilaga 1, med källhänvisning. |
| Kontroll-/felregler | 20 | Syntax, P/U-huvud, objekt/transaktion, lagring och specifika UTILTS-ERR-kontroller. |
| Timers | 31 | Normativ tidsgrund skild från intern bevakning. |
| Tillståndsövergångar | 42 | Transport, ACK, leverans, ESCO, grants, mätdata och AI. |
| Anropskontrakt | 16 | Vilken ingång som ska använda vilket centralt beslut och vad den inte får göra själv. |
| Acceptanskontrakt | 231 | 72 sammansatta scenarier samt regel-/meddelandekontrakt; INTE körda mot systemet. |
| Tidigare granskningspunkter | 62 | Bevarade med evidensklass, reservationer och åtgärd. |

## 1. Fastställd produktionsomfattning
### 1.1 Tre skilda driftsätt måste stödjas
**Egen aktör per tenant.** Tenant A är ett elhandelsföretag eller ESCO med egen juridisk Edielidentitet. Trafiken behåller A:s identitet även om transportbrevlådan och plattformen är gemensamma. En gemensam brevlåda är inte ett ombudsmandat.

**Provider som juridisk ESCO åt annan tenant.** Gridex eller annan uttryckligen utsedd provider P agerar juridiskt som energitjänsteföretag. En beneficiary-tenant K beställer tjänsten för ett tillåtet kund-/objektscope. P:s DGI-identitet används på marknaden; K:s interna tenant-id skickas inte som en låtsad marknadsidentitet. K får data genom ett separat, avgränsat internt åtkomstgrant. P måste ha relevant grund gentemot slutkund och nätägare; avtal med K ensamt ersätter inte detta. [HB kap.11; P §2.1]

**Teknisk hosting eller verkligt tekniskt ombud.** Hosting av tenantens system ändrar inte i sig juridisk avsändare. Om ett tekniskt ombud faktiskt finns ska dess registrerade tekniska identitet, juridiska huvudman och mandat bevaras. Det är ett separat, uttryckligen aktiverat upplägg — inte en automatisk följd av att Gridex driver plattformen. [T §5]

En tenant som enbart är kund till ESCO-SaaS behöver inte uppfinnas som Edielaktör. Däremot krävs egen eller faktiskt företrädd registrerad marknadsaktör när tenanten själv ska uppträda på elmarknaden.

### 1.2 Roller som inte följer med automatiskt
Nätägare, balansansvarig (BRP), BSP, mätvärdesinsamlare och avräkningsansvarig är inte samma roller som DDQ/DGI. Att en funktion går att parsa, att den finns i en referensfil eller att en annan aktör är ansluten via Bixia ger inte plattformen rätt att utföra den rollen.

EL är aktiv marknad i denna specifikation. GAS-rader får bevaras vid registerimport för korrekt källhistorik men ska inte användas av EL-resolvern. Energidelning enligt P §2.3 har en särskild framtida aktiveringsgrind från 2027-01-01; framtida föreslagna koder och ändringar är inte dagens regler.

### 1.3 Delegerad handläggare är inte delegerad juridisk aktör
En plattformsoperatör kan genom behörigt uppdrag utföra en administrativ åtgärd för en annan tenant. Åtgärden ska fortfarande bära den riktiga marknadsaktören, den tillämpliga verksamhetsrollen, mandatets omfattning och den faktiska användarens auditidentitet. Användarens superadminroll ska aldrig automatiskt byta wire-aktör eller skapa rätt till kunddata.

## 2. Källstyrning, företräde och versioner
### 2.1 Källtyper
**HB** är Elmarknadshandboken 26A med processerna. **T** är Generella tekniska regler 24.A revision 6. **P** är PRODAT 26.A och gas 16.B revision 3. **U** är svenska UTILTS 25-A-4 för oktober 2026; den uppladdade sidfoten säger 25-A-5 trots omslagets revision 4. **UE** är den engelska översättningen av samma oktoberprofil. **AI** är AI-listan 14.A.3. **OE** är objektexemplen E5SE5A. **AP** är den separata generiska APERAK 05.B.5 som inte ersätter P- eller U-specifika kvittenser.

Filhashar och exakta filnamn finns i `registers/source_manifest.json`. Referenser till avsnitt och sidnummer avser tryckt sidnumrering i dokumenten. Översättningar eller manuellt redigerade exempel ska inte tyst få företräde framför en uttrycklig normregel.

### 2.2 Företräde inom en profil
För PRODAT gäller §2.2 före motstridiga villkor i bilaga 4. Basmatrisen gäller första registret; register 2+ följer bilaga 2. Parentgruppens tillämplighet avgör om barnets R-krav över huvud taget gäller. Det löser exempelvis Z14N utan de positiva Z14-grupperna. [P s.15,114–125]

Syntaxklass M i den internationella meddelandestrukturen är inte samma sak som nationell Required-klass. CONTRL får inte göras till en nationell fältvalidator. Detaljerade nationella tabeller kan utelämna ej använda senare element; därför ska full UNSM-grammatik finnas som separat källa för korrekt syntaxkontroll. [T §2.1; U §3.9,5.5]

### 2.3 Versionsbeslutet ska vara konsekvent, inte ett enda godtyckligt datum
Beslutet ska separat bära: planerad/faktisk sändningstid, mottagaren-tillhanda om känd, lokal ingress, dokumentets skapandetid, affärshändelsens giltighetsdatum, mätperiod, historisk återspelningsmode och vilka datum som styr vilka regler.

Utgående trafik och omsändningar använder den då aktuella anvisningen om inget tillåtet bilateralt undantag finns. Mottagaren ska under tvåveckorsövergång kunna hantera närmast föregående giltiga anvisning, om inte överordnade regler hindrar. Oktober2026-profilen får inte användas som bevis för att alla septemberkontroller är rätt. Samma E5SE5A i UNH skiljer inte25-A-3 från25-A-4. [T §1.4; U/UE omslag]

Vid övergång utan separat wiremarkör ska hela den mottagna transaktionen prövas mot en sammanhållen tillåten profil. Om gamla/nya regler ger samma tillåtna effekt behövs ingen gissad avsikt. Om de ger en oavgjord semantisk konflikt ska resultatet och källorna synas; inga enstaka regler får plockas från olika versioner för att få meddelandet godkänt.

### 2.4 Identifierade källkonflikter att bevara
P:s översikt har Z34 för E-undertyp, medan den detaljerade fältdefinitionen anger E34. P:s bilaga 4 innehåller en äldre associationskod, medan den aktuella profilen är E2SE6A. P:s exempel vid tillståndssyfte använder A02 medan kodtabellen anger B71–B76. U:s svenska dokumentnamn/sidfot och omslag är inte helt konsekventa. T rekommenderar10MB generellt medan U fortfarande rekommenderar1MB och999transaktioner. Dessa skillnader ska vara dokumenterade i tolkningsregistret och inte döljas genom ändrade originalfiler.

För utgående UTILTS är högst1MB och999transaktioner ett konservativt internt paketeringsval som ryms inom båda storleksrekommendationerna. En rekommendation är dock inte i sig en automatisk extern syntaxavvisningsgrund. Den fulla grammatikens och profilens faktiska kardinalitetsregler ska bedömas separat. [T §7.6; U §3.6.19–20]

## 3. Central regelarkitektur
### 3.1 Behåll en gemensam auktoritet
`lib/ediel/rulebook/canonicalEdielPolicy.ts` ska fortsatt vara den publika ingången för de källstyrda protokollreglerna. Bakom den finns små, avgränsade moduler för guideversion, fältmatris, villkor, meddelanderoller, kodlistor, kvittenser och tidsregler. En central auktoritet betyder inte att all kod ska pressas in i en fil.

Ett överordnat **execution context** ska koppla protokollbeslutet till verifierad tenant, juridisk aktör, verksamhetsroll, kund-/DSO-/serviceavtal, aktuell process och tillämpliga interna åtkomstgrants. Att en ren protokollfunktion saknar company_id är inte automatiskt ett fel; det får däremot inte gå att verkställa dess resultat utan kontextkontrollen.

### 3.2 Tre ansvar som inte får blandas
`resolveCanonicalEdielPolicy` besvarar **vad protokollet kräver**. Ett kontext-/kapabilitetslager besvarar **vem som får göra det och i vilket ärende**. En verkställare besvarar **hur en fastställd mutation eller sändning genomförs säkert och atomärt där det går**.

Databastabeller för regelvisning och sökning är projektioner av publicerade regelpaket. Manuella DB-rader får inte överstyra betydelsen av Z04, ändra vilka fält APERAK ska referera eller välja en annan anvisning än det publicerade beslutet. Bilaterala kapabiliteter och verkliga tenant-/rättighetsfakta ligger däremot i databasen med eget mandat, giltighet och evidens.

### 3.3 Beslutet som ska följa operationen
Varje operativt beslut ska minst bära följande fält. Namnen är föreslagna interna kontrakt, inte nya EDIFACT-element.

| Beslutsdel | Obligatoriskt innehåll |
| --- | --- |
| Identitet | decision_id, intent_id, owner/operating_tenant_id, legal_actor_profile_id, role, market, environment, acting_user/service_identity |
| Uppdrag | service_assignment_ids, beneficiary_scope vid intern distribution, kund-/DSO-/bilaterala evidensreferenser |
| Meddelande | wire_family, business_code, subtype, reason_code, direction, phase, original_family/message/transaction vid svar, requested_message vid request |
| Regelpaket | guide/revision/association, source_hashes, syntax_grammar_id, field_profile_id, rulepack_hash, rule_ids, activation_dates |
| Fakta/tid | faktaversioner och ursprung; varje relevant tidsankare med typ/offset/källa; trevärda villkor |
| Rutt/säkerhet | register_snapshot_id, legal/technical parties, subaddress, SMTP-route-version, säkerhetsprofil och certifikatbevis |
| Affärseffekt | expected_state_version, tillåtna mutationer, eventuella kompensationer, efterföljande intents och förväntningar |
| Svar | typed syntax/header/object/transaction outcomes, ACK-profile, referenser, kod/fältnr/feltext; ingen strängregex som bygger semantik |
| Grants | separat tillstånds-/åtkomstbeslut per intern beneficiary; objekt/produkt/period/fält/ändamål |
| Verkställighetsgrind | operativt mode, expiry/revalidation dependencies, required readiness evidence; katalog/replay kan aldrig vara sändningsauktoritet |

### 3.4 Inga lokala regelomval
En byggare får inte efter beslutet välja DGI därför att ett globalt actor_setting säger DGI. UTILTS-motorn får inte välja en annan revision med now() efter att runtimeDecision redan valt en profil. En worker får inte godkänna en gammal rutt bara för att avsikten tidigare var ready.

Samma fakta kan förändras och ge ett nytt beslut, men det måste vara uttryckligt. Före sändning kontrolleras om relevanta dependencies har ändrats. Nytt beslut får inte skriva om historiken för vad ett tidigare försök faktiskt innehöll.

### 3.5 Fel ska vara typade
Minst `syntax_rejection`, `guide_rejection`, `processability_rejection`, `business_negative_response`, `internal_failure`, `security_quarantine`, `unsupported_capability` och `delivery_unknown` ska vara olika kategorier.

En lokal tenantmatchningsbugg är inte automatiskt fel anläggnings-id hos avsändaren. Samtidigt kan en guide uttryckligen medge ett applikationsfel vid avbruten behandling; sådant svar ska då följa den familjens kod och struktur. Ett generellt catch-block får aldrig välja 42 eller E10 utan regelstöd.

## 4. Exakt när den centrala kedjan ska anropas
| ID/ingång | Befintlig ansvarig del | Centralt kontrakt/utdata | Förbud |
| --- | --- | --- | --- |
| CALL-01 · UI/API/manual action | app/admin/* + kund/API-actions | Ediel command service (gemensam, föreslagen) → Auktoriserat command + processavsikt | UI får inte direkt bygga EDIFACT eller ändra affärsstatus. |
| CALL-02 · Affärsprocess | prodatLifecycle / inboundBusinessStateMachine | Processbeslut + resolveCanonicalEdielPolicy → Rätt aktörsroll, meddelandevariant, mutationsplan och nästa åtgärd | Behåll P-/ESCO-processer separata. |
| CALL-03 · Render | prodat/builders/profileRenderer.ts + z09/z13 | Publicerad fältprofil + explicit execution decision → Positionsstabil segmentstruktur | Render får inte omvälja roll, datumversion eller field matrix. |
| CALL-04 · Kuvert | core/edifactEnvelopeCodec.ts | Teknisk kvittens- och kuvertprofil → UNB/UNH/UNT/UNZ och byteprofil | 0031 ska komma från samma beslut som bevakningen. |
| CALL-05 · Register | parseActorRegistryXml.ts och admin/ediel/actors/actions.ts | En gemensam importkärna med formatadaptrar → Typed market actor/role/route snapshots | Avveckla dubbel auktoritet först efter paritetsbevis. |
| CALL-06 · Pre-send | core/kernel.ts / outbound pipeline | Revalidate execution + route/cert security → Aktuellt sändningsbeslut och immutabel payload | Mode catalog_evidence eller historical_replay får aldrig skicka. |
| CALL-07 · SMTP | lib/email/sendEdielEmail.ts | Transport attempt service → Observerat försök, ej affärsacceptans | SMTP-ledger skiljs från APERAK- och processledger. |
| CALL-08 · Inkommande mail | lib/inbound-mail/* | MIME/DSN/AI/EDIFACT classifier → Säker format- och mottagningskontext | DSN identifieras före extraktion av inbäddad EDIFACT. |
| CALL-09 · Parser | core/canonicalEdifactAst.ts + tokenizer | Full grammar + immutable raw record → Message/line/register/transaction/observation AST | Ingen första-träff som generell auktoritet. |
| CALL-10 · Nationell P-kontroll | core/runtimeDecision.ts | resolveCanonicalEdielPolicy + field/group/reg selectors → Objektvisa utfall med riktiga fältreferenser | Borttagna fel måste rättas i källan, inte döljas i gate. |
| CALL-11 · Nationell U-kontroll | utiltsEngine.ts / utiltsInboundPolicyProcessor | Explicit shared rule selection + staged validation → Headerresultat + per-IDE dispositions | Förmedla versionsbeslut, kör inte nytt now()-baserat policyval. |
| CALL-12 · ACK | ack/canonicalAckEngine.ts + builders | Originalfamilj + disposition + korrelation → CONTRL/P-AP/U-AP/ERR på rätt nivå | Kvittensfamilj väljs inte från tenantdefault. |
| CALL-13 · Affärsmutation | Leverans-/kundinfo-/tillstånds-RPC | Validated mutation plan + DB guards → Atomisk mutation, händelse, outbox | Inga trustade client-provided tenant-id utan rättighetskontroll. |
| CALL-14 · Intern distribution | ESCO data-access service (föreslagen) | Market permission + service assignment + grant → Objekt-/period-/fältbegränsad projektion | Råfilen exponeras inte för varje beneficiary. |
| CALL-15 · Timers/retry | deadlinePolicy + scheduled workers | Rule-specific timer policy + process state → Bevakning, kontakt eller tillåten rättelse | Ingen generell timeout→resend→active-kedja. |
| CALL-16 · Readiness/release | Tenant readiness + CI/release | Dependency-scoped evidence → Ett nytt versionslåst bevis per berörd scope | Gamla sändningar reprocessas inte automatiskt vid regeländring. |

### 4.1 Kontrollordning för en utgående operation
**Command → behörigt verksamhetssammanhang → processens tillåtna nästa steg → protokollprofil → fältvärden och villkor → byte/rendering → syntax-/profilpreflight → beständig outbox → aktuell rutt/säkerhet/behörighet före sändning → transportförsök → separat bevakning.**

En klient kan ange sin önskade handling men får inte leverera ett trustat `bilateralCapabilityVerified=true`, bestämma provider_actor_id fritt eller skicka ett eget “godkänt regelbeslut”. Servern härleder och verifierar uppgifterna.

### 4.2 Kontrollordning för mottagning
**Säker MIME-klassificering → DSN/AI/EDIFACT som olika grenar → bytearkiv och säker teknisk attribution → full syntax → föreskriven CONTRL → nationell huvudkontroll → objekt/transaktionskontroll → behörig affärsmutation och ACK-intent → extern kvittens → intern grantstyrd distribution.**

För UTILTS får en transaktion med guidefel inte gå vidare till funktionskontrollen. Korrekta syskontransaktioner behandlas däremot vidare när huvudet är korrekt. För PRODAT gäller dess egen objekts- och flerregisterlogik. [U s.107; P §3 och bilaga 2]

### 4.3 Inkommande och utgående beslutsdata får inte vara samma sak
Inkommande värden bevaras exakt och jämförs med källregler. Utgående värden skapas ur tillåtna auktoritativa fakta. Att sanera ett inkommande felaktigt kund-id innan kontroll kan maskera felet; att återge skyddade värden i obehöriga loggar kan skapa ett dataskyddsfel. Arkiv, valideringsrepresentation och maskerad användarvy måste därför vara separata.

## 5. Multitenant och ESCO för andra tenants
### 5.1 Rättigheterna ska finnas på tre nivåer
**Marknadstillstånd:** vad nätägaren har godkänt för den juridiska ESCO-aktören.  
**Serviceuppdrag:** vad provider och beneficiary har avtalat att tjänsten ska göra för slutkunden.  
**Internt åtkomstgrant:** vilken beneficiary och användargrupp som får använda vilka mottagna uppgifter, för vilket ändamål och vilken period.

Ett marknadstillstånd ska inte dupliceras bara för att två interna tenants använder samma tillåtna tjänst. Ett internt serviceavtal får samtidigt inte utöka marknadstillståndets objekt eller period. Delning kräver att den är tillåten i det konkreta upplägget; systemmodellen är inte en juridisk slutsats om att all sådan delning är tillåten.

### 5.2 Exempel: P levererar ESCO åt K1 och K2
P:s juridiska ESCO skickar Z13 med DGI. Nätägaren skickar Z14 för godkända objekt och därefter E66-DGI. Råmottagningen, det juridiska ansvaret och kvittensbeslutet hör till P. Mottagna data kan sedan projiceras till K1 och K2 endast i den utsträckning respektive grant är giltigt. Det är **inte** en ny marknadsmottagning per beneficiary, och det behövs inte en extra APERAK till nätägaren för varje intern konsument.

Om K1 avslutar ska K1:s tjänste-/åtkomsträtt begränsas enligt mandatet. P ska inte automatiskt skicka Z18 för ett tillstånd som fortfarande behövs och får användas för K2. När P faktiskt ska avsluta marknadstillståndet följer Z18/Z15 med rätt id och tidsuppgifter.

### 5.3 Flera giltiga grants är inte alltid en korrelationskonflikt
Först identifieras den juridiska mottagaren och marknadsrelationen entydigt. Därefter kan flera uttryckligen giltiga interna distributionsgrants vara avsiktliga och korrekta. Systemet ska inte välja en godtycklig tenant med limit1, men inte heller stoppa legitim fan-out bara för att två beneficiaries har rätt. Oklar juridisk attribution och avsiktligt flera interna mottagare är olika fall.

### 5.4 Vad som inte ska krävas i E66
E66 ska inte avvisas enbart för att ett internt permission-id eller beneficiary-id saknas på wire; dessa är inte automatiskt obligatoriska EDIFACT-fält. Bindningen kan behöva göras genom verklig juridisk mottagare, underordnad roll, objekt, produkt, period och den lokalt spårbara tillståndsrelationen. Kontroll av dataåtkomst ska vara strikt utan att hitta på nya fältkrav. [U §3.7–3.9]

### 5.5 Separat livscykel
Tillståndsslut betyder inte att elhandelsleveransen upphör. Ett historikjobb som avslutas med Z15VH avslutar inte ett separat löpande V-tillstånd. En återställd marknadsrätt genom Z15C återställer inte automatiskt ett av andra skäl återkallat internt grant. Rapporteringens slut och fortsatt rätt att bevara/använda redan lagrade historiska uppgifter ska bedömas separat i lagrings-/ändamålspolicyn.

### 5.6 Isolering hela vägen
Grants ska kontrolleras i API, RPC, RLS eller skyddad serveråtkomst, background jobs, cache, sökindex och exporter. En service-role-nyckel ger teknisk åtkomst men inte ett legitimt affärsmandat. Blandade råfiler ska inte exponeras för tenants som bara har rätt till vissa objekt. Administratorers fullständiga trace ska kräva särskild, loggad behörighet.

## 6. Registrets uppgifter och ruttbeslut
Den officiella XML:n använder `Market/Company`, `Key Type=...` och `EDIFACTDetails Type=...`. En importerande kärna ska ha adapter för XML och en separat adapter för den verkliga TXT-strukturen. Exportens TXT kan ha upprepade familjkolumner och inbäddade radbrytningar; filändelsebyte gör den inte kompatibel med en godtycklig CSV-parser.

Ny import ska göra: bytehash och källtid → säker parsning utan externa XML-entiteter → marknad/aktör/roller/identifierare/rutt → diff och konflikter → idempotent applicering → rutt-/certifikat-/readinessgranskning. Misslyckad certifikathämtning får inte rapporteras som verifierad rutt. `completed` ska endast beskriva den genomförda importfasen och dess faktiska mängd/resultat.

Den avlästa exporten har 651 EL-företag, 46 GAS-företag och 1 196 EDIFACT-ruttblock. Den är daterad 2026-09-10 och bevisar inte ensamt adresserna en vecka tidigare. För Gridex 21660 anges både PowerSupplier och ESCO, SMTP ediel@gridex.se och ingen subadress för P/U. För Mjölby 27700 anges 27700@tvlab.se, PRODAT-subadress PRODAT och ingen UTILTS-subadress. Det är ett filbevis, inte en genomförd produktionsimport. [REG]

Ruttval ska omfatta faktisk marknad, meddelandefamilj, juridisk aktör och teknisk identitet. Application Reference väljs av meddelandets process-/rollprofil, inte genom en generell importerad standardroll. En tom registrerad subadress ska bevaras som tom; lägg inte till GRIDEX, SCH eller PRODAT på alla aktörer. Returkvittenser ska routas i rätt ursprungsfamiljs och rolls sammanhang, inte reflexmässigt till godtycklig Reply-To. [T §5.2–5.5]

## 7. EDIFACT-struktur: separera grammatik från affärsinnehåll
### 7.1 Gemensamt kuvert
Ordningen är UNA om använd → UNB → tillåtet antal UNH…UNT enligt familj → UNZ. Ediel-specifika CONTRL-regler är inte identiska med nyare internationella CONTRL-exempel: använd `CONTRL:2:2:UN`, med resultat1 eller4. CONTRL skickas på andra EDIFACT, även APERAK, men aldrig på CONTRL. [T §2.1]

P/U och deras kvittenser använder UNOC:3 och verkliga ISO8859-1-byte. UNB:s tekniska partsidentitet får inte ersätta juridiska NAD-parter. 0031 begär CONTRL och ska inte glömmas när BGM har AB. Testflagga0035 är1 för test; den utelämnas för produktion. Räknare och referenser beräknas från färdigt innehåll, inte från mallens gamla siffror. [T §4,6]

Parsern måste bevara tomma element/komponenter, frisläppningstecken, ordning och samtliga upprepningar. Nationell användningR/D/O/X är inte samma sak som syntaxM/O. Frisläppningstecknet räknas inte som extra tecken i det logiska fältets längd. [T §2.1,6]

### 7.2 PRODAT
Schematisk struktur, **inte en färdig sändbar referensfil**:
```text
UNH  PRODAT:D:97A:UN:E2SE6A
BGM  Z-funktion i1001; meddelande-id i1004; begäran i4343
DTM 137 + DTM ZZZ; eventuell FTX-huvudtext
NAD FR/DO; eventuell avsändarreferens
  LIN per objekt/register: global sekvens, objekt-id där föreskrivet, registersekvens vid flera
  DTM för avtal/rapport/giltighet enligt rätt funktion och villkor
  FTX per objekt där tillåtet
  QTY för årsenergi där tillåtet
  CCI/CAV-egenskaper med exakta komponentpositioner
  RFF-referenser: mätare, nätområde, kundavtal, ärende, tillstånd enligt profilen
  NAD UD/IT/IV/BRP enligt parent- och fältvillkor
UNT; UNZ
```

**Avgörande positionsskillnad:** i PRODAT finns egenskapskoden i `CCI/C502/6313`; i UTILTS används en annan CCI-struktur med bland annat `C240/7037`. En “gemensam CCI-parser” får inte förväxla dessa katalogversioner. [P §2.6; U §3.9]

Alla74 numeriska PRODAT-fält har en egen locator i bilagaB. Exempel: fält327 är DTM164; fält325 är RFFZ09; fält506 ligger i andra7110 och ska inte flyttas till första7110 där fält242 hör hemma. Definitionerna av datatyp/längd och använda element i de kopplade källsegmenttabellerna ingår i bilageunderlaget.

### 7.3 Villkor och grupper
Varje fältkontroll ska följa: **meddelandeprofil → rätt undertyp → parentgrupp → registerläge → tillämpliga datum/kodlistor → fältets sann/falsk/okänd-gren → validering av värde**. Basmatrisen får inte köras direkt mot en platt stränglista.

I Z06 kan ett fält vara R iF men O iE/G; falsktD är därför inte generelltX. I Z14N är flera grupper inte tillämpliga och deras barn ska inte göras obligatoriska. Utgående icke-tillämpliga uppgifter ska inte byggas, medan inkommande extraP-information enligt ignorera-regeln inte får ge negativ APERAK eller användas för grunddataändring. [P §2.2; bilaga 4s.119]

### 7.4 Flera register
Bara basfält för första registret räcker inte. I relevanta Z04/Z06/Z10 ska alla register och korrekt sekvens anges.314 är globalLIN-sekvens;258 börjar om per objekts register. Bilaga2 avgör vad som måste upprepas och vad som ärvs/ignoreras på register 2+. En mätarställning för ett register och en energikvantitet för hela serien får inte dubbelräknas som samma observation.

### 7.5 UTILTS
```text
UNH UTILTS:D:02B:UN:E5SE5A
BGM E66/S02/E31/... eller ERR, separat från PRODAT-koder
DTM137; DTM735 med frisläppt +0100; MKS marknad/skede
NAD MS/MR och underordnad roll
  IDE transaktion
  LOC objekt och områden; NAD relevanta parter enligt tidsserieprodukt
  LIN generisk energiprodukt; DTM period/registrering/upplösning
  STS anledning/fel; MEA där tillämpligt; RFF ursprungsreferenser
  CCI/CAV tidsserieegenskaper
    SEQ observation
    RFF mätare/register när villkoren gäller
    QTY/MOA/PRI med datum och kvalitetsinformation enligt profil
UNT; UNZ
```
En UTILTS-överföring har ett UNH–UNT-meddelande och en juridisk mottagare. Flera transaktioner är tillåtna inom kompatibel profil. En transaktion får inte innehålla flera olika anläggningar. Blanda inte skeden, olika anledningar eller oförenliga upplösnings-/ApplicationReference-klasser. Energiobservationer ska hållas ihop och ordnas i tid, liksom mätarställningarna; det är inte ett universellt krav att ställningsblocket ligger först. [U §3.6.18–20]

### 7.6 APERAK-familjerna
**På PRODAT:** `UNH+…+APERAK:D:96A:UN:E2SE6A`; `BGM+++34` eller27 i **1225**.1001 och1004 iBGM används inte. Referens till originaletsBGM kommer iRFF+ACW. ERC100/40/41/42 med rättFTX, ochRFF+Z07/LI där uppgifterna finns. Detaljfel påP kräver inte att positiva/negativa objekt delas på exakt samma sätt somUTILTS. [P s.98–105]

**På UTILTS:** `APERAK:D:04A:UN:E5SE5A`; `BGM+312+eget_id+9` positivt eller313 negativt. DOC avser originalets typ/id. ERC100/41/42 ochFTX enligt föreskriven text. Varje kvittenstransaktion har egetDM-id ochACW till originaletsIDE-id. Vid huvudfel utelämnas den påhittade transaktionsreferensen. Positiva och negativa utfall blandas inte i sammaAPERAK. [U s.112–120]

**UTILTS-ERR:** är UTILTS på wire medBGM ERR, inte en ny UNH-familj kalladUTILTS_ERR. Den har egna originalreferenser och funktionsfelkoder. ERR ska hanteras med sin föreskrivna kvittensprofil, inte skapa en nyERR-loop. [U §3.4,4–5]

## 8. PRODAT: samtliga kartlagda meddelandefall
Varje rad kompletteras av den fullständiga fältmatrisen, villkorscellerna, parentgrupperna och registeroverlay. “Bilateral” betyder att konkret processprofil/överenskommelse måste finnas; det är inte ett generellt aktiverat standardflöde. [P §2.1,2.2,2.6; HB kap.4,10,11]
| Fall/roll/riktning | Ut­lösare och kod | Förväntat och tillåten effekt | Särskild grind |
| --- | --- | --- | --- |
| Z01L · SUPPLIER · outbound<br>CASE-Z01L-SUPPLIER | Behörig kontroll av kundens nätavtalsuppgifter inför möjlig start; inte obligatoriskt om korrekta uppgifter redan finns. Fält223=Z22. | CONTRL; Z02 eller negativ APERAK. AB kan begäras men positiv APERAK är ingen startspärr. Skapa uppgiftsärende och bevakning; ingen leveransaktivering. | Kund/fullmakt, anläggning, nätområde och avtalad tilltänkt start enligt fältprofil. Tillämplig |
| Z02L · SUPPLIER · inbound<br>CASE-Z02L-SUPPLIER | Svar på egen korrelerad Z01. Fält223=Z22. | Generera CONTRL och tillämplig APERAK; inget automatiskt kvittenskrav före behandling. Validera rätt kund/objekt/nätområde/LI; lagra verifierade uppgifter; pröva därefter om separat Z03-kommando är redo. | Inte Z03 eller Z04; får inte aktivera leverans. Tillämplig |
| Z03L · SUPPLIER · outbound<br>CASE-Z03L-SUPPLIER | Nytt giltigt leveransavtal; L=leverantörsbyte, LK=kund- och leverantörsbyte/flytt. Fält223=Z22. | CONTRL, APERAK, rätt Z04L/LK; dessa är olika förväntningar. Skapa bytes-/flyttärende och tillåtna timers, inte aktiv leverans. | Startfönster L D-14 dagar; LK senast inflyttningsdagen; max14 kalendermånader före. Tillämplig |
| Z04L · SUPPLIER · inbound<br>CASE-Z04L-SUPPLIER | Nätägarens affärsbekräftelse på egen Z03. Fält223=Z22. | CONTRL och tillämplig APERAK i retur. Skapa bekräftad framtida leveransperiod; aktivera först vid korrekt start och oförändrat giltigt ärende. | Z04 får komma före positiv APERAK. Samma LI ensamt räcker inte för korrelation. Tillämplig |
| Z05L · SUPPLIER · inbound<br>CASE-Z05L-SUPPLIER | Nätägarens information till tidigare leverantör. Fält223=Z22. | CONTRL och tillämplig APERAK; normalt ingen egen affärsbekräftelse tillbaka. Avsluta berörd leveransperiod vid angivet giltigt slut, planera slutvärden/slutunderlag; behåll historik. | Z05L kan referera till Z08H; Z05LK kan vara följd av utflytt efter Z09E men är inte Z09E-svar. Tillämplig |
| Z01LK · SUPPLIER · outbound<br>CASE-Z01LK-SUPPLIER | Behörig kontroll av kundens nätavtalsuppgifter inför möjlig start; inte obligatoriskt om korrekta uppgifter redan finns. Fält223=Z23. | CONTRL; Z02 eller negativ APERAK. AB kan begäras men positiv APERAK är ingen startspärr. Skapa uppgiftsärende och bevakning; ingen leveransaktivering. | Kund/fullmakt, anläggning, nätområde och avtalad tilltänkt start enligt fältprofil. Tillämplig |
| Z02LK · SUPPLIER · inbound<br>CASE-Z02LK-SUPPLIER | Svar på egen korrelerad Z01. Fält223=Z23. | Generera CONTRL och tillämplig APERAK; inget automatiskt kvittenskrav före behandling. Validera rätt kund/objekt/nätområde/LI; lagra verifierade uppgifter; pröva därefter om separat Z03-kommando är redo. | Inte Z03 eller Z04; får inte aktivera leverans. Tillämplig |
| Z03LK · SUPPLIER · outbound<br>CASE-Z03LK-SUPPLIER | Nytt giltigt leveransavtal; L=leverantörsbyte, LK=kund- och leverantörsbyte/flytt. Fält223=Z23. | CONTRL, APERAK, rätt Z04L/LK; dessa är olika förväntningar. Skapa bytes-/flyttärende och tillåtna timers, inte aktiv leverans. | Startfönster L D-14 dagar; LK senast inflyttningsdagen; max14 kalendermånader före. Tillämplig |
| Z04LK · SUPPLIER · inbound<br>CASE-Z04LK-SUPPLIER | Nätägarens affärsbekräftelse på egen Z03. Fält223=Z23. | CONTRL och tillämplig APERAK i retur. Skapa bekräftad framtida leveransperiod; aktivera först vid korrekt start och oförändrat giltigt ärende. | Z04 får komma före positiv APERAK. Samma LI ensamt räcker inte för korrelation. Tillämplig |
| Z05LK · SUPPLIER · inbound<br>CASE-Z05LK-SUPPLIER | Nätägarens information till tidigare leverantör. Fält223=Z23. | CONTRL och tillämplig APERAK; normalt ingen egen affärsbekräftelse tillbaka. Avsluta berörd leveransperiod vid angivet giltigt slut, planera slutvärden/slutunderlag; behåll historik. | Z05L kan referera till Z08H; Z05LK kan vara följd av utflytt efter Z09E men är inte Z09E-svar. Tillämplig |
| Z03C · SUPPLIER · outbound<br>CASE-Z03C-SUPPLIER | Återtag av eget bytes-/flyttärende inom kancelleringsfönstret. Fält223=Z24. | CONTRL, APERAK och enligt förloppet Z04C. Markera kancellering begärd; inte färdig enbart på SMTP250. | Referera rätt originalärende/objekt/kund; L senast4dagar före, LK senast inflyttningsdagen. Tillämplig |
| Z04C · SUPPLIER · inbound<br>CASE-Z04C-SUPPLIER | Bekräftelse/korrigering som upphäver berört startförlopp. Fält223=Z24. | CONTRL och tillämplig APERAK. Upphäv endast rätt bekräftade/framtida period; vid redan verkställd effekt starta kontrollerad kompensation. | Bevara original- och kancelleringsordning; kancellering före original lagras för begränsad korrelation, ingen godtycklig aktivering. Tillämplig |
| Z05C · SUPPLIER · inbound<br>CASE-Z05C-SUPPLIER | Tidigare meddelat leveransslut återtas. Fält223=Z24. | CONTRL och tillämplig APERAK. Återställ rätt avslutsbeslut efter kontroll; skapa inte duplicerad leveransperiod. | Skilj återtag av leveransslut från ESCO Z15C. Tillämplig |
| Z04A · SUPPLIER · inbound<br>CASE-Z04A-SUPPLIER | Nätägarens anvisning när aktören är behörig anvisad leverantör. Fält223=Z26. | CONTRL och tillämplig APERAK. Registrera anvisningsprocess och korrekt start. | Dokumenterad anvisningsöverenskommelse i rätt nätområde; kräver inte egen Z03. Bilateral/rollvillkor |
| Z04D · SUPPLIER · inbound<br>CASE-Z04D-SUPPLIER | Mottagningsplikt för produktion enligt tillämpligt produktionsförlopp. Fält223=Z70. | CONTRL och tillämplig APERAK. Skapa separat produktions-/mottagningsrelation, knyt till förbrukningsobjekt via319. | Inte bara mikroproduktion; inte generell Z03-guard eller konsumentaktivering. Tillämplig |
| Z03H · SUPPLIER · outbound<br>CASE-Z03H-SUPPLIER | Särskilt avtalad användning av ospecificerad/hävningsanknuten transaktion. Fält223=Z25. | Kvittens och affärsförlopp enligt uttrycklig bilateral process. Ingen automatisk standardeffekt utan fastställd bilateral transitionsprofil. | Känd kod ≠ generell produktionsbehörighet; konkret avtal och exakta fält/timers krävs. Bilateral – aktiveras inte utan profil |
| Z04H · SUPPLIER · inbound<br>CASE-Z04H-SUPPLIER | Särskilt avtalad användning av ospecificerad/hävningsanknuten transaktion. Fält223=Z25. | Kvittens och affärsförlopp enligt uttrycklig bilateral process. Ingen automatisk standardeffekt utan fastställd bilateral transitionsprofil. | Känd kod ≠ generell produktionsbehörighet; konkret avtal och exakta fält/timers krävs. Bilateral – aktiveras inte utan profil |
| Z05H · SUPPLIER · inbound<br>CASE-Z05H-SUPPLIER | Särskilt avtalad användning av ospecificerad/hävningsanknuten transaktion. Fält223=Z25. | Kvittens och affärsförlopp enligt uttrycklig bilateral process. Ingen automatisk standardeffekt utan fastställd bilateral transitionsprofil. | Känd kod ≠ generell produktionsbehörighet; konkret avtal och exakta fält/timers krävs. Bilateral – aktiveras inte utan profil |
| Z08H · SUPPLIER · outbound<br>CASE-Z08H-SUPPLIER | Behörigt avslut/hävning av elhandelsavtal. Fält223=Z25. | CONTRL, APERAK och relevant Z05L enligt förlopp. Bevakad avslutsbegäran och kontrollerat leveransslut. | Juridiska förutsättningar för hävning måste vara dokumenterade; ingen automatisk hävning enbart vid betalningsflagga. Tillämplig |
| Z08LK · SUPPLIER · outbound<br>CASE-Z08LK-SUPPLIER | Bilateral användning för kund-/leverantörsbyte. Fält223=Z23. | Svar enligt uttryckligt avtal. Bara den överenskomna avsluts-/flyttprocessen. | Inte universell ersättning för Z03LK. Bilateral – aktiveras inte utan profil |
| Z06E · SUPPLIER · inbound<br>CASE-Z06E-SUPPLIER | Nätägarens kund-/anläggningsuppdatering. Fält223=E34. | CONTRL och APERAK enligt guide; ytterligare UTILTS för F enligt ändring och Handbok. Uppdatera tillåtna kunduppgifter i rätt livshändelse; dödsfalls- och konkursärenden separata. | Z06E utanför fastställd standardlivshändelse kräver bilateral grund. Z06F/G får inte skriva kundidentitet från förbjuden NAD+UD. Tillämplig |
| Z09E · SUPPLIER · outbound<br>CASE-Z09E-SUPPLIER | Anmäl rätt kundlivshändelse/överenskommen uppgiftsändring. Fält223=E34. | CONTRL, APERAK och enligt processen senare Z06; inget påhittat direkt affärssvar. Registrera önskad förändring; mottagen bekräftad struktur har egen versionshantering. | Z09E har NAD+UD; Z09F/G använder respektive217 Z04/Z03 och giltighetsdatum157; inte automatiskt kundbyte. Tillämplig |
| Z06F · SUPPLIER · inbound<br>CASE-Z06F-SUPPLIER | Nätägarens kund-/anläggningsuppdatering. Fält223=E64. | CONTRL och APERAK enligt guide; ytterligare UTILTS för F enligt ändring och Handbok. Versionera struktur och avläsningsutlösande ändring; kontrollera berörda mätvärdesförväntningar. | Z06E utanför fastställd standardlivshändelse kräver bilateral grund. Z06F/G får inte skriva kundidentitet från förbjuden NAD+UD. Tillämplig |
| Z09F · SUPPLIER · outbound<br>CASE-Z09F-SUPPLIER | Begär kvartsmätning enligt kundavtal. Fält223=E64. | CONTRL, APERAK och enligt processen senare Z06; inget påhittat direkt affärssvar. Registrera önskad förändring; mottagen bekräftad struktur har egen versionshantering. | Z09E har NAD+UD; Z09F/G använder respektive217 Z04/Z03 och giltighetsdatum157; inte automatiskt kundbyte. Tillämplig |
| Z06G · SUPPLIER · inbound<br>CASE-Z06G-SUPPLIER | Nätägarens kund-/anläggningsuppdatering. Fält223=E32. | CONTRL och APERAK enligt guide; ytterligare UTILTS för F enligt ändring och Handbok. Versionera ändrad struktur utan att påhittad avläsning krävs. | Z06E utanför fastställd standardlivshändelse kräver bilateral grund. Z06F/G får inte skriva kundidentitet från förbjuden NAD+UD. Tillämplig |
| Z09G · SUPPLIER · outbound<br>CASE-Z09G-SUPPLIER | Informera att nätägaren ska avgöra mätmetoden enligt ändrat avtal. Fält223=E32. | CONTRL, APERAK och enligt processen senare Z06; inget påhittat direkt affärssvar. Registrera önskad förändring; mottagen bekräftad struktur har egen versionshantering. | Z09E har NAD+UD; Z09F/G använder respektive217 Z04/Z03 och giltighetsdatum157; inte automatiskt kundbyte. Tillämplig |
| Z09B · SUPPLIER · outbound<br>CASE-Z09B-SUPPLIER | Byte av balansansvarig för berörda leveransrelationer. Fält223=Z27. | CONTRL och APERAK; uppdatering enligt BRP-förloppet. Versionera BRP-ansvar vid datumet, inte tenantglobal överlagring av historiken. | Senast en kalendermånad före; rätt aktör/område/avtal; AI-lista ersätter inte Z09B. Tillämplig |
| Z09D · SUPPLIER · outbound<br>CASE-Z09D-SUPPLIER | Produktionsavtal tecknas eller upphör. Fält223=Z70. | CONTRL och APERAK; eventuella efterföljande mottagningspliktsförlopp separat. Starta/avsluta rätt produktionsavtal. | 210 XOR 211, aldrig DTM157 som ersättning; inte NAD+UD på Z09D. Tillämplig |
| Z10M · SUPPLIER · inbound<br>CASE-Z10M-SUPPLIER | Nätägarens mätarbyte. Fält223=E58. | CONTRL och APERAK; avläsningar/energier via relevanta UTILTS-transaktioner. Versionera ny/gammal mätare/register och gränstid, bevara tidigare mätvärden. | Gamla/nya mätarnummer olika; flerregisteroverlay; tio vardagar som sändningsfrist för nätägaren. Tillämplig |
| Z13V · ESCO · outbound<br>CASE-Z13V-ESCO | Avtal med slutkund och DSO finns; begär fortlöpande rapportering. Fält223=S17. | CONTRL, APERAK för begäran; därefter Z14 eller Z14N. Skapa begäran och objektrelaterade rättigheter först efter positivt Z14; inte elleverans. | Kundidentitet ej födelsedatum; Z13 behöver inte anläggnings-id men LIN+1 finns; scope/roll/avtal/beneficiary separat. Tillämplig |
| Z14V · ESCO · inbound<br>CASE-Z14V-ESCO | DSO godkänner tillgång för angivna godkända anläggningar. Fält223=S17. | CONTRL och APERAK; E66 enligt bekräftade villkor och vid historik slut viaZ15VH. Skapa/versionera market_permission och objektscope; projektionsåtkomst bara till uttryckligen berättigade tenants. | A74; tillstånds-id; rättLI; ej bredda kund-/tids-/produktomfattning från antaganden. Förvänta inte Z04. Tillämplig |
| Z15V · ESCO · inbound<br>CASE-Z15V-ESCO | Fortlöpande tillstånd upphör. Fält223=S17. | CONTRL och APERAK; inget nytt automatiskt Z13. Avsluta rätt rapporterings-/tillståndsförlopp; VH slutför historikjobbet, inte separat V-tillstånd. | Datum164, idZ09, status/orsak; får inte avsluta annan tenant eller DDQ-leverans. Tillämplig |
| Z13VH · ESCO · outbound<br>CASE-Z13VH-ESCO | Avtal med slutkund och DSO finns; begär avgränsad historik. Fält223=S18. | CONTRL, APERAK för begäran; därefter Z14 eller Z14N. Skapa begäran och objektrelaterade rättigheter först efter positivt Z14; inte elleverans. | Kundidentitet ej födelsedatum; Z13 behöver inte anläggnings-id men LIN+1 finns; scope/roll/avtal/beneficiary separat. Tillämplig |
| Z14VH · ESCO · inbound<br>CASE-Z14VH-ESCO | DSO godkänner tillgång för angivna godkända anläggningar. Fält223=S18. | CONTRL och APERAK; E66 enligt bekräftade villkor och vid historik slut viaZ15VH. Skapa/versionera market_permission och objektscope; projektionsåtkomst bara till uttryckligen berättigade tenants. | A74; tillstånds-id; rättLI; ej bredda kund-/tids-/produktomfattning från antaganden. Förvänta inte Z04. Tillämplig |
| Z15VH · ESCO · inbound<br>CASE-Z15VH-ESCO | Historikleveransen har avslutats. Fält223=S18. | CONTRL och APERAK; inget nytt automatiskt Z13. Avsluta rätt rapporterings-/tillståndsförlopp; VH slutför historikjobbet, inte separat V-tillstånd. | Datum164, idZ09, status/orsak; får inte avsluta annan tenant eller DDQ-leverans. Tillämplig |
| Z14N · ESCO · inbound<br>CASE-Z14N-ESCO | Aktivt eller passivt nekat tillstånd. Fält223=Z96. | CONTRL och APERAK på själva Z14N om korrekt; ingen datarapportering. Neka berörd begäran; lägg ingen market_permission för åtkomst. | A13 aktivt nekat; A76 passivt nekat; många positiva-Z14-fält ska utelämnas. Förväxla inte negativt affärssvar med syntaktiskt fel. Tillämplig |
| Z15C · ESCO · inbound<br>CASE-Z15C-ESCO | Återtag av felaktigt tillståndsupphörande, t.ex. rättad utflytt. Fält223=Z24. | CONTRL och APERAK. Återställ berört market_permission efter rätt korrelation. Återuppliva inte ett separat återkallat tenantåtkomstgrant. | Status och datum enligt fältspecifikation; kräver inte generell egen Z18. Tillämplig |
| Z18V · ESCO · outbound<br>CASE-Z18V-ESCO | Behörig begäran att avsluta rapportering. Fält223=S17. | CONTRL, APERAK, tillämplig Z15. Begär avslut av rätt marknadstillstånd; kontrollera andra giltiga serviceuppdrag innan gemensamt tillstånd sägs upp. | 327/324/325 krävs; beneficiarys UI-avslut av ett deluppdrag ≠ avslut för samtliga tenants. Tillämplig |

### 8.1 Tillståndssyfte och rättslig grund
Fält323 använder B71 samtycke, B72 avtal, B73 rättslig förpliktelse, B74 grundläggande intresse, B75 myndighets-/allmänt intresse ellerB76 intresseavvägning enligt kodtabellen. Att koden finns betyder inte att en privat kommersiell tjänst fritt kan välja vilken rättslig grund som helst. Koden ska komma från dokumenterad och rättsligt bedömd behandlingsgrund. Privatkundsvillkoret och Z14N-undantaget ska följas. [P s.74]

Fält324 anger B77 syftet uppnått, B78 sluttid uppnådd, B79 slutkundens återkallelse, B80 uppsagt tillstånd ellerE37 inget giltigt nätavtal. Statusfält322 använder tillåtna kombinationer med meddelandet: positivZ14A74, Z14N A13/A76 och Z15A74/A75 enligt vad som faktiskt signaleras. Ett mottaget negativt affärsbeslut ska inte avvisas därför att det är negativt. [P s.73–75]

## 9. UTILTS: roller, förväntningar och kapabiliteter
| Kod/roll/riktning | Betydelse och parter | Application Reference / förväntan | Aktiveringsvillkor |
| --- | --- | --- | --- |
| E66 / SUPPLIER / inbound | Validerade mätvärden per objekt. Nätägare/Metered Data Responsible → DDQ | 23-DDQ-E66-S eller -T enligt aktuell profil; CONTRL; transaktionsvis APERAK eller UTILTS-ERR. | Verifierad leveransrelation i DDQ-rollen; rätt objekt, produkt och period. Planerad kapabilitet |
| E73 / SUPPLIER / outbound | Begär saknade validerade värden/prognos enligt tillåten mottagarroll. DDQ → Nätägare/Metered Data Responsible | Referensen för den BEGÄRDA meddelandetypen, inte automatiskt E73; CONTRL/AP enligt profilen; begärda data eller föreskrivet felutfall. | Preciserad bilateral användning och datarätt. ESCO får inte anta rätt till S02 bara för att E73 stöder S02 som typ. Bilateral och begärd-typ-behörighet |
| ERR / SUPPLIER / outbound | Funktionsfel på mottagen transaktion. DDQ → Originalets juridiska avsändare | Samma kontext som originalet; CONTRL och APERAK enligt ERR-profil. | Endast efter korrekt guidevalidering; rätt originalreferenser. Planerad kapabilitet |
| ERR / SUPPLIER / inbound | Avvisning av egen UTILTS-transaktion, t.ex. request där tillämpligt. Motpart → DDQ | Originalets kontext; CONTRL och föreskriven APERAK; ingen ny ERR. | Måste korreleras till faktisk egen sändning; en oanvänd utgående profil får inte skapa fiktivt original. Planerad kapabilitet |
| E66 / ESCO / inbound | Validerade mätvärden per objekt. Nätägare/Metered Data Responsible → DGI | 23-DGI-E66-S eller -T enligt aktuell profil; CONTRL; transaktionsvis APERAK eller UTILTS-ERR. | Verifierat marknadstillstånd i DGI-rollen; rätt objekt, produkt och period. E23 är normal anledning om inte annat överenskommits. Planerad kapabilitet |
| E73 / ESCO / outbound | Begär saknade E66-värden i behörig ESCO-relation; annan efterfrågad typ kräver uttryckligt roll- och källstöd. DGI → Nätägare/Metered Data Responsible | Referensen för den BEGÄRDA meddelandetypen, inte automatiskt E73; CONTRL/AP enligt profilen; begärda data eller föreskrivet felutfall. | Preciserad bilateral användning och datarätt. ESCO får inte anta rätt till S02 bara för att E73 stöder S02 som typ. Bilateral och begärd-typ-behörighet |
| ERR / ESCO / outbound | Funktionsfel på mottagen transaktion. DGI → Originalets juridiska avsändare | Samma kontext som originalet; CONTRL och APERAK enligt ERR-profil. | Endast efter korrekt guidevalidering; rätt originalreferenser. Planerad kapabilitet |
| ERR / ESCO / inbound | Avvisning av egen UTILTS-transaktion, t.ex. request där tillämpligt. Motpart → DGI | Originalets kontext; CONTRL och föreskriven APERAK; ingen ny ERR. | Måste korreleras till faktisk egen sändning; en oanvänd utgående profil får inte skapa fiktivt original. Planerad kapabilitet |
| S02 / SUPPLIER / inbound | Förbrukningsprognos per objekt. Nätägare → DDQ | 23-DDQ-S02-S; CONTRL/AP eller korrekt ERR per kontrollnivå. | Prognos ≠ uppmätt energi; får inte obemärkt bli fakturaunderlag. Planerad kapabilitet |
| S03 / SUPPLIER / inbound | Preliminära andelstal/planvärden. Nätägare/aggregator → DDQ | 23-DDQ-S03-S; CONTRL/AP/ERR enligt profilen. | Aggregatscope; inte individuell customer_id-länk. Aggregat – exempelpaket G02 återstår |
| E31 / SUPPLIER / inbound | Aggregerade mätvärden och relevanta slutliga andelstal. Nätägare/aggregator → DDQ | 23-DDQ-E31-S eller -T; CONTRL/AP/ERR per transaktion. | Område, parter och tidsserieprodukt krävs enligt produktens komponenter. Aggregat – exempelpaket G02 återstår |
| S05 / SUPPLIER / inbound | Aggregerade avräkningsvärden. Balansansvarig → DDQ | 23-DDQ-S05-S eller tillämplig processtyp; CONTRL/AP/ERR enligt profil. | Konkret BRP-gränssnitt, relevanta produkter och mottagaromfattning måste vara fastställda. Avtal-/produktberoende G02/G04 |
| E74 / SUPPLIER / outbound | Begär saknade S03/E31. DDQ → Nätägare/aggregator | Referensen för begärd S03/E31; CONTRL/AP och begärda data/fel. | Bilateral kapabilitet; rätt aggregation, parter och period. Bilateral |
| S07 / SUPPLIER / outbound | Tidsserie per objekt som rapporteras av leverantören. DDQ → Behörig mottagarroll enligt profilen | 23-DDQ/DEC/DDK-S07-S eller -T enligt faktisk mottagarroll; CONTRL/AP/ERR | Inte standardväg för intern tenantdistribution; kräver uttrycklig användningsprofil och avtal. Valbar bilateral funktion |
| S07 / SUPPLIER / inbound | Mottagning av avtalad objekttidsserie från en annan leverantör. Leverantör i tillämplig roll → DDQ enligt den överenskomna profilen | 23-DDQ/DEC/DDK-S07-S eller -T enligt faktisk mottagarroll; CONTRL/AP/ERR | Valfri bilateral kapabilitet, inte standardaktiverad. Full produkt-/rollprofil och avtal ska verifieras före aktivering. Valbar bilateral funktion |
| S01 / SUPPLIER/ESCO / disabled | Avräkningsansvarig till nätägare/BRP/särskild annan godkänd roll; inte normal DDQ/DGI-funktion. Ej vår standardroll → Ej vår standardroll | Ingen genererad produktionsreferens; Ingen påhittad normal affärseffekt. | Kunna känna igen och diagnostisera där lämpligt; ny roll och komplett källa krävs för eventuell framtida aktivering. Ej produktionsaktiverad |
| S04 / SUPPLIER/ESCO / disabled | Avräkningsansvarig till BRP; inte normal DDQ/DGI-funktion. Ej vår standardroll → Ej vår standardroll | Ingen genererad produktionsreferens; Ingen påhittad normal affärseffekt. | Kunna känna igen och diagnostisera där lämpligt; ny roll och komplett källa krävs för eventuell framtida aktivering. Ej produktionsaktiverad |
| E30 / SUPPLIER/ESCO / disabled | Mätvärdesinsamlares rapport till nätägare; inte legal ESCO:s vanliga marknadsuppgift. Ej vår standardroll → Ej vår standardroll | Ingen genererad produktionsreferens; Ingen påhittad normal affärseffekt. | Kunna känna igen och diagnostisera där lämpligt; ny roll och komplett källa krävs för eventuell framtida aktivering. Ej produktionsaktiverad |
| E72 / SUPPLIER/ESCO / disabled | Begäran av E30 till insamlare; annan marknadsroll. Ej vår standardroll → Ej vår standardroll | Ingen genererad produktionsreferens; Ingen påhittad normal affärseffekt. | Kunna känna igen och diagnostisera där lämpligt; ny roll och komplett källa krävs för eventuell framtida aktivering. Ej produktionsaktiverad |
| S06 / SUPPLIER/ESCO / disabled | Inte taget i bruk. Ej vår standardroll → Ej vår standardroll | Ingen genererad produktionsreferens; Ingen påhittad normal affärseffekt. | Kunna känna igen och diagnostisera där lämpligt; ny roll och komplett källa krävs för eventuell framtida aktivering. Ej produktionsaktiverad |
| S08 / SUPPLIER/ESCO / disabled | Upphörde att användas efter 14 april 2026. Ej vår standardroll → Ej vår standardroll | Ingen genererad produktionsreferens; Ingen påhittad normal affärseffekt. | Kunna känna igen och diagnostisera där lämpligt; ny roll och komplett källa krävs för eventuell framtida aktivering. Ej produktionsaktiverad |
| E70 / SUPPLIER/ESCO / disabled | Framtida förslag i dokumentet; inte produktionsmeddelande i denna omfattning. Ej vår standardroll → Ej vår standardroll | Ingen genererad produktionsreferens; Ingen påhittad normal affärseffekt. | Kunna känna igen och diagnostisera där lämpligt; ny roll och komplett källa krävs för eventuell framtida aktivering. Ej produktionsaktiverad |

### 9.1 Fulla nationella kontroller ska ligga i profilen
Bilaga C innehåller kapitel 3.7:s applikationsrader med tillämpning per meddelande, source-locator och villkor samt bilaga 1:s kontroller av koder. De ska inte förenklas till en lista “tillåtna segment”. Varje återkommande fält måste kontrolleras på sin rätta nivå och med den aktuella parentgruppens villkor.

S02 är prognos, E66 är validerade objektdata, E31 är aggregat och S05 är avräkningsinformation från BRP. En datamodell som placerar alla dessa under kundens energy_values utan scope och kvantitetstyp är inte tillräcklig. ESCO:s vanligaE66-anledning ärE23 om inte annat är särskilt överenskommet. E73 använder profilen ochApplicationReference för begärda data, inte generiskE73-referens. [U §3.1–3.3,3.7; OE2g]

### 9.2 Funktionskontroller efter anvisningskontroll
De specificerade kontrollerna omfattar avsändarroll, objekt/nätområde, tidsserieinstans, period/registreringstid, relevant byteshändelse, enhet, erhållen mätar-/registerstruktur, decimaler och antal observationer. Felkod ska hämtas från rätt kontroll, inte första tillgängliga generiska felsträng.

E10 gäller rätt objektsidentifikation; E49 nätområde; E50 fel period; E61/E62 mätare/register när kontrollen är tillämplig; E51 decimaler; E87 antal observationer. E73 är här en **felkod för enhet**, vilket inte ska blandas ihop med meddelandetypen E73. Samma teckensträng kan tillhöra olika kodrymder. [U bilaga 2]

### 9.3 Undvik felaktigt sträng ESCO-validering
Kontroller mot strukturinformation ska använda faktiskt erhållen och relevant information. Ett godkänt Z14 innebär inte att alla detaljer som en leverantör får i Z04 redan finns hos en ESCO. Saknad lokal data, fel tenantval och genuint okänd anläggning hos rätt mottagare måste särskiljas. Källans tillämplighetsvillkor avgör kontrollen; det är inte ett generellt undantag från att validera E66.

### 9.4 Historik och perioder
Registreringstid/uppdateringstid bestämmer källversionen, inte ankomstordningen. Äldre korrekta transaktioner som anländer sent får inte avvisas bara därför, men ska inte skriva över en nyare aktiv version. Föreskriven positiv kvittens och aktiv dataprojektion är skilda beslut. [U §3.6.14,5.2]

Perioden är typad: fast svensk normaltid för mätdata, separat kalenderenhet för månad/år och datumgränser enligt den aktuella processen. Ett fullständigt24-timmarsdygn har96kvartar i denna tidsmodell. Kvantiteter är exakta decimaler; NULL/saknat är inte noll. Mätarställning är inte energi och maxeffekt är inte kWh. [U §3.6]

### 9.5 Särskilda historik-/bytesfall
Mätarbyte behöver rätt mätare/register och tidsgräns på vardera sidan. Saknad eller interpolerad mätarställning, omräkning från timme till kvart där sådan hantering fortfarande är tillåten, flera register, produktion/förbrukning och aktiv/reaktiv energi är skilda scenarier. Utgå från relevanta OE-exempel, därefter gällande guideversion: ett historiskt exempel är inte automatiskt dagens outputprofil.

### 9.6 Omsändning och äldre upplösningar
En rättelse kan använda ett annat omfång än en normal periodrapport när guiden uttryckligen tillåter det. Bygg inte en global regel att varjeUTILTS-transaktion alltid är96punkter eller alltid en hel månad. Samtidigt får inte specialfallet göra en normalt full kvartserie med88värden godkänd. Full regelkontext måste avgöra perioden, observationstypen och förväntat antal.

## 10. Kontrollordning och exakta felutfall
| Kontroll | När/nivå | Villkor och godkänt utfall | Felutfall och svar |
| --- | --- | --- | --- |
| CV-SYNTAX · interchange/message | T §2.1 s.12–18 | Full UNSM-syntax plus Ediels CONTRL-avvikelser: envelope, ordning, tillåtna element, typer/längder, räknare och referenser. Planera positiv CONTRL; nationell kontroll återstår. | Negativ CONTRL på rätt nivå med korrekt UCI/UCM/UCS/UCD-position. CONTRL:2:2:UN; 0083=1 eller4; aldrig kvittens på CONTRL. |
| CV-P-HEADER · PRODAT-header | P §3.2–3.3 och bilaga4 | Nationella huvudfält och obruten LIN-sekvens enligt P; skilj faktisk syntax från nationellt R-fält. Validera varje objekt/register. | Hela meddelandet avvisas med rätt P-APERAK; BGM27 enligt felet. APERAK D96A/E2SE6A; t.ex. ERC41/42 med riktigt fältnr, alternativt40/särskild kod. |
| CV-P-OBJECT · PRODAT-object | P §3 s.85–105 | Kombinera basfält, subtype, D-villkor, parentgrupp, registeroverlay och affärsvillkor. Godkänn/lagra objektets tillåtna effekt. | Avvisa endast rätt objekt när huvudet är korrekt; bevara syskon. P-APERAK: ERC100/FTX OK eller40/41/42; RFF Z07/LI när de finns. |
| CV-U-HEADER · UTILTS-header | U §5.2 s.107; bilaga1 | Nationell anvisningskontroll innan enskilda transaktioners funktionskontroll. Validera transaktionernas anvisningskrav. | Avvisa hela meddelandet; kör inte senare funktionskontroller. U-APERAK BGM313; DOC originalBGM om känt; ingen påhittad ACW till IDE. |
| CV-U-GUIDE · UTILTS-transaction | U §5.2,5.5; bilaga1 | Obligatoriska fält, tillåtna koder, föräldragrupper och begärda meddelandetypens profil. Kör funktionskontroll för denna transaktion. | Ingen funktionskontroll för denna transaktion; syskon fortsätter. U-APERAK 313; ERC41/42; FTX verkligt fältnr; DM+nyttID/ACW+ursprungligt IDE-ID. Bilaga1 medger i särskilda om-möjligt-fall en källstyrd segment-/elementreferens, högst17tecken. |
| CV-U-STORE · UTILTS-transaction | U §5.2 s.107; SYS transaktionsdesign | Funktionskontroller passerade och beständig lagring/transaktionsbeslut klar. Spara ny version eller registrera tidigare giltig version som äldre; publicera bara rätt projektion. | DB-/internfel hålls som intern incident; fabricera inte godkänd lagring eller godtycklig extern felkod. U-APERAK312/100 efter lyckad affärsbehandling. |
| CV-U-FN-207 · UTILTS-transaction efter godkänd anvisningskontroll | U bilaga2 s.130 | Avsändarens behörighet i aktuell roll mot mottagarens giltiga struktur. Fortsätt återstående tillämpliga kontroller. | Markera transaktionen processability_rejected. UTILTS BGM ERR med avvisningsorsak E55 nätägare / E16 leverantör / E18 balansansvarig; ingen senare positiv APERAK för samma transaktion. |
| CV-U-FN-209 · UTILTS-transaction efter godkänd anvisningskontroll | U bilaga2 s.130 | Anläggning/reglerobjekt identifieras i den relevanta aktörens och behörighetens struktur; inte genom att leta i samtliga tenants. Fortsätt återstående tillämpliga kontroller. | Markera transaktionen processability_rejected. UTILTS BGM ERR med avvisningsorsak E10; ingen senare positiv APERAK för samma transaktion. |
| CV-U-FN-260 · UTILTS-transaction efter godkänd anvisningskontroll | U bilaga2 s.130 | Rätt nätområde och områdestyp i kombination med identifierat objekt. Fortsätt återstående tillämpliga kontroller. | Markera transaktionen processability_rejected. UTILTS BGM ERR med avvisningsorsak E49; ingen senare positiv APERAK för samma transaktion. |
| CV-U-FN-511 · UTILTS-transaction efter godkänd anvisningskontroll | U bilaga2 s.130 | Tidsserieproduktens egenskaper plus relevanta områden/parter definierar en giltig tidsserieinstans. Fortsätt återstående tillämpliga kontroller. | Markera transaktionen processability_rejected. UTILTS BGM ERR med avvisningsorsak E29; ingen senare positiv APERAK för samma transaktion. |
| CV-U-FN-245 · UTILTS-transaction efter godkänd anvisningskontroll | U bilaga2 s.130–131 | Leveransperiod/upplösning/registreringstid och tillämpliga periodregler stämmer. Fortsätt återstående tillämpliga kontroller. | Markera transaktionen processability_rejected. UTILTS BGM ERR med avvisningsorsak E50; ingen senare positiv APERAK för samma transaktion. |
| CV-U-FN-210 · UTILTS-transaction efter godkänd anvisningskontroll | U bilaga2 s.131 | Vid leverantörsbytesanknutet fall: korrekt byteshändelse finns; inte ett globalt krav på ESCO E66. Fortsätt återstående tillämpliga kontroller. | Markera transaktionen processability_rejected. UTILTS BGM ERR med avvisningsorsak E47; ingen senare positiv APERAK för samma transaktion. |
| CV-U-FN-264 · UTILTS-transaction efter godkänd anvisningskontroll | U bilaga2 s.131 | Enhet stämmer med aktuell produkt och struktur. Fortsätt återstående tillämpliga kontroller. | Markera transaktionen processability_rejected. UTILTS BGM ERR med avvisningsorsak E73; ingen senare positiv APERAK för samma transaktion. |
| CV-U-FN-224 · UTILTS-transaction efter godkänd anvisningskontroll | U bilaga2 s.131 | Mätarnummer kontrolleras mot ERHÅLLEN strukturinformation för perioden, när kontrollen är tillämplig. Fortsätt återstående tillämpliga kontroller. | Markera transaktionen processability_rejected. UTILTS BGM ERR med avvisningsorsak E61; ingen senare positiv APERAK för samma transaktion. |
| CV-U-FN-527 · UTILTS-transaction efter godkänd anvisningskontroll | U bilaga2 s.131 | Register-id och antal förväntade register stämmer med ERHÅLLEN strukturinformation. Fortsätt återstående tillämpliga kontroller. | Markera transaktionen processability_rejected. UTILTS BGM ERR med avvisningsorsak E62; ingen senare positiv APERAK för samma transaktion. |
| CV-U-FN-DEC · UTILTS-transaction efter godkänd anvisningskontroll | U bilaga2 s.131–132 | Tillåtna decimaler per kvantitetstyp/upplösning stämmer. Fortsätt återstående tillämpliga kontroller. | Markera transaktionen processability_rejected. UTILTS BGM ERR med avvisningsorsak E51; ingen senare positiv APERAK för samma transaktion. |
| CV-U-FN-COUNT · UTILTS-transaction efter godkänd anvisningskontroll | U bilaga2 s.132 | Antal observationer stämmer med den specificerade perioden/upplösningen och observationstypen. Fortsätt återstående tillämpliga kontroller. | Markera transaktionen processability_rejected. UTILTS BGM ERR med avvisningsorsak E87; ingen senare positiv APERAK för samma transaktion. |
| CV-U-FN-ZERO · UTILTS-transaction efter godkänd anvisningskontroll | U bilaga2 s.132 | Nollvärdeskontroll endast i meddelanden/produkter där den gäller; från oktober inte generell individuell E66-kontroll. Fortsätt återstående tillämpliga kontroller. | Markera transaktionen processability_rejected. UTILTS BGM ERR med avvisningsorsak E97; ingen senare positiv APERAK för samma transaktion. |
| CV-U-FN-SIGN · UTILTS-transaction efter godkänd anvisningskontroll | U bilaga2 s.132 | Teckenkontroll i E30 och aggregat enligt aktuell produkt; från oktober inte generell individuell E66-kontroll. Fortsätt återstående tillämpliga kontroller. | Markera transaktionen processability_rejected. UTILTS BGM ERR med avvisningsorsak E98; ingen senare positiv APERAK för samma transaktion. |
| CV-U-FN-LIMIT · UTILTS-transaction efter godkänd anvisningskontroll | U bilaga2 s.132 | Tillåtna värdegränser i E30/aggregat enligt källan och struktur; inte egen pris-/kundmodell. Fortsätt återstående tillämpliga kontroller. | Markera transaktionen processability_rejected. UTILTS BGM ERR med avvisningsorsak E90; ingen senare positiv APERAK för samma transaktion. |

### 10.1 Gruppresultat är inte en ersättning för delresultat
Det behövs ett header-resultat, ett resultat per PRODAT-objekt/register respektive UTILTS-IDE och ett tydligt sammanfattningsresultat. Sammanfattningen får inte skriva över delarnas felklass.

Exempel: IDE1 godkänns och lagras, IDE2 saknar ett obligatoriskt fält och får negativ APERAK, IDE3 passerar guiden men har funktionsfel och fårERR. Den korrekta lösningen är inte “hela filen functional_rejected”. Ett guidefel påIDE2 får inte tvingas vidare till funktion bara för attIDE3 innehåller funktionsfel. [U s.107]

### 10.2 Rätt referens och rätt text
I PRODAT anger ERC40 särskilda applikationskoder som100/102–110 enligt användning;41/42 pekar på verkligt PRODAT-fältnummer. I UTILTS används den egna ERC/FTX-strukturen. NärU-bilaga 1 säger “om möjligt” kan en källstyrd segment-/elementreferens användas som alternativ till numeriskt fältnr, högst17tecken; ett fritt gissat nummer är inte tillåtet. [P §3.3; U bilaga 1s.121]

### 10.3 Intern omprövning får inte ändra ett redan sänt ACK-utfall
Ett nytt lokalt test kan upptäcka ett tidigare fel, men då krävs ett incident-/rättelseförlopp. Skicka inte en motsattAPERAK på samma redan kvitterade objekt/transaktion för att få databasen att se grön ut. Positiv APERAK på UTILTS kräver att den kvitterade informationen har behandlats och lagrats i den mening guiden anger. Beständig disposition och ACK-intent ska därför skapas i samma DBtransaktion. [P §3.2; U §5.2]

## 11. Tidsfrister, tidsankare och systemets förväntningar
| Timer | Händelse / ankare | Frist och kalender | Förväntat / vid utgång | Källa/typ |
| --- | --- | --- | --- | --- |
| TM-ACK | Mottagen kvittenspliktig EDIFACT; mottagaren_tillhanda | 30 minuter / elapsed | Skicka föreskriven CONTRL/APERAK inom fristen. Larma intern fördröjning; ingen ny affärsavsikt för att tid gått. | T §2 s.11–12; Normativ processregel |
| TM-CONTRL-TARGET | Fil framme vid EDI-konverterare; edi_converter_received_at | normalt 3 minuter / elapsed | Omgående CONTRL efter faktisk syntaxkontroll. Operativ incident om utebliven kontroll/sändning. | T §2.1 s.12; Normativ normalnivå |
| TM-REMOTE-WATCH | Eget meddelande SMTP-accepterat; actual_submission_at | 30 minuter, med synlig kommunikationsosäkerhet / elapsed | Bevaka saknade tekniska/applikationssvar separat. Kontakta/spåra; ingen blind PRODAT-omsändning. | T §2; HB kap.10; Intern bevakning av normativ tidsfrist |
| TM-Z02 | Mottagen Z01; z01_recipient_received_at | +30 minuter / elapsed | Z02 eller relevant felhantering. Utred uteblivet svar; börja inte först efter CONTRL. | HB26A s.197–199; Normativ processregel |
| TM-Z03L-LAST | Planerat leverantörsbyte; supply_start | -14 dagar / calendar_days | Z03L skickad senast. Blockera egen för sen anmälan/omplanera med behörig kundprocess. | HB26A s.197–199; Normativ processregel |
| TM-Z03-EARLIEST | Planerad start L/LK; supply_start | -14 kalendermånader / calendar_months | Skicka inte tidigare. Håll avsikten planerad tills fönstret öppnas. | HB26A s.197–199; Normativ processregel |
| TM-Z03LK-LAST | Inflyttning; move_in_day | senast samma kalenderdag / calendar_days | Z03LK skickad. Utred inflyttningsrutin; gör inte bakdaterad sändning på chans. | HB26A s.197–199; Normativ processregel |
| TM-Z03C-L | Återtag L; supply_start | -4 dagar / calendar_days | Kancellering skickad senast. Manuell behörig process; inte tyst retroaktiv radering. | HB26A s.197–199; Normativ processregel |
| TM-Z03C-LK | Återtag LK; move_in_day | senast inflyttningsdagen / calendar_days | Kancellering inom fönstret. Utred alternativ rättelse enligt förloppet. | HB26A s.197–199; Normativ processregel |
| TM-Z04-L | Z03L/LK mottagen; z03_received_at | +3 dagar; LK snarast efter godkänd bevakning / calendar_days | Rätt Z04. Utred; sent svar kan fortfarande behöva korrekt behandling. | HB26A s.197–199; Normativ processregel |
| TM-Z04-A | Inflyttning med anvisning; move_in_day | från dagen efter till senast tredje dagen efter / calendar_days | Z04A från behörig DSO. Bevaka egen väntan när anvisningsrelation finns. | HB26A s.197–199; Normativ processregel |
| TM-Z04-D | Mottagningsplikt träder in; obligation_effective_day | tidigast -3, senast +3 dagar / calendar_days | Z04D. Utred produktionsrelation, inte vanlig Z03-timeout. | HB26A s.197–199; Normativ processregel |
| TM-Z04-C | Z03C mottagen/rättad flytt; z03c_received_at | +3 dagar eller snarast enligt rättad flytt / calendar_days | Z04C enligt orsaken. Kancellering förblir inte automatiskt färdig. | HB26A s.197–199; Normativ processregel |
| TM-Z05-L | Z03L eller Z08H mottagen; relevant_request_received_at | +3 dagar; anvisning samtidigt med Z04A / calendar_days | Z05L till frånträdande leverantör. Bevaka avslut och slutvärden utan osäker aktivering. | HB26A s.197–199; Normativ processregel |
| TM-Z05-LK | Uppgift om utflytt/kundbyte; information_known_at | snarast / event_driven | Z05LK Skapa ansvarig operativ uppgift; mappa inte snarast till en påhittad Ediel-minutgräns. | HB26A s.197–199; Normativ processregel |
| TM-Z05-C | Kancellering av avslut; information_known_at | snarast / event_driven | Z05C; bör före tidigare aviserat slut Skapa ansvarig operativ uppgift; mappa inte snarast till en påhittad Ediel-minutgräns. | HB26A s.197–199; Normativ processregel |
| TM-Z06-E | Ändring av kunduppgifter; information_known_at | snarast / event_driven | Z06E Skapa ansvarig operativ uppgift; mappa inte snarast till en påhittad Ediel-minutgräns. | HB26A s.197–199; Normativ processregel |
| TM-Z09-E | Leverantören känner till kundlivshändelse; information_known_at | snarast / event_driven | Z09E Skapa ansvarig operativ uppgift; mappa inte snarast till en påhittad Ediel-minutgräns. | HB26A s.197–199; Normativ processregel |
| TM-Z15 | Tillstånds-/rapporteringstjänst upphör; reporting_or_service_end_known_at | snarast / event_driven | Z15 V/VH/C enligt händelsen Skapa ansvarig operativ uppgift; mappa inte snarast till en påhittad Ediel-minutgräns. | HB26A s.197–199; Normativ processregel |
| TM-Z18 | Avtal om energitjänst upphör; service_contract_end_known_at | snarast / event_driven | Z18V när berört marknadstillstånd ska avslutas Skapa ansvarig operativ uppgift; mappa inte snarast till en påhittad Ediel-minutgräns. | HB26A s.197–199; Normativ processregel |
| TM-Z06-FG | Strukturändring; change_effective_at | inom10dagar / calendar_days | Z06F/G; särskilda underrättelser kan ha kortare frist. Bevaka rätt historik/efterföljande mätvärden. | HB26A s.197–199; Normativ processregel |
| TM-Z06-SWITCH | Från-/tillkoppling; registration_day | samma dag / calendar_days | Z06F enligt händelsen. Operativ incident, ingen retroaktiv ändring av sändningstid. | HB26A s.197–199; Normativ processregel |
| TM-METHOD40 | Avtalad ändring mätmetod Z09F/G; z09_validity_day | inom40kalenderdagar / calendar_days | Z06 med tillämplig ändring. Bevaka genomförandet. | HB26A s.197–199; Normativ processregel |
| TM-Z08-H | Hävning; termination_day | senast samma dag / calendar_days | Z08H med giltig grund. Utred med ansvarig; finansflagga får inte ensamt styra. | HB26A s.197–199; Normativ processregel |
| TM-Z09-B | Byte BRP; brp_change_day | senast -1 kalendermånad / calendar_months | Z09B. Blockera för sen rutinändring utan behörig rättelseprocess. | HB26A s.197–199; Normativ processregel |
| TM-Z09-D | Produktionsavtal start/slut; production_contract_day | senast samma dag / calendar_days | Z09D med210 eller211. Bevaka produktionsrelation. | HB26A s.197–199; Normativ processregel |
| TM-Z09-FG | Kvartsavtal ändras; contract_start_or_end | i anslutning till/senast enligt avtalshändelsen / event_driven | Z09F/G. Bevaka källans händelsevillkor; inte generell30min-affärstimer. | HB26A s.197–199; Normativ processregel |
| TM-Z10 | Mätarbyte; meter_change_day | inom10vardagar / swedish_business_days | Z10M. Bevaka mätarbytes-/mätvärdeskedjan. | HB26A s.197–199; Normativ processregel |
| TM-ESCO21 | Tillståndsbegäran hos nätägaren; request_received_at | inom21kalenderdagar / calendar_days | Z14 V/VH eller Z14N enligt faktisk godkännande/nekandeprocess. Saknat svar blir uppföljning, inte lokalt fabricerat Z14N/nytt tillstånd. | HB kap.11 s.204–211; Normativ processregel |
| TM-ESCO-HISTORY | Begäran av historik; request_day | start tidigast3år tillbaka; senast igår; slut inom tillåten historik / calendar_years_days | Z13VH avgränsad period, kortas av relevant nätavtal. Blockera fel begärd period; historik är inte ett pågående V-tillstånd. | HB kap.11 s.205–209; Normativ processregel |
| TM-ESCO-VSTART | Begäran av löpande mätvärden; request_day | rapportstart ej senare än idag; som mest3år tillbaka enligt tillämplig process / calendar_years_days | Z13V; slut utelämnas vid tills vidare. Läs detta som begärd rapportperiod, inte allmän sändningsfrist. | HB kap.11 s.205–209; Normativ processregel |

### 11.1 Normativ mottagningstid och intern bevakning
“Mottagaren tillhanda” avser när kommunikationen fört meddelandet till mottagarens system, inte när vår worker slutligen råkar börja validera det. Avsändarens egen bevakning kan utgå från den verkliga sändningen men måste märkas som bevakning om motpartens mottagningstid inte är känd. CONTRL och APERAK är inte två seriekopplade trettio-minutersfrister. [T §2s.11–12]

### 11.2 Kalenderimplementering
Använd en versionsstyrd kalenderfunktion med uttryckliga typer: elapsed_minutes, calendar_days, calendar_months, calendar_years och swedish_business_days. Handbokens “snarast” är en händelsestyrd norm, inte ett tillstånd att hitta på exempelvis exakt fem minuter som extern regel. Interna larmmål får sättas men ska märkas interna.

Fjorton kalendermånader är inte420dagar. Tio vardagar är inte två veckor utan kalenderkontroll. Treårsgränser och månadsslut ska testas över skottår. Offset och kalenderdatum ska användas enligt den meddelande-/processspecifika regeln, inte genom en global Europe/Stockholm-konvertering av alla payloadvärden.

### 11.3 Förväntansobjekt
Varje väntan ska ha expected_event, source_rule, anchor_type/time/evidence, due_at, status, ansvarig funktion, tillåten åtgärd och senaste besluts-id. Kvittens kan vara saknad samtidigt som ett affärssvar finns. En timeout ändrar i sig inte ett marknadsbeslut, skapar inte egetZ14N och är inte ett automatiskt nyttZ03-kommando.

## 12. Tillståndsövergångar som ska implementeras
Tillståndsnamnen nedan är föreslagna interna namn. De får mappas till befintliga tabeller/statusar, men den angivna betydelsen och separationen mellan lagren ska bevaras.
| ID / lager | Från + händelse | Guard → nytt tillstånd | Atomiska effekter / nästa steg | Vid fel |
| --- | --- | --- | --- | --- |
| ST-T01 / transport | planned + prepare_command | Auktoriserad tenant/aktör/roll + komplett publicerad profil + aktuell rutt. → prepared | Lås payload, beslut, källa och ruttversion; skapa outbox-intent. Sändning i korrekt tidsfönster. | Intern blockerare med tydliga saknade fakta. |
| ST-T02 / transport | prepared + worker_claim | Giltig lease/fencing; aktuella behörigheter och säkerhet. → submitting | Skapa nytt attempt-id och stabil korrelation till samma avsikt. SMTP-resultat. | Ingen extern sändning. |
| ST-T03 / transport | submitting + smtp_250 | Svar avser aktuellt försök. → smtp_accepted | Registrera accepterad mottagare, queue-id, tid, Message-ID, payloadhash. CONTRL och tillämpliga andra svar som separata förväntningar. | Spara motstridiga transportbevis för utredning. |
| ST-T04 / transport | submitting + connection_lost_after_DATA | Kan inte bevisa att servern avvisat eller accepterat. → submission_unknown | Lås mot automatiskt duplicerad affärssändning; skapa spårningsärende. Verifierat leverans-/förlustutfall. | Ingen gissning. |
| ST-T05 / transport | submitting + known_not_submitted | Verifierat fel före möjlig acceptans eller explicit avvisning. → transport_failed | Spara felklass; planera policytillåtet försök utan ny affärshändelse. Ny preflight om försök medges. | Vid osäkerhet använd submission_unknown. |
| ST-T06 / transport | smtp_accepted + verified_DSN_failure | Rätt attempt/originalidentitet och mottagare. → delivery_failed | Koppla strukturerat DSN och ansvarig åtgärd. Spårning/rättelse/omsändningsbeslut enligt meddelandet. | Omatchat DSN till skyddad utredning. |
| ST-T07 / ack | awaiting_contrl + CONTRL_positive | UCI/UCM binder rätt tekniskt original och omfattning. → syntax_acknowledged | Registrera kvittens utan affärsaktivering. Applikations- och affärssvar om sådana återstår. | Korrelation-/säkerhetsutredning. |
| ST-T08 / ack | awaiting_contrl + CONTRL_negative | Rätt original; negativt syntaxutfall. → syntax_rejected | Larma, bind teknisk felposition och rättelseärende. Rättad hel överföring enligt guide. | Omatchad kvittens ändrar inget ärende. |
| ST-A01 / ack | awaiting_application_ack + APERAK_positive | Familjespecifika referenser och samtliga angivna delutfall giltiga. → application_acknowledged | Uppdatera endast kvitterat objekts/transaktions tillstånd. Affärssvar väntas fortfarande om tillämpligt. | Ingen acceptans genom fel familj/kund/tenant. |
| ST-A02 / ack | awaiting_application_ack + APERAK_negative | Rätt original/objekt/transaktion; korrekt kodtolkning. → application_rejected | Spara fel och blockera felaktig fortsättning för berörda delar. Rättelse med nytt BGM när processen medger. | Skapa inte motsatt kvittens på redan slutligt kvitterad del. |
| ST-Q01 / customer_info | draft + submit_Z01 | Behörig kund-/anläggningsförfrågan och källstyrd profil. → awaiting_Z02 | Koppla egen Z01 och oberoende bevakningar. Z02 eller negativ APERAK; inte Z04. | Blockerad avsikt, ingen extern sändning. |
| ST-Q02 / customer_info | awaiting_Z02 + valid_Z02 | LI, parter, kund, objekt, nätområde och meddelandeprofil stämmer. → information_verified | Lagra godkända uppgifter atomärt och avsluta rätt svarsförväntning. Separat readinessprövning av Z03 om det finns giltigt leveransavtal. | Guide-/affärsfel eller intern korrelationsutredning enligt orsak. |
| ST-Q03 / customer_info | awaiting_Z02 + response_timeout | Tillämplig bevakning förfaller utan svar. → response_overdue | Skapa ansvarig uppgift; bevara skickat original och statuslager. Kontakt/spårning; ingen automatisk Z03 eller ny Z01. | Timer får inte starta om efter sen CONTRL. |
| ST-S01 / supplier_switch | draft/ready + submit_Z03L/LK | Giltigt avtal, korrekt roll och datumfönster; eventuella uppgiftskontroller klara. → submitted_awaiting_business | Outbox, källbeslut och ärendereferens lagras tillsammans. Rätt Z04 + kvittenser; ingen aktiv leverans. | Blockera med verklig orsak. |
| ST-S02 / supplier_switch | submitted_awaiting_business + valid_Z04L/LK | Korrelerad bekräftelse, tillämpliga fält och datum. → confirmed_pending_start | Skapa/versionera framtida customer_supply_period och uppdatera affärsstatus. Starttimer; kvittens kan ännu återstå separat. | Ingen ändring från fel tenant/objekt/undertyp. |
| ST-S03 / supplier_switch | confirmed_pending_start + effective_start_reached | Bekräftelsen fortfarande giltig; ingen giltig kancellering/konflikt; datum och aktörsrätt rätt. → active | Aktivera endast rätt leveransperiod och efterföljande operativa uppgifter. Mätvärden och fakturaunderlag för rätt period. | Vänta/utred, tillverka inte ny Z04. |
| ST-S04 / supplier_switch | submitted_awaiting_business/confirmed_pending_start + submit_Z03C | Rätt återtagsgrund och deadline. → cancellation_requested | Skapa korrelerad kancelleringsavsikt; håll ursprungsjournalen oförändrad. Tillämpliga kvittenser och Z04C. | Ingen tyst radering. |
| ST-S05 / supplier_switch | cancellation_requested/confirmed_pending_start + valid_Z04C | Rätt kancellerat original och process. → cancelled | Upphäv rätt framtida effekt; vid redan aktiv period skapa explicit korrigeringsförlopp. Avslutad/korrigerad process. | Ordningskonflikt utreds med sparat meddelande. |
| ST-S06 / supplier_supply | active/confirmed_pending_start + valid_Z05L/LK | Mottagaren är rätt tidigare leverantör för objekt/tid. → ending_or_ended | Lagra aviserat slut på rätt relation; avsluta vid tid; skapa slutvärdesuppgift. Slutvärden/slutunderlag. | Ändra inte annan tenant/ESCO. |
| ST-S07 / supplier_supply | ending_or_ended + valid_Z05C | Rätt tidigare slut återtas och ingen annan giltig konflikt. → restored_or_correction_pending | Återställ berörd period med spårbar kompensation. Omprövad leverans- och fakturabild. | Manuell konflikt, inte duplicerad period. |
| ST-S08 / supplier_supply | no_correlated_Z03 + valid_Z04A | Verifierat anvisningsavtal och nätområde samt tillämpliga fält/datum. → assigned_pending_or_active | Skapa egen anvisningsrelation och korrekt giltighet. Mätvärden/fakturering enligt anvisningen. | Avvisa/utred rättsligt/affärsmässigt; inte generiskt missing_Z03. |
| ST-S09 / production_supply | no_correlated_Z03 + valid_Z04D | Mottagningsplikt och kopplad förbrukningsanläggning enligt319. → production_obligation_recorded | Skapa/versionera produktionens relation utan att skriva över förbrukningen. Relevanta produktionsvärden/avtal. | Fel relation går inte till vanlig konsumentstart. |
| ST-M01 / structure | known_version + valid_Z06F/G | Rätt avsändare, objekt, giltighet och tillämpliga fält. → new_effective_version | Versionera struktur; skapa eventuella avläsningsförväntningar. Rätt UTILTS enligt ändringshändelsen. | Korrekt kvittens-/felutfall utan historikförlust. |
| ST-M02 / meter | known_meter + valid_Z10M | Ny/gammal mätare olika; korrekt registergruppering och gränstid. → meter_change_recorded | Stäng gammal giltighet, skapa ny; bevara historiska observationer. UTILTS-transaktioner före/efter bytet. | Blockera motstridig mutation, inte godkänn på första LIN enbart. |
| ST-E01 / esco_request | draft + submit_Z13V/VH | Provider legal ESCO, kund/DSO-avtal, avgränsning och samordning klara. → submitted_awaiting_customer_decision | Lagra begäran, serviceuppdrag, rättigheter under prövning och sändningsavsikt. APERAK för begäran; därefter Z14 eller N. | Ingen dataåtkomst skapas. |
| ST-E02 / esco_request | submitted_awaiting_customer_decision + positive_APERAK_Z13 | Korrelerad applikationskvittens. → awaiting_customer_decision | Uppdatera endast begärans applikationsstatus. Z14 V/VH/N inom relevant förlopp. | Kvittensen är inte market_permission. |
| ST-E03 / esco_request | submitted_awaiting_customer_decision/awaiting_customer_decision + valid_Z14V/VH | A74 och korrekt kund, aktör, LI, objekt och period; källans krav uppfyllda. → approved_for_listed_objects | Skapa market_permission och permission_objects; samordna tillåtna serviceuppdrag utan överutdelning. E66 och separat intern grantpublicering. | Ett godkänt objekt ger inte alla objekt/kunder. |
| ST-E04 / esco_request | awaiting_customer_decision + valid_Z14N_A13 | Korrekt aktivt nekande. → denied_active | Avsluta rätt begärans väntan; lagra orsak. Kundkommunikation/ny behörig process enligt reglerna. | Gör inte negativt affärssvar till syntaxfel. |
| ST-E05 / esco_request | awaiting_customer_decision + valid_Z14N_A76 | Korrekt passivt nekande. → denied_passive | Lagra faktiskt mottaget nekande. Tillåten ny process efter relevanta förutsättningar. | Skapa inte detta meddelande lokalt enbart vid egen timeout. |
| ST-E06 / esco_request | awaiting_customer_decision + 21day_watch_expired_no_response | Ingen Z14/N har mottagits; verklig motpartstid känd eller bevakning märkt osäker. → overdue_follow_up | Skapa uppföljning utan eget positivt/negativt marknadsbeslut. Kontakt med DSO. | Inte artificiellt godkännande eller ny Z13-loop. |
| ST-E07 / market_permission | active + valid_Z15V | Känt tillstånd; giltig orsak/status/tid. → ending_or_ended | Versionera slut och återkalla berörd framtida distribution enligt rättighetsomfattning. Slut på rätt V-rapportering. | DDQ-leverans och andra tillstånd påverkas inte. |
| ST-E08 / historical_delivery | approved_or_receiving + valid_Z15VH | Rätt historikärende och tillstånd. → historical_delivery_closed | Markera historikslut; kontrollera faktisk periodtäckning separat. Eventuella saknade värden följs upp; inget nytt V-tillstånd. | Anta inte att alla värden är fullständiga bara för att slutmeddelande mottagits. |
| ST-E09 / market_permission | active + submit_Z18V | Behörigt avslut och samtliga berörda serviceberoenden granskade. → termination_requested | Skapa avslutsavsikt och tillämplig intern åtkomstbegränsning. Z15 och kvittenser. | En beneficiarys uppsägning avslutar inte automatiskt allas tillstånd. |
| ST-E10 / market_permission | ended + valid_Z15C | Rätt felaktigt upphörande återtas. → restored | Återställ marknadsrelationens giltighet med audit. Pröva downstream-grants på nytt. | Återkallat servicegrant förblir återkallat om ingen ny behörig grund finns. |
| ST-G01 / service_assignment | draft + approve_assignment | Provider, beneficiary, kund, ändamål, DSO och avtal är tydliga. → approved_waiting_permission | Lagra dokumentreferenser och begränsad scope. Koppla eller begär marknadstillstånd. | Ingen läsbehörighet från tenantrelation ensam. |
| ST-G02 / data_access_grant | proposed + publish_access | Aktivt kompatibelt uppdrag och market_permission plus tillåten dataanvändning. → active | Skapa explicit objekt/produkt/period/fält/purpose-grant till beneficiary. Filtrerade läsningar/exporter/projektioner. | Avvisa med behörighetsfel utan marknadsmeddelande. |
| ST-G03 / data_access_grant | active + beneficiary_assignment_ended | Rätt uppdrag upphör. → revoked_or_bounded | Stoppa tillgång enligt mandatet; invalidate cache/exportjobb. Bedöm om marknadstillstånd fortfarande behövs för andra uppdrag. | Skicka inte Z18 automatiskt före beroendekontroll. |
| ST-U01 / utilts_transaction | received + guide_failed | Syntax godkänd men guidekontroll på transaktionen fel. → guide_rejected | Spara diagnos och negativ AP-avsikt för rätt IDE. U-APERAK313/41 eller42; syskon fortsätter. | Ingen funktionskontroll på samma felaktiga transaktion. |
| ST-U02 / utilts_transaction | guide_accepted + functional_failed | Tillämpliga funktioner har kontrollerats med giltig struktur/behörighet. → processability_rejected | Spara ERR-avsikt och korrekt källkod/referenser. UTILTS-ERR. | Använd inte egen saknad tenantkonfig som godtyckligt E10. |
| ST-U03 / utilts_transaction | functional_accepted + commit_measurement | Tillåtna data och scoped relation finns. → stored_ack_pending | Atomärt lagra version, disposition och positiv AP-intent. U-APERAK312/100 och tillåtna interna projektioner. | DBfel ger ingen falsk positiv kvittens. |
| ST-U04 / utilts_transaction | functional_accepted + older_valid_revision | 512/532 visar äldre data; inga andra fel. → accepted_older_revision | Registrera accepterad äldre version/bevis utan att ersätta nyare. Positiv APERAK; ingen osynlig fakturaändring. | Ankomstordning ensam ska inte ge ERR. |
| ST-I01 / ai_reconciliation | imported + difference_detected | Rätt avsändare/mottagare/period och format. → requires_investigation | Spara avvikelse och råkällreferens. Behörig utredning; separat beslutad mutation. | Ingen automatisk uppdatering av grunddata. |

### 12.1 Samtidighet och kancellering
Reducer/verkställare ska kontrollera expected_state_version under transaktion eller motsvarande lås. En senare Z04 får inte återaktivera en rätt kancellerad start därför att samma objekt hittas. En tillståndsåterställning och en tenantåterkallelse kan korsa varandra; deras separata orsaker och versionsordning måste bevaras.

Vid kancellering som anländer före originalet ska originalreferensen, råmeddelandet och beroendet sparas. Väntan ska vara begränsad och operativt synlig. Det innebär inte att en godtycklig kancellering ska godkännas utan underlag; rätt tids-/kvittens-/felregel gäller fortfarande. [P s.14]

### 12.2 Skilda affärshändelser trots samma kund
Kunduppgifter, leveransstart, leveransslut, anvisning, produktionsmottagning, mätarbyte, samtycke/tillstånd och intern distribution är olika händelser. Det är fel att låta en enda customer.status styra dem alla. Kundkortet kan ha en sammanfattning, men auktoriteten måste vara de separata effektiva relationerna och processerna.

## 13. Transport och den kända Z01-incidenten
PRODAT via Ediel är inte “i stället förSMTP”: SMTP/MIME/S-MIME är den granskade transporten för dessa Edielmeddelanden. Edielportalen innehåller register, dokumentation och testsystem; den är inte en generell produktionsmottagare för kundbyten. Resend för fullmakts-/kundkommunikation ska fortsatt hållas separat. [T §3,5,bilagaA]

Det tidigare verifierade applikationsspåret avser en Z01 till27700, medSMTP250kö-id`y15c68283K1OFMF`, inte en verifierat genomförd Z03-bytesanmälan. Rå-MIME-förhandsloggen och transportbibliotekets resultat hade olikaMessage-ID. Nätägarens slutliga mottagning, faktisk S/MIME-avkryptering och relevant produktionsbindning är fortfarande en bevisgrind. Denna plan sänder inte om meddelandet.

Transportjournalen ska arkivera faktiskt meddelande, hash, rätt rutt- och certifikatversion, RFCMessage-ID, provider-/kö-id, mottagare, SMTPutfall och DSN. Ett pseudouri utan hämtningsbara byte räcker inte som revisionsbevis. En Skickat-kopia iStrato är en separat administrationsfunktion; tommappen visar inte att submission aldrig skett och får inte utlösa automatsändning.

S/MIME-kryptering ger skydd för innehållet men bevisar inte ensam den påstådda avsändarens juridiska behörighet. Register, tillåtna tekniska relationer, transportegenskaper och meddelandets faktiska parts-/rolluppgifter måste bedömas tillsammans. Avsändarsträngen ellerReply-To ska inte ensam vara åtkomst- eller returruttauktoritet.

TLS mellan reläer,SPF, certifikatens exakta giltighet, spärrkontroll, betrodd kedja och överlappande certifikat ska verifieras enligtT. Undantagsfallen iT ska vara uttryckliga med sina larm och begränsningar; en global “ignore_certificate_error” är inte rätt lösning. DB ochSMTP är inte en gemensam transaktion: okänt resultat efterDATA måste därför vara ett verkligt tillstånd med spårning, inte ett dolt automatiskt återförsök.

## 14. AI-/BI-listor och manuella vägar
AI/BI ska ha egen formatadapter, inte behandlas som EDIFACT. AI-formatet är semikolonseparerat med versionVer20140401 och filtypCSV från2025-10-01. Huvudet anger nätföretag först och elhandelsföretag därefter även när leverantören är avsändare. [AI §2–3]

AI:s huvudperiod är ett urval `[från,till)`. Detaljernas datum är giltighetsgränser och fylls bara enligt reglerna för gränser inom huvudperioden. All relevant historik ska med; ett byte av mätare eller avräkningsmetod kan ge flera rader. För leverantörsexport lämnas de sex nätägarfälten tomma. Fältordning och avslutande semikolon finns i källtabellerna. [AI s.6–10]

Listan skapar avvikelser för utredning, inte automatiska ändringar i kund-/nät-/BRPdata. BI sänds endast av nätföretag; detta ska vara spärrat i våraDDQ/DGIroller. En behörig operatörs manuella rättelse ska använda samma business command och auditspår som andra vägar, inte skriva ett nytt “giltigt” värde direkt i tabellen.

TekniskaCSVfält ska inte ändras godtyckligt för att passa Excel. En separat visnings-/arbetskopia får skyddas mot kalkylbladsformler och markera textceller. Den oförändrade tekniska källfilen ska samtidigt bevaras och valideras enligt sitt format.

## 15. Datamodell och invariants
Modellerna är interna koncept/kontrakt. **Inventera och återanvänd befintliga auktoritativa tabeller innan nya införs.** De föreslagna namnen är inte påståenden att nya tabeller redan skapats.
| Koncept | Minsta data | Betydelse | Constraint/implementation |
| --- | --- | --- | --- |
| tenant | id, status, isolation_policy_version | Organisatorisk datagräns. Inte automatiskt marknadsaktör. | Återanvänd companies/tenantmodell; förhindra implicit åtkomst från gemensam koncern. |
| legal_market_actor | id, market, country, ediel_id, identifiers, roles, validity | Juridisk marknadsidentitet med historik. | Återanvänd platform_market_actors/identifiers; ej unik enbart på orgnr. |
| actor_profile | id, owner_tenant_id, legal_actor_id, role, market, environment, capability_version | Aktör i viss verksamhetsroll och miljö. | DDQ/DGI separata profiler; transportadressen kan vara gemensam. |
| technical_route_snapshot | id, actor/profile ref, technical_party_id, qualifier, legal_party_id, subaddress, message_family, smtp_address, source_hash, validity | Teknisk adressering separerad från juridisk aktör. | Återanvänd ruttmodellen; bevara null subaddress och EL/GAS. S/MIME-scope separat. |
| service_assignment | id, operating_tenant_id, provider_actor_profile_id, beneficiary_tenant_id, end_user_ref, dso_actor_id, purpose, scope, contract_evidence_ids, validity, status | Gridex/annan provider utför specificerat ESCO-uppdrag för annan tenant. | Explicit kors-tenantrelation. Beneficiary får inte själv tilldela sig providerbehörighet. |
| market_permission | id, owner_tenant_id, esco_actor_profile_id, dso_actor_id, external_permission_id, customer_ref, mode, state, start_at, end_at, grant_created_at, source_z14_id | Marknadens tillstånd, skilt från internt uppdrag. | Verifiera befintliga tillståndstabeller före ny schemaentitet; externt id namnrymdssätts med aktör/DSO/miljö. |
| permission_object | permission_id, metering_identity_id, direction, energy_product, resolution, reporting_schedule, period, source_message/line | Vilka anläggningar och data som faktiskt omfattas. | Ingen automatisk utvidgning till alla objekt som en kund råkar äga. |
| assignment_permission_link | assignment_id, permission_id, authorized_scope, evidence_id, validity | Explicit många-till-många-koppling där samma giltiga tillstånd kan stödja flera tillåtna serviceuppdrag. | Samordna slut: ett uppdrag upphör inte automatiskt för alla andra. |
| data_access_grant | id, owner_tenant_id, beneficiary_tenant_id, assignment_id, permission_id, object/product/period/field/purpose_scope, version, revoked_at | Tillåten intern användning och distribution. | Alla queries/exporter/cache måste pröva scope och aktuell grantversion. |
| ediel_receipt | id, environment, transport_id, raw_object_ref, hash, received_at, technical_parties, attribution_state | Skyddad råmottagning före säker tenantattribution. | Befintlig ediel_messages/payloads/inbox kan utökas; oattribuerat material får inte bli global tenantläsning. |
| ediel_message_context | message_id, owner_tenant_id, legal_sender/recipient, role, market, rule_decision_id, original_refs | Affärsmeddelandets fastställda kontext. | Ändra inte ursprunglig roll när data projiceras till beneficiary. |
| ediel_transaction_disposition | message_id, original_transaction_id_or_line_key, outcome, rule_ids, findings, stored_revision_ids, response_intent_ids | Delresultat och affärseffekt. | Unik per faktiskt behandlad del/version. Godkänd lagring och ACK-intent i samma DBtransaktion. |
| outbound_attempt | intent_id, attempt_id, lease_token, payload_hash, rfc_message_id, provider_id, queue_id, smtp_code, accepted/rejected_recipients, timestamps, unknown_state | Vad transporten faktiskt gjorde. | Skilj från affärsstatus. Exact-once kan inte antas över SMTP. |
| effective_structure_version | tenant/actor scope, metering_identity, valid_from/to, observed_at, source_message/line, meter/register/product/BRP facts | Tidsberoende struktur. | Giltighetsdatum != mottagningstid; future/old-versioner ska fungera. |
| measurement_revision | owner scope, series_identity, observation_type, interval, exact_value, unit, quality, source_registration_time, source_message/IDE, status | Spårbar dataversion. | Energi/effekt/ställning skilda; old-late-positive får inte ersätta nyare. |
| readiness_evidence | scope tenant/actor/role/capability, release_sha, schema_fingerprint, rulepack_hash, route/cert/permission versions, tests, verified_at, expiry | På vilket bevis en kapabilitet aktiverats. | Flera capability-bevis; ingen global stale is_ready. |
| process_expectation | process_id, expected_event, timer_rule_id, anchor_type/time/evidence, due_at, status, owner, last_decision_id | Vad systemet väntar på och när det ska agera. | Teknisk ACK och affärssvar är skilda; inga oavsiktliga kedjade30minförlängningar. |

### 15.1 Bindningar som ska vara omöjliga att bryta
Tenantägda children ska referera rätt parenttenant/aktör, inte bara ett godtyckligtUUID. Cross-tenantlänkar ska vara uttryckliga service/grantrelationer med verifierad provider/beneficiary, aldrig en oavsiktlig korskoppling. Tillstånds- och mätpunktsidentiteter får egna giltiga namnrymder. Wire-id och interna id är olika typer.

Giltiga leveransperioder får inte motsäga varandra för samma aktörsrelation/objekt/tid. Konsumtion och produktion är separata riktningar; rättelser görs med historik och kompensation, inte genom att gamla journaler raderas. Databasen ska skydda grundläggande invariants, medan processmotorn beslutar vilken källstyrd affärsövergång som gäller.

### 15.2 Atomära gränser
Godkänd affärsdata, disposition, stateevent och tillhörande outboxintents lagras i en transaktion där de måste överensstämma. Ett nätverksanrop ska inte hållas inne i en lång databastransaktion. Sändningsförsök och externleverans registreras separat; återupptagning använder lease/fencing och explicit resultatklass.

### 15.3 Index och skalning
Prioritera index för mottagning/dedupe, juridisk aktör+originalreferenser, owner/tenant+status+tidsfrist, servicegrant+objekt+period och senaste giltiga struktur-/mätvärdesversion. Mät frågeplaner med representativa tenants, objektantal och tidsintervall. Behörighetsfilter får inte falla bort för att göra en fråga snabbare.

### 15.4 Fakturering
Fakturaunderlag ska binda till rätt leveransperiod, faktiskt accepterad dataversion, kvantitet/energiriktning, kvalitet och prisversion. Prognoser, aggregat, mätarställningar och energi får inte blandas. Sena korrigeringar ska skapa spårbar omprövning, inte tyst ändra redan fastställd faktura. Intern användning av DGI-data måste ha uttrycklig ändamåls- och datagrund; originalproveniens ska vara kvar.

### 15.5 Radering och historik
Kundavslut, tillståndsslut, tenantuppsägning och begäran om persondatagallring är olika handlingar. De ska koordineras med åtkomstrevoke, historik, fakturor och revisionsunderlag. Exakta juridiska lagringstider måste beslutas för varje klass; detta dokument hittar inte på en generell tidsgräns. Undvik både godtycklig CASCADE-radering och obegränsad lagring utan grund.

## 16. Migreringsstrategi utan ny dubbelauktoritet
Använd **expand → backfill → jämför → aktivera → contract**. Först identifieras befintlig tabell, RPC, trigger och konsument för varje semantisk uppgift. Därefter tillkommer nödvändiga versioner och referenser utan att befintliga data skrivs om på chans.

En shadow-evaluering får jämföra gamla och nya beslut mot samma oförändrade payload och faktasnapshot, men ska inte skicka nya kvittenser eller ändra kunddata. Avvikelser ska förklaras med regel-id och källa. Historiska payloads förblir oförändrade även när nya regler visar att de var felaktiga.

De gamla regelraderna och importvägarna avvecklas först när konsumentinventering och paritetsprov visar att ingen aktiv kod behöver dem som auktoritet. Att bara sätta en ny modul “central” utan att avveckla oberoende omval löser inte problemet.

Rollback behöver separat plan för kod/schema, publicerat regelpaket och redan utförda affärseffekter. En rollback får inte automatiskt återkalla externa meddelanden eller återutge gamla uppgifter som nya. Redan skickad information kräver branschens faktiska rättelse-/kancelleringsprocess.

## 17. Readiness och kontrollpanel
Readiness ska vara scopebunden: tenant → juridisk aktör → roll → marknad → miljö → meddelandekapabilitet. Beviset ska omfatta release-SHA, schemafingerprint, normpaket, rutt-/certifikatversion, relevanta uppdrags-/behörighetsförutsättningar och faktiska tester. En ny regel ska göra gamla påverkade bevis inaktuella. En DGI-ändring ska inte oavsiktligt slå ut opåverkad DDQ-trafik, men får inte heller godkännas genom ett gammalt globalt true-värde.

Gränssnittet ska visa **byggt**, **kölagt**, **SMTP-accepterat**, **transportfel/okänt**, **CONTRL**, **APERAK**, **affärssvar**, **effektiv leverans/rättighet**, **intern dataåtkomst** och **nästa åtgärd** som skilda saker. Användaren ska kunna följa en felkod till meddelande, objekt/transaktion, regel, källa och ansvarig åtgärd.

Interna råloggar med personuppgifter ska begränsas till behöriga operatörer. En beneficiary får sin egen status/projektion, inte all providers trafik. Operativa larm ska prioritera oavgjord juridisk attribution, kvittenser nära frist, okänt sändningsutfall och avvikelser som kan ge fel leveransstart eller otillåten datadelning.

## 18. Genomförandeordning och stoppgrindar
Faserna nedan är beroendeordnade men kan delas i små PR:er. Varje PR ska ange vilken semantisk del som förändras och vilka regressionsprov som bevisar ändringen. Inga här angivna steg har körts i produktion genom att dokumentet skapats.

| Fas | Resultat | Arbete | Godkännande | Tidigare fynd |
| --- | --- | --- | --- | --- |
| F0 | Fastställ miljö och incident | Release/DB/SMTP-bindning; arkivera/spåra den gamla Z01:an; ingen omsändning. | G05 stängs för faktisk incident/miljö. | E024–E028,E051 |
| F1 | Lås källor och regelprofiler | Källhashar/precedens; slutför saknade äldre U-profiler/aggregat/TGT; ifylld roll-/fält-/kodlista per aktiverad profil. | Källgrind per kapabilitet; inga obekräftade framtidsregler. | E001,E034,E038,E048,E053–E059 |
| F2 | Bygg kontext och tenant/ESCO-modell | Own actor/DDQ/DGI/tjänster över tenantgränser; grants; typade kontexter; inga nya wirefält. | SC001–024 samt behörighets-/raceprov. | E020–E023,E039,E052,E062 |
| F3 | Rätta parser, fält och ACK | PRODAT: 74 fält, 110 D-villkor, föräldra- och registerregler; UNB/0031; CCI/CAV; PAP/UAP/CONTRL/ERR; anvisning före funktion. | Oberoende golden/rejectionprov och gamla buggreproduktioner stängda. | E001–E013,E034–E037 |
| F4 | Rätta import/routing/transport | Gemensam import; EL/GAS; tom subadress; Message-ID/EML/DSN; cert/TLS/SPF/unknown-attempt. | Registrerings- och transportprov med verklig säkerhetsprofil. | E014–E032 |
| F5 | Tillståndsmaskiner och tidsfrister | Separat elhandel/ESCO; start/cancel/slut/återtag; timers; nästa åtgärd; samordnade serviceuppdrag. | 42 övergångar och datum-/ordnings-/multitenantprov. | E033,E052,E061 |
| F6 | Mätdata, AI/BI, fakturaunderlag | Guide/funktion per IDE; källversioner; struktur; avstämning; historik och rättelser. | Objekt/aggregat/prognos/kvalitet/grant/data­lifecycleprov. | E035–E046,E062 |
| F7 | Paritet och kontrollerad release | Ren migrationsreplay, schema/RLS/RPC/testparitet, beroendestyrd readiness, motpartsprov och TGT-omfattning. | Exakt releasebevis, inga röda obligatoriska gates. | E047–E051,E060 |

### 18.1 Vad som ska stoppas, och vad som ska fortsätta
En kapabilitet som saknar säker rutt eller godkänd rättighet får inte skapa nya affärssändningar. Inkommande trafik och föreskriven kvittenshantering ska däremot inte slentrianmässigt stängas av av en global “production_lock”. Systemet ska skilja mellan säkert mottagande, svar som kan ges utan kundläckage, lagring i karantän och förbjuden affärsmutation.

Ingen automatisk massomsändning ska ske när en buggrättning publiceras. Kör först konsekvensrapport över berörda original och fastställ rätt process för varje fall: transportförlust, syntaxrättelse, negativ APERAK, kancellering eller manuell utredning.

## 19. Verifiering och definition av färdig
Bilaga D innehåller konkreta testförutsättningar, handling, förväntat resultat och förbjuden effekt. Teststatus är “Inte körd mot systemet”. Dokumentintegritetskontrollen validerar endast att specifikationens register hänger ihop.

En regel är implementeringsklar när dess källa och villkor är entydiga, dess aktuella kodväg och datamodell är bestämda och oberoende prov har ett känt facit. Den är produktionsklar först när verklig implementation, schema, transport/rättigheter och formellt tillämpliga godkännanden är verifierade på rätt scope.

**Testklasser:** källjämförelse, renderer/parser med oberoende goldenfiler, negativa syntax-/guide-/funktionsfall, transaktionsvis lagring/ACK, tillståndsövergångar, tenant/grantisolering, samtidighet/crash/retry, datum-/versiongränser, importdiff, certifikat/SMTP/DSN, faktura-/historikpåverkan och tillämpliga Edielportal-/motpartsprov.

Roundtrip med samma felaktiga egna parser och renderer är inte tillräckligt. En testfil som fått positiv kvittens men motsäger aktuell källa ska få tydlig konfliktstatus och exakt testfallsanknytning. Kodens gamla “certified”-sträng eller grön katalogexport är inte ett certifieringsbevis.

Release kräver dessutom att ingen obligatorisk ren migrationsreplay eller tenant-E2E är röd, att testtoken/miljö inte kan ge produktionssändning och att publicerat readinessbevis avser just den driftsatta release- och regelversionen.

## 20. Underlag som fortfarande behövs
| Grind | Behov | Vad den påverkar | Hur den stängs |
| --- | --- | --- | --- |
| G01 · Källa | Fullständiga UTILTS 25-A-3, inte endast ändringsloggen i 25-A-4 | Behövs för att stänga detaljkontroller före 2026-10-01 och versionsövergångens föregående profil. Beroende äldre UTILTS-regelprofil | Kontrollera publicerat original/hash och jämför samtliga ändrade celler/kontroller. |
| G02 · Exempel/kodlista | Separat aggregerad UTILTS-exempelsamling bilaga5–6 och tillämplig komplett tidsserieproduktlista | Objektexemplen täcker inte hela aggregat-/BRP-omfattningen eller alla framtida produktkomponenter. E31/S03/S05/valbarS07 och specifika nya produkter | Fullständig produkt/part/område/roll/period samt exakta exempelutfall. |
| G03 · Formellt prov | TGT-testhandledning260827 version6-0-6 + PRODAT4-0-5 och UTILTS3-1-0-v2026 testdata + era faktiska godkännandeprotokoll | Publicerad lista har kontrollerats; bilagornas fulltext och godkänd omfattning finns inte i denna verifiering. Formell releasecertifiering per aktör/roll/testscope | Knyt testid, källrevision, aktör, miljö, payloadhash och resultat; kräver inte generellt omprov av allt utan källstöd. |
| G04 · Rättighet/affärsbeslut | Konkreta ESCO-uppdrags-/kund-/DSO-avtal, identifierad juridisk provider och beneficiary per upplägg, bilateral capabilities, dataanvändning och retention | Tenantstruktur och plattformsägande är inte marknadstillstånd eller juridiskt beslut om vidareutlämning. Aktivering av specifikt cross-tenantuppdrag och bilaterala funktioner | Koppla evidens till rätt actor-profile/objekt/purpose/tidsperiod; inte generella kryssrutor. |
| G05 · Driftbevis | Faktisk runtime↔DB-bindning, SMTP/providerinställning utan hemligheter, Stratos queue/Message-ID-spår, mottagarens logs, skyddad originalEML | Den historiska Z01:ans slutliga transportutfall och produktionsbindning är inte bevisade av planen. Ny kontrollerad verklig sändning | Visa komplett transport och korrelation; inga nya kundstatusar eller omsändningar på chans. |
| G06 · Implementationsbevis | Full UNSM-grammatik och exakt konsument-/schema-/RPCinventering på release-SHA | Nationella tabeller är detaljerade men ingen körbar full parser; existerande schema ska återanvändas korrekt. Påstående om full syntax/E2E/paritet och produktionsklarhet | Grammatikversion, schemafiler, callgraph och tester kan verifieras genom anslutet repo/CI; användaren behöver normalt inte ladda upp dem manuellt. |
| G07 · Källkonflikt | Register över explicit identifierade dokumentmotsägelser | PöversiktZ34 motE34; Pbilaga4äldreassociation; svenskUfooter25-A-5; exempelA02 motB71–B76. Endast tolkningar som verkligen påverkas | Använd uttrycklig precedens där den finns. Oavgjord normkonflikt ska få källstödd tolkning, inte härledas från att referensfilen fåttpositivACK. |

Det behövs inga privata nycklar eller lösenord i chatten. Certifikat-/SMTP-/miljöevidens ska lämnas som säkra metadata och loggar med nödvändig maskning. GitHub-/Supabase-/deployunderlag som går att verifiera genom befintliga anslutningar behöver normalt inte kopieras manuellt av användaren.

Det redan tillgängliga underlaget räcker för att bygga central kontraktsmodell, fylla den källbelagda PRODAT-kärnan, beskriva oktober-UTILTS, tillstånds- och grantarkitektur och genomföra många korrigeringar. De saknade delarna ska stängas på just den kapabilitet de påverkar, inte dölja eller stoppa allt annat.

## 21. Slutlig styrregel
**Rätt juridisk aktör och mandat → rätt process och roll → rätt version och fältprofil → rätt teknisk rutt och skydd → rätt kvittens och affärseffekt → endast tillåten intern datadistribution.**

Systemet ska fatta entydiga automatiska beslut när regler och fakta räcker. När egen fakta, avtal eller källtolkning saknas ska det kunna förklara exakt vad som saknas, vilken åtgärd som är tillåten och vem som ansvarar. Det får varken gissa för att bli grönt eller underkänna korrekt inkommande trafik med egna påhittade regler.

## Bilagor och maskinläsbara register
- **Bilaga A:** `annex/A_Regelkort.md` — samtliga regelkort med utfall och källstöd.
- **Bilaga B:** `annex/B_PRODAT_falt_och_villkor.md` — fältmatris, exakta locators, parent- och D-celler samt registeroverlay.
- **Bilaga C:** `annex/C_UTILTS_applikationsfalt_och_kodkontroller.md` — kontextberoende användningsrader och nationella kodkontroller.
- **Bilaga D:** `annex/D_Acceptanskontrakt.md` — planerade verifieringsfall, utan påstådd systemexekvering.
- **Bilaga E:** `annex/E_Tidigare_62_granskningspunkter.md` — tidigare fel-/bevisregister med reservationer.

`registers/*.json` är maskinläsbar specifikationsdata. De är inte ett direkt godkänt produktionsregelpaket. `contracts/ediel-execution.ts` är föreslagna interna typer. `verification/verify_spec.py` kontrollerar dokumentintegritet, inte Edielöverföring eller applikationens runtime.

## Referenskällor
P: Svenska kraftnät, PRODAT och tillhörande APERAK 26.A/16.B, revision 3, 2026-06-30, 140 sidor.  
T: Svenska kraftnät, Generella tekniska regler 24.A revision 6, 2026-02-20, 60 sidor.  
U: Svenska kraftnät, svensk UTILTS/APERAK, publicerad för 2026-10-01, omslagsrevision 4, 135 sidor; dokumentnamnskonflikt registrerad.  
UE: engelsk översättning 25-A-4, senast uppdaterad 2026-08-05.  
AI: AI-listan 14.A.3, 2025-04-01, giltig från 2025-10-01.  
OE: UTILTS/APERAK objektexempel E5SE5A, revision 1, 2025-04-30.  
AP: Generisk APERAK 05.B.5, 2026-08-07 — avgränsad till dess uttryckliga familjer.  
REG: companies.xml/companies.txt, export 2026-09-10; selektiv evidens i registret.  
HB: Svensk Elmarknadshandbok 26A, 2026-04-01, 241 sidor, läst via officiell webbadress.  
CODE: tidigare läst GitHubkod på bascommitten; ingen ny fullständig runtime-/produktionsrevision genom dokumentet.

Officiella webbadresser för återkontroll:
```text
https://www.elmarknadshandboken.se/Dokumentation/Texter/NEMHB.pdf
https://www.ediel.se/Info/edielanvisningar
https://www.ediel.se/Info/systemtest
https://github.com/heke99/gridex-ops-platform
```
