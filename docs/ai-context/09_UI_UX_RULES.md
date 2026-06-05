# UI and UX Rules

## General UI principle

UI must be simple, professional and production-ready.

Avoid UI text that makes the product feel unfinished:

- test
- demo
- mock
- placeholder
- coming soon
- internal dev language

Exception:

- actual test environment/test suite pages may use test terminology where correct.

## Plain language rule

Tenant users should see normal electricity/business words, not internal technical terms.

Use:

- Kund
- Anläggning
- Mätpunkt
- Nätägare
- Avtal
- Fullmakt
- Leverantörsbyte
- Fakturaunderlag
- Åtgärd krävs
- Period
- Mätvärden
- Förbrukning
- Exportera
- Importhistorik

Avoid showing these terms directly to tenant users unless under advanced details:

- EDIFACT
- UNB
- BGM
- RFF
- NAD
- APERAK
- CONTRL
- UTILTS
- PRODAT
- SMTP
- IMAP
- CMS
- parser id
- validation code

## Tenant admin UI

Regular electricity company admins should have a simple UI with few buttons.

They should not need to understand all technical Ediel internals.

They should be guided by:

- clear status
- next action
- send readiness
- missing configuration warnings
- route/certificate diagnostics when relevant
- readable event logs
- billing/export status
- import status
- missing data explanations

## Superadmin simplicity

Even superadmin UI should be easy to understand.

Superadmin can see advanced diagnostics, but the first view should always show:

- current status
- problem
- impact
- affected tenant
- affected period if relevant
- recommended action
- whether it is safe to send/export/go-live

## Superadmin sidebar sections

Superadmin should have clear sidebar sections for:

- Bolag
- Kunder
- Ediel
- Drift
- Importer
- Fakturaunderlag
- Plattformdebitering
- Prisinställningar
- Audit
- Inställningar

## Electricity company UI principle

Regular electricity company users should not need to understand Ediel details.

Most technical work should happen in the background.

They should use normal business words, for example:

- Kund
- Anläggning
- Mätpunkt
- Nätägare
- Avtal
- Fullmakt
- Leverantörsbyte
- Inflytt
- Utflytt
- Startdatum
- Status
- Bekräftelse
- Fakturaunderlag
- Ärende
- Meddelande
- Åtgärd krävs

## Background automation principle

For normal electricity companies, the system should automatically handle:

- route selection
- Ediel message generation
- acknowledgement handling
- inbound mailbox polling
- decryption when needed
- supplier switch status updates
- meter data requests
- confirmation logging
- billing underlay generation
- audit log creation
- customer communication events where configured

The user should mainly see:

- what happened
- what is missing
- what action is needed
- what is safe to send
- what cannot be sent and why

## Ediel message UI

Message UI should show actual EDIFACT message type from UNH/BGM, not confusing routing family.

Examples:

- show PRODAT Z14
- show CONTRL
- show APERAK
- show UTILTS E66
- show UTILTS_ERR

Do not show confusing combinations such as:

- PRODAT / CONTRL as if CONTRL is a PRODAT business message

## Test flow UI

Test/message chains should be shown clearly.

Example chain:

- Z13 sent
- CONTRL received
- APERAK received
- Z14 received
- CONTRL sent
- APERAK sent

"Ej kopplad" should be replaced with clearer status when the system can infer relation using:

- RFF+LI
- RFF+ACW
- BGM reference
- UNB/UCI
- test case ID
- transaction reference

## Customer card UI

Customer card should be the operational center.

It should show:

- customer details
- agreements
- sites/anläggningar
- metering points
- powers of attorney
- supplier switch status
- grid owner
- communication history
- internal notes
- audit events
- billing/export status
- meter data status
- import/matching status where relevant
- next recommended action

## UI for imports and billing

Tenant UI should use simple labels:

- Ladda upp underlag
- Fakturaunderlag
- Mätvärden
- Förbrukning
- Period
- Klara för fakturering
- Behöver granskas
- Saknar uppgifter
- Exportera
- Importhistorik

Technical details such as parser id, raw payload, internal source mapping and validation code should be placed behind advanced details.
