# Local Elklart SMTP simulator

This is an isolated transport boundary for the existing `sendEdielEmail` client.
It is a local simulation, not Strato delivery, DNS/DKIM verification, market
certification or evidence of real counterparty receipt.

`scripts/demo/elklart-smtp-provider.mjs` accepts authenticated STARTTLS on
`127.0.0.1:38482`, TLS >=1.2, using the existing private runtime certificate.
The client continues to require TLS and verify the CA. AUTH before TLS,
incorrect credentials and envelope addresses outside
`@elklart.example.invalid` are refused. At most ten recipients and 8 MiB MIME
are accepted. Nothing can relay to an external address.

Accepted MIME is relayed without reconstruction to SMTP1025 in the owned
`supabase_inbucket_elklart-ops-demo` Mailpit container. Before each new relay the
adapter verifies exact container/project labels and membership in the owned
`elklart-ops-demo` Docker network. It refuses forwarding configuration. The
Docker CLI is pinned to `unix:///var/run/docker.sock` for every inspection;
any `DOCKER_HOST` or `DOCKER_CONTEXT` variable (including empty values) is
rejected before startup, subprocesses or network activity. The
currently isolated network must use the verified 172.18.0.x range; network drift
fails closed. Mailpit UI is `http://127.0.0.1:54324`.

Generate/use private credentials in
`/workspace/elklart-runtime/provider-smtp/credentials.json`; the launcher creates
a random password on first start. Do not copy it into chat, source or evidence.

Configure OPS privately before launching Node:

```
EDIEL_EMAIL_PROVIDER=strato
EDIEL_SMTP_HOST=127.0.0.1
EDIEL_SMTP_PORT=38482
EDIEL_SMTP_SECURE=false
EDIEL_SMTP_USER=ediel@elklart.example.invalid
EDIEL_SMTP_FROM=ediel@elklart.example.invalid
EDIEL_SMTP_REPLY_TO=ediel@elklart.example.invalid
EDIEL_SHARED_MAILBOX_ADDRESS=ediel@elklart.example.invalid
EDIEL_APP_DKIM_ENABLED=false
NODE_EXTRA_CA_CERTS=/workspace/elklart-runtime/tls/ca.pem
```

`EDIEL_SMTP_PASS` must be read directly from the private credential file by the
runtime launcher. Global `EMAIL_PROVIDER` must not be set to `strato`.
The literal provider name preserves the existing application's readiness
contract; this adapter does not claim actual Strato service.

```
node scripts/demo/elklart-smtp-provider.mjs --start
node scripts/demo/elklart-smtp-provider.mjs --status
node scripts/demo/elklart-smtp-provider.mjs --stop
```

Start detaches the process with private log/PID metadata. Stop verifies the
exact script, `--serve` argument and Linux process start identity before sending
SIGTERM; it never kills an unverified process. One writer lock prevents parallel
sinks. A stale lock is intentionally not stolen: reconcile outstanding receipts
and process state before manually removing an abandoned lock.

Exact MIME, envelope and a SHA256 digest are recorded in private mode0600 JSON
receipts under `provider-smtp`. A pending receipt is fsynced before contacting
Mailpit; successful delivery is fsynced before SMTP250 is returned. Identical
envelope+MIME retries reuse a successful receipt. Ambiguous/pending delivery
returns451 and requires reconciliation; it never blindly resends.

Snapshots must include private credentials and receipts, and the corresponding
Mailpit data. Stop before snapshot restore. Exclude `.writer-lock`,
`supervisor.json` and `supervisor.log`; restart with `--start` afterward.

Dependencies are isolated in `/workspace/elklart-runtime/smtp-deps`:
`smtp-server@3.16.1` (pinned). Repository dependencies are unchanged.
Verification command: `node --test scripts/demo/elklart-smtp-provider.test.mjs`.
It exercises real SMTP/STARTTLS/authentication, rejected non-fictional envelopes,
byte-exact multipart/EDIFACT relay, idempotent replay and durable private receipts.
An actual local Mailpit smoke also confirmed the stored raw MIME ends with the
exact original bytes and retains the attachment.
