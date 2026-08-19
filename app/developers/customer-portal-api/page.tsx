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
  title: 'Gridex API | Website, Mina sidor, Partner API & Webhooks',
  description:
    'Samlad API-dokumentation för tenanters hemsidor, kundportaler, partnerintegrationer, kundteckning, status, webhooks och backend-to-backend-flöden.',
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
    <div className="overflow-x-auto rounded-xl border border-slate-200">
      <table className="min-w-full divide-y divide-slate-200 text-left text-sm">
        <thead className="bg-slate-50 text-slate-700">
          <tr>
            <th className="px-4 py-3 font-semibold">Metod</th>
            <th className="px-4 py-3 font-semibold">Endpoint</th>
            <th className="px-4 py-3 font-semibold">Scope</th>
            <th className="px-4 py-3 font-semibold">Syfte</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100 bg-white text-slate-700">
          {rows.map(([method, path, scope, description]) => (
            <tr key={`${method}:${path}`}>
              <td className="whitespace-nowrap px-4 py-3 font-mono text-xs font-semibold text-slate-950">{method}</td>
              <td className="whitespace-nowrap px-4 py-3 font-mono text-xs">{path}</td>
              <td className="px-4 py-3 font-mono text-xs">{scope || 'Publik'}</td>
              <td className="min-w-[320px] px-4 py-3">{description}</td>
            </tr>
          ))}
        </tbody>
      </table>
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
Idempotency-Key: checkout_01J...
Content-Type: application/json

{
  "external_customer_id": "web_customer_123",
  "auth_user_id": "<verified-auth-uuid>",
  "customer_portal_user_id": "<same-linked-portal-uuid>",
  "offer_reference": "offer_...",
  "quote_reference": "quote_...",
  "legal_bundle_version": "...",
  "legal_acceptances": ["<exact accepted legal evidence>"],
  "customer": { "...": "..." },
  "site": { "...": "..." },
  "powerOfAttorney": { "...": "..." }
}`

const checkoutResponse = `{
  "data": {
    "application_number": "APP-2026-000123",
    "customer_number": "100123",
    "contract_number": "AVT-100123",
    "contract_status": "signed",
    "signed_at": "2026-08-19T10:00:00.000Z",
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
        "signed_at": "2026-08-19T10:00:00.000Z",
        "withdrawal_deadline_at": "2026-09-02T10:00:00.000Z",
        "signature_snapshot_sha256": "<sha256>"
      },
      "confirmation_email": {
        "expected": true,
        "status": "pending"
      },
      "status_path": "/api/v1/website/customer-applications/APP-2026-000123"
    }
  },
  "request_id": "...",
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
    "signed_at": "2026-08-19T10:00:00.000Z",
    "communication": {
      "source_of_truth": "tenant_email_outbox+communication_logs",
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
  }
}`

const webhookExample = `POST https://tenant.example.com/webhooks/gridex
X-Gridex-Timestamp: 1787130000
X-Gridex-Signature: sha256=<hmac_sha256>
X-Gridex-Event-ID: event_...
X-Gridex-Delivery-ID: delivery_...
Content-Type: application/json

{
  "event_id": "event_...",
  "event_type": "customer_application.status_changed",
  "tenant_reference": "tenant_...",
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

export default function CustomerPortalApiDocumentationPage() {
  const websiteRows = PUBLIC_API_ENDPOINT_ROWS.filter(([, path]) => !path.startsWith('/api/v1/customer/'))
  const customerPortalRows = PUBLIC_API_ENDPOINT_ROWS.filter(([, path]) =>
    path.startsWith('/api/v1/customer/') || path.startsWith('/api/v1/customer-portal/'),
  )
  const partnerEndpointRows = partnerRows()

  return (
    <main className="mx-auto max-w-7xl px-5 py-12 sm:px-8 lg:px-10">
      <div className="grid gap-10 lg:grid-cols-[240px_minmax(0,1fr)]">
        <aside className="hidden lg:block">
          <nav className="sticky top-8 space-y-2 text-sm text-slate-600">
            <a className="block hover:text-slate-950" href="#start">Start</a>
            <a className="block hover:text-slate-950" href="#checkout">Teckna på hemsidan</a>
            <a className="block hover:text-slate-950" href="#thank-you">Tack-sida & mail</a>
            <a className="block hover:text-slate-950" href="#status">Status & polling</a>
            <a className="block hover:text-slate-950" href="#customer-portal">Mina sidor</a>
            <a className="block hover:text-slate-950" href="#partner-api">Partner API</a>
            <a className="block hover:text-slate-950" href="#webhooks">Webhooks</a>
            <a className="block hover:text-slate-950" href="#performance">Prestanda</a>
            <a className="block hover:text-slate-950" href="#errors">Fel & retries</a>
            <a className="block hover:text-slate-950" href="#endpoints">Alla endpoints</a>
          </nav>
        </aside>

        <article className="min-w-0 space-y-10">
          <header className="space-y-5">
            <div className="text-sm font-medium text-slate-500">Gridex Developers · API contract {WEBSITE_INTEGRATION_CONTRACT_VERSION}</div>
            <h1 className="text-4xl font-semibold tracking-tight text-slate-950">Gridex API</h1>
            <p className="max-w-4xl text-lg leading-8 text-slate-600">
              Detta är den samlade människoläsbara dokumentationen för Website API, kundteckning, Mina sidor,
              Partner API och signerade webhooks. Tenantens backend ska använda Gridex som source of truth och ska
              aldrig behöva gissa om ett avtal är signerat, om en tack-sida får visas eller om ett kundmail är skickat.
            </p>
            <div className="grid gap-4 md:grid-cols-2">
              <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 text-sm leading-6 text-slate-700">
                <strong>Website / Customer Portal base:</strong><br />
                <code>{WEBSITE_INTEGRATION_BASE_URL}</code><br />
                <strong>OpenAPI:</strong><br />
                <a className="underline" href={WEBSITE_INTEGRATION_OPENAPI_URL}>{WEBSITE_INTEGRATION_OPENAPI_URL}</a><br />
                <a className="underline" href={CUSTOMER_PORTAL_OPENAPI_URL}>{CUSTOMER_PORTAL_OPENAPI_URL}</a>
              </div>
              <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 text-sm leading-6 text-slate-700">
                <strong>Partner API base:</strong><br />
                <code>{PARTNER_API_BASE_URL}</code><br />
                <strong>Partner API version:</strong> {PARTNER_API_VERSION}<br />
                <strong>OpenAPI:</strong> <a className="underline" href="/api/partner/v1/openapi.json">/api/partner/v1/openapi.json</a>
              </div>
            </div>
          </header>

          <Section id="start" title="1. Start här">
            <p className="leading-7 text-slate-700">
              API-nyckeln används endast server-to-server. Lägg aldrig <code>GRIDEX_API_KEY</code> i browsern eller mobilappen.
              Gridex härleder tenant från nyckeln; tenantens backend ska inte skicka <code>company_id</code> eller andra interna UUID:n.
            </p>
            <CopyCodeBlock code={`GRIDEX_API_KEY=gridex_live_xxxxxxxxx\n\nAuthorization: Bearer $GRIDEX_API_KEY`} language="text" />
            <ol className="list-decimal space-y-2 pl-5 text-slate-700">
              <li>Verifiera tenant med <code>GET /integration/context</code>.</li>
              <li>Hämta publicerade avtal och juridik från OPS.</li>
              <li>Lös elområde och skapa/validera quote i OPS.</li>
              <li>Skicka kundens exakta accepterade uppgifter till <code>POST /website/customer-applications</code>.</li>
              <li>Använd <code>data.checkout</code> för tack-sidan.</li>
              <li>Följ fortsatt automation via statusendpoint och/eller signerade webhooks.</li>
            </ol>
          </Section>

          <Section id="checkout" title="2. Kund tecknar på tenantens hemsida">
            <p className="leading-7 text-slate-700">
              Tenantens frontend samlar in uppgifterna, men tenantens backend gör API-anropet till Gridex. OPS verifierar tenant,
              publicerad avtalsversion, quote, pris-snapshot, juridik, kund, anläggning och fullmakt innan den canonical ansökan committas.
            </p>
            <CopyCodeBlock code={checkoutRequest} language="json" />
            <p className="text-sm leading-6 text-slate-600">
              <code>Idempotency-Key</code> är obligatorisk. Återanvänd samma nyckel endast för retry av exakt samma affärsanrop.
              En lyckad retry ska ge samma affärsresultat och får inte skapa en ny kund eller ett nytt avtal.
            </p>
          </Section>

          <Section id="thank-you" title="3. Tack-sida och avtalsbekräftelse">
            <p className="leading-7 text-slate-700">
              Tenantens kod ska inte tolka interna workflow-statusar. Använd endast <code>data.checkout</code> för beslutet direkt efter teckning.
            </p>
            <CopyCodeBlock code={checkoutResponse} language="json" />
            <div className="rounded-xl border border-slate-200 p-5 text-sm leading-7 text-slate-700">
              <strong>Regel för tack-sidan:</strong> visa att avtalet är tecknat endast när <code>checkout.thank_you_ready === true</code>.
              <br /><strong>success:</strong> avtalet är signerat och ingen kundåtgärd krävs.
              <br /><strong>success_action_required:</strong> avtalet är signerat, men kunden måste komplettera något för fortsatt automation.
              <br /><strong>action_required:</strong> kunden måste komplettera innan avtalet kan behandlas som färdig teckning.
              <br /><strong>processing:</strong> ansökan är mottagen men tenant ska inte säga att avtalet är signerat ännu.
            </div>
            <p className="leading-7 text-slate-700">
              Bekräftelsemail är en separat leveransstatus. <code>pending</code> eller <code>queued</code> betyder inte att teckningen misslyckades.
              <code>failed</code> betyder att avtalet kan vara korrekt signerat men att tenant/OPS måste hantera mailleveransen.
            </p>
          </Section>

          <Section id="status" title="4. Status efter redirect, refresh eller senare besök">
            <p className="leading-7 text-slate-700">
              Spara <code>application_number</code>. Statusendpointen returnerar samma checkout-sanning tillsammans med automation,
              leverantörsbyte, mailstatus och webhookstatus. Den accepterar aldrig interna database-ID:n.
            </p>
            <CopyCodeBlock code={statusResponse} language="json" />
            <p className="text-sm leading-6 text-slate-600">
              För mail är source of truth <code>tenant_email_outbox+communication_logs</code>. Tenantens UI ska därför inte anta att
              ett mail är levererat enbart för att avtalet är signerat.
            </p>
          </Section>

          <Section id="customer-portal" title="5. Mina sidor / Customer Portal API">
            <p className="leading-7 text-slate-700">
              Mina sidor använder samma tenantbundna API-nyckel men kräver kundidentitetskoppling. Läs kundprofil, avtal,
              anläggningar, fakturor, mätvärden, dokument, juridiska acceptanser och notiser via de granulära scopes som anges nedan.
              Kunden ska endast kunna se data som matchar den verifierade portalidentiteten inom samma tenant.
            </p>
            <EndpointTable rows={customerPortalRows} />
          </Section>

          <Section id="partner-api" title="6. Partner API">
            <p className="leading-7 text-slate-700">
              Partner API är den enklare backend-to-backend-ytan för leverantörer eller externa system som vill registrera avtal,
              hämta kund/site/faktura/mätdata och prenumerera på förändringar. Gridex konfigurerar tenant och default publicerat erbjudande utanför API:t.
            </p>
            <EndpointTable rows={partnerEndpointRows} />
          </Section>

          <Section id="webhooks" title="7. Webhooks till tenant">
            <p className="leading-7 text-slate-700">
              Webhooks är push-signaler från OPS till tenantens backend. De är HMAC-SHA256-signerade, idempotenta och har egna delivery-ID:n.
              Verifiera signaturen och deduplicera på event/delivery. För full aktuell state kan tenant därefter hämta relevant GET/statusendpoint.
            </p>
            <CopyCodeBlock code={webhookExample} language="json" />
            <p className="text-sm leading-6 text-slate-600">
              Gridex köar webhookleveransen beständigt innan retry-hantering. Ett tillfälligt fel hos tenant ska därför inte förstöra själva kundhändelsen.
            </p>
          </Section>

          <Section id="performance" title="8. Prestanda och snabb integration">
            <div className="space-y-3 text-slate-700">
              <p><strong>På Gridex-sidan:</strong> auth + rate limiting sker atomiskt i databasen, request-telemetri körs efter response-pathen och statusuppslag använder tenantbundna index.</p>
              <p><strong>Publicerade avtal:</strong> använd <code>ETag</code>/<code>If-None-Match</code> så samma feed inte laddas om i onödan.</p>
              <p><strong>Checkout:</strong> använd svaret från POST direkt för tack-sidan. Gör inte ett extra GET-anrop bara för att avgöra om kunden tecknat.</p>
              <p><strong>Status:</strong> använd webhook som primär signal när den är konfigurerad. Polling är fallback; använd rimlig backoff i stället för aggressiv polling.</p>
              <p><strong>Retries:</strong> skrivningar ska alltid ha stabil <code>Idempotency-Key</code>. Då kan tenant retrya säkert efter timeout utan dubletter.</p>
              <p><strong>API-nyckel:</strong> anslut server-to-server nära tenantens backend och återanvänd HTTP/TLS-anslutningar där runtime stödjer det.</p>
            </div>
          </Section>

          <Section id="errors" title="9. Fel, blockers och retries">
            <p className="leading-7 text-slate-700">
              Fel returneras i canonical envelope med <code>error.code</code>, <code>message</code>, <code>retryable</code>, <code>field</code>,
              <code>blockers</code>, <code>request_id</code> och kontraktsversion. Tenantens backend ska logga <code>request_id</code> för support.
            </p>
            <CopyCodeBlock code={`{
  "error": {
    "code": "...",
    "message": "...",
    "retryable": false,
    "field": null,
    "blockers": []
  },
  "request_id": "...",
  "correlation_id": "...",
  "contract_schema_version": "${WEBSITE_INTEGRATION_CONTRACT_VERSION}"
}`} language="json" />
          </Section>

          <Section id="endpoints" title="10. Alla Website/API endpoints">
            <p className="leading-7 text-slate-700">
              Tabellen genereras från samma route-registry som runtime använder för scopes, rate-limit-klass och public API-kontrakt.
            </p>
            <EndpointTable rows={websiteRows} />
          </Section>
        </article>
      </div>
    </main>
  )
}
