# T4 – Faktura, samtidighet och fil: findings (r1-track4 / claude-track4)

Kampanj 20261029-3f1a8ab1. Session `session_01UHTg8Ku6P35GA6fSrg1U1B`. Gren `claude/sim-20261029-track4` (harness och paket). Bas `1c0c088cb4ed66d0dd8b3e34c9606019342a1a56`.

## Miljöer

| environmentId | App | Harness | Konform med kontraktet i #935 | Användning |
|---|---|---|---|---|
| t4-20261029T192155Z | 1c0c088c | 766f4963/cf6a2b22 | nej, portpatchad kopia av `supabase/config.toml` och replayskriptet | bara felkvitton |
| t4-20261029T201002Z | 1c0c088c | e986a964 → 8ce5a6f7 | nej, samma patchning | bara felkvitton och kedjediagnos |
| t4-20261030T120157Z | main a0958815 + harness 4c5e0f75 (lokal `t4-run-main` 8b2e6190) | 4c5e0f75 | ja | omtest och kvalificerade kvitton |

Orakel: originalet `all-systems-scenarios.safe.json` är återställt (sha256 `96518c184c240dafa5890df8f6b375b0730acd90f0e97d8f39063fb68c329df3`, 41 736 B). Raderna per ID är enradare, och kvittokraven ligger på gruppnivå: MAIN04, MAIN05 och BILLNEG01.

Gemensamt för miljöerna:
- PG 17.6 (ghcr.io/supabase/postgres 17.6.1.155) och supabase CLI 2.101.0.
- Next 16.4.2 på 127.0.0.1:3104, Node 22.22.0, 4 CPU och 15 GiB.
- Replayens fingeravtryck är `5168f69b67b1e45168ef327ecf92efec6dc7bcd9dc2cf66f48f4ea96527c782c`. Det är en delidentitet och täcker bara utvalda tabeller.
- Ingen faketime används. Affärsdatum anges explicit i fixturer: leverans från 2026-07-01 och faktureringsmånaderna 2026-07 till 2026-09.

## 20261029-3f1a8ab1/claude-track4/1 – MAIN05.06 – produktfel, medel

- **Observerat:**
  - `GET /admin/billing/invoice-files/<36 bindestreck>` med en inloggad staff-användare som har `billing_underlay.export` gav HTTP 500 och 0 byte.
  - Appens logg visar `22P02 invalid input syntax for type uuid`.
- **Orsak:** `app/admin/billing/invoice-files/[id]/route.ts:23` vaktar med `/^[0-9a-f-]{36}$/i`. Id:t släpps igenom till `loadInvoiceFile`, som kastar vid PostgREST-felet.
- **Kvitton:**
  - Körning `20261029T194639Z-6067` (env t4-20261029T192155Z), rapportens sha256 `f892f0b34a5ea7d402e42ba8e41caf2e0b2c5a679e6ca9b95f2aa4d01469adeb`.
  - Körning `20261029T201053Z-22827` (env t4-20261029T201002Z), rapportens sha256 `87dbcadb1ca7460fcf3ffe42fc4a58a3e62d9a33c69ae7b43f20ff2ecb4cd74a`.
  - Komponentprov mot PostgREST: 400 och `22P02`.
- **Rättning:** PR #939 (commit fd8cb105d), mergad till main a0958815 2026-10-30.
  - Vakten kräver nu kanonisk 8-4-4-4-12-form.
  - Regression i `__tests__/admin-invoice-file-download-id-validation.test.ts`: före rättningen fallerade 2 av 6 fall, efter rättningen gick 70/70 igenom.
  - Två oberoende slutgranskningar (PR-kommentar 6508584225) och grön CI.
- **Läge: verifierad rättning.**
- **Omtest:** körning `20261030T120536Z-7454` i konform miljö `t4-20261030T120157Z`. Appen är main a0958815 med harness som overlay.
- **Utfall:** GET med 36 bindestreck ger 404, `text/plain`, 27 B. Kroppens sha256 är `c316c002…dbc2f` ("Fakturafilen hittades inte."). Inget 5xx, inget DB-fel.
- **Granskning:** godkänd av oberoende sim-reviewer, och MAIN05.06 är **PASS**.
- **Varianter:** samma svaga mönster finns i `lib/ediel/retention/contractDocumentPurge.ts:19`, `lib/ediel/scopedCapabilityReadiness.ts:61`, `lib/ediel/transport/rawMimeArchive.ts:30`, `lib/ediel/utilts/issuerIdentityAuthority.ts:73` och `lib/operations/db.part-2.ts:511-512`. Ingen av dem är en route-ingång, och ingen är styrkt som fel.

## 20261029-3f1a8ab1/claude-track4/2 – inkommande Ediel, blockerar T4:s faktureringskälla – produktfel, hög

- **Observerat:** 0 av 92 UTILTS E66 togs emot. Det enda jobbet slutade som `processor_failed` efter 5 försök, med `edifact_dangling_release_character`.
- **Orsak:**
  - `lib/inbound-mail/edielInboundProcessor.ts:187-191` slår ihop `raw_edifact_payload` och bilagans `raw_text`, som är byte-identiska (6843 B). Det beror på `edielMailboxPoller.part-1.ts:881-884`.
  - `extractCanonicalEdifactPayload` läser från första UNA till sista UNZ. Den andra kopians `UNA:+.? '` blir då ett vanligt segment.
  - Tokenizern trimmar bort det frisläppta mellanslaget (`edifactTokenizer.ts:121`), och `splitReleased` kastar.
- **Belägg:** payloaden ensam gav 406 segment, medan den sammanslagna texten kastade. Generatorn i harnessen skickar korrekt EDIFACT.
- **Variant som inte rättas någonstans:** `FTX+AAA+++ABC? '` kastar också, eftersom tokenizern kör `trim()`.
- **Ägare:** T3, enligt samordningens beslut 2026-10-30. Slås ihop med T3:s 004 om rotorsaken bekräftas.
- **Donator:** e9acfd648, processor-hunken. Den överlappar #915.
- **Läge:** styrkt. T4 rättar inte själv.

## 20261029-3f1a8ab1/claude-track4/3 – IMAP-pollningen låser sig – produktfel, hög (styrkt mot GreenMail 2.1.3)

- **Observerat:** 24 pollningar, var och en 90,5–90,6 s, med fetched=1 och `Connection not available`. Appens logg har 24 uncaughtException.
- **Orsak:** STORE (`messageFlagsAdd`) körs inne i `for await client.fetch` (`edielMailboxPoller.part-2.ts:424-430`). Det saknas också en `error`-lyssnare.
- **Belägg:** en isolerad imapflow-probe reproducerar felet.
- **Ägare:** T3. Fyndet är en dubblett av T3:s fynd 001 (#942).
- **Donator:** e9acfd648 (part-2) och 7b0ccaad7.
- **Läge:** dubblett. T4 testar om efter T3:s merge.

## Läge 2026-10-30 för track4/2 och /3

- `/3` rättas av T3 #942, som är mergad (6454d540). `/2` rättas av T3 #945, som inte är mergad.
- Båda är verifierade som lokal overlay i T4:s kedja: miljö `t4-20261030T133336Z`, körning `20261030T133759Z-15665`.
  - Alla 95 mejl hämtas och lagras.
  - Inget `edifact_dangling_release_character` och inget `Connection not available`.

## 20261029-3f1a8ab1/claude-track4/4: inga inkommande original sparas från den delade mejllådan (produktfel, hög)

- **Observerat** i overlay-körningen `20261030T133759Z-15665`:
  - Postgres-loggen har 99 `ediel_message_inbound_email_tenant_mismatch`: 1 CONTRL, 1 APERAK, 5 Z04-försök och 92 E66.
  - Det finns 0 inkommande `ediel_messages`.
  - Z04-jobbet slutar som `failed/processor_failed` med `ediel_inbound_original_persistence_required`.
  - Leveransperioden aktiveras aldrig (C5).
- **Orsak:**
  - Den delade testmejllådan har `company_id` NULL.
  - Tenant löses korrekt via `verified_legal_identity`.
  - Processorn binder bolaget till mejlet först efter att originalet har infogats (`lib/inbound-mail/edielInboundProcessor.ts:327,405`).
  - Triggern i `supabase/migrations/20261002234100_ediel_messages_inbound_email_link.sql:27-32` kräver samma bolag på mejl och meddelande.
- **Inte harness:**
  - Id, subadresser och aktörsregistrering stämmer.
  - Det finns ingen normal ingång för en tenant-avgränsad mejllåda: `app/admin/inbound-mail/actions.ts` skriver alltid `company_id: null`.
- **Donator** (finance-refen `c400f695` och gifted-hamilton):
  - `d74cf9942`: binder bolaget från NULL och ger konflikt om ett annat bolag redan är satt.
  - `7d8fefb51`: tar hand om den null-retur som annars ignoreras.
  - Båda applicerar rent på main (processorfilen).
- **Läge:** styrkt. Ägarbesked krävs, eftersom filen har den gamla claimref:en `a6707ead`.
- **Lokal overlay** för vidare körning: `t4-run-t3overlay` 05d413d78. Den pushas inte och ger högst PARTIAL.

## 20261029-3f1a8ab1/claude-track4/5: kvittens tillämpas utan sparat original (produktfel, hög, revisionsspår)

- `lib/ediel/...canonicalInboundAckStatusUpdater.ts:161-163` loggar en misslyckad insert och fortsätter ändå.
- Den utgående Z03 sätts då till `contrl_status`/`aperak_status = accepted`, och mejlet till `processed`, utan att något original är sparat.
- Felet är inte rättat på main, gifted eller finance.
- **Varianter:**
  - `inboundStatusUpdater.ts:540-541` loggar och returnerar null.
  - `inbound_processing_jobs.company_id` får aldrig något bolag.

## 20261029-3f1a8ab1/claude-track4/6: generiskt pollfel (produktfel, låg, observability)

- `lib/inbound-mail/edielMailboxPoller.part-2.ts:487-489` ersätter fel som inte är av typen `Error` med "Okänt pollingfel." och tappar detaljerna.
- Felet är observerat två gånger med 0 hämtade mejl. Orsaken är inte fastställd.

## Designnotering, inget fynd

Periodiska E66 går till `manual_review`. Mätvärden importeras via admin-åtgärden "Kör UTILTS engine" (`processInboundUtiltsMessage`, `lib/ediel/operationalBridge.ts:180-190`). Den vägen kräver ett inkommande original, så den blockeras också av /4.

## Obekräftade källkandidater

- `lib/billing/invoiceReviewPrepare.ts:454`: fel som inte är av typen `Error` ersätts med texten "Draftfakturan kunde inte skapas.", så grundorsaken döljs. Klass: observability.
- BILLNEG01.05: `InvoiceFileRow` (`lib/billing/invoiceFileExport.ts:30`) har inget fält för originalfakturans referens vid kredit. Inte kört.
- MAIN05.01: filrader byggs från levande kund-, avtals- och anläggningsdata och från dagens datum, inte från den godkända `calculation_snapshot`. Inte kört.

## Harness och miljö (inga produktfel)

- **Signerat avtal:** direkt INSERT av ett signerat avtal nekas av `customer_contract_signed_insert_requires_import_command`. Det är korrekt beteende. Fixturen använder nu produktens avtalsoriginal-intake för masterdatadeklarationen (C3b). Den syntetiska utfärdarnyckeln är en dokumenterad ersättning och verifierar inte verklig utfärdarbehörighet.
- **Prepare:** prepare kräver `gridex_billing_source.underlay_bindings`. Underlag skapade med direkt SQL ger därför `billing_finalized_source_basis_required`, vilket också är korrekt. Den äkta kedjan är byggd: Z03 → nätägarsimulatorns Z04 → UTILTS E66 → inbound-cron.
- **Masterdatakälla för Z03:** basen kräver en signerad masterdatadeklaration för start som inte är innevarande dag. Den byggs i C3b.
- **GreenMail-avbildning:** Docker Hub svarade 429. Jag använde `mirror.gcr.io/greenmail/standalone:2.1.3` (sha256:d6db42a4fc258fec0948b1ae7b579fd06947cc92087c162ec0597972a6c36850).
- **Bygge:** `next build` får slut på minne utan `--max-old-space-size=8192`.
- **Oavsiktlig exponering:** cron-hemligheten skrevs ut i en agentsessions utdata. Den var bara lokal och syntetisk, och den nya miljön genererar en ny.

## Mätning (inget prestandapåstående, n=1)

- Kallt bygge: 345 s. Det första försöket fick slut på minne efter 271 s.
- Replay: cirka 4 minuter.
- Kedjekörningen tog 4255 s. Tiden domineras av väntetiderna i C5 och C7, inte av appens latens. Väntetiderna är nu fail-fast.
