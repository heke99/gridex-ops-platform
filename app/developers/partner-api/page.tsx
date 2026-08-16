import type { Metadata } from 'next'
import type { ReactNode } from 'react'
import { CopyCodeBlock } from '@/components/developers/CopyCodeBlock'
import { PARTNER_API_BASE_URL, PARTNER_API_VERSION } from '@/lib/partner-api/openApi'

export const metadata: Metadata = {
  title: 'Partner API v1 | Gridex Developers',
  description:
    'Backend-to-backend API for electricity suppliers: contract registration, customers, sites, invoices, metering data and signed webhooks.',
}

export const revalidate = 3600

const endpoints = [
  ['POST', '/contracts', 'Register contract (recommended combined flow)', 'partner_contracts.write'],
  ['GET', '/contracts/{contract_reference}', 'Get contract', 'customer_contracts.read'],
  ['GET', '/contracts/{contract_reference}/status', 'Get current contract status', 'customer_contracts.read'],
  ['POST', '/customers', 'Create customer', 'partner_customers.write'],
  ['GET', '/customers/{customer_reference}', 'Get customer', 'customer_profile.read'],
  ['POST', '/sites', 'Create site for an existing customer', 'partner_sites.write'],
  ['GET', '/sites/{site_reference}', 'Get site', 'customer_sites.read'],
  ['POST', '/powers-of-attorney', 'Register signed power of attorney', 'partner_power_of_attorney.write'],
  ['GET', '/powers-of-attorney/{power_of_attorney_reference}', 'Get power of attorney status', 'customer_power_of_attorney.read'],
  ['GET', '/customers/{customer_reference}/invoices', 'List invoices', 'customer_invoices.read'],
  ['GET', '/invoices/{invoice_reference}', 'Get invoice', 'customer_invoices.read'],
  ['GET', '/invoices/{invoice_reference}/pdf', 'Get authorized PDF download descriptor', 'customer_invoices.read'],
  ['GET', '/sites/{site_reference}/measurements', 'Get 15-minute or hourly measurements', 'customer_metering.read'],
  ['GET', '/webhooks/subscriptions', 'List subscriptions for this API client', 'partner_webhooks.manage'],
  ['POST', '/webhooks/subscriptions', 'Create subscription', 'partner_webhooks.manage'],
  ['DELETE', '/webhooks/subscriptions/{reference}', 'Delete subscription', 'partner_webhooks.manage'],
] as const

const createContract = `curl -X POST "${PARTNER_API_BASE_URL}/contracts" \\
  -H "Authorization: Bearer $GRIDEX_API_KEY" \\
  -H "Content-Type: application/json" \\
  -H "Idempotency-Key: nibela-order-20260816-00042" \\
  -d '{
    "offer_reference": "offer_variable_monthly",
    "customer": {
      "external_customer_id": "cust_45821",
      "type": "private",
      "first_name": "Anna",
      "last_name": "Andersson",
      "identity_number": "199001011234",
      "email": "anna@example.se",
      "phone": "+46701234567",
      "invoice_address": {
        "street": "Exempelgatan 1",
        "postal_code": "11122",
        "city": "Stockholm",
        "country": "SE"
      }
    },
    "site": {
      "electricity_type": "consumption",
      "address": {
        "street": "Exempelgatan 1",
        "postal_code": "11122",
        "city": "Stockholm",
        "country": "SE"
      }
    },
    "agreement": {
      "accepted_at": "2026-08-16T13:00:00Z",
      "signer_name": "Anna Andersson",
      "evidence_reference": "sign_92b6ac",
      "distance_agreement": true
    },
    "power_of_attorney": {
      "accepted": true,
      "accepted_at": "2026-08-16T13:00:00Z",
      "signer_name": "Anna Andersson",
      "evidence_reference": "poa_accept_92b6ac",
      "poa_type": "web",
      "transaction_type": "SWITCH"
    }
  }'`

const createContractResponse = `{
  "data": {
    "contract_reference": "contract_...",
    "status": "signed",
    "customer": {
      "customer_reference": "customer_...",
      "customer_number": "DX-..."
    },
    "site": {
      "site_reference": "site_..."
    },
    "power_of_attorney": {
      "power_of_attorney_reference": "poa_..."
    }
  },
  "request_id": "...",
  "api_version": "${PARTNER_API_VERSION}"
}`

const webhookCreate = `curl -X POST "${PARTNER_API_BASE_URL}/webhooks/subscriptions" \\
  -H "Authorization: Bearer $GRIDEX_API_KEY" \\
  -H "Content-Type: application/json" \\
  -H "Idempotency-Key: webhook-primary-v1" \\
  -d '{
    "name": "Production events",
    "endpoint_url": "https://partner.example.com/webhooks/gridex",
    "event_types": [
      "contract.created",
      "contract.status_changed",
      "invoice.created",
      "invoice.sent",
      "metering_values.updated"
    ],
    "signing_secret": "generate-and-store-at-least-32-random-characters"
  }'`

const webhookPayload = `{
  "event_id": "event_...",
  "event_type": "contract.status_changed",
  "created_at": "2026-08-16T13:05:12Z",
  "tenant_reference": "tenant_...",
  "aggregate": {
    "type": "contract",
    "reference": "contract_..."
  },
  "customer": {
    "customer_reference": "customer_...",
    "customer_number": "DX-..."
  },
  "data": {
    "contract_reference": "contract_...",
    "status": "active",
    "previous_status": "signed",
    "offer_reference": "offer_variable_monthly"
  },
  "contract_schema_version": "${PARTNER_API_VERSION}",
  "delivery_id": "delivery_..."
}`

const verifyWebhook = `const timestamp = request.headers["x-gridex-timestamp"]
const signature = request.headers["x-gridex-signature"]
const rawBody = request.rawBody

const expected = "sha256=" + createHmac("sha256", GRIDEX_WEBHOOK_SECRET)
  .update(timestamp + "." + rawBody)
  .digest("hex")

if (!timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) {
  throw new Error("Invalid Gridex webhook signature")
}`

const errorExample = `{
  "error": {
    "code": "site_not_found",
    "message": "Site not found."
  },
  "request_id": "...",
  "api_version": "${PARTNER_API_VERSION}"
}`

const Section = ({
  id,
  title,
  children,
}: {
  id: string
  title: string
  children: ReactNode
}) => (
  <section id={id} className="scroll-mt-24 space-y-4 border-b border-slate-200 pb-10">
    <h2 className="text-2xl font-semibold tracking-tight text-slate-950">{title}</h2>
    {children}
  </section>
)

export default function PartnerApiDocumentationPage() {
  return (
    <main className="mx-auto max-w-6xl px-5 py-12 sm:px-8 lg:px-10">
      <div className="grid gap-10 lg:grid-cols-[220px_minmax(0,1fr)]">
        <aside className="hidden lg:block">
          <nav className="sticky top-8 space-y-2 text-sm text-slate-600">
            <a className="block hover:text-slate-950" href="#overview">Overview</a>
            <a className="block hover:text-slate-950" href="#auth">Authentication</a>
            <a className="block hover:text-slate-950" href="#contracts">Register contracts</a>
            <a className="block hover:text-slate-950" href="#resources">Customers & sites</a>
            <a className="block hover:text-slate-950" href="#invoices">Invoices & measurements</a>
            <a className="block hover:text-slate-950" href="#webhooks">Webhooks</a>
            <a className="block hover:text-slate-950" href="#security">Security model</a>
            <a className="block hover:text-slate-950" href="#endpoints">Endpoint summary</a>
            <a className="block hover:text-slate-950" href="#migration">Legacy migration</a>
          </nav>
        </aside>

        <article className="min-w-0 space-y-10">
          <header className="space-y-4">
            <div className="text-sm font-medium text-slate-500">Gridex Developers · v{PARTNER_API_VERSION}</div>
            <h1 className="text-4xl font-semibold tracking-tight text-slate-950">Partner API v1</h1>
            <p className="max-w-3xl text-lg leading-8 text-slate-600">
              A clean backend-to-backend integration API for electricity suppliers and partners.
              It exposes business operations only: contracts, customers, sites, invoices,
              measurements and event notifications.
            </p>
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-700">
              <strong>Base URL:</strong> <code>{PARTNER_API_BASE_URL}</code>
              <br />
              <strong>OpenAPI:</strong>{' '}
              <a className="underline" href="/api/partner/v1/openapi.json">/api/partner/v1/openapi.json</a>
            </div>
          </header>

          <Section id="overview" title="1. What this API is — and is not">
            <p className="leading-7 text-slate-700">
              Your backend calls Gridex. Your mobile app, website or customer portal should call
              your backend, not Gridex directly.
            </p>
            <ul className="list-disc space-y-2 pl-6 text-slate-700">
              <li>Register and retrieve contracts.</li>
              <li>Retrieve customer, site, invoice and metering data.</li>
              <li>Receive signed webhook notifications when relevant data changes.</li>
              <li>Use opaque references such as <code>contract_reference</code> and <code>site_reference</code>.</li>
            </ul>
            <p className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm leading-6 text-amber-950">
              Company onboarding, tenant configuration, API key creation, scopes, product
              publication, Ediel configuration and internal Gridex workflows are intentionally
              <strong> not part of the Partner API</strong>. Gridex configures those on the platform side.
            </p>
          </Section>

          <Section id="auth" title="2. Authentication and permissions">
            <p className="leading-7 text-slate-700">
              Send the API key from your server as a Bearer token. Never embed it in browser or
              mobile code. The API key determines the company context; no endpoint accepts
              <code> company_id</code> or a tenant selector.
            </p>
            <CopyCodeBlock code={`Authorization: Bearer $GRIDEX_API_KEY`} language="text" />
            <p className="leading-7 text-slate-700">
              Gridex assigns only the scopes required by the integration. Write endpoints also
              require an <code>Idempotency-Key</code>. Reusing the same key with a different payload
              returns a conflict instead of creating duplicate business data.
            </p>
          </Section>

          <Section id="contracts" title="3. Register a contract">
            <p className="leading-7 text-slate-700">
              For most suppliers, <code>POST /contracts</code> is the recommended flow. It creates
              the customer, site and contract in one database transaction and can also register a
              signed power of attorney.
            </p>
            <p className="leading-7 text-slate-700">
              <code>offer_reference</code> is the stable identifier of an API-published Gridex
              product. The client does not send internal price-plan, publication, legal-bundle or
              database identifiers.
            </p>
            <CopyCodeBlock code={createContract} language="bash" />
            <h3 className="text-lg font-semibold text-slate-950">Response</h3>
            <CopyCodeBlock code={createContractResponse} language="json" />
            <p className="text-sm leading-6 text-slate-600">
              If signed agreement evidence is omitted, the contract is created as
              <code> pending_signature</code>. If <code>accepted_at</code> is supplied, Gridex also
              requires <code>signer_name</code> and <code>evidence_reference</code>.
            </p>
          </Section>

          <Section id="resources" title="4. Customers, sites and power of attorney">
            <p className="leading-7 text-slate-700">
              The individual endpoints are available when your backend creates the resources in
              separate steps. Create the customer first, then the site using the returned
              <code> customer_reference</code>, then register the power of attorney if required.
            </p>
            <CopyCodeBlock
              code={`POST /customers\nPOST /sites\nPOST /powers-of-attorney\n\nGET /customers/{customer_reference}\nGET /sites/{site_reference}\nGET /powers-of-attorney/{power_of_attorney_reference}`}
              language="text"
            />
            <p className="text-sm leading-6 text-slate-600">
              A PDF may be included as <code>file_base64</code> for power-of-attorney evidence.
              The decoded file is limited to 5 MB, must be a PDF and is stored in private storage.
              Storage paths are never returned to the partner.
            </p>
          </Section>

          <Section id="invoices" title="5. Invoices and measurements">
            <CopyCodeBlock
              code={`GET /customers/{customer_reference}/invoices?from_date=2026-01-01&to_date=2026-01-31\nGET /invoices/{invoice_reference}\nGET /invoices/{invoice_reference}/pdf\nGET /sites/{site_reference}/measurements?from_date=2026-01-01&to_date=2026-01-31&resolution=15m`}
              language="text"
            />
            <p className="leading-7 text-slate-700">
              Measurement resolution is <code>15m</code> or <code>1h</code>. A single request may
              cover at most 366 days. Invoice PDF endpoints return an authorized HTTPS download
              descriptor only when the document is available; internal storage paths are never exposed.
            </p>
          </Section>

          <Section id="webhooks" title="6. Webhooks">
            <p className="leading-7 text-slate-700">
              Webhooks are signals that data changed. After receiving an event, fetch the current
              resource through the relevant GET endpoint. This keeps webhook payloads small and
              avoids treating an asynchronous notification as the source of truth.
            </p>
            <h3 className="text-lg font-semibold text-slate-950">Create subscription</h3>
            <CopyCodeBlock code={webhookCreate} language="bash" />
            <p className="text-sm leading-6 text-slate-600">
              The signing secret is generated and retained by the partner. Gridex stores it in
              Supabase Vault and never returns it through the API.
            </p>
            <h3 className="text-lg font-semibold text-slate-950">Event types</h3>
            <CopyCodeBlock
              code={`contract.created\ncontract.status_changed\ninvoice.created\ninvoice.sent\nmetering_values.updated`}
              language="text"
            />
            <h3 className="text-lg font-semibold text-slate-950">Notification</h3>
            <CopyCodeBlock code={webhookPayload} language="json" />
            <h3 className="text-lg font-semibold text-slate-950">Verify signature</h3>
            <p className="text-sm leading-6 text-slate-600">
              Verify HMAC-SHA256 over <code>{'${timestamp}.${rawBody}'}</code> using the exact raw
              request body. Reject stale timestamps according to your replay policy.
            </p>
            <CopyCodeBlock code={verifyWebhook} language="typescript" />
          </Section>

          <Section id="security" title="7. Security model">
            <ul className="list-disc space-y-2 pl-6 text-slate-700">
              <li>Company context is derived from the API credential, never from request data.</li>
              <li>Every database read/write is company-scoped and webhook subscriptions are also API-client scoped.</li>
              <li>Internal UUIDs, <code>company_id</code>, storage paths and service-role data are blocked from public success payloads.</li>
              <li>Write operations require idempotency keys and request bodies have strict size limits.</li>
              <li>Webhook endpoints must use HTTPS; signatures use HMAC-SHA256 and secrets are stored in Vault.</li>
              <li>API calls are rate-limited and audited with a request ID.</li>
            </ul>
          </Section>

          <Section id="errors" title="8. Errors and retries">
            <CopyCodeBlock code={errorExample} language="json" />
            <p className="leading-7 text-slate-700">
              Log <code>request_id</code> on your side. Retry transient 5xx/429 failures with
              exponential backoff. For POST retries, always reuse the original
              <code> Idempotency-Key</code> and the identical payload.
            </p>
          </Section>

          <Section id="endpoints" title="9. Endpoint summary">
            <div className="overflow-x-auto rounded-xl border border-slate-200">
              <table className="min-w-full divide-y divide-slate-200 text-left text-sm">
                <thead className="bg-slate-50 text-slate-700">
                  <tr>
                    <th className="px-4 py-3 font-semibold">Method</th>
                    <th className="px-4 py-3 font-semibold">Endpoint</th>
                    <th className="px-4 py-3 font-semibold">Purpose</th>
                    <th className="px-4 py-3 font-semibold">Scope</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {endpoints.map(([method, endpoint, purpose, scope]) => (
                    <tr key={`${method}-${endpoint}`}>
                      <td className="whitespace-nowrap px-4 py-3 font-mono">{method}</td>
                      <td className="whitespace-nowrap px-4 py-3 font-mono">{endpoint}</td>
                      <td className="px-4 py-3 text-slate-700">{purpose}</td>
                      <td className="whitespace-nowrap px-4 py-3 font-mono text-xs">{scope}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Section>

          <Section id="migration" title="10. Migration from the legacy integration APIs">
            <p className="leading-7 text-slate-700">
              Existing <code>/api/v1/website/*</code> and customer-portal integration routes remain
              available for compatible existing integrations during migration. New supplier
              integrations should use <code>/api/partner/v1</code>.
            </p>
            <p className="leading-7 text-slate-700">
              Do not copy internal website/portal concepts into a new backend integration. Map your
              business objects to <code>customer_reference</code>, <code>site_reference</code>,
              <code>contract_reference</code> and <code>invoice_reference</code>, then use webhooks
              only as change notifications.
            </p>
          </Section>
        </article>
      </div>
    </main>
  )
}
