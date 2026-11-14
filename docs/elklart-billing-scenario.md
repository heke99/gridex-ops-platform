# Elklart billing: actual provider setup and ordinary invoice path

The isolated demo uses Capway/Aptic **TEST** with the controlled HTTP adapter at `http://127.0.0.1:38480`. This is a simulated partner at the integration boundary; OPS retains its ordinary selection, connection test, pricing, approval and dispatch logic. The invoice test centre is not used for this scenario.

## Actual setup completed

Run from the OPS repository:

```sh
node --experimental-strip-types scripts/demo/elklart-billing-scenario.mjs
```

The runner validates the dedicated loopback OPS API, canonical fictional tenant and local database resource/marker. It restores only exact source-derived provider catalogue constants, recording original migration and extracted statement SHA256 privately. Real Auth login then submits the existing `/admin/billing/integrations` provider selection form with `capway_aptic` and `test`.

The current UI exposes provider/environment selection but no API-key configuration editor. A separately labelled prepared configuration binds the supported `resolveCapwayConnectionConfig` fields to the local adapter: `settings.auth_mode`, `settings.api_key_header`, `settings.base_url` and a server environment-variable reference. This step writes **no** connection status, readiness result or test timestamp. Credentials remain private; neither source nor evidence contains their values.

The actual **Testa Aptic-anslutning** action then makes OPS call `GET /v1/Invoices/Ping` with its configured credential. The ordinary action derives and persists `status=ready` and a successful test result. This setup ran successfully against the controlled adapter; safe read-back is private `ops/billing-setup.json`. Invoice dispatch remains disabled after setup. A successful Ping is not proof of any invoice scenario.

## Real invoice route and prerequisites

The runner also supports a bounded ordinary invoice scenario:

```sh
node --experimental-strip-types scripts/demo/elklart-billing-scenario.mjs \
  --invoice-month=YYYY-MM \
  --allowed-customer-id=ACTUAL_CUSTOMER_UUID
```

Add `--approve-and-send` only when executing the actual approval/export step. Repeat the customer option if the month intentionally includes several prepared demo customers. The underlying controls operate on the **whole tenant/month**, so the runner rejects supply periods or underlays belonging to customers outside this explicit allowlist before invoking them. Both delivery-period and underlay reads request exact counts. Each count must match the complete fetched rows and stay within the 1000-row demo bound; truncation, missing count metadata or a larger scope stops execution. It refuses an empty allowlist, missing confirmed delivery periods and absent current eligible billable meter values. Missing source data is never replaced with zero or estimates by the runner.

The normal sequence is:

1. Actual confirmed supply periods and ordinary qualified metering imports, including any corrected series, establish the source basis. Pricing snapshots must belong to the same tenant/customer/contract/site and retain source qualification.
2. Authenticated `POST /api/internal/billing/generate-underlay` with `billing_month` calls `generateBillingUnderlaysForMonth`. It uses Stockholm civil-month bounds and the actual supply/metering/pricing gates.
3. Authenticated `POST /api/internal/invoice-exports/create` with `company_id,billing_month` calls `prepareInvoiceDraftsForReview`. Only validated, ready underlays qualify. The service creates and locks canonical pricing, reserves export items and creates the draft customer invoice. This is prepare-only.
4. With explicit approval requested, the normal **Aktivera utskick** control enables the already-tested TEST provider. The `/admin/billing` **Godkänn och skicka** form refreshes preparation, validates the source basis and locked amounts, records explicit approval and sends through the real Capway client to the controlled adapter.
5. The ordinary dispatch service derives the provider-confirmed canonical `customer_invoices.status=sent`. The shared portal publication policy includes `sent`; no fixture directly changes invoice status. The runner reads back tenant/customer-scoped invoice, export-item and partner references and records direct OPS links privately.
6. Independently sign in as the actual customer and verify the invoice in the real portal, including amounts, period, sites and source identity. The runner leaves `portalViewVerified=false` and `scenarioComplete=false` until that separate evidence exists.

Relevant implementation: `app/admin/billing/integrations/actions.ts`, `lib/billing/underlayEngine.ts`, `lib/billing/invoiceReviewPrepare.ts`, `lib/billing/invoiceApprovedDispatch.ts`, and `lib/customer-portal/apiData.ts`.

## Current limits and reset

Sjövik's actual delivery/contract/metering graph remains a prerequisite. The invoice scenario has **not** run; no published customer invoice or portal invoice view is claimed by provider setup. Market activation blockers must remain visible; a selected TEST invoice provider does not attest external electricity-market authority.

Use the coordinated full-runtime snapshot/restore, including OPS/portal databases, Auth, documents, queues, private credential bindings and the provider's persisted invoice/event state. Re-running the setup or clearing filters is not a full reset. Retain provider references and idempotency keys when retrying; do not clear reservation rows to force another send.

Targeted billing tests use replaced dependencies and prove local target rejection, configuration-only writes, exact tenant/connection/TEST scope, source-derived catalogue provenance, the whole-month customer allowlist, and rejection of a foreign customer hidden beyond a capped 1000-row response. Actual provider Ping is separately evidenced by the real UI action and local adapter response. Broader invoice and portal acceptance remain unverified.
