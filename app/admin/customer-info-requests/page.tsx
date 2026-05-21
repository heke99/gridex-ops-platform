import Link from 'next/link'
import AdminHeader from '@/components/admin/AdminHeader'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { requireAdminPageKeyAccess } from '@/lib/admin/guards'
import { getOperationalCompanyScope } from '@/lib/tenant/scope'
import {
  listAuthorizationScopes,
  listCustomerInfoRequests,
  listCustomerInfoRequestResourceOptions,
  listCustomersForInfoRequestSelector,
  listMeteringPermissions,
} from '@/lib/onboarding/infoRequests'
import {
  applyZ14SnapshotAction,
  createAuthorizationScopeAction,
  createCustomerInfoRequestAction,
  createMeteringPermissionDraftAction,
  queueCustomerInfoRequestAction,
  queueMeteringPermissionZ13Action,
} from './actions'

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
    z01_prepared: 'Z01 förberedd',
    route_missing: 'Saknar route',
    missing_authorization: 'Saknar fullmakt',
    manual_review_required: 'Manuell kontroll',
    waiting_for_z02: 'Väntar på Z02',
    z02_received: 'Z02 mottagen',
    negative_aperak: 'Negativ APERAK',
    blocked: 'Blockerad',
  }
  return labels[status] ?? status
}

function requestTypeLabel(type: string): string {
  const labels: Record<string, string> = {
    z01_customer_masterdata: 'Kund- och anläggningskontroll',
    current_supplier_contract_check: 'Kontroll hos nuvarande elhandlare',
    manual_customer_document_check: 'Manuell kunddokumentation',
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

function SelectCustomer({ customers, name = 'customer_id' }: { customers: Array<{ id: string; label: string; sublabel: string | null }>; name?: string }) {
  return (
    <select name={name} required className="h-11 rounded-2xl border border-slate-300 bg-white px-4 text-sm">
      <option value="">Välj kund</option>
      {customers.map((customer) => (
        <option key={customer.id} value={customer.id}>
          {customer.label}{customer.sublabel ? ` — ${customer.sublabel}` : ''}
        </option>
      ))}
    </select>
  )
}


function SelectSite({ sites }: { sites: Array<{ id: string; customerId: string; label: string; sublabel: string | null }> }) {
  return (
    <select name="site_id" className="h-11 rounded-2xl border border-slate-300 bg-white px-4 text-sm">
      <option value="">Välj anläggning för Z01/Z02</option>
      {sites.map((site) => (
        <option key={site.id} value={site.id}>
          {site.label}{site.sublabel ? ` — ${site.sublabel}` : ''}
        </option>
      ))}
    </select>
  )
}

function SelectMeteringPoint({ meteringPoints }: { meteringPoints: Array<{ id: string; label: string; sublabel: string | null }> }) {
  return (
    <select name="metering_point_id" className="h-11 rounded-2xl border border-slate-300 bg-white px-4 text-sm">
      <option value="">Välj mätpunkt för Z01/Z02</option>
      {meteringPoints.map((point) => (
        <option key={point.id} value={point.id}>
          {point.label}{point.sublabel ? ` — ${point.sublabel}` : ''}
        </option>
      ))}
    </select>
  )
}

function SelectGridOwner({ gridOwners }: { gridOwners: Array<{ id: string; label: string; sublabel: string | null }> }) {
  return (
    <select name="grid_owner_id" className="h-11 rounded-2xl border border-slate-300 bg-white px-4 text-sm">
      <option value="">Välj nätägare</option>
      {gridOwners.map((owner) => (
        <option key={owner.id} value={owner.id}>
          {owner.label}{owner.sublabel ? ` — ${owner.sublabel}` : ''}
        </option>
      ))}
    </select>
  )
}

export default async function CustomerInfoRequestsPage() {
  const admin = await requireAdminPageKeyAccess('customer.info_requests')
  const supabase = await createSupabaseServerClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  const scope = user ? await getOperationalCompanyScope(user.id) : null
  const companyId = scope?.companyId ?? null

  const [customers, requests, authorizationScopes, permissions, resourceOptions] = companyId
    ? await Promise.all([
        listCustomersForInfoRequestSelector(companyId),
        listCustomerInfoRequests(companyId),
        listAuthorizationScopes(companyId),
        listMeteringPermissions(companyId),
        listCustomerInfoRequestResourceOptions(companyId),
      ])
    : [[], [], [], [], { sites: [], meteringPoints: [], gridOwners: [] }]

  const blockedRequests = requests.filter((request) => ['blocked', 'route_missing', 'negative_aperak', 'manual_review_required', 'missing_authorization'].includes(request.status))
  const activeScopes = authorizationScopes.filter((scopeRow) => scopeRow.status === 'active')
  const activePermissions = permissions.filter((permission) => ['approved', 'active', 'z14_received'].includes(permission.status))

  return (
    <div className="min-h-screen">
      <AdminHeader
        title="Uppgiftsbegäran och fullmakter"
        subtitle="Skapa kontroller mot nätägare, dokumentera fullmaktens omfattning och förbered mätvärdestillstånd utan att blanda ihop Z01/Z02 med Z13/Z14."
        userEmail={admin.email}
      />

      <div className="space-y-6 p-8">
        {!companyId ? (
          <section className="rounded-3xl border border-amber-200 bg-amber-50 p-6 text-sm text-amber-900">
            Kontot saknar aktiv bolagskoppling. Koppla användaren till ett bolag innan uppgiftsbegäran kan skapas.
          </section>
        ) : null}

        <section className="grid gap-4 lg:grid-cols-4">
          <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="text-sm font-medium text-slate-700">Uppgiftsbegäran</div>
            <div className="mt-2 text-3xl font-semibold text-slate-950">{requests.length}</div>
            <p className="mt-2 text-xs text-slate-600">Z01/Z02, manuell bindningskontroll och kund-/anläggningsdata.</p>
          </div>
          <div className="rounded-3xl border border-emerald-200 bg-emerald-50 p-5 shadow-sm">
            <div className="text-sm font-medium text-emerald-800">Aktiva fullmaktsomfattningar</div>
            <div className="mt-2 text-3xl font-semibold text-slate-950">{activeScopes.length}</div>
            <p className="mt-2 text-xs text-emerald-900">Kontrolleras innan data begärs.</p>
          </div>
          <div className="rounded-3xl border border-emerald-200 bg-emerald-50 p-5 shadow-sm">
            <div className="text-sm font-medium text-emerald-800">Aktiva mätvärdestillstånd</div>
            <div className="mt-2 text-3xl font-semibold text-slate-950">{activePermissions.length}</div>
            <p className="mt-2 text-xs text-emerald-900">Z14-godkända anläggningar.</p>
          </div>
          <div className="rounded-3xl border border-red-200 bg-red-50 p-5 shadow-sm">
            <div className="text-sm font-medium text-red-800">Blockerade ärenden</div>
            <div className="mt-2 text-3xl font-semibold text-slate-950">{blockedRequests.length}</div>
            <p className="mt-2 text-xs text-red-900">Kräver manuell åtgärd.</p>
          </div>
        </section>

        <section className="grid gap-6 xl:grid-cols-3">
          <form action={createCustomerInfoRequestAction} className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-emerald-800">Z01/Z02 och avtalsdata</p>
            <h2 className="mt-2 text-lg font-semibold text-slate-950">Skapa uppgiftsbegäran</h2>
            <p className="mt-2 text-sm leading-6 text-slate-700">Använd för anläggningsuppgifter, nätområde, årsenergi och separat manuell kontroll av bindningstid/uppsägningstid.</p>
            <div className="mt-5 grid gap-4">
              <SelectCustomer customers={customers} />
              <SelectSite sites={resourceOptions.sites} />
              <SelectMeteringPoint meteringPoints={resourceOptions.meteringPoints} />
              <SelectGridOwner gridOwners={resourceOptions.gridOwners} />
              <div className="rounded-2xl border border-emerald-100 bg-emerald-50 px-4 py-3 text-xs leading-5 text-emerald-900">
                För Z01/Z02 ska anläggning, mätpunkt och nätägare vara valda eller kunna härledas från kundens data. Annars blockeras begäran med tydlig åtgärd.
              </div>
              <select name="request_type" defaultValue="z01_customer_masterdata" className="h-11 rounded-2xl border border-slate-300 bg-white px-4 text-sm">
                <option value="z01_customer_masterdata">Z01/Z02 - kund och anläggningskontroll</option>
                <option value="current_supplier_contract_check">Bindning/uppsägning hos nuvarande elhandlare</option>
                <option value="manual_customer_document_check">Manuell kunddokumentation</option>
              </select>
              <select name="target_party_type" defaultValue="grid_owner" className="h-11 rounded-2xl border border-slate-300 bg-white px-4 text-sm">
                <option value="grid_owner">Nätägare</option>
                <option value="current_supplier">Nuvarande elhandlare</option>
                <option value="customer">Kund</option>
              </select>
              <input name="target_party_name" placeholder="Motpart, t.ex. nätägare eller nuvarande elhandlare" className="h-11 rounded-2xl border border-slate-300 px-4 text-sm" />
              <input name="current_supplier_name" placeholder="Nuvarande elhandlare, om känd" className="h-11 rounded-2xl border border-slate-300 px-4 text-sm" />
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
              <textarea name="notes" rows={3} placeholder="Intern notering" className="rounded-2xl border border-slate-300 px-4 py-3 text-sm" />
              <button className="rounded-2xl bg-emerald-700 px-4 py-3 text-sm font-semibold text-white hover:bg-emerald-800">Skapa uppgiftsbegäran</button>
            </div>
          </form>

          <form action={createAuthorizationScopeAction} className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-emerald-800">Fullmaktsmotor</p>
            <h2 className="mt-2 text-lg font-semibold text-slate-950">Dokumentera omfattning</h2>
            <p className="mt-2 text-sm leading-6 text-slate-700">Fullmakten ska visa vad bolaget får begära och mot vem. Den här posten används som blockerare innan Z01/Z13-flöden körs.</p>
            <div className="mt-5 grid gap-4">
              <SelectCustomer customers={customers} />
              <select name="scope_type" defaultValue="customer_onboarding" className="h-11 rounded-2xl border border-slate-300 bg-white px-4 text-sm">
                <option value="customer_onboarding">Kundonboarding</option>
                <option value="metering_data_access">Mätvärdesåtkomst</option>
                <option value="supplier_contract_check">Kontroll hos nuvarande elhandlare</option>
              </select>
              <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-700">
                <div className="font-semibold text-slate-950">Fullmakten täcker</div>
                <div className="mt-3 grid gap-2">
                  <label className="flex items-center gap-2"><input type="checkbox" name="covers_grid_owner_data" /> Nätägarens anläggnings-/kunddata</label>
                  <label className="flex items-center gap-2"><input type="checkbox" name="covers_current_supplier_contract" /> Bindning/uppsägning hos nuvarande elhandlare</label>
                  <label className="flex items-center gap-2"><input type="checkbox" name="covers_metering_data" /> Mätvärden via Z13/Z14</label>
                </div>
              </div>
              <div className="grid gap-3 md:grid-cols-2">
                <input name="valid_from" type="date" className="h-11 rounded-2xl border border-slate-300 px-4 text-sm" />
                <input name="valid_to" type="date" className="h-11 rounded-2xl border border-slate-300 px-4 text-sm" />
              </div>
              <textarea name="evidence_note" rows={3} placeholder="Signeringsmetod, bilaga, muntlig fullmakt eller bevisnotering" className="rounded-2xl border border-slate-300 px-4 py-3 text-sm" />
              <button className="rounded-2xl bg-emerald-700 px-4 py-3 text-sm font-semibold text-white hover:bg-emerald-800">Spara omfattning</button>
            </div>
          </form>

          <form action={createMeteringPermissionDraftAction} className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-emerald-800">Z13/Z14</p>
            <h2 className="mt-2 text-lg font-semibold text-slate-950">Förbered mätvärdestillstånd</h2>
            <p className="mt-2 text-sm leading-6 text-slate-700">Skapar ett kontrollerat tillståndsutkast. Mätvärden ska bara kopplas till anläggningar som senare godkänns i Z14.</p>
            <div className="mt-5 grid gap-4">
              <SelectCustomer customers={customers} />
              <input name="site_id" placeholder="Anläggning/site-id, om känd" className="h-11 rounded-2xl border border-slate-300 px-4 text-sm" />
              <input name="metering_point_id" placeholder="Mätpunkt-id, om känd" className="h-11 rounded-2xl border border-slate-300 px-4 text-sm" />
              <input name="case_reference" placeholder="Ärendereferens/RFF+LI, om känd" className="h-11 rounded-2xl border border-slate-300 px-4 text-sm" />
              <div className="grid gap-3 md:grid-cols-2">
                <input name="requested_start_date" type="date" className="h-11 rounded-2xl border border-slate-300 px-4 text-sm" />
                <input name="requested_end_date" type="date" className="h-11 rounded-2xl border border-slate-300 px-4 text-sm" />
              </div>
              <label className="flex items-start gap-3 rounded-2xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-700">
                <input type="checkbox" name="authorization_confirmed" className="mt-1" />
                <span>Fullmakt/avtal är kontrollerad och täcker mätvärdesbegäran.</span>
              </label>
              <button className="rounded-2xl bg-emerald-700 px-4 py-3 text-sm font-semibold text-white hover:bg-emerald-800">Skapa tillståndsutkast</button>
            </div>
          </form>
        </section>

        <section className="grid gap-6 xl:grid-cols-3">
          <div className="rounded-3xl border border-slate-200 bg-white shadow-sm">
            <div className="border-b border-slate-200 px-6 py-5">
              <h2 className="text-lg font-semibold text-slate-950">Senaste uppgiftsbegäran</h2>
              <p className="mt-1 text-sm text-slate-700">Separera nätägaruppgifter från bindning/uppsägning hos befintlig leverantör.</p>
            </div>
            <div className="space-y-3 p-6">
              {requests.length === 0 ? <div className="rounded-2xl border border-dashed p-6 text-center text-sm text-slate-600">Inga uppgiftsbegäran ännu.</div> : requests.slice(0, 12).map((request) => (
                <div key={request.id} className="rounded-2xl border border-slate-200 p-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className={`rounded-full border px-3 py-1 text-xs font-semibold ${statusTone(request.status)}`}>{statusLabel(request.status)}</span>
                    <Link href={`/admin/customers/${request.customer_id}`} className="text-xs font-semibold text-emerald-800 hover:underline">Öppna kund</Link>
                  </div>
                  <div className="mt-3 text-sm font-semibold text-slate-950">{requestTypeLabel(request.request_type)}</div>
                  <div className="mt-1 text-xs leading-5 text-slate-600">{targetPartyLabel(request.target_party_type)}{request.target_party_name ? ` · ${request.target_party_name}` : ''}</div>
                  {request.blocker_reason ? <div className="mt-2 rounded-xl bg-red-50 px-3 py-2 text-xs text-red-800">{request.blocker_reason}</div> : null}
                  <form action={queueCustomerInfoRequestAction} className="mt-3">
                    <input type="hidden" name="request_id" value={request.id} />
                    <button className="w-full rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs font-semibold text-emerald-800 hover:bg-emerald-100">
                      Kontrollera fullmakt och förbered Z01
                    </button>
                  </form>
                </div>
              ))}
            </div>
          </div>

          <div className="rounded-3xl border border-slate-200 bg-white shadow-sm">
            <div className="border-b border-slate-200 px-6 py-5">
              <h2 className="text-lg font-semibold text-slate-950">Fullmaktsomfattning</h2>
              <p className="mt-1 text-sm text-slate-700">Aktiva scope-poster som blockerar eller tillåter dataflöden.</p>
            </div>
            <div className="space-y-3 p-6">
              {authorizationScopes.length === 0 ? <div className="rounded-2xl border border-dashed p-6 text-center text-sm text-slate-600">Ingen omfattning sparad ännu.</div> : authorizationScopes.slice(0, 12).map((scopeRow) => (
                <div key={scopeRow.id} className="rounded-2xl border border-slate-200 p-4">
                  <span className={`rounded-full border px-3 py-1 text-xs font-semibold ${statusTone(scopeRow.status)}`}>{scopeRow.status}</span>
                  <div className="mt-3 text-sm font-semibold text-slate-950">{scopeRow.scope_type}</div>
                  <div className="mt-2 flex flex-wrap gap-2 text-xs text-slate-700">
                    {scopeRow.covers_grid_owner_data ? <span className="rounded-full bg-slate-100 px-2 py-1">Nätdata</span> : null}
                    {scopeRow.covers_current_supplier_contract ? <span className="rounded-full bg-slate-100 px-2 py-1">Bindning</span> : null}
                    {scopeRow.covers_metering_data ? <span className="rounded-full bg-slate-100 px-2 py-1">Mätvärden</span> : null}
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="rounded-3xl border border-slate-200 bg-white shadow-sm">
            <div className="border-b border-slate-200 px-6 py-5">
              <h2 className="text-lg font-semibold text-slate-950">Mätvärdestillstånd</h2>
              <p className="mt-1 text-sm text-slate-700">Z13/Z14-spårning per kund/anläggning.</p>
            </div>
            <div className="space-y-3 p-6">
              {permissions.length === 0 ? <div className="rounded-2xl border border-dashed p-6 text-center text-sm text-slate-600">Inga mätvärdestillstånd ännu.</div> : permissions.slice(0, 12).map((permission) => (
                <div key={permission.id} className="rounded-2xl border border-slate-200 p-4">
                  <span className={`rounded-full border px-3 py-1 text-xs font-semibold ${statusTone(permission.status)}`}>{permission.status}</span>
                  <div className="mt-3 text-sm font-semibold text-slate-950">{permission.case_reference ?? permission.permission_reference ?? 'Tillståndsutkast'}</div>
                  <div className="mt-1 text-xs leading-5 text-slate-600">{permission.requested_start_date ?? 'Start saknas'} → {permission.requested_end_date ?? 'tills vidare'}</div>
                  {permission.last_blocker ? <div className="mt-2 rounded-xl bg-amber-50 px-3 py-2 text-xs text-amber-900">{permission.last_blocker}</div> : null}
                  <div className="mt-3 grid gap-2">
                    <form action={queueMeteringPermissionZ13Action}>
                      <input type="hidden" name="permission_id" value={permission.id} />
                      <button className="w-full rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs font-semibold text-emerald-800 hover:bg-emerald-100">
                        Kontrollera fullmakt och förbered Z13
                      </button>
                    </form>
                    <details className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                      <summary className="cursor-pointer text-xs font-semibold text-slate-700">Registrera Z14-svar manuellt</summary>
                      <form action={applyZ14SnapshotAction} className="mt-3 grid gap-2">
                        <input type="hidden" name="permission_id" value={permission.id} />
                        <input name="permission_reference" placeholder="Tillståndets id/RFF+Z09" className="h-9 rounded-lg border border-slate-300 px-3 text-xs" />
                        <div className="grid gap-2 md:grid-cols-2">
                          <input name="approved_start_date" type="date" className="h-9 rounded-lg border border-slate-300 px-3 text-xs" />
                          <input name="approved_end_date" type="date" className="h-9 rounded-lg border border-slate-300 px-3 text-xs" />
                        </div>
                        <div className="grid gap-2 md:grid-cols-2">
                          <input name="facility_id" placeholder="Anläggnings-id/LIN" className="h-9 rounded-lg border border-slate-300 px-3 text-xs" />
                          <input name="grid_area_code" placeholder="Nätområde/RFF+Z05" className="h-9 rounded-lg border border-slate-300 px-3 text-xs" />
                        </div>
                        <input name="resolution_code" placeholder="Tidslängd, t.ex. 15 min" className="h-9 rounded-lg border border-slate-300 px-3 text-xs" />
                        <input name="report_frequency" placeholder="Rapporteringsfrekvens" className="h-9 rounded-lg border border-slate-300 px-3 text-xs" />
                        <select name="site_status" defaultValue="approved" className="h-9 rounded-lg border border-slate-300 bg-white px-3 text-xs">
                          <option value="approved">Godkänd</option>
                          <option value="rejected">Nekad</option>
                        </select>
                        <button className="rounded-lg bg-slate-900 px-3 py-2 text-xs font-semibold text-white">Spara Z14-status</button>
                      </form>
                    </details>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>
      </div>
    </div>
  )
}
