import Link from 'next/link'
import { notFound } from 'next/navigation'
import AdminHeader from '@/components/admin/AdminHeader'
import { requireAdminPageKeyAccess } from '@/lib/admin/guards'
import { resolveAdminTenantReadScope } from '@/lib/tenant/adminScope'
import { getAdminPageRequirement, hasPermissionRequirement } from '@/lib/admin/accessModel'
import { getCustomerCaseById, listCustomerCaseEvents, listCustomerCases } from '@/lib/customer-cases/db'
import { EDIEL_OPERATIONAL_CASE_SOURCES, isEdielOperationalCaseSource } from '@/lib/ediel/operations/operationalCaseSources'
import { tenantDb } from '@/lib/supabase/tenantDb'
import { getOperationalCompanyScope } from '@/lib/tenant/scope'
import { isCompanyWritableInTenantWorkspace } from '@/lib/tenant/lifecycle'
import type { CustomerCaseEventRow, CustomerCaseRow } from '@/lib/customer-cases/types'
import { formatAdminDateTime, formatStatusLabel } from '@/lib/ui/format'
import { readPersistedEdielReviewProcessDecision } from '@/lib/ediel/operations/processNextAction'
import { updateEdielOperationalCaseStatusAction } from './actions'

export const dynamic = 'force-dynamic'

const EXCEPTION_STATUSES = ['open', 'action_required', 'awaiting_external_response', 'billing_blocked', 'manual_follow_up'] as const
const ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
type ReviewCopy = { reason: string; nextAction: string }

const REVIEW_COPY: Readonly<Record<string, ReviewCopy>> = {
  final_metering_and_billing: {
    reason: 'Slutavläsning och fakturering',
    nextAction: 'Kontrollera slutmätvärden och faktureringsberedskap för den berörda leveransperioden.',
  },
  supply_continuation_review: {
    reason: 'Fortsatt elleverans behöver granskas',
    nextAction: 'Kontrollera om leveransen gäller rätt kund och anläggning innan du går vidare.',
  },
  meter_change_review: {
    reason: 'Mätarbyte behöver granskas',
    nextAction: 'Verifiera mätarbytet och bevara tidigare mätvärden innan du ändrar uppgifterna.',
  },
  masterdata_update_review: {
    reason: 'Anläggningens grunduppgifter behöver granskas',
    nextAction: 'Kontrollera vilka uppgifter som har ändrats innan du uppdaterar anläggningen.',
  },
  ediel_unexpected_direction: {
    reason: 'Meddelandets avsändare behöver granskas',
    nextAction: 'Kontrollera vem som skickade beskedet och om det gäller denna leverans.',
  },
  business_rejection: {
    reason: 'Mottagaren avvisade begäran',
    nextAction: 'Kontrollera den berörda begäran innan du försöker igen.',
  },
  technical_rejection: {
    reason: 'Meddelandet behöver teknisk granskning',
    nextAction: 'Be plattformsadministratören kontrollera meddelandet innan du försöker igen.',
  },
  metering_values_error: {
    reason: 'Ett fel rapporterades för mätvärdena',
    nextAction: 'Kontrollera vilken period och mätpunkt som berörs innan du begär nya värden.',
  },
}

const UNKNOWN_REVIEW: ReviewCopy = {
  reason: 'Källbeslutet behöver granskas',
  nextAction: 'Kontrollera vad beskedet gäller innan du fortsätter.',
}

function reviewCopy(row: CustomerCaseRow): ReviewCopy {
  const reviewIntent = row.metadata?.review_intent
  if (typeof reviewIntent === 'string' && Object.hasOwn(REVIEW_COPY, reviewIntent)) return REVIEW_COPY[reviewIntent]
  return Object.hasOwn(REVIEW_COPY, row.case_type) ? REVIEW_COPY[row.case_type] : UNKNOWN_REVIEW
}

function tenantEventLabel(event: CustomerCaseEventRow): string {
  const status = event.payload?.status
  if (event.event_type === 'status_changed' && typeof status === 'string') {
    return `Ärendestatus ändrades till ${formatStatusLabel(status, 'Okänd status', 'Okänd status')}.`
  }
  return 'En händelse har registrerats i ärendet.'
}

function metadataId(row: CustomerCaseRow, key: string): string | null {
  const value = row.metadata && typeof row.metadata === 'object' ? row.metadata[key] : null
  return typeof value === 'string' && ID.test(value) ? value : null
}

async function readRelatedRow(table: 'customers' | 'ediel_messages', id: string, companyId: string) {
  const scopedQuery = tenantDb(companyId).from(table).select(table === 'ediel_messages' ? 'id,company_id,message_received_at' : 'id,company_id') as {
    eq: (column: string, value: string) => { maybeSingle: () => Promise<{ data: { id: string; company_id: string; message_received_at?: string | null } | null; error: unknown }> }
  }
  const { data, error } = await scopedQuery.eq('id', id).maybeSingle()
  if (error) throw error
  return data?.company_id === companyId && data.id === id ? data : null
}

async function readSupplyEndCaseReview(row: CustomerCaseRow, sourceId: string): Promise<'retracted' | 'unavailable' | null> {
  try {
    const { supabaseService } = await import('@/lib/supabase/service')
    const rpc = supabaseService.rpc.bind(supabaseService) as unknown as (
      name: string, args: { p_company_id: string; p_case_id: string }
    ) => PromiseLike<{ data: unknown; error: unknown }>
    const { data, error } = await rpc('gridex_read_supply_end_followup_disposition_v1', {
      p_company_id: row.company_id, p_case_id: row.id,
    })
    if (error) return 'unavailable'
    if (data === null) return null
    if (!data || typeof data !== 'object' || Array.isArray(data)) return 'unavailable'
    const evidence = data as Record<string, unknown>
    return evidence.caseId === row.id && evidence.sourceMessageId === sourceId && evidence.status === 'review_required'
      ? 'retracted' : 'unavailable'
  } catch {
    return 'unavailable'
  }
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
  if (requestedId && (!selectedCase || selectedCase.id !== requestedId ||
    (companyId !== null && selectedCase.company_id !== companyId) ||
    !isEdielOperationalCaseSource(selectedCase.source))) notFound()
  const [cases, events] = await Promise.all([
    listCustomerCases({ companyId, sources: EDIEL_OPERATIONAL_CASE_SOURCES, statuses: query.view === 'exceptions' ? EXCEPTION_STATUSES : undefined, offset: (page - 1) * 200, limit: 201 }),
    selectedCase ? listCustomerCaseEvents(selectedCase.id, companyId) : Promise.resolve([]),
  ])

  const sourceId = selectedCase ? metadataId(selectedCase, 'source_ediel_message_id') : null
  const canReadCustomer = scope.isPlatformAdmin || hasPermissionRequirement(context.permissions, getAdminPageRequirement('customers.detail'))
  const [source, customer] = selectedCase ? await Promise.all([
    sourceId ? readRelatedRow('ediel_messages', sourceId, selectedCase.company_id) : Promise.resolve(null),
    selectedCase.customer_id && canReadCustomer ? readRelatedRow('customers', selectedCase.customer_id, selectedCase.company_id) : Promise.resolve(null),
  ]) : [null, null]
  const sourceValid = Boolean(source), customerValid = Boolean(customer)
  const rawIntent = selectedCase?.metadata && typeof selectedCase.metadata === 'object' ? selectedCase.metadata.review_intent : null
  const selectedReview = selectedCase ? reviewCopy(selectedCase) : null
  const operational = selectedCase && !scope.isPlatformAdmin && context.permissions.includes('cases.write') ? await getOperationalCompanyScope(context.userId) : null
  const membership = operational?.memberships.find((row) => row.companyId === scope.companyId)
  const canTriage = Boolean(selectedCase && operational && context.companyId === scope.companyId && operational.companyId === scope.companyId && membership?.status === 'active' && isCompanyWritableInTenantWorkspace(membership.companyStatus))
  const supplyEndReview = selectedCase?.reason_category === 'final_metering_and_billing'
    ? sourceId && sourceValid ? await readSupplyEndCaseReview(selectedCase, sourceId) : 'unavailable'
    : null
  const process = selectedCase && source ? readPersistedEdielReviewProcessDecision(selectedCase.metadata?.process_next_action, {
    message: { id: source.id, message_received_at: source.message_received_at ?? null }, reviewIntent: typeof rawIntent === 'string' ? rawIntent : undefined, nextAction: selectedCase.next_action,
  }) : null

  return <div className="min-h-screen bg-slate-50">
    <AdminHeader title="Ediel-ärenden" subtitle="Operativa granskningsärenden från inkommande Ediel. Statushantering ger ingen käll- eller marknadsgodkännande." userEmail={context.email} workspaceName={scope.isPlatformAdmin ? 'Gridex Platform' : scope.companyName ?? 'Bolag saknas'} workspaceMode={scope.isPlatformAdmin ? 'platform' : 'tenant'} />
    <main className="grid gap-6 p-6 lg:grid-cols-[minmax(260px,360px)_1fr] lg:p-8">
      <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm" aria-label="Ediel-ärenden">
        <h1 className="text-xl font-semibold text-slate-950">Ediel-ärenden</h1>
        <p className="mt-2 text-sm text-slate-600">{query.view === 'exceptions' ? 'Öppna avvikelseärenden från Ediels operativa källa.' : 'Historik från Ediels operativa källa.'} Sida {page}, högst 200 ärenden per sida. Exakta ärendelänkar fungerar även utanför listan.</p>
        <div className="mt-4 space-y-2">{cases.length ? cases.slice(0, 200).map((row) => <Link key={row.id} href={caseHref(row.id)} className="block rounded-xl border border-slate-200 p-3 hover:bg-slate-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-slate-900"><span className="block font-semibold">{scope.isPlatformAdmin ? row.title : reviewCopy(row).reason}</span><span className="block text-xs text-slate-600">{formatStatusLabel(row.status, 'Okänd status', 'Okänd status')} · {formatAdminDateTime(row.created_at)}{scope.isPlatformAdmin ? ` · Bolag ${row.company_id}` : ''}</span></Link>) : <p className="text-sm text-slate-600">Inga operativa Ediel-ärenden på denna sida.</p>}</div>
        <nav aria-label="Ärendesidor" className="mt-5 flex gap-4 text-sm font-semibold">{page > 1 ? <Link href={pageHref(page - 1)} className="underline focus-visible:outline">Föregående sida</Link> : null}{cases.length > 200 ? <Link href={pageHref(page + 1)} className="underline focus-visible:outline">Nästa sida</Link> : null}</nav>
      </section>
      <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm" aria-label="Ärendedetaljer">
        {!selectedCase || !selectedReview ? <p className="text-sm text-slate-600">Välj ett ärende för att se granskningsorsak och nästa åtgärd.</p> : <article className="space-y-5">
          <div><h2 className="text-xl font-semibold text-slate-950">{scope.isPlatformAdmin ? selectedCase.title : selectedReview.reason}</h2><p className="mt-1 text-sm text-slate-600">{formatStatusLabel(selectedCase.status, 'Okänd status', 'Okänd status')} · {formatStatusLabel(selectedCase.priority, 'Okänd prioritet', 'Okänd prioritet')} · Skapat {formatAdminDateTime(selectedCase.created_at)} · Uppdaterat {formatAdminDateTime(selectedCase.updated_at)}</p>{scope.isPlatformAdmin ? <p className="text-sm text-slate-600">Bolag: {selectedCase.company_id}</p> : null}</div>
          {supplyEndReview ? <p role="status" className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-slate-900">
            {supplyEndReview === 'retracted'
              ? 'Nätägaren har återtagit leveransslutet. Kontrollera aktuell leverans och fakturaunderlaget innan slutfaktureringen fortsätter.'
              : 'Leveransslutet kunde inte kontrolleras. Kontrollera aktuell leverans innan slutfakturering.'}
          </p> : null}
          {scope.isPlatformAdmin ? <details className="space-y-3 text-sm">
            <summary className="font-semibold">Tekniska ärendeuppgifter</summary>
            <dl className="mt-3 space-y-3">
              <div><dt className="font-semibold">Granskningsavsikt</dt><dd>{typeof rawIntent === 'string' ? rawIntent : 'Ej angiven'}</dd></div>
              <div><dt className="font-semibold">Orsakskategori</dt><dd>{selectedCase.reason_category ?? 'Ej angiven'}</dd></div>
              <div><dt className="font-semibold">Beskrivning</dt><dd className="whitespace-pre-wrap">{selectedCase.description ?? 'Ej angiven'}</dd></div>
              <div><dt className="font-semibold">Registrerad åtgärd</dt><dd className="whitespace-pre-wrap">{selectedCase.next_action ?? 'Ej angiven'}</dd></div>
            </dl>
          </details> : null}
          <section aria-label="Processens nästa steg" className="rounded-xl border border-slate-200 p-4 text-sm">
            <h3 className="font-semibold">Processens nästa steg</h3>
            {supplyEndReview ? <p className="mt-2 text-slate-600">Granska den aktuella leveransperioden.</p> : process ? <dl className="mt-3 space-y-2"><div><dt className="font-semibold">Ansvar</dt><dd>Bolagets operatör</dd></div><div><dt className="font-semibold">Faktisk mottagningstid</dt><dd>{formatAdminDateTime(process.timeBasis.admittedAt)}</dd></div><div><dt className="font-semibold">Tidsgrund</dt><dd>Inkommande källmeddelandes mottagning; ingen protokollfrist härleds för granskningen.</dd></div><div><dt className="font-semibold">Granskningsorsak</dt><dd>{selectedReview.reason}</dd></div><div><dt className="font-semibold">Blockerare</dt><dd>{process.blockers.includes('actual_admission_time_required') ? 'Källmeddelandets faktiska mottagningstid saknas.' : 'Källbeslutet kräver operativ granskning.'}</dd></div><div><dt className="font-semibold">Fortsatt åtgärd</dt><dd>{process.timeBasis.admittedAt ? selectedReview.nextAction : 'Kontrollera mottagningstid och granskningsorsak innan du fortsätter.'}</dd></div><div><dt className="font-semibold">Tillgängligt nästa steg</dt><dd>{canTriage ? 'Granska ärendet och uppdatera ärendestatus.' : 'Läs ärendet. Statusändring kräver aktuell bolagsbehörighet.'}</dd></div></dl> : <p className="mt-2 text-slate-600">Processens tidsgrund kan inte verifieras mot källmeddelandet. Kontrollera källbeslutet innan fortsatt åtgärd.</p>}
          </section>
          <div className="space-y-2 text-sm"><h3 className="font-semibold">Referenser</h3>
            {sourceId && sourceValid ? scope.isPlatformAdmin ? <Link href={`/admin/ediel/messages/${sourceId}`} className="underline focus-visible:outline">Källmeddelande {sourceId}</Link> : <p>Ärendet är kopplat till ett inkommet besked.</p> : <p>Källmeddelande kan inte verifieras för detta bolag.</p>}
            {selectedCase.customer_id && customerValid ? <p><Link href={`/admin/customers/${selectedCase.customer_id}`} className="underline focus-visible:outline">Visa kund</Link></p> : <p>Kundlänk är inte tillgänglig för detta bolag eller denna behörighet.</p>}
          </div>
          {canTriage ? <form action={updateEdielOperationalCaseStatusAction} className="flex flex-wrap items-end gap-3 rounded-xl border border-slate-200 p-4"><input type="hidden" name="case_id" value={selectedCase.id} /><div><label htmlFor="ediel-case-status" className="block text-sm font-semibold">Ärendestatus</label><p className="text-sm text-slate-600">Aktuell status: {formatStatusLabel(selectedCase.status, 'Okänd status', 'Okänd status')}</p><select id="ediel-case-status" name="status" required defaultValue="" className="mt-1 rounded-lg border border-slate-300 px-3 py-2 text-sm"><option value="" disabled>Välj ny status</option><option value="open">Öppen</option><option value="action_required">Kräver åtgärd</option><option value="awaiting_external_response">Väntar externt svar</option><option value="manual_follow_up">Manuell uppföljning</option><option value="resolved">Löst</option><option value="closed">Stängd</option></select></div><button type="submit" className="rounded-lg bg-slate-950 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-950">Spara status</button></form> : null}
          <div><h3 className="font-semibold">Ärendehändelser</h3><ol className="mt-2 space-y-2">{events.map((event) => <li key={event.id} className="rounded-xl border border-slate-200 p-3 text-sm"><p>{scope.isPlatformAdmin ? event.message : tenantEventLabel(event)}</p><p className="text-xs text-slate-600">{formatAdminDateTime(event.created_at)}</p></li>)}</ol></div>
        </article>}
      </section>
    </main>
  </div>
}
