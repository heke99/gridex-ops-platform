import Link from 'next/link'
import { requireAdminPageAccess, isPlatformAdminContext } from '@/lib/admin/guards'
import { resolveAdminTenantReadScope } from '@/lib/tenant/adminScope'
import { listWebsiteApplications, type WebsiteApplicationAdminRow } from '@/lib/admin/websiteIntegrationOps'
import {
  checkWebsiteApplicationReadinessAction,
  markWebsiteApplicationFacilityDataReceivedAction,
  requestWebsiteApplicationGridOwnerInfoAction,
  resolveWebsiteApplicationEnergyAction,
  updateWebsiteApplicationReviewAction,
} from './actions'

export const dynamic = 'force-dynamic'

type JsonRecord = Record<string, unknown>

function formatDate(value: string | null | undefined) {
  if (!value) return '—'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return new Intl.DateTimeFormat('sv-SE', { dateStyle: 'short', timeStyle: 'short' }).format(date)
}

const CONTROLLED_FACILITY_STATUSES = new Set([
  'facility_data_invalid',
  'customer_information_mismatch',
  'grid_owner_rejected_request',
  'negative_aperak_received',
  'z02_rejected',
  'needs_customer_correction',
  'needs_grid_owner_followup',
  'duplicate_facility_id',
  'cross_tenant_facility_conflict',
  'protected_identity',
])

const HARD_BLOCK_STATUSES = new Set([
  'negative_aperak_received',
  'z02_rejected',
  'grid_owner_rejected_request',
  'cross_tenant_facility_conflict',
  'protected_identity',
])

function isControlledFacilityStatus(status: string | null | undefined) {
  return Boolean(status && CONTROLLED_FACILITY_STATUSES.has(status))
}

function facilityCorrectionCopy(status: string | null | undefined) {
  if (status === 'cross_tenant_facility_conflict') {
    return {
      title: 'Anläggnings-ID finns i annan tenant',
      message: 'Leverantörsbyte är stoppat. Systemet visar inte kunddata från annan tenant och skapar säker manuell granskning.',
      steps: ['Verifiera uppgiften med kunden.', 'Kontakta nätägaren om uppgiften fortfarande verkar rätt.', 'Kör ny readiness-check efter manuell granskning.'],
    }
  }
  if (status === 'protected_identity') {
    return {
      title: 'Skyddad identitet kräver manuell process',
      message: 'Automatiska utskick och känslig datadelning är stoppade.',
      steps: ['Flytta ärendet till behörig handläggare.', 'Skicka inte känsliga uppgifter via vanlig e-post.', 'Kör ny kontroll först när processen är säkert hanterad.'],
    }
  }
  if (status === 'duplicate_facility_id') {
    return {
      title: 'Anläggnings-ID finns redan',
      message: 'Systemet skapar inte en dubblett för samma bolag.',
      steps: ['Öppna befintlig kund/anläggning.', 'Länka eller rätta uppgiften.', 'Kör ny readiness-check innan switch.'],
    }
  }
  return {
    title: 'Anläggningsuppgifter behöver rättas',
    message: 'Leverantörsbyte är stoppat tills anläggnings-ID, mätpunkt, kundidentitet och nätägare är verifierade.',
    steps: ['Kontrollera anläggnings-ID och mätpunkt med kunden.', 'Begär rätt uppgifter från nätägaren eller ladda upp elnätsfaktura.', 'Kör ny readiness-check innan någon switch skickas.'],
  }
}

function statusTone(status: string) {
  if (['ready_for_switch', 'switch_confirmed', 'active', 'completed', 'linked_existing_customer', 'customer_created', 'customer_matched', 'facility_data_received'].includes(status)) return 'border-emerald-200 bg-emerald-50 text-emerald-800'
  if (['application_received', 'received', 'pending_validation', 'switch_requested', 'address_resolved', 'grid_area_resolved'].includes(status)) return 'border-sky-200 bg-sky-50 text-sky-800'
  if (HARD_BLOCK_STATUSES.has(status)) return 'border-red-200 bg-red-50 text-red-800'
  if (isControlledFacilityStatus(status)) return 'border-amber-200 bg-amber-50 text-amber-900'
  if (['needs_information', 'needs_address_resolution', 'needs_facility_data', 'information_request_ready', 'information_request_sent', 'waiting_grid_owner_response', 'manual_review', 'pending_review', 'confirmation_pending', 'webhook_pending'].includes(status)) return 'border-amber-200 bg-amber-50 text-amber-900'
  if (['failed', 'rejected', 'cancelled', 'switch_rejected'].includes(status)) return 'border-red-200 bg-red-50 text-red-800'
  return 'border-slate-200 bg-slate-50 text-slate-700'
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



function energyValue(item: WebsiteApplicationAdminRow, key: string, fallbackPaths: string[] = []) {
  const response = item.response_payload ?? {}
  const fromResponse = nestedValue(response, `energy_resolution.${key}`) ?? nestedValue(response, key)
  if (fromResponse) return fromResponse
  const direct = (item as unknown as Record<string, unknown>)[key]
  if (typeof direct === 'string' && direct.trim()) return direct
  return firstPayloadValue(item.payload, fallbackPaths)
}

function canShowStartSwitch(item: WebsiteApplicationAdminRow) {
  return item.status === 'ready_for_switch'
}

function safeOperationalMessage(value: string | null | undefined) {
  const message = value?.trim()
  if (!message) return null
  if (/customers_intake_status_check/i.test(message)) return 'Databasens kundstatus-regel behöver senaste migrationen.'
  if (/customer_contracts_status_check/i.test(message)) return 'Avtal kunde inte skapas eftersom kundavtalets status inte stöds av databasen. Koden ska använda draft/pending_signature och senaste avtalsmigration måste vara körd.'
  if (/customer_contracts_source_type_check/i.test(message)) return 'Avtal kunde inte skapas eftersom kundavtalets source_type inte stöds av databasen. Kör senaste avtalsmigration och kontrollera ansökan igen.'
  if (/customer_contracts.*metadata|metadata.*customer_contracts|PGRST204/i.test(message)) return 'Kundavtalets schema behöver senaste migration/schema-cache.'
  if (/Failing row contains/i.test(message)) return 'Databasen stoppade raden. Kontrollera teknisk detalj i logg och kör rätt migration.'
  if (message.length > 180) return `${message.slice(0, 180)}…`
  return message
}

function isFailedApplication(item: WebsiteApplicationAdminRow) {
  return ['failed', 'rejected', 'cancelled', 'switch_rejected'].includes(item.status)
}

function hasControlledFacilityIssue(item: WebsiteApplicationAdminRow) {
  return isControlledFacilityStatus(item.status)
    || isControlledFacilityStatus(nestedValue(item.response_payload, 'status'))
    || isControlledFacilityStatus(nestedValue(item.response_payload, 'facility_data_status'))
}

function controlledFacilityStatus(item: WebsiteApplicationAdminRow) {
  if (isControlledFacilityStatus(item.status)) return item.status
  const responseStatus = nestedValue(item.response_payload, 'status')
  if (isControlledFacilityStatus(responseStatus)) return responseStatus
  const facilityStatus = nestedValue(item.response_payload, 'facility_data_status')
  if (isControlledFacilityStatus(facilityStatus)) return facilityStatus
  return null
}

function stringList(value: unknown): string[] {
  if (Array.isArray(value)) return value.map((item) => String(item)).filter(Boolean)
  if (typeof value === 'string' && value.trim()) return [value]
  return []
}

function reviewIssues(item: WebsiteApplicationAdminRow): Array<{ field: string; label: string; action: string; severity?: string }> {
  const fromColumn = Array.isArray(item.blocking_reasons)
    ? item.blocking_reasons
        .filter(isRecord)
        .map((issue) => ({
          field: String(issue.field ?? 'unknown'),
          label: String(issue.label ?? issue.field ?? 'Saknad uppgift'),
          action: String(issue.action ?? item.next_step ?? 'Komplettera uppgiften.'),
          severity: typeof issue.severity === 'string' ? issue.severity : undefined,
        }))
    : []

  if (fromColumn.length > 0) return fromColumn

  const fromMissingFields = stringList(item.missing_fields).map((field) => ({ field, label: field, action: item.next_step ?? 'Komplettera uppgiften.' }))
  if (fromMissingFields.length > 0) return fromMissingFields

  const controlledStatus = controlledFacilityStatus(item)
  if (controlledStatus) {
    const copy = facilityCorrectionCopy(controlledStatus)
    return [{
      field: controlledStatus,
      label: copy.title,
      action: item.next_step ?? copy.steps[0],
      severity: 'blocking',
    }]
  }

  if (isFailedApplication(item)) {
    return [{
      field: 'system',
      label: 'Tekniskt fel kräver åtgärd',
      action: safeOperationalMessage(item.error_message ?? item.error_code) ?? 'Kontrollera logg, kör senaste migration och kör redo-kontroll igen.',
      severity: 'blocking',
    }]
  }

  return []
}

function timelineRows(item: WebsiteApplicationAdminRow) {
  return Array.isArray(item.timeline)
    ? item.timeline.filter(isRecord).slice(-8).reverse()
    : []
}

function customerName(row: WebsiteApplicationAdminRow) {
  return row.customers?.full_name ?? row.customers?.company_name ?? row.customers?.email ?? firstPayloadValue(row.payload, ['customer.full_name', 'customer.company_name', 'customer.email', 'email']) ?? '—'
}

function customerEmail(row: WebsiteApplicationAdminRow) {
  return row.customers?.email ?? firstPayloadValue(row.payload, ['customer.email', 'email']) ?? '—'
}

function customerPhone(row: WebsiteApplicationAdminRow) {
  return row.customers?.phone ?? firstPayloadValue(row.payload, ['customer.phone', 'phone']) ?? '—'
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

function ReviewForm({ item }: { item: WebsiteApplicationAdminRow }) {
  const payload = item.payload ?? {}
  return (
    <form className="mt-4 grid gap-4 rounded-2xl border border-slate-200 bg-slate-50 p-4" action={updateWebsiteApplicationReviewAction}>
      <input type="hidden" name="application_id" value={item.id} />
      <div className="grid gap-3 md:grid-cols-3">
        <label className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-600">
          Kundnamn
          <input name="customer_full_name" defaultValue={firstPayloadValue(payload, ['customer.full_name', 'customer.company_name', 'name']) ?? ''} className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-normal normal-case tracking-normal text-slate-900" />
        </label>
        <label className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-600">
          E-post
          <input name="customer_email" defaultValue={firstPayloadValue(payload, ['customer.email', 'email']) ?? ''} className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-normal normal-case tracking-normal text-slate-900" />
        </label>
        <label className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-600">
          Telefon
          <input name="customer_phone" defaultValue={firstPayloadValue(payload, ['customer.phone', 'phone']) ?? ''} className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-normal normal-case tracking-normal text-slate-900" />
        </label>
        <label className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-600">
          Anläggnings-ID
          <input name="facility_id" defaultValue={firstPayloadValue(payload, ['site.facility_id', 'facility_id', 'site_facility_id']) ?? ''} className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-normal normal-case tracking-normal text-slate-900" />
        </label>
        <label className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-600">
          Mätpunkt
          <input name="metering_point_id" defaultValue={firstPayloadValue(payload, ['metering_point.metering_point_id', 'metering_point.meter_point_id', 'metering_point_id']) ?? ''} className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-normal normal-case tracking-normal text-slate-900" />
        </label>
        <label className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-600">
          Nätägare / verifierad aktör
          <input name="grid_owner_id" defaultValue={firstPayloadValue(payload, ['grid_owner_id', 'network_owner_id', 'site.grid_owner_id']) ?? ''} placeholder="Välj verifierad aktör eller klistra in verifierat UUID" className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-normal normal-case tracking-normal text-slate-900" />
        </label>
        <label className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-600">
          Nätområdeskod
          <input name="grid_area_code" defaultValue={item.grid_area_code ?? firstPayloadValue(payload, ['grid_area_code', 'site.grid_area_code']) ?? ''} placeholder="Ex. STH, MMO, SE4-kod" className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-normal normal-case tracking-normal text-slate-900" />
        </label>
        <label className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-600">
          Elområde
          <input name="price_area_code" defaultValue={item.price_area_code ?? firstPayloadValue(payload, ['price_area_code', 'price_area', 'site.price_area_code']) ?? ''} placeholder="SE1-SE4" className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-normal normal-case tracking-normal text-slate-900" />
        </label>
        <label className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-600">
          Resolver-status
          <input name="resolution_status" defaultValue={item.resolution_status ?? firstPayloadValue(payload, ['resolution_status']) ?? ''} placeholder="grid_area_master_validated" className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-normal normal-case tracking-normal text-slate-900" />
        </label>
        <label className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-600 md:col-span-2">
          Anläggningsadress
          <input name="site_street" defaultValue={firstPayloadValue(payload, ['site.street', 'address', 'street']) ?? ''} className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-normal normal-case tracking-normal text-slate-900" />
        </label>
        <label className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-600">
          Postnummer
          <input name="site_postal_code" defaultValue={firstPayloadValue(payload, ['site.postal_code', 'postal_code']) ?? ''} className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-normal normal-case tracking-normal text-slate-900" />
        </label>
        <label className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-600">
          Ort
          <input name="site_city" defaultValue={firstPayloadValue(payload, ['site.city', 'city']) ?? ''} className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-normal normal-case tracking-normal text-slate-900" />
        </label>
        <label className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-600">
          Prisplan / avtalsform
          <input name="price_plan_id" defaultValue={firstPayloadValue(payload, ['price_plan_id', 'contract.price_plan_id', 'contract.contract_type']) ?? ''} className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-normal normal-case tracking-normal text-slate-900" />
        </label>
        <label className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-600">
          Avtalsnamn
          <input name="contract_name" defaultValue={firstPayloadValue(payload, ['contract.contract_name']) ?? ''} className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-normal normal-case tracking-normal text-slate-900" />
        </label>
        <label className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-600">
          Startläge
          <select name="requested_start_mode" defaultValue={item.requested_start_mode ?? firstPayloadValue(payload, ['requested_start_mode', 'contract.requested_start_mode']) ?? 'earliest_possible'} className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-normal normal-case tracking-normal text-slate-900">
            <option value="earliest_possible">Snarast möjligt</option>
            <option value="specific_date">Specifikt datum</option>
          </select>
        </label>
        <label className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-600">
          Önskat startdatum
          <input type="date" name="requested_start_date" defaultValue={item.requested_start_date ?? firstPayloadValue(payload, ['requested_start_date', 'contract.requested_start_date', 'contract.starts_at']) ?? ''} className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-normal normal-case tracking-normal text-slate-900" />
        </label>
        <label className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-600">
          Beräknad tidigaste start
          <input type="date" name="calculated_earliest_start_date" defaultValue={item.calculated_earliest_start_date ?? firstPayloadValue(payload, ['calculated_earliest_start_date', 'contract.calculated_earliest_start_date']) ?? ''} className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-normal normal-case tracking-normal text-slate-900" />
        </label>
        <label className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-600">
          Bekräftat startdatum
          <input type="date" name="confirmed_start_date" defaultValue={item.confirmed_start_date ?? firstPayloadValue(payload, ['confirmed_start_date', 'contract.confirmed_start_date']) ?? ''} className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-normal normal-case tracking-normal text-slate-900" />
        </label>
        <label className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-600">
          Faktiskt startdatum
          <input type="date" name="actual_start_date" defaultValue={item.actual_start_date ?? firstPayloadValue(payload, ['actual_start_date', 'contract.actual_start_date']) ?? ''} className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-normal normal-case tracking-normal text-slate-900" />
        </label>
      </div>
      <div className="grid gap-3 md:grid-cols-3">
        <label className="flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700">
          <input type="checkbox" name="power_of_attorney_accepted" defaultChecked={defaultChecked(payload, ['consents.power_of_attorney', 'consents.fullmakt_accepted', 'power_of_attorney_accepted'])} />
          Fullmakt finns
        </label>
        <label className="flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700">
          <input type="checkbox" name="terms_accepted" defaultChecked={defaultChecked(payload, ['consents.terms_accepted', 'consents.terms', 'terms_accepted'])} />
          Villkor accepterade
        </label>
        <label className="flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700">
          <input type="checkbox" name="facility_data_verified" defaultChecked={Boolean(item.facility_data_verified_at) || defaultChecked(payload, ['facility_data_verified'])} />
          Anläggningsuppgifter mottagna/verifierade
        </label>
        <label className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-600">
          Intern anteckning
          <input name="admin_note" defaultValue={item.admin_note ?? ''} className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-normal normal-case tracking-normal text-slate-900" />
        </label>
      </div>
      <div className="flex flex-wrap gap-3">
        <button className="rounded-2xl bg-emerald-700 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-800">Spara komplettering</button>
        <button formAction={resolveWebsiteApplicationEnergyAction} className="rounded-2xl border border-sky-200 bg-white px-4 py-2 text-sm font-semibold text-sky-800 hover:bg-sky-50">Kör adressmatchning</button>
        <button formAction={requestWebsiteApplicationGridOwnerInfoAction} className="rounded-2xl border border-amber-200 bg-white px-4 py-2 text-sm font-semibold text-amber-900 hover:bg-amber-50">Begär uppgifter från nätägare</button>
        <button formAction={markWebsiteApplicationFacilityDataReceivedAction} className="rounded-2xl border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-800 hover:bg-slate-50">Markera uppgifter mottagna</button>
        <button formAction={checkWebsiteApplicationReadinessAction} className="rounded-2xl border border-emerald-200 bg-white px-4 py-2 text-sm font-semibold text-emerald-800 hover:bg-emerald-50">Kontrollera om redo</button>
      </div>
    </form>
  )
}

function ApplicationDetails({ item }: { item: WebsiteApplicationAdminRow }) {
  const issues = reviewIssues(item)
  const rows = timelineRows(item)
  return (
    <details className="rounded-xl border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700">
      <summary className="cursor-pointer">Öppna arbetsvy</summary>
      <div className="mt-4 w-[min(78rem,calc(100vw-5rem))] space-y-4 text-sm font-normal text-slate-700">
        <div className="grid gap-3 md:grid-cols-3">
          <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4"><p className="text-xs uppercase tracking-[0.14em] text-slate-600">Nästa steg</p><p className="mt-1 font-semibold text-slate-950">{item.next_step ?? 'Kontrollera ansökan.'}</p></div>
          <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4"><p className="text-xs uppercase tracking-[0.14em] text-slate-600">Startdatum</p><p className="mt-1 font-semibold text-slate-950">Önskat: {item.requested_start_date ?? '—'} · Bekräftat: {item.confirmed_start_date ?? '—'}</p></div>
          <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4"><p className="text-xs uppercase tracking-[0.14em] text-slate-600">Länkar</p><p className="mt-1">Site: {item.customer_site_id ?? '—'} · Mätpunkt: {item.metering_point_id ?? '—'} · Avtal: {item.contract_id ?? '—'}</p></div>
        </div>
        <div className="grid gap-3 md:grid-cols-4">
          <div className="rounded-2xl border border-sky-200 bg-sky-50 p-4"><p className="text-xs uppercase tracking-[0.14em] text-sky-700">Nätområde</p><p className="mt-1 font-semibold text-sky-950">{energyValue(item, 'gridAreaCode', ['grid_area_code', 'site.grid_area_code']) ?? '—'}</p></div>
          <div className="rounded-2xl border border-sky-200 bg-sky-50 p-4"><p className="text-xs uppercase tracking-[0.14em] text-sky-700">Elområde</p><p className="mt-1 font-semibold text-sky-950">{energyValue(item, 'priceArea', ['price_area_code', 'site.price_area_code']) ?? '—'}</p></div>
          <div className="rounded-2xl border border-sky-200 bg-sky-50 p-4"><p className="text-xs uppercase tracking-[0.14em] text-sky-700">Resolver</p><p className="mt-1 font-semibold text-sky-950">{energyValue(item, 'resolutionStatus', ['resolution_status']) ?? item.resolution_status ?? '—'}</p></div>
          <div className="rounded-2xl border border-sky-200 bg-sky-50 p-4"><p className="text-xs uppercase tracking-[0.14em] text-sky-700">Nätägare</p><p className="mt-1 font-semibold text-sky-950">{energyValue(item, 'gridOwnerName', []) ?? item.grid_owner_id ?? '—'}</p></div>
        </div>
        {!canShowStartSwitch(item) ? <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-950"><strong>Leverantörsbyte är blockerat.</strong> Nästa säkra steg är adressmatchning eller begäran om anläggningsuppgifter från nätägare tills anläggning/mätpunkt är verifierad.</div> : <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4 text-sm font-semibold text-emerald-900">Ansökan är redo för leverantörsbyte. Starta switch i operationsflödet.</div>}
        {hasControlledFacilityIssue(item) ? (() => {
          const copy = facilityCorrectionCopy(controlledFacilityStatus(item))
          return (
            <div className="rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-950">
              <p className="font-semibold">{copy.title}</p>
              <p className="mt-1">{copy.message}</p>
              <ol className="mt-3 list-decimal space-y-1 pl-5 text-xs">
                {copy.steps.map((step) => <li key={step}>{step}</li>)}
              </ol>
              <p className="mt-3 text-xs font-semibold">Tekniska detaljer finns endast i payload/logg. Fortsätt inte automatiskt efter rättning utan ny readiness-check.</p>
            </div>
          )
        })() : null}
        {issues.length > 0 ? (
          <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4">
            <p className="font-semibold text-amber-950">Saknas/blockerar</p>
            <div className="mt-2 grid gap-2 md:grid-cols-2">
              {issues.map((issue) => <div key={`${issue.field}-${issue.label}`} className="rounded-xl border border-amber-200 bg-white px-3 py-2"><div className="font-semibold text-amber-950">{issue.label}</div><div className="text-xs text-amber-900">{issue.action}</div></div>)}
            </div>
          </div>
        ) : null}
        <ReviewForm item={item} />
        <div className="grid gap-4 lg:grid-cols-2">
          <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
            <p className="font-semibold text-slate-950">Ärendehistorik</p>
            <div className="mt-2 space-y-2">
              {rows.length === 0 ? <p className="text-xs text-slate-600">Ingen timeline finns ännu.</p> : null}
              {rows.map((row, index) => <div key={index} className="rounded-xl bg-white px-3 py-2 text-xs"><div className="font-semibold text-slate-900">{String(row.label ?? row.type ?? 'Händelse')}</div><div className="text-slate-500">{formatDate(String(row.occurred_at ?? ''))}</div></div>)}
            </div>
          </div>
          <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
            <p className="font-semibold text-slate-950">Payload</p>
            <pre className="mt-2 max-h-80 overflow-auto whitespace-pre-wrap rounded-xl bg-white p-3 text-[11px] text-slate-600">{JSON.stringify(item.raw_payload ?? item.payload, null, 2)}</pre>
          </div>
        </div>
      </div>
    </details>
  )
}

export default async function WebsiteApplicationsAdminPage({ searchParams }: { searchParams?: Promise<Record<string, string | string[] | undefined>> }) {
  const access = await requireAdminPageAccess({ anyOf: ['customers.read', 'customers.write', 'billing_underlay.read'] })
  const tenantScope = await resolveAdminTenantReadScope(access)
  const resolved = searchParams ? await searchParams : {}
  const status = typeof resolved.status === 'string' ? resolved.status : null
  const applications = await listWebsiteApplications({ companyId: tenantScope.isPlatformAdmin ? null : tenantScope.companyId, status, limit: 150 })
  const failed = applications.filter((item) => item.status === 'failed').length
  const facilityErrors = applications.filter((item) => hasControlledFacilityIssue(item)).length
  const manualReview = applications.filter((item) => ['needs_information', 'needs_address_resolution', 'needs_facility_data', 'information_request_ready', 'waiting_grid_owner_response', 'manual_review', 'pending_review'].includes(item.status) || hasControlledFacilityIssue(item)).length
  const ready = applications.filter((item) => ['ready_for_switch', 'facility_data_received', 'pending_validation'].includes(item.status)).length
  const completed = applications.filter((item) => ['switch_confirmed', 'active', 'completed', 'linked_existing_customer'].includes(item.status)).length
  const isPlatformAdmin = isPlatformAdminContext(access)

  return (
    <main className="mx-auto max-w-7xl space-y-8 px-6 py-8">
      <section className="rounded-[36px] border border-emerald-100 bg-white p-8 shadow-sm shadow-emerald-950/5">
        <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-emerald-700">Nya kunder</p>
            <h1 className="mt-3 text-3xl font-bold tracking-tight text-slate-950">Kundansökningar från hemsida</h1>
            <p className="mt-3 max-w-3xl text-sm leading-6 text-slate-600">
              Här hamnar hemsideansökningar innan de blir aktiva kunder. Ofullständiga uppgifter ska kompletteras här innan switch, avtalsbekräftelse eller aktiv kundstatus kan fortsätta.
            </p>
          </div>
          <div className="flex flex-wrap gap-3">
            <Link href="/developers/customer-portal-api" className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-2 text-sm font-semibold text-emerald-800 hover:bg-emerald-100">API-dokumentation</Link>
            <Link href="/admin/webhooks/deliveries" className="rounded-2xl border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50">Webhook-loggar</Link>
          </div>
        </div>
        <div className="mt-8 grid gap-4 md:grid-cols-5">
          <div className="rounded-3xl border border-slate-200 bg-slate-50 p-5"><p className="text-sm text-slate-700">Totalt</p><p className="mt-2 text-3xl font-semibold text-slate-950">{applications.length}</p></div>
          <div className="rounded-3xl border border-amber-200 bg-amber-50 p-5"><p className="text-sm text-amber-900">Behöver kompletteras</p><p className="mt-2 text-3xl font-semibold text-amber-950">{manualReview}</p></div>
          <div className="rounded-3xl border border-sky-200 bg-sky-50 p-5"><p className="text-sm text-sky-800">Redo/kontroll</p><p className="mt-2 text-3xl font-semibold text-sky-950">{ready}</p></div>
          <div className="rounded-3xl border border-emerald-200 bg-emerald-50 p-5"><p className="text-sm text-emerald-800">Bekräftade/aktiva</p><p className="mt-2 text-3xl font-semibold text-emerald-950">{completed}</p></div>
          <div className="rounded-3xl border border-red-200 bg-red-50 p-5"><p className="text-sm text-red-800">Stoppade fel</p><p className="mt-2 text-3xl font-semibold text-red-950">{failed + facilityErrors}</p><p className="mt-1 text-xs text-red-700">varav {facilityErrors} anläggnings-/nätägarfel</p></div>
        </div>
      </section>

      <section className="rounded-[32px] border border-slate-200 bg-white p-6 shadow-sm">
        <div className="mb-4 flex flex-wrap items-center gap-2 text-sm font-semibold">
          <Link href="/admin/website-applications" className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-slate-700">Alla</Link>
          <Link href="/admin/website-applications?status=needs_information" className="rounded-full border border-amber-200 bg-amber-50 px-3 py-1 text-amber-900">Saknar uppgifter</Link>
          <Link href="/admin/website-applications?status=needs_facility_data" className="rounded-full border border-amber-200 bg-white px-3 py-1 text-amber-900">Begär nätägare</Link>
          <Link href="/admin/website-applications?status=ready_for_switch" className="rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-emerald-800">Redo för switch</Link>
          <Link href="/admin/website-applications?status=facility_data_invalid" className="rounded-full border border-red-200 bg-red-50 px-3 py-1 text-red-800">Anläggningsfel</Link>
          <Link href="/admin/website-applications?status=failed" className="rounded-full border border-red-200 bg-white px-3 py-1 text-red-800">Tekniska fel</Link>
        </div>
        <div className="overflow-x-auto rounded-2xl border border-slate-200">
          <table className="min-w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase tracking-[0.14em] text-slate-600">
              <tr>
                <th className="px-4 py-3">Kund</th>
                <th className="px-4 py-3">Kontakt</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Vad saknas</th>
                <th className="px-4 py-3">Skapad</th>
                <th className="px-4 py-3">Källa</th>
                <th className="px-4 py-3">Nästa steg</th>
                <th className="px-4 py-3">Åtgärder</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {applications.length === 0 ? <tr><td colSpan={8} className="px-4 py-8 text-center text-slate-600">Inga nya webbansökningar hittades.</td></tr> : null}
              {applications.map((item) => {
                const issues = reviewIssues(item)
                return (
                  <tr key={item.id} className="align-top">
                    <td className="px-4 py-3 text-slate-700"><div className="font-semibold text-slate-950">{customerName(item)}</div><div className="font-mono text-xs text-slate-500">{item.customer_number ?? item.external_customer_id}</div>{isPlatformAdmin ? <div className="text-xs text-slate-500">{item.companies?.name ?? item.company_id}</div> : null}</td>
                    <td className="px-4 py-3 text-slate-700"><div>{customerEmail(item)}</div><div className="text-xs text-slate-500">{customerPhone(item)}</div></td>
                    <td className="px-4 py-3"><span className={`inline-flex rounded-full border px-3 py-1 text-xs font-semibold ${statusTone(item.status)}`}>{item.status}</span>{item.error_stage ? <div className="mt-1 text-xs text-red-700">{item.error_stage}: {safeOperationalMessage(item.error_message ?? item.error_code) ?? 'Tekniskt fel'}</div> : null}</td>
                    <td className="px-4 py-3 text-slate-700">{issues.length === 0 ? <span className="text-emerald-700">Inget blockerar</span> : <div className="space-y-1">{issues.slice(0, 4).map((issue) => <div key={`${item.id}-${issue.field}`} className="text-xs text-amber-900">• {issue.label}</div>)}</div>}</td>
                    <td className="whitespace-nowrap px-4 py-3 text-slate-700">{formatDate(item.created_at)}</td>
                    <td className="px-4 py-3 text-slate-700">{item.source ?? 'external_website'}<div className="text-xs text-slate-500">{item.integration_api_clients?.name ?? '—'}</div></td>
                    <td className="px-4 py-3 text-slate-700">{item.next_step ?? 'Kontrollera ansökan.'}</td>
                    <td className="px-4 py-3">
                      <div className="flex flex-wrap gap-2">
                        {item.customer_id ? <Link href={`/admin/customers/${item.customer_id}`} className="rounded-xl border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50">Kundkort</Link> : null}
                        {item.contract_id ? <Link href={`/admin/customers/${item.customer_id}?tab=contracts`} className="rounded-xl border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50">Avtal</Link> : null}
                        <ApplicationDetails item={item} />
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </section>
    </main>
  )
}
