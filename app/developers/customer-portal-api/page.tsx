import type { Metadata } from 'next'
import type { ReactNode } from 'react'
import { CopyCodeBlock } from '@/components/developers/CopyCodeBlock'
import { PUBLIC_API_ENDPOINT_ROWS } from '@/lib/api/publicRouteRegistry'
import { STAFF_ONBOARDING_CONTRACT_VERSION } from '@/lib/staff-api/onboardingContract'
import {
  API_DOCUMENTATION_VERSION,
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

const documentationVersion = API_DOCUMENTATION_VERSION

function Section({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <section id={id} className="scroll-mt-24 space-y-5 border-b border-slate-200 pb-10">
      <h2 className="text-2xl font-semibold tracking-tight text-slate-950">{title}</h2>
      {children}
    </section>
  )
}

function EndpointTable({ rows, label }: { rows: readonly (readonly [string, string, string, string])[]; label: string }) {
  return (
    <div role="region" aria-label={label} tabIndex={0} className="min-w-0 rounded-xl border border-slate-200 bg-white text-base leading-7 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-600">
      <ul className="divide-y divide-slate-200">
        {rows.map(([method, path, scope, description]) => (
          <li key={`${method}:${path}`} className="min-w-0 space-y-4 p-5 sm:p-6">
            <div className="min-w-0 space-y-3">
              <span className="inline-block rounded-md bg-emerald-50 px-3 py-1 font-mono text-base font-semibold text-emerald-900">{method}</span>
              <div role="group" aria-label={`${method} ${path} endpoint`} tabIndex={0} className="overflow-x-auto rounded-lg bg-slate-50 p-3 [overflow-wrap:normal] [word-break:normal] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-600">
                <code className="block whitespace-pre font-mono text-base leading-7">{path}</code>
              </div>
            </div>
            <p className="text-base leading-7 text-slate-700 [overflow-wrap:normal] [word-break:normal]">{description}</p>
            <div className="min-w-0 space-y-2">
              <p className="text-base font-semibold text-slate-950">Required scope</p>
              <div role="group" aria-label={`Required scope for ${method} ${path}`} tabIndex={0} className="overflow-x-auto [overflow-wrap:normal] [word-break:normal] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-600">
                <code className="block whitespace-pre font-mono text-base leading-7 text-slate-700">{scope || 'Public'}</code>
              </div>
            </div>
          </li>
        ))}
      </ul>
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
    "method": "website_acceptance",
    "acceptedAt": "2026-08-19T10:00:00.000Z",
    "textVersionId": "00000000-0000-4000-8000-000000000001",
    "ipAddress": "192.0.2.10",
    "userAgent": "<customer browser user agent>"
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
        "withdrawal_deadline_at": "2026-09-02T21:59:59.999999Z",
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
        <aside className="min-w-0">
          <nav className="lg:sticky lg:top-8" aria-label="API documentation">
            <details className="rounded-xl border border-slate-200 bg-white p-4 lg:hidden">
              <summary className="cursor-pointer text-base font-semibold text-slate-950">Jump to section</summary>
              <div className="mt-3 grid gap-3 text-base text-slate-700 sm:grid-cols-2">
            <a className="block hover:text-slate-950" href="#overview">Overview</a>
            <a className="block hover:text-slate-950" href="#responsibilities">Responsibilities</a>
            <a className="block hover:text-slate-950" href="#authentication">Authentication</a>
            <a className="block hover:text-slate-950" href="#checkout">Website checkout</a>
            <a className="block hover:text-slate-950" href="#status">Status & lifecycle</a>
            <a className="block hover:text-slate-950" href="#customer-portal">Customer Portal</a>
            <a className="block hover:text-slate-950" href="#partner-api">Partner API</a>
            <a className="block hover:text-slate-950" href="#webhooks">Webhooks</a>
            <a className="block hover:text-slate-950" href="/developers/staff-api">Staff API</a>
            <a className="block hover:text-slate-950" href="#reliability">Reliability</a>
            <a className="block hover:text-slate-950" href="#errors">Errors</a>
            <a className="block hover:text-slate-950" href="#endpoints">Endpoint reference</a>
              </div>
            </details>
            <div className="hidden space-y-2 text-sm text-slate-600 lg:block">
            <a className="block hover:text-slate-950" href="#overview">Overview</a>
            <a className="block hover:text-slate-950" href="#responsibilities">Responsibilities</a>
            <a className="block hover:text-slate-950" href="#authentication">Authentication</a>
            <a className="block hover:text-slate-950" href="#checkout">Website checkout</a>
            <a className="block hover:text-slate-950" href="#status">Status & lifecycle</a>
            <a className="block hover:text-slate-950" href="#customer-portal">Customer Portal</a>
            <a className="block hover:text-slate-950" href="#partner-api">Partner API</a>
            <a className="block hover:text-slate-950" href="#webhooks">Webhooks</a>
            <a className="block hover:text-slate-950" href="/developers/staff-api">Staff API</a>
            <a className="block hover:text-slate-950" href="#reliability">Reliability</a>
            <a className="block hover:text-slate-950" href="#errors">Errors</a>
            <a className="block hover:text-slate-950" href="#endpoints">Endpoint reference</a>
            </div>
          </nav>
        </aside>

        <article className="min-w-0 space-y-10 wrap-anywhere">
          <header id="overview" className="scroll-mt-24 space-y-5">
            <div className="text-sm font-medium text-slate-500">
              Gridex Developers · Documentation {documentationVersion} · Response schema {WEBSITE_INTEGRATION_CONTRACT_VERSION}
            </div>
            <h1 className="text-4xl font-semibold tracking-tight text-slate-950">Gridex API</h1>
            <p className="max-w-4xl text-lg leading-8 text-slate-600">
              Build electricity retail websites, customer portals and backend integrations on one authoritative API.
              Gridex provides published offers, pricing, legal documents, customer and contract lifecycle state,
              customer portal data and signed webhooks. Your integration stays focused on the customer experience.
            </p>
            <p className="max-w-4xl text-base leading-7 text-slate-700">
              You do not need to match the latest documentation revision exactly to use a supported API version. Documentation updates do not change the business response schema or require an integration upgrade. Earlier supported V1 response profiles remain available; see the compatibility policy and migration guide. Independent Staff onboarding uses its own schema, {STAFF_ONBOARDING_CONTRACT_VERSION}.
            </p>
            <p className="max-w-4xl text-base leading-7 text-slate-700">
              The API is available for integration development. Production use requires the deployed API and database prerequisites plus an active API credential for your organization, the required scopes and customer identity linking. Verify authenticated reads, writes, audit attribution and safe retries for the intended organization before go-live. A published specification or passing source checks do not by themselves qualify that organization&apos;s live business flow.
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
            <CopyCodeBlock code={`GRIDEX_API_KEY=gridex_live_xxxxxxxxx\n\nAuthorization: Bearer $GRIDEX_API_KEY`} language="text" label="Authentication example" />
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
            <CopyCodeBlock code={checkoutRequest} language="json" label="Checkout request example" />
            <p className="leading-7 text-slate-700">
              For automated power-of-attorney email, record the customer’s IP at acceptance and send it as
              <code> powerOfAttorney.ipAddress</code> from your trusted backend, with the original
              <code> acceptedAt</code>. Gridex creates a stable verification number and archives the accepted text,
              scopes and evidence as a PDF, with the verification number on every page. The IP of your API server
              is recorded separately. A form click or <code>method: bankid</code> does not prove a verified BankID signature.
              BankID is optional; missing evidence blocks external email until completed. Organization users can retrieve
              their organization’s PDFs in OPS under Fullmakter.
            </p>
            <p className="text-sm leading-6 text-slate-600">
              The legal references, hashes and versions in this example are placeholders. In production, copy the exact values returned by the legal-bundle endpoint. Do not generate or modify them locally.
            </p>
            <h3 className="text-lg font-semibold text-slate-950">Successful checkout response</h3>
            <p className="leading-7 text-slate-700">
              The immediate customer-facing checkout result is returned in <code>data.checkout</code>. Use that object for the post-submit UI instead of deriving success from internal processing states.
            </p>
            <CopyCodeBlock code={checkoutResponse} language="json" label="Checkout response example" />
            <p className="text-sm leading-6 text-slate-600">
              These illustrative timestamps show the deadline rule for newly signed qualifying private distance agreements: the end of the fourteenth calendar day after acceptance in Europe/Stockholm. Use the stored deadline returned by Gridex. Previously frozen agreements retain their recorded deadline; confirmation delivery does not change it.
            </p>
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
            <CopyCodeBlock code={statusResponse} language="json" label="Application status example" />
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
            <p className="leading-7 text-slate-700">
              For customer sync, <code>authenticated_user_reference</code> is the authenticated account subject from your organization&apos;s login system. It must resolve an already linked active account in the API credential&apos;s organization. An unlinked, disabled or other-organization subject does not grant access or create a link.
            </p>
            <h3 className="text-lg font-semibold text-slate-950">Support cases and attachments</h3>
            <p className="leading-7 text-slate-700">
              Your support page can open cases, exchange messages and attach files with the explicit <code>customer_support.read</code> and <code>customer_support.write</code> scopes.
              Your staff handle the same cases in OPS, including cases that continue over the phone. Only customer-visible messages and released files are returned; internal notes and staff-only files never are.
              Upload a file as the raw request body (<code>application/pdf</code>, <code>image/png</code> or <code>image/jpeg</code>, at most 4&nbsp;MB) with an <code>Idempotency-Key</code>.
              Every file is quarantined and released only after a content check; rejected files return <code>422 attachment_rejected</code> and are never served.
            </p>
            <h3 className="text-lg font-semibold text-slate-950">Verified customer login (optional)</h3>
            <p className="leading-7 text-slate-700">
              Your organization can let Gridex verify the end customer&apos;s own login (OPS → Inställningar → Kundinloggning). Your server then forwards the login&apos;s signed assertion in <code>x-gridex-customer-assertion</code>:
              a compact JWS (RS256, PS256 or ES256) with your organization&apos;s <code>iss</code> and <code>aud</code>, <code>sub</code> = the linked portal user id, <code>exp</code> at most 15 minutes after <code>iat</code> and a unique <code>jti</code>.
              In report mode a missing or invalid assertion is only logged; when verification is required the API returns <code>403 customer_assertion_required</code> or <code>403 customer_assertion_invalid</code>. Organizations without a configuration are unaffected.
            </p>
            <div role="group" aria-labelledby="poa-archive-heading" className="space-y-6 rounded-2xl border border-slate-200 bg-slate-50 p-5 text-base leading-7 text-slate-700 sm:p-6 [&_code]:break-words [&_code]:text-[0.95em]">
              <h3 id="poa-archive-heading" className="text-xl font-semibold text-slate-950">Archived powers of attorney: PDF and verification</h3>
              <p>List archived powers of attorney, verify the original file and let the customer download a verified PDF through your portal.</p>
              <div className="space-y-3">
                <h4 className="text-lg font-semibold text-slate-950">Access requirements</h4>
                <ul className="list-disc space-y-2 pl-5">
                  <li>A fresh, verified <code>x-gridex-customer-assertion</code> and an active linked customer in the API key&apos;s organization.</li>
                  <li>Both scopes: <code>customer_power_of_attorney.read</code> and <code>customer_documents.read</code>.</li>
                  <li>A configured identity provider. These requirements also apply in report mode; an unverified assertion does not authorize access.</li>
                </ul>
                <p>Keep the API key and assertion on your trusted server. Offer the download only to the authenticated customer through your portal.</p>
              </div>
              <div className="space-y-3">
                <h4 className="text-lg font-semibold text-slate-950">List, verify and download</h4>
                <ol className="list-decimal space-y-4 pl-5">
                  <li>
                    <strong>Find the archive.</strong> Call <code>GET /customer/powers-of-attorney/evidence</code>.
                    The status <code>archived_unverified</code> describes metadata only; it does not verify the file.
                  </li>
                  <li>
                    <strong>Verify the original.</strong> Use the returned verification reference with{' '}
                    <code>GET /customer/powers-of-attorney/evidence/&#123;verificationReference&#125;?format=json</code>.
                    The optional <code>sha256</code> query compares your supplied digest. A mismatch returns{' '}
                    <code>submitted_sha256_matches: false</code> without changing the archive.
                  </li>
                  <li>
                    <strong>Download the PDF.</strong> Use the same endpoint with <code>format=pdf</code> to download the verified PDF, up to 15 MiB.
                  </li>
                </ol>
              </div>
              <div className="space-y-3">
                <h4 className="text-lg font-semibold text-slate-950">What verification means</h4>
                <p>These GET requests never generate a PDF or create consent. Missing original IP or time evidence remains missing.</p>
                <p><code>pdf_signature_validation: not_performed</code> means that cryptographic PDF-signature and BankID validation have not been performed.</p>
              </div>
              <p>
                Full schemas, limits and error responses: <a className="underline" href="/api/v1/openapi/poa-archive-v1.json">current POA archive OpenAPI</a>
                {' '}or <a className="underline" href="/api/v1/openapi/2026-10-19.1/poa-archive-v1.json">pinned release 2026-10-19.1</a>.
                Existing Website and Customer Portal contract releases are unchanged.
              </p>
            </div>
            <EndpointTable rows={customerPortalRows} label="Customer Portal endpoints" />
          </Section>

          <Section id="partner-api" title="6. Partner API">
            <p className="leading-7 text-slate-700">
              The Partner API is a streamlined backend-to-backend interface for integrations that need to create customers, sites and contracts,
              retrieve operational data or subscribe to contract-status changes. Gridex manages the account configuration and product mapping outside the API;
              the partner sends business data and uses the public references returned in responses.
            </p>
            <h3 className="text-lg font-semibold text-slate-950">Create a contract</h3>
            <CopyCodeBlock code={partnerContractExample} language="json" label="Partner contract example" />
            <h3 className="text-lg font-semibold text-slate-950">Create a webhook subscription</h3>
            <CopyCodeBlock code={partnerWebhookSubscriptionExample} language="json" label="Partner webhook subscription example" />
            <EndpointTable rows={partnerEndpointRows} label="Partner API endpoints" />
          </Section>

          <Section id="webhooks" title="7. Webhooks">
            <p className="leading-7 text-slate-700">
              Webhooks are signed change notifications. Verify the HMAC-SHA256 signature against the raw request body and timestamp,
              reject stale timestamps, and deduplicate by event or delivery identifier before applying side effects.
              When you need the latest complete state, use the webhook as a signal and retrieve the corresponding resource from Gridex.
            </p>
            <CopyCodeBlock code={webhookExample} language="json" label="Webhook event example" />
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
            <CopyCodeBlock code={errorExample} language="json" label="Error response example" />
          </Section>

          <Section id="endpoints" title="10. Endpoint reference">
            <p className="leading-7 text-slate-700">
              This table shows the current integration endpoints. Historical immutable OpenAPI releases and internal diagnostics are intentionally omitted from the human-readable guide.
            </p>
            <EndpointTable rows={websiteRows} label="Website API endpoints" />
          </Section>
        </article>
      </div>
    </main>
  )
}
