import type { Metadata } from 'next'
import type { ReactNode } from 'react'
import { CopyCodeBlock } from '@/components/developers/CopyCodeBlock'
import { PARTNER_API_BASE_URL, PARTNER_API_VERSION } from '@/lib/partner-api/openApi'

export const metadata: Metadata = {
  title: 'Partner API v1 | Gridex Developers',
  description: 'Simple Partner API for location, pricing, registration, data retrieval and webhooks.',
}

export const revalidate = 3600

const Section = ({ id, title, children }: { id: string; title: string; children: ReactNode }) => (
  <section id={id} className="scroll-mt-24 space-y-4 border-b border-slate-200 pb-10">
    <h2 className="text-2xl font-semibold tracking-tight text-slate-950">{title}</h2>
    {children}
  </section>
)

const locationRequest = `GET /location?postal_code=11122&address=Exempelgatan%201&city=Stockholm`

const locationResponse = `{
  "location": {
    "postal_code": "11122",
    "city": "Stockholm",
    "status": "resolved",
    "price_area": "SE3",
    "grid_area": {
      "code": "...",
      "name": "...",
      "verified": true
    },
    "grid_owner": {
      "name": "...",
      "verified": true
    },
    "requires_address": false,
    "required_fields": []
  }
}`

const currentPriceRequest = `GET /price/current?postal_code=11122&address=Exempelgatan%201&city=Stockholm`

const quoteRequest = `POST /price

{
  "postal_code": "11122",
  "address": "Exempelgatan 1",
  "city": "Stockholm",
  "annual_consumption_kwh": 3500,
  "customer_type": "PRIVATE"
}`

const quoteResponse = `{
  "quote_reference": "quote_...",
  "valid_until": "...",
  "location": {
    "postal_code": "11122",
    "status": "resolved",
    "price_area": "SE3"
  },
  "offer": {
    "name": "Gridex Månad",
    "code": "...",
    "contract_type": "..."
  },
  "customer_price": {
    "estimated_sek_per_kwh_inc_vat": 0.79,
    "currency": "SEK",
    "unit": "kWh"
  },
  "estimated_cost": {
    "monthly_inc_vat": "<calculated by Gridex pricing engine>",
    "annual_inc_vat": "<calculated by Gridex pricing engine>",
    "currency": "SEK"
  },
  "price_components": []
}`

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
  ['GET', '/location', 'Resolve price area and independently verified grid context'],
  ['GET', '/price/current', 'Get current verified market electricity price'],
  ['POST', '/price', 'Calculate customer price with the Gridex pricing engine'],
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
            <a className="block hover:text-slate-950" href="#location-pricing">Location & pricing</a>
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
            <p className="max-w-3xl text-lg leading-8 text-slate-600">Location, Pricing, Registration, Data Retrieval & Webhooks.</p>
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
              Send business information only. Gridex determines the company from the API key and resolves the electricity area,
              grid owner, market-price source and published electricity offer server-side. Do not send company IDs, tenant IDs,
              grid-owner IDs, price-area IDs, product IDs, offer references or other database identifiers.
            </p>
            <p className="leading-7 text-slate-700">
              If the company has one published API offer it is selected automatically; if several are available Gridex binds a default offer to the credential internally.
              Returned <code>entity_id</code> values are opaque public IDs; they are not database IDs.
            </p>
            <p className="leading-7 text-slate-700">
              Registration POST requests require an <code>Idempotency-Key</code>. Reuse the same key only when retrying the same request.
            </p>
          </Section>

          <Section id="location-pricing" title="1. Location & Pricing">
            <p className="leading-7 text-slate-700">
              Gridex uses one shared location resolver for these endpoints and for site/contract registration. A postal code can be enough
              to determine an electricity price area for pricing. If postcode evidence conflicts across price areas, Gridex returns
              <code>location_ambiguous</code> instead of guessing. Grid area and grid owner are only treated as verified from independent
              facility, master-data or other approved evidence; a postcode centroid is never sufficient for Ediel automation.
            </p>

            <h3 className="text-lg font-semibold text-slate-950">1.1 Resolve Location</h3>
            <CopyCodeBlock code={locationRequest} language="text" />
            <CopyCodeBlock code={locationResponse} language="json" />
            <p className="text-sm leading-6 text-slate-600">
              A postcode-only result can be sufficient for indicative pricing while grid area and grid owner remain unverified or absent.
              Contract switching and facility/metering requests continue to use Gridex&apos;s stricter facility, grid-owner and Ediel-route verification rules.
            </p>

            <h3 className="text-lg font-semibold text-slate-950">1.2 Current Market Price</h3>
            <CopyCodeBlock code={currentPriceRequest} language="text" />
            <p className="text-sm leading-6 text-slate-600">
              This returns the current verified market interval from the same market-price source used by Gridex internally. It does not include supplier, grid or tax fees unless explicitly stated in the response.
            </p>

            <h3 className="text-lg font-semibold text-slate-950">1.3 Calculate Customer Price</h3>
            <CopyCodeBlock code={quoteRequest} language="json" />
            <CopyCodeBlock code={quoteResponse} language="json" />
            <p className="text-sm leading-6 text-slate-600">
              The quote is calculated by the same Gridex pricing engine used by Ops. The response exposes the calculated totals and price components; the partner does not select internal price plans or publication records.
            </p>
          </Section>

          <Section id="registration" title="2. Registration">
            <p className="leading-7 text-slate-700">
              Use <code>POST /contract</code> for the normal combined flow. Use the individual endpoints only when your backend creates the resources in separate steps.
              Site and contract creation automatically run the same location resolver used by <code>/location</code> and pricing, so Gridex can persist sufficiently trusted electricity-area information without asking the partner for internal IDs.
            </p>

            <h3 className="text-lg font-semibold text-slate-950">2.1 Create Contract</h3>
            <CopyCodeBlock code={createContract} language="json" />
            <h4 className="font-semibold text-slate-950">Response</h4>
            <CopyCodeBlock code={createContractResponse} language="json" />

            <div className="rounded-xl border border-slate-200 p-4 text-sm leading-6 text-slate-700">
              <strong>Supported values:</strong> customer_type = PRIVATE | COMPANY · site_electricity_type = CONSUMPTION | PRODUCTION · poa_type = WEB | PAPER | AUDIO · transaction_type = SWITCH | MOVE_OUT.
              Power-of-attorney file uploads are PDF-only and limited to 5 MB.
            </div>

            <h3 className="text-lg font-semibold text-slate-950">2.2 Create Customer</h3>
            <CopyCodeBlock code={createCustomer} language="json" />
            <CopyCodeBlock code={`{\n  "entity_id": "customer_..."\n}`} language="json" />

            <h3 className="text-lg font-semibold text-slate-950">2.3 Create Site</h3>
            <CopyCodeBlock code={createSite} language="json" />
            <CopyCodeBlock code={`{\n  "entity_id": "site_..."\n}`} language="json" />

            <h3 className="text-lg font-semibold text-slate-950">2.4 Upload Power of Attorney</h3>
            <CopyCodeBlock code={createPoa} language="json" />
            <CopyCodeBlock code={`{\n  "entity_id": "poa_..."\n}`} language="json" />

            <p className="text-sm leading-6 text-slate-600">
              Individual registration flow: create Customer → create Site with customer_id → upload Power of Attorney with customer_id and site_id.
            </p>
          </Section>

          <Section id="data" title="3. Data Retrieval">
            <h3 className="text-lg font-semibold text-slate-950">3.1 Contract State</h3>
            <CopyCodeBlock code={`GET /contract/{contract_id}/state\n\n{\n  "entity_id": "contract_...",\n  "state": "active"\n}`} language="json" />

            <h3 className="text-lg font-semibold text-slate-950">3.2 Customer</h3>
            <CopyCodeBlock code="GET /customer/{customer_id}" language="text" />

            <h3 className="text-lg font-semibold text-slate-950">3.3 Site</h3>
            <CopyCodeBlock code="GET /customer/{customer_id}/site/{site_id}" language="text" />

            <h3 className="text-lg font-semibold text-slate-950">3.4 Power of Attorney</h3>
            <CopyCodeBlock code="GET /customer/{customer_id}/site/{site_id}/powerofattorney" language="text" />

            <h3 className="text-lg font-semibold text-slate-950">3.5 Invoices</h3>
            <CopyCodeBlock code="GET /customer/{customer_id}/site/{site_id}/invoice?from_date=YYYY-MM-DD&to_date=YYYY-MM-DD" language="text" />
            <CopyCodeBlock code={invoiceResponse} language="json" />
            <p className="text-sm leading-6 text-slate-600">
              from_date and to_date are optional for invoice lists. Use <code>GET /invoice/{'{invoice_id}'}</code> for one invoice and <code>GET /invoice/{'{invoice_id}'}/pdf</code> for its PDF as base64.
            </p>

            <h3 className="text-lg font-semibold text-slate-950">3.6 Consumption / Production Measurements</h3>
            <CopyCodeBlock code="GET /customer/{customer_id}/site/{site_id}/measurement?from_date=YYYY-MM-DD&to_date=YYYY-MM-DD&resolution=1h" language="text" />
            <CopyCodeBlock code={measurementResponse} language="json" />
            <p className="text-sm leading-6 text-slate-600">Resolution is <code>15m</code> or <code>1h</code>.</p>
          </Section>

          <Section id="webhooks" title="4. Webhook Subscriptions">
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
              target_url must be a public HTTPS endpoint. Private, loopback and link-local destinations are blocked. The signing secret is stored securely and is never returned by the API.
            </p>
          </Section>

          <Section id="summary" title="5. Endpoint Summary">
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
