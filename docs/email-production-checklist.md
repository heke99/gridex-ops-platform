# Email Production Checklist

## Platform level

- [ ] `RESEND_API_KEY` set (production key); `EMAIL_PROVIDER=resend`
- [ ] Platform fallback sender (`PLATFORM_FALLBACK_FROM_EMAIL` /
      `DEFAULT_FROM_EMAIL` / `RESEND_FROM_EMAIL`) uses a verified domain
- [ ] `RESEND_WEBHOOK_SECRET` configured; Resend webhook endpoint
      (`/api/webhooks/...` Resend route) receives delivery/bounce/complaint
      events (Svix signature verified)
- [ ] Auth email sender (`AUTH_EMAIL_FROM`) verified

## Per-tenant (repeat per launching company)

- [ ] `company_email_settings` row exists: sender name, sender email, reply-to,
      support email
- [ ] Resend domain status = `verified` — SPF record present
- [ ] DKIM records published and verified in Resend
- [ ] DMARC policy published for the sending domain (at least `p=none` with
      monitoring; recommended `p=quarantine`)
- [ ] `fallback_allowed` explicitly decided (fallback to platform sender only if
      the tenant accepts it)
- [ ] `block_legal_mail_when_unverified` = true (legal/critical mails must not
      go out via unverified senders)
- [ ] Test email sent from the go-live page and received (headers show correct
      From/Reply-To, DKIM pass)

## Behavior guarantees (verified in code — do not weaken)

- Sender resolution per tenant: `getEffectiveSender`
  (`lib/email/companyEmailSettings.ts`) — verified sender first, explicit
  fallback policy, disabled mode blocks all sends
- No hardcoded test sender in production paths; the Ediel transport address is
  blocked for manual/customer email (`isEdielReservedSender`)
- Duplicate prevention: communication-log idempotency + active-outbox check in
  `sendCompanyEmail`; outbox rows carry unique `provider_idempotency_key`
  forwarded to Resend as `Idempotency-Key`
- Retry: exponential backoff, max 5 attempts (auth emails 1); dead letter to
  `failed`; worker-crash rows become `delivery_uncertain` and are never
  auto-resent (tenant outbox 15 min; manual outbox since 2026-07-03)
- Bounce/complaint handling: Resend webhook updates communication logs and
  manual outbox delivery status (`lib/email/resendWebhookEvents.ts`)

## Monitoring

- [ ] Alert on `tenant_email_outbox.status='failed'` count > 0 (per hour)
- [ ] Alert on rows stuck in `delivery_uncertain` (manual review queue)
- [ ] Watch Resend dashboard bounce/complaint rate the first week
