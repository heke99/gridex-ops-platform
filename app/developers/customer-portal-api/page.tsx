import type { Metadata } from 'next'
import type { ReactNode } from 'react'
import { CopyCodeBlock } from '@/components/developers/CopyCodeBlock'
import { PUBLIC_API_ENDPOINT_ROWS } from '@/lib/api/publicRouteRegistry'
import {
  CUSTOMER_PORTAL_OPENAPI_URL,
  WEBSITE_INTEGRATION_BASE_URL,
  WEBSITE_INTEGRATION_CONTRACT_VERSION,
  WEBSITE_INTEGRATION_OPENAPI_URL,
} from '@/lib/integrations/websiteIntegrationContract'
import {
  PARTNER_API_BASE_URL,
  PARTNER_API_VERSION,
  partnerOpenApi,
} from '@/lib/partner-api/openApi'

export const metadata: Metadata = {
  title: 'Gridex API Documentation | Website, Customer Portal & Webhooks',
  description:
    'Production integration guide for the Gridex Website API, Customer Portal API, Partner API and signed webhooks.',
}

export const revalidate = 3600

function Section({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <section id={id} className="scroll-mt-24 space-y-5 border-b border-slate-200 pb-10">
      <h2 className="text-2xl font-semibold tracking-tight text-slate-950">{title}</h2>
      {children}
    </section>
  )
}

function EndpointTable({ rows }: { rows: readonly (readonly [string, string, string, string])[] }) {
  return (
    <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
      <table className="min-w-full divide-y divide-slate-200 text-left text-sm">
        <thead className="bg-slate-50 text-slate-700">
          <tr>
            <th className="px-4 py-3 font-semibold">Method</th>
            <th className="px-4 py-3 font-semibold">Endpoint</th>
            <th className="px-4 py-3 font-semibold">Required scope</th>
            <th className="px-4 py-3 font-semibold">Purpose</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100 text-slate-700">
          {rows.map(([method, path, scope, description]) => (
            <tr key={`${method}:${path}`}>
              <td className="whitespace-nowrap px-4 py-3 font-mono text-xs font-semibold text-slate-950">{method}</td>
              <td className="whitespace-nowrap px-4 py-3 font-mono text-xs">{path}</td>
              <td className="px-4 py-3 font-mono text-xs">{scope || 'Public'}</td>
              <td className="min-w-[320px] px-4 py-3">{description}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function ResponsibilityCard({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-5">
      <h3 className="mb-3 text-base font-semibold text-slate-950">{title}</h3>
      <ul className="list-disc space-y-2 pl-5 text-sm leading-6 text-slate-700">{children}</ul>
    </div>
  )
}

function partnerRows(): Array<readonly [string, string, string, string]> {
  const rows: Array<readonly [string, string, string, string]> = []
  for (const [path, pathItem] of Object.entries(partnerOpenApi.paths)) {
    const item = pathItem as Record<string, unknown>
    for (const method of ['get', 'post', 'put', 'patch', 'delete']) {
      const operation = item[method]
      if (!operation || typeof operation !== 'object' || Array.isArray(operation)) continue
      const summary = String((operation as Record<string, unknown>).summary ?? '')
      rows.push([method.toUpperCase(), path, 'Bearer API key', summary])
    }
  }
  return rows
}

const checkoutRequest = `POST ${WEBSITE_INTEGRATION_BASE_URL}/website/customer-applications
Authorization: Bearer $GRIDEX_API_KEY
Idempotency-Key: checkout_01JEXAMPLE000000000000000
Content-Type: application/json

{
  "external_customer_id": "customer_12345",
  "auth_user_id": "4f6d1e3a-1e84-4c3f-97be-03ac98f21916",
  "customer_portal_user_id": "4f6d1e3a-1e84-4c3f-97be-03ac98f21916",
  "offer_reference": "offer_variable_monthly",
  "quote_reference": "quote_01JEXAMPLE000000000000000",
  "price_option_reference": "variable_monthly_standard",
  "invoice_delivery_method": "email",
  "selected_component_references": [],
  "site_count": 1,
  "legal_bundle_version": "2026-08-19",
  "legal_acceptances": [
    {
      "requirement_code": "agreement",
      "document_reference": "legal_customer_document_example",
      "document_version": "3",
      "document_hash": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      "accepted": true,
      "accepted_at": "2026-08-19T10:00:00.000Z"
    },
    {
      "requirement_code": "power_of_attorney",
      "document_reference": "legal_customer_document_poa_example",
      "document_version": "2",
      "document_hash": "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
      "accepted": true,
      "accepted_at": "2026-08-19T10:00:00.000Z"
    }
  ],
  "customer": {
    "customer_type": "private",
    "first_name": "Anna",
    "last_name": "Andersson",
    "personal_number": "19900101-1234",
    "email": "anna@example.se",
    "phone": "+46701234567"
  },
  "site": {
    "street": "Example Street 1",
    "postal_code": "11122",
    "city": "Stockholm",
    "country": "SE",
    "annual_consumption_kwh": 4500
  },
  "powerOfAttorney": {
    "accepted": true,
    "scope": ["supplier_switch", "facility_information_lookup"],
    "signerName": "Anna Andersson",
    "signerIdentityNumber": "19900101-1234",
    "method": "online",
    "acceptedAt": "2026-08-19T10:00:00.000Z",
    "textVersionId": "00000000-0000-4000-8000-000000000001"
  }
}`

const checkoutResponse = `{
  "data": {
    "application_number": "APP-2026-000123",
    "customer_number": "DX-100123",
    "contract_number": "AVT-100123",
    "contract_status": "signed",
    "signed_at": "2026-08-19T10:00:01.000Z",
    "checkout": {
      "outcome": "agreement_signed",
      "thank_you_ready": true,
      "page_state": "success",
      "customer_action_required": false,
      "application": {
        "application_number": "APP-2026-000123",
        "status": "accepted"
      },
      "agreement": {
        "status": "signed",
        "contract_number": "AVT-100123",
        "signed_at": "2026-08-19T10:00:01.000Z",
        "withdrawal_deadline_at": "2026-09-02T10:00:01.000Z",
        "signature_snapshot_sha256": "<sha256>"
      },
      "confirmation_email": {
        "expected": true,
        "status": "pending"
      },
      "status_path": "/api/v1/website/customer-applications/APP-2026-000123"
    }
  },
  "request_id": "1eb19095-9fab-4c38-b6db-d28bd0e924d9",
  "contract_schema_version": "${WEBSITE_INTEGRATION_CONTRACT_VERSION}"
}`

const statusResponse = `GET ${WEBSITE_INTEGRATION_BASE_URL}/website/customer-applications/APP-2026-000123
Authorization: Bearer $GRIDEX_API_KEY

{
  "data": {
    "application_number": "APP-2026-000123",
    "status": "processing",
    "contract_number": "AVT-100123",
    "contract_status": "signed",
    "signed_at": "2026-08-19T10:00:01.000Z",
    "communication": {
      "pending": false,
      "sent": [
        { "event_type": "contract.confirmation_sent", "status": "delivered" }
      ]
    },
    "checkout": {
      "thank_you_ready": true,
      "page_state": "success",
      "confirmation_email": { "expected": true, "status": "delivered" }
    }
  },
  "request_id": "1eb19095-9fab-4c38-b6db-d28bd0e924d9",
  "contract_schema_version": "${WEBSITE_INTEGRATION_CONTRACT_VERSION}"
}`

const partnerContractExample = `POST ${PARTNER_API_BASE_URL}/contract
Authorization: Bearer $GRIDEX_API_KEY
Idempotency-Key: partner_contract_01JEXAMPLE000000000
Content-Type: application/json

{
  "customer": {
    "first_name": "Anna",
    "last_name": "Andersson",
    "soc_id": "19900101-1234",
    "customer_type": "PRIVATE",
    "email": "anna@example.se"
  },
  "site": {
    "address": "Example Street 1",
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

const partnerWebhookSubscriptionExample = `POST ${PARTNER_API_BASE_URL}/webhook/subscription
Authorization: Bearer $GRIDEX_API_KEY
Idempotency-Key: partner_webhook_01JEXAMPLE000000000
Content-Type: application/json

{
  "webhook_event": "CONTRACT_STATUS_CHANGE",
  "target_url": "https://partner.example.com/webhooks/gridex",
  "notification_email": "integration@example.com",
  "signing_secret": "<at-least-32-random-characters>"
}`

const webhookExample = `POST https://partner.example.com/webhooks/gridex
X-Gridex-Timestamp: 1787130000
X-Gridex-Signature: sha256=<hmac_sha256>
X-Gridex-Event-ID: event_...
X-Gridex-Delivery-ID: delivery_...
Content-Type: application/json

{
  "event_id": "event_...",
  "event_type": "customer_application.status_changed",
  "created_at": "2026-08-19T10:01:00.000Z",
  "aggregate": {
    "type": "website_customer_application",
    "reference": "APP-2026-000123"
  },
  "data": {
    "application_number": "APP-2026-000123",
    "status": "processing",
    "previous_status": "accepted"
  },
  "contract_schema_version": "${WEBSITE_INTEGRATION_CONTRACT_VERSION}"
}`

const errorExample = `{
  "error": {
    "code": "validation_error",
    "message": "The request could not be validated.",
    "retryable": false,
    "field": "customer.email",
    "blockers": []
  },
  "request_id": "1eb19095-9fab-4c38-b6db-d28bd0e924d9",
  "correlation_id": "1eb19095-9fab-4c38-b6db-d28bd0e924d9",
  "contract_schema_version": "${WEBSITE_INTEGRATION_CONTRACT_VERSION}"
}`

export default function CustomerPortalApiDocumentationPage() {
  const currentRows = PUBLIC_API_ENDPOINT_ROWS.filter(([, path]) => !path.includes('/openapi/2026-'))
  const customerPortalRows = currentRows.filter(([, path]) =>
    path.startsWith('/api/v1/customer/') || path.startsWith('/api/v1/customer-portal/'),
  )
  const websiteRows = currentRows.filter(([, path]) =>
    !path.startsWith('/api/v1/customer/') &&
    !path.startsWith('/api/v1/customer-portal/') &&
    !path.includes('/diagnostics') &&
    path !== '/api/v1/contracts',
  )
  const partnerEndpointRows = partnerRows()

  return (
    <main lang="en" className="mx-auto max-w-7xl px-5 py-12 sm:px-8 lg:px-10">
      <div className="grid gap-10 lg:grid-cols-[240px_minmax(0,1fr)]">
        <aside className="hidden lg:block">
          <nav className="sticky top-8 space-y-2 text-sm text-slate-600" aria-label="API documentation">
            <a className="block hover:text-slate-950" href="#overview">Overview</a>
            <a className="block hover:text-slate-950" href="#responsibilities">Responsibilities</a>
            <a className="block hover:text-slate-950" href="#authentication">Authentication</a>
            <a className="block hover:text-slate-950" href="#checkout">Website checkout</a>
            <a className="block hover:text-slate-950" href="#status">Status & lifecycle</a>
            <a className="block hover:text-slate-950" href="#customer-portal">Customer Portal</a>
            <a className="block hover:text-slate-950" href="#partner-api">Partner API</a>
            <a className="block hover:text-slate-950" href="#webhooks">Webhooks</a>
            <a className="block hover:text-slate-950" href="#reliability">Reliability</a>
            <a className="block hover:text-slate-950" href="#errors">Errors</a>
            <a className="block hover:text-slate-950" href="#endpoints">Endpoint reference</a>
          </nav>
        </aside>

        <article className="min-w-0 space-y-10">
          <header id="overview" className="scroll-mt-24 space-y-5">
            <div className="text-sm font-medium text-slate-500">
              Gridex Developers · API contract {WEBSITE_INTEGRATION_CONTRACT_VERSION}
            </div>
            <h1 className="text-4xl font-semibold tracking-tight text-slate-950">Gridex API</h1>
            <p className="max-w-4xl text-lg leading-8 text-slate-600">
              Build electricity retail websites, customer portals and backend integrations on one authoritative API.
              Gridex provides published offers, pricing, legal documents, customer and contract lifecycle state,
              customer portal data and signed webhooks. Your integration stays focused on the customer experience.
            </p>
            <div className="grid gap-4 md:grid-cols-2">
              <div className="rounded-xl border border-slate-200 bg-white p-4 text-sm leading-6 text-slate-700">
                <strong>Website & Customer Portal API</strong><br />
                <code>{WEBSITE_INTEGRATION_BASE_URL}</code><br /><br />
                <strong>OpenAPI</strong><br />
                <a className="break-all underline" href={WEBSITE_INTEGRATION_OPENAPI_URL}>{WEBSITE_INTEGRATION_OPENAPI_URL}</a><br />
                <a className="break-all underline" href={CUSTOMER_PORTAL_OPENAPI_URL}>{CUSTOMER_PORTAL_OPENAPI_URL}</a>
              </div>
              <div className="rounded-xl border border-slate-200 bg-white p-4 text-sm leading-6 text-slate-700">
                <strong>Partner API</strong><br />
                <code>{PARTNER_API_BASE_URL}</code><br /><br />
                <strong>Version</strong> {PARTNER_API_VERSION}<br />
                <strong>OpenAPI</strong><br />
                <a className="underline" href="/api/partner/v1/openapi.json">/api/partner/v1/openapi.json</a>
              </div>
            </div>
          </header>

          <Section id="responsibilities" title="1. Responsibilities">
            <p className="leading-7 text-slate-700">
              The integration boundary is deliberate: your application owns presentation and verified customer input;
              Gridex owns the authoritative electricity-retail business state and downstream processing.
            </p>
            <div className="grid gap-4 md:grid-cols-2">
              <ResponsibilityCard title="Gridex platform">
                <li>Associates each API key with the correct organization, configuration and permissions.</li>
                <li>Publishes the offers, price options, legal documents and acceptance requirements available to customers.</li>
                <li>Resolves price areas and creates authoritative quotes, including applicable fees, markups and pricing rules.</li>
                <li>Validates applications and prevents duplicate business writes through idempotent processing.</li>
                <li>Creates and maintains the authoritative customer, site, contract, legal-acceptance and signature records.</li>
                <li>Assigns public application, customer and contract numbers and returns stable public references.</li>
                <li>Runs the configured supplier-switch and facility-information lifecycle, including downstream market communication where required.</li>
                <li>Tracks confirmation delivery, customer-visible lifecycle status, metering data and invoice data exposed by the enabled services.</li>
              </ResponsibilityCard>
              <ResponsibilityCard title="Your integration">
                <li>Builds the website or application UI and keeps the Gridex API key on a trusted server only.</li>
                <li>Authenticates the end customer and sends a stable, verified customer identity from the server session.</li>
                <li>Displays Gridex-provided offer, quote and legal data without locally changing the authoritative calculation or document versions.</li>
                <li>Collects customer and site details, exact legal acceptance evidence and power-of-attorney evidence when required.</li>
                <li>Sends a stable <code>Idempotency-Key</code> for every write and stores the returned public application number.</li>
                <li>Uses documented response fields to drive the UI instead of interpreting internal processing states.</li>
                <li>Verifies webhook signatures, rejects stale requests and deduplicates deliveries before processing events.</li>
              </ResponsibilityCard>
            </div>
          </Section>

          <Section id="authentication" title="2. Authentication">
            <p className="leading-7 text-slate-700">
              Use the API key only from your backend. Gridex identifies the correct organization from the credential,
              so requests do not need internal database identifiers or organization-selection fields.
            </p>
            <CopyCodeBlock code={`GRIDEX_API_KEY=gridex_live_xxxxxxxxx\n\nAuthorization: Bearer $GRIDEX_API_KEY`} language="text" />
            <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm leading-6 text-amber-950">
              Never expose <code>GRIDEX_API_KEY</code> in browser JavaScript, a mobile application, logs, analytics events or client-visible environment variables.
            </div>
          </Section>

          <Section id="checkout" title="3. Website checkout">
            <p className="leading-7 text-slate-700">
              A production checkout should use Gridex as the source for the offer, price area, quote and legal documents.
              Submit the customer application only after the customer has accepted the exact published versions shown in the UI.
            </p>
            <ol className="list-decimal space-y-2 pl-5 text-slate-700">
              <li>Retrieve published offers with <code>GET /website/public-contracts</code>.</li>
              <li>Resolve the customer’s Swedish price area with <code>POST /website/energy-area/resolve</code>.</li>
              <li>Create the authoritative quote with <code>POST /website/quote</code> and validate it before final submission.</li>
              <li>Retrieve the exact legal bundle with <code>GET /website/legal-bundle</code> and display the required documents.</li>
              <li>Collect the customer’s explicit acceptance evidence and power of attorney when required.</li>
              <li>Submit the application with one stable <code>Idempotency-Key</code>.</li>
            </ol>
            <h3 className="text-lg font-semibold text-slate-950">Submit an application</h3>
            <CopyCodeBlock code={checkoutRequest} language="json" />
            <p className="text-sm leading-6 text-slate-600">
              The legal references, hashes and versions in this example are placeholders. In production, copy the exact values returned by the legal-bundle endpoint. Do not generate or modify them locally.
            </p>
            <h3 className="text-lg font-semibold text-slate-950">Successful checkout response</h3>
            <CopyCodeBlock code={checkoutResponse} language="json" />
            <div className="rounded-xl border border-slate-200 bg-white p-5 text-sm leading-7 text-slate-700">
              <strong>UI rule:</strong> show the final signed-agreement success state only when <code>checkout.thank_you_ready === true</code>.
              <br /><strong>success:</strong> the agreement is signed and no additional customer action is required.
              <br /><strong>success_action_required:</strong> the agreement is signed, but additional customer information is needed for downstream processing.
              <br /><strong>action_required:</strong> customer action is required before processing can continue.
              <br /><strong>processing:</strong> the application is accepted for processing; do not present it as a completed signed agreement unless the agreement fields confirm that state.
            </div>
          </Section>

          <Section id="status" title="4. Status and lifecycle">
            <p className="leading-7 text-slate-700">
              Store <code>application_number</code> after a successful submission. Use the application status endpoint after redirects,
              page refreshes and later visits. It returns the authoritative customer-facing state of the agreement and downstream processing.
            </p>
            <CopyCodeBlock code={statusResponse} language="json" />
            <p className="leading-7 text-slate-700">
              Agreement state and message-delivery state are separate. A confirmation email can still be queued while the agreement is already validly signed.
              Treat the documented delivery status as authoritative instead of assuming that an email was delivered because the agreement succeeded.
            </p>
          </Section>

          <Section id="customer-portal" title="5. Customer Portal API">
            <p className="leading-7 text-slate-700">
              The Customer Portal API exposes only data belonging to the verified linked customer identity. Use granular scopes and request only the capabilities your portal needs.
              Available resources include profile data, contracts, sites, invoices, metering values, documents, legal acceptances, powers of attorney, events and notifications.
            </p>
            <EndpointTable rows={customerPortalRows} />
          </Section>

          <Section id="partner-api" title="6. Partner API">
            <p className="leading-7 text-slate-700">
              The Partner API is a streamlined backend-to-backend interface for integrations that need to create customers, sites and contracts,
              retrieve operational data or subscribe to contract-status changes. Gridex manages the account configuration and product mapping outside the API;
              the partner sends business data and uses the public references returned in responses.
            </p>
            <h3 className="text-lg font-semibold text-slate-950">Create a contract</h3>
            <CopyCodeBlock code={partnerContractExample} language="json" />
            <h3 className="text-lg font-semibold text-slate-950">Create a webhook subscription</h3>
            <CopyCodeBlock code={partnerWebhookSubscriptionExample} language="json" />
            <EndpointTable rows={partnerEndpointRows} />
          </Section>

          <Section id="webhooks" title="7. Webhooks">
            <p className="leading-7 text-slate-700">
              Webhooks are signed change notifications. Verify the HMAC-SHA256 signature against the raw request body and timestamp,
              reject stale timestamps, and deduplicate by event or delivery identifier before applying side effects.
              When you need the latest complete state, use the webhook as a signal and retrieve the corresponding resource from Gridex.
            </p>
            <CopyCodeBlock code={webhookExample} language="json" />
            <p className="text-sm leading-6 text-slate-600">
              A temporary failure in your receiver does not change the underlying Gridex business event. Webhook delivery is retried independently according to the configured delivery policy.
            </p>
          </Section>

          <Section id="reliability" title="8. Reliability and performance">
            <div className="space-y-3 text-slate-700">
              <p><strong>Idempotency:</strong> every write that requires <code>Idempotency-Key</code> must reuse the same key only when retrying the exact same business request.</p>
              <p><strong>Caching:</strong> use <code>ETag</code> and <code>If-None-Match</code> for published offer feeds to avoid unnecessary transfers.</p>
              <p><strong>Checkout:</strong> use the POST response directly for the immediate success state instead of issuing a redundant status request.</p>
              <p><strong>Lifecycle updates:</strong> prefer signed webhooks when configured; use polling as a fallback with exponential backoff.</p>
              <p><strong>HTTP:</strong> reuse connections where your runtime supports it and keep all API calls server-to-server.</p>
              <p><strong>Observability:</strong> log the returned <code>request_id</code> with your own correlation identifier so support cases can be traced without exposing secrets or personal data.</p>
            </div>
          </Section>

          <Section id="errors" title="9. Errors and retries">
            <p className="leading-7 text-slate-700">
              API errors use one structured envelope. Inspect <code>error.code</code>, <code>error.retryable</code>, <code>error.field</code> and <code>error.blockers</code> rather than parsing human-readable messages.
              Include <code>request_id</code> when contacting Gridex support about a failed request.
            </p>
            <CopyCodeBlock code={errorExample} language="json" />
          </Section>

          <Section id="endpoints" title="10. Endpoint reference">
            <p className="leading-7 text-slate-700">
              This table shows the current integration endpoints. Historical immutable OpenAPI releases and internal diagnostics are intentionally omitted from the human-readable guide.
            </p>
            <EndpointTable rows={websiteRows} />
          </Section>
        </article>
      </div>
    </main>
  )
}
