import Link from 'next/link'
import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Customer Portal API | Gridex Developers',
  description:
    'Publik integrationsguide för hemsidor och kundportaler som ska koppla mot Gridex Customer Portal API.',
}

export const revalidate = 3600

const baseUrl = 'https://app.gridex.se'

const endpoints = [
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
    description: 'Hämtar kundens fakturor när fakturaexport/fakturavisning är kopplad.',
  },
  {
    method: 'GET',
    path: '/api/v1/customer/metering-values',
    scope: 'customer_portal.read',
    description: 'Hämtar normaliserade mätvärden från normalized_metering_values.',
  },
]

const errorCodes = [
  ['400', 'Obligatorisk parameter saknas, till exempel external_customer_id.'],
  ['401', 'API-token saknas eller är ogiltig.'],
  ['403', 'Token är spärrad, saknar scope, domän/IP är inte tillåten eller kunden är inte länkad.'],
  ['429', 'API-klientens rate limit är uppnådd.'],
  ['500/503', 'Tillfälligt server- eller databasfel.'],
]


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

const checklist = [
  'API-klient är skapad i Gridex Ops Platform.',
  'Token ligger endast server-side på hemsidan eller partnerportalen.',
  'Token ligger aldrig i NEXT_PUBLIC_ eller browserkod.',
  'Allowed origins är satta för hemsidans domäner.',
  'Scopes är minimerade till customer_portal.read och/eller customer_portal.write.',
  'external_customer_id är stabilt och unikt per kund i den externa portalen.',
  'Kundlänkning via sync är testad.',
  'Sites, contracts, invoices och metering-values är testade.',
  'Audit-loggen visar company_id, api_client_id, route, status_code och result_count.',
  'Gamla eller exponerade API-nycklar är återkallade eller raderade.',
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
            <a href="#endpoints" className="rounded-full px-4 py-2 text-sm font-medium text-slate-600 hover:bg-emerald-50 hover:text-slate-950">Endpoints</a>
            <a href="#examples" className="rounded-full px-4 py-2 text-sm font-medium text-slate-600 hover:bg-emerald-50 hover:text-slate-950">Kodexempel</a>
          </nav>
          <Link href="/login" className="rounded-2xl bg-emerald-700 px-4 py-2.5 text-sm font-semibold text-white hover:bg-emerald-800">
            Logga in
          </Link>
        </div>
      </header>

      <section className="border-b border-emerald-100 bg-gradient-to-br from-white via-emerald-50 to-[#f7fbf8]">
        <div className="mx-auto max-w-7xl px-6 py-16 sm:px-8 lg:py-20">
          <div className="max-w-4xl">
            <div className="inline-flex rounded-full border border-emerald-200 bg-white px-4 py-2 text-sm font-semibold text-emerald-800 shadow-sm">
              Public API guide for websites and customer portals
            </div>
            <h1 className="mt-7 text-4xl font-semibold tracking-[-0.035em] text-slate-950 sm:text-6xl">
              Koppla en extern hemsida till Gridex Customer Portal API.
            </h1>
            <p className="mt-6 max-w-3xl text-lg leading-8 text-slate-600">
              Den här sidan är för utvecklare som ska bygga Mina sidor, kundportal eller partnerportal mot Gridex Ops Platform. Guiden beskriver hur API-token, external_customer_id, endpoints och server-side proxy ska användas utan att exponera känsliga nycklar i browsern.
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
              <a href="#auth" className="hover:text-emerald-800">Autentisering</a>
              <a href="#customer-id" className="hover:text-emerald-800">external_customer_id</a>
              <a href="#endpoints" className="hover:text-emerald-800">Endpoints</a>
              <a href="#examples" className="hover:text-emerald-800">Kodexempel</a>
              <a href="#security" className="hover:text-emerald-800">Säkerhet</a>
              <a href="#go-live" className="hover:text-emerald-800">Go-live</a>
            </div>
          </div>
        </aside>

        <div className="space-y-8">
          <Section id="architecture" label="01" title="Arkitektur: hemsidan ska anropa Gridex server-side">
            <p>
              En extern hemsida får aldrig lägga Gridex API-token i frontend. Hemsidan ska i stället skapa egna server routes som kontrollerar kundens inloggning och sedan anropar Gridex Ops API server-side.
            </p>
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

          <Section id="auth" label="02" title="Autentisering och API-klienter">
            <p>
              API-token utfärdas i Gridex Ops Platform av behörig admin. Token visas bara en gång vid skapande och sparas i Gridex som hash, inte i klartext.
            </p>
            <CodeBlock>{`Authorization: Bearer YOUR_GRIDEX_API_TOKEN`}</CodeBlock>
            <p>
              En API-klient kopplas till ett bolag/tenant via integration_api_clients.company_id. Externa hemsidor ska därför aldrig skicka company_id själva. Tenant väljs av backend genom token.
            </p>
            <div className="rounded-3xl border border-amber-200 bg-amber-50 p-5 text-amber-950">
              <p className="font-semibold">Tokenhantering</p>
              <p className="mt-2">Lägg token som server secret, till exempel GRIDEX_OPS_API_TOKEN. Använd aldrig NEXT_PUBLIC_GRIDEX_OPS_API_TOKEN eller annan publik env-variabel.</p>
            </div>
          </Section>

          <Section id="customer-id" label="03" title="external_customer_id identifierar kunden i den externa portalen">
            <p>
              external_customer_id är kundens stabila ID i den externa hemsidan eller kundportalen. Gridex använder detta ID tillsammans med API-klientens company_id för att hitta rätt customer_portal_identity och rätt customer_id.
            </p>
            <CodeBlock>{`GET /api/v1/customer/sites?external_customer_id=CUSTOMER-12345
x-gridex-external-customer-id: CUSTOMER-12345`}</CodeBlock>
            <p>
              Alla kundendpoints kräver external_customer_id. Detta är medvetet: en API-token kan tillhöra en hemsida med många kunder, och varje anrop måste därför ange vilken kund i portalen som avses.
            </p>
          </Section>

          <Section id="endpoints" label="04" title="Endpoints">
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
            <p>
              Customer endpoints returnerar kunddata med Cache-Control: no-store och audit-loggas i integration_api_requests med route, status_code, api_client_id, company_id och result_count där det är relevant.
            </p>
          </Section>

          <Section id="examples" label="05" title="Curl och Next.js-exempel">
            <p>Snabbt live-test mot mätvärden:</p>
            <CodeBlock>{`curl "${baseUrl}/api/v1/customer/metering-values?external_customer_id=GRIDEX-WEB-TEST-001" \\
  -H "Authorization: Bearer YOUR_GRIDEX_API_TOKEN" \\
  -H "Accept: application/json"`}</CodeBlock>
            <p>Exempel på server route i en extern Next.js-hemsida:</p>
            <CodeBlock>{nextJsRouteExample}</CodeBlock>
          </Section>

          <Section id="errors" label="06" title="Felkoder">
            <div className="grid gap-3">
              {errorCodes.map(([code, description]) => (
                <div key={code} className="grid gap-3 rounded-2xl border border-slate-200 bg-slate-50 p-4 sm:grid-cols-[90px_minmax(0,1fr)]">
                  <div className="font-mono text-sm font-semibold text-slate-950">{code}</div>
                  <div className="text-sm text-slate-700">{description}</div>
                </div>
              ))}
            </div>
          </Section>

          <Section id="security" label="07" title="Säkerhetskrav">
            <ul className="grid gap-3">
              <li className="rounded-2xl border border-slate-200 bg-slate-50 p-4">API-token ska bara ligga server-side.</li>
              <li className="rounded-2xl border border-slate-200 bg-slate-50 p-4">Frontend får aldrig skicka company_id som tenant-val.</li>
              <li className="rounded-2xl border border-slate-200 bg-slate-50 p-4">Allowed origins och scopes ska begränsas per hemsida.</li>
              <li className="rounded-2xl border border-slate-200 bg-slate-50 p-4">Gamla eller läckta API-nycklar ska återkallas eller raderas i Gridex Ops Platform.</li>
              <li className="rounded-2xl border border-slate-200 bg-slate-50 p-4">Kunddata ska aldrig cacheas publikt. Använd Cache-Control: no-store.</li>
            </ul>
          </Section>

          <Section id="go-live" label="08" title="Go-live checklista">
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
