import type { Metadata } from 'next'
import type { ReactNode } from 'react'
import { CopyCodeBlock } from '@/components/developers/CopyCodeBlock'
import { PARTNER_API_BASE_URL, PARTNER_API_VERSION } from '@/lib/partner-api/openApi'

export const metadata: Metadata = {
  title: 'Partner API v1 | Gridex Developers',
  description: 'Simple Partner API for registration, data retrieval and webhooks.',
}

export const revalidate = 3600

const Section = ({ id, title, children }: { id: string; title: string; children: ReactNode }) => (
  <section id={id} className="scroll-mt-24 space-y-4 border-b border-slate-200 pb-10">
    <h2 className="text-2xl font-semibold tracking-tight text-slate-950">{title}</h2>
    {children}
  </section>
)

const createContract = `POST /contract

{
  "customer": {
    "first_name": "Anna",
    "last_name": "Andersson",
    "soc_id": "19900101-1234",
    "customer_type": "PRIVATE",
    "company_name": null,
    "invoice_address": "Exempelgatan 1",
    "zip_code": "11122",
    "city": "Stockholm",
    "country": "SE",
    "email": "anna@example.se",
    "cell_phone": "+46701234567"
  },
  "site": {
    "address": "Exempelgatan 1",
    "zip_code": "11122",
    "city": "Stockholm",
    "country": "SE",
    "site_electricity_type": "CONSUMPTION"
  },
  "power_of_attorney": {
    "poa_type": "WEB",
    "transaction_type": "SWITCH",
    "file_base64": "<pdf_base64>",
    "file_extension": "pdf"
  }
}`

const createContractResponse = `{
  "entity_id": "contract_...",
  "customer": { "entity_id": "customer_..." },
  "site": { "entity_id": "site_..." },
  "power_of_attorney": { "entity_id": "poa_..." }
}`

const createCustomer = `POST /customer

{
  "first_name": "Anna",
  "last_name": "Andersson",
  "soc_id": "19900101-1234",
  "customer_type": "PRIVATE",
  "company_name": null,
  "invoice_address": "Exempelgatan 1",
  "zip_code": "11122",
  "city": "Stockholm",
  "country": "SE",
  "email": "anna@example.se",
  "cell_phone": "+46701234567"
}`

const createSite = `POST /customer/{customer_id}/site

{
  "address": "Exempelgatan 1",
  "zip_code": "11122",
  "city": "Stockholm",
  "country": "SE",
  "site_electricity_type": "CONSUMPTION"
}`

const createPoa = `POST /customer/{customer_id}/site/{site_id}/powerofattorney

{
  "poa_type": "WEB",
  "transaction_type": "SWITCH",
  "file_base64": "<pdf_base64>",
  "file_extension": "pdf"
}`

const invoiceResponse = `{
  "invoices": [
    {
      "entity_id": "invoice_...",
      "invoice_number": "100042",
      "invoice_date": "2026-08-01",
      "due_date": "2026-08-31",
      "amount": 845.50,
      "currency": "SEK",
      "status": "sent"
    }
  ]
}`

const measurementResponse = `{
  "site_id": "site_...",
  "measurements": [
    {
      "timestamp": "2026-08-01T00:00:00Z",
      "value": 0.42,
      "unit": "kWh",
      "type": "CONSUMPTION"
    }
  ]
}`

const webhookRequest = `POST /webhook/subscription

{
  "webhook_event": "CONTRACT_STATUS_CHANGE",
  "target_url": "https://partner.example.com/webhooks/gridex",
  "notification_email": "integration@example.com",
  "signing_secret": "<at-least-32-random-characters>"
}`

const endpointRows = [
  ['POST', '/contract', 'Create contract, customer and site together'],
  ['POST', '/customer', 'Create customer'],
  ['POST', '/customer/{customer_id}/site', 'Create site'],
  ['POST', '/customer/{customer_id}/site/{site_id}/powerofattorney', 'Upload power of attorney'],
  ['GET', '/contract/{contract_id}/state', 'Get contract state'],
  ['GET', '/customer/{customer_id}', 'Get customer'],
  ['GET', '/customer/{customer_id}/site/{site_id}', 'Get site'],
  ['GET', '/customer/{customer_id}/site/{site_id}/powerofattorney', 'Get power of attorney'],
  ['GET', '/customer/{customer_id}/site/{site_id}/invoice', 'List invoices'],
  ['GET', '/invoice/{invoice_id}', 'Get invoice'],
  ['GET', '/invoice/{invoice_id}/pdf', 'Get invoice PDF'],
  ['GET', '/customer/{customer_id}/site/{site_id}/measurement', 'Get measurements'],
  ['POST', '/webhook/subscription', 'Create webhook subscription'],
] as const

const webhookEvents = [
  'CUSTOMER_CREATED',
  'CUSTOMER_UPDATED',
  'SITE_CREATED',
  'SITE_UPDATED',
  'POWER_OF_ATTORNEY_CREATED',
  'CONTRACT_CREATED',
  'CONTRACT_STATUS_CHANGE',
  'INVOICE_CREATED',
  'INVOICE_UPDATED',
] as const

export default function PartnerApiDocumentationPage() {
  return (
    <main className="mx-auto max-w-6xl px-5 py-12 sm:px-8 lg:px-10">
      <div className="grid gap-10 lg:grid-cols-[220px_minmax(0,1fr)]">
        <aside className="hidden lg:block">
          <nav className="sticky top-8 space-y-2 text-sm text-slate-600">
            <a className="block hover:text-slate-950" href="#start">Start</a>
            <a className="block hover:text-slate-950" href="#registration">Registration</a>
            <a className="block hover:text-slate-950" href="#data">Data retrieval</a>
            <a className="block hover:text-slate-950" href="#webhooks">Webhooks</a>
            <a className="block hover:text-slate-950" href="#summary">Endpoint summary</a>
          </nav>
        </aside>

        <article className="min-w-0 space-y-10">
          <header className="space-y-4">
            <div className="text-sm font-medium text-slate-500">Gridex Developers · v{PARTNER_API_VERSION}</div>
            <h1 className="text-4xl font-semibold tracking-tight text-slate-950">Partner API Reference</h1>
            <p className="max-w-3xl text-lg leading-8 text-slate-600">Registration, Data Retrieval & Webhooks.</p>
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-700">
              <strong>Base URL:</strong> <code>{PARTNER_API_BASE_URL}</code>
              <br />
              <strong>OpenAPI:</strong>{' '}
              <a className="underline" href="/api/partner/v1/openapi.json">/api/partner/v1/openapi.json</a>
            </div>
          </header>

          <Section id="start" title="Before you start">
            <p className="leading-7 text-slate-700">
              The API is server-to-server. Send your API key as <code>Authorization: Bearer &lt;API_KEY&gt;</code>.
              Do not put the key in a browser or mobile app.
            </p>
            <p className="leading-7 text-slate-700">
              Gridex configures the company, permissions and published electricity offer behind the API key.
              Your integration does not send company IDs, tenant IDs, product configuration or market-system settings.
              If the company has one published API offer it is selected automatically; if several are available Gridex binds a default offer to the credential internally.
            </p>
            <p className="leading-7 text-slate-700">
              All POST requests require an <code>Idempotency-Key</code>. Reuse the same key only when retrying the same request.
              Returned <code>entity_id</code> values are opaque public IDs; they are not database IDs.
            </p>
          </Section>

          <Section id="registration" title="1. Registration">
            <p className="leading-7 text-slate-700">
              Use <code>POST /contract</code> for the normal combined flow. Use the individual endpoints only when your backend creates the resources in separate steps.
            </p>

            <h3 className="text-lg font-semibold text-slate-950">1.1 Create Contract</h3>
            <CopyCodeBlock code={createContract} language="json" />
            <h4 className="font-semibold text-slate-950">Response</h4>
            <CopyCodeBlock code={createContractResponse} language="json" />

            <div className="rounded-xl border border-slate-200 p-4 text-sm leading-6 text-slate-700">
              <strong>Supported values:</strong> customer_type = PRIVATE | COMPANY · site_electricity_type = CONSUMPTION | PRODUCTION · poa_type = WEB | PAPER | AUDIO · transaction_type = SWITCH | MOVE_OUT.
              Power-of-attorney file uploads are PDF-only and limited to 5 MB.
            </div>

            <h3 className="text-lg font-semibold text-slate-950">1.2 Create Customer</h3>
            <CopyCodeBlock code={createCustomer} language="json" />
            <CopyCodeBlock code={`{\n  "entity_id": "customer_..."\n}`} language="json" />

            <h3 className="text-lg font-semibold text-slate-950">1.3 Create Site</h3>
            <CopyCodeBlock code={createSite} language="json" />
            <CopyCodeBlock code={`{\n  "entity_id": "site_..."\n}`} language="json" />

            <h3 className="text-lg font-semibold text-slate-950">1.4 Upload Power of Attorney</h3>
            <CopyCodeBlock code={createPoa} language="json" />
            <CopyCodeBlock code={`{\n  "entity_id": "poa_..."\n}`} language="json" />

            <p className="text-sm leading-6 text-slate-600">
              Individual registration flow: create Customer → create Site with customer_id → upload Power of Attorney with customer_id and site_id.
            </p>
          </Section>

          <Section id="data" title="2. Data Retrieval">
            <h3 className="text-lg font-semibold text-slate-950">2.1 Contract State</h3>
            <CopyCodeBlock code={`GET /contract/{contract_id}/state\n\n{\n  "entity_id": "contract_...",\n  "state": "active"\n}`} language="json" />

            <h3 className="text-lg font-semibold text-slate-950">2.2 Customer</h3>
            <CopyCodeBlock code="GET /customer/{customer_id}" language="text" />

            <h3 className="text-lg font-semibold text-slate-950">2.3 Site</h3>
            <CopyCodeBlock code="GET /customer/{customer_id}/site/{site_id}" language="text" />

            <h3 className="text-lg font-semibold text-slate-950">2.4 Power of Attorney</h3>
            <CopyCodeBlock code="GET /customer/{customer_id}/site/{site_id}/powerofattorney" language="text" />

            <h3 className="text-lg font-semibold text-slate-950">2.5 Invoices</h3>
            <CopyCodeBlock code="GET /customer/{customer_id}/site/{site_id}/invoice?from_date=YYYY-MM-DD&to_date=YYYY-MM-DD" language="text" />
            <CopyCodeBlock code={invoiceResponse} language="json" />
            <p className="text-sm leading-6 text-slate-600">
              from_date and to_date are optional for invoice lists. Use <code>GET /invoice/{'{invoice_id}'}</code> for one invoice and <code>GET /invoice/{'{invoice_id}'}/pdf</code> for its PDF as base64.
            </p>

            <h3 className="text-lg font-semibold text-slate-950">2.6 Consumption / Production Measurements</h3>
            <CopyCodeBlock code="GET /customer/{customer_id}/site/{site_id}/measurement?from_date=YYYY-MM-DD&to_date=YYYY-MM-DD&resolution=1h" language="text" />
            <CopyCodeBlock code={measurementResponse} language="json" />
            <p className="text-sm leading-6 text-slate-600">Resolution is <code>15m</code> or <code>1h</code>.</p>
          </Section>

          <Section id="webhooks" title="3. Webhook Subscriptions">
            <p className="leading-7 text-slate-700">
              A webhook is a change signal. Verify the Gridex HMAC-SHA256 signature and then call the relevant GET endpoint to retrieve current data.
            </p>
            <CopyCodeBlock code={webhookRequest} language="json" />
            <CopyCodeBlock code={`{\n  "entity_id": "webhook_..."\n}`} language="json" />
            <div className="grid gap-2 sm:grid-cols-2">
              {webhookEvents.map((event) => (
                <code key={event} className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-800">{event}</code>
              ))}
            </div>
            <p className="text-sm leading-6 text-slate-600">
              target_url must be a public HTTPS endpoint. Private, loopback and link-local destinations are blocked. The signing secret is stored in Vault and is never returned by the API.
            </p>
          </Section>

          <Section id="summary" title="4. Endpoint Summary">
            <div className="overflow-x-auto rounded-xl border border-slate-200">
              <table className="min-w-full divide-y divide-slate-200 text-left text-sm">
                <thead className="bg-slate-50 text-slate-700">
                  <tr>
                    <th className="px-4 py-3 font-semibold">Method</th>
                    <th className="px-4 py-3 font-semibold">Endpoint</th>
                    <th className="px-4 py-3 font-semibold">Description</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {endpointRows.map(([method, endpoint, description]) => (
                    <tr key={`${method}-${endpoint}`}>
                      <td className="px-4 py-3 font-medium text-slate-900">{method}</td>
                      <td className="px-4 py-3"><code>{endpoint}</code></td>
                      <td className="px-4 py-3 text-slate-600">{description}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Section>
        </article>
      </div>
    </main>
  )
}
