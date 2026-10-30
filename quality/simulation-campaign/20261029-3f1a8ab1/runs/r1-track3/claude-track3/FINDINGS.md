# Spår 3 (Ediel) – fynd

Kampanj `20261029-3f1a8ab1`, arbetare `claude-track3` (session `session_01UHTg8HpSnonnkjvfURN8ww`).
Appcommit och baslinje `1c0c088cb4ed66d0dd8b3e34c9606019342a1a56`; overlay endast `scripts/simulation/track3/**`
(gren `claude/sim-20261029-track3`). Miljö `t3-vm-20261029`: lokal Supabase (CLI 2.101.0, PG 17.6,
system_identifier 7702183760217968679), Node 22.22.0, egen loopback-CA, lokal SMTP/IMAP-motpart. Ingen extern trafik.
Schemafingeravtryck (delidentitet) `5168f69b67b1e45168ef327ecf92efec6dc7bcd9dc2cf66f48f4ea96527c782c`; inga
tillagda migrationer (`applied-migrations.tsv` tom) fram till 2026-10-30T14:44Z; därefter är migration
`20261030130400` (PR #949@49a60a1e, fynd 005) applicerad i stacken som "väntar GEN-fångst" – körningar efter det ger högst PARTIAL.

| Fynd | Kategori / allvar | Scenario-ID | Status |
|---|---|---|---|
| 001 | produktfel / kritisk | EDIEL01.01, EDIEL02.* (inbound) | rättat, mergad till main (PR #942, 6454d540); omtest efter ny bas; dubblett: track4/3 |
| 002 | produktfel / hög | EDIEL01.01, EDIEL02.* (inbound) | rättat-väntar-omtest (PR #943) |
| 003 | schema/kod-avvikelse / medel | EDIEL01.* (inbound-poll) | styrkt; väntar beslut väg (a)/(b) |
| 004 | produktfel / hög | EDIEL01.01, EDIEL02.06 | rättat-väntar-omtest (PR #945); inkl. track4/2 |
| 005 | prestanda → fel utfall / hög | EDIEL02.*, EDIEL03.03, EDIEL03.04, EDIEL01.01–.03 (N=28) | rättat-väntar-GEN (PR #949, två APPROVE) |
| 006 | produktfel (observerat mot orakel) | EDIEL03.01, EDIEL03.02 | observerat i officiell körning; EDIEL03.02 = FAIL; grundorsak ej styrkt |
| 007 | obekräftad kandidat | EDIEL03.04 | observerat, ej styrkt |
| 008 | produktfel / hög | EDIEL01.01, EDIEL02.* | observerat i officiella körningar; = T4 track4/4, ägs av T3 (rättning efter #945) |
| 009 | obekräftad kandidat | EDIEL02.06 | observerat (finns på main), ej styrkt |
| 010 | testharness/miljö-kandidat | – (CI på PR #942) | omkörning pågår |
| 011 | obekräftad kandidat | EDIEL03.03 | kodläsning, ej styrkt |
| 012 | obekräftad kandidat | EDIEL01/02 (inbound) | observerat, ej styrkt |
| 013 | avfärdat (avsiktlig deadline-logik) | EDIEL01.06 | se nedan |
| 014 | produktfel (säkerhet) / medel | EDIEL01.04 | observerat i officiell körning; EDIEL01.04 = FAIL |
| 015 | ej fel (observation) | EDIEL01.05 | – |
| 016 | produktfel mot orakel / hög | EDIEL02.02 | observerat i officiell körning |
| 017 | produktfel / hög (latent) | EDIEL02.03 | rättas (migration 20261030130900, GEN-kö 13); prod: 0 påverkade rader |
| 018 | produktfel mot orakel / medel | EDIEL02.05 | observerat i officiell körning |
| 019 | produktfel mot orakel / medel | EDIEL02.06 | 06a3 bekräftad |
| 020 | ej fel (beslut) | EDIEL02.06 | manual_review synligt för operatör; stängt |

## 20261029-3f1a8ab1/claude-track3/001 – IMAP-pollern kör kommandon inne i öppen FETCH
- 2026-10-29, produktfel, kritisk. `lib/inbound-mail/edielMailboxPoller.part-2.ts:425,430,447`: `messageFlagsAdd`
  inne i `for await (client.fetch(...))`; ImapFlow förbjuder IMAP-kommandon under öppen FETCH (klientdeadlock).
- Observerat (GreenMail, 3 olästa): i-loop → 1 bearbetat på 30 077 ms, "Connection not available", unseen [1,2,3];
  insamling först → 3 bearbetade på 222 ms. Cron-vägen (markSeen) svälter efterföljande meddelanden permanent.
- Rättning: PR #942 (`claude/t3-fix-001-imap-fetch-backpressure`), regressionstest
  `__tests__/ediel-mailbox-poller-fetch-backpressure.test.ts` faller före/går igenom efter; `client.on("error")`
  adopterat från donor `7b0ccaad`. Två oberoende granskningar APPROVE. Omtest i T3-stacken återstår efter merge.

## …/002 – inbound-cron skickar ingen aktör
- 2026-10-29, produktfel, hög. `app/api/internal/inbound-mail/cron/route.ts:65-71` → `inboundStatusUpdater.ts:327`
  `ediel_real_reception_actor_and_parse_required`; inga inkommande slutförs av schemalagd motor.
- Observerat: rökprov, inline E66 via HTTP-cron → jobbfel ovan.
- Rättning: PR #943 (aktör via `resolveConfiguredEdielAutomationActorId()`, 503 om saknas). Två APPROVE.

## …/003 – koden skriver kolumn som saknas i kanoniskt schema
- 2026-10-29, medel. `edielMailboxPoller.part-1.ts:1010` skriver `ediel_mailboxes.last_successful_poll_at`; kolumnen
  saknas i `supabase/schema.sql` (tabellen ~rad 121687) och i replayen → PGRST204, lyckad poll registreras som fel.
- Beslut (samordningen): väg (b) `last_polled_at` endast om ingen läsare kräver "senast lyckad", annars (a) migration.
  Fjärrproduktionens schema ej verifierat.

## …/004 – bilagans EDIFACT parsas två gånger; frisläppt avslutande mellanslag trimmas
- 2026-10-29/30, produktfel, hög. `edielInboundProcessor.ts:187-191` konkatenerar `raw_edifact_payload` och samma
  bilagetext → 2 interchanges (med UNA `edifact_dangling_release_character`, utan UNA 2×UNB).
  `lib/ediel/core/edifactTokenizer.ts` `source.trim()` tar bort frisläppt mellanslag (`FTX+AAA+++ABC? '`).
- Rättning: PR #945. Regressionstest 10/10; två APPROVE.

## …/005 – CONTRL-ack-vägarna växer kvadratiskt per bolag
- 2026-10-30, prestanda som ger fel utfall (57014, ingen ACK skapas), hög.
- Rotorsak: `read_outbound_originals_v1` anropar `retained_source_v1` per utgående CONTRL
  (`20261001134600_…private_chain_and_phase.sql:57`); `retained_source_v1` parsar varje ready-källa; prefiltrets
  `'?'`-reserv (`20261019043000_…prefilter.sql:11-14`) är verkningslös. Kostnad ≈ A×S×0,8 ms; `create_v1` håller
  SHARE-lås på `ediel_messages` under tiden.
- Mätt (bolag 37 CONTRL / 128 källor): ett `retained_source_v1` 151 ms; `read_outbound_originals_v1` CONTRL 3,99 s,
  APERAK 7,6 ms; 75 anrop → 9 151 `envelope`-anrop. Scenariernas seed-fas: 20,7–20,9 s → 57014.
- Detaljer: PR930 6523175345. Rättning (förslag b, version 20261030130400) förbereds lokalt; skrivs först efter beslut.

## …/006 – explicit SMTP 4xx/5xx efter "enter" klassas delivery_uncertain (kandidat)
- `lib/ediel/transport/outboundAttempt.ts` `fail()` ~rad 106 lindar 4xx/5xx i `SmtpDeliveryUncertainError`, trots att
  `smtpOutcome.ts isSmtpDeliveryUncertain` anger explicit negativt som säkert. Observerat i EDIEL03.01/.02: försöksklass
  `explicit_negative`, outbox `delivery_uncertain`, ingen retry/väntan, inget operatörsfall/task/dead-letter.

## …/007 – stale-svepet lämnar inget operatörsspår (kandidat)
- SQL `claim_ediel_outbox_items` sätter `delivery_uncertain` / `stale_sending_lock_requires_transport_reconciliation`
  utan meddelandeevent eller reconciliation-case.

## …/008 – delad brevlåda skapar aldrig `ediel_messages` (kandidat)
- Trigger i `supabase/migrations/20261002234100_ediel_messages_inbound_email_link.sql:24-33` kräver samma `company_id`;
  delad brevlåda lagrar mejlet med NULL och `updateInboundEmailProcessingStatus` sätter bolaget först efteråt →
  `ediel_message_inbound_email_tenant_mismatch`. Observerat i EDIEL01/02-probekörningar.

## …/009 – blanktecken före inledande UNA ger dangling release (kandidat)
- Påvisat av granskare av PR #945; finns redan på origin/main. Ingen regression.

## …/010 – `scripts/ediel-tr-10-reconciliation-native.test.ts` föll i CI (kandidat, testharness/miljö)
- PR #942 head 7f77cb62: `P0001 supply_rescission_current_mandate_required` nära midnatt Stockholm; main grön.
  En omkörning (ny head 9533b648) avgör: passerar → eget fynd om datumberoende test; fallerar → verkligt fel.

## …/011 – inga SMTP-timeouts (kandidat)
- `lib/email/sendEdielEmail.ts:62` sätter inga timeouts (nodemailers standard 2 min/30 s/10 min).

## …/012 – pollern tappar feltext (kandidat)
- `autoProcessErrors` rapporterar "Okänt fel" i stället för PostgREST-felet.

## …/013 – äldre outbound_requests-rad ändras av kedjan
- 2026-10-30. EDIEL01.06: en seedad äldre `outbound_requests`-rad med status `sent` utan kvittens får `waiting_attention`
  och `failure_reason` "Ediel-kvittens saknas" (radhash före/efter olika) när motorn kör. Observerat i körningarna
  20261030T144355Z-6ab491 (bas, N=2) och 20261030T144535Z-8b8258 (N=28). Designoraklet kräver oförändrade äldre köposter.
  AVFÄRDAT efter oberoende granskning: `checkAckDeadlines` flyttar avsiktligt en skickad begäran utan kvittens efter
  deadline till `waiting_attention`; Ediel-kedjans äldre poster var oförändrade. Raden var seedad med rå SQL.

## …/014 – IMAP kan köras i klartext
- `lib/inbound-mail/edielMailboxPoller.part-2.ts:358`: `imap_secure=false` tillåts på valfri port utom 993 utan krav på
  STARTTLS. Observerat i körning 20261030T144355Z-6ab491: pollern loggade in och hämtade i klartext (fetched 1, stored 1).
  Strider mot EDIEL01.04 "strikt TLS". Produktionsbanan ej prövad.

## …/015 – provider_result.messageId skiljer sig från Message-ID-huvudet (ej fel)
- Observerat i EDIEL01.05: `provider_result.messageId` ≠ trådens Message-ID; `binding.rfcMessageId` stämmer med huvudet.

## …/016 – samma referens med ändrat innehåll ger inget synligt skydd
- 2026-10-30, körning 20261030T150551Z-660435 (tenant 16724, med ej mergad migration 005 i stacken). Ett mejl med samma
  UNB-referens men ändrat innehåll (nytt Message-ID) blir `manual_review` utan `identity_conflict`, svarsbegäran eller
  hold-task; originalets mätvärden orörda. Byggarens tidigare körning såg i stället tyst dedupe (`stored 0, deduped 2`) via
  `findExistingInboundEmail` (sender+interchange_ref). Grundorsak ej styrkt.

## …/017 – avvisad rättelse flyttar seriehuvudet
- 2026-10-30, körning 20261030T150650Z-339ec7. En ogiltig rättelse (samma uppdateringsdatum, annan mängd) avvisas korrekt
  med `utilts_consumption_correction_not_newer`, men seriehuvudet pekar efteråt på den avvisade versionen (700) medan
  gällande mätvärde är 600. Persistensen gör detta avsiktligt (`20261003150200:38`, `not v_late_older`); ingen app-läsare av
  `is_current` hittad. Efter granskning: kandidat/tolkningsfråga, EDIEL02.03 = PARTIAL.
- 2026-10-30 uppdatering: SC023 `gridex_vh_history.coverage_v1` (`20261012212000:121`) bygger VH-historik ur is_current-serien
  → skulle skicka 700 (avvisad rättelse) med giltigt VH-kvitto; SC046-persist och consume_v1 påverkas också. Allvar höjd till
  hög (latent). Beslut: (B)+(C), migration 20261030130900. Produktionskvitto (samordningen, read-only, SQL sha256
  09eb9efca942699167efdf09f234a9b739346871b5bca359a27fa0edff370afc): fråga 1 = 0 rader, meter_reading_series totalt 0,
  gridex_vh_history.deliveries 0 → inga felaktiga VH-data kan ha skickats; ingen retroaktiv åtgärd.

## …/018 – E10-nekande för främmande mätpunkt skickas inte
- 2026-10-30, körning 20261030T150744Z-11cdbd. UTILTS ERR med E10 på TN skapas men ligger kvar som `draft` och når aldrig
  outbox/DSO. Ingen affärseffekt (nekandet håller); positiv teknisk CONTRL skickas. Om ERR kräver separat sändning är oklart.

## …/019 – meddelande med giltig UNB men utan BGM får inget felkvitto
- 2026-10-30, körning 20261030T150817Z-603e4b. 06a3 (BGM saknas) ger varken CONTRL eller UTILTS_ERR; bara `manual_review`.

## …/020 – meddelanden utan tolkbar UNB (06c1 ren text, 06c2 trasig multipart) → manual_review (ej fel)
- Efter granskning: utan UNB finns inget att kvittera mot enligt EDIFACT/Ediel; manual_review bedöms rimligt.
- Beslut (A) 2026-10-30: ingen kvittens; verifierat att manual_review syns för operatör (admin/inbound-mail räknare och
  detaljsida med öppen granskning). Stängt som ej fel. Felaktiga segment och UNOC-brott (06a1/a2/b1/b2) ger
  korrekt negativ CONTRL (UCI 4) som mottas hos DSO.

## Miljöhändelser
- Containeromstarter ~2026-10-30T11:5xZ och ~14:3xZ (app ombyggd 14:38–14:42Z på e65a6721); dockerd och stack återstartade 12:09–12:12Z; databasidentitet oförändrad.
- `next build` dödades två gånger (OOM) när andra agenter körde typkontroll parallellt; lyckades med 4 GB heap 12:12Z.
- `ALTER ROLE authenticator SET jit=off` sattes under felsökning och återställdes (`RESET jit`) före officiella körningar.
- ECR gav "Data limit exceeded"; Supabase-images från Docker Hub med samma taggar. Replayens `supabase stop` neutraliserad
  med lokal PATH-shim (ingen repofil ändrad).

## Ersättningssteg (verifierar inte)
- Inbound via aktörsvägen in-process (`runInboundEdielMailEngine({actorUserId})`) i stället för HTTP-cron (002) –
  verifierar inte schemalagd HTTP-väg.
- Företagsägd brevlåda i stället för delad (008) – verifierar inte delad brevlåda.
- Egna små tenants per scenariogrupp (16701/16703) för att undvika 005 – verifierar inte realistisk volym.
- `checkAckDeadlines({now})` in-process med kontrollerad klocka (EDIEL03.05) – verifierar inte cron-routen
  `app/api/internal/customer-operations/cron/route.ts` (tar inte `now`; harnessens env saknar dess hemlighet).
- Syntetisk historikgrund (`seedUtiltsIssuerHistoryGround`) för UTILTS E66.
- Designens "befintliga 28" och "äldre 105" (Root-data) ersätts av syntetisk fixture.

## Ursprung för kopierad kod
- `counterparty/mail-counterparty.mjs`: omskrivning efter `1c0c088c:scripts/ediel-ops04-controlled-send-native.test.ts`
  (`startLoopbackSmtp`, rad 926–1051).
- `lib/edifact.ts`: E66-layout från `1c0c088c:__tests__/helpers/utiltsObservationHandoff.ts`.
- `lib/seed.mjs`: mönster från `1c0c088c:scripts/helpers/ediel-h05h08-normal-switch-native-fixture.ts` och
  `ediel-decision-original-native-fixture.ts`.
- `lib/inprocess.ts`: anropsform från `1c0c088c:app/admin/inbound-mail/actions.ts` rad 75–91.
- `lib/e03-*`: `expireLease` efter `1c0c088c:scripts/ediel-tr-05-recovery-native.test.ts` (`expireDeclaredWorkerLease`).
- Inget kopierat från `scripts/reality` på `claude/gifted-hamilton-vss1hj`.
