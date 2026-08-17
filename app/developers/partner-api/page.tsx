import type { Metadata } from 'next'
import { CopyCodeBlock } from '@/components/developers/CopyCodeBlock'
import { PARTNER_API_BASE_URL, PARTNER_API_VERSION } from '@/lib/partner-api/openApi'

export const metadata: Metadata = {
  title: 'Partner API v1 | Gridex Developers',
  description: 'Simple Partner API for location, pricing, registration, data retrieval and webhooks.',
}

export const revalidate = 3600

const Section = ({ id, title, children }: { id: string; title: string; children: React.ReactNode }) => (
  <section id={id} className="scroll-mt-8 space-y-4 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
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
    "customer_type": "PRIVATE",
    "first_name": "Anna",
    "last_name": "Andersson",
    "personal_identity_number": "199001011234",
    "email": "anna@example.com",
    "phone": "+46701234567"
  },
  "site": {
    "site_name": "Hem",
    "site_electricity_type": "CONSUMPTION",
    "street": "Exempelgatan 1",
    "postal_code": "11122",
    "city": "Stockholm",
    "country": "SE",
    "annual_consumption_kwh": 3500
  },
  "power_of_attorney": {
    "poa_type": "WEB",
    "accepted": true
  }
}`

const createContractResponse = `{
  "contract": {
    "entity_id": "contract_...",
    "state": "application_received"
  },
  "customer": {
    "entity_id": "customer_..."
  },
  "site": {
    "entity_id": "site_..."
  }
}`

const createCustomer = `POST /customer

{
  "customer_type": "PRIVATE",
  "first_name": "Anna",
  "last_name": "Andersson",
  "personal_identity_number": "199001011234",
  "email": "anna@example.com",
  "phone": "+46701234567"
}`

const createSite = `POST /customer/{customer_id}/site

{
  "site_name": "Hem",
  "site_electricity_type": "CONSUMPTION",
  "street": "Exempelgatan 1",
  "postal_code": "11122",
  "city": "Stockholm",
  "country": "SE",
  "annual_consumption_kwh": 3500
}`

const createPoa = `POST /customer/{customer_id}/site/{site_id}/power-of-attorney

{
  "poa_type": "WEB",
  "accepted": true
}`

const webhookRequest = `POST /webhook/subscription

{
  "url": "https://partner.example.com/gridex/webhooks",
  "events": [
    "contract.state_changed",
    "invoice.created",
    "metering.updated"
  ]
}`

const endpointRows = [
  ['GET', '/location', 'Resolve price area and, when independently verified, grid area/grid owner'],
  ['GET', '/price/current', 'Get current verified market electricity price'],
  ['POST', '/price', 'Calculate customer price with the Gridex pricing engine'],
  ['POST', '/contract', 'Create contract, customer and site together'],
  ['POST', '/customer', 'Create customer'],
  ['POST', '/customer/{customer_id}/site', 'Create site'],
  ['POST', '/customer/{customer_id}/site/{site_id}/power-of-attorney', 'Register power of attorney'],
  ['GET', '/contract/{contract_id}/state', 'Read contract state'],
  ['GET', '/customer/{customer_id}/site/{site_id}/invoice', 'List invoices for site'],
  ['GET', '/customer/{customer_id}/site/{site_id}/invoice/{invoice_id}', 'Read one invoice'],
  ['GET', '/customer/{customer_id}/site/{site_id}/measurement', 'Read metering data'],
  ['POST', '/webhook/subscription', 'Create webhook subscription'],
  ['DELETE', '/webhook/subscription/{subscription_id}', 'Delete webhook subscription'],
]

export default function PartnerApiDocumentationPage() {
  return (
    <main className="min-h-screen bg-slate-50 px-4 py-10 text-slate-950 sm:px-6 lg:px-8">
      <div className="mx-auto grid max-w-7xl gap-8 lg:grid-cols-[220px_minmax(0,1fr)]">
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
              to determine an electricity price area for pricing. If shared postcode evidence conflicts across price areas, Gridex returns
              <code>location_ambiguous</code> instead of guessing. Grid-area and grid-owner data are only treated as verified when Gridex has
              independent facility, master-data or other approved verification evidence; a postcode centroid is never sufficient for Ediel automation.
            </p>

            <h3 className="text-lg font-semibold text-slate-950">1.1 Resolve Location</h3>
            <CopyCodeBlock code={locationRequest} language="text" />
            <CopyCodeBlock code={locationResponse} language="json" />
            <p className="text-sm leading-6 text-slate-600">
              A postcode-only result can be sufficient for indicative pricing while <code>grid_area</code> and <code>grid_owner</code> remain unverified or absent.
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

            <h3 className="text-lg font-semibold text-slate-950">3.2 Invoices</h3>
            <CopyCodeBlock code={`GET /customer/{customer_id}/site/{site_id}/invoice`} language="text" />
            <CopyCodeBlock code={`GET /customer/{customer_id}/site/{site_id}/invoice/{invoice_id}`} language="text" />

            <h3 className="text-lg font-semibold text-slate-950">3.3 Measurements</h3>
            <CopyCodeBlock code={`GET /customer/{customer_id}/site/{site_id}/measurement?from=2026-08-01&to=2026-08-02`} language="text" />
          </Section>

          <Section id="webhooks" title="4. Webhooks">
            <p className="leading-7 text-slate-700">
              Subscribe to business events rather than polling when possible. Gridex sends signed webhook deliveries and retries transient failures.
            </p>
            <CopyCodeBlock code={webhookRequest} language="json" />
          </Section>

          <Section id="summary" title="Endpoint summary">
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-slate-200 text-left text-sm">
                <thead>
                  <tr>
                    <th className="px-3 py-2 font-semibold">Method</th>
                    <th className="px-3 py-2 font-semibold">Path</th>
                    <th className="px-3 py-2 font-semibold">Purpose</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {endpointRows.map(([method, endpoint, purpose]) => (
                    <tr key={`${method}-${endpoint}`}>
                      <td className="px-3 py-2 font-medium">{method}</td>
                      <td className="px-3 py-2"><code>{endpoint}</code></td>
                      <td className="px-3 py-2 text-slate-600">{purpose}</td>
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
