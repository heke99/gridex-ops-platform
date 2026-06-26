# Manual grid-owner e-mail: transport, Resend webhook and customer-card operations

This document covers the live production fixes for the manual (non-Ediel)
grid-owner communication pipeline.

## Outbound transport (Option 1 — Resend)

The manual pipeline sends business e-mail to grid owners / current suppliers via
**Resend**, not via SMTP.

| Concern | Value |
|---------|-------|
| Sender / reply-to | `leverantorsbyte@gridex.se` |
| Outbound transport | **Resend** (`getEmailProvider()` / `manual_email_outbox` worker) |
| Inbound replies | **Strato IMAP** |

Consequences:

- The IMAP/SMTP settings on `manual_communication_mailboxes` provide the
  inbound mailbox and the sender identity only. They are **not** used to send
  outbound mail.
- Because outbound is sent through Resend, sent mail does **not** appear in the
  Strato "Sent" folder.
- The admin UI must not present SMTP config as if it were used for outbound
  sending.

If SMTP-based outbound is ever required, that is a separate, explicit change
(implement an SMTP provider in `lib/email/providers` and route the worker
through it). Do not leave the behavior ambiguous.

## Resend webhook (`/api/webhooks/resend`)

Verification uses the **raw** request body and the Resend SDK
`webhooks.verify({ payload, headers: { id, timestamp, signature }, webhookSecret })`.
The header shape `{ id, timestamp, signature }` maps to `svix-id`,
`svix-timestamp`, `svix-signature`.

### Safe diagnostics / status codes

| Failure class | HTTP | `code` |
|---------------|------|--------|
| Missing `svix-*` / `webhook-*` headers | 400 | `missing_headers` |
| `RESEND_WEBHOOK_SECRET` not configured | 500 | `missing_secret` |
| Signature mismatch | 401 | `resend_webhook_invalid_signature` |
| Verified event but post-processing failed | 500 | `event_processing_failed` |

A **verified** event never returns 401 because post-processing failed. Events
are stored idempotently in `communication_log_events` (unique on
`provider_event_id`) before status application, and unknown event types are
stored and acknowledged with `ok: true`.

The webhook updates both:

- `communication_logs` (tenant transactional mail), and
- `manual_email_outbox` (manual grid-owner mail) matched by
  `provider_message_id`.

Tracked events: `email.sent`, `email.delivered`, `email.delivery_delayed`,
`email.bounced`, `email.complained`, `email.failed`, `email.suppressed`.

On `bounced` / `failed` / `complained` / `suppressed` the linked
`grid_owner_information_requests` row is moved to `needs_review` with
`last_error_code = delivery_failed`, and the site next action tells the operator
to check the contact path.

### Operational note (the live "Invalid webhook signature")

`{"ok":false,"error":"Invalid webhook signature","code":"resend_webhook_invalid_signature"}`
almost always means the Vercel `RESEND_WEBHOOK_SECRET` does **not** match the
signing secret of the **exact** Resend webhook endpoint
(`https://app.gridex.se/api/webhooks/resend`), or the endpoint was
recreated/disabled and the env is stale.

To fix:

1. In the Resend dashboard, open the webhook endpoint and copy its signing
   secret (starts with `whsec_`).
2. Set `RESEND_WEBHOOK_SECRET` in Vercel **Production** to that exact value.
3. **Redeploy** — Vercel only picks up env changes on a new deployment.
4. Re-enable the endpoint in Resend if it was disabled.

A superadmin diagnostic card surfaces whether the secret is present and the most
recent stored webhook events.
