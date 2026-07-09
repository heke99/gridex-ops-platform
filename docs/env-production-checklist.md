# Production Environment Variables — Checklist

Complete inventory from code (grep of `process.env.*`, 2026-07-03). All are
**server-only** unless marked public. Never put secrets in `NEXT_PUBLIC_*`.

## Client-safe (public)

- [ ] `NEXT_PUBLIC_SUPABASE_URL`
- [ ] `NEXT_PUBLIC_SUPABASE_ANON_KEY` (RLS-bound anon key)
- [ ] `NEXT_PUBLIC_SITE_URL` / `NEXT_PUBLIC_APP_URL` / `NEXT_PUBLIC_BASE_URL` — production domain

## Supabase (server)

- [ ] `SUPABASE_SERVICE_ROLE_KEY` — server-only; verified not referenced by any client component

## Cron / internal auth

- [ ] `CRON_SECRET` — Vercel-injected; required for all cron routes
- [ ] Per-route secrets (recommended post-launch hardening, optional at launch):
      `EDIEL_CRON_SECRET`, `EDIEL_INBOUND_CRON_SECRET`,
      `EMAIL_OUTBOX_CRON_SECRET`, `MANUAL_EMAIL_OUTBOX_CRON_SECRET`,
      `MANUAL_INBOUND_CRON_SECRET`, `CUSTOMER_OPERATION_CRON_SECRET`,
      `BILLING_AUTOMATION_CRON_SECRET`, `PRICING_CRON_SECRET`,
      `ANALYTICS_CRON_SECRET`, `EVENTS_CRON_SECRET`,
      `GRID_AREA_IMPORT_CRON_SECRET`, `OPS_HEALTH_CRON_SECRET`,
      `EDIEL_ACTOR_READINESS_CRON_SECRET`, `GRIDEX_CRON_SECRET`
- [ ] `EDIEL_PLATFORM_MAINTENANCE_SECRET` — maintenance endpoints

## Email (Resend + platform senders)

- [ ] `RESEND_API_KEY` — production key (sending fails closed without it)
- [ ] `RESEND_WEBHOOK_SECRET` — Svix signature verification for Resend webhooks
- [ ] `EMAIL_PROVIDER=resend` (default)
- [ ] `RESEND_FROM_EMAIL` / `DEFAULT_FROM_EMAIL` / `PLATFORM_FALLBACK_FROM_EMAIL`
- [ ] `AUTH_EMAIL_FROM` / `AUTH_SMTP_FROM` — auth email sender

## Ediel transport (SMTP/IMAP/S-MIME/Expisoft)

- [ ] `EDIEL_SMTP_HOST` / `EDIEL_SMTP_USER` / `EDIEL_SMTP_PASS`(`WORD`) /
      `EDIEL_SMTP_FROM` / `EDIEL_SMTP_REPLY_TO`
- [ ] `EDIEL_SHARED_MAILBOX_ADDRESS`, `EDIEL_MAIL_DOMAIN`, `EDIEL_MESSAGE_ID_DOMAIN`
- [ ] S/MIME: `EDIEL_SMIME_P12_BASE64` + `EDIEL_SMIME_P12_PASSWORD`,
      `EDIEL_SMIME_DECRYPT_P12_BASE64` + `EDIEL_SMIME_DECRYPT_P12_PASSWORD`,
      `EDIEL_SMIME_PFX_BASE64`, `EDIEL_SMIME_PRIVATE_KEY_PASSWORD`,
      `EDIEL_SMIME_CERT_COMPANY_ID`, `EDIEL_SMIME_CERT_OWNER_EDIEL_ID`,
      `EDIEL_SMIME_CERT_OWNER_SUBADDRESS`
- [ ] Expisoft/LDAP certificate lookup: `EDIEL_EXPISOFT_LDAP_HOST`,
      `EDIEL_EXPISOFT_LDAP_PORT`, `EDIEL_EXPISOFT_LDAP_BASE_DN`,
      `EDIEL_EXPISOFT_LDAP_TIMEOUT_MS`
- [ ] `EDIEL_ACTOR_EDIEL_ID`, `EDIEL_AUTOMATION_ACTOR_USER_ID`,
      `GRIDEX_AUTOMATION_USER_ID`
      — `GRIDEX_AUTOMATION_USER_ID` MUST be the UUID of an existing
      `auth.users` row (a dedicated service/automation account, e.g.
      `automation@<company-domain>`). It is used as `created_by`/actor for
      automatic EDIEL and supplier-switch operations
      (`customer_operation_jobs.created_by` has a foreign key to
      `auth.users(id)`; note that `public.profiles` does not exist in this
      schema). If the value is missing or invalid, automation jobs fail fast
      with the non-retryable configuration blocker `missing_automation_user`
      (`error_class = configuration_error`,
      `required_admin_action = configure_GRIDEX_AUTOMATION_USER_ID`) instead
      of consuming retry attempts. The customer-operations cron also
      validates the value on every run
      (`validateAutomationUserConfig` in `lib/customer-operations/automationConfig.ts`).
      The account should be a platform-admin service account (row in
      `admin_users`/`user_roles`) so `assertUserCanOperateCompany` allows it
      to run automatic operations for every tenant.
- [ ] Environment defaults: `GRIDEX_EDIEL_ENVIRONMENT`,
      `GRIDEX_CUSTOMER_DATA_EDIEL_ENVIRONMENT`, `GRIDEX_MANUAL_OPS_ENVIRONMENT`
      — must be `production` in the production deployment

## Inbound mail polling

- [ ] Mailbox IMAP passwords referenced as `env:` from DB rows —
      `MANUAL_OPS_IMAP_PASS`(`WORD`) and the Ediel mailbox secret refs
- [ ] Tuning (defaults fine): `EDIEL_INBOUND_MAILBOX_POLL_LIMIT`,
      `EDIEL_INBOUND_MESSAGE_LIMIT_PER_MAILBOX`,
      `EDIEL_INBOUND_MAILBOX_CONCURRENCY`, `EDIEL_INBOUND_MESSAGE_CONCURRENCY`,
      `EDIEL_INBOUND_STALE_MAILBOX_LOCK_MINUTES`,
      `EDIEL_INBOUND_MAX_JOB_ATTEMPTS`,
      `MANUAL_INBOUND_MESSAGE_LIMIT_PER_MAILBOX`,
      `MANUAL_INBOUND_STALE_MAILBOX_LOCK_MINUTES`

## Webhooks / website integration

- [ ] `GRIDEX_WEBHOOK_SIGNING_SECRET` (+ `WEBHOOK_SIGNING_SECRET_FALLBACK`)
- [ ] `MANUAL_INBOUND_WEBHOOK_SECRET`
- [ ] `BILLING_WEBHOOK_SECRET_FALLBACK` (per-company billing webhook secrets live in DB)
- [ ] `WEBSITE_OFFER_REFERENCE_SECRET` — **required in production since the
      2026-07-03 hardening** (offer-reference HMAC now fails closed without a
      configured secret; do not rely on the NEXTAUTH/service-role fallback)

## External data providers

- [ ] `PAPILITE_API_KEY` + `PAPILITE_GEOCODE_URL` (postal code → price area)
- [ ] `OPENDATALOADER_API_URL` + `OPENDATALOADER_VERSION` (spot prices)
- [ ] `GRID_OWNER_AGREEMENTS_BUCKET` (storage bucket)

## Emergency flags (must be UNSET/false in production)

- [ ] `MANUAL_EMAIL_ALLOW_EDIEL_SENDER` — unset (emergency override only)

## Verification steps

1. `vercel env ls production` — compare against this list.
2. Confirm no `NEXT_PUBLIC_*` var contains a secret.
3. Confirm `GRIDEX_*_ENVIRONMENT` values are `production`.
4. Deploy preview → hit `/api/internal/system/health` with the cron secret →
   expect green checks.
5. Rotate any secret that was ever pasted into a chat/ticket.
