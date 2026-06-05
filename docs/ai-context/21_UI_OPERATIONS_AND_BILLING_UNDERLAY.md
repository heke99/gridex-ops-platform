# UI, Operations, Statistics, Audit and Billing Underlay

## UI principle

The system must be simple to understand for both superadmins and electricity company users.

The UI must not expose unnecessary technical complexity.

The platform can have advanced backend logic, but the frontend must explain things in plain operational language.

## Superadmin UI principle

Superadmin should be able to understand and operate the system without needing to read raw code or EDIFACT manually.

Superadmin UI should show:

- company/tenant overview
- onboarding status
- Ediel readiness
- route readiness
- certificate readiness
- mailbox status
- failed messages
- unresolved messages
- send blocks
- test progress
- production readiness
- audit trail
- billing/export status
- import status
- platform usage/billing status
- system health

Use clear statuses:

- Ready
- Missing configuration
- Waiting for inbound message
- Ready to send
- Sent
- Blocked
- Needs review
- Failed
- Resolved

Avoid overly technical labels unless in advanced diagnostics.

Bad UI wording:

- ACK family mismatch
- payload family resolver failed
- null relation guard
- route resolver returned undefined

Better UI wording:

- Kvittensen kunde inte skickas eftersom meddelandet inte matchar vald testtyp.
- Mottagarens subadress saknas.
- Krypteringscertifikat saknas för mottagaren.
- Meddelandet behöver granskas innan det kan skickas.
- Systemet kunde inte avgöra vilket bolag meddelandet tillhör.
- Mätvärden saknas för vald period.
- Importfilen innehåller rader som behöver granskas.

## Electricity company UI principle

Regular electricity company users should not need to understand Ediel details.

Most technical work should happen in the background.

They should use normal business words:

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
- Ladda upp underlag
- Mätvärden
- Förbrukning
- Export

## Background automation principle

For normal electricity companies, the system should automatically handle:

- route selection
- Ediel message generation
- acknowledgement handling
- inbound mailbox polling
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
- next recommended action

## Statistics principle

The system should provide useful operational statistics without overwhelming the user.

Superadmin statistics:

- number of tenants
- active tenants
- onboarding status per tenant
- messages sent/received per tenant
- failed messages
- unresolved messages
- blocked sends
- certificate expiry warnings
- mailbox polling health
- route readiness
- production readiness
- billing/export runs
- import runs
- active users per tenant
- platform usage per tenant
- error trends

Electricity company statistics:

- active customers
- new customers this month
- active agreements
- pending supplier switches
- completed supplier switches
- failed or delayed switches
- missing fullmakter
- missing metering point data
- meter data received/missing
- customers ready for billing
- customers blocked from billing
- estimated volume if available
- exported billing periods
- unresolved customer cases

Do not show irrelevant technical noise to tenant users.

## Billing underlay principle

The system should not be full accounting/reskontra in phase 1 unless explicitly requested.

The system should generate billing underlay/export data that can be handed off to an invoicing/accounting partner.

Billing underlay must be traceable, explainable and auditable.

## Billing underlay should include

At minimum, billing underlay should be able to include:

- company_id / tenant
- customer_id
- customer name
- customer type: private/company
- organization number or personal identity reference where allowed
- billing address
- email
- contract/agreement id
- contract type
- campaign/pricing plan
- site/anläggning id
- metering point id/anläggnings-id
- grid area if available
- grid owner
- start date
- end date
- billing period
- meter data period
- consumption kWh
- meter reading source
- meter data status
- BRP/eSett/import source if used
- price model
- fixed monthly fee
- variable fee
- electricity certificate fee if configured
- green electricity fee if configured
- add-on fees
- customer-specific fees
- VAT handling
- discount/campaign adjustment
- total excluding VAT
- VAT amount
- total including VAT
- export run id
- export status
- exported_at
- exported_by
- source references
- validation status
- blocking issues

## Billing underlay validation

Before a customer/site is included in billing underlay, check:

- active customer
- active agreement
- valid start date
- valid metering point
- grid owner known
- price model exists
- billing period selected
- meter data exists or approved estimation rule exists
- no blocking switch status
- no missing fullmakt if required
- no duplicate billing for same customer/site/period
- VAT and fees calculated consistently
- export has audit trail

If validation fails, the UI should show why.

Examples:

- Mätvärden saknas för perioden.
- Avtal saknar prisregel.
- Kunden har inte aktiv anläggning.
- Leverantörsbyte är inte färdigt.
- Perioden har redan exporterats.
- Fullmakt saknas.

## Billing export principle

Billing export should support:

- draft export
- validation before export
- final export
- export history
- export item details
- failed item list
- re-export only when explicitly allowed
- audit log for who exported what and when

Export formats may include:

- CSV
- Excel
- JSON/API handoff
- partner-specific export format

Do not silently overwrite previous billing exports.

## Audit principle

Important actions must be auditable.

Audit log should answer:

- who did it
- what changed
- when it changed
- which tenant/company it belongs to
- before value
- after value
- source: user/system/cron/import/API
- related customer
- related site
- related metering point
- related Ediel message
- related supplier switch
- related billing export
- related import batch
- related platform usage report
- related route/profile/certificate if technical

## Audit events to track

Track audit for:

- company created/updated
- user invited/role changed
- customer created/updated
- site created/updated
- metering point created/updated
- power of attorney created/signed/expired
- supplier switch created/status changed
- Ediel message imported
- Ediel message parsed
- Ediel ACK generated
- Ediel message sent
- Ediel send blocked
- Ediel route changed
- certificate added/changed/deactivated
- mailbox polling run
- unresolved message assigned/resolved
- file uploaded
- import parsed/failed
- billing underlay generated
- billing export created/finalized
- platform usage event created
- platform price changed
- platform billing report generated/finalized
- manual override
- production go-live status changed

## Manual override audit

Any manual override must require:

- user
- reason
- what was overridden
- affected record
- timestamp
- risk note where relevant

Do not allow silent manual overrides for:

- tenant routing
- encryption readiness
- send readiness
- billing export finalization
- production route activation
- platform billing finalization

## UI for billing underlay

For tenant users, billing UI should use normal words:

- Fakturaunderlag
- Period
- Klara för fakturering
- Saknar mätvärden
- Saknar prisregel
- Redan exporterad
- Exportera underlag
- Visa detaljer
- Ladda ner CSV/Excel

For superadmin, advanced details may include:

- export run id
- validation codes
- source table references
- API handoff status
- partner integration status

## Cursor rule

When building UI, statistics, audit or billing underlay:

1. Search for existing tables/views/actions first.
2. Do not create duplicate billing/export logic.
3. Keep tenant isolation strict.
4. Make UI language simple.
5. Keep technical details behind expandable diagnostics.
6. Add audit for important changes.
7. Add validation before export/send.
8. Avoid silent fallback.
9. Update changelog and context.
