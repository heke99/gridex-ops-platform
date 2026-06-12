# Batch 8 email/template hotfix — punkter och krav

## Fel som hittades i live-testet

1. Simple payload skapade kund, anläggning och mätpunkt, men skickade två mail för samma händelse.
2. Det korrekta mailet använde `contract.application_received`, men en gammal legacy-regel skickade även `contract_confirmation`.
3. Gamla legacy-regler i `email_event_rules` kunde därför skapa dubbla kundmail.
4. Nested payload skapade anläggning och mätpunkt men föll i `contract_create` med `internal_error`.
5. Negativt test utan mätpunkt kunde hinna skapa en `customer_site` innan flödet stoppades.
6. Gamla historiska loggar saknade metadata/snapshot och visade `no-reply@gridex.se`, men nya loggar ska ha `support@gridex.se`, `sender_snapshot`, `template_snapshot` och `rendered_snapshot`.

## Fixpunkter som ska gälla

1. Endast de sex scoped kundmailen ska vara aktiva nu:
   - `contract.application_received`
   - `switch.started`
   - `switch.confirmed`
   - `switch.action_required`
   - `customer.welcome_active`
2. Legacy keys som `contract_confirmation`, `cancellation_right` och gamla `cooling_off`-regler ska inte kunna skicka kundmail i detta scope.
3. `triggerEmailEvent` ska normalisera gamla eventnamn men bara tillåta canonical template per event.
4. Varje utskick ska vara idempotent så samma application/event inte skickar dubbelt.
5. Varje utskick ska skapa `communication_logs` med snapshot:
   - `sender_snapshot`
   - `template_snapshot`
   - `rendered_snapshot`
   - `idempotency_key`
   - `application_id`
   - `external_customer_id`
   - `customer_number`
6. `company_email_settings.sender_name` ska användas som bolagsnamn i kundmail före `companies.name`, så Gridex AB inte råkar visas som Div3rsa AB när bolagets e-postidentitet säger Gridex AB.
7. `support_email` ska hämtas från `company_email_settings.support_email` eller `reply_to_email` före bolagets fallback-kontakt.
8. `customer_name` ska hämtas från kunden:
   - `full_name` om den finns
   - annars `company_name`
   - annars namn från payload (`first_name + last_name`)
   - annars e-post/kundnummer som sista fallback
9. Mallarna får använda dessa kundtokens:
   - `{{customer_name}}`
   - `{{first_name}}`
   - `{{last_name}}`
   - `{{customer_email}}`
   - `{{customer_phone}}`
   - `{{customer_number}}`
10. Mallar ska inte vara hårdkodade i utskicksflödet. Utskicksflödet ska alltid läsa aktiv mall från `company_email_templates` vid sändning.
11. Kodens standardmallar är bara fallback/seed-värden. När admin ändrar mall i bolagskortet ska nästa utskick använda den sparade DB-raden.
12. `seedDefaultEmailTemplates` får inte skriva över bolagets egna malländringar.
13. Mallens exakta version vid utskick ska sparas i `communication_logs.metadata.template_snapshot`, så historiska mail inte ändras retroaktivt när mallen ändras senare.
14. Kundkortet ska visa vad som faktiskt skickades; bolagskortet ska vara platsen där globala bolagsmallar redigeras.
15. Simple payload ska skapa kund, `customer_site`, `metering_point`, application och ett mail.
16. Nested payload ska skapa kund, `customer_site`, `metering_point`, contract/application och ett mail.
17. Invalid payload med anläggningsadress men utan mätpunkt/facility-id ska stoppas med 422 innan partial writes.
18. Om contract insert misslyckas på full payload ska systemet försöka safe fallback och annars visa riktig DB-orsak i `contract_create_failed`.

## Testkrav efter deploy

1. Simple payload ska ge 200 och exakt ett nytt mail med `template_key = contract.application_received`.
2. Nested payload ska ge 200 och helst `contract_id`.
3. Invalid payload utan mätpunkt ska ge 422 och får inte skapa ny `customer_site` med `facility_id = null`.
4. Senaste `communication_logs` ska visa `sender_email = support@gridex.se` och `sender_mode = verified_domain` för Gridex.
5. Om man ändrar ämne/body i `company_email_templates` via bolagskortet ska nästa testansökan använda den nya texten i `rendered_snapshot`.
