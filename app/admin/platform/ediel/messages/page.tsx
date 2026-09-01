import Link from 'next/link'
import AdminHeader from '@/components/admin/AdminHeader'
import { requirePlatformAdminAccess } from '@/lib/admin/guards'
import { supabaseService } from '@/lib/supabase/service'

export const dynamic = 'force-dynamic'

type SearchParams = Record<string, string | string[] | undefined>
type CompanyRow = { id: string; name: string | null }
type MessageRow = {
  id: string
  company_id: string | null
  direction: string | null
  message_family: string | null
  message_code: string | null
  message_version: string | null
  environment: string | null
  status: string | null
  sender_ediel_id: string | null
  receiver_ediel_id: string | null
  sender_sub_address?: string | null
  receiver_sub_address?: string | null
  application_reference: string | null
  customer_id: string | null
  metering_point_id: string | null
  grid_owner_id: string | null
  tenant_resolution_status?: string | null
  business_match_status?: string | null
  failure_reason: string | null
  created_at: string | null
}

function firstParam(value: string | string[] | undefined): string | null {
  if (Array.isArray(value)) return value[0] ?? null
  return value ?? null
}

function normalizeFilter(value: string | null): string | null {
  const trimmed = value?.trim()
  return trimmed && trimmed !== 'all' ? trimmed : null
}

function formatDate(value: string | null): string {
  if (!value) return '–'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleString('sv-SE')
}

function statusTone(status: string | null): string {
  const normalized = String(status ?? '').toLowerCase()
  if (['sent', 'acknowledged', 'validated', 'received', 'parsed'].includes(normalized)) return 'border-emerald-200 bg-emerald-50 text-emerald-800'
  if (['draft', 'queued', 'prepared', 'awaiting_contrl', 'awaiting_aperak'].includes(normalized)) return 'border-amber-200 bg-amber-50 text-amber-900'
  if (['failed', 'cancelled', 'rejected'].includes(normalized)) return 'border-red-200 bg-red-50 text-red-800'
  return 'border-slate-200 bg-slate-50 text-slate-700'
}

function Pill({ value }: { value: string | null | undefined }) {
  const label = value && value.length > 0 ? value : '–'
  return <span className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-bold ${statusTone(label)}`}>{label}</span>
}

async function listCompanies(): Promise<CompanyRow[]> {
  const { data, error } = await supabaseService.from('companies').select('id,name').eq('status', 'active').eq('lifecycle_status', 'active').eq('is_active', true).is('archived_at', null).order('name', { ascending: true }).limit(300)
  if (error) {
    console.warn('[platform-ediel-messages] companies could not be loaded', error)
    return []
  }
  return (data ?? []) as CompanyRow[]
}

async function listMessages(filters: {
  companyId: string | null
  family: string | null
  direction: string | null
  status: string | null
  environment: string | null
}): Promise<MessageRow[]> {
  let query = supabaseService
    .from('ediel_messages')
    .select('id,company_id,direction,message_family,message_code,message_version,environment,status,sender_ediel_id,receiver_ediel_id,sender_sub_address,receiver_sub_address,application_reference,customer_id,metering_point_id,grid_owner_id,tenant_resolution_status,business_match_status,failure_reason,created_at')
    .order('created_at', { ascending: false })
    .limit(250)

  if (filters.companyId) query = query.eq('company_id', filters.companyId)
  if (filters.family) query = query.eq('message_family', filters.family)
  if (filters.direction === 'inbound' || filters.direction === 'outbound') query = query.eq('direction', filters.direction)
  if (filters.status) query = query.eq('status', filters.status)
  if (filters.environment) query = query.eq('environment', filters.environment)

  const { data, error } = await query
  if (error) throw error
  return (data ?? []) as MessageRow[]
}

function buildHref(filters: Record<string, string | null>) {
  const params = new URLSearchParams()
  for (const [key, value] of Object.entries(filters)) {
    if (value) params.set(key, value)
  }
  const query = params.toString()
  return query ? `/admin/platform/ediel/messages?${query}` : '/admin/platform/ediel/messages'
}

export default async function PlatformEdielMessagesPage({ searchParams }: { searchParams?: Promise<SearchParams> }) {
  const admin = await requirePlatformAdminAccess()
  const resolved = searchParams ? await searchParams : {}
  const filters = {
    companyId: normalizeFilter(firstParam(resolved.companyId)),
    family: normalizeFilter(firstParam(resolved.family)),
    direction: normalizeFilter(firstParam(resolved.direction)),
    status: normalizeFilter(firstParam(resolved.status)),
    environment: normalizeFilter(firstParam(resolved.environment)),
  }

  const [companies, messages] = await Promise.all([listCompanies(), listMessages(filters)])
  const companyNameById = new Map(companies.map((company) => [company.id, company.name ?? company.id]))

  return (
    <div className="min-h-screen bg-slate-50">
      <AdminHeader
        title="Global Ediel-meddelandevy"
        subtitle="Superadminvy över inbound, outbound, ACK-kedjor och osäkra matchningar över alla tenants. Filtrera per bolag, meddelandetyp, miljö och status."
        userEmail={admin.email}
        workspaceMode="platform"
      />

      <main className="space-y-6 p-4 sm:p-6 xl:p-8">
        <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <p className="text-xs font-bold uppercase tracking-[0.18em] text-emerald-700">Ediel message center</p>
              <h1 className="mt-2 text-2xl font-black text-slate-950">Alla meddelanden per tenant</h1>
              <p className="mt-2 max-w-4xl text-sm leading-6 text-slate-700">
                Den här vyn är byggd för drift: mailboxen är bara transport. Kontrollera alltid tenant, sender/receiver Ediel-ID, subadress, route, certifikat och status innan manuell åtgärd.
              </p>
            </div>
            <Link href="/admin/ediel/messages" className="rounded-2xl border border-slate-300 bg-white px-4 py-2 text-sm font-bold text-slate-800 hover:bg-slate-50">
              Öppna operativ vy
            </Link>
          </div>

          <form className="mt-6 grid gap-3 md:grid-cols-5" action="/admin/platform/ediel/messages">
            <label className="text-sm font-bold text-slate-700">
              Tenant
              <select name="companyId" defaultValue={filters.companyId ?? 'all'} className="mt-1 h-11 w-full rounded-2xl border border-slate-300 bg-white px-3 text-sm">
                <option value="all">Alla tenants</option>
                {companies.map((company) => <option key={company.id} value={company.id}>{company.name ?? company.id}</option>)}
              </select>
            </label>
            <label className="text-sm font-bold text-slate-700">
              Typ
              <select name="family" defaultValue={filters.family ?? 'all'} className="mt-1 h-11 w-full rounded-2xl border border-slate-300 bg-white px-3 text-sm">
                <option value="all">Alla</option>
                {['PRODAT', 'UTILTS', 'CONTRL', 'APERAK', 'UTILTS_ERR'].map((family) => <option key={family} value={family}>{family}</option>)}
              </select>
            </label>
            <label className="text-sm font-bold text-slate-700">
              Riktning
              <select name="direction" defaultValue={filters.direction ?? 'all'} className="mt-1 h-11 w-full rounded-2xl border border-slate-300 bg-white px-3 text-sm">
                <option value="all">Alla</option>
                <option value="inbound">Inbound</option>
                <option value="outbound">Outbound</option>
              </select>
            </label>
            <label className="text-sm font-bold text-slate-700">
              Miljö
              <select name="environment" defaultValue={filters.environment ?? 'all'} className="mt-1 h-11 w-full rounded-2xl border border-slate-300 bg-white px-3 text-sm">
                <option value="all">Alla</option>
                <option value="test">Test</option>
                <option value="production">Production</option>
              </select>
            </label>
            <label className="text-sm font-bold text-slate-700">
              Status
              <select name="status" defaultValue={filters.status ?? 'all'} className="mt-1 h-11 w-full rounded-2xl border border-slate-300 bg-white px-3 text-sm">
                <option value="all">Alla</option>
                {['draft', 'prepared', 'queued', 'sent', 'received', 'parsed', 'validated', 'acknowledged', 'failed'].map((status) => <option key={status} value={status}>{status}</option>)}
              </select>
            </label>
            <div className="md:col-span-5 flex flex-wrap gap-2">
              <button className="rounded-2xl bg-slate-950 px-4 py-2 text-sm font-bold text-white hover:bg-slate-800">Filtrera</button>
              <Link href="/admin/platform/ediel/messages" className="rounded-2xl border border-slate-300 bg-white px-4 py-2 text-sm font-bold text-slate-700 hover:bg-slate-50">Rensa</Link>
              <Link href={buildHref({ ...filters, direction: 'outbound', status: 'draft' })} className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-2 text-sm font-bold text-amber-900">Outbound drafts</Link>
              <Link href={buildHref({ ...filters, status: 'failed' })} className="rounded-2xl border border-red-200 bg-red-50 px-4 py-2 text-sm font-bold text-red-900">Felade</Link>
            </div>
          </form>
        </section>

        <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-slate-200 text-sm">
              <thead className="bg-slate-50 text-left text-xs font-bold uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-4 py-3">Tid</th>
                  <th className="px-4 py-3">Tenant</th>
                  <th className="px-4 py-3">Meddelande</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3">Routing</th>
                  <th className="px-4 py-3">Matchning</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {messages.map((message) => (
                  <tr key={message.id} className="align-top">
                    <td className="px-4 py-4 text-xs text-slate-500">{formatDate(message.created_at)}</td>
                    <td className="px-4 py-4 text-sm font-bold text-slate-900">{message.company_id ? companyNameById.get(message.company_id) ?? message.company_id : 'Ej tenant-matchad'}</td>
                    <td className="px-4 py-4">
                      <Link href={`/admin/ediel/messages/${message.id}`} className="font-bold text-slate-950 hover:text-emerald-700">
                        {message.direction ?? '–'} · {message.message_family ?? '–'} {message.message_code ?? ''}
                      </Link>
                      <div className="mt-1 text-xs text-slate-500">{message.environment ?? '–'} · {message.message_version ?? 'utan version'}</div>
                    </td>
                    <td className="px-4 py-4"><Pill value={message.status} /></td>
                    <td className="px-4 py-4 text-xs leading-6 text-slate-700">
                      <div>Sender: <span className="font-mono">{message.sender_ediel_id ?? '–'}</span></div>
                      <div>Receiver: <span className="font-mono">{message.receiver_ediel_id ?? '–'}</span></div>
                      <div>AppRef: {message.application_reference ?? '–'}</div>
                    </td>
                    <td className="px-4 py-4 text-xs leading-6 text-slate-700">
                      <div>Tenant: {message.tenant_resolution_status ?? '–'}</div>
                      <div>Business: {message.business_match_status ?? '–'}</div>
                      {message.failure_reason ? <div className="text-red-700">{message.failure_reason}</div> : null}
                    </td>
                  </tr>
                ))}
                {messages.length === 0 ? <tr><td colSpan={6} className="px-4 py-8 text-center text-sm text-slate-500">Inga meddelanden matchar filtret.</td></tr> : null}
              </tbody>
            </table>
          </div>
        </section>
      </main>
    </div>
  )
}
