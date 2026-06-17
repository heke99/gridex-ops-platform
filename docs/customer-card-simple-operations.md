# Kundkort – enkelt elbolagsflöde

Den här batchen gör kundkortet mer operativt för elbolag. Standardflödet ska inte kräva att handläggaren förstår interna tekniska begrepp.

## Huvudflöde

Vanlig elbolagsadmin ska primärt använda två knappar:

1. **Begär uppgifter**
2. **Begär leverantörsbyte**

Systemet kontrollerar fullmakt, juridik, anläggnings-ID, mätpunkt, nätägare, kontaktväg, mail och teknisk sändning bakom kulisserna.

## Mailarkitektur

- Kundmail går via `tenant_email_outbox` och Resend.
- Konto-/authmail går via SMTP och `AUTH_SMTP_*`.
- `company_invite` och `password_reset` är konto-mail och ska inte blandas med kundmail.
- Auth-mail loggas i `auth_email_events` utan att reset tokens eller temporära lösenord visas i listvyer.

## Events

Alla operativa huvudsteg ska skapa kund-/tenant-events:

- `customer_data.requested`
- `customer_data.request_sent`
- `customer_data.needs_review`
- `legal_documents.attached_to_request`
- `legal_documents.missing`
- `supplier_switch.blocked`
- `supplier_switch.already_open`
- `supplier_switch.requested`

Portal-bundle läser både `customer_events` och `domain_events`, så tenant/kund kan visa status i Mina sidor.

## Juridiskt underlag

Uppgiftsbegäran och leverantörsbyte ska förbereda juridiskt underlag från:

- signerad fullmakt
- fullmaktsdokument
- kundens juridiska godkännanden
- avtal/snapshot där det finns

Historiska `customer_legal_acceptances` ska aldrig uppdateras.

## UI-princip

Standardvy visar vanlig svenska:

- Fullmakt finns/saknas
- Anläggnings-ID finns/saknas
- Mätpunkt finns/saknas
- Nätägare finns/saknas
- Nästa rekommenderade steg

Tekniska detaljer får bara visas under avancerade/tekniska vyer.
