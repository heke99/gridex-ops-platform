import Link from 'next/link'
import AdminHeader from '@/components/admin/AdminHeader'
import { isPlatformAdminContext, requireAdminPageKeyAccess } from '@/lib/admin/guards'
import { getOperationalCompanyScope } from '@/lib/tenant/scope'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { completeFacilityLookupAction, markFacilityLookupSentManuallyAction } from '@/app/admin/facility-requests/actions'
import {
  facilityMissingFieldLabel,
  facilityStatusLabel,
  listFacilityWorkQueue,
  type FacilityWorkQueuePriority,
  type FacilityWorkQueueRow,
  type FacilityWorkQueueStatus,
} from '@/lib/facility/workQueue'

type FacilityLookupRequestRow = {
  id: string
  company_id: string
  customer_id: string | null
  customer_site_id: string | null
  grid_owner_id: string | null
  grid_area_code: string | null
  price_area: string | null
  status: string | null
  channel: string | null
  requires_poa: boolean | null
  facility_id: string | null
  metering_point_id: string | null
  requested_fields: string[] | null
  case_reference: string | null
  recipient_email: string | null
  poa_id: string | null
  sent_at: string | null
  created_at: string | null
  updated_at: string | null
  customer?: { customer_number?: string | null; full_name?: string | null; first_name?: string | null; last_name?: string | null; company_name?: string | null; email?: string | null } | null
  site?: { street?: string | null; postal_code?: string | null; city?: string | null; site_name?: string | null } | null
  grid_owner?: { name?: string | null; ediel_id?: string | null; owner_code?: string | null } | null
}

function customerName(row: FacilityLookupRequestRow): string {
  const customer = row.customer
  return customer?.company_name?.trim() || customer?.full_name?.trim() || [customer?.first_name, customer?.last_name].filter(Boolean).join(' ').trim() || customer?.email?.trim() || customer?.customer_number?.trim() || 'Kund'
}

function siteName(row: FacilityLookupRequestRow): string {
  return row.site?.site_name?.trim() || [row.site?.street, row.site?.postal_code, row.site?.city].filter(Boolean).join(', ') || 'Anläggning'
}

function normalizeRequestedFields(value: string[] | null | undefined): string[] {
  return Array.isArray(value) ? value : []
}

// Tenant-facing operational status (Swedish). No technical Ediel/EDIFACT details.
function operationalStatusLabel(status: string | null | undefined): string {
  switch (status) {
    case 'ready_to_send_manual_email': return 'Redo att skickas'
    case 'manual_email_queued': return 'E-post köad'
    case 'manual_email_sent': return 'E-post skickad'
    case 'waiting_manual_response': return 'Väntar på svar'
    case 'manual_response_received': return 'Svar mottaget'
    case 'manual_response_parsed': return 'Svar tolkat'
    case 'blocked_missing_poa': return 'Fullmakt saknas'
    case 'blocked_missing_grid_owner_contact': return 'Kontaktväg saknas'
    case 'completed': return 'Klar'
    case 'needs_review': return 'Behöver granskning'
    case 'waiting_response': return 'Väntar på svar'
    case 'sent': return 'Skickad'
    case 'ready_to_send': return 'Redo att skickas'
    case 'cancelled': return 'Avbruten'
    default: return 'Utkast'
  }
}

// Operational channel label (Swedish). Manual e-mail vs Ediel vs manual review.
function channelLabel(channel: string | null | undefined): string {
  switch (channel) {
    case 'manual_email':
    case 'email': return 'E-post'
    case 'ediel':
    case 'ediel_prodat': return 'Ediel'
    case 'manual_phone': return 'Telefon'
    case 'ai_list': return 'AI-lista'
    case 'manual_upload': return 'Manuell uppladdning'
    default: return 'Manuell granskning'
  }
}

export const dynamic = 'force-dynamic'

function formatDate(value: string | null | undefined) {
  if (!value) return '—'
  try {
    return new Intl.DateTimeFormat('sv-SE', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value))
  } catch {
    return '—'
  }
}

function priorityTone(priority: FacilityWorkQueuePriority): string {
  if (priority === 'critical') return 'border-red-200 bg-red-50 text-red-800'
  if (priority === 'high') return 'border-amber-200 bg-amber-50 text-amber-900'
  if (priority === 'low') return 'border-slate-200 bg-slate-50 text-slate-700'
  return 'border-emerald-200 bg-emerald-50 text-emerald-800'
}

function statusTone(status: FacilityWorkQueueStatus): string {
  if (status === 'ready_for_switch') return 'border-emerald-200 bg-emerald-50 text-emerald-800'
  if (status === 'awaiting_grid_owner') return 'border-sky-200 bg-sky-50 text-sky-800'
  if (status === 'needs_facility_data') return 'border-amber-200 bg-amber-50 text-amber-900'
  return 'border-red-200 bg-red-50 text-red-800'
}

function StatCard({ label, value, description }: { label: string; value: number; description: string }) {
  return (
    <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="text-sm font-bold text-slate-700">{label}</div>
      <div className="mt-2 text-3xl font-black tracking-tight text-slate-950">{value}</div>
      <p className="mt-2 text-xs leading-5 text-slate-600">{description}</p>
    </div>
  )
}

function EmptyState() {
  return (
    <div className="px-6 py-12 text-center">
      <h3 className="text-lg font-bold text-slate-950">Ingen anläggningskö hittades</h3>
      <p className="mx-auto mt-2 max-w-2xl text-sm leading-6 text-slate-600">
        Det betyder att synliga kunder antingen saknar anläggningar helt eller att anläggningsuppgifterna inte har några aktiva blockerare. Skapa kund/anläggning via kundintag eller öppna kundregistret för manuell kontroll.
      </p>
      <div className="mt-6 flex flex-wrap justify-center gap-3">
        <Link href="/admin/customers" className="rounded-2xl border border-slate-300 px-4 py-2 text-sm font-bold text-slate-800 hover:bg-slate-50">Öppna kundregister</Link>
        <Link href="/admin/customers/intake" className="rounded-2xl bg-emerald-700 px-4 py-2 text-sm font-bold text-white hover:bg-emerald-800">Skapa kund</Link>
      </div>
    </div>
  )
}


function FacilityLookupRequestCard({ request }: { request: FacilityLookupRequestRow }) {
  const missingFields = normalizeRequestedFields(request.requested_fields).filter((field) => {
    if (field === 'facility_id') return !request.facility_id
    if (field === 'metering_point_id') return !request.metering_point_id
    if (field === 'grid_area_code') return !request.grid_area_code
    if (field === 'price_area') return !request.price_area
    return true
  })

  return (
    <article className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-base font-black text-slate-950">{customerName(request)}</h3>
            <span className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs font-bold text-slate-700">{operationalStatusLabel(request.status)}</span>
            <span className="rounded-full border border-sky-200 bg-sky-50 px-3 py-1 text-xs font-bold text-sky-800">{channelLabel(request.channel)}</span>
            {request.poa_id
              ? <span className="rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-xs font-bold text-emerald-800">Fullmakt bifogas</span>
              : request.requires_poa
                ? <span className="rounded-full border border-amber-200 bg-amber-50 px-3 py-1 text-xs font-bold text-amber-900">Fullmakt saknas</span>
                : null}
          </div>
          <p className="mt-2 text-sm text-slate-700">{siteName(request)}</p>
          {request.case_reference ? (
            <p className="mt-1 text-xs font-semibold text-slate-600">Ärendenummer: {request.case_reference}{request.sent_at ? ` · Skickad ${formatDate(request.sent_at)}` : ''}</p>
          ) : null}
          <p className="mt-1 text-xs text-slate-500">
            Nätägare: {request.grid_owner?.name ?? request.grid_owner?.owner_code ?? 'saknas'} · Ediel ID: {request.grid_owner?.ediel_id ?? 'saknas'} · Nätområde: {request.grid_area_code ?? 'saknas'} · Elområde: {request.price_area ?? 'saknas'}
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            {missingFields.length > 0 ? missingFields.map((field) => (
              <span key={field} className="rounded-full bg-amber-50 px-3 py-1 text-xs font-bold text-amber-900">{facilityMissingFieldLabel(field)}</span>
            )) : <span className="rounded-full bg-emerald-50 px-3 py-1 text-xs font-bold text-emerald-800">Uppgifter mottagna</span>}
          </div>
          <p className="mt-3 text-xs text-slate-500">Uppdaterad {formatDate(request.updated_at ?? request.created_at)}</p>
        </div>

        <div className="grid w-full gap-3 xl:w-[520px]">
          <form action={markFacilityLookupSentManuallyAction} className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
            <input type="hidden" name="request_id" value={request.id} />
            <div className="text-sm font-bold text-slate-950">Markera skickad manuellt</div>
            <div className="mt-3 grid gap-2 sm:grid-cols-[140px_1fr]">
              <select name="manual_channel" defaultValue="portal" className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm">
                <option value="portal">Portal</option>
                <option value="email">E-post</option>
                <option value="phone">Telefon</option>
                <option value="other">Annat</option>
              </select>
              <input name="note" placeholder="Kort notering" className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm" />
            </div>
            <button className="mt-3 rounded-xl bg-slate-900 px-4 py-2 text-sm font-bold text-white hover:bg-slate-800">Markera skickad</button>
          </form>

          <form action={completeFacilityLookupAction} className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4">
            <input type="hidden" name="request_id" value={request.id} />
            <div className="text-sm font-bold text-emerald-950">Registrera svar från nätägare</div>
            <div className="mt-3 grid gap-2 sm:grid-cols-2">
              <input name="facility_id" defaultValue={request.facility_id ?? ''} placeholder="Anläggnings-ID" className="rounded-xl border border-emerald-200 bg-white px-3 py-2 text-sm" />
              <input name="metering_point_id" defaultValue={request.metering_point_id ?? ''} placeholder="Mätpunkts-ID" className="rounded-xl border border-emerald-200 bg-white px-3 py-2 text-sm" />
              <input name="grid_area_code" defaultValue={request.grid_area_code ?? ''} placeholder="Nätområde, t.ex. LKA" className="rounded-xl border border-emerald-200 bg-white px-3 py-2 text-sm" />
              <select name="price_area_code" defaultValue={request.price_area ?? ''} className="rounded-xl border border-emerald-200 bg-white px-3 py-2 text-sm">
                <option value="">Elområde</option>
                <option value="SE1">SE1</option>
                <option value="SE2">SE2</option>
                <option value="SE3">SE3</option>
                <option value="SE4">SE4</option>
              </select>
            </div>
            <input name="note" placeholder="Kommentar" className="mt-2 w-full rounded-xl border border-emerald-200 bg-white px-3 py-2 text-sm" />
            <div className="mt-3 flex flex-wrap gap-2">
              <button className="rounded-xl bg-emerald-700 px-4 py-2 text-sm font-bold text-white hover:bg-emerald-800">Spara uppgifter</button>
              {request.customer_id ? <Link href={`/admin/customers/${request.customer_id}?tab=data-requests`} className="rounded-xl border border-emerald-300 px-4 py-2 text-sm font-bold text-emerald-900 hover:bg-white">Öppna kund</Link> : null}
              <Link href="/admin/ediel/route-readiness" className="rounded-xl border border-emerald-300 px-4 py-2 text-sm font-bold text-emerald-900 hover:bg-white">Route readiness</Link>
            </div>
          </form>
        </div>
      </div>
    </article>
  )
}

function FacilityRow({ item }: { item: FacilityWorkQueueRow }) {
  return (
    <tr className="hover:bg-slate-50">
      <td className="px-6 py-4 align-top">
        <div className="font-bold text-slate-950">{item.customerLabel}</div>
        <div className="mt-1 text-xs text-slate-500">{item.customerNumber ?? 'Utan kundnummer'}</div>
      </td>
      <td className="px-6 py-4 align-top">
        <div className="font-semibold text-slate-950">{item.siteLabel}</div>
        <div className="mt-1 text-xs leading-5 text-slate-600">
          Anläggnings-ID: {item.facilityId ?? 'saknas'} · Mätpunkt: {item.meteringPointLabel ?? 'saknas'}
        </div>
        <div className="mt-1 text-xs leading-5 text-slate-600">
          Nätägare: {item.gridOwnerName ?? 'saknas'} · Elområde: {item.priceAreaCode ?? 'saknas'}
        </div>
      </td>
      <td className="px-6 py-4 align-top">
        <span className={`inline-flex rounded-full border px-3 py-1 text-xs font-bold ${statusTone(item.status)}`}>
          {facilityStatusLabel(item.status)}
        </span>
        <p className="mt-2 max-w-xl text-xs leading-5 text-slate-600">{item.description}</p>
      </td>
      <td className="px-6 py-4 align-top">
        {item.missingFields.length > 0 ? (
          <div className="flex max-w-sm flex-wrap gap-2">
            {item.missingFields.map((field) => (
              <span key={field} className="rounded-full bg-amber-50 px-3 py-1 text-xs font-bold text-amber-900">
                {facilityMissingFieldLabel(field)}
              </span>
            ))}
          </div>
        ) : (
          <span className="rounded-full bg-emerald-50 px-3 py-1 text-xs font-bold text-emerald-800">Komplett</span>
        )}
      </td>
      <td className="px-6 py-4 align-top">
        <span className={`rounded-full border px-3 py-1 text-xs font-bold ${priorityTone(item.priority)}`}>{item.priority}</span>
        <div className="mt-2 text-xs text-slate-500">Uppdaterad {formatDate(item.updatedAt ?? item.createdAt)}</div>
      </td>
      <td className="px-6 py-4 align-top">
        <Link href={item.href} className="inline-flex rounded-2xl border border-slate-300 px-4 py-2 text-sm font-bold text-slate-800 hover:bg-slate-50">
          {item.nextAction}
        </Link>
      </td>
    </tr>
  )
}

export default async function FacilityRequestsPage() {
  const context = await requireAdminPageKeyAccess('operations.tasks')
  const companyScope = await getOperationalCompanyScope(context.userId)
  const isPlatformAdmin = isPlatformAdminContext(context)
  const companyId = isPlatformAdmin ? null : companyScope.companyId
  const supabase = await createSupabaseServerClient()
  const queue = await listFacilityWorkQueue(supabase, companyId, { limit: 250 })

  const ACTIVE_FACILITY_STATUSES = [
    'draft', 'ready_to_send', 'sent', 'waiting_response', 'needs_review',
    'ready_to_send_manual_email', 'manual_email_queued', 'manual_email_sent',
    'waiting_manual_response', 'manual_response_received', 'manual_response_parsed',
    'blocked_missing_poa', 'blocked_missing_grid_owner_contact',
  ]
  const ACTIVE_FACILITY_REQUEST_TYPES = ['facility_lookup', 'facility_identifier_lookup']

  let facilityRequestsQuery = supabase
    .from('grid_owner_information_requests')
    .select('id,company_id,customer_id,customer_site_id,grid_owner_id,grid_area_code,price_area,status,channel,requires_poa,facility_id,metering_point_id,requested_fields,case_reference,recipient_email,poa_id,sent_at,created_at,updated_at, customer:customers(customer_number,full_name,first_name,last_name,company_name,email), site:customer_sites(street,postal_code,city,site_name), grid_owner:grid_owners(name,ediel_id,owner_code)')
    .in('request_type', ACTIVE_FACILITY_REQUEST_TYPES)
    .in('status', ACTIVE_FACILITY_STATUSES)
    .order('updated_at', { ascending: false })
    .limit(100)

  if (companyId) facilityRequestsQuery = facilityRequestsQuery.eq('company_id', companyId)

  const { data: joinedFacilityRequestsData, error: joinedFacilityRequestsError } = await facilityRequestsQuery

  let facilityRequestsData: unknown[] = (joinedFacilityRequestsData ?? []) as unknown[]
  if (joinedFacilityRequestsError) {
    let fallbackQuery = supabase
      .from('grid_owner_information_requests')
      .select('id,company_id,customer_id,customer_site_id,grid_owner_id,grid_area_code,price_area,status,channel,requires_poa,facility_id,metering_point_id,requested_fields,case_reference,recipient_email,poa_id,sent_at,created_at,updated_at')
      .in('request_type', ACTIVE_FACILITY_REQUEST_TYPES)
      .in('status', ACTIVE_FACILITY_STATUSES)
      .order('updated_at', { ascending: false })
      .limit(100)
    if (companyId) fallbackQuery = fallbackQuery.eq('company_id', companyId)
    const fallback = await fallbackQuery
    facilityRequestsData = fallback.error ? [] : ((fallback.data ?? []) as unknown[])
  }

  const facilityRequests = (facilityRequestsData ?? []) as unknown as FacilityLookupRequestRow[]

  const missingAuthorization = queue.filter((item) => item.status === 'missing_authorization').length
  const needsFacilityData = queue.filter((item) => item.status === 'needs_facility_data').length
  const needsGridOwnerReview = queue.filter((item) => item.status === 'needs_grid_owner_review').length
  const awaitingGridOwner = queue.filter((item) => item.status === 'awaiting_grid_owner').length
  const readyForSwitch = queue.filter((item) => item.status === 'ready_for_switch').length

  return (
    <div className="min-h-screen bg-slate-50">
      <AdminHeader
        title="Anläggningsuppgifter"
        subtitle="Kö för kunder där anläggnings-ID, mätpunkt, nätägare, elområde eller fullmakt behöver kompletteras innan leverantörsbyte."
        userEmail={context.email}
        workspaceName={isPlatformAdmin ? 'Gridex Platform' : companyScope.companyName}
        workspaceMode={isPlatformAdmin ? 'platform' : 'tenant'}
      />

      <main className="space-y-6 p-6 lg:p-8">
        <section className="rounded-3xl border border-emerald-200 bg-emerald-50 p-5 text-sm text-emerald-950 shadow-sm">
          <div className="font-bold">Affärsregel</div>
          <p className="mt-1 leading-6">
            Adress och postnummer får användas som förslag. Verifierad sanning är nätområdeskod, anläggnings-ID, mätpunkt eller bekräftelse från nätägare. Systemet får inte starta leverantörsbyte när kritiska anläggningsuppgifter saknas.
          </p>
        </section>

        <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
          <StatCard label="Saknar fullmakt" value={missingAuthorization} description="Utskick stoppas tills signerad fullmakt finns." />
          <StatCard label="Saknar uppgifter" value={needsFacilityData} description="Anläggnings-ID, mätpunkt eller elområde saknas." />
          <StatCard label="Nätägare behöver verifieras" value={needsGridOwnerReview} description="Resolver-förslag räcker inte för switch." />
          <StatCard label="Väntar nätägare" value={awaitingGridOwner} description="Begäran är skickad eller köad." />
          <StatCard label="Redo" value={readyForSwitch} description="Kan fortsätta mot leverantörsbyte." />
        </section>

        {facilityRequests.length > 0 ? (
          <section className="space-y-4">
            <div>
              <h2 className="text-lg font-bold text-slate-950">Aktiva nätägarbegäranden</h2>
              <p className="mt-1 text-sm text-slate-600">Hantera manuell skickning och registrera svar från nätägaren. Inga Ediel- eller SMTP-utskick sker från dessa knappar.</p>
            </div>
            <div className="grid gap-4">
              {facilityRequests.map((request) => <FacilityLookupRequestCard key={request.id} request={request} />)}
            </div>
          </section>
        ) : null}

        <section className="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm">
          <div className="border-b border-slate-200 px-6 py-5">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
              <div>
                <h2 className="text-lg font-bold text-slate-950">Facility-arbetskö</h2>
                <p className="mt-1 text-sm text-slate-600">Visar bara kundkopplade anläggningar med aktiv brist, väntande nätägarsvar eller nästa åtgärd.</p>
              </div>
              <Link href="/admin/work-queue" className="rounded-2xl border border-slate-300 px-4 py-2 text-sm font-bold text-slate-800 hover:bg-slate-50">
                Öppna hela arbetskön
              </Link>
            </div>
          </div>

          {queue.length === 0 ? (
            <EmptyState />
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-slate-200 text-sm">
                <thead className="bg-slate-50 text-left text-xs font-bold uppercase tracking-[0.14em] text-slate-500">
                  <tr>
                    <th className="px-6 py-4">Kund</th>
                    <th className="px-6 py-4">Anläggning</th>
                    <th className="px-6 py-4">Status</th>
                    <th className="px-6 py-4">Saknas</th>
                    <th className="px-6 py-4">Prioritet</th>
                    <th className="px-6 py-4">Åtgärd</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 bg-white">
                  {queue.map((item) => (
                    <FacilityRow key={`${item.id}-${item.status}`} item={item} />
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </main>
    </div>
  )
}
