# Batch 8 email/webhook/core hotfix – testfynd och fix

## Testfynd 2026-06-10

### 1. Domän och sender blev gröna

`company_email_settings` visade korrekt produktionsstatus:

- `sender_email = support@gridex.se`
- `reply_to_email = support@gridex.se`
- `sender_mode = verified_domain`
- `verification_status = verified`
- `readiness_status = ready`
- `provider_domain_id` sattes från Resend

Det betyder att Resend-/DNS-delen fungerar efter att API-nyckeln fick rätt domain-behörighet.

### 2. Simple payload skapade kärnobjekt korrekt

Simple payload returnerade HTTP 200 och skapade:

- customer
- customer_site
- metering_point
- website_customer_application
- communication_log
- mail via Resend

Det tidigare Batch 8.1-felet där simple payload inte skapade site/mätpunkt är därmed i huvudsak löst.

### 3. Gammal mailregel skickade fortfarande dubbelt mail

Samma onboarding-event skickade två mail:

- korrekt nytt mail med `template_key = contract.application_received`
- fel legacy-mail med `template_key = contract_confirmation`

Orsak: gamla `email_event_rules`-rader från tidigare migration låg kvar aktiva i DB. Kodens default-regler hade uppdaterats, men gamla aktiva rules filtrerades inte bort.

Fix:

- `triggerEmailEvent` tillåter nu bara canonical template per event.
- legacy-templates som `contract_confirmation` och `cancellation_right` blockeras från automatiska eventutskick.
- ny SQL-migration stänger av gamla legacy-regler i DB och säkerställer de sex tillåtna standardreglerna.

### 4. Nested payload föll på `contract_create`

Nested payload skapade site och metering point, men API returnerade HTTP 500 vid contract-create.

Orsak: `customer_contracts`-insert var för känslig mot live-schema-/constraint-skillnader. Vid ett DB-fel kastades felet direkt i stället för att försöka en säker minimal fallback.

Fix:

- `createContract` försöker först komplett contract payload.
- Om live DB stoppar full payload körs säker fallback med mindre kolumnset.
- Om även fallback misslyckas returneras nu tydligare `contract_create_failed` med faktisk DB-orsak.

### 5. Negativt test skapade partial site innan stopp

Invalid payload utan mätpunkt returnerade fel, men en `customer_site` skapades först med `facility_id = null`.

Orsak: valideringen kördes efter customer/site-create.

Fix:

- API validerar nu tidigt att elansökan med anläggningsadress också har `metering_point_id`/`facility_id`.
- Ofullständig payload stoppas med 422 innan customer/site/metering writes.

## Efter hotfix ska testresultatet vara

### Simple payload

- HTTP 200/201
- customer_site skapad
- metering_point skapad
- exakt ett mail: `contract.application_received`
- sender: `support@gridex.se`

### Nested payload

- HTTP 200/201
- customer_site skapad
- metering_point skapad
- contract skapad eller säker fallback skapad
- exakt ett mail: `contract.application_received`

### Invalid payload utan mätpunkt

- HTTP 422
- ingen ny `customer_site` med `facility_id = null`
- inget customer/application-success-svar

## Viktigt efter test

Revoka API-token som användes i chatten och skapa en ny token för fortsatt test/produktion.
