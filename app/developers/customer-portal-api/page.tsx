import Link from 'next/link'
import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Website API & Webhooks | Gridex Developers',
  description:
    'Publik integrationsguide för hemsidor och kundportaler som kopplar mot Gridex Ops API med onboarding, kunddata och webhooks.',
}

export const revalidate = 3600

const baseUrl = 'https://app.gridex.se'

const endpoints = [
  {
    method: 'POST',
    path: '/api/v1/website/customer-applications',
    scope: 'website_applications.write',
    description: 'Skapar eller matchar kund, kundnummer, portal identity, anläggning, mätpunkt och avtalsansökan från extern hemsida.',
  },
  {
    method: 'POST',
    path: '/api/v1/customer-portal/sync',
    scope: 'customer_portal.write',
    description: 'Länkar eller uppdaterar en extern kundidentitet mot rätt kund i Gridex.',
  },
  {
    method: 'GET',
    path: '/api/v1/customer/sites',
    scope: 'customer_portal.read',
    description: 'Hämtar kundens anläggningar och mätpunkter.',
  },
  {
    method: 'GET',
    path: '/api/v1/customer/contracts',
    scope: 'customer_portal.read',
    description: 'Hämtar kundens avtal.',
  },
  {
    method: 'GET',
    path: '/api/v1/customer/invoices',
    scope: 'customer_portal.read',
    description: 'Hämtar kundens fakturor/fakturaexporter när fakturavisning är kopplad.',
  },
  {
    method: 'GET',
    path: '/api/v1/customer/metering-values',
    scope: 'customer_portal.read',
    description: 'Hämtar normaliserade mätvärden från normalized_metering_values.',
  },
]

const webhookEvents = [
  'customer.created',
  'customer.updated',
  'customer_number.assigned',
  'contract.application_received',
  'contract.confirmation_sent',
  'contract.cooling_off_sent',
  'contract.activated',
  'supplier_switch.started',
  'supplier_switch.completed',
  'invoice.created',
  'invoice.sent',
  'invoice.paid',
  'invoice.disputed',
  'metering_values.updated',
  'case.created',
  'case.updated',
]

const errorCodes = [
  ['400', 'Query/body saknas eller requesten är felaktig.'],
  ['422', 'Payloaden är validerbar JSON men saknar obligatoriska fält, till exempel external_customer_id eller customer.email. Svaret innehåller field, hint och error_stage.'],
  ['401', 'API-token saknas eller är ogiltig.'],
  ['403', 'Token är spärrad, saknar scope, domän/IP är inte tillåten eller kunden är inte länkad.'],
  ['429', 'API-klientens rate limit är uppnådd.'],
  ['500/503', 'Tillfälligt server- eller databasfel.'],
]

const onboardingCurl = `curl -X POST "${baseUrl}/api/v1/website/customer-applications" \\
  -H "Authorization: Bearer YOUR_GRIDEX_API_TOKEN" \\
  -H "Content-Type: application/json" \\
  -H "Idempotency-Key: website-order-12345" \\
  -d '{
    "external_customer_id": "CUSTOMER-12345",
    "source": "example.se",
    "customer": {
      "customer_type": "private",
      "first_name": "Anna",
      "last_name": "Andersson",
      "email": "anna@example.se",
      "phone": "+46701234567"
    },
    "site": {
      "facility_id": "735999888000000112",
      "street": "Testgatan 1",
      "postal_code": "11122",
      "city": "Stockholm",
      "price_area_code": "SE3",
      "move_in_date": "2026-07-01"
    },
    "contract": {
      "contract_name": "Rörligt elpris",
      "contract_type": "variable_monthly",
      "starts_at": "2026-07-01",
      "monthly_fee_sek": 49,
      "spot_markup_ore_per_kwh": 8,
      "green_fee_mode": "ore_per_kwh",
      "green_fee_value": 2
    },
    "consents": {
      "terms_accepted_at": "2026-06-09T14:00:00Z",
      "withdrawal_information_accepted": true
    }
  }'`


const simplifiedOnboardingCurl = `curl -X POST "${baseUrl}/api/v1/website/customer-applications" \
  -H "Authorization: Bearer YOUR_GRIDEX_API_TOKEN" \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: simplified-order-12345" \
  -d '{
    "external_customer_id": "CUSTOMER-12345",
    "source": "example.se",
    "name": "Anna Andersson",
    "email": "anna@example.se",
    "phone": "+46701234567",
    "address": {
      "street": "Testgatan 1",
      "postal_code": "11122",
      "city": "Stockholm",
      "country": "SE"
    },
    "site": {
      "facility_id": "735999888000000112",
      "price_area": "SE3",
      "move_in_date": "2026-07-01"
    },
    "contract": {
      "contract_name": "Rörligt elpris",
      "contract_type": "variable_monthly",
      "starts_at": "2026-07-01"
    }
  }'`

const nextJsRouteExample = [
  '// app/api/gridex/metering-values/route.ts',
  "import { NextRequest, NextResponse } from 'next/server'",
  '',
  'export async function GET(request: NextRequest) {',
  "  const externalCustomerId = request.nextUrl.searchParams.get('external_customer_id')",
  '  if (!externalCustomerId) {',
  "    return NextResponse.json({ error: 'external_customer_id saknas.' }, { status: 400 })",
  '  }',
  '',
  '  // Kontrollera först att den inloggade kunden får använda detta external_customer_id.',
  '  const response = await fetch(',
  "    `https://app.gridex.se/api/v1/customer/metering-values?external_customer_id=${encodeURIComponent(externalCustomerId)}`,",
  '    {',
  '      headers: {',
  "        Authorization: `Bearer ${process.env.GRIDEX_OPS_API_TOKEN}`,",
  "        Accept: 'application/json',",
  '      },',
  "      cache: 'no-store',",
  '    }',
  '  )',
  '',
  '  const data = await response.json()',
  '  return NextResponse.json(data, {',
  '    status: response.status,',
  "    headers: { 'Cache-Control': 'no-store' },",
  '  })',
  '}',
].join('\n')


const webhookReceiverExample = [
  '// app/api/gridex/webhook/route.ts',
  "import { createHmac, timingSafeEqual } from 'node:crypto'",
  "import { NextRequest, NextResponse } from 'next/server'",
  '',
  'function verifySignature(rawBody: string, timestamp: string | null, signature: string | null) {',
  '  if (!timestamp || !signature) return false',
  '  const secret = process.env.GRIDEX_WEBHOOK_SIGNING_SECRET',
  '  if (!secret) return false',
  "  const expected = 'sha256=' + createHmac('sha256', secret).update(`${timestamp}.${rawBody}`).digest('hex')",
  '  return timingSafeEqual(Buffer.from(signature), Buffer.from(expected))',
  '}',
  '',
  'export async function POST(request: NextRequest) {',
  '  const rawBody = await request.text()',
  "  const timestamp = request.headers.get('x-gridex-webhook-timestamp')",
  "  const signature = request.headers.get('x-gridex-webhook-signature')",
  '',
  '  if (!verifySignature(rawBody, timestamp, signature)) {',
  "    return NextResponse.json({ error: 'Invalid signature' }, { status: 401 })",
  '  }',
  '',
  '  const event = JSON.parse(rawBody)',
  '  // Spara event.event_id idempotent och uppdatera egen portal/status.',
  '  return NextResponse.json({ received: true })',
  '}',
].join('\n')


const checklist = [
  'API-klient är skapad i Gridex Ops Platform.',
  'Token ligger endast server-side på hemsidan eller partnerportalen.',
  'Token ligger aldrig i NEXT_PUBLIC_ eller browserkod.',
  'Allowed origins är satta för hemsidans domäner.',
  'Scopes är minimerade till customer_portal.read, customer_portal.write och/eller website_applications.write.',
  'external_customer_id är stabilt och unikt per kund i den externa portalen.',
  'Webhook URL är HTTPS och signatur verifieras.',
  'Kundansökan returnerar customer_number.',
  'Sites, contracts, invoices och metering-values är testade.',
  'Audit-loggen visar company_id, api_client_id, route, status_code och result_count.',
  'Gamla eller exponerade API-nycklar är återkallade eller raderade.',
  'Hemsidan skickar inte dubbla juridiska bekräftelse-/ångerrättsmail utan separat överenskommelse.',
  'Webhook-events contract.confirmation_sent, contract.cooling_off_sent och invoice.disputed hanteras idempotent.',
]

function CodeBlock({ children }: { children: string }) {
  return (
    <pre className="overflow-x-auto rounded-3xl bg-slate-950 p-5 text-xs leading-6 text-emerald-50 shadow-sm">
      <code>{children}</code>
    </pre>
  )
}

function Section({ id, label, title, children }: { id: string; label: string; title: string; children: React.ReactNode }) {
  return (
    <section id={id} className="scroll-mt-24 rounded-[2rem] border border-slate-200 bg-white p-6 shadow-sm shadow-slate-950/5 sm:p-8">
      <p className="text-xs font-semibold uppercase tracking-[0.2em] text-emerald-700">{label}</p>
      <h2 className="mt-3 text-2xl font-semibold tracking-tight text-slate-950 sm:text-3xl">{title}</h2>
      <div className="mt-5 space-y-5 text-sm leading-7 text-slate-700">{children}</div>
    </section>
  )
}

export default function CustomerPortalApiDocsPage() {
  return (
    <main className="min-h-screen bg-[#f7fbf8] text-slate-950">
      <header className="border-b border-emerald-100 bg-white/90 backdrop-blur">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-6 px-6 py-5 sm:px-8">
          <Link href="/" className="flex items-center gap-3">
            <span className="flex h-10 w-10 items-center justify-center rounded-2xl bg-emerald-700 text-sm font-bold text-white">G</span>
            <span>
              <span className="block text-sm font-semibold uppercase tracking-[0.2em] text-emerald-800">Gridex</span>
              <span className="block text-xs font-medium text-slate-500">Developer Documentation</span>
            </span>
          </Link>
          <nav className="hidden items-center gap-2 md:flex">
            <a href="#architecture" className="rounded-full px-4 py-2 text-sm font-medium text-slate-600 hover:bg-emerald-50 hover:text-slate-950">Arkitektur</a>
            <a href="#onboarding" className="rounded-full px-4 py-2 text-sm font-medium text-slate-600 hover:bg-emerald-50 hover:text-slate-950">Onboarding</a>
            <a href="#webhooks" className="rounded-full px-4 py-2 text-sm font-medium text-slate-600 hover:bg-emerald-50 hover:text-slate-950">Webhooks</a>
          </nav>
          <Link href="/login" className="rounded-2xl bg-emerald-700 px-4 py-2.5 text-sm font-semibold text-white hover:bg-emerald-800">
            Logga in
          </Link>
        </div>
      </header>

      <section className="relative overflow-hidden border-b border-emerald-100 bg-gradient-to-br from-white via-emerald-50 to-slate-50">
        <div className="mx-auto max-w-7xl px-6 py-16 sm:px-8 lg:py-20">
          <div className="max-w-4xl">
            <div className="inline-flex rounded-full border border-emerald-200 bg-white px-4 py-2 text-xs font-semibold uppercase tracking-[0.2em] text-emerald-800">
              Public API guide for websites, customer portals and partners
            </div>
            <h1 className="mt-7 text-4xl font-semibold tracking-[-0.035em] text-slate-950 sm:text-6xl">
              Koppla en extern hemsida till Gridex Customer Portal API och Gridex Ops API.
            </h1>
            <p className="mt-6 max-w-3xl text-lg leading-8 text-slate-600">
              Den här sidan beskriver hur externa hemsidor skickar kundansökningar, hämtar kunddata och tar emot webhooks från Gridex Ops Platform. Gridex/Ops är master för kundnummer, avtal, faktura och kommunikation. Do not send duplicate legal confirmation emails unless explicitly agreed; Ops sends and logs legally important confirmation and cooling-off communication by default.
            </p>
            <div className="mt-8 grid gap-3 sm:grid-cols-3">
              <div className="rounded-3xl border border-emerald-100 bg-white p-5 shadow-sm">
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-emerald-700">Base URL</p>
                <p className="mt-2 font-mono text-sm text-slate-950">{baseUrl}</p>
              </div>
              <div className="rounded-3xl border border-emerald-100 bg-white p-5 shadow-sm">
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-emerald-700">Auth</p>
                <p className="mt-2 font-mono text-sm text-slate-950">Bearer token</p>
              </div>
              <div className="rounded-3xl border border-emerald-100 bg-white p-5 shadow-sm">
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-emerald-700">Tenant</p>
                <p className="mt-2 text-sm text-slate-950">Löses via API-klient</p>
              </div>
            </div>
          </div>
        </div>
      </section>

      <div className="mx-auto grid max-w-7xl gap-8 px-6 py-10 sm:px-8 lg:grid-cols-[260px_minmax(0,1fr)] lg:py-14">
        <aside className="hidden lg:block">
          <div className="sticky top-6 rounded-[2rem] border border-emerald-100 bg-white p-5 text-sm shadow-sm">
            <p className="font-semibold text-slate-950">På sidan</p>
            <div className="mt-4 grid gap-2 text-slate-600">
              <a href="#architecture" className="hover:text-emerald-800">Arkitektur</a>
              <a href="#identity" className="hover:text-emerald-800">Kund-ID:n</a>
              <a href="#onboarding" className="hover:text-emerald-800">Onboarding</a>
              <a href="#customer-data" className="hover:text-emerald-800">Kunddata</a>
              <a href="#webhooks" className="hover:text-emerald-800">Webhooks</a>
              <a href="#billing" className="hover:text-emerald-800">Faktura/Capway</a>
              <a href="#security" className="hover:text-emerald-800">Säkerhet</a>
              <a href="#go-live" className="hover:text-emerald-800">Go-live</a>
            </div>
          </div>
        </aside>

        <div className="space-y-8">
          <Section id="architecture" label="01" title="Arkitektur: hemsidan ska anropa Gridex server-side">
            <p>Authorization: Bearer YOUR_GRIDEX_API_TOKEN används bara server-side. En extern hemsida får aldrig lägga Gridex API-token i frontend. Hemsidan ska skapa egna server routes som kontrollerar kundens inloggning och sedan anropar Gridex Ops API server-side.</p>
            <div className="grid gap-4 md:grid-cols-2">
              <div className="rounded-3xl border border-emerald-200 bg-emerald-50 p-5">
                <p className="font-semibold text-emerald-950">Rätt flöde</p>
                <p className="mt-2 text-sm text-emerald-900">Frontend → egen backend/server route → Gridex Ops API → kunddata till frontend.</p>
              </div>
              <div className="rounded-3xl border border-red-200 bg-red-50 p-5">
                <p className="font-semibold text-red-950">Fel flöde</p>
                <p className="mt-2 text-sm text-red-900">Browser/frontend → Gridex Ops API direkt med API-token.</p>
              </div>
            </div>
            <CodeBlock>{`Customer browser
  → https://kund.example.se/api/gridex/metering-values
  → server route reads GRIDEX_OPS_API_TOKEN from env
  → ${baseUrl}/api/v1/customer/metering-values
  → response filtered by API-client company_id + external_customer_id`}</CodeBlock>
          </Section>

          <Section id="identity" label="02" title="Tre identiteter: customer_id, customer_number och externa ID:n">
            <p><strong>customer_id</strong> är Gridex tekniska UUID i databasen. <strong>customer_number</strong> är den affärsmässiga kundreferensen, exempelvis GDX-100001, som ska användas i kundportal, support, faktura, Capway-referenser och bestridanden. <strong>external_customer_id</strong> är kundens ID i den externa hemsidan.</p>
            <CodeBlock>{`Gridex customer_id      = intern teknisk master
Gridex customer_number  = affärsreferens/master för kund
external_customer_id    = hemsidans/partnerns kund-ID
Capway debtor_id        = extern faktura-/betalpartnerreferens
Capway invoice_id       = extern fakturareferens`}</CodeBlock>
          </Section>

          <Section id="onboarding" label="03" title="Skapa kund och elavtalsansökan från hemsida">
            <p>POST /api/v1/website/customer-applications skapar eller matchar kund i Ops, reserverar kundnummer, skapar portal identity, anläggning, mätpunkt och avtalsansökan. Ops kan även trigga bekräftelsemail och ångerrätt enligt tenantens mallar.</p>
            <CodeBlock>{onboardingCurl}</CodeBlock>
            <p className="font-semibold text-slate-800">Förenklad payload accepteras också för enklare hemsideformulär:</p>
            <CodeBlock>{simplifiedOnboardingCurl}</CodeBlock>
            <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-amber-950">
              Vid valideringsfel returnerar API:t 422 med <code>field</code>, <code>hint</code> och <code>error_stage</code>. E-post- eller webhookfel ska inte krascha ansökan; de returneras som warnings.
            </div>
            <p>Exempel på response:</p>
            <CodeBlock>{`{
  "data": {
    "customer_id": "93749529-aae5-43dc-8099-9729ecb8ca17",
    "customer_number": "GDX-100001",
    "external_customer_id": "CUSTOMER-12345",
    "portal_identity_id": "...",
    "customer_site_id": "...",
    "metering_point_id": "...",
    "contract_id": "...",
    "status": "application_received"
  }
}`}</CodeBlock>
          </Section>

          <Section id="customer-data" label="04" title="Endpoints för att läsa kunddata">
            <div className="overflow-hidden rounded-3xl border border-slate-200">
              <table className="min-w-full divide-y divide-slate-200 text-sm">
                <thead className="bg-slate-50 text-left text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">
                  <tr>
                    <th className="px-4 py-3">Metod</th>
                    <th className="px-4 py-3">Endpoint</th>
                    <th className="px-4 py-3">Scope</th>
                    <th className="px-4 py-3">Beskrivning</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 bg-white">
                  {endpoints.map((endpoint) => (
                    <tr key={`${endpoint.method}-${endpoint.path}`}>
                      <td className="px-4 py-4 font-semibold text-slate-950">{endpoint.method}</td>
                      <td className="px-4 py-4 font-mono text-xs text-slate-700">{endpoint.path}</td>
                      <td className="px-4 py-4 font-mono text-xs text-emerald-800">{endpoint.scope}</td>
                      <td className="px-4 py-4 text-slate-700">{endpoint.description}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p>Customer endpoints kräver external_customer_id och returnerar kunddata med Cache-Control: no-store.</p>
            <CodeBlock>{nextJsRouteExample}</CodeBlock>
          </Section>

          <Section id="webhooks" label="05" title="Webhooks från Ops till externa hemsidor">
            <p>Gridex kan skicka events till en extern HTTPS endpoint när kund, avtal, faktura, mätvärden eller ärende ändras. Webhook-mottagaren ska verifiera HMAC-signaturen och behandla event_id idempotent.</p>
            <div className="grid gap-2 md:grid-cols-2">
              {webhookEvents.map((event) => (
                <div key={event} className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 font-mono text-xs text-slate-700">{event}</div>
              ))}
            </div>
            <p>Headers:</p>
            <CodeBlock>{`x-gridex-webhook-timestamp: 1781013600
x-gridex-webhook-signature: sha256=<hmac>`}</CodeBlock>
            <p>Payload:</p>
            <CodeBlock>{`{
  "event_id": "evt_123",
  "event_type": "invoice.sent",
  "created_at": "2026-06-09T14:00:00Z",
  "company_id": "b3ad1bf6-fa45-41a6-8054-2e0862e82aca",
  "customer_id": "93749529-aae5-43dc-8099-9729ecb8ca17",
  "customer_number": "GDX-100001",
  "external_customer_id": "CUSTOMER-12345",
  "data": {
    "invoice_id": "inv_123",
    "amount_ex_vat": 919.19,
    "vat_amount": 229.80,
    "amount_inc_vat": 1148.99,
    "status": "sent"
  }
}`}</CodeBlock>
            <CodeBlock>{webhookReceiverExample}</CodeBlock>
          </Section>

          <Section id="communication" label="06" title="Bekräftelsemail och ångerrätt">
            <p>Gridex Ops ska kunna skicka juridiskt viktiga mail och logga dem, oavsett om kunden kommer via hemsida/API eller skapas manuellt av admin. Tenant/elbolag kan ha egen avsändare och egna mallar, men Ops ska vara system of record för vad som skickades.</p>
            <CodeBlock>{`Default:
Ops skickar och loggar bekräftelse/ångerrätt/statusmail.
Tenant använder egen avsändare/mallar.
Extern hemsida får webhook-event och visar status.

Viktiga loggar:
communication_logs
communication_log_events
domain_events
webhook_deliveries`}</CodeBlock>
          </Section>

          <Section id="billing" label="07" title="Fakturor, Capway och bestridan">
            <p>Gridex customer_number är master-referens. Capway kan ge debtor_id/customer id och invoice id, men dessa lagras som externa referenser och ersätter inte Gridex kundnummer.</p>
            <CodeBlock>{`Capway debtRow-regel:
amount = belopp exkl. moms
vatCode = SE25 vid svensk 25% moms

Vid bestridan ska Ops kunna visa:
kundnummer, avtal, signering, ångerrättsmail, anläggnings-ID,
mätvärden, fakturarader exkl. moms, vatCode, Capway debtor id,
Capway invoice id, communication log, eventlogg och audit log.`}</CodeBlock>
          </Section>

          <Section id="errors" label="08" title="Felkoder">
            <div className="grid gap-3">
              {errorCodes.map(([code, description]) => (
                <div key={code} className="grid gap-3 rounded-2xl border border-slate-200 bg-slate-50 p-4 sm:grid-cols-[90px_minmax(0,1fr)]">
                  <div className="font-mono text-sm font-semibold text-slate-950">{code}</div>
                  <div className="text-sm text-slate-700">{description}</div>
                </div>
              ))}
            </div>
          </Section>

          <Section id="security" label="09" title="Säkerhetskrav">
            <ul className="grid gap-3">
              <li className="rounded-2xl border border-slate-200 bg-slate-50 p-4">API-token ska bara ligga server-side.</li>
              <li className="rounded-2xl border border-slate-200 bg-slate-50 p-4">Frontend får aldrig skicka company_id som tenant-val.</li>
              <li className="rounded-2xl border border-slate-200 bg-slate-50 p-4">Allowed origins och scopes ska begränsas per hemsida.</li>
              <li className="rounded-2xl border border-slate-200 bg-slate-50 p-4">Webhook-signatur ska verifieras innan event accepteras.</li>
              <li className="rounded-2xl border border-slate-200 bg-slate-50 p-4">Gamla eller läckta API-nycklar ska återkallas eller raderas i Gridex Ops Platform.</li>
              <li className="rounded-2xl border border-slate-200 bg-slate-50 p-4">Kunddata ska aldrig cacheas publikt. Använd Cache-Control: no-store.</li>
            </ul>
          </Section>

          <Section id="go-live" label="10" title="Go-live checklista">
            <div className="grid gap-3 md:grid-cols-2">
              {checklist.map((item) => (
                <div key={item} className="flex gap-3 rounded-2xl border border-emerald-100 bg-emerald-50 p-4 text-emerald-950">
                  <span className="mt-1 h-2.5 w-2.5 rounded-full bg-emerald-600" />
                  <span>{item}</span>
                </div>
              ))}
            </div>
          </Section>
        </div>
      </div>
    </main>
  )
}
