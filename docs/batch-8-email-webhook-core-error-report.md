# Batch 8 mail/webhook/core — felrapport och åtgärder

Datum: 2026-06-10
Scope: A–L enligt stabiliseringslistan för Gridex tenant-mail, Resend, mallar, webhooks och Batch 8.1 customer application core.

## Fel vi hade

### 1. Resend-felet i UI var för generiskt
UI kunde visa `Resend kunde inte slutföra åtgärden. Kontrollera e-postinställningarna och försök igen.` utan att admin fick veta om felet berodde på saknad API-nyckel, saknad Resend-domän, DNS pending, enable sending, eller ett faktiskt Resend API-fel.

**Fix:** provider-felet normaliseras nu tydligare, testmail sparar exakt felorsak i `communication_logs.error_message`, och actionen skickar tillbaka samma fel till UI i stället för att dölja root cause.

### 2. `provider_domain_id` var för känslig som enda lookup
Om `provider_domain_id` saknades eller var gammalt kunde kontrollflödet fastna även om domänen fanns hos Resend.

**Fix:** verifieringsflödet försöker först med `provider_domain_id`, men faller tillbaka till domännamnet, t.ex. `gridex.se`. Om domänen hittas sparas provider-id tillbaka i `company_email_settings`.

### 3. DNS/readiness-status var inte komplett för tenant-mail
Systemet behövde tydligare stöd för root SPF/DMARC och send-subdomän/DKIM-poster som varje elbolag ska lägga in.

**Fix:** verifieringsflödet kompletterar DNS-listan med obligatoriska Gridex-poster för SPF och DMARC och sparar readiness-status, DNS-status och sender mode mer konsekvent.

### 4. Juridiska/kritiska kundmail kunde gå via fel läge
Det fanns inte tillräckligt tydlig enforcement för att stoppa kritiska kundmail när bolagets domän inte är verifierad och blockering är aktiv.

**Fix:** sender resolver kan nu köras med `legalOrCritical`. Om bolaget har `block_legal_mail_when_unverified` och domänen inte är verifierad stoppas utskicket innan Resend.

### 5. Mallscope var för brett och gamla nycklar levde kvar
Systemet hade äldre mallnycklar som `contract.confirmation_sent`, `contract.cooling_off_sent`, `supplier_switch_started` osv. Det riskerade att fel mall eller fler mail än önskat skickades.

**Fix:** standardmallarna är nu begränsade till exakt sex nycklar:

- `contract.application_received`
- `switch.started`
- `switch.confirmed`
- `switch.action_required`
- `customer.welcome_active`

Gamla eventnycklar mappas till rätt nya nycklar där de fortfarande kan förekomma i äldre kodvägar.

### 6. Mallar saknade robust system-default fallback
Om DB-rader saknades kunde ett utskick falla på saknad mall även om standardmallen fanns i kod.

**Fix:** template resolver returnerar nu system-default från Gridex-koden om aktiv bolagsmall saknas. Bolagets egna templates fortsätter att vinna när de finns.

### 7. Send engine saknade tillräcklig snapshot och idempotency
Utskick behövde kunna granskas i efterhand: exakt mall, rendered subject/body, sender, mode och event-id. Det behövdes också skydd mot dubletter för samma event.

**Fix:** `sendCompanyEmail` sparar `template_snapshot`, `sender_snapshot`, `rendered_snapshot`, `idempotency_key` och metadata i `communication_logs`. Finns en tidigare queued/sent/delivered log för samma idempotency key skickas inte mailet igen.

### 8. Resend webhook saknade komplett statusmodell
Webhookspåret behövde hantera statusarna sent/delivered/failed/bounced/complained och lagra raw payload utan att krascha onboarding.

**Fix:** `/api/webhooks/resend` verifierar Svix/Resend-signatur, deduperar på provider event id, matchar `provider_message_id`, sparar raw payload i `communication_log_events` och uppdaterar communication log till `delivered`, `failed`, `bounced` eller `complained`.

### 9. External webhooks behövde stabil outbox/retry-grund
Gridex externa webhookar behövde koppling från domain_events till webhook_deliveries med signering, retry/backoff och dead-letter.

**Fix:** befintlig webhook-grund används och stärks via domain-event enqueue. Kund-/contract-events från onboarding kan nu köas vidare till aktiva `webhook_subscriptions`.

### 10. Simple payload kunde missa `customer_site`
En förenklad website-payload kunde innehålla site-/adress-/anläggningsdata i camelCase eller top-level form som inte alltid normaliserades till `site`.

**Fix:** normaliseringen stödjer nu fler top-level och camelCase-fält: `facilityId`, `siteFacilityId`, `addressLine1`, `streetAddress`, `postalCode`, `priceAreaCode`, `moveInDate`, `annualConsumptionKwh` m.fl.

### 11. Simple payload kunde missa `metering_point`
Mätpunktsfält kunde komma som `meteringPointId`, `meterPointId`, `edielMeteringPointId`, `anlage_id` eller annan top-level form och ändå inte skapa mätpunkt korrekt.

**Fix:** normaliseringen mappar dessa till `metering_point`, och om bara mätpunkts-id finns används det även som site/facility-koppling så både site och metering point kan skapas.

### 12. API kunde returnera 200 trots ofullständig application
Det var produktionsfarligt att returnera success om requesten innehöll anläggnings-/mätpunktsdata men core-create inte skapade site eller metering point.

**Fix:** om payload förväntar site/mätpunkt och någon av dem saknas stoppas flödet med `incomplete_application`, application loggas som `failed`, och API returnerar fel i stället för en falsk 200-success.

### 13. Status kunde bli `customer_created` fast flödet egentligen var ofullständigt
Det gjorde att read endpoint senare kunde visa tomt eller ge intryck av att onboarding var klar trots saknad anläggning/mätpunkt.

**Fix:** när site och metering point finns sätts status till `application_received`. Om payload krävde dessa men de inte skapades stoppas flödet helt.

### 14. Onboarding skickade fel/extra event
Onboarding kunde trigga äldre/legal cooling-off-event i samma flöde, trots att scope nu endast ska vara ansökan mottagen.

**Fix:** website onboarding triggar nu endast `contract.application_received` och använder idempotency key per application.

## Kontroller körda

- `npm install --ignore-scripts --no-audit --no-fund` — klart.
- Riktad ESLint på ändrade TS/TSX-filer — grönt.
- Riktad TypeScript-kontroll på ändrade TS/TSX-filer via temporär tsconfig — grönt.
- `npm run gridex:batch-8-1-live-schema-regression` — grönt.
- Full `npm run typecheck` startade men hann inte klart i denna miljö innan timeout. Inga TypeScript-fel skrevs ut innan timeout.
- Full `npm run build` hann tidigare inte klart i denna miljö innan timeout efter Next build-start. Inga buildfel skrevs ut innan timeout.

## Viktigt efter deploy

1. Kör migrationen `20260610100000_email_identity_templates_webhook_stabilization.sql` i Supabase.
2. Sätt `RESEND_API_KEY`, `RESEND_WEBHOOK_SECRET`, `DEFAULT_FROM_EMAIL`, `DEFAULT_FROM_NAME` och `DEFAULT_REPLY_TO` i produktion.
3. Öppna bolagskortet för Gridex och kör domänkontroll tills readiness blir `ready` och sender mode blir `verified_domain`.
4. Skicka testmail från bolagskortet.
5. Kör live-test med simple payload och nested payload.
6. Kontrollera att `communication_logs` får `template_snapshot`, `sender_snapshot`, `provider_message_id` och rätt status.
7. Kontrollera Resend webhook genom att invänta delivered/bounced/failed event.
