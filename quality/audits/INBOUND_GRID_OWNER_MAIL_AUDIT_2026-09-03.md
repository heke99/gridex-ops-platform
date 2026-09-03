# Granskning: inläsning av nätägarsvar via e-post (manuell kanal)

Datum: 2026-09-03
Omfattning: hela exekveringsvägen för manuell nätägarkommunikation — fullmakt ut,
svar in — samt de delar av Ediel-inbound som delar kod med den.
Typ: felsökning och defektregister. **Ingen produktionskod har ändrats.**

---

## 1. Skill-routing

**Aktiverade**

- `acquire-codebase-knowledge` — hela transportvägen lästes i källkod innan
  slutsatser drogs.
- `find-bugs` — primärt mål: hitta defekter i inbound-vägen.
- `systematic-debugging` — varje fynd spårat till exakt rad och verifierat mot
  levande schema/data där det gick.
- `code-review` — läsning av orkestrerare, worker, poller, korrelation, parser,
  webhook och API-routes.
- `supabase` / `supabase-postgres-best-practices` — index-, RLS- och
  migrationskontroll mot `gridex-ops-dev`.
- `fp-check` — varje fynd nedan är klassat `BEKRÄFTAD`, `TROLIG` eller
  `BLOCKERAD` och åtskilt från antaganden.
- `spec-to-code-compliance` — jämförelse mellan repots migrationer och det
  faktiskt applicerade schemat.
- `variant-analysis` — när charset-defekten hittades i den manuella pollern
  söktes samma mönster i Ediel-pollern (samma defekt finns där).
- `observability-and-instrumentation` — flera fynd handlar om att fel idag är
  osynliga.

**Villkorliga, ej aktiverade nu**

- `test-driven-development`, `refactor`, `code-simplifier`, `executing-plans` —
  aktiveras först vid remediering, som inte är beställd.
- `property-based-testing` — relevant för MIME-avkodaren när den skrivs om.

**Medvetet överhoppade**

- `semgrep`, `codeql`, `sarif-parsing`, `supply-chain-risk-auditor`,
  `scan-secrets`, `install-hooks` — uppgiften är funktionell felsökning av en
  avgränsad väg, inte en säkerhetsscanning av repot.
- `web-design-guidelines`, `vercel-react-best-practices`,
  `performance-optimization`, `sql-optimization-patterns` — ingen UI- eller
  prestandafråga i scope.
- `using-git-worktrees`, `dispatching-parallel-agents` — en sammanhängande
  arbetsström.

---

## 2. Så ser vägen ut i kod

### 2.1 Två åtskilda kanaler

Separationen är explicit dokumenterad i `lib/email/manualOperationsMailbox.ts:6-24`:

| | Ediel/EDIFACT | Manuell nätägarkommunikation |
|---|---|---|
| Adress | `ediel@gridex.se` | `leverantorsbyte@gridex.se` |
| Innehåll | PRODAT/UTILTS, APERAK/CONTRL | Fritext + fullmakts-PDF |
| Utgående | `ediel_outbox` | `manual_email_outbox` via Resend |
| Inkommande | `/api/internal/inbound-mail/cron` | `/api/internal/manual-inbound/cron` |
| Register | `ediel_mailboxes` | `manual_communication_mailboxes` |

Mottagaradress per nätägare ligger separat i `grid_owner_contact_channels`.
Fullmakt går alltid via den **manuella** kanalen.

### 2.2 Utgående (fullmakt till nätägaren)

`lib/customer-operations/requestMissingFacilityInformationCore.ts` är enda
ingången för webb-API, manuell intake och kundkortsknappen. Sekvens:

1. `readSite` — tenant från autentiserad kontext, aldrig från formulär.
2. Avbryt om `facility_id` redan finns (`not_needed`).
3. Kräver `site.grid_owner_id` (inte `selected_grid_owner_id`) och
   `site.address_hash`.
4. `findValidPowerOfAttorney` — status i (`signed`,`active`,`accepted`),
   rätt `site_id`, ej utgången, `scopeAllows`.
5. `findContactChannelEmail` — verifierad kanal, tenant-override före
   plattformsdefault, kastar vid tvetydig prioritet.
6. `assertOutboundAllowed` + `resolveManualOperationsMailbox`
   (blockerar hellre än faller tillbaka till Ediel-brevlådan).
7. Spärrar: skyddad identitet → `needs_review`; saknade kunduppgifter →
   `needs_review` med exakta fältkoder; `hasExternallySendablePoa` →
   `needs_review`.
8. `buildPoaAttachment` — uppladdad signerad PDF om den finns
   (`%PDF`-magic verifieras), annars genererad PDF från låst snapshot.
9. Kö i `manual_email_outbox` med idempotensnyckel
   `manual-facility-request:<company>:<site>:<gridOwner>:<hash>:<type>:<requestId>`.
10. `case_reference = GX-FIR-<requestId utan bindestreck, versaler>`
    (`caseReferenceFor`, rad 140) — sätts i ämnesraden av mallen.

Workern `lib/email/manualEmailOutbox.ts` gör atomiskt anspråk
(`status=queued → sending` med `locked_by`), verifierar att `to_email` matchar
`actual_recipient_email`, vägrar Ediel-avsändare, skickar via Resend, sparar
`provider_message_id` och kör `advanceLinkedRequest` → `waiting_manual_response`.

**Viktigt:** brevlådans SMTP-uppgifter används inte för utskick — Resend gör
leveransen. Skickad post syns därför inte i Stratos "Skickat".

### 2.3 Inkommande (svaret tillbaka)

Cron var 5:e minut (`vercel.json`: `4-59/5 * * * *`) →
`runManualInboundMailEngine` (`lib/inbound-mail/manualMailboxPoller.ts`):

1. `listActiveManualMailboxes` — `is_active` och `is_verified` och `imap_host`.
2. Intervallkontroll + `claimMailbox` (30 min stale-lås).
3. `ImapFlow` mot Strato, `client.fetch({ seen: false })`, max 25/brevlåda.
4. `parseMimeSource` — egen MIME-läsare (text, HTML, textbilagor,
   `In-Reply-To`, `References`).
5. `ingestManualInboundEmail` per meddelande; `\Seen` sätts först vid lyckad
   ingest.

`lib/inbound-mail/manualInboundIngestion.ts`:

1. `persistRawInbound` — rådata till `manual_inbound_messages`,
   `company_id: null`, idempotent på `(mailbox, provider_message_id)`.
2. `extractManualFacilityFields` + `scoreManualFacilityPayload`.
3. `resolveManualInboundCorrelation`.
4. UPDATE av raden med korrelationsresultat.
5. `upsertInboundOperationEvent` → `inbound_operation_events`.
6. `applyManualFacilityResponse` om allt stämmer → ärendet får
   `manual_response_received`.

`lib/inbound-mail/manualInboundCorrelation.ts` — bevisstege med styrka:

| Källa | Styrka |
|---|---|
| `GX-FIR`-referens matchar ett ärende | 100 |
| RFC-svarsheader → `manual_email_outbox` (direkt eller via Resend-brygga) | 95 |
| Tenant-egen brevlåda | 90 |
| Unikt anläggnings-ID / mätpunkt | 80 |
| Unikt kundnummer | 75 |
| Verifierad avsändare (endast om inget annat finns) | 60 |

Flera tenant-kandidater → `ambiguous`. Ingen tenant eller ingen entitet →
`unmatched`. Ej trovärdig avsändare → `ignored`. Annars `matched`.

Det finns även en HMAC-signerad push-väg: `app/api/webhooks/manual-inbound/route.ts`.

---

## 3. Defektregister

Klassificering: **BEKRÄFTAD** = verifierad mot kod och/eller levande schema.
**TROLIG** = defekt enligt kod- och biblioteksläsning, inte reproducerad.

---

### F-1 — `inbound_operation_events` saknas i databasen; varje inkommande svar avbryts (Kritisk, BEKRÄFTAD)

**Bevis**

- `supabase/migrations/20260824190000_gridex_inbound_operations_foundation.sql:47`
  skapar tabellen.
- Versionen `20260824190000` finns **inte** i
  `supabase_migrations.schema_migrations` (ledgern går från `20260824155304`
  direkt till `20260825091402`), och inget annat ledgernamn motsvarar den.
- `select table_name from information_schema.tables where table_name='inbound_operation_events'`
  ger noll rader i `gridex-ops-dev`.
- `lib/inbound-mail/manualInboundIngestion.ts:187-208` — `upsertInboundOperationEvent`
  avslutas med `if (error) throw error`, **utan** den `missingSchema()`-tolerans
  som används på i stort sett varje annan schemaberoende plats i kodbasen
  (jfr `manualOperationsMailbox.ts:68-72`, `requestMissingFacilityInformationCore.ts:130-134`).

**Felkedja**

1. Rådata sparas, korrelationen lyckas, `manual_inbound_messages` uppdateras.
2. `upsertInboundOperationEvent` kastar `42P01`.
3. Undantaget når `pollOneMailbox`, som medvetet **inte** sätter `\Seen`
   (`manualMailboxPoller.ts:252-256`).
4. Nästa polling hittar raden via `persistRawInbound` → `resolution_status`
   är redan `matched`, alltså inte `unmatched` → `resultFromExisting` returneras
   utan att någon affärslogik körs (`manualInboundIngestion.ts:264-267`).
5. Ingen throw denna gång → mejlet markeras `\Seen` och hämtas aldrig mer.

**Effekt:** nätägarens svar tas emot, korreleras rätt — och tappas sedan tyst.
Ärendet står kvar i `waiting_manual_response` för alltid. Ingen larmar.
`assertPlatformSchemaReady` fångar det inte; readiness-kontraktet är låst till
`20260803093300` och känner inte till tabellen.

**Rotorsak:** en migration som runtime hårt beror på gick aldrig in i ledgern,
och skrivningen saknar den schematolerans som är standard i övriga kodbasen.

**Fix**

1. Framåtriktad migration som skapar `inbound_operation_events` (kör om
   `20260824190000` under ett nytt versionsnummer så ledgern blir sann).
2. Gör `upsertInboundOperationEvent` schematolerant: vid `missingSchema` logga
   strukturerat och fortsätt — orkestreringsindexet får aldrig blockera
   affärsprocessen.
3. Lägg tabellen i `platform_runtime_readiness`-kapabiliteterna så att en
   saknad tabell blir en synlig 503 i stället för tyst dataförlust.
4. Regressionstest: ingest mot en databas utan tabellen ska ändå sätta
   ärendet till `manual_response_received`.
5. Engångsåtgärd: kör om de meddelanden som redan står kvar i
   `processing_state IN ('matched','received')` med `request_id` satt.

---

### F-2 — Teckenkodning förstörs; svensk text blir oläsbar för parsern (Hög, BEKRÄFTAD)

**Bevis**

- `lib/inbound-mail/manualMailboxPoller.ts:52-62`:
  ```ts
  .replace(/=([A-Fa-f0-9]{2})/g, (_m, hex) => String.fromCharCode(parseInt(hex, 16)))
  ```
  Varje quoted-printable-byte blir en latin1-kodpunkt. UTF-8-sekvenser
  (`C3 A4` för `ä`) blir två tecken. `charset` från `Content-Type` läses aldrig.
  Base64-delar avkodas hårdkodat som `utf8` (rad 59-61) oavsett deklarerad
  teckenuppsättning.
- Samma defekt finns i Ediel-pollern:
  `lib/inbound-mail/edielMailboxPoller.part-1.ts:692` och `:698-706`.
- Levande bevis i `manual_inbound_messages.normalized_text`:
  `"Tack fÃ¶r ditt mejl."`

**Effekt:** `extractManualFacilityFields`
(`lib/customer-operations/manualFacilityResponseParser.ts:68-71`) matchar på
etiketterna `anläggnings-?id`, `nätområde`, `elområde`, `mätpunkts-?id`.
Ingen av dem matchar mojibake. De ASCII-translittererade alternativen
(`anlaggnings-id`) hjälper inte, eftersom mojibake varken är korrekt UTF-8
eller ren ASCII. Även `classifyManualInboundIntent`
(`manualInboundCorrelation.ts:106-140`) förlorar sina svenska mönster.
Båda verkliga svaren i databasen har `confidence_score = 0.0000`.

**Fix**

1. Bryt ut en gemensam MIME-avkodare (`lib/inbound-mail/mime.ts`) som båda
   pollarna använder.
2. Avkoda till `Buffer` först, läs `charset` ur delens `Content-Type`, avkoda
   med `TextDecoder` (`utf-8`, `iso-8859-1`, `windows-1252`, med `utf-8` som
   default och latin1 som fallback vid ogiltig sekvens).
3. Stöd MIME encoded-words (`=?UTF-8?Q?...?=`, `=?ISO-8859-1?B?...?=`) i
   `Subject`, `From` och `filename`.
4. Överväg `mailparser` i stället för egen parser — den hanterar charset,
   nästlade multipart, `message/rfc822` och kodade headers korrekt.
5. Fixture-tester med de två verkliga svaren (avidentifierade) som gyllene
   testfall.

---

### F-3 — Binära bilagor kastas; hela svaret kan gå förlorat (Hög, BEKRÄFTAD)

**Bevis**

`manualMailboxPoller.ts:110-113`:
```ts
attachments.push({ filename, contentType: partType,
  text: partType.startsWith('text/') ? decoded.slice(0, 200_000) : null })
```
Endast `text/*` behålls, och bara som text. PDF, XLSX och bilder sparas som
`{filename, contentType, text: null}` — innehållet finns inte kvar någonstans.
Råmejlet (`message.source`) sparas heller aldrig; `manual_inbound_messages`
har ingen `raw_email`-kolumn (jfr Ediel, som har `raw_email` i
`StoreInboundEmailInput`, `edielMailboxPoller.part-1.ts:54`).
`attachmentText` (`manualInboundIngestion.ts:71-90`) kan därmed aldrig läsa
dem heller.

**Levande bevis:** Landskrona Energis svar har `body_len = 0`, `html_len = 0`,
1 bilaga, `normalized_text` = 95 tecken (bara ämnesraden). Svaret är
oåterkalleligt förlorat — mejlet är markerat läst.

**Effekt:** nätägare som svarar med PDF eller Excel (vanligt för anläggnings-
listor) ger noll data, och evidensen går inte att återskapa.

**Fix**

1. Ladda upp varje bilaga till Storage
   (`inbound-mail/<company_id|quarantine>/<inbound_id>/<index>-<filnamn>`),
   spara `storage_path`, `sha256`, `size_bytes`, `content_type` i JSON-raden.
2. Spara alltid råmejlet (`source`) — utan råmaterial går inget att spela om.
3. PDF-textextraktion och XLSX/CSV-parsning i extraktionssteget.
4. Storleks- och MIME-tak, samt vägran att exekvera eller följa innehåll.

---

### F-4 — Endast olästa mejl hämtas; en människa i webbmailen dödar inläsningen (Hög, BEKRÄFTAD)

**Bevis**

`manualMailboxPoller.ts:226` hämtar uteslutande `client.fetch({ seen: false })`.
Ediel-pollern har exakt den fallback som saknas här, med kommentar som
beskriver precis detta problem
(`edielMailboxPoller.part-2.ts:408-425`):

> "Several IMAP providers differ in how they expose Seen/Unseen after webmail
> or previous client access. UID de-dupe above prevents duplicates from the
> unseen pass, while this keeps manual AGT sync from missing a message just
> because it is already read."

`leverantorsbyte@gridex.se` är en delad operativ brevlåda som människor öppnar.
Varje mejl någon tittar på först försvinner ur inläsningen permanent.

**Fix**

1. Samma tvåpass-strategi som Ediel: `{seen:false}`, därefter
   `{since: nu - N dagar}` med UID-dedupe (`Set<number>`), N konfigurerbart.
2. Bättre långsiktigt: spåra `uidValidity` + `lastSeenUid` per brevlåda och
   hämta `UID > lastSeenUid` — oberoende av flaggor.
3. Sluta använda `\Seen` som processtillstånd; låt databasen äga det.

---

### F-5 — Intent bestäms av vår egen ärendetyp, aldrig av vad nätägaren skrev (Hög, BEKRÄFTAD)

**Bevis**

`manualInboundCorrelation.ts:106-108`:
```ts
const fromRequest = requestIntent(clean(requestType))
if (fromRequest) return fromRequest        // confidence: 1
```
Så snart ett ärende är matchat returneras `facility_information_response` med
säkerhet 1.0 — innehållet klassificeras aldrig. Alla mönster längre ner
(avslag, fullmaktsfråga, flytt, klagomål) är oåtkomliga för matchade ärenden.

**Levande bevis:** E.ON:s svar ("När det gäller förfrågningar och fullmakter,
så är det till ovan...", dvs. *fel kanal, använd annan adress*) ligger lagrat
som `intent = facility_information_response`, `intent_confidence = 1`.

**Effekt:** avslag, autosvar, "vi behöver mer information", "använd vår portal"
och verkliga svar är alla samma sak för systemet. Ingen process kan agera rätt.

**Fix**

1. Kör alltid innehållsklassificering; använd `request_type` som prior, inte
   som facit. Kombinera: matchar innehållet ärendetypen höjs säkerheten,
   avviker den sänks den och ärendet går till granskning.
2. Nya intents: `wrong_channel`, `auto_reply`, `information_missing`,
   `request_rejected`, `identity_verification_required`.
3. Autosvarsdetektion på headers innan något annat:
   `Auto-Submitted: auto-replied`, `X-Autoreply`, `X-Autorespond`,
   `Precedence: bulk|auto_reply`, `List-Id`. Ett autosvar får aldrig räknas
   som svar på ärendet och får aldrig stänga det.
4. `wrong_channel` bör automatiskt föreslå uppdatering av
   `grid_owner_contact_channels` — det är återkommande och värdefullt.

---

### F-6 — `ignored` är en tyst papperskorg (Hög, BEKRÄFTAD)

**Bevis**

`manualInboundCorrelation.ts:528` sätter `resolutionStatus = 'ignored'` när
`senderIsCredible` är falskt. `senderIsCredible` (rad 345-361) kräver att
avsändaradressen är exakt `request.recipient_email` **eller** finns i
`grid_owner_contact_channels` för samma nätägare.

Nätägare svarar rutinmässigt från en annan adress än den man skrev till
(handläggarens personliga adress, ett ärendesystem, en `no-reply`-adress).
Ett sådant svar blir `ignored`. Därefter:

- ingen `customer_operation_task` skapas (grep: ingen taskskapande kod i hela
  `manualInbound*`-vägen — jämför Ediel som har
  `lib/inbound-mail/inboundTaskFactory.ts`),
- ingen notis, ingen statusändring på ärendet,
- enda synligheten är `app/admin/manual-requests/page.tsx`, som är låst med
  `requirePlatformAdminAccess()` — **tenanten kan aldrig se det**.

**Fix**

1. `ignored` ska skapa en `customer_operation_task` av typen
   `manual_inbound_untrusted_sender` i rätt tenant, med länk till meddelandet.
2. Skilj på "obetrodd avsändare" (granska, kan godkännas med ett klick som
   samtidigt lägger till adressen som verifierad kontakt) och "skräp"
   (autosvar, spam — kastas).
3. Exponera `ambiguous`/`unmatched`/`ignored` i tenantens arbetskö, inte bara
   på plattformsadmins diagnostiksida.

---

### F-7 — Ingen SLA, ingen påminnelse, ingen eskalering (Hög, BEKRÄFTAD)

**Bevis**

- `lib/inbound-mail/inboundOverdueMonitor.ts:88-180` läser uteslutande
  `outbound_requests` (Ediel ACK, Z04, Z14). `grid_owner_information_requests`
  förekommer inte alls i filen.
- Ingen annan kod bevakar `waiting_manual_response`.
- Mallarna `reminder` (`manualGridOwnerTemplates.ts:172`) och `escalation`
  (`:192`) finns fullt formulerade — men `renderManualEmailTemplate` anropas på
  **exakt ett ställe** i hela kodbasen
  (`requestMissingFacilityInformationCore.ts:1010`), alltid med
  `templateKey` som defaultar till `facility_information_request`. Ingen
  anropare skickar någonsin `reminder` eller `escalation`.

**Effekt:** en nätägare som aldrig svarar ger ett ärende som väntar i
oändlighet. Kunden hänger i leverantörsbytet utan att någon får veta det.

**Fix**

1. Cron som skannar `waiting_manual_response` äldre än N dagar → skapa task +
   köa `reminder` mot samma ärende och `case_reference`.
2. Efter M dagar → `escalation` + task med högre allvarlighetsgrad.
3. Idempotensnyckel per `(request_id, steg)` så påminnelser inte dubbleras.
4. Gränsvärden per nätägare (vissa svarar på timmar, andra på veckor).

---

### F-8 — Unikhetskontraktet i schemat är inte det koden förutsätter (Hög, BEKRÄFTAD)

**Bevis**

Levande index på `manual_inbound_messages`:
```
manual_inbound_provider_message_uidx UNIQUE (
  COALESCE(company_id,'00000000-...'::uuid), COALESCE(mailbox,''), provider_message_id
) WHERE provider_message_id IS NOT NULL
```
Skapat av `supabase/migrations/20260712100000_...:779-781`.

Det index koden faktiskt förutsätter — `(mailbox, provider_message_id)` —
finns bara i den **aldrig applicerade**
`20260824190000_gridex_inbound_operations_foundation.sql:30-32`
(`manual_inbound_messages_mailbox_provider_uidx`).

Koden (`manualInboundIngestion.ts:120-133`, `:150-153`) söker och
23505-återhämtar uteslutande på `(mailbox, provider_message_id)` och skriver
`company_id: null` vid insert.

**Effekt**

Samma nätägarsvar kan lagras en gång per `company_id`, eftersom tenant sätts
*efter* insert: när rad 1 fått `company_id = X` ligger den inte längre i vägen
för en ny insert med `company_id = null`. Kombinerat med F-9 (två pollers mot
samma INBOX) blir dubblettinläsning av samma mejl schemamässigt tillåten. Den
23505-gren som ska fånga kapplöpningen (`:150-159`) kan i praktiken aldrig
träffa på det sätt koden antar.

**Fix**

1. Bestäm kontraktet explicit. Ett inkommande mejl till en delad brevlåda är
   *ett* meddelande: unikhet ska vara `(mailbox, provider_message_id)` globalt.
2. Deduplicera befintliga rader, skapa det strikta indexet i en framåtriktad
   migration, behåll det company-scopade bara om det finns ett verkligt skäl.
3. Vill ni medvetet tillåta en kopia per tenant måste `findExistingInbound`
   filtrera på `company_id` — men då måste tenant vara känd före insert, vilket
   den inte är. Alternativ 1 är det korrekta.

---

### F-9 — Två aktiva produktionsbrevlådor pollar samma INBOX (Medel, BEKRÄFTAD)

**Bevis** (`manual_communication_mailboxes`, dev)

| mailbox_type | environment | from_email | imap_host | verified |
|---|---|---|---|---|
| `general_manual_operations` | production | leverantorsbyte@gridex.se | imap.strato.com | ja |
| `facility_information_request` | production | leverantorsbyte@gridex.se | imap.strato.com | ja |
| `general_manual_operations` | test | leverantorsbyte@gridex.se | imap.strato.de | nej |

`claimMailbox` (`manualMailboxPoller.ts:152-165`) låser **per rad**, inte per
faktisk IMAP-brevlåda. Båda produktionsraderna kör alltså `fetch({seen:false})`
mot samma INBOX i samma cron-körning, i sekvens inom samma process idag men
utan något som hindrar överlapp.

**Fix**

1. En rad per faktisk IMAP-brevlåda. `mailbox_type` ska styra *val av avsändare
   för utgående*, inte skapa en dubblett av inkorgen.
2. `unique (environment, lower(imap_username), coalesce(imap_folder,'INBOX'))
   where is_active` som skydd.
3. Låset bör tas på `(host, username, folder)`, inte på `id`.

---

### F-10 — Ingen jobbkö för manuell inbound; misslyckanden återupptas aldrig (Medel, BEKRÄFTAD)

**Bevis**

Ediel-vägen har `inbound_processing_jobs` med `attempts_count`, `locked_by`,
stale-lås och `claim_inbound_processing_jobs`-RPC
(`edielMailboxPoller.part-2.ts:448-520`). Den manuella vägen gör allt inline i
fetch-loopen.

Kommentaren i `manualInboundIngestion.ts:262-264` säger:

> "Unmatched rows are intentionally re-evaluated because new tenant/customer
> masterdata may have arrived since the first attempt."

Det stämmer inte i praktiken: en `unmatched` rad markerades `\Seen` vid lyckad
ingest och hämtas aldrig igen av IMAP. Omvärderingen kan bara ske om
webhook-vägen levererar samma meddelande på nytt.

**Fix**

1. Inför `manual_inbound_jobs` (eller återanvänd `inbound_processing_jobs` med
   `source_transport`) — persist → jobb → worker, med attempts och backoff.
2. Separat cron som omkorrelerar `unmatched`/`ambiguous` när ny masterdata
   tillkommit, med tak på antal försök.

---

### F-11 — IMAP-kommandon körs inuti en pågående `fetch`-iteration (Medel, TROLIG)

**Bevis**

`manualMailboxPoller.ts:253` anropar `client.messageFlagsAdd(...)` inuti
`for await (const message of client.fetch(...))`. Samma mönster i
`edielMailboxPoller.part-2.ts:396-398`.

ImapFlow dokumenterar att anslutningen inte är tillgänglig för andra kommandon
medan en `fetch` pågår; rekommenderat mönster är att samla UID:er och agera
efter iterationen. Beteendet är serverberoende, vilket gör det till en
instabilitetsrisk snarare än ett garanterat fel — därav `TROLIG`.

**Fix:** samla UID:erna i en array under loopen och gör ett
`client.messageFlagsAdd(uidList, ['\\Seen'], { uid: true })` efter att
iteratorn stängts.

---

### F-12 — Rader skrivs utan tenant; kastas korrelationen blir de osynliga för alltid (Medel, BEKRÄFTAD)

**Bevis**

`manualInboundIngestion.ts:151-153` skriver `company_id: null`; tenant sätts
först i UPDATE:en på rad 297. Kastar något däremellan (t.ex. F-1) ligger raden
kvar utan tenant. Med restriktiva RLS-policys av typen
`company_id IN (SELECT gridex_user_company_ids())` blir `NULL IN (...)` aldrig
sant — raden är osynlig för varje tenantanvändare. Samma mönster är redan
dokumenterat som F-4 i `TENANT_ISOLATION_CONSISTENCY_AUDIT_2026-09-02.md`
(22 av 44 `inbound_email_messages` utan tenant, alla i `manual_review`).

**Fix**

1. Sätt `processing_state = 'quarantined'` explicit på untenantade rader och ge
   plattformen en arbetslista som täcker dem.
2. Skriv korrelationsresultatet i samma transaktion som insert (RPC), så
   fönstret inte existerar.
3. Larma när `quarantined` ökar.

---

### F-13 — Extraktionen klarar bara "etikett: värde" (Medel, BEKRÄFTAD)

**Bevis**

`manualFacilityResponseParser.ts:54-95`. `matchAfterLabel` kräver en etikett
följd av värdet på samma rad. Det finns ingen fallback för ett fritt 18-siffrigt
GSRN/EAN, ingen HTML-tabellparsning, ingen hantering av värde på *nästa* rad.
Ett svar av formen

```
Anläggnings-ID
735999123456789012
```

ger noll träff, liksom en HTML-tabell med `<td>Anläggnings-ID</td><td>…</td>`.

**Fix**

1. Fallback: hitta 18-siffriga sekvenser i hela texten; acceptera automatiskt
   endast när exakt en unik kandidat finns, annars `needs_review` med
   kandidaterna listade.
2. Validera GS1-checksiffra innan värdet accepteras.
3. Parsa `<table>`-strukturer nyckel/värde innan HTML strippas
   (`stripHtml` på rad 61 kastar tabellstrukturen redan idag).
4. Tillåt värde på raden efter etiketten.

---

### F-14 — Utgående mall ber inte om maskinläsbart svar (Medel, BEKRÄFTAD)

**Bevis**

`manualGridOwnerTemplates.ts:40-71`. Mallen listar önskade uppgifter som
punktlista i löptext och avslutar "Vänligen besvara detta mejl och behåll
ärendenumret i ämnesraden". Ärendenumret fungerar bra (båda verkliga svaren
korrelerades via GX-FIR). Men inget i mallen styr *formatet* på svaret, vilket
är hela anledningen till att extraktionen är så bräcklig.

**Fix**

Lägg in ett ifyllningsbart block som matchar parserns etiketter exakt:

```
Var vänlig fyll i och returnera nedanstående rader oförändrade:

Anläggnings-ID:
Mätpunkts-ID:
Nätområde:
Årsenergi:
Mätmetod:
Rapporteringsfrekvens:
```

Versionera mallen (`templateVersion` finns redan) så svarsfrekvens och
parsningsgrad kan mätas per version.

---

### F-15 — Bara facility-ärenden har en adapter; övriga fastnar utan spår (Medel, BEKRÄFTAD)

**Bevis**

`manualInboundIngestion.ts:41-48` — `FACILITY_REQUEST_TYPES` innehåller fem
ärendetyper. `canApplyFacilityResponse` (`:357-363`) kräver medlemskap i den
mängden. Kanaltyperna `supplier_switch_manual`, `power_of_attorney` och
`ai_list` (deklarerade i `requestMissingFacilityInformationCore.ts:44-49` och
`manualOperationsMailbox.ts:29-34`) har ingen tillämpning alls: de landar i
`needs_review` (`:398-402`) utan task och utan notis.

**Fix**

1. Adapterregister per intent, med explicit "ingen adapter finns" som ett
   hanterat utfall som alltid skapar en task i rätt tenant.
2. Implementera minst `supplier_switch_response` och
   `power_of_attorney_question` — de är i produktion redan idag.

---

### F-16 — Reply-header-korrelationen hänger på en Resend-webhook (Medel, BEKRÄFTAD i kod, BLOCKERAD för driftverifiering)

**Bevis**

Resends API returnerar ett `email_id`, inte mejlets RFC `Message-ID`. Det är
`email_id` som sparas i `manual_email_outbox.provider_message_id`
(`manualEmailOutbox.ts:331`). Nätägarens `In-Reply-To`/`References` innehåller
RFC-id:t. Bryggan mellan dem är
`findResendProviderIdsByRfcMessageId`
(`manualInboundCorrelation.ts:164-186`), som läser
`communication_log_events.event_payload->data->>message_id` för
`provider = 'resend'` — data som bara finns om Resend-webhooken
(`app/api/webhooks/resend/route.ts`) är konfigurerad och levererar
`email.sent`.

Är den inte det är hela styrka-95-steget dött och `GX-FIR` i ämnesraden är
enda korrelationen. Om en nätägare svarar utan att behålla ämnesraden — vilket
händer — faller det tillbaka till anläggnings-ID/kundnummer, som ofta saknas
i just det svaret.

**Fix**

1. Verifiera att Resend-webhooken är konfigurerad i varje miljö, och lägg in
   den kontrollen i readiness/health i stället för att anta den.
2. Sätt och lagra ett eget `Message-ID` vid utskick där providern tillåter,
   alternativt lagra RFC-id:t direkt vid send.
3. Larma om andelen inkommande som matchas enbart via GX-FIR ligger på 100 % —
   det betyder att bryggan inte fungerar.

---

### F-17 — Webhooken läcker interna identifierare till e-postleverantören (Låg, BEKRÄFTAD)

`app/api/webhooks/manual-inbound/route.ts:153` returnerar hela `result`, som
innehåller `companyId`, `customerId`, `customerSiteId`, `meteringPointId`,
`requestId` och `caseReference`.

**Fix:** returnera `{ ok: true, resolution_status }`. Diagnostiken hör hemma i
loggen, inte i HTTP-svaret till en extern part.

---

### F-18 — Otenantad uppslagning vid idempotenskollision (Låg, BEKRÄFTAD)

`requestMissingFacilityInformationCore.ts:1075-1080` söker
`manual_email_outbox` på `idempotency_key` utan `.eq('company_id', …)`.
Nyckeln är company-prefixad, så det är inte exploaterbart — men det bryter mot
projektets invariant att varje läsning ska vara explicit tenant-scopad, och en
framtida nyckeländring gör det till en riktig bugg.

**Fix:** lägg till `.eq('company_id', input.companyId)`.

---

### F-19 — Testbrevlådan är felkonfigurerad och pollas aldrig (Låg, BEKRÄFTAD)

`environment = test` har `imap.strato.de` medan produktion har
`imap.strato.com`, och `is_verified = false`.
`listActiveManualMailboxes` (`manualMailboxPoller.ts:130-140`) kräver
`is_verified = true`, så testbrevlådan hämtas aldrig.

**Fix:** rätta hosten, verifiera brevlådan — eller ta bort raden. En
halvkonfigurerad rad ger falsk trygghet om att testmiljön fungerar.

---

### F-20 — Ingen brevlåda är tenantbunden (Låg/Medel, BEKRÄFTAD — produktbeslut)

Alla tre raderna har `company_id = null`. Bevissteget `tenant_mailbox`
(styrka 90, `manualInboundCorrelation.ts:397-398`) kan därmed aldrig ge utslag.
Tenant kan i praktiken bara bevisas via GX-FIR, svarsheader eller unik entitet.

Det är ett giltigt val för en delad plattformsbrevlåda, men det ska vara
medvetet. Detta är samma öppna fråga som `.agent-memory/current-task.md`
listar som kvarvarande före produktionssättning.

**Fix:** besluta och dokumentera. Vid vitmärkning per tenant behövs
tenant-egna brevlådor med egna IMAP-uppgifter.

---

### F-21 — Repots migrationsversioner stämmer inte med ledgern (Hög, BEKRÄFTAD — processdefekt)

**Bevis**

| Repo-fil | Ledger |
|---|---|
| `20260902093000_explicit_tenant_scope_and_inbound_quarantine.sql` | `20260902084311` (samma namn) |
| `20260902096000_attribute_quarantined_inbound_by_receiver_ediel_id.sql` | `20260902092313` (samma namn) |
| `20260824190000_gridex_inbound_operations_foundation.sql` | **saknas helt** |

Samtidigt är *kolumnerna* från `20260824190000` (`in_reply_to`,
`correlation_evidence`, `normalized_text`, `processing_state`, …) närvarande i
databasen — de kom in via `20260830091937_manual_inbound_canonical_correlation_parity`.
Schemat är alltså i ett halvtillstånd som ingen enskild migration beskriver.

**Effekt:** man kan inte avgöra vad som är applicerat genom att titta på
versioner. Det är exakt så F-1 kunde uppstå och förbli oupptäckt.

**Fix**

1. CI-grind som jämför filversioner mot `supabase_migrations.schema_migrations`
   och failar på både "fil utan ledgerpost" och "ledgerpost utan fil".
2. Sluta byta versionsnummer på en migration efter att den skrivits.
3. Engångsavstämning: gå igenom alla filer utan ledgerpost och avgör om
   innehållet är applicerat via annan väg eller saknas.

---

### F-22 — Noll testtäckning för hela inläsningsvägen (Hög, BEKRÄFTAD)

`parseMimeSource` refereras enbart i sin egen fil. Varken
`manualMailboxPoller`, `ingestManualInboundEmail` eller MIME-avkodningen har
något test i `__tests__/` eller `e2e/`. De befintliga testerna
(`post-139/143/144-inbound-manual-review-*`, `manual-inbound-tenant-graph-*`)
täcker Ediel-sidans granskningsflöde och tenantgrafen, inte transporten.

Det förklarar hur F-2 och F-3 kunde nå produktion.

**Fix**

1. Fixture-baserade enhetstester för MIME/charset med verkliga (avidentifierade)
   mejl: quoted-printable UTF-8, base64 ISO-8859-1, multipart med PDF, HTML-only.
2. Integrationstest för ingest → korrelation → tillämpning mot en tom och en
   fullständig databas (fångar F-1-klassen).
3. Kontraktstest som verifierar att live-index matchar det koden förutsätter
   (fångar F-8-klassen).

---

## 4. Vad som är rätt byggt

Detta är inte en trasig modul rakt igenom — flera delar är genomtänkta och bör
inte röras:

- **Kanalseparationen** mellan Ediel och manuell post är genomförd och
  dokumenterad; koden vägrar aktivt att skicka manuell post från Ediel-brevlådan
  (`manualEmailOutbox.ts:285`).
- **Tenant kommer aldrig från indata.** Webhooken slår upp brevlådans tenant i
  registret och avvisar tenant-id i payloaden
  (`app/api/webhooks/manual-inbound/route.ts:70-102`); cron-routen avvisar
  `company_id`-parametrar (`manual-inbound/cron/route.ts:55-57`).
- **Webhooksäkerheten** är korrekt: HMAC över `timestamp.body`, 5 minuters
  fönster, `timingSafeEqual`, storleks- och bilagetak.
- **Fullmaktsgrindarna** är strikta och rätt ordnade: giltig POA med rätt scope,
  externt sändbar POA, verifierad mottagarkanal, skyddad identitet, kompletta
  kunduppgifter — alla blockerar hellre än skickar undermåligt underlag.
- **Mottagarupplösningen** (`resolveManualRecipient`) gör skillnaden mellan
  riktig nätägarkontakt och intern säker adress explicit och auditerbar, och
  varnar högt om en produktionssändning omdirigeras.
- **Utskicksworkern** har korrekt atomiskt anspråk, `delivery_uncertain`-läge
  när providern accepterat men lokal status inte kunde skrivas, och
  tenant-scopade UPDATE:ar med kontroll av träffantal.
- **Korrelationens bevisstege** med styrkegradering och hård tvetydighet är en
  bra modell. Den fungerade: båda verkliga nätägarsvaren matchades till rätt
  ärende och rätt tenant.

Problemen sitter i **transportlagret** (charset, bilagor, flaggor),
**omvärlden efter matchning** (intent, adapters, tystnad) och
**schema-/processdisciplin** (F-1, F-8, F-21).

---

## 5. Blockerade kontroller

| Kontroll | Status | Skäl |
|---|---|---|
| Produktionsschema och produktionsdata | BLOCKERAD | Endast `gridex-ops-dev` är synlig; inget produktionsprojekt exponerat (samma blockerare som `open-blockers.md` punkt 1). Alla siffror i detta dokument gäller dev. |
| `MANUAL_INBOUND_*`- och Resend-miljövariabler | BLOCKERAD | Sätts i Vercel; kan inte läsas härifrån. F-16 kan därför inte drift-verifieras. |
| Faktisk IMAP-anslutning mot Strato | BLOCKERAD | Kräver brevlådans lösenord. `last_successful_poll_at` 2026-09-03 08:04 visar dock att anslutningen fungerar. |
| ImapFlow-beteende vid kommando under fetch (F-11) | EJ REPRODUCERAD | Klassad TROLIG, inte bekräftad. |

---

## 6. Verifieringsmatris

| Kontroll | Metod | Utfall |
|---|---|---|
| Fullmakt skickas via manuell kanal, ej Ediel | Kodläsning `requestMissingFacilityInformationCore.ts`, `manualOperationsMailbox.ts` | Bekräftat |
| `inbound_operation_events` saknas | `information_schema.tables` + ledgerjämförelse | Bekräftat, 0 rader |
| Migration `20260824190000` ej applicerad | `supabase_migrations.schema_migrations` | Bekräftat, saknas |
| Mojibake i lagrad text | `select normalized_text` | Bekräftat: `"Tack fÃ¶r ditt mejl"` |
| Bilaga utan innehåll | `body_len=0, att=1, norm_len=95` | Bekräftat |
| Extraktion ger noll | `confidence_score = 0.0000` på båda svaren | Bekräftat |
| Intent låst till request_type | Kodläsning `manualInboundCorrelation.ts:106-108` + lagrad rad | Bekräftat |
| Live-index är company-scopat | `pg_indexes` | Bekräftat |
| Ingen SLA-bevakning | Kodläsning `inboundOverdueMonitor.ts`, grep `waiting_manual_response` | Bekräftat |
| `reminder`/`escalation` aldrig använda | grep `renderManualEmailTemplate` (1 anrop) | Bekräftat |
| Ingen testtäckning för pollern | grep `parseMimeSource`, `manualMailboxPoller` | Bekräftat, 0 träffar utanför källfilen |
| Två produktionsbrevlådor mot samma INBOX | `select ... from manual_communication_mailboxes` | Bekräftat |

Nuläge i dev: 8 skickade manuella mejl, 2 ärenden i `waiting_manual_response`,
2 mottagna nätägarsvar (E.ON, Landskrona Energi) — båda korrekt matchade,
noll extraherad data, ingen statusförflyttning.

---

## 7. Remedieringsplan i små PR:ar

Ordningen är vald så att varje steg är självständigt verifierbart och de som
stoppar pågående dataförlust kommer först.

**PR 1 — Stoppa den tysta förlusten (F-1)**
Framåtriktad migration för `inbound_operation_events`; schematolerant skrivning;
tabellen in i readiness; regressionstest; omkörning av kvarvarande rader.

**PR 2 — Bevara det som kommer in (F-3, F-4, F-11)**
Råmejl och binära bilagor till Storage; seen-recent-fallback med UID-dedupe;
flaggning efter fetch-iterationen.

**PR 3 — Läs texten rätt (F-2, F-13, F-22)**
Gemensam charset-korrekt MIME-avkodare för båda pollarna; encoded-words;
18-siffrig fallback med GS1-kontroll; HTML-tabellparsning; fixture-tester med
de verkliga mejlen.

**PR 4 — Förstå vad som faktiskt sades (F-5, F-6, F-15)**
Innehållsbaserad intent-klassificering kombinerad med ärendetyp;
autosvarsdetektion; adapterregister; `ignored` och `needs_review` skapar tasks i
rätt tenant och syns i tenantens arbetskö.

**PR 5 — Sluta vänta i tysthet (F-7, F-14)**
SLA-cron med påminnelse och eskalering på befintliga mallar; strukturerat
svarsblock i utgående mall; mätning av svars- och parsningsgrad per mallversion.

**PR 6 — Schema- och konfigurationsdisciplin (F-8, F-9, F-12, F-19, F-20, F-21)**
Strikt unikhetsindex efter dedupe; en brevlåderad per faktisk inkorg med
unikhetsskydd; explicit karantän i stället för otenantade rader; rätt
testbrevlåda; beslut om tenantbindning; CI-grind för migrationsledgern.

**PR 7 — Småfixar (F-16, F-17, F-18)**
Resend-webhook i readiness; minimalt webhooksvar; tenant-scopad
outbox-uppslagning.

---

## 8. Öppna produktfrågor

Dessa kan inte avgöras från kod:

1. Ska den manuella brevlådan vara plattformsgemensam eller tenant-egen? (F-20)
2. När en nätägare svarar "fel kanal, använd X" — ska systemet automatiskt
   föreslå uppdatering av `grid_owner_contact_channels`, eller ska en människa
   alltid godkänna? (F-5)
3. Vilka SLA-gränser gäller för påminnelse respektive eskalering, och ska de
   sättas per nätägare? (F-7)
4. Får ett svar med endast anläggnings-ID från en obetrodd men trolig adress
   tillämpas automatiskt efter mänskligt godkännande, eller aldrig? (F-6)
