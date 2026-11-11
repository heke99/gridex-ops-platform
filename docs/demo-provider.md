# Isolated Elklart invoice provider

`scripts/demo/elklart-capway-provider.mjs` is an external HTTP simulator for
the repository's Capway/Aptic TEST integration. It does not call databases,
send messages, or perform outbound HTTP. The CLI binds only
`127.0.0.1:38480`. Do not expose it through a public proxy.

The runtime launcher must generate independent random 32-byte keys and store
them in its private mode-0600 environment file, never in source or evidence:

- `ELKLART_CAPWAY_ENVIRONMENT=test` (mandatory; production is refused)
- `ELKLART_CAPWAY_API_KEY` (32+ characters)
- `ELKLART_CAPWAY_WEBHOOK_SECRET` (32+ characters)

Run `node scripts/demo/elklart-capway-provider.mjs` with that private environment.
Configure the isolated tenant's existing test provider connection with
`provider=capway_aptic`, `environment=test`, `auth_mode=apikey`,
`base_url=http://127.0.0.1:38480`, `api_key_header=x-elklart-demo-key`, and
`secret_reference.api_key_env=ELKLART_CAPWAY_API_KEY`.
Use `secret_reference.webhook_secret_env=ELKLART_CAPWAY_WEBHOOK_SECRET` for
ordinary OPS webhook verification. OPS must receive these variables privately.
This server refuses non-test startup; the launcher must also verify that the
selected tenant provider connection is TEST before launching OPS.

The exact create and reconciliation shapes come from
`lib/integrations/billing/capway/client.ts` and `types.ts`: GET Ping,
GET Invoices with the client's exact external-reference filter, PUT a single
invoice, `{invoiceGuids:[uuid]}`, and GET by invoice GUID. Stable references
produce deterministic IDs; identical PUT replays reuse the ID, changed content
under an existing reference returns 409. Fresh corrected invoices require a
new ordinary export reference; replacing an issued invoice is not simulated.
Submitted document metadata/base64 is preserved in GET invoice.

FinancialDetails, Transactions, Purchase and Recourse are diagnostic JSON
responses supported by the client. Purchase/Dispute/Deprecate retain their
submitted request. They do not imply a credit invoice or completed financing.
The repository supplies no exact Capway attachment-download route or response
contract; attachment routes return 404. Customer invoice PDF delivery remains
a separate acceptance requirement. No official attachment contract is invented.

An explicitly demo-only authenticated `POST /__demo/events` accepts
`{id,invoiceGuid,status,occurred_at}`. Status can be registered, unpaid, paid,
credited, disputed or overdue. It persists an idempotent event and returns
`{path,body,headers}` for the presenter/runtime to POST to the ordinary OPS
`/api/webhooks/billing/capway_aptic` endpoint. Headers use the exact HMAC
`timestamp.body` contract in `lib/billing/providerWebhooks.ts`; deliver within
five minutes. The simulator never delivers it itself. OPS owns legal transition
checks and tenant routing. A simulated credited event is not a generated credit
invoice; the current internal credit route is explicitly blocked.

Private state lives at `/workspace/elklart-runtime/provider/invoices.json`
(directory 0700, file 0600). Include the entire provider directory in the demo
snapshot; stop the provider before restoring it and restart after restoration.
Run only one provider writer per directory. Never edit OPS invoice status by SQL.
Writes use unique private temporary files and atomic replacement before publishing
the candidate to memory. Failed persistence leaves reconciliation reads and event
status unchanged; retry after storage recovery persists the operation normally.
Event invoice IDs must be UUIDs identifying an own stored invoice record.

Verification: `npx vitest run __tests__/elklart-capway-provider.test.ts` exercises
real loopback HTTP, authentication, creation/reconciliation, replay conflict,
disk reload, signed events, changed status, private permissions, invalid input
and traversal rejection. These adapter tests do not establish that the full
OPS invoice chain or portal PDF flow has been completed.
