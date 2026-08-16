import type { Metadata } from 'next'
import type { ReactNode } from 'react'
import { CopyCodeBlock } from '@/components/developers/CopyCodeBlock'
import { PARTNER_API_BASE_URL, PARTNER_API_VERSION } from '@/lib/partner-api/openApi'

export const metadata: Metadata = {
  title: 'Partner API v1 | Gridex Developers',
  description:
    'Canonical backend-to-backend API for electricity suppliers: contracts, customers, sites, invoices, measurements and signed change notifications.',
}

export const revalidate = 3600

const endpoints = [
  ['POST', '/contract', 'Register customer, site and contract atomically'],
  ['GET', '/contract/{contract_reference}', 'Get a contract'],
  ['GET', '/contract/{contract_reference}/state', 'Get current contract state'],
  ['POST', '/customer', 'Create a customer'],
  ['GET', '/customer/{customer_reference}', 'Get a customer'],
  ['POST', '/customer/{customer_reference}/site', 'Create a site for a customer'],
  ['GET', '/customer/{customer_reference}/site/{site_reference}', 'Get a site'],
  ['POST', '/customer/{customer_reference}/site/{site_reference}/powerofattorney', 'Register signed power of attorney'],
  ['GET', '/customer/{customer_reference}/site/{site_reference}/powerofattorney', 'Get latest power of attorney'],
  ['GET', '/customer/{customer_reference}/site/{site_reference}/invoice', 'List invoices for a site'],
  ['GET', '/invoice/{invoice_reference}', 'Get an invoice'],
  ['GET', '/invoice/{invoice_reference}/pdf', 'Get authorized invoice PDF descriptor'],
  ['GET', '/customer/{customer_reference}/site/{site_reference}/measurement', 'Get 15-minute or hourly measurements'],
  ['GET', '/webhook/subscription', 'List webhook subscriptions for this API client'],
  ['POST', '/webhook/subscription', 'Create a webhook subscription'],
  ['DELETE', '/webhook/subscription/{webhook_subscription_reference}', 'Delete a webhook subscription'],
] as const

const events = [
  'customer.created',
  'customer.updated',
  'site.created',
  'site.updated',
  'power_of_attorney.created',
  'contract.created',
  'contract.status_changed',
  'invoice.created',
  'invoice.updated',
] as const

const createContract = `curl -X POST "${PARTNER_API_BASE_URL}/contract" \\
  -H "Authorization: Bearer $GRIDEX_API_KEY" \\
  -H "Content-Type: application/json" \\
  -H "Idempotency-Key: order-20260816-00042" \\
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
    }
  },
  "request_id": "...",
  "api_version": "${PARTNER_API_VERSION}"
}`

const resourceFlow = `POST /customer
POST /customer/{customer_reference}/site
POST /customer/{customer_reference}/site/{site_reference}/powerofattorney

GET /customer/{customer_reference}
GET /customer/{customer_reference}/site/{site_reference}
GET /customer/{customer_reference}/site/{site_reference}/powerofattorney`

const readFlow = `GET /contract/{contract_reference}/state
GET /customer/{customer_reference}/site/{site_reference}/invoice?from_date=2026-01-01&to_date=2026-01-31
GET /invoice/{invoice_reference}
GET /invoice/{invoice_reference}/pdf
GET /customer/{customer_reference}/site/{site_reference}/measurement?from_date=2026-01-01&to_date=2026-01-31&resolution=15m`

const webhookCreate = `curl -X POST "${PARTNER_API_BASE_URL}/webhook/subscription" \\
  -H "Authorization: Bearer $GRIDEX_API_KEY" \\
  -H "Content-Type: application/json" \\
  -H "Idempotency-Key: webhook-primary-v1" \\
  -d '{
    "name": "Production events",
    "endpoint_url": "https://partner.example.com/webhooks/gridex",
    "event_types": ["contract.created", "contract.status_changed", "invoice.created"],
    "signing_secret": "generate-and-store-at-least-32-random-characters"
  }'`

const webhookPayload = `{
  "event_id": "event_...",
  "event_type": "contract.status_changed",
  "created_at": "2026-08-16T13:05:12Z",
  "resource": {
    "type": "contract",
    "reference": "contract_..."
  },
  "customer": {
    "customer_reference": "customer_...",
    "customer_number": "DX-..."
  },
  "data": {
    "status": "active",
    "previous_status": "signed"
  },
  "api_version": "${PARTNER_API_VERSION}",
  "delivery_id": "delivery_..."
}`

const errorExample = `{
  "error": {
    "code": "customer_not_found",
    "message": "Customer not found."
  },
  "request_id": "...",
  "api_version": "${PARTNER_API_VERSION}"
}`

const Section = ({ id, title, children }: { id: string; title: string; children: ReactNode }) => (
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
            <a className="block hover:text-slate-950" href="#contract">Register contract</a>
            <a className="block hover:text-slate-950" href="#resources">Customers & sites</a>
            <a className="block hover:text-slate-950" href="#read">Read data</a>
            <a className="block hover:text-slate-950" href="#webhooks">Webhooks</a>
            <a className="block hover:text-slate-950" href="#errors">Errors & retries</a>
            <a className="block hover:text-slate-950" href="#security">Security</a>
            <a className="block hover:text-slate-950" href="#endpoints">Endpoints</a>
          </nav>
        </aside>

        <article className="min-w-0 space-y-10">
          <header className="space-y-4">
            <div className="text-sm font-medium text-slate-500">Gridex Developers · v{PARTNER_API_VERSION}</div>
            <h1 className="text-4xl font-semibold tracking-tight text-slate-950">Partner API v1</h1>
            <p className="max-w-3xl text-lg leading-8 text-slate-600">
              One small backend-to-backend API for supplier integrations: register contracts, read
              customer/site/invoice data, read contract state and receive signed change notifications.
            </p>
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-700">
              <strong>Base URL:</strong> <code>{PARTNER_API_BASE_URL}</code>
              <br />
              <strong>OpenAPI:</strong>{' '}
              <a className="underline" href="/api/partner/v1/openapi.json">/api/partner/v1/openapi.json</a>
            </div>
          </header>

          <Section id="overview" title="1. Integration model">
            <p className="leading-7 text-slate-700">
              Your backend calls Gridex. Your mobile app, website and customer portal call your own
              backend. The Gridex API key must never be shipped to a browser or mobile application.
            </p>
            <p className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm leading-6 text-amber-950">
              <strong>Company setup is intentionally outside this API.</strong> Gridex manages API
              credentials, permissions, products, market/Ediel configuration and internal platform
              settings. Integrators only work with business resources.
            </p>
            <p className="leading-7 text-slate-700">
              The credential determines the company context. Requests cannot select another company.
              Public references such as <code>customer_reference</code>, <code>site_reference</code>,
              <code>contract_reference</code> and <code>invoice_reference</code> are used instead of
              internal database IDs.
            </p>
          </Section>

          <Section id="auth" title="2. Authentication">
            <CopyCodeBlock code="Authorization: Bearer $GRIDEX_API_KEY" language="text" />
            <p className="leading-7 text-slate-700">
              Keep the key server-side. Gridex grants only the permissions needed by the integration.
              Every write requires an <code>Idempotency-Key</code>. Retry the same business operation
              with the same key and the same payload; use a new key for a new operation.
            </p>
          </Section>

          <Section id="contract" title="3. Register a contract">
            <p className="leading-7 text-slate-700">
              For most suppliers, <code>POST /contract</code> is the primary write endpoint. It
              registers customer, site and contract in one database transaction. Signed power-of-
              attorney evidence can be included when required.
            </p>
            <CopyCodeBlock code={createContract} language="bash" />
            <h3 className="text-lg font-semibold text-slate-950">Response</h3>
            <CopyCodeBlock code={createContractResponse} language="json" />
          </Section>

          <Section id="resources" title="4. Customers, sites and power of attorney">
            <p className="leading-7 text-slate-700">
              Use the individual resources only when your integration creates them in separate steps.
              Nested routes enforce that the customer and site belong together and that both belong to
              the company bound to the API credential.
            </p>
            <CopyCodeBlock code={resourceFlow} language="text" />
            <p className="text-sm leading-6 text-slate-600">
              Optional power-of-attorney evidence is PDF-only, limited to 5 MB and stored privately.
              Internal storage paths are not returned through the Partner API.
            </p>
          </Section>

          <Section id="read" title="5. Contract state, invoices and measurements">
            <CopyCodeBlock code={readFlow} language="text" />
            <p className="leading-7 text-slate-700">
              Measurement resolution is <code>15m</code> or <code>1h</code>. Invoice and measurement
              queries are scoped to the customer/site path. The invoice PDF endpoint returns an
              authorized HTTPS descriptor only when a document exists.
            </p>
          </Section>

          <Section id="webhooks" title="6. Change notifications">
            <p className="leading-7 text-slate-700">
              Webhooks tell you that a resource changed. They are not a second source of truth. After
              receiving an event, fetch the current resource from its GET endpoint.
            </p>
            <CopyCodeBlock code={webhookCreate} language="bash" />
            <div className="grid gap-3 sm:grid-cols-2">
              {events.map((event) => (
                <code key={event} className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-800">
                  {event}
                </code>
              ))}
            </div>
            <h3 className="text-lg font-semibold text-slate-950">Webhook payload</h3>
            <CopyCodeBlock code={webhookPayload} language="json" />
            <p className="text-sm leading-6 text-slate-600">
              Gridex signs the exact raw body with HMAC-SHA256 and sends <code>x-gridex-timestamp</code>,
              <code> x-gridex-signature</code>, <code>x-gridex-event-id</code> and
              <code> x-gridex-delivery-id</code>. The partner-generated signing secret is stored in
              Vault and is never returned. Webhook targets must use public HTTPS endpoints; private,
              loopback and link-local network targets are rejected.
            </p>
          </Section>

          <Section id="errors" title="7. Errors and safe retries">
            <CopyCodeBlock code={errorExample} language="json" />
            <p className="leading-7 text-slate-700">
              Use <code>request_id</code> when contacting Gridex support. Treat <code>401</code> and
              <code>403</code> as authentication/permission failures, <code>404</code> as a missing
              resource, <code>409</code> as a conflicting/replayed business resource and
              <code>422</code> as invalid input. Retry transient server/network failures with backoff;
              never change the idempotency key for an identical retry.
            </p>
          </Section>

          <Section id="security" title="8. Security model">
            <ul className="list-disc space-y-2 pl-5 leading-7 text-slate-700">
              <li>API keys are server-side credentials and bind requests to exactly one company.</li>
              <li>Scopes are checked per operation; no client can request or elevate its own scopes.</li>
              <li>Nested customer/site routes verify ownership before returning data.</li>
              <li>Internal UUIDs, storage paths and signing secrets are not part of public responses.</li>
              <li>Writes are idempotent; contract registration is transactional.</li>
              <li>Privileged database functions are service-role only.</li>
              <li>Webhook secrets are stored in Vault and outbound targets are public-HTTPS validated and DNS-pinned for delivery.</li>
            </ul>
          </Section>

          <Section id="endpoints" title="9. Endpoint summary">
            <div className="overflow-x-auto rounded-xl border border-slate-200">
              <table className="min-w-full divide-y divide-slate-200 text-left text-sm">
                <thead className="bg-slate-50 text-slate-700">
                  <tr>
                    <th className="px-4 py-3 font-semibold">Method</th>
                    <th className="px-4 py-3 font-semibold">Endpoint</th>
                    <th className="px-4 py-3 font-semibold">Purpose</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {endpoints.map(([method, endpoint, purpose]) => (
                    <tr key={`${method}-${endpoint}`}>
                      <td className="whitespace-nowrap px-4 py-3 font-mono">{method}</td>
                      <td className="whitespace-nowrap px-4 py-3 font-mono">{endpoint}</td>
                      <td className="px-4 py-3 text-slate-700">{purpose}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="text-sm leading-6 text-slate-600">
              Existing plural Partner API paths and older Website/Customer Portal routes remain only
              for compatibility with already connected integrations. New supplier integrations should
              use the canonical <code>/api/partner/v1</code> paths above.
            </p>
          </Section>
        </article>
      </div>
    </main>
  )
}
