# Fullmaktsärenden via Resend och Strato

Det här flödet gäller manuell fullmaktskommunikation i OPS. Resend levererar utskicken; Strato tar emot svar. Inga nya publika API-fält krävs och inga historiska OpenAPI-utgåvor ändras.

## Godkännande och dokument

Tenantens backend skickar kundens signerarnamn, identitet, verkliga godkännandemetod, ursprunglig tidpunkt, dokumentreferens och exakta scopes. Vid formulärgodkännande behövs också kundens IP vid godkännandet: `powerOfAttorney.ipAddress` i website-API:t respektive `power_of_attorney.ip_address` i organization-sync. IP ska hämtas genom en betrodd server/proxykedja. OPS skiljer den från API-anroparens IP.

OPS skapar ett stabilt **verifikatsnummer**, sparar accepterad text och signeringsuppgifter och arkiverar genererad PDF med fullmaktsreferens och verifikatsnummer på varje sida. Uppladdade original skrivs inte om; tenant måste ladda upp ett original vars egna signerings- och sidverifikat uppfyller motpartens krav. BankID är ett valfritt framtida alternativ; ingen BankID-tjänst är inkopplad. En inskickad metodsträng eller metadata är inte ett verifierat BankID-bevis. IP och verifikatsnummer är dokumenterade uppgifter, ingen garanti för motpartens godkännande. Ett uttryckligt BankID-krav från en motpart behöver hanteras i det ärendet.

Det privata arkivet ligger i `customer-documents`, under `companies/{company}/customers/{customer}/powers-of-attorney/{poa}/fullmakt-{sha256}.pdf`. Objekt skrivs utan överskrivning. Äldre uppladdade original kopieras byteidentiskt till arkivet, vid nytt manuellt intag eller när äldre dokument hämtas. Tidigare dokumentvägar bevaras i arkivmetadata. Den nya sökvägen tillåts inte av den befintliga direkta tenant-storage-skrivpolicyn; åtkomst sker genom den autentiserade dokumentrutten. Detta är applikationsskydd och innehållsadressering, inte en extern WORM-tjänst eller en fastställd gallringspolicy.

**Fullmakter** i OPS visar tenantens egna fullmakter. Superadmin kan söka över tenants. Sökning finns för tenant, kundnamn/företagsnamn/kundnummer och verifikatsnummer. Dokumentlänkar kontrollerar tenant, kund och fullmakt före serviceåtkomst och skickar `Cache-Control: private, no-store`.

En ändrad signatör, juridisk text eller scope kräver ett nytt godkännande. En säker komplettering av saknade revisionsuppgifter får bara bindas till samma undertecknare, metod och ursprungliga godkännandetidpunkt. API-retry använder samma nyckel och samma payload; ändrad payload förblir en konflikt. Befintliga signerade portalrader utan text kan använda exakt sparat juridikpaket/dokument och verifierad SHA-256, aldrig dagens mall. Saknat originalunderlag ger en synlig åtgärd, ingen fabricerad fullmakt.

PDF-renderaren hanterar svenska och WinAnsi-tecken. Annan Unicode kräver ett uppladdat original eller en framtida Unicode-renderare; innehållet förvanskas inte tyst.

## Utskick och påminnelser

- Ombudets bolagsnamn och organisationsnummer måste finnas i tenantprofilen. Ärendenummer, fullmaktsreferens och verifikatsnummer finns i mejlet. Personnummer läggs inte i ämnesraden.
- Nätförfrågan gäller anläggning, mätpunkt, nätområde, årsenergi, mätmetod, rapporteringsfrekvens och nuvarande handelsföretag när tillgängligt.
- Handelsförfrågan hålls separat och gäller avtalsstatus, bindningstid, uppsägningstid, avtalslut, tidigaste start hos ny leverantör, sista uppsägningsdatum, registrerad uppsägning och brytavgift.
- E.ON:s instruktion i det mottagna svaret gäller E.ON. Tilldela inte den policyn till Landskrona eller andra aktörer. Kontaktregistret ska verifieras mot respektive aktör; en adress i ett inkommande mejl ändrar inte registret automatiskt.
- Påminnelse efter 5 och eskalering efter 10 svenska arbetsdagar använder samma ärende/verifikat och rätt frågetyp. Högst två uppföljningar köas. Endast väntande ärenden följs upp, med ny kontroll av fullmakt och kontakt före leverans.

## Svar och åtgärder

Korrelationsmotorn använder ärende/tråd och verifierad avsändare samt tenant-/kund-/anläggningskopplingar. Tvetydiga kopplingar granskas. Citerad historik används inte som nya anläggningsuppgifter. Autosvar räknas inte som svar.

Nekad fullmakt, saknat organisationsnummer/verifikat/signatur eller begäran om annan mottagare markerar det verifierade ärendet **behöver granskas** och stoppar både nya och redan köade utskick. Orsak och utdrag sparas. Rättelse kräver behörig användare i operativ måltenant och en åtgärdsanteckning i Fullmakter. En nyare invändning får inte skrivas över av en samtidig granskning. Efter rättelse sker nytt utskick genom ordinarie validering; granskningsknappen skickar inget mejl.

Tillförlitliga anläggningssvar fortsätter via befintlig kanonisk validering och nästa steg. Avtalsuppgifter extraheras och sparas med originalsvaret. Fria kommersiella villkor och villkorade startdatum går till granskning; de godkänner inte automatiskt ett leverantörsbyte. Datum eller uppsägningstid får inte gissas från mallens frågor eller citerad historik.

## Begränsad AI-läsning

Automatisk läsning aktiveras på servern med `MANUAL_MAIL_AI_ENABLED=1` och `OPENAI_API_KEY`. Utan flaggan sker inga automatiska AI-anrop. Nyckeln ska vara **Secret** i Vercel **Production**, utan `NEXT_PUBLIC_`-prefix, och aldrig skickas till webbläsaren. Nya miljövärden kräver en ny driftsättning. För OpenAI behövs rätt att skapa Responses-anrop; en helt read-only API-nyckel kan inte köra modellen. Modellens läsbehörighet i OPS avgränsas av applikationen.

`gpt-6-luna` får bara den nya svarstexten, inga databasnycklar, tenant-/kund-ID:n, bilagor eller citerad historik. Vanliga svenska identitetsnummer, mejladresser och GX-referenser maskeras; maskeringen täcker inte alla personuppgifter i fri text. Servern har redan fastställt matchat ärende, tenant och kund och kontrollerar trovärdig avsändare före anropet. Modellen har inga verktyg, ingen möjlighet att öppna länkar och inga funktioner för utskick, registerändring eller marknadsstart. `store:false` används; detta är inte ett generellt löfte om leverantörens samtliga loggnings-/retentionsvillkor.

Text över 12 000 tecken, över 80 stycken eller med ett stycke över 2 000 tecken lämnas för manuell granskning i stället för att klippas. Ett anrop har 15 sekunders timeout och högst 1 600 output-token. Strikt JSON-schema och servervalidering av varje råvärde mot källstycket krävs. Hela stycket väljs av servern som källcitat. Detta bevisar att texten finns, inte att modellens tolkning är riktig. Förbehåll kan även finnas i andra stycken; granska alltid originalsvaret före beslut.

Förslaget sparas separat i `manual_inbound_messages.extracted_payload.ai_read_only`, med betrodd tenant-/kund-/ärendekontext, källhash, modell, status och tokenanvändning/kostnadsestimat när leverantören rapporterar det. Det används aldrig som indata till befintlig korrelation, anläggningsuppdatering, påminnelser eller leverantörsbyte. Den befintliga deterministiska valideringen fortsätter separat. Befintlig RLS bevaras och en AI-visning med annan kontext än den aktuella matchningen döljs.

En atomisk reservation görs före anropet. Varje inkommande rad kan reserveras en gång, även om två arbetare tävlar eller mejlet normaliseras om. Inga automatiska retries av betalbara anrop görs. En krasch, timeout eller misslyckad resultatskrivning kan lämna status `processing`; granska då originalet. AI-fel stoppar inte ordinarie mejlhantering. Äldre redan slutbehandlade mejl analyseras inte automatiskt i efterhand. Ingen ny databasmigration eller publik API-version behövs.

Plattformsadmin ser förslag och källcitat under **Manuella informationsbegäranden**, `/admin/manual-requests`. **Testa AI-anslutningen** använder en fast syntetisk text och testar den nyckel som den körande servern har. Det skickar inga mejl och använder inga kunduppgifter. Testet kan köras med automatiken avstängd; lokal spärr på en minut per användare och körinstans är en diagnostikbegränsning, inget globalt kostnadstak.

Vid uttrycklig releaseverifiering kan Vercel-bygget få build-variabeln `GRIDEX_VERIFY_PRODUCTION_AI=1`. Efter ordinarie produktionsbygge körs då ett enda verkligt Responses-anrop genom samma läsare med den fasta exempeltexten. Ett fel stoppar bygget. Flaggan sparas inte som standard i projektet; vanliga byggen och CI gör inga betalda anrop. Loggen visar bara status, modell och token-/kostnadsmetadata. Detta verifierar produktionsnyckeln och läsarens providerprotokoll, inte en verklig Strato-leverans eller en inloggad användarsession.

Verifierat standardpris 2026-10-18: 0,10 USD/miljon input-token och 0,50 USD/miljon output-token. Ett räkneexempel med 3 000 input och 1 000 output kostar 0,0008 USD per mejl: cirka 8 kr för 1 000 mejl vid antagen kurs 10 kr/USD. Verklig kostnad beror på tokenmängd, växelkurs och leverantörens aktuella pris; moms och befintlig infrastruktur tillkommer. Engångsreservation och token-/textgränser begränsar varje mejls kostnad. Något hårt månadsbudgettak är inte implementerat; följ leverantörens förbrukning. [Modell](https://developers.openai.com/api/docs/models/gpt-6-luna), [priser](https://developers.openai.com/api/docs/pricing).

## Driftkontroll

1. Kontrollera aktiv, verifierad `manual_communication_mailboxes`-rad för rätt miljö: From och Reply-To `leverantorsbyte@gridex.se`, Stratos faktiska IMAP-inställningar och giltig secret reference. Använd inte Ediel-brevlådan för detta.
2. Kontrollera Resends domänverifiering och SPF/DKIM för avsändaren. Stratos MX ska fortsätta ta emot svaren. Se [mejlchecklistan](email-production-checklist.md).
3. Kontrollera cron för manual outbox, uppföljnings-watchdog och `/api/internal/manual-inbound/cron?environment=production`; se [pollningsrunbook](inbound-mail-polling-runbook.md).
4. Testa med en syntetisk kund: godkännande med kund-IP → arkiverad PDF → utgående ämne/From/Reply-To → verkligt svar via Strato → korrekt tenant/kund/ärende. Testa därefter nekande, rättelse och en uppföljning.
5. Kontrollera tenant A/B-isolering och superadminåtkomst i den riktiga driftmiljön. Kopiera inte kunddata eller råa credentials till verifieringsunderlaget.
6. Driftsätt först med AI-automatiken avstängd och kör det syntetiska anslutningstestet som plattformsadmin. Aktivera därefter `MANUAL_MAIL_AI_ENABLED=1` i Production och driftsätt på nytt. Kontrollera ett nytt syntetiskt svar via den riktiga Strato-kedjan: separat AI-förslag, oförändrad affärsbehörighet och inget andra AI-anrop vid replay.

Den här ändringen kör ingen produktionsbackfill och ändrar inte brevlådor, kontakter eller DNS. Äldre dokument arkiveras vid åtkomst; en fullständig historisk inventering behöver köras mot driftens faktiska data. Ingen produktionsleverans eller Strato-inloggning har verifierats i den lokala kodkontrollen.
