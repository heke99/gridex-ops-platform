import InfoRequestProcessDetails from '@/components/admin/customers/InfoRequestProcessDetails'
import AdminDisclosurePanel from "@/components/admin/ui/AdminDisclosurePanel"
import Link from 'next/link'
import { readManualServicePermissionOptions, type ManualServicePermissionOption } from '@/lib/ediel/services/manualPermissionOptions'
import AdminHeader from '@/components/admin/AdminHeader'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { isPlatformAdminContext, requireAdminPageKeyAccess } from '@/lib/admin/guards'
import { getOperationalCompanyScope } from '@/lib/tenant/scope'
import { resolveAdminSelectedCompanyReadScope } from '@/lib/tenant/adminScope'
import { isCompanyWritableInTenantWorkspace } from '@/lib/tenant/lifecycle'
import { readEdielProcessNextActions, type EdielProcessNextAction } from '@/lib/ediel/operations/processNextAction'
import {
  listAuthorizationScopes,
  listCustomerInfoRequests,
  listCustomerInfoRequestResourceOptions,
  listCustomersForInfoRequestSelector,
  listMeteringPermissions,
} from '@/lib/onboarding/infoRequests'
import {
  applyZ14SnapshotAction,
  closeCustomerInfoRequestAction,
  createAuthorizationScopeAction,
  createCustomerInfoRequestAction,
  createMeteringPermissionDraftAction,
  queueCustomerInfoRequestAction,
  queueMeteringPermissionZ13Action,
} from './actions'
import { formatStatusLabel } from '@/lib/ui/format'
import { canCloseInfoRequest } from '@/lib/onboarding/infoRequestClosure'
import { listPortalRepliesForInfoRequests, type InfoRequestPortalReply } from '@/lib/onboarding/infoRequestPortalReplies'
import CustomerResourceSelects from './CustomerResourceSelects'

export const dynamic = 'force-dynamic'

function statusTone(status: string) {
  if (['active', 'approved', 'z01_prepared', 'z02_received', 'ready_for_switch'].includes(status)) return 'border-emerald-200 bg-emerald-50 text-emerald-800'
  if (['blocked', 'route_missing', 'negative_aperak', 'rejected', 'revoked', 'missing_authorization'].includes(status)) return 'border-red-200 bg-red-50 text-red-800'
  if (['sent', 'waiting_for_z02', 'waiting_for_z14', 'pending'].includes(status)) return 'border-amber-200 bg-amber-50 text-amber-900'
  return 'border-slate-200 bg-slate-50 text-slate-700'
}


function statusLabel(status: string): string {
  const labels: Record<string, string> = {
    draft: 'Utkast',
    pending: 'Väntar',
    z01_prepared: 'Begäran förberedd',
    route_missing: 'Anslutning saknas',
    missing_authorization: 'Saknar fullmakt',
    manual_review_required: 'Manuell kontroll',
    waiting_for_z02: 'Väntar på nätägarens svar',
    z02_received: 'Nätägarens svar mottaget',
    negative_aperak: 'Mottagaren avvisade begäran',
    blocked: 'Blockerad',
    ready_to_send: 'Redo att skicka',
    sent_to_grid_owner: 'Skickad till nätägare',
    waiting_for_contrl: 'Inväntar leveransbekräftelse',
    waiting_for_aperak: 'Inväntar mottagarens bekräftelse',
    missing_binding_info: 'Saknar bindningsuppgifter',
    missing_termination_info: 'Saknar uppsägningsuppgifter',
    ready_for_switch: 'Redo för leverantörsbyte',
    cancelled: 'Avbruten',
    rejected: 'Avvisad',
    completed: 'Klar',
    active: 'Aktiv',
    approved: 'Godkänd',
    revoked: 'Återkallad',
    sent: 'Skickad',
  }
  return labels[status] ?? formatStatusLabel(status, 'Status saknas', 'Behöver granskning')
}

function requestTypeLabel(type: string): string {
  const labels: Record<string, string> = {
    z01_customer_masterdata: 'Kund- och anläggningskontroll',
    current_supplier_contract_check: 'Kontroll hos nuvarande elhandlare',
    current_supplier_contract: 'Kontroll hos nuvarande elhandlare',
    manual_customer_document_check: 'Manuell kunddokumentation',
  }
  return labels[type] ?? type
}

function scopeTypeLabel(type: string): string {
  const labels: Record<string, string> = {
    customer_onboarding: 'Kundregistrering',
    metering_data_access: 'Mätvärdesåtkomst',
    supplier_contract_check: 'Kontroll hos nuvarande elhandlare',
  }
  return labels[type] ?? type
}

function targetPartyLabel(type: string): string {
  const labels: Record<string, string> = {
    grid_owner: 'Nätägare',
    current_supplier: 'Nuvarande elhandlare',
    customer: 'Kund',
  }
  return labels[type] ?? type
}


function SelectCustomer({ customers, name = 'customer_id', defaultValue = '' }: { customers: Array<{ id: string; label: string; sublabel: string | null }>; name?: string; defaultValue?: string }) {
  return (
    <select name={name} defaultValue={defaultValue} aria-label="Kund" required className="h-11 rounded-2xl border border-slate-300 bg-white px-4 text-sm">
      <option value="">Välj kund</option>
      {customers.map((customer) => (
        <option key={customer.id} value={customer.id}>
          {customer.label}{customer.sublabel ? ` — ${customer.sublabel}` : ''}
        </option>
      ))}
    </select>
  )
}


const PORTAL_REPLY_STATUS_LABELS: Record<string, string> = {
  submitted: 'Inskickad',
  in_review: 'Under granskning',
  accepted: 'Godkänd',
  rejected: 'Avvisad',
  cancelled: 'Avbruten',
}

function portalReplySummary(reply: InfoRequestPortalReply): string {
  const payload = reply.submitted_payload ?? {}
  const message = ['message', 'comment', 'notes', 'description'].map((key) => payload[key]).find((value) => typeof value === 'string' && value.trim())
  if (typeof message === 'string') return message.length > 240 ? `${message.slice(0, 240)}…` : message
  const fields: Array<[string, string]> = [
    ['facility_id', 'Anläggningsnummer'], ['meter_point_id', 'Mätpunkt'],
    ['grid_owner_name', 'Nätägare'], ['annual_consumption_kwh', 'Årsförbrukning (kWh)'],
    ['street', 'Gatuadress'], ['postal_code', 'Postnummer'], ['city', 'Ort'],
    ['email', 'E-post'], ['phone', 'Telefon'],
  ]
  const values = fields.flatMap(([key, label]) => {
    const value = payload[key]
    return typeof value === 'string' && value.trim() || typeof value === 'number'
      ? [`${label}: ${String(value)}`] : []
  })
  return values.length ? values.join(' · ') : Object.keys(payload).length ? 'En komplettering har tagits emot. Uppgifterna behöver granskas.' : 'Inga uppgifter i svaret.'
}

function SelectGridOwner({ gridOwners }: { gridOwners: Array<{ id: string; label: string; sublabel: string | null }> }) {
  return (
    <select name="grid_owner_id" aria-label="Nätägare" className="h-11 rounded-2xl border border-slate-300 bg-white px-4 text-sm">
      <option value="">Välj nätägare</option>
      {gridOwners.map((owner) => (
        <option key={owner.id} value={owner.id}>
          {owner.label}{owner.sublabel ? ` — ${owner.sublabel}` : ''}
        </option>
      ))}
    </select>
  )
}

function ListPagination({ pageKey, page, total, label, resolvedSearch }: { pageKey: string; page: number; total: number; label: string; resolvedSearch: Record<string, string | string[] | undefined> }) {
    const href = (nextPage: number) => {
      const next = new URLSearchParams()
      for (const [key, value] of Object.entries(resolvedSearch)) if (typeof value === 'string' && !['success', 'error'].includes(key)) next.set(key, value)
      next.set(pageKey, String(nextPage))
      return `?${next}`
    }
    return <nav aria-label={`Sidor för ${label}`} className="flex flex-wrap items-center gap-3 border-t px-4 py-3 text-sm"><span>{total} inlästa · sida {page}</span>{page > 1 ? <Link className="underline" href={href(page - 1)}>Föregående {label}</Link> : null}{page * 12 < total ? <Link className="underline" href={href(page + 1)}>Nästa {label}</Link> : null}</nav>
  }

export default async function CustomerInfoRequestsPage({ searchParams }: { searchParams?: Promise<Record<string, string | string[] | undefined>> } = {}) {
  const resolvedSearch = searchParams ? await searchParams : {}
  const successNotice = typeof resolvedSearch.success === 'string' ? resolvedSearch.success.slice(0, 300) : null
  const errorNotice = typeof resolvedSearch.error === 'string' ? resolvedSearch.error.slice(0, 300) : null
  const admin = await requireAdminPageKeyAccess('customer.info_requests')
  const isPlatformAdmin = isPlatformAdminContext(admin)
  const { companyId } = await resolveAdminSelectedCompanyReadScope(admin, { allowMissing: true })
  const supabase = await createSupabaseServerClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  // Membership/lifecycle evidence controls write affordances; its legacy
  // selected company never redirects reads authorized by the canonical guard.
  const scope = companyId && user ? await getOperationalCompanyScope(user.id) : null
  const membership = scope?.memberships.find(row=>row.companyId===companyId)
  const currentWritable = Boolean(user&&admin.userId===user.id&&admin.companyId===companyId&&membership?.status==='active'&&isCompanyWritableInTenantWorkspace(membership.companyStatus))
  const canReadProcess = Boolean(companyId&&admin.permissions.includes('communication.read'))
  const canPrepareRequest = currentWritable&&admin.permissions.includes('customers.write')&&admin.permissions.includes('communication.send')
  const canPreparePermission = currentWritable&&admin.permissions.includes('metering.write')&&admin.permissions.includes('communication.send')

  const [customers, requests, authorizationScopes, permissions, resourceOptions] = companyId
    ? await Promise.all([
        listCustomersForInfoRequestSelector(companyId),
        listCustomerInfoRequests(companyId),
        listAuthorizationScopes(companyId),
        listMeteringPermissions(companyId),
        listCustomerInfoRequestResourceOptions(companyId),
      ])
    : [[], [], [], [], { sites: [], meteringPoints: [], gridOwners: [] }]

  const selectedCustomerId = typeof resolvedSearch.customer_id === 'string' && customers.some(customer => customer.id === resolvedSearch.customer_id) ? resolvedSearch.customer_id : ''
  const pageNumber = (key: string, total: number) => Math.min(Math.max(1, Number.parseInt(String(resolvedSearch[key] ?? '1'), 10) || 1), Math.max(1, Math.ceil(total / 12)))
  const requestPage = pageNumber('requestPage', requests.length)
  const scopePage = pageNumber('scopePage', authorizationScopes.length)
  const permissionPage = pageNumber('permissionPage', permissions.length)
  const visibleRequests = requests.slice((requestPage - 1) * 12, requestPage * 12)
  const visibleScopes = authorizationScopes.slice((scopePage - 1) * 12, scopePage * 12)
  const visiblePermissions = permissions.slice((permissionPage - 1) * 12, permissionPage * 12)
  const canCloseRequests = currentWritable && admin.permissions.includes('customers.write')
  let portalRepliesReadFailed = false
  let portalReplies = new Map<string, InfoRequestPortalReply[]>()
  if (companyId && requests.length) {
    try {
      portalReplies = await listPortalRepliesForInfoRequests(companyId, visibleRequests)
    } catch {
      portalRepliesReadFailed = true
      portalReplies = new Map()
    }
  }

  const processDecisions = new Map<string,EdielProcessNextAction>()
  let processReadUnavailable = false
  if(companyId&&user&&canReadProcess){
    const sourceIds = visibleRequests.flatMap(request=>request.ediel_message_id?[request.ediel_message_id]:[])
    try {
      for(const environment of ['test','production'] as const){
        const decisions=await readEdielProcessNextActions({companyId,actorUserId:user.id,environment,messageIds:sourceIds,evaluatedAt:new Date().toISOString(),
          access:{canRead:canReadProcess,canReview:currentWritable&&admin.permissions.includes('cases.write'),canPrepare:canPrepareRequest}})
        for(const [id,decision] of decisions)processDecisions.set(id,decision)
      }
    }catch{processReadUnavailable=true;processDecisions.clear()}
  }
  let permissionAssignmentOptions: ManualServicePermissionOption[] = []
  let permissionAssignmentReadFailed = false
  if (companyId && user && permissions.length) {
    try {
      permissionAssignmentOptions = await readManualServicePermissionOptions({ companyId, actorUserId: user.id, permissionIds: visiblePermissions.map((permission) => permission.id) })
    } catch {
      permissionAssignmentReadFailed = true
    }
  }

  const blockedRequests = requests.filter((request) => ['blocked', 'route_missing', 'negative_aperak', 'manual_review_required', 'missing_authorization'].includes(request.status))
  const activeScopes = authorizationScopes.filter((scopeRow) => scopeRow.status === 'active')
  const activePermissions = permissions.filter((permission) => ['approved', 'active', 'z14_received'].includes(permission.status))

  return (
    <div className="min-h-screen">
      <AdminHeader
        title="Uppgiftsbegäran och fullmakter"
        subtitle="Begär kund- och anläggningsuppgifter, dokumentera fullmakter och följ mätvärdestillstånd."
        userEmail={admin.email}
      />

      <div className="min-w-0 space-y-4 p-4 lg:p-6 [&_input:not([type=checkbox])]:min-w-0 [&_input:not([type=checkbox])]:w-full [&_select]:min-w-0 [&_select]:w-full [&_textarea]:min-w-0 [&_textarea]:w-full">
        {!companyId ? (
          <section className="rounded-3xl border border-amber-200 bg-amber-50 p-6 text-sm text-amber-900">
            Kontot saknar aktiv bolagskoppling. Koppla användaren till ett bolag innan uppgiftsbegäran kan skapas.
          </section>
        ) : null}

        {portalRepliesReadFailed ? <p role="alert" className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-950">Svar från kundportalen kunde inte läsas. Försök igen innan du bedömer om kunden behöver komplettera.</p> : null}
        {successNotice ? <section role="status" className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-medium text-emerald-800">{successNotice}</section> : null}
        {errorNotice ? <section role="alert" className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-medium text-red-800">{errorNotice}</section> : null}

        <section className="grid min-w-0 grid-cols-2 gap-2 lg:grid-cols-4">
          <div className="min-w-0 break-words rounded-3xl border border-slate-200 bg-white p-3">
            <div className="min-w-0 break-words text-sm font-medium text-slate-700">Uppgiftsbegäran</div>
            <div className="mt-1 text-2xl font-semibold text-slate-950">{requests.length}</div>
            <p className="mt-2 text-xs text-slate-600">Inlästa begäranden om kund, anläggning och avtalsvillkor.</p>
          </div>
          <div className="min-w-0 break-words rounded-3xl border border-emerald-200 bg-emerald-50 p-3">
            <div className="min-w-0 break-words text-sm font-medium text-emerald-800">Aktiva fullmaktsomfattningar</div>
            <div className="mt-1 text-2xl font-semibold text-slate-950">{activeScopes.length}</div>
            <p className="mt-2 text-xs text-emerald-900">Aktiva i det inlästa urvalet.</p>
          </div>
          <div className="min-w-0 break-words rounded-3xl border border-emerald-200 bg-emerald-50 p-3">
            <div className="min-w-0 break-words text-sm font-medium text-emerald-800">Aktiva mätvärdestillstånd</div>
            <div className="mt-1 text-2xl font-semibold text-slate-950">{activePermissions.length}</div>
            <p className="mt-2 text-xs text-emerald-900">Aktiva i det inlästa urvalet.</p>
          </div>
          <div className="min-w-0 break-words rounded-3xl border border-red-200 bg-red-50 p-3">
            <div className="min-w-0 break-words text-sm font-medium text-red-800">Ärenden som väntar på åtgärd</div>
            <div className="mt-1 text-2xl font-semibold text-slate-950">{blockedRequests.length}</div>
            <p className="mt-2 text-xs text-red-900">I det inlästa urvalet.</p>
          </div>
        </section>

        <section className="grid min-w-0 items-start gap-3 xl:grid-cols-3">
          <AdminDisclosurePanel id="create-info-request" title="Skapa uppgiftsbegäran" className="min-w-0 rounded-2xl border border-slate-200 bg-white p-4">
          <form action={createCustomerInfoRequestAction} className="min-w-0">
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-emerald-800">Anläggnings- och avtalsuppgifter</p>
            <p className="mt-2 text-sm leading-6 text-slate-700">Använd för anläggningsuppgifter, nätområde, årsenergi och separat manuell kontroll av bindningstid/uppsägningstid.</p>
            <div className="mt-4 grid min-w-0 grid-cols-1 gap-3">
              <CustomerResourceSelects customers={customers} sites={resourceOptions.sites} meteringPoints={resourceOptions.meteringPoints} />
              <SelectGridOwner gridOwners={resourceOptions.gridOwners} />
              <div className="rounded-2xl border border-emerald-100 bg-emerald-50 px-4 py-3 text-xs leading-5 text-emerald-900">
                Kontrollera kundens anläggning, mätpunkt och nätägare. Saknade uppgifter behöver kompletteras innan begäran kan skickas.
              </div>
              <select name="request_type" aria-label="Begärans typ" defaultValue="z01_customer_masterdata" className="h-11 rounded-2xl border border-slate-300 bg-white px-4 text-sm">
                <option value="z01_customer_masterdata">Kund- och anläggningskontroll</option>
                <option value="current_supplier_contract_check">Bindning/uppsägning hos nuvarande elhandlare</option>
                <option value="manual_customer_document_check">Manuell kunddokumentation</option>
              </select>
              <select name="target_party_type" aria-label="Motpartstyp" defaultValue="grid_owner" className="h-11 rounded-2xl border border-slate-300 bg-white px-4 text-sm">
                <option value="grid_owner">Nätägare</option>
                <option value="current_supplier">Nuvarande elhandlare</option>
                <option value="customer">Kund</option>
              </select>
              <input name="target_party_name" aria-label="Motpart" placeholder="Motpart, t.ex. nätägare eller nuvarande elhandlare" className="h-11 rounded-2xl border border-slate-300 px-4 text-sm" />
              <input name="current_supplier_name" aria-label="Nuvarande elhandlare" placeholder="Nuvarande elhandlare, om känd" className="h-11 rounded-2xl border border-slate-300 px-4 text-sm" />
              <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-700">
                <div className="font-semibold text-slate-950">Uppgifter som ska kontrolleras</div>
                <div className="mt-3 grid gap-2">
                  {[
                    ['facility_id', 'Anläggnings-id'],
                    ['grid_area', 'Nätområde/områdes-id'],
                    ['annual_consumption', 'Årsenergi'],
                    ['network_contract', 'Elnätsavtal finns'],
                    ['current_supplier', 'Befintlig leverantör'],
                    ['binding_period', 'Bindningstid'],
                    ['notice_period', 'Uppsägningstid'],
                    ['contract_end_date', 'Avtalslut'],
                  ].map(([value, label]) => (
                    <label key={value} className="flex items-center gap-2">
                      <input type="checkbox" name="requested_data_categories" value={value} />
                      <span>{label}</span>
                    </label>
                  ))}
                </div>
              </div>
              <textarea name="notes" aria-label="Intern notering" rows={3} placeholder="Intern notering" className="rounded-2xl border border-slate-300 px-4 py-3 text-sm" />
              <button disabled={!currentWritable||!admin.permissions.includes('customers.write')} className="rounded-2xl bg-emerald-700 px-4 py-3 text-sm font-semibold text-white hover:bg-emerald-800 disabled:opacity-50">Skapa uppgiftsbegäran</button>
            </div>
          </form>
          </AdminDisclosurePanel>

          <AdminDisclosurePanel id="create-authorization-scope" title="Dokumentera fullmaktsomfattning" className="min-w-0 rounded-2xl border border-slate-200 bg-white p-4">
          <form action={createAuthorizationScopeAction} className="min-w-0">
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-emerald-800">Fullmakt</p>
            <p className="mt-2 text-sm leading-6 text-slate-700">Fullmakten ska visa vad bolaget får begära och mot vem. Fullmakten måste vara klar innan uppgifter kan begäras från nätägaren.</p>
            <div className="mt-4 grid min-w-0 grid-cols-1 gap-3">
              <SelectCustomer customers={customers} defaultValue={selectedCustomerId} />
              <select name="scope_type" aria-label="Fullmaktsomfattning" defaultValue="customer_onboarding" className="h-11 rounded-2xl border border-slate-300 bg-white px-4 text-sm">
                <option value="customer_onboarding">Kundregistrering</option>
                <option value="metering_data_access">Mätvärdesåtkomst</option>
                <option value="supplier_contract_check">Kontroll hos nuvarande elhandlare</option>
              </select>
              <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-700">
                <div className="font-semibold text-slate-950">Fullmakten täcker</div>
                <div className="mt-3 grid gap-2">
                  <label className="flex items-center gap-2"><input type="checkbox" name="covers_grid_owner_data" /> Nätägarens anläggnings-/kunddata</label>
                  <label className="flex items-center gap-2"><input type="checkbox" name="covers_current_supplier_contract" /> Bindning/uppsägning hos nuvarande elhandlare</label>
                  <label className="flex items-center gap-2"><input type="checkbox" name="covers_metering_data" /> Mätvärden</label>
                </div>
              </div>
              <div className="grid gap-3 md:grid-cols-2">
                <input name="valid_from" aria-label="Giltig från" type="date" className="h-11 rounded-2xl border border-slate-300 px-4 text-sm" />
                <input name="valid_to" aria-label="Giltig till" type="date" className="h-11 rounded-2xl border border-slate-300 px-4 text-sm" />
              </div>
              <textarea name="evidence_note" aria-label="Bevisnotering" rows={3} placeholder="Signeringsmetod, bilaga, muntlig fullmakt eller bevisnotering" className="rounded-2xl border border-slate-300 px-4 py-3 text-sm" />
              <button disabled={!currentWritable||!admin.permissions.some(value=>['poa.write','customers.write'].includes(value))} className="rounded-2xl bg-emerald-700 px-4 py-3 text-sm font-semibold text-white hover:bg-emerald-800 disabled:opacity-50">Spara omfattning</button>
            </div>
          </form>
          </AdminDisclosurePanel>

          <AdminDisclosurePanel id="create-metering-permission" title="Förbered mätvärdestillstånd" className="min-w-0 rounded-2xl border border-slate-200 bg-white p-4">
          <form action={createMeteringPermissionDraftAction} className="min-w-0">
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-emerald-800">Mätvärdestillstånd</p>
            <p className="mt-2 text-sm leading-6 text-slate-700">Förbered ett tillstånd för den valda anläggningen. Tillståndet behöver godkännas innan mätvärden kan hämtas.</p>
            <div className="mt-4 grid min-w-0 grid-cols-1 gap-3">
              <SelectCustomer customers={customers} />
              <input name="site_id" aria-label="Anläggning" placeholder="Anläggning/site-id, om känd" className="h-11 rounded-2xl border border-slate-300 px-4 text-sm" />
              <input name="metering_point_id" aria-label="Mätpunkt" placeholder="Mätpunkt-id, om känd" className="h-11 rounded-2xl border border-slate-300 px-4 text-sm" />
              <input name="case_reference" aria-label="Ärendereferens" placeholder="Ärendereferens/RFF+LI, om känd" className="h-11 rounded-2xl border border-slate-300 px-4 text-sm" />
              <div className="grid gap-3 md:grid-cols-2">
                <input name="requested_start_date" aria-label="Begärd startdag" type="date" className="h-11 rounded-2xl border border-slate-300 px-4 text-sm" />
                <input name="requested_end_date" aria-label="Begärd slutdag" type="date" className="h-11 rounded-2xl border border-slate-300 px-4 text-sm" />
              </div>
              <label className="flex items-start gap-3 rounded-2xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-700">
                <input type="checkbox" name="authorization_confirmed" className="mt-1" />
                <span>Fullmakt/avtal är kontrollerad och täcker mätvärdesbegäran.</span>
              </label>
              <button disabled={!currentWritable||!admin.permissions.some(value=>['metering.write','customers.write'].includes(value))} className="rounded-2xl bg-emerald-700 px-4 py-3 text-sm font-semibold text-white hover:bg-emerald-800 disabled:opacity-50">Skapa tillståndsutkast</button>
            </div>
          </form>
          </AdminDisclosurePanel>
        </section>

        <section className="grid min-w-0 items-start gap-3 xl:grid-cols-3">
          <div className="min-w-0 rounded-2xl border border-slate-200 bg-white shadow-sm">
            <div className="border-b border-slate-200 px-4 py-3">
              <h2 className="text-lg font-semibold text-slate-950">Senaste uppgiftsbegäran</h2>
              <p className="mt-1 text-sm text-slate-700">Separera nätägaruppgifter från bindning/uppsägning hos befintlig leverantör.</p>
            </div>
            <div tabIndex={0} role="region" aria-label="Uppgiftsbegäranden" className="max-h-[40rem] space-y-3 overflow-auto p-4 focus-visible:outline focus-visible:outline-2 focus-visible:outline-emerald-700">
              {requests.length === 0 ? <div className="rounded-2xl border border-dashed p-6 text-center text-sm text-slate-600">Inga uppgiftsbegäran ännu.</div> : visibleRequests.map((request) => (
                <div key={request.id} className="rounded-2xl border border-slate-200 p-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className={`rounded-full border px-3 py-1 text-xs font-semibold ${statusTone(request.status)}`}>{statusLabel(request.status)}</span>
                    <Link href={`/admin/customers/${request.customer_id}`} className="text-xs font-semibold text-emerald-800 hover:underline">Öppna kund</Link>
                  </div>
                  <div className="mt-3 text-sm font-semibold text-slate-950">{requestTypeLabel(request.request_type)}</div>
                  <div className="mt-1 text-xs leading-5 text-slate-600">{targetPartyLabel(request.target_party_type)}{request.target_party_name ? ` · ${request.target_party_name}` : ''}</div>
                  {request.blocker_reason ? <div className="mt-2 rounded-xl bg-red-50 px-3 py-2 text-xs text-red-800">{request.blocker_reason}</div> : null}
                  {request.ediel_message_id&&processDecisions.has(request.ediel_message_id)?<InfoRequestProcessDetails showTechnicalDetails={isPlatformAdmin} decision={processDecisions.get(request.ediel_message_id)!}/>:request.sent_at?<p className="mt-3 text-xs text-amber-900" role="status">{!canReadProcess?'Läsbehörighet till kommunikation krävs för aktuellt processbeslut.':processReadUnavailable?'Processbeslutet kunde inte hämtas. Granska innan fortsatt åtgärd.':'Källkvalificerat processbeslut saknas. Granska innan fortsatt åtgärd.'} Ingen automatisk omsändning.</p>:null}
                  {canPrepareRequest&&!processReadUnavailable&&!request.sent_at&&!['waiting_for_contrl','waiting_for_aperak','waiting_for_z02','z02_received','ready_for_switch','completed','negative_aperak','failed','cancelled','rejected'].includes(request.status)&&!(request.ediel_message_id&&processDecisions.has(request.ediel_message_id))?<form action={queueCustomerInfoRequestAction} className="mt-3">
                    <input type="hidden" name="request_id" value={request.id} />
                    <button className="w-full rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs font-semibold text-emerald-800 hover:bg-emerald-100">
                      Kontrollera fullmakt och förbered begäran
                    </button>
                  </form>:null}
                  {(portalReplies.get(request.id) ?? []).length ? (
                    <div className="mt-3 rounded-xl border border-sky-200 bg-sky-50 p-3 text-xs text-sky-950">
                      <p className="font-semibold">Svar från kundportalen</p>
                      <ul className="mt-2 space-y-2">
                        {(portalReplies.get(request.id) ?? []).map((reply) => (
                          <li key={reply.id}>
                            <span className="font-semibold">{PORTAL_REPLY_STATUS_LABELS[reply.status] ?? reply.status}</span>
                            {' · '}{new Date(reply.created_at).toLocaleString('sv-SE')}
                            <p className="mt-1 break-words">{portalReplySummary(reply)}</p>
                          </li>
                        ))}
                      </ul>
                    </div>
                  ) : null}
                  {canCloseRequests && canCloseInfoRequest(request.status) ? (
                    <details className="mt-3 rounded-xl border border-slate-200 bg-slate-50 p-3">
                      <summary className="cursor-pointer text-xs font-semibold text-slate-700">Stäng ärendet</summary>
                      <form action={closeCustomerInfoRequestAction} className="mt-3 grid gap-2">
                        <input type="hidden" name="request_id" value={request.id} />
                        <select name="target_status" aria-label="Ny status" defaultValue="cancelled" className="h-9 rounded-lg border border-slate-300 bg-white px-3 text-xs">
                          <option value="cancelled">Avbryt ärendet</option>
                          <option value="completed">Markera som slutfört</option>
                        </select>
                        <textarea name="reason" aria-label="Orsak" required minLength={3} maxLength={1000} rows={2} placeholder="Orsak (krävs)" className="rounded-lg border border-slate-300 px-3 py-2 text-xs" />
                        <button className="rounded-lg bg-slate-900 px-3 py-2 text-xs font-semibold text-white">Stäng ärendet</button>
                      </form>
                    </details>
                  ) : null}
                </div>
              ))}
            </div>
            <ListPagination resolvedSearch={resolvedSearch} pageKey="requestPage" page={requestPage} total={requests.length} label="begäranden" />
          </div>

          <div className="min-w-0 rounded-2xl border border-slate-200 bg-white shadow-sm">
            <div className="border-b border-slate-200 px-4 py-3">
              <h2 className="text-lg font-semibold text-slate-950">Fullmaktsomfattning</h2>
              <p className="mt-1 text-sm text-slate-700">Aktiva fullmakter och vilka uppgifter de omfattar.</p>
            </div>
            <div tabIndex={0} role="region" aria-label="Fullmakternas omfattning" className="max-h-[40rem] space-y-3 overflow-auto p-4 focus-visible:outline focus-visible:outline-2 focus-visible:outline-emerald-700">
              {authorizationScopes.length === 0 ? <div className="rounded-2xl border border-dashed p-6 text-center text-sm text-slate-600">Ingen omfattning sparad ännu.</div> : visibleScopes.map((scopeRow) => (
                <div key={scopeRow.id} className="rounded-2xl border border-slate-200 p-4">
                  <span className={`rounded-full border px-3 py-1 text-xs font-semibold ${statusTone(scopeRow.status)}`}>{formatStatusLabel(scopeRow.status)}</span>
                  <div className="mt-3 text-sm font-semibold text-slate-950">{scopeTypeLabel(scopeRow.scope_type)}</div>
                  <div className="mt-2 flex flex-wrap gap-2 text-xs text-slate-700">
                    {scopeRow.covers_grid_owner_data ? <span className="rounded-full bg-slate-100 px-2 py-1">Nätdata</span> : null}
                    {scopeRow.covers_current_supplier_contract ? <span className="rounded-full bg-slate-100 px-2 py-1">Bindning</span> : null}
                    {scopeRow.covers_metering_data ? <span className="rounded-full bg-slate-100 px-2 py-1">Mätvärden</span> : null}
                  </div>
                </div>
              ))}
            </div>
            <ListPagination resolvedSearch={resolvedSearch} pageKey="scopePage" page={scopePage} total={authorizationScopes.length} label="fullmakter" />
          </div>

          <div className="min-w-0 rounded-2xl border border-slate-200 bg-white shadow-sm">
            <div className="border-b border-slate-200 px-4 py-3">
              <h2 className="text-lg font-semibold text-slate-950">Mätvärdestillstånd</h2>
              <p className="mt-1 text-sm text-slate-700">Tillstånd att hämta mätvärden per kund och anläggning.</p>
            </div>
            <div tabIndex={0} role="region" aria-label="Mätvärdestillstånd" className="max-h-[40rem] space-y-3 overflow-auto p-4 focus-visible:outline focus-visible:outline-2 focus-visible:outline-emerald-700">
              {permissions.length === 0 ? <div className="rounded-2xl border border-dashed p-6 text-center text-sm text-slate-600">Inga mätvärdestillstånd ännu.</div> : visiblePermissions.map((permission) => (
                <div key={permission.id} className="rounded-2xl border border-slate-200 p-4">
                  <span className={`rounded-full border px-3 py-1 text-xs font-semibold ${statusTone(permission.status)}`}>{formatStatusLabel(permission.status)}</span>
                  <div className="mt-3 text-sm font-semibold text-slate-950">{permission.case_reference ?? permission.permission_reference ?? 'Tillståndsutkast'}</div>
                  <div className="mt-1 text-xs leading-5 text-slate-600">{permission.requested_start_date ?? 'Start saknas'} → {permission.requested_end_date ?? 'tills vidare'}</div>
                  {permission.last_blocker ? <div className="mt-2 rounded-xl bg-amber-50 px-3 py-2 text-xs text-amber-900">{permission.last_blocker}</div> : null}
                  <div className="mt-3 grid gap-2">
                    {canPreparePermission&&!['sent','waiting_for_z14','z14_received','approved','active','revoked','rejected','ended','cancelled'].includes(permission.status)?<form action={queueMeteringPermissionZ13Action} className="grid gap-2">
                      <input type="hidden" name="permission_id" value={permission.id} />
                      <label htmlFor={`permission-assignment-${permission.id}`} className="text-xs text-slate-700">Kopplat tjänsteuppdrag</label>
                      <select id={`permission-assignment-${permission.id}`} name="service_assignment_selection" defaultValue="" className="h-9 rounded-lg border border-slate-300 bg-white px-3 text-xs">
                        <option value="">Använd endast ett entydigt kopplat uppdrag</option>
                        {permissionAssignmentOptions.filter((option) => option.permissionId === permission.id).map((option) => (
                          <option key={option.assignmentId} value={`${option.assignmentId}:${option.assignmentVersion}`}>{option.beneficiaryLabel ?? option.beneficiaryCompanyId} · {option.purpose} · {option.mode} · {option.status}</option>
                        ))}
                      </select>
                      {permissionAssignmentReadFailed ? <p className="text-xs text-amber-900">Uppdragen kunde inte läsas. Begäran kräver kontroll innan den kan förberedas.</p> : null}
                      {!permissionAssignmentOptions.some((option) => option.permissionId === permission.id) ? <p className="text-xs text-slate-600">Saknas ett aktuellt källbelagt uppdrag skapas en uppgift för manuell kontroll.</p> : null}
                      <button className="w-full rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs font-semibold text-emerald-800 hover:bg-emerald-100">
                        Kontrollera och förbered begäran
                      </button>
                    </form>:null}
                    {isPlatformAdmin && canPreparePermission?<details className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                      <summary className="cursor-pointer text-xs font-semibold text-slate-700">Koppla mottaget Z14-svar</summary>
                      <form action={applyZ14SnapshotAction} className="mt-3 grid gap-2">
                        <input type="hidden" name="permission_id" value={permission.id} />
                        <label className="text-xs text-slate-600" htmlFor={`z14-source-${permission.id}`}>Id för det mottagna Z14-meddelandet</label>
                        <input id={`z14-source-${permission.id}`} name="source_message_id" required placeholder="Meddelande-id" className="h-9 rounded-lg border border-slate-300 px-3 text-xs" />
                        <button className="rounded-lg bg-slate-900 px-3 py-2 text-xs font-semibold text-white">Koppla och behandla mottaget svar</button>
                      </form>
                    </details>:null}
                  </div>
                </div>
              ))}
            </div>
            <ListPagination resolvedSearch={resolvedSearch} pageKey="permissionPage" page={permissionPage} total={permissions.length} label="mätvärdestillstånd" />
          </div>
        </section>
      </div>
    </div>
  )
}
