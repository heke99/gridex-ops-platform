import Link from 'next/link'
import AdminHeader from '@/components/admin/AdminHeader'
import { isPlatformAdminContext, requireAdminPageKeyAccess } from '@/lib/admin/guards'
import { listCustomerOperationTimeline, type CustomerOperationTimelineRow } from '@/lib/customers/customerOperationTimeline'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { getOperationalCompanyScope } from '@/lib/tenant/scope'

export const dynamic = 'force-dynamic'

type SearchParams = {
  q?: string
  status?: string
  group?: string
  action?: string
  from?: string
  to?: string
  before?: string
  beforeId?: string
}

type PageProps = { searchParams?: Promise<SearchParams> }

const STATUS_OPTIONS = [
  ['', 'Alla händelser'],
  ['needs_review', 'Kräver åtgärd'],
  ['in_progress', 'Pågår'],
  ['waiting_response', 'Väntar på svar'],
  ['response_received', 'Svar mottaget'],
  ['completed', 'Klart'],
  ['failed', 'Misslyckat'],
  ['blocked', 'Blockerat'],
  ['cancelled', 'Avbrutet'],
  ['skipped', 'Hoppad över'],
] as const

const GROUP_OPTIONS = [
  ['', 'Alla områden'],
  ['customer_data', 'Uppgiftsbegäran'],
  ['facility', 'Anläggning'],
  ['supplier_switch', 'Leverantörsbyte'],
  ['operation', 'Automationsjobb'],
] as const

function formatDate(value: string) {
  return new Intl.DateTimeFormat('sv-SE', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value))
}

function statusLabel(status: string) {
  const labels: Record<string, string> = {
    queued: 'Köad',
    in_progress: 'Pågår',
    waiting_response: 'Väntar på svar',
    response_received: 'Svar mottaget',
    completed: 'Klart',
    needs_review: 'Kräver åtgärd',
    failed: 'Misslyckat',
    blocked: 'Blockerad',
    skipped: 'Hoppad över',
    cancelled: 'Avbrutet',
  }
  return labels[status] ?? status.replaceAll('_', ' ')
}

function statusTone(status: string) {
  if (status === 'failed' || status === 'blocked') return 'bg-red-100 text-red-800'
  if (status === 'needs_review') return 'bg-amber-100 text-amber-900'
  if (status === 'waiting_response' || status === 'queued' || status === 'in_progress') return 'bg-sky-100 text-sky-800'
  if (status === 'response_received' || status === 'completed') return 'bg-emerald-100 text-emerald-800'
  return 'bg-slate-100 text-slate-700'
}

function eventLocation(row: CustomerOperationTimelineRow) {
  const address = row.siteAddress ?? row.siteName
  const identifiers = [row.facilityId ? `Anläggning ${row.facilityId}` : null, row.meteringPointReference ? `Mätpunkt ${row.meteringPointReference}` : null].filter(Boolean)
  return [address, ...identifiers].filter(Boolean).join(' · ') || 'Kundnivå'
}

function nextStep(row: CustomerOperationTimelineRow) {
  if (row.actionRequired) return 'Öppna kundkortet och följ rekommenderad åtgärd'
  if (row.status === 'waiting_response') return 'Systemet inväntar svar och fortsätter automatiskt'
  if (row.status === 'response_received') return 'Systemet uppdaterar kundens anläggningsuppgifter'
  if (row.status === 'completed') return 'Ingen manuell åtgärd behövs'
  return row.message
}

function safeActionHref(value: string | null, customerId: string) {
  return value?.startsWith('/admin/') ? value : `/admin/customers/${customerId}`
}

function endOfDateExclusive(value: string | undefined) {
  if (!value) return null
  const date = new Date(`${value}T00:00:00.000Z`)
  if (Number.isNaN(date.getTime())) return null
  date.setUTCDate(date.getUTCDate() + 1)
  return date.toISOString()
}

function buildQuery(params: SearchParams, patch: Record<string, string | null | undefined>) {
  const query = new URLSearchParams()
  const merged = { ...params, ...patch }
  for (const [key, value] of Object.entries(merged)) {
    if (typeof value === 'string' && value.trim()) query.set(key, value)
  }
  return query.toString()
}

export default async function CustomerOperationEventsPage({ searchParams }: PageProps) {
  const context = await requireAdminPageKeyAccess('operations.tasks')
  const scope = await getOperationalCompanyScope(context.userId)
  const params = (await searchParams) ?? {}
  const isPlatformAdmin = isPlatformAdminContext(context)

  if (!scope.companyId) {
    return (
      <div className="min-h-screen bg-slate-50">
        <AdminHeader title="Händelser" subtitle="Välj ett bolag för att se den operativa historiken." userEmail={context.email} workspaceMode={isPlatformAdmin ? 'platform' : 'tenant'} />
        <main className="p-6 lg:p-8"><div className="rounded-3xl border border-amber-200 bg-amber-50 p-6 text-sm text-amber-950">{scope.message ?? 'Aktivt bolag saknas.'}</div></main>
      </div>
    )
  }

  const supabase = await createSupabaseServerClient()
  const rows = await listCustomerOperationTimeline(supabase, scope.companyId, {
    search: params.q,
    status: params.status,
    eventGroup: params.group,
    actionRequired: params.action === 'required' ? true : null,
    dateFrom: params.from ? `${params.from}T00:00:00.000Z` : null,
    dateTo: endOfDateExclusive(params.to),
    cursor: params.before,
    cursorId: params.beforeId,
    limit: 50,
  })
  const actionCount = rows.filter((row) => row.actionRequired).length
  const waitingCount = rows.filter((row) => row.status === 'waiting_response').length
  const receivedCount = rows.filter((row) => row.status === 'response_received').length
  const last = rows.at(-1) ?? null

  return (
    <div className="min-h-screen bg-slate-50">
      <AdminHeader
        title="Händelser"
        subtitle="Samlad historik för kundens anläggning, automatiska kontroller, nätägarsvar och leverantörsbyte."
        userEmail={context.email}
        workspaceName={scope.companyName}
        workspaceMode={isPlatformAdmin ? 'platform' : 'tenant'}
      />

      <main className="space-y-6 p-6 lg:p-8">
        <section className="rounded-3xl border border-emerald-200 bg-emerald-50 p-5 text-sm leading-6 text-emerald-950 shadow-sm">
          En rad beskriver ett faktiskt steg i kundens operativa kedja. Arbetskön visar bara sådant som kräver åtgärd; den här vyn visar även pågående och klara steg.
        </section>

        <section className="grid gap-4 md:grid-cols-4">
          <StatCard label="Visade händelser" value={rows.length} />
          <StatCard label="Kräver åtgärd" value={actionCount} tone={actionCount ? 'warning' : 'ok'} />
          <StatCard label="Väntar på svar" value={waitingCount} tone={waitingCount ? 'info' : 'ok'} />
          <StatCard label="Svar mottaget" value={receivedCount} tone={receivedCount ? 'ok' : 'neutral'} />
        </section>

        <form className="grid gap-3 rounded-3xl border border-slate-200 bg-white p-5 shadow-sm lg:grid-cols-6">
          <label className="grid gap-1 lg:col-span-2">
            <span className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-600">Sök</span>
            <input name="q" defaultValue={params.q ?? ''} placeholder="Kund, kundnummer, e-post, adress, anläggning, mätpunkt eller nätägare" className="rounded-2xl border border-slate-300 px-3 py-2.5 text-sm" />
          </label>
          <SelectFilter label="Status" name="status" value={params.status} options={STATUS_OPTIONS} />
          <SelectFilter label="Område" name="group" value={params.group} options={GROUP_OPTIONS} />
          <label className="grid gap-1"><span className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-600">Från</span><input type="date" name="from" defaultValue={params.from ?? ''} className="rounded-2xl border border-slate-300 px-3 py-2.5 text-sm" /></label>
          <label className="grid gap-1"><span className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-600">Till</span><input type="date" name="to" defaultValue={params.to ?? ''} className="rounded-2xl border border-slate-300 px-3 py-2.5 text-sm" /></label>
          <div className="flex items-end gap-2 lg:col-span-6">
            <label className="inline-flex items-center gap-2 rounded-2xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm font-semibold text-slate-800"><input type="checkbox" name="action" value="required" defaultChecked={params.action === 'required'} /> Endast kräver åtgärd</label>
            <button className="rounded-2xl bg-emerald-700 px-4 py-2.5 text-sm font-bold text-white hover:bg-emerald-800">Filtrera</button>
            <Link href="/admin/events" className="rounded-2xl border border-slate-300 px-4 py-2.5 text-sm font-bold text-slate-800 hover:bg-slate-50">Rensa</Link>
          </div>
        </form>

        <section className="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm">
          {rows.length === 0 ? (
            <div className="p-10 text-center"><h2 className="text-lg font-semibold text-slate-950">Inga händelser matchar urvalet</h2><p className="mt-2 text-sm text-slate-600">När automatiska kontroller, svar eller manuella steg sker visas de här.</p></div>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full text-left text-sm">
                <thead className="bg-slate-50 text-xs uppercase tracking-[0.14em] text-slate-600"><tr><th className="px-5 py-3">Tid</th><th className="px-5 py-3">Kund</th><th className="px-5 py-3">Anläggning</th><th className="px-5 py-3">Händelse</th><th className="px-5 py-3">Status</th><th className="px-5 py-3">Nästa steg</th></tr></thead>
                <tbody className="divide-y divide-slate-100">
                  {rows.map((row) => (
                    <tr key={row.id} className="align-top hover:bg-slate-50/70">
                      <td className="whitespace-nowrap px-5 py-4 text-slate-600">{formatDate(row.occurredAt)}</td>
                      <td className="px-5 py-4"><Link href={`/admin/customers/${row.customerId}`} className="font-semibold text-slate-950 hover:text-emerald-800">{row.customerName}</Link><div className="mt-1 font-mono text-xs text-slate-500">{row.customerNumber ?? row.customerEmail ?? '—'}</div></td>
                      <td className="max-w-xs px-5 py-4 text-slate-700">{eventLocation(row)}{row.gridOwnerName ? <div className="mt-1 text-xs text-slate-500">Nätägare: {row.gridOwnerName}</div> : null}</td>
                      <td className="max-w-md px-5 py-4"><div className="font-semibold text-slate-950">{row.title}</div><div className="mt-1 leading-5 text-slate-600">{row.message}</div>{isPlatformAdmin ? <details className="mt-2 text-xs text-slate-500"><summary className="cursor-pointer font-semibold">Tekniska uppgifter</summary><div className="mt-2 space-y-1 rounded-xl bg-slate-950 p-3 font-mono text-[11px] text-slate-100"><div>operation: {row.operationId ?? '—'}</div><div>jobb: {row.customerOperationJobId ?? '—'} {row.jobType ? `(${row.jobType}/${row.jobStatus ?? '—'})` : ''}</div><div>källa: {row.source} · {row.eventCode}</div><pre className="mt-2 max-h-40 overflow-auto whitespace-pre-wrap border-t border-slate-700 pt-2 text-[10px]">{JSON.stringify(row.payload, null, 2)}</pre></div></details> : null}</td>
                      <td className="px-5 py-4"><span className={`inline-flex rounded-full px-3 py-1 text-xs font-bold ${statusTone(row.status)}`}>{statusLabel(row.status)}</span></td>
                      <td className="min-w-56 px-5 py-4 text-slate-700"><div>{nextStep(row)}</div><Link href={safeActionHref(row.actionUrl, row.customerId)} className="mt-2 inline-flex text-xs font-bold text-emerald-800 hover:text-emerald-950">Öppna kundkort →</Link></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        {rows.length === 50 && last ? <div className="flex justify-end"><Link href={`/admin/events?${buildQuery(params, { before: last.occurredAt, beforeId: last.id })}`} className="rounded-2xl border border-slate-300 px-4 py-2.5 text-sm font-bold text-slate-800 hover:bg-white">Visa fler händelser</Link></div> : null}
      </main>
    </div>
  )
}

function SelectFilter({ label, name, value, options }: { label: string; name: string; value?: string; options: ReadonlyArray<readonly [string, string]> }) {
  return <label className="grid gap-1"><span className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-600">{label}</span><select name={name} defaultValue={value ?? ''} className="rounded-2xl border border-slate-300 bg-white px-3 py-2.5 text-sm">{options.map(([optionValue, optionLabel]) => <option key={optionValue} value={optionValue}>{optionLabel}</option>)}</select></label>
}

function StatCard({ label, value, tone = 'neutral' }: { label: string; value: number; tone?: 'neutral' | 'ok' | 'warning' | 'info' }) {
  const classes = tone === 'warning' ? 'border-amber-200 bg-amber-50' : tone === 'info' ? 'border-sky-200 bg-sky-50' : tone === 'ok' ? 'border-emerald-200 bg-emerald-50' : 'border-slate-200 bg-white'
  return <div className={`rounded-3xl border p-5 shadow-sm ${classes}`}><div className="text-sm font-bold text-slate-700">{label}</div><div className="mt-2 text-3xl font-black tracking-tight text-slate-950">{value}</div></div>
}
