import Link from 'next/link'
import { notFound } from 'next/navigation'
import AdminHeader from '@/components/admin/AdminHeader'
import { requireAdminPageKeyAccess } from '@/lib/admin/guards'
import { resolveAdminTenantReadScope } from '@/lib/tenant/adminScope'
import { getAdminPageRequirement, hasPermissionRequirement } from '@/lib/admin/accessModel'
import { getCustomerCaseById, listCustomerCaseEvents, listCustomerCases, customerCaseStatusLabel } from '@/lib/customer-cases/db'
import { tenantDb } from '@/lib/supabase/tenantDb'
import { getOperationalCompanyScope } from '@/lib/tenant/scope'
import { isCompanyWritableInTenantWorkspace } from '@/lib/tenant/lifecycle'
import type { CustomerCaseRow } from '@/lib/customer-cases/types'
import { updateEdielOperationalCaseStatusAction } from './actions'

export const dynamic = 'force-dynamic'

const SOURCE = 'ediel_inbound_state_machine'
const EXCEPTION_STATUSES = ['open', 'action_required', 'awaiting_external_response', 'billing_blocked', 'manual_follow_up'] as const
const ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const INTENTS = new Set(['final_metering_and_billing', 'supply_continuation_review', 'meter_change_review', 'masterdata_update_review', 'ediel_unexpected_direction'])

function formatDate(value: string | null | undefined) {
  return value ? new Intl.DateTimeFormat('sv-SE', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value)) : '—'
}

function metadataId(row: CustomerCaseRow, key: string): string | null {
  const value = row.metadata && typeof row.metadata === 'object' ? row.metadata[key] : null
  return typeof value === 'string' && ID.test(value) ? value : null
}

async function hasRelatedRow(table: 'customers' | 'ediel_messages', id: string, companyId: string) {
  const scopedQuery = tenantDb(companyId).from(table).select('id,company_id') as {
    eq: (column: string, value: string) => { maybeSingle: () => Promise<{ data: { company_id: string } | null; error: unknown }> }
  }
  const { data, error } = await scopedQuery.eq('id', id).maybeSingle()
  if (error) throw error
  return data?.company_id === companyId
}

export default async function EdielOperationalCasesPage({ searchParams }: { searchParams: Promise<{ caseId?: string | string[]; view?: string | string[]; page?: string | string[] }> }) {
  const context = await requireAdminPageKeyAccess('customer.cases')
  const scope = await resolveAdminTenantReadScope(context)
  const query = await searchParams
  const requestedId = query.caseId
  if (!scope.isPlatformAdmin && !scope.companyId) {
    return <div className="min-h-screen bg-slate-50"><AdminHeader title="Ediel-ärenden" userEmail={context.email} /><main className="p-6"><h1 className="text-xl font-semibold">Bolagskoppling saknas</h1><p>Välj ett aktivt bolag för att läsa operativa Ediel-ärenden.</p></main></div>
  }

  if (requestedId !== undefined && (typeof requestedId !== 'string' || !ID.test(requestedId))) notFound()
  if (query.view !== undefined && query.view !== 'exceptions') notFound()
  if (query.page !== undefined && (typeof query.page !== 'string' || !/^[1-9][0-9]{0,5}$/.test(query.page))) notFound()
  const page = query.page ? Number(query.page) : 1
  const pageHref = (number: number) => `/admin/ediel/operational-cases?${query.view === 'exceptions' ? 'view=exceptions&' : ''}page=${number}`
  const caseHref = (id: string) => `/admin/ediel/operational-cases?caseId=${encodeURIComponent(id)}${query.view === 'exceptions' ? '&view=exceptions' : ''}${query.page ? `&page=${page}` : ''}`
  const companyId = scope.companyId
  const selectedCase = requestedId ? await getCustomerCaseById(requestedId, companyId) : null
  if (requestedId && (!selectedCase || selectedCase.source !== SOURCE)) notFound()
  const [cases, events] = await Promise.all([
    listCustomerCases({ companyId, source: SOURCE, statuses: query.view === 'exceptions' ? EXCEPTION_STATUSES : undefined, offset: (page - 1) * 200, limit: 201 }),
    selectedCase ? listCustomerCaseEvents(selectedCase.id, companyId) : Promise.resolve([]),
  ])

  const sourceId = selectedCase ? metadataId(selectedCase, 'source_ediel_message_id') : null
  const canReadCustomer = scope.isPlatformAdmin || hasPermissionRequirement(context.permissions, getAdminPageRequirement('customers.detail'))
  const [sourceValid, customerValid] = selectedCase ? await Promise.all([
    sourceId ? hasRelatedRow('ediel_messages', sourceId, selectedCase.company_id) : Promise.resolve(false),
    selectedCase.customer_id && canReadCustomer ? hasRelatedRow('customers', selectedCase.customer_id, selectedCase.company_id) : Promise.resolve(false),
  ]) : [false, false]
  const rawIntent = selectedCase?.metadata && typeof selectedCase.metadata === 'object' ? selectedCase.metadata.review_intent : null
  const intent = typeof rawIntent === 'string' && INTENTS.has(rawIntent) ? rawIntent : 'Okänd eller saknad granskningsavsikt'
  const operational = selectedCase && !scope.isPlatformAdmin && context.permissions.includes('cases.write') ? await getOperationalCompanyScope(context.userId) : null
  const membership = operational?.memberships.find((row) => row.companyId === scope.companyId)
  const canTriage = Boolean(selectedCase && operational && context.companyId === scope.companyId && operational.companyId === scope.companyId && membership?.status === 'active' && isCompanyWritableInTenantWorkspace(membership.companyStatus))

  return <div className="min-h-screen bg-slate-50">
    <AdminHeader title="Ediel-ärenden" subtitle="Operativa granskningsärenden från inkommande Ediel. Statushantering ger ingen käll- eller marknadsgodkännande." userEmail={context.email} workspaceName={scope.isPlatformAdmin ? 'Gridex Platform' : scope.companyName ?? 'Bolag saknas'} workspaceMode={scope.isPlatformAdmin ? 'platform' : 'tenant'} />
    <main className="grid gap-6 p-6 lg:grid-cols-[minmax(260px,360px)_1fr] lg:p-8">
      <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm" aria-label="Ediel-ärenden">
        <h1 className="text-xl font-semibold text-slate-950">Ediel-ärenden</h1>
        <p className="mt-2 text-sm text-slate-600">{query.view === 'exceptions' ? 'Öppna avvikelseärenden från Ediels operativa källa.' : 'Historik från Ediels operativa källa.'} Sida {page}, högst 200 ärenden per sida. Exakta ärendelänkar fungerar även utanför listan.</p>
        <div className="mt-4 space-y-2">{cases.length ? cases.slice(0, 200).map((row) => <Link key={row.id} href={caseHref(row.id)} className="block rounded-xl border border-slate-200 p-3 hover:bg-slate-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-slate-900"><span className="block font-semibold">{row.title}</span><span className="block text-xs text-slate-600">{customerCaseStatusLabel(row.status)} · {formatDate(row.created_at)}{scope.isPlatformAdmin ? ` · Bolag ${row.company_id}` : ''}</span></Link>) : <p className="text-sm text-slate-600">Inga operativa Ediel-ärenden på denna sida.</p>}</div>
        <nav aria-label="Ärendesidor" className="mt-5 flex gap-4 text-sm font-semibold">{page > 1 ? <Link href={pageHref(page - 1)} className="underline focus-visible:outline">Föregående sida</Link> : null}{cases.length > 200 ? <Link href={pageHref(page + 1)} className="underline focus-visible:outline">Nästa sida</Link> : null}</nav>
      </section>
      <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm" aria-label="Ärendedetaljer">
        {!selectedCase ? <p className="text-sm text-slate-600">Välj ett ärende för att se granskningsorsak och nästa åtgärd.</p> : <article className="space-y-5">
          <div><h2 className="text-xl font-semibold text-slate-950">{selectedCase.title}</h2><p className="mt-1 text-sm text-slate-600">{customerCaseStatusLabel(selectedCase.status)} · {selectedCase.priority} · Skapat {formatDate(selectedCase.created_at)} · Uppdaterat {formatDate(selectedCase.updated_at)}</p>{scope.isPlatformAdmin ? <p className="text-sm text-slate-600">Bolag: {selectedCase.company_id}</p> : null}</div>
          <dl className="space-y-3 text-sm"><div><dt className="font-semibold">Granskningsavsikt</dt><dd>{intent}</dd></div><div><dt className="font-semibold">Orsakskategori</dt><dd>{selectedCase.reason_category ?? 'Ej angiven'}</dd></div><div><dt className="font-semibold">Beskrivning</dt><dd className="whitespace-pre-wrap">{selectedCase.description ?? 'Ej angiven'}</dd></div><div><dt className="font-semibold">Nästa åtgärd</dt><dd className="whitespace-pre-wrap">{selectedCase.next_action ?? 'Ej angiven'}</dd></div></dl>
          <div className="space-y-2 text-sm"><h3 className="font-semibold">Referenser</h3>
            {sourceId && sourceValid ? scope.isPlatformAdmin ? <Link href={`/admin/ediel/messages/${sourceId}`} className="underline focus-visible:outline">Källmeddelande {sourceId}</Link> : <p>Källmeddelande {sourceId} — källvyn kräver plattformsbehörighet.</p> : <p>Källmeddelande kan inte verifieras för detta bolag.</p>}
            {selectedCase.customer_id && customerValid ? <p><Link href={`/admin/customers/${selectedCase.customer_id}`} className="underline focus-visible:outline">Visa kund</Link></p> : <p>Kundlänk är inte tillgänglig för detta bolag eller denna behörighet.</p>}
          </div>
          {canTriage ? <form action={updateEdielOperationalCaseStatusAction} className="flex flex-wrap items-end gap-3 rounded-xl border border-slate-200 p-4"><input type="hidden" name="case_id" value={selectedCase.id} /><div><label htmlFor="ediel-case-status" className="block text-sm font-semibold">Ärendestatus</label><p className="text-sm text-slate-600">Aktuell status: {customerCaseStatusLabel(selectedCase.status)}</p><select id="ediel-case-status" name="status" required defaultValue="" className="mt-1 rounded-lg border border-slate-300 px-3 py-2 text-sm"><option value="" disabled>Välj ny status</option><option value="open">Öppen</option><option value="action_required">Kräver åtgärd</option><option value="awaiting_external_response">Väntar externt svar</option><option value="manual_follow_up">Manuell uppföljning</option><option value="resolved">Löst</option><option value="closed">Stängd</option></select></div><button type="submit" className="rounded-lg bg-slate-950 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-950">Spara status</button></form> : null}
          <div><h3 className="font-semibold">Ärendehändelser</h3><ol className="mt-2 space-y-2">{events.map((event) => <li key={event.id} className="rounded-xl border border-slate-200 p-3 text-sm"><p>{event.message}</p><p className="text-xs text-slate-600">{formatDate(event.created_at)}</p></li>)}</ol></div>
        </article>}
      </section>
    </main>
  </div>
}
