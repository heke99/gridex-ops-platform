# Local Elklart email boundary

This isolated adapter implements the installed Resend SDK's HTTP protocol. Production provider code remains unchanged. OPS uses `RESEND_BASE_URL=https://localhost:38481`, its generated private `RESEND_API_KEY`, and the local TLS CA through `NODE_EXTRA_CA_CERTS`. Never disable TLS verification.

Start with `node scripts/demo/elklart-resend-provider.mjs`. It binds only `127.0.0.1:38481`. Files below `/workspace/elklart-runtime` must have the current process owner and private permissions:

- `tls/server-key.pem` and `tls/server.pem`: mode 0600.
- `provider-mail/`: mode 0700.
- `provider-mail/api-key`: mode 0600; independently generated random key of at least 32 characters, using letters, numbers, `_` or `-`. Do not put it in chat, source, command arguments, or logs.

The installed SDK supports `RESEND_BASE_URL` natively and sends these requests:

| Request | Response |
| --- | --- |
| `GET /domains` | `{object:"list", has_more:false, data:[...]}` |
| `POST /domains` with `{name:"elklart.example.invalid"}` | Domain with simulated DNS records |
| `GET /domains/elklart-simulated-domain` | Current simulated domain state |
| `POST /domains/elklart-simulated-domain/verify` | `{object:"domain", id:...}`; subsequent GET reports verified |
| `POST /emails` | `{id:...}` after durable local delivery receipt |

All requests require bearer authentication. Run sender setup through OPS's ordinary `startDomainVerification` and `checkDomainVerification` flows. SPF, DKIM, MAIL FROM MX and DMARC records are explicitly simulated. No public DNS is queried or certified. The returned domain includes this notice. The only accepted domain and mailbox suffix is `elklart.example.invalid`, including From, To, Cc, Bcc and Reply-To.

Accepted messages go exclusively to dedicated local Mailpit at `http://127.0.0.1:54324/api/v1/send`. Subject, HTML/text, recipients, custom `X-` headers and inline base64 attachments are mapped to Mailpit's documented API. Remote attachment paths, scheduled sends and templates are refused. No SMTP relay or real external delivery occurs.

`POST /emails` requires the SDK's `Idempotency-Key` header. The adapter stores a hashed key and payload fingerprint in private `provider-mail/state.json`. It serializes concurrent requests and takes an exclusive writer lock. Before physical delivery it durably saves a pending intent, then saves the Mailpit receipt before returning success. Repeated completed requests return the original ID; differing payloads with the same key return 409. An interrupted send or failed completion persistence remains ambiguous and returns 409 on repeat. It is never automatically resent. Inspect the local Mailpit and private receipt ledger, then reconcile explicitly or restore the complete demo baseline. Do not simply delete pending entries.

A stale `.writer-lock` after an unclean shutdown must be reconciled by confirming the adapter is stopped before removing that exact owned empty lock directory. Include the entire private `provider-mail` state with database/provider snapshots, and stop this listener before snapshot/reset. Credentials and message contents are never logged. The ledger retains fingerprints and Mailpit IDs; Mailpit holds the fictional message itself.

Verification: `npx vitest run __tests__/elklart-resend-provider.test.ts` tests the HTTP boundary with a local Mailpit substitute. A separate actual Mailpit integration on 2026-11-10 returned HTTP 200 and receipt `Q5LGDcArXNaPjzmvyQf73f` for the fictional local recipient `local-proof@elklart.example.invalid`. That confirms this boundary's local delivery, not a completed OPS business scenario or public email deliverability.
