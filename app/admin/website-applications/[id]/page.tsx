import Link from 'next/link'
import { notFound } from 'next/navigation'
import {
  isPlatformAdminContext,
  requireAdminPageAccess,
} from '@/lib/admin/guards'
import { resolveAdminTenantReadScope } from '@/lib/tenant/adminScope'
import { supabaseService } from '@/lib/supabase/service'
import {
  getWebsiteApplicationAdminRow,
  type WebsiteApplicationAdminRow,
} from '@/lib/admin/websiteIntegrationOps'
import {
  checkWebsiteApplicationReadinessAction,
  markWebsiteApplicationFacilityDataReceivedAction,
  requestWebsiteApplicationGridOwnerInfoAction,
  resolveWebsiteApplicationEnergyAction,
  updateWebsiteApplicationReviewAction,
} from '../actions'
import {
  intakeStatusLabel,
  sourceLabel,
  gridOwnerVerificationLabel,
} from '@/lib/customers/statusLabels'

export const dynamic = 'force-dynamic'

type PageProps = {
  params: Promise<{ id: string }>
  searchParams?: Promise<Record<string, string | string[] | undefined>>
}

type JsonRecord = Record<string, unknown>

function missingSchema(error: unknown): boolean {
  const code = (error as { code?: string } | null)?.code ?? ''
  const message = (error as { message?: string } | null)?.message ?? ''
  return ['42P01', '42703', 'PGRST205'].includes(code) || /schema cache|does not exist|column .* does not exist/i.test(message)
}

function isRecord(value: unknown): value is JsonRecord {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}

function nestedValue(payload: JsonRecord | null | undefined, path: string): string | null {
  let current: unknown = payload
  for (const part of path.split('.')) {
    if (!isRecord(current)) return null
    current = current[part]
  }
  return typeof current === 'string' && current.trim() ? current : null
}

function firstPayloadValue(payload: JsonRecord | null | undefined, paths: string[]) {
  for (const path of paths) {
    const value = nestedValue(payload, path)
    if (value) return value
  }
  return null
}

function formatDate(value: string | null | undefined) {
  if (!value) return '—'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return new Intl.DateTimeFormat('sv-SE', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(date)
}

function statusTone(status: string | null | undefined) {
  const value = status ?? ''
  if (['active', 'completed', 'customer_created', 'linked_existing_customer', 'ready_for_switch', 'facility_data_received'].includes(value)) {
    return 'border-emerald-200 bg-emerald-50 text-emerald-800'
  }
  if (['failed', 'rejected', 'cancelled', 'switch_rejected', 'negative_aperak_received', 'z02_rejected'].includes(value)) {
    return 'border-red-200 bg-red-50 text-red-800'
  }
  if (['needs_information', 'needs_facility_data', 'information_request_ready', 'information_request_sent', 'waiting_grid_owner_response', 'manual_review', 'pending_review'].includes(value)) {
    return 'border-amber-200 bg-amber-50 text-amber-900'
  }
  return 'border-slate-200 bg-slate-50 text-slate-700'
}

function sourceBadgeLabel(item: WebsiteApplicationAdminRow) {
  if (item.source_table === 'website_customer_applications') return 'Webbansökan'
  if (item.source_table === 'external_contract_intakes') return 'Extern intake'
  return sourceLabel(item.source ?? 'external_contract_intake')
}

function customerName(item: WebsiteApplicationAdminRow) {
  return (
    item.customers?.company_name ??
    item.customers?.full_name ??
    firstPayloadValue(item.payload, ['customer.company_name', 'customer.full_name', 'company_name', 'name']) ??
    item.external_customer_id ??
    'Okänd kund'
  )
}

function customerEmail(item: WebsiteApplicationAdminRow) {
  return item.customers?.email ?? firstPayloadValue(item.payload, ['customer.email', 'email']) ?? '—'
}

function customerPhone(item: WebsiteApplicationAdminRow) {
  return item.customers?.phone ?? firstPayloadValue(item.payload, ['customer.phone', 'phone']) ?? '—'
}

function defaultChecked(payload: JsonRecord | null | undefined, paths: string[]) {
  return paths.some((path) => {
    let current: unknown = payload
    for (const part of path.split('.')) {
      if (!isRecord(current)) return false
      current = current[part]
    }
    return current === true || current === 'true' || current === 'accepted' || current === 'ja'
  })
}

function compactObject(input: Record<string, unknown>) {
  return Object.fromEntries(Object.entries(input).filter(([, value]) => value !== null && value !== undefined && value !== ''))
}

async function maybeById(table: string, id: string | null | undefined, select = '*') {
  if (!id) return null
  const { data, error } = await supabaseService
    .from(table)
    .select(select)
    .eq('id', id)
    .maybeSingle()
  if (error) {
    if (missingSchema(error)) return null
    throw error
  }
  return (data as unknown as JsonRecord | null) ?? null
}

async function listByCustomer(table: string, companyId: string, customerId: string | null | undefined, select = '*', limit = 10) {
  if (!customerId) return []
  const { data, error } = await supabaseService
    .from(table)
    .select(select)
    .eq('company_id', companyId)
    .eq('customer_id', customerId)
    .order('created_at', { ascending: false })
    .limit(limit)
  if (error) {
    if (missingSchema(error)) return []
    throw error
  }
  return ((data ?? []) as unknown) as JsonRecord[]
}

async function loadOperationalChain(item: WebsiteApplicationAdminRow) {
  const [customer, site, meter, contract, gridOwnerRequest, customerInfoRequests, powerOfAttorneys, operationTasks] = await Promise.all([
    maybeById('customers', item.customer_id, 'id,customer_number,status,full_name,company_name,email,phone,customer_type,source,intake_status,intake_missing_fields,intake_warnings,created_at,updated_at'),
    maybeById('customer_sites', item.customer_site_id, 'id,status,site_name,facility_id,street,postal_code,city,grid_owner_id,grid_area_code,price_area_code,move_in_date,created_at,updated_at'),
    maybeById('metering_points', item.metering_point_id, 'id,status,metering_point_id,meter_point_id,site_id,customer_site_id,site_facility_id,grid_area_code,price_area_code,verification_status,onboarding_status,created_at,updated_at'),
    maybeById('customer_contracts', item.contract_id, 'id,status,contract_name,contract_type,source_type,agreement_channel,starts_at,requested_start_date,confirmed_start_date,actual_start_date,created_at,updated_at'),
    maybeById('grid_owner_information_requests', item.grid_owner_information_request_id, 'id,status,dispatch_status,request_type,channel,grid_owner_id,grid_area_code,price_area,facility_id,metering_point_id,blocking_reasons,warnings,next_step,created_at,updated_at'),
    listByCustomer('customer_info_requests', item.company_id, item.customer_id, 'id,status,request_type,target_party_type,automation_origin,automation_key,created_at,updated_at', 8),
    listByCustomer('powers_of_attorney', item.company_id, item.customer_id, 'id,status,scope,source,created_at,signed_at,expires_at', 8),
    listByCustomer('customer_operation_tasks', item.company_id, item.customer_id, 'id,status,priority,task_type,title,description,created_at,updated_at', 8),
  ])

  return { customer, site, meter, contract, gridOwnerRequest, customerInfoRequests, powerOfAttorneys, operationTasks }
}

function ChainCard({ title, row, fields, href }: { title: string; row: JsonRecord | null; fields: Array<[string, string]>; href?: string }) {
  return (
    <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <h2 className="text-base font-semibold text-slate-950">{title}</h2>
        {href ? (
          <Link href={href} className="rounded-xl border border-slate-200 px-3 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-50">
            Öppna
          </Link>
        ) : null}
      </div>
      {!row ? (
        <p className="mt-4 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-950">Saknas eller ej skapad ännu.</p>
      ) : (
        <dl className="mt-4 grid gap-3 text-sm">
          {fields.map(([label, key]) => (
            <div key={key} className="rounded-2xl bg-slate-50 px-4 py-3">
              <dt className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">{label}</dt>
              <dd className="mt-1 break-words font-semibold text-slate-900">{String(row[key] ?? '—')}</dd>
            </div>
          ))}
        </dl>
      )}
    </div>
  )
}

function JsonPanel({ title, value }: { title: string; value: unknown }) {
  return (
    <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
      <h2 className="text-base font-semibold text-slate-950">{title}</h2>
      <pre className="mt-4 max-h-96 overflow-auto whitespace-pre-wrap rounded-2xl bg-slate-950 p-4 text-xs text-slate-100">
        {JSON.stringify(value ?? {}, null, 2)}
      </pre>
    </div>
  )
}

function Timeline({ item, chain }: { item: WebsiteApplicationAdminRow; chain: Awaited<ReturnType<typeof loadOperationalChain>> }) {
  const events = [
    { title: 'Ansökan mottagen', status: item.status, date: item.created_at, detail: item.next_step ?? 'Kontrollera ansökan.' },
    item.customer_id ? { title: 'Kund kopplad', status: String(chain.customer?.status ?? 'created'), date: String(chain.customer?.created_at ?? item.updated_at ?? item.created_at), detail: item.customer_id } : null,
    item.customer_site_id ? { title: 'Anläggning kopplad', status: String(chain.site?.status ?? 'created'), date: String(chain.site?.created_at ?? item.updated_at ?? item.created_at), detail: item.customer_site_id } : null,
    item.metering_point_id ? { title: 'Mätpunkt kopplad', status: String(chain.meter?.status ?? 'created'), date: String(chain.meter?.created_at ?? item.updated_at ?? item.created_at), detail: item.metering_point_id } : null,
    item.contract_id ? { title: 'Avtal kopplat', status: String(chain.contract?.status ?? 'created'), date: String(chain.contract?.created_at ?? item.updated_at ?? item.created_at), detail: item.contract_id } : null,
    item.grid_owner_information_request_id ? { title: 'Uppgiftsbegäran/nätägare', status: String(chain.gridOwnerRequest?.status ?? 'created'), date: String(chain.gridOwnerRequest?.created_at ?? item.updated_at ?? item.created_at), detail: item.grid_owner_information_request_id } : null,
    ...(Array.isArray(item.timeline) ? item.timeline.map((entry) => isRecord(entry) ? {
      title: String(entry.label ?? entry.type ?? 'Händelse'),
      status: String(entry.type ?? item.status),
      date: String(entry.occurred_at ?? item.updated_at ?? item.created_at),
      detail: isRecord(entry.metadata) ? JSON.stringify(entry.metadata) : '',
    } : null) : []),
  ].filter(Boolean) as Array<{ title: string; status: string; date: string; detail: string }>

  return (
    <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
      <h2 className="text-base font-semibold text-slate-950">Tidslinje</h2>
      <div className="mt-4 space-y-3">
        {events.map((event, index) => (
          <div key={`${event.title}-${index}`} className="rounded-2xl border border-slate-100 bg-slate-50 px-4 py-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="font-semibold text-slate-950">{event.title}</p>
              <span className={`rounded-full border px-3 py-1 text-xs font-semibold ${statusTone(event.status)}`}>{intakeStatusLabel(event.status)}</span>
            </div>
            <p className="mt-1 text-xs text-slate-500">{formatDate(event.date)}</p>
            <p className="mt-1 break-words text-sm text-slate-700">{event.detail}</p>
          </div>
        ))}
      </div>
    </div>
  )
}

function ReviewForm({ item }: { item: WebsiteApplicationAdminRow }) {
  const payload = item.payload ?? {}
  const returnTo = `/admin/website-applications/${item.id}?source=${item.source_table ?? 'website_customer_applications'}`
  if (item.source_table === 'external_contract_intakes') {
    return (
      <div className="rounded-3xl border border-amber-200 bg-amber-50 p-5 text-sm text-amber-950">
        Den här posten kommer direkt från <code>external_contract_intakes</code>. Actions är låsta här för att undvika att ett external-ID skickas till actions som kräver <code>website_customer_applications.id</code>.
      </div>
    )
  }

  return (
    <form action={updateWebsiteApplicationReviewAction} className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
      <input type="hidden" name="application_id" value={item.id} />
      <input type="hidden" name="return_to" value={returnTo} />
      <div className="grid gap-4 md:grid-cols-3">
        <label className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-600">
          Kundnamn
          <input name="customer_full_name" defaultValue={firstPayloadValue(payload, ['customer.full_name', 'customer.company_name', 'name']) ?? ''} className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm font-normal normal-case tracking-normal text-slate-900" />
        </label>
        <label className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-600">
          E-post
          <input name="customer_email" defaultValue={firstPayloadValue(payload, ['customer.email', 'email']) ?? ''} className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm font-normal normal-case tracking-normal text-slate-900" />
        </label>
        <label className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-600">
          Telefon
          <input name="customer_phone" defaultValue={firstPayloadValue(payload, ['customer.phone', 'phone']) ?? ''} className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm font-normal normal-case tracking-normal text-slate-900" />
        </label>
        <label className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-600">
          Anläggnings-ID
          <input name="facility_id" defaultValue={firstPayloadValue(payload, ['site.facility_id', 'facility_id']) ?? ''} className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm font-normal normal-case tracking-normal text-slate-900" />
        </label>
        <label className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-600">
          Mätpunkt
          <input name="metering_point_id" defaultValue={firstPayloadValue(payload, ['metering_point.metering_point_id', 'metering_point.meter_point_id', 'metering_point_id']) ?? ''} className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm font-normal normal-case tracking-normal text-slate-900" />
        </label>
        <label className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-600">
          Nätägare
          <input name="grid_owner_id" defaultValue={item.grid_owner_id ?? firstPayloadValue(payload, ['grid_owner_id', 'site.grid_owner_id']) ?? ''} className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm font-normal normal-case tracking-normal text-slate-900" />
        </label>
        <label className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-600">
          Nätområdeskod
          <input name="grid_area_code" defaultValue={item.grid_area_code ?? firstPayloadValue(payload, ['grid_area_code', 'site.grid_area_code']) ?? ''} className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm font-normal normal-case tracking-normal text-slate-900" />
        </label>
        <label className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-600">
          Elområde
          <input name="price_area_code" defaultValue={item.price_area_code ?? firstPayloadValue(payload, ['price_area_code', 'price_area', 'site.price_area_code']) ?? ''} className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm font-normal normal-case tracking-normal text-slate-900" />
        </label>
        <label className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-600">
          Önskat startdatum
          <input type="date" name="requested_start_date" defaultValue={item.requested_start_date ?? firstPayloadValue(payload, ['requested_start_date', 'contract.requested_start_date', 'contract.starts_at']) ?? ''} className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm font-normal normal-case tracking-normal text-slate-900" />
        </label>
      </div>
      <div className="mt-4 grid gap-3 md:grid-cols-3">
        <label className="flex items-center gap-2 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-semibold text-slate-700">
          <input type="checkbox" name="power_of_attorney_accepted" defaultChecked={defaultChecked(payload, ['consents.power_of_attorney', 'consents.fullmakt_accepted', 'power_of_attorney_accepted'])} />
          Fullmakt finns
        </label>
        <label className="flex items-center gap-2 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-semibold text-slate-700">
          <input type="checkbox" name="terms_accepted" defaultChecked={defaultChecked(payload, ['consents.terms_accepted', 'consents.terms', 'terms_accepted'])} />
          Villkor accepterade
        </label>
        <label className="flex items-center gap-2 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-semibold text-slate-700">
          <input type="checkbox" name="facility_data_verified" defaultChecked={Boolean(item.facility_data_verified_at) || defaultChecked(payload, ['facility_data_verified'])} />
          Anläggningsuppgifter verifierade
        </label>
      </div>
      <div className="mt-4 flex flex-wrap gap-3">
        <button className="rounded-2xl bg-emerald-700 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-800">Spara komplettering</button>
        <button formAction={resolveWebsiteApplicationEnergyAction} className="rounded-2xl border border-sky-200 bg-white px-4 py-2 text-sm font-semibold text-sky-800 hover:bg-sky-50">Kör adressmatchning</button>
        <button formAction={requestWebsiteApplicationGridOwnerInfoAction} className="rounded-2xl border border-amber-200 bg-white px-4 py-2 text-sm font-semibold text-amber-900 hover:bg-amber-50">Begär uppgifter från nätägare</button>
        <button formAction={markWebsiteApplicationFacilityDataReceivedAction} className="rounded-2xl border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-800 hover:bg-slate-50">Markera mottaget</button>
        <button formAction={checkWebsiteApplicationReadinessAction} className="rounded-2xl border border-emerald-200 bg-white px-4 py-2 text-sm font-semibold text-emerald-800 hover:bg-emerald-50">Kontrollera om redo</button>
      </div>
    </form>
  )
}

function RelatedRows({ title, rows }: { title: string; rows: JsonRecord[] }) {
  return (
    <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
      <h2 className="text-base font-semibold text-slate-950">{title}</h2>
      {rows.length === 0 ? <p className="mt-4 text-sm text-slate-600">Inga rader hittades.</p> : null}
      <div className="mt-4 space-y-3">
        {rows.map((row) => (
          <div key={String(row.id)} className="rounded-2xl bg-slate-50 px-4 py-3 text-sm">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="font-mono text-xs text-slate-500">{String(row.id)}</p>
              <span className={`rounded-full border px-3 py-1 text-xs font-semibold ${statusTone(String(row.status ?? ''))}`}>{intakeStatusLabel(String(row.status ?? ''))}</span>
            </div>
            <p className="mt-2 font-semibold text-slate-950">{String(row.title ?? row.request_type ?? row.task_type ?? row.source ?? 'Rad')}</p>
            <p className="mt-1 text-xs text-slate-500">{formatDate(String(row.created_at ?? ''))}</p>
          </div>
        ))}
      </div>
    </div>
  )
}

export default async function WebsiteApplicationDetailPage({ params, searchParams }: PageProps) {
  const { id } = await params
  const resolvedSearch = searchParams ? await searchParams : {}
  const source = typeof resolvedSearch.source === 'string' ? resolvedSearch.source : null
  const access = await requireAdminPageAccess({
    anyOf: ['customers.read', 'customers.write', 'billing_underlay.read'],
  })
  const tenantScope = await resolveAdminTenantReadScope(access)
  const maybeItem = await getWebsiteApplicationAdminRow(id, {
    companyId: tenantScope.isPlatformAdmin ? null : tenantScope.companyId,
    sourceTable: source,
  })

  if (!maybeItem) {
    notFound()
    return null
  }

  const item: WebsiteApplicationAdminRow = maybeItem
  const chain = await loadOperationalChain(item)
  const isPlatformAdmin = isPlatformAdminContext(access)
  const mirror = isRecord(item.response_payload?.external_contract_intake) ? item.response_payload.external_contract_intake : null
  const sourceFacts = compactObject({
    source_table: item.source_table,
    source: item.source,
    idempotency_key: item.idempotency_key,
    linked_external_intake_id: item.linked_external_intake_id,
    external_intake_status: item.external_intake_status,
    linked_website_application_id: item.linked_website_application_id,
  })

  return (
    <main className="mx-auto max-w-7xl space-y-8 px-6 py-8">
      <div className="flex flex-wrap items-center gap-3 text-sm font-semibold">
        <Link href="/admin/website-applications" className="rounded-2xl border border-slate-200 bg-white px-4 py-2 text-slate-700 hover:bg-slate-50">← Till webbansökningar</Link>
        {item.customer_id ? <Link href={`/admin/customers/${item.customer_id}`} className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-2 text-emerald-800 hover:bg-emerald-100">Öppna kundkort</Link> : null}
      </div>

      <section className="rounded-[36px] border border-emerald-100 bg-white p-8 shadow-sm shadow-emerald-950/5">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-emerald-700">Webbansökan / intagskedja</p>
            <h1 className="mt-3 text-3xl font-bold tracking-tight text-slate-950">{customerName(item)}</h1>
            <p className="mt-3 max-w-3xl text-sm leading-6 text-slate-600">
              Den här sidan visar hela kedjan från ansökan till kund, anläggning, avtal, fullmakt och uppgiftsbegäran. Den gör också tydlig skillnad mellan kanonisk webbansökan och teknisk external-intake-rad.
            </p>
          </div>
          <div className="space-y-2 text-right">
            <span className={`inline-flex rounded-full border px-4 py-2 text-sm font-semibold ${statusTone(item.status)}`}>{intakeStatusLabel(item.status)}</span>
            <p className="text-xs text-slate-500">{sourceBadgeLabel(item)} · {formatDate(item.created_at)}</p>
            {isPlatformAdmin ? <p className="text-xs text-slate-500">Tenant: {item.companies?.name ?? item.company_id}</p> : null}
          </div>
        </div>

        <div className="mt-8 grid gap-4 md:grid-cols-4">
          <div className="rounded-3xl border border-slate-200 bg-slate-50 p-5">
            <p className="text-sm text-slate-600">Kund</p>
            <p className="mt-2 font-semibold text-slate-950">{item.customer_id ?? 'Ej skapad/kopplad'}</p>
            <p className="mt-1 text-xs text-slate-500">{customerEmail(item)} · {customerPhone(item)}</p>
          </div>
          <div className="rounded-3xl border border-slate-200 bg-slate-50 p-5">
            <p className="text-sm text-slate-600">Anläggning/mätpunkt</p>
            <p className="mt-2 font-semibold text-slate-950">{item.customer_site_id ?? '—'}</p>
            <p className="mt-1 text-xs text-slate-500">{item.metering_point_id ?? 'Mätpunkt saknas'}</p>
          </div>
          <div className="rounded-3xl border border-slate-200 bg-slate-50 p-5">
            <p className="text-sm text-slate-600">Avtal</p>
            <p className="mt-2 font-semibold text-slate-950">{item.contract_id ?? 'Ej skapat'}</p>
            <p className="mt-1 text-xs text-slate-500">Start: {item.requested_start_date ?? item.confirmed_start_date ?? '—'}</p>
          </div>
          <div className="rounded-3xl border border-slate-200 bg-slate-50 p-5">
            <p className="text-sm text-slate-600">Uppgiftsbegäran</p>
            <p className="mt-2 font-semibold text-slate-950">{item.grid_owner_information_request_id ?? 'Ej skapad'}</p>
            <p className="mt-1 text-xs text-slate-500">{gridOwnerVerificationLabel(item.resolution_status ?? null)}</p>
          </div>
        </div>
      </section>

      <ReviewForm item={item} />

      <section className="grid gap-5 lg:grid-cols-2">
        <Timeline item={item} chain={chain} />
        <JsonPanel title="Källstatus och idempotency" value={sourceFacts} />
      </section>

      <section className="grid gap-5 lg:grid-cols-2">
        <ChainCard title="Kund" row={chain.customer} href={item.customer_id ? `/admin/customers/${item.customer_id}` : undefined} fields={[
          ['Status', 'status'], ['Kundnummer', 'customer_number'], ['Källa', 'source'], ['Intake-status', 'intake_status'], ['Skapad', 'created_at'], ['Uppdaterad', 'updated_at'],
        ]} />
        <ChainCard title="Anläggning" row={chain.site} fields={[
          ['Status', 'status'], ['Anläggnings-ID', 'facility_id'], ['Adress', 'street'], ['Nätområde', 'grid_area_code'], ['Elområde', 'price_area_code'], ['Nätägare', 'grid_owner_id'],
        ]} />
        <ChainCard title="Mätpunkt" row={chain.meter} fields={[
          ['Status', 'status'], ['Mätpunkt', 'metering_point_id'], ['Meter point', 'meter_point_id'], ['Anläggnings-ID', 'site_facility_id'], ['Verifiering', 'verification_status'], ['Onboarding', 'onboarding_status'],
        ]} />
        <ChainCard title="Avtal" row={chain.contract} href={item.customer_id && item.contract_id ? `/admin/customers/${item.customer_id}?tab=contracts` : undefined} fields={[
          ['Status', 'status'], ['Avtalsnamn', 'contract_name'], ['Typ', 'contract_type'], ['Källa', 'source_type'], ['Start', 'starts_at'], ['Önskad start', 'requested_start_date'],
        ]} />
        <ChainCard title="Nätägarbegäran" row={chain.gridOwnerRequest} fields={[
          ['Status', 'status'], ['Dispatch', 'dispatch_status'], ['Typ', 'request_type'], ['Kanal', 'channel'], ['Nätområde', 'grid_area_code'], ['Elområde', 'price_area'],
        ]} />
        <RelatedRows title="Customer info requests" rows={chain.customerInfoRequests} />
        <RelatedRows title="Fullmakter" rows={chain.powerOfAttorneys} />
        <RelatedRows title="Operationsuppgifter" rows={chain.operationTasks} />
      </section>

      <section className="grid gap-5 lg:grid-cols-2">
        <JsonPanel title="Payload" value={item.raw_payload ?? item.payload} />
        <JsonPanel title="Response payload" value={item.response_payload} />
        {mirror ? <JsonPanel title="External intake-spegel" value={mirror} /> : null}
      </section>
    </main>
  )
}
