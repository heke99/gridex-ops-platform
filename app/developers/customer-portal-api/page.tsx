import type { Metadata } from 'next'
import type { ReactNode } from 'react'

export const metadata: Metadata = {
  title: 'Website API, Mina sidor-koppling & Webhooks | Gridex Developers',
  description: 'Integrationsguide för hemsidor, kundportaler och partners som ansluter till Gridex API och Customer Portal External Auth Linking.',
}

export const dynamic = 'force-dynamic'
export const revalidate = 0

const baseUrl = 'https://app.gridex.se'

const permissions = [
  ['Läsa avtal på hemsidan', 'website_contracts.read', 'Hämta publicerade elavtal för rätt bolag.'],
  ['Skicka kundansökningar', 'website_applications.write', 'Skicka in kund, anläggning, valt avtal och juridiska godkännanden.'],
  ['Mina sidor – läsa kunddata', 'customer_portal.read', 'Läsa kundprofil, avtal, anläggningar, fakturor, dokument och händelser.'],
  ['Mina sidor – uppdatera kunddata', 'customer_portal.write', 'Skicka kompletteringar, flyttanmälan och profiländringar.'],
  ['Läsa händelser', 'events.read', 'Läsa händelser som skapats för bolaget.'],
  ['Skicka händelser från hemsidan', 'website_events.write', 'Skicka kundhändelser från hemsida eller kundportal.'],
  ['Läsa kunddokument', 'customer_documents.read', 'Granulär behörighet för dokument i Mina sidor.'],
  ['Synka kunddokument', 'customer_documents.write', 'Skicka signerade fullmakter, avtalsdokument och andra kunddokument till OPS.'],
  ['Läsa kundnotiser', 'customer_notifications.read', 'Granulär behörighet för notiser i Mina sidor.'],
  ['Uppdatera kundnotiser', 'customer_notifications.write', 'Granulär behörighet för att markera notiser som lästa.'],
]

const futurePermissions = [
  ['Kontaktuppgifter', 'customer_contact.write'],
  ['Anläggningsuppgifter', 'customer_facility_data.write'],
  ['Fullmakt', 'customer_power_of_attorney.write'],
]

const endpoints = [
  ['GET', '/api/v1/website/public-contracts', 'website_contracts.read', 'Hämta publicerade avtal som hemsidan får visa.'],
  ['POST', '/api/v1/website/customer-applications', 'website_applications.write', 'Skapa kundansökan, avtalssnapshot och juridiska godkännanden.'],
  ['POST', '/api/v1/website/customer-events', 'website_events.write', 'Skicka kundhändelser från hemsidan. Supportärenden ska inte skickas hit.'],
  ['POST', '/api/v1/events', 'website_events.write', 'Alias för att skicka kundhändelser från hemsidan.'],
  ['GET', '/api/v1/customer/portal-bundle', 'customer_portal.read', 'Hämta kundprofil, avtal, anläggningar, fakturor, dokument, juridik, notiser och events i ett anrop via headers/query.'],
  ['POST', '/api/v1/customer/portal-bundle', 'customer_portal.read', 'Hämta Mina sidor-data med JSON-payload: email, customer_number och external_customer_id.'],
  ['POST', '/api/v1/customer/sync', 'customer_portal.write', 'Synka dokument, fullmakt, juridiska godkännanden och anläggningskompletteringar från tenant till OPS.'],
  ['GET', '/api/v1/customer/me', 'customer_portal.read', 'Hämta länkad kundprofil med namn-fallback.'],
  ['GET', '/api/v1/customer/contracts', 'customer_portal.read', 'Hämta kundens avtal.'],
  ['GET', '/api/v1/customer/sites', 'customer_portal.read', 'Hämta kundens anläggningar och mätpunkter.'],
  ['GET', '/api/v1/customer/invoices', 'customer_portal.read', 'Hämta kundens fakturor.'],
  ['GET', '/api/v1/customer/invoices/[id]', 'customer_portal.read', 'Hämta en faktura.'],
  ['GET', '/api/v1/customer/metering-values', 'customer_portal.read', 'Hämta kundens mätvärden.'],
  ['GET', '/api/v1/customer/events', 'customer_portal.read', 'Hämta kundens händelser.'],
  ['GET', '/api/v1/customer/documents', 'customer_portal.read', 'Hämta kundens dokument.'],
  ['GET', '/api/v1/customer/legal-acceptances', 'customer_portal.read', 'Hämta kundens juridiska godkännanden.'],
  ['GET', '/api/v1/customer/powers-of-attorney', 'customer_portal.read', 'Hämta kundens fullmakter.'],
  ['GET', '/api/v1/customer/notifications', 'customer_portal.read', 'Hämta kundens notiser.'],
  ['POST', '/api/v1/customer/notifications/read', 'customer_portal.write', 'Markera kundnotiser som lästa.'],
  ['POST', '/api/v1/customer/profile-update', 'customer_portal.write', 'Skicka profiländring.'],
  ['POST', '/api/v1/customer/move-out', 'customer_portal.write', 'Skicka flyttanmälan.'],
  ['GET', '/api/v1/events', 'events.read', 'Läsa bolagets domänhändelser.'],
]

const activeWebhookEvents = [
  'customer.created',
  'customer.updated',
  'customer_number.assigned',
  'contract.application_received',
  'contract.confirmation_sent',
  'contract.cooling_off_sent',
  'contract.needs_facility_data',
  'power_of_attorney.signed',
  'document.created',
  'facility_data.received',
  'facility_data.verified',
  'invoice.created',
  'invoice.sent',
  'invoice.disputed',
  'metering_values.updated',
  'customer.opened_document',
  'customer.downloaded_document',
]

const plannedWebhookEvents = [
  'contract.activated',
  'supplier_switch.started',
  'supplier_switch.completed',
  'invoice.paid',
]

const authExample = `Authorization: Bearer YOUR_GRIDEX_API_TOKEN
Origin: https://www.exempel.se
Content-Type: application/json`

const publicContractsExample = `curl -X GET "${baseUrl}/api/v1/website/public-contracts?customer_type=private" \\
  -H "Authorization: Bearer YOUR_GRIDEX_API_TOKEN" \\
  -H "Accept: application/json"`

const publicContractsResponse = `{
  "data": [
    {
      "id": "offer_...",
      "offer_reference": "offer_...",
      "code": "RORLIGT-ELPRIS",
      "name": "Rörligt elpris",
      "type": "variable_spot",
      "customer_type": "both",
      "pricing": {
        "monthly_fee": { "amount": 68, "currency": "SEK", "unit": "month" },
        "markup": { "amount": 4, "unit": "ore_per_kwh" },
        "invoice_fee": { "amount": 0, "currency": "SEK", "unit": "invoice" },
        "spot_share": null,
        "portfolio_share": null
      },
      "legal": {
        "terms_version": "2026-06",
        "privacy_policy_version": "2026-06",
        "withdrawal_version": "2026-06",
        "power_of_attorney_required": true,
        "price_terms_version": "2026-06"
      },
      "valid_from": "2026-06-01",
      "valid_to": null
    }
  ]
}`

const applicationExample = `curl -X POST "${baseUrl}/api/v1/website/customer-applications" \\
  -H "Authorization: Bearer YOUR_GRIDEX_API_TOKEN" \\
  -H "Content-Type: application/json" \\
  -H "Idempotency-Key: website-order-12345" \\
  -d '{
    "external_customer_id": "CUSTOMER-12345",
    "source": "exempel.se",
    "customer": {
      "customer_type": "private",
      "first_name": "Anna",
      "last_name": "Andersson",
      "email": "anna@example.se",
      "phone": "+46701234567",
      "personal_number": "YYYYMMDDXXXX"
    },
    "site": {
      "facility_id": "735999888000000112",
      "street": "Storgatan 1",
      "postal_code": "21122",
      "city": "Malmö",
      "price_area_code": "SE4",
      "move_in_date": "2026-07-01"
    },
    "contract": {
      "offer_reference": "offer_...",
      "requested_start_date": "2026-07-01"
    },
    "customer_portal_user_id": "<gridex-web-supabase-session-user-id>",
    "auth_user_id": "<gridex-web-supabase-session-user-id>",
    "consents": {
      "terms": true,
      "privacy_policy": true,
      "withdrawal": true,
      "power_of_attorney": true,
      "price_terms": true
    }
  }'`

const applicationResponse = `{
  "data": {
    "customer_id": "uuid",
    "customer_number": "DX-100025",
    "application_id": "uuid",
    "application_number": "APP-20260616-0001",
    "external_customer_id": "CUSTOMER-12345",
    "portal_identity_id": "uuid",
    "customer_site_id": "uuid",
    "metering_point_id": "uuid",
    "contract_id": "uuid",
    "contract_number": "AVT-DX-100025-001",
    "contract_price_snapshot_id": "uuid",
    "offer_reference": "offer_...",
    "status": "application_received",
    "missing_fields": [],
    "blocking_reasons": [],
    "next_step": "Granska ansökan och fortsätt enligt bolagets process.",
    "warnings": []
  }
}`

const portalBundlePayload = `{
  "email": "heke99@live.se",
  "customer_number": "DX-100023",
  "external_customer_id": "GRIDEX-WEB-20260616-8191257d-88d3-4929-ab02-1d3ca5ed986f"
}`

const customerFetchExample = `fetch("${baseUrl}/api/v1/customer/portal-bundle", {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    Authorization: "Bearer YOUR_GRIDEX_API_TOKEN"
  },
  body: JSON.stringify({
    email: session.user.email,
    customer_number: localCustomer.customerNumber,
    external_customer_id: localCustomer.externalCustomerId
  }),
  cache: "no-store"
})`

const customerFetchHeaderExample = `fetch("${baseUrl}/api/v1/customer/portal-bundle", {
  headers: {
    Authorization: "Bearer YOUR_GRIDEX_API_TOKEN",
    "x-gridex-customer-portal-user-id": "<gridex-web-supabase-session-user-id>",
    "x-gridex-auth-user-id": "<gridex-web-supabase-session-user-id>",
    "x-gridex-external-customer-id": "CUSTOMER-12345",
    "x-gridex-customer-number": "DX-100025"
  },
  cache: "no-store"
})`

const authLinkingRequiredHeaders = `Authorization: Bearer YOUR_GRIDEX_API_TOKEN
x-gridex-customer-portal-user-id: <gridex-web-supabase-session-user-id>
x-gridex-auth-user-id: <gridex-web-supabase-session-user-id>
x-gridex-external-customer-id: <external_customer_id>
# eller, om external_customer_id saknas:
x-gridex-customer-number: DX-100025
# optional fallback:
x-gridex-customer-email: kund@example.se`

const authLinkingFlow = `Gridex-webb Supabase session.user.id
→ x-gridex-customer-portal-user-id till OPS
→ OPS matchar tenant via API-nyckeln
→ OPS matchar kund via redan länkad auth-user, riktigt external_customer_id eller kundnummer + e-post
→ första auto-länkning kräver redan länkad användare eller minst två matchande kunduppgifter
→ OPS skapar/uppdaterar customer_portal_accounts.role = owner
→ OPS fyller customer_portal_identities.auth_user_id och customer_portal_user_id
→ GET /api/v1/customer/portal-bundle returnerar kundens data`

const authLinkingChecklist = `Tenantens backend ska:
1. läsa Supabase session.user.id server-side
2. skicka user.id i x-gridex-customer-portal-user-id
3. skicka samma user.id i x-gridex-auth-user-id
4. skicka external_customer_id från ansökan eller customer_number från OPS
5. aldrig skicka company_id eller customer_id från frontend
6. använda POST /api/v1/customer/portal-bundle som huvudendpoint för Mina sidor`


const customerSyncExample = `curl -X POST "${baseUrl}/api/v1/customer/sync" \
  -H "Authorization: Bearer YOUR_GRIDEX_API_TOKEN" \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: tenant-sync-12345" \
  -d '{
    "email": "heke99@live.se",
    "customer_number": "DX-100023",
    "external_customer_id": "GRIDEX-WEB-20260616-8191257d-88d3-4929-ab02-1d3ca5ed986f",
    "power_of_attorney": {
      "scope": "supplier_switch",
      "status": "signed",
      "signed_at": "2026-06-16T15:10:12.647Z",
      "legal_text_version": "2026-06-12-v1",
      "reference": "POA-39e9fbc4-2c94-46fb-a1ee-49d18cb0932a",
      "document": {
        "external_document_id": "tenant-doc-123",
        "document_type": "power_of_attorney",
        "title": "Signerad fullmakt",
        "file_url": "https://tenant.se/documents/tenant-doc-123.pdf"
      }
    },
    "legal_acceptances": [
      { "acceptance_type": "terms", "legal_text_version": "2026-06-12-v1", "accepted_at": "2026-06-16T15:10:12.647Z" },
      { "acceptance_type": "privacy_policy", "legal_text_version": "2026-06-12-v1", "accepted_at": "2026-06-16T15:10:12.647Z" },
      { "acceptance_type": "price_snapshot", "legal_text_version": "2026-06-12-v1", "accepted_at": "2026-06-16T15:10:12.647Z" }
    ],
    "documents": [
      {
        "external_document_id": "tenant-contract-123",
        "document_type": "contract_confirmation",
        "title": "Avtalsbekräftelse",
        "file_url": "https://tenant.se/documents/tenant-contract-123.pdf"
      }
    ]
  }'`

const customerStatusResponseExample = `{
  "data": {
    "profile": {
      "customer_number": "DX-100023",
      "display_name": "Hekmat Hourani",
      "email": "heke99@live.se"
    },
    "customer_status": {
      "code": "needs_facility_data",
      "label": "Ansökan behandlas",
      "message": "Vi behöver komplettera anläggningsuppgifter innan leverantörsbytet kan starta.",
      "can_start_switch": false
    },
    "data_quality": {
      "status": "needs_action",
      "issues": ["missing_metering_point", "missing_grid_owner", "facility_not_verified"]
    }
  }
}`

const webhookPayload = `{
  "id": "event_123",
  "type": "contract.application_received",
  "event_id": "event_123",
  "event_type": "contract.application_received",
  "created_at": "2026-06-16T10:30:00Z",
  "company_id": "uuid",
  "customer_id": "uuid",
  "customer_number": "DX-100025",
  "external_customer_id": "CUSTOMER-12345",
  "aggregate": { "type": "customer_contract", "id": "uuid" },
  "data": {
    "application_id": "uuid",
    "contract_id": "uuid",
    "status": "application_received"
  }
}`

const webhookHeaders = `X-Gridex-Event-Id: event_123
X-Gridex-Event-Type: contract.application_received
X-Gridex-Timestamp: 1718532000
X-Gridex-Signature: sha256=<signature>
X-Gridex-Delivery-Id: delivery_123`

const webhookReceiver = `import { createHmac, timingSafeEqual } from "node:crypto"
import { NextRequest, NextResponse } from "next/server"

function verify(rawBody: string, timestamp: string | null, signature: string | null) {
  if (!timestamp || !signature) return false
  const secret = process.env.GRIDEX_WEBHOOK_SIGNING_SECRET
  if (!secret) return false

  const ageSeconds = Math.abs(Date.now() / 1000 - Number(timestamp))
  if (!Number.isFinite(ageSeconds) || ageSeconds > 300) return false

  const expected = "sha256=" + createHmac("sha256", secret)
    .update(timestamp + "." + rawBody)
    .digest("hex")

  const received = Buffer.from(signature)
  const wanted = Buffer.from(expected)
  return received.length === wanted.length && timingSafeEqual(received, wanted)
}

export async function POST(request: NextRequest) {
  const rawBody = await request.text()
  const ok = verify(
    rawBody,
    request.headers.get("x-gridex-timestamp"),
    request.headers.get("x-gridex-signature")
  )
  if (!ok) return NextResponse.json({ error: "invalid_signature" }, { status: 401 })

  const event = JSON.parse(rawBody)
  // Spara event.id idempotent innan ni kör affärslogik.
  return NextResponse.json({ received: true })
}`

function CodeBlock({ children }: { children: string }) {
  return <pre className="overflow-x-auto rounded-2xl bg-slate-950 p-4 text-xs leading-6 text-slate-100"><code>{children}</code></pre>
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return <section className="rounded-[28px] border border-slate-200 bg-white p-6 shadow-sm"><h2 className="text-xl font-black text-slate-950">{title}</h2><div className="mt-4 space-y-4 text-sm leading-6 text-slate-700">{children}</div></section>
}

export default function CustomerPortalApiDocsPage() {
  return (
    <main className="min-h-screen bg-slate-50 px-6 py-10">
      <div className="mx-auto max-w-6xl space-y-8">
        <section className="rounded-[36px] border border-emerald-100 bg-white p-8 shadow-sm">
          <p className="text-xs font-bold uppercase tracking-[0.24em] text-emerald-700">Gridex Developers</p>
          <h1 className="mt-4 text-4xl font-black tracking-tight text-slate-950">Website API, Mina sidor-koppling och webhooks</h1>
          <p className="mt-5 max-w-3xl text-base leading-8 text-slate-700">
            Den här guiden är den publika online-dokumentationen för tenants och webbteam. Den visar hur en hemsida hämtar publicerade avtal, skickar kundansökningar, kopplar Mina sidor mot webbens Supabase-inloggning och tar emot händelser via webhook.
          </p>
          <div className="mt-6 grid gap-3 md:grid-cols-3">
            <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4"><div className="text-xs font-bold uppercase text-slate-500">Base URL</div><div className="mt-2 font-mono text-sm text-slate-950">{baseUrl}</div></div>
            <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4"><div className="text-xs font-bold uppercase text-slate-500">Auth</div><div className="mt-2 font-mono text-sm text-slate-950">Bearer API key</div></div>
            <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4"><div className="text-xs font-bold uppercase text-slate-500">Support</div><div className="mt-2 text-sm text-slate-950">Supportärenden ligger utanför API:t.</div></div>
          </div>
        </section>

        <Section title="1. Autentisering och säkerhet">
          <p>API-nyckeln identifierar vilket bolag integrationen tillhör. Lägg nyckeln i servermiljö, aldrig i publik frontend.</p>
          <CodeBlock>{authExample}</CodeBlock>
          <p>Allowed origins skyddar webbläsaranrop. Server-till-server-anrop kan sakna Origin-header och ska därför alltid hålla API-nyckeln hemlig. API:t filtrerar data per bolag från nyckeln; klienten ska inte skicka egen bolagsidentifierare.</p>
        </Section>

        <Section title="2. Behörigheter">
          <div className="overflow-x-auto"><table className="w-full text-left text-sm"><thead><tr className="border-b"><th className="py-2">I vanliga ord</th><th>Teknisk behörighet</th><th>Betydelse</th></tr></thead><tbody>{permissions.map((row) => <tr key={row[1]} className="border-b last:border-0"><td className="py-2 font-semibold text-slate-900">{row[0]}</td><td className="font-mono text-xs">{row[1]}</td><td>{row[2]}</td></tr>)}</tbody></table></div>
          <p>Standardpaketet för hemsida/Mina sidor bör innehålla alla rekommenderade behörigheter. Kundroutes filtrerar alltid per bolag från API-nyckeln.</p>
          <ul className="list-disc pl-5">{futurePermissions.map((row) => <li key={row[1]}><strong>{row[0]}:</strong> <code>{row[1]}</code></li>)}</ul>
        </Section>

        <Section title="3. Endpoints">
          <div className="overflow-x-auto"><table className="w-full text-left text-sm"><thead><tr className="border-b"><th className="py-2">Metod</th><th>Path</th><th>Behörighet</th><th>Beskrivning</th></tr></thead><tbody>{endpoints.map((row) => <tr key={`${row[0]}-${row[1]}`} className="border-b last:border-0"><td className="py-2 font-mono text-xs">{row[0]}</td><td className="font-mono text-xs">{row[1]}</td><td className="font-mono text-xs">{row[2]}</td><td>{row[3]}</td></tr>)}</tbody></table></div>
        </Section>

        <Section title="4. Hämta publicerade avtal">
          <p>Svaret innehåller bara avtal som är publicerade, aktiva för hemsida/API, datumgiltiga, kopplade till aktiv prisversion/prislista och har publicerad juridik.</p>
          <CodeBlock>{publicContractsExample}</CodeBlock>
          <CodeBlock>{publicContractsResponse}</CodeBlock>
          <p>Hemsidan ska använda <code>offer_reference</code> från svaret när kunden tecknar avtal. Skicka inte egna priser eller fritextvillkor som juridisk sanning.</p>
        </Section>

        <Section title="5. Skicka kundansökan">
          <p>Kundansökan ska innehålla valt <code>offer_reference</code>, separata juridiska godkännanden och, när kunden redan är inloggad på hemsidan, webbens Supabase <code>session.user.id</code> som både <code>customer_portal_user_id</code> och <code>auth_user_id</code>. Systemet skapar kund, kundnummer, portal identity, avtal, avtalssnapshot, juridiska acceptanser, fullmakt och portal-account när flödet kräver det.</p>
          <CodeBlock>{applicationExample}</CodeBlock>
          <CodeBlock>{applicationResponse}</CodeBlock>
        </Section>

        <Section title="6. Obligatoriskt: Mina sidor-koppling">
          <p>Det här flödet heter <strong>Customer Portal External Auth Linking</strong>. På svenska kallar vi det <strong>Mina sidor-koppling</strong>. Det ska användas när tenantens hemsida har egen Supabase Auth och OPS inte har kunden i sin egen <code>auth.users</code>.</p>
          <p>Tenantens backend måste skicka webbens Supabase <code>session.user.id</code> till OPS tillsammans med en stabil kundnyckel. API-nyckeln avgör alltid bolag/tenant; hemsidan ska aldrig skicka <code>company_id</code> eller ett fritt <code>customer_id</code>.</p>
          <CodeBlock>{authLinkingRequiredHeaders}</CodeBlock>
          <CodeBlock>{authLinkingFlow}</CodeBlock>
          <CodeBlock>{authLinkingChecklist}</CodeBlock>
          <p>OPS skapar eller uppdaterar då <code>customer_portal_accounts</code> med rollen <code>owner</code> och fyller <code>customer_portal_identities.auth_user_id</code>, <code>customer_portal_identities.customer_portal_user_id</code> och <code>external_account_id</code>. Värdet <code>customer</code> är inte en giltig portalroll. Skicka inte OPS-kundnummer som <code>external_customer_id</code>; använd <code>customer_number</code> när det är kundnumret.</p>
          <p>OPS-kundnummer är tenantens kundnummer. Fakturapartners som Capway ska senare kopplas via separata fält som <code>billing_customer_ref</code> och provider-metadata, inte genom att skriva över <code>customer_number</code> eller blanda ihop det med <code>external_customer_id</code>.</p>
        </Section>

        <Section title="7. Hämta Mina sidor-data">
          <p>Tenantens Mina sidor ska anropa OPS server-side med exakt kundidentifiering från den inloggade kunden. Rekommenderad JSON-payload är <code>email</code>, <code>customer_number</code> och <code>external_customer_id</code>.</p>
          <CodeBlock>{portalBundlePayload}</CodeBlock>
          <CodeBlock>{customerFetchExample}</CodeBlock>
          <p>Headers/query stöds fortsatt för äldre implementationer:</p>
          <CodeBlock>{customerFetchHeaderExample}</CodeBlock>
          <CodeBlock>{customerStatusResponseExample}</CodeBlock>
          <p>Alla kundroutes filtrerar på bolag från API-nyckeln och löser kunden via riktigt <code>external_customer_id</code>, kundnummer eller unik e-post. Om flera kunder matchar samma e-post returneras <code>409 ambiguous_customer_match</code>. Saknade listor returneras som tomma arrayer, inte 500.</p>
        </Section>

        <Section title="8. Synka dokument, fullmakt och juridiska godkännanden till OPS">
          <p>Godkända fullmakter, juridiska godkännanden och dokument ska skickas till OPS så att OPS kan starta rätt automatiska processer. Använd <code>POST /api/v1/customer/sync</code>. Anropet är tenant-säkert: API-nyckeln avgör bolag och payloaden får inte innehålla fritt <code>company_id</code>.</p>
          <CodeBlock>{customerSyncExample}</CodeBlock>
          <p>OPS sparar fullmakt i <code>powers_of_attorney</code>, juridiska godkännanden i <code>customer_legal_acceptances</code> och dokument i <code>customer_documents</code>. Om anläggningsdata saknas skapas statusen <code>needs_facility_data</code> och switch blockeras tills mätpunkt/nätägare är verifierade.</p>
        </Section>

        <Section title="9. Webhooks">
          <p>Webhookar skickas som POST till konfigurerad HTTPS-URL. Leveransen signeras med HMAC SHA-256 över <code>timestamp.rawBody</code>. Mottagaren ska svara 2xx när eventet är mottaget.</p>
          <CodeBlock>{webhookHeaders}</CodeBlock>
          <CodeBlock>{webhookPayload}</CodeBlock>
          <p>Aktiva/byggda events:</p>
          <ul className="grid gap-1 md:grid-cols-2">{activeWebhookEvents.map((event) => <li key={event} className="font-mono text-xs text-slate-800">{event}</li>)}</ul>
          <p>Planerade events som kan tillkomma senare:</p>
          <ul className="grid gap-1 md:grid-cols-2">{plannedWebhookEvents.map((event) => <li key={event} className="font-mono text-xs text-slate-500">{event}</li>)}</ul>
          <CodeBlock>{webhookReceiver}</CodeBlock>
        </Section>

        <Section title="10. Fel och idempotency">
          <p>Alla write-anrop ska skicka <code>Idempotency-Key</code>. Externa fel returneras som stabila koder, till exempel <code>missing_api_token</code>, <code>api_scope_missing</code>, <code>public_contract_not_available</code>, <code>legal_acceptance_missing</code> eller <code>idempotent_failed</code>. Visa kundvänlig text i slutkunds-UI och logga tekniska detaljer server-side.</p>
        </Section>
      </div>
    </main>
  )
}
