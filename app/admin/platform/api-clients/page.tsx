import Link from 'next/link'
import { requirePlatformAdminAccess } from '@/lib/admin/guards'
import { supabaseService } from '@/lib/supabase/service'
import CreateApiClientForm from './CreateApiClientForm'
import { deleteIntegrationApiClientAction, setIntegrationApiClientStatusAction } from './actions'

export const dynamic = 'force-dynamic'

type CompanyOption = {
  id: string
  name: string
  status: string | null
}

type ApiClientRow = {
  id: string
  company_id: string
  name: string
  status: string
  key_prefix: string
  scopes: string[] | null
  allowed_origins: string[] | null
  allowed_ips: string[] | null
  rate_limit_per_minute: number | null
  last_used_at: string | null
  expires_at: string | null
  created_at: string
  metadata: Record<string, unknown> | null
  companies?: { name?: string | null } | null
}

type ApiRequestRow = {
  id: string
  company_id: string | null
  api_client_id: string | null
  method: string
  route: string
  status_code: number | null
  duration_ms: number | null
  error_code: string | null
  created_at: string
}

function formatDate(value: string | null | undefined) {
  if (!value) return '—'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return new Intl.DateTimeFormat('sv-SE', {
    dateStyle: 'short',
    timeStyle: 'short',
  }).format(date)
}

function statusTone(status: string) {
  if (status === 'active') return 'border-emerald-200 bg-emerald-50 text-emerald-800'
  if (status === 'paused') return 'border-amber-200 bg-amber-50 text-amber-800'
  return 'border-slate-200 bg-slate-100 text-slate-700'
}

function valueList(value: unknown): string[] {
  return Array.isArray(value) ? value.map(String).filter(Boolean) : []
}

async function loadCompanies(): Promise<CompanyOption[]> {
  const { data, error } = await supabaseService
    .from('companies')
    .select('id,name,status')
    .order('name', { ascending: true })
    .limit(500)

  if (error) throw error
  return (data ?? []) as CompanyOption[]
}

async function loadClients(): Promise<ApiClientRow[]> {
  const { data, error } = await supabaseService
    .from('integration_api_clients')
    .select('id,company_id,name,status,key_prefix,scopes,allowed_origins,allowed_ips,rate_limit_per_minute,last_used_at,expires_at,created_at,metadata,companies(name)')
    .order('created_at', { ascending: false })
    .limit(100)

  if (error) throw error
  return (data ?? []) as ApiClientRow[]
}

async function loadRecentRequests(): Promise<ApiRequestRow[]> {
  const { data, error } = await supabaseService
    .from('integration_api_requests')
    .select('id,company_id,api_client_id,method,route,status_code,duration_ms,error_code,created_at')
    .order('created_at', { ascending: false })
    .limit(30)

  if (error) return []
  return (data ?? []) as ApiRequestRow[]
}

export default async function PlatformApiClientsPage() {
  await requirePlatformAdminAccess()
  const [companies, clients, requests] = await Promise.all([
    loadCompanies(),
    loadClients(),
    loadRecentRequests(),
  ])

  const activeClients = clients.filter((client) => client.status === 'active').length
  const portalClients = clients.filter((client) => valueList(client.scopes).some((scope) => scope.startsWith('customer_portal.'))).length

  return (
    <main className="mx-auto max-w-7xl px-6 py-8">
      <div className="rounded-[36px] border border-emerald-100 bg-white p-8 shadow-sm shadow-emerald-950/5">
        <div className="flex flex-col gap-6 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-emerald-700">Platform · API</p>
            <h1 className="mt-3 text-3xl font-bold tracking-tight text-slate-950">API-klienter för Mina sidor</h1>
            <p className="mt-3 max-w-3xl text-sm leading-6 text-slate-600">
              Här skapar superadmin API-klienter för Gridex hemsidan och andra tenant-frontends. Token används server-side, sparas bara som hash och styrs med scopes, origins, IP-filter och rate limits.
            </p>
          </div>
          <div className="flex flex-wrap gap-3">
            <Link href="/developers/customer-portal-api" className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-2 text-sm font-semibold text-emerald-800 hover:bg-emerald-100">
              API-dokumentation
            </Link>
            <Link href="/admin/platform/security" className="rounded-2xl border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50">
              Visa security guardrails
            </Link>
          </div>
        </div>

        <div className="mt-8 grid gap-4 md:grid-cols-3">
          <div className="rounded-3xl border border-emerald-100 bg-emerald-50 p-5">
            <p className="text-sm font-medium text-emerald-900">Aktiva API-klienter</p>
            <p className="mt-2 text-3xl font-semibold text-slate-950">{activeClients}</p>
          </div>
          <div className="rounded-3xl border border-slate-200 bg-slate-50 p-5">
            <p className="text-sm font-medium text-slate-700">Mina sidor-klienter</p>
            <p className="mt-2 text-3xl font-semibold text-slate-950">{portalClients}</p>
          </div>
          <div className="rounded-3xl border border-slate-200 bg-slate-50 p-5">
            <p className="text-sm font-medium text-slate-700">Senaste API-anrop</p>
            <p className="mt-2 text-3xl font-semibold text-slate-950">{requests.length}</p>
          </div>
        </div>
      </div>

      <div className="mt-8 grid gap-8 xl:grid-cols-[minmax(0,1fr)_420px]">
        <CreateApiClientForm companies={companies} />

        <aside className="space-y-5">
          <div className="rounded-[32px] border border-amber-200 bg-amber-50 p-6 text-sm leading-6 text-amber-950">
            <h2 className="text-lg font-semibold text-slate-950">Viktigt för Gridex hemsidan</h2>
            <p className="mt-3">Token ska ligga i hemsidans servermiljö, aldrig i browsern. Använd server route/API proxy på hemsidan som anropar Ops Platform.</p>
            <code className="mt-4 block rounded-2xl bg-slate-950 p-4 text-xs text-amber-100">
              Authorization: Bearer {'<GRIDEX_OPS_API_TOKEN>'}
            </code>
          </div>

          <div className="rounded-[32px] border border-slate-200 bg-white p-6 text-sm leading-6 text-slate-700">
            <h2 className="text-lg font-semibold text-slate-950">Endpoints för hemsidan</h2>
            <div className="mt-4 space-y-2 font-mono text-xs">
              <div>POST /api/v1/customer-portal/sync</div>
              <div>GET /api/v1/customer/contracts</div>
              <div>GET /api/v1/customer/invoices</div>
              <div>GET /api/v1/customer/invoices/[id]</div>
              <div>GET /api/v1/customer/sites</div>
              <div>GET /api/v1/customer/metering-values</div>
              <div>GET /api/v1/customer/documents</div>
              <div>POST /api/v1/customer/profile-update</div>
              <div>POST /api/v1/customer/move-out</div>
              <div>POST /api/v1/customer/support-case</div>
            </div>
          </div>
        </aside>
      </div>

      <section className="mt-8 rounded-[32px] border border-slate-200 bg-white p-6 shadow-sm">
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div>
            <h2 className="text-2xl font-semibold tracking-tight text-slate-950">Befintliga API-klienter</h2>
            <p className="mt-1 text-sm text-slate-600">Token visas aldrig igen. Gamla nycklar ska först återkallas och kan därefter raderas från listan.</p>
          </div>
        </div>

        <div className="mt-6 overflow-hidden rounded-3xl border border-slate-200">
          <table className="min-w-full divide-y divide-slate-200 text-sm">
            <thead className="bg-slate-50 text-left text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">
              <tr>
                <th className="px-4 py-3">Klient</th>
                <th className="px-4 py-3">Bolag</th>
                <th className="px-4 py-3">Scopes</th>
                <th className="px-4 py-3">Origins</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Senast använd</th>
                <th className="px-4 py-3">Åtgärd</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 bg-white">
              {clients.map((client) => {
                const metadata = client.metadata ?? {}
                const origins = valueList(client.allowed_origins).length ? valueList(client.allowed_origins) : valueList(metadata.allowed_origins)
                return (
                  <tr key={client.id}>
                    <td className="px-4 py-4 align-top">
                      <div className="font-semibold text-slate-950">{client.name}</div>
                      <div className="mt-1 text-xs text-slate-500">prefix {client.key_prefix} · skapad {formatDate(client.created_at)}</div>
                    </td>
                    <td className="px-4 py-4 align-top text-slate-700">{client.companies?.name ?? client.company_id}</td>
                    <td className="px-4 py-4 align-top">
                      <div className="flex flex-wrap gap-1.5">
                        {valueList(client.scopes).map((scope) => (
                          <span key={scope} className="rounded-full border border-slate-200 bg-slate-50 px-2 py-1 text-xs text-slate-700">{scope}</span>
                        ))}
                      </div>
                    </td>
                    <td className="px-4 py-4 align-top text-xs text-slate-600">
                      {origins.length ? origins.map((origin) => <div key={origin}>{origin}</div>) : 'Server-to-server'}
                    </td>
                    <td className="px-4 py-4 align-top">
                      <span className={`rounded-full border px-3 py-1 text-xs font-semibold ${statusTone(client.status)}`}>{client.status}</span>
                    </td>
                    <td className="px-4 py-4 align-top text-slate-700">{formatDate(client.last_used_at)}</td>
                    <td className="px-4 py-4 align-top">
                      <div className="flex flex-wrap gap-2">
                        {client.status === 'active' ? (
                          <form action={setIntegrationApiClientStatusAction}>
                            <input type="hidden" name="clientId" value={client.id} />
                            <input type="hidden" name="status" value="paused" />
                            <button className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-800">Pausa</button>
                          </form>
                        ) : client.status === 'paused' ? (
                          <form action={setIntegrationApiClientStatusAction}>
                            <input type="hidden" name="clientId" value={client.id} />
                            <input type="hidden" name="status" value="active" />
                            <button className="rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs font-semibold text-emerald-800">Aktivera</button>
                          </form>
                        ) : null}
                        {client.status !== 'revoked' ? (
                          <form action={setIntegrationApiClientStatusAction}>
                            <input type="hidden" name="clientId" value={client.id} />
                            <input type="hidden" name="status" value="revoked" />
                            <input type="hidden" name="reason" value="Återkallad från superadmin UI" />
                            <button className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs font-semibold text-red-800">Återkalla</button>
                          </form>
                        ) : null}
                        {client.status === 'revoked' || client.status === 'expired' ? (
                          <form action={deleteIntegrationApiClientAction}>
                            <input type="hidden" name="clientId" value={client.id} />
                            <button className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50">Radera gammal nyckel</button>
                          </form>
                        ) : null}
                      </div>
                    </td>
                  </tr>
                )
              })}
              {clients.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-4 py-10 text-center text-sm text-slate-500">Inga API-klienter finns ännu.</td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </section>

      <section className="mt-8 rounded-[32px] border border-slate-200 bg-white p-6 shadow-sm">
        <h2 className="text-2xl font-semibold tracking-tight text-slate-950">Senaste API-anrop</h2>
        <div className="mt-5 space-y-3">
          {requests.map((request) => (
            <div key={request.id} className="grid gap-3 rounded-2xl border border-slate-200 p-4 text-sm md:grid-cols-[120px_minmax(0,1fr)_120px_120px]">
              <div className="font-semibold text-slate-900">{request.method}</div>
              <div className="truncate font-mono text-xs text-slate-600">{request.route}</div>
              <div className="text-slate-700">{request.status_code ?? '—'}</div>
              <div className="text-slate-500">{formatDate(request.created_at)}</div>
              {request.error_code ? <div className="md:col-span-4 text-xs text-red-700">{request.error_code}</div> : null}
            </div>
          ))}
          {requests.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-slate-300 p-8 text-center text-sm text-slate-500">Inga API-anrop loggade ännu.</div>
          ) : null}
        </div>
      </section>
    </main>
  )
}
