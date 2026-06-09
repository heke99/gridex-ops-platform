# Batch 8 — Admin Operations UI for Website Onboarding, Webhooks, Tenant Email Verification & Communication Logs

Batch 8 gör Ops-systemet driftbart för externa hemsideintegrationer innan `gridex.se` kopplas in.

## Innehåll

1. Website applications admin UI: `/admin/website-applications` visar ansökningar, kundnummer, source website, external_customer_id, raw payload, error_stage, error_code och error_message.
2. Website Customer Applications hardening: `POST /api/v1/website/customer-applications` accepterar både nested och simplified payload, returnerar 422 vid valideringsfel och loggar felsteg.
3. Customer number visibility: kundnummer visas på kundkort, website application, kommunikationslogg och Capway/billing-spårning.
4. Source website/external_customer_id visibility: kundkortet visar source website, external_customer_id, API-client och senaste website application.
5. Webhook subscription visibility: API-client/webhook subscriptions visas och testevent kan skickas.
6. Webhook delivery logs UI: `/admin/webhooks/deliveries` visar event, destination, status, HTTP-svar, attempts, payload och resend/ignore-actions.
7. Webhook docs: developersidan dokumenterar events, payload, HMAC-signatur, retry, idempotency och Next.js receiver.
8. Tenant email configuration UI: bolagskortet visar sender mode, from email, reply-to, domänstatus, DKIM/SPF/DMARC och fallback.
9. Domain/email verification display: bolagskortet visar om bolagets domän är verifierad eller om fallback sender används.
10. Confirmation/cooling-off mail verification: communication engine triggas av website applications och loggar sender mode/template/delivery.
11. Testmail action: bolagskortet har testmail som använder tenantens effektiva avsändare och loggar i communication_logs.
12. Template preview: bolagskortet visar och hanterar standardmallar för viktiga event.
13. Communication logs on customer card: kundkortets kommunikationsflik visar event, template, from/to, status, sender mode, provider id, kundnummer och external ID.
14. Billing/Capway reference visibility: kundkortet visar provider/debtor-referens från billing_partner_customers.
15. Tenant readiness checklist: bolagskortet visar Website API, API-client, webhook, email sender, domain verification, templates och billing/Capway readiness.
16. Security/audit for actions: webhook resend/ignore/testevent och email actions audit-loggas där befintlig audit_logs finns.
17. Better validation and 422 errors: fel payload ska inte ge generiskt 500.
18. Full idempotency response and safe warnings: idempotent response returnerar customer_number/application_id/customer_id; email/webhook-fel blir warnings och ska inte krascha kundansökan.

## Viktig regel

Ops skickar juridiskt viktiga mail som standard. Externa hemsidor får webhooks och kan visa status, men ska inte skicka dubbla bekräftelse-/ångerrättsmail utan särskild överenskommelse.
