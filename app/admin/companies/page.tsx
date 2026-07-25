import Link from 'next/link'
import { redirect } from 'next/navigation'
import AdminHeader from '@/components/admin/AdminHeader'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { requirePlatformAdminAccess } from '@/lib/admin/guards'
import {
  getCompanyStatusCopy,
  listCompanyGovernanceSummaries,
  type CompanyOperationalStatus,
} from '@/lib/tenant/governance'
import {
  createCompanyAction,
  deleteTestCompanyAction,
  requestCompanyDeletionAction,
  setCompanyOperationalStatusAction,
} from './actions'

export const dynamic = 'force-dynamic'

const emptyCompanyActionState = { ok: false, message: '' }

type ActionSearchParams = Record<string, string | string[] | undefined>

function firstSearchValue(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value
}

function buildCompaniesActionRedirect(result: { ok: boolean; message: string }) {
  const key = result.ok ? 'success' : 'error'
  const message = result.message || (result.ok ? 'Åtgärden sparades.' : 'Åtgärden kunde inte sparas.')
  return `/admin/companies?${key}=${encodeURIComponent(message)}`
}

function ActionBanner({ success, error }: { success?: string; error?: string }) {
  if (!success && !error) return null

  return (
    <div
      className={
        success
          ? 'rounded-2xl border border-emerald-200 bg-emerald-50 p-4 text-sm font-semibold text-emerald-900'
          : 'rounded-2xl border border-red-200 bg-red-50 p-4 text-sm font-semibold text-red-900'
      }
    >
      {success ?? error}
    </div>
  )
}

async function createCompanyFormAction(formData: FormData) {
  'use server'
  const result = await createCompanyAction(emptyCompanyActionState, formData)
  redirect(buildCompaniesActionRedirect(result))
}

async function setCompanyStatusFormAction(formData: FormData) {
  'use server'
  const result = await setCompanyOperationalStatusAction(emptyCompanyActionState, formData)
  redirect(buildCompaniesActionRedirect(result))
}

async function requestCompanyDeletionFormAction(formData: FormData) {
  'use server'
  const result = await requestCompanyDeletionAction(emptyCompanyActionState, formData)
  redirect(buildCompaniesActionRedirect(result))
}

async function deleteTestCompanyFormAction(formData: FormData) {
  'use server'
  const result = await deleteTestCompanyAction(emptyCompanyActionState, formData)
  redirect(buildCompaniesActionRedirect(result))
}

function formatDate(value: string | null | undefined) {
  if (!value) return '–'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleString('sv-SE')
}

function StatusBadge({ status }: { status: CompanyOperationalStatus }) {
  const copy = getCompanyStatusCopy(status)
  return <span className={`inline-flex rounded-full border px-3 py-1 text-xs font-semibold ${copy.tone}`}>{copy.label}</span>
}

function StatBox({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="min-w-0 rounded-2xl border border-slate-200 bg-slate-50 p-3">
      <p className="truncate text-xs font-semibold text-slate-600">{label}</p>
      <p className="mt-1 truncate text-xl font-black text-slate-950">{value}</p>
    </div>
  )
}

function GovernanceActionForm({
  companyId,
  status,
  label,
  reasonPlaceholder,
  danger = false,
}: {
  companyId: string
  status: CompanyOperationalStatus
  label: string
  reasonPlaceholder: string
  danger?: boolean
}) {
  return (
    <form action={setCompanyStatusFormAction} className="grid gap-2 rounded-2xl border border-slate-200 bg-white p-3">
      <input type="hidden" name="company_id" value={companyId} />
      <input type="hidden" name="next_status" value={status} />
      <input
        name="reason"
        required={status !== 'active'}
        placeholder={reasonPlaceholder}
        className="min-w-0 rounded-xl border border-slate-300 bg-white px-3 py-2 text-xs text-slate-800 outline-none focus:border-emerald-700"
      />
      <button
        className={
          danger
            ? 'rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs font-semibold text-red-800 hover:bg-red-100'
            : 'rounded-xl border border-slate-300 bg-slate-50 px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-100'
        }
      >
        {label}
      </button>
    </form>
  )
}

export default async function CompaniesPage({
  searchParams,
}: {
  searchParams?: Promise<ActionSearchParams>
}) {
  const resolvedSearchParams = searchParams ? await searchParams : {}
  const actionSuccess = firstSearchValue(resolvedSearchParams.success)
  const actionError = firstSearchValue(resolvedSearchParams.error)

  const admin = await requirePlatformAdminAccess()
  const supabase = await createSupabaseServerClient()
  const [companies, { data: auth }] = await Promise.all([
    listCompanyGovernanceSummaries(),
    supabase.auth.getUser(),
  ])

  const pausedCount = companies.filter((company) => company.status === 'paused').length
  const blockedCount = companies.filter((company) => !company.canHardDelete || company.missingEdielProfile || company.blockedBillingUnderlays > 0).length
  const activeCount = companies.filter((company) => company.status === 'active' || company.status === 'onboarding').length

  return (
    <div className="min-h-screen">
      <AdminHeader
        title="Bolag på plattformen"
        subtitle="Endast superadmin. Här skapas, pausas och granskas tenants. Vanliga elbolag ska aldrig kunna se eller onboarda andra bolag."
        userEmail={auth.user?.email ?? admin.email ?? null}
      />

      <div className="space-y-6 p-4 sm:p-6 xl:p-8">
        <ActionBanner success={actionSuccess} error={actionError} />

        <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <StatBox label="Bolag" value={companies.length} />
          <StatBox label="Aktiva/onboarding" value={activeCount} />
          <StatBox label="Pausade" value={pausedCount} />
          <StatBox label="Blockerare" value={blockedCount} />
        </section>

        <section className="grid gap-6 xl:grid-cols-[minmax(320px,420px)_minmax(0,1fr)]">
          <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
            <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm leading-6 text-amber-900">
              Den här formen är platform-only. Company admin ska använda <strong>Bolagsinställningar</strong> för sitt eget bolag och ska aldrig skapa tenants här.
            </div>

            <h2 className="mt-5 text-lg font-semibold text-slate-950">Skapa nytt elhandelsbolag</h2>
            <p className="mt-1 text-sm leading-6 text-slate-700">
              Skapa tenant, koppla första bolagsansvarig och sätt temporärt lösenord.
            </p>

            <form action={createCompanyFormAction} className="mt-5 space-y-4">
              <label className="grid gap-2 text-sm">
                <span className="font-medium text-slate-700">Bolagsnamn</span>
                <input name="name" required className="min-w-0 rounded-2xl border border-slate-300 px-4 py-3" placeholder="Ex. Exempel Energi AB" />
              </label>

              <div className="grid gap-4 md:grid-cols-2">
                <label className="grid gap-2 text-sm">
                  <span className="font-medium text-slate-700">Organisationsnummer</span>
                  <input name="org_number" className="min-w-0 rounded-2xl border border-slate-300 px-4 py-3" />
                </label>
                <label className="grid gap-2 text-sm">
                  <span className="font-medium text-slate-700">Kortnamn</span>
                  <input name="slug" className="min-w-0 rounded-2xl border border-slate-300 px-4 py-3" placeholder="Skapas automatiskt" />
                </label>
              </div>

              <label className="grid gap-2 text-sm">
                <span className="font-medium text-slate-700">Kundnummerprefix</span>
                <input name="customer_number_prefix" className="min-w-0 rounded-2xl border border-slate-300 px-4 py-3 uppercase" placeholder="Ex. DX, GDX eller NIB" />
                <span className="text-xs leading-5 text-slate-500">Valfritt. Används för kundnummer som DX-100001 per bolag. Om fältet lämnas tomt skapas prefix från bolagets namn.</span>
              </label>

              <label className="grid gap-2 text-sm">
                <span className="font-medium text-slate-700">Kontaktperson</span>
                <input name="primary_contact_name" className="min-w-0 rounded-2xl border border-slate-300 px-4 py-3" />
              </label>

              <label className="grid gap-2 text-sm">
                <span className="font-medium text-slate-700">Kontakt e-post</span>
                <input name="primary_contact_email" type="email" className="min-w-0 rounded-2xl border border-slate-300 px-4 py-3" />
              </label>

              <div className="grid gap-4 md:grid-cols-2">
                <input name="phone" className="min-w-0 rounded-2xl border border-slate-300 px-4 py-3 text-sm" placeholder="Telefon" />
                <input name="website" className="min-w-0 rounded-2xl border border-slate-300 px-4 py-3 text-sm" placeholder="Webbplats" />
              </div>

              <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                <h3 className="text-sm font-semibold text-slate-900">Första bolagsansvarig</h3>
                <div className="mt-4 grid gap-3">
                  <input name="admin_name" className="min-w-0 rounded-2xl border border-slate-300 px-4 py-3 text-sm" placeholder="Namn" />
                  <input name="admin_email" type="email" className="min-w-0 rounded-2xl border border-slate-300 px-4 py-3 text-sm" placeholder="namn@bolag.se" />
                  <input name="temporary_password" type="text" minLength={8} className="min-w-0 rounded-2xl border border-slate-300 px-4 py-3 text-sm" placeholder="Temporärt lösenord" />
                </div>
              </div>

              <button className="w-full rounded-2xl bg-emerald-700 px-4 py-3 text-sm font-semibold text-white hover:bg-emerald-800">
                Skapa bolag
              </button>
            </form>
          </div>

          <div className="min-w-0 space-y-4">
            <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
              <h2 className="text-lg font-semibold text-slate-950">Registrerade bolag</h2>
              <p className="mt-1 text-sm text-slate-700">Korten är byggda för att inte spräcka layouten även med långa namn, orgnummer eller id:n.</p>
            </div>

            {companies.length === 0 ? (
              <div className="rounded-3xl border border-dashed border-slate-300 bg-white p-8 text-sm text-slate-700">Inga bolag är skapade ännu.</div>
            ) : (
              <div className="grid min-w-0 gap-4 2xl:grid-cols-2">
                {companies.map((company) => {
                  const copy = getCompanyStatusCopy(company.status)
                  const hasOperationalBlockers = company.missingEdielProfile || company.blockedBillingUnderlays > 0

                  return (
                    <article key={company.id} className="min-w-0 overflow-hidden rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
                      <div className="min-w-0 space-y-3">
                        <div className="flex min-w-0 flex-wrap items-center gap-2">
                          <h3 className="min-w-0 max-w-full break-words text-lg font-semibold text-slate-950">{company.name}</h3>
                          <StatusBadge status={company.status} />
                          {hasOperationalBlockers ? (
                            <span className="inline-flex rounded-full border border-orange-200 bg-orange-50 px-3 py-1 text-xs font-semibold text-orange-800">Kräver kontroll</span>
                          ) : null}
                        </div>

                        <p className="break-words text-sm text-slate-700">
                          {company.org_number ?? 'Organisationsnummer saknas'} · {company.slug ?? 'Kortnamn saknas'} · Kundnummerprefix {company.customer_number_prefix ?? 'auto'}
                        </p>
                        <p className="break-all rounded-2xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600">ID: {company.id}</p>
                        <p className="text-sm leading-6 text-slate-700">{copy.description}</p>
                      </div>

                      <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                        <StatBox label="Användare" value={company.activeUsers} />
                        <StatBox label="Kunder" value={company.customers} />
                        <StatBox label="Ediel" value={company.edielMessages} />
                        <StatBox label="Mätvärden" value={company.meteringValues} />
                        <StatBox label="Exporter" value={company.partnerExports} />
                        <StatBox label="Senaste" value={formatDate(company.latestAuditAt ?? company.latestEdielAt)} />
                      </div>

                      {company.status_reason ? (
                        <p className="mt-4 break-words rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700">
                          Senaste anledning: {company.status_reason}
                        </p>
                      ) : null}

                      {hasOperationalBlockers || company.deleteBlockers.length > 0 ? (
                        <div className="mt-4 rounded-2xl border border-orange-200 bg-orange-50 p-4">
                          <h4 className="text-sm font-semibold text-orange-950">Blockerare</h4>
                          <ul className="mt-2 space-y-1 text-sm text-orange-800">
                            {company.missingEdielProfile ? <li>Saknar aktiv Ediel-aktörsprofil.</li> : null}
                            {company.blockedBillingUnderlays > 0 ? <li>{company.blockedBillingUnderlays} faktureringsunderlag kräver kontroll.</li> : null}
                            {company.deleteBlockers.length > 0 ? <li>{company.deleteBlockers.map((blocker) => `${blocker.label}: ${blocker.count}`).join(' · ')}</li> : null}
                          </ul>
                        </div>
                      ) : null}

                      <div className="mt-5 flex flex-wrap gap-2">
                        <Link href={`/admin/companies/${company.id}`} className="rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs font-semibold text-emerald-800 hover:bg-emerald-100">
                          Översikt & statistik
                        </Link>
                        <Link href={`/admin/companies/${company.id}/users`} className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50">
                          Användare
                        </Link>
                        <Link href="/admin/platform/ediel/routes" className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50">
                          Routes
                        </Link>
                        <Link href="/admin/audit" className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50">
                          Audit
                        </Link>
                      </div>

                      <details className="mt-5 rounded-2xl border border-slate-200 bg-slate-50 p-4">
                        <summary className="cursor-pointer text-sm font-semibold text-slate-900">Governance-åtgärder</summary>
                        <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                          <GovernanceActionForm companyId={company.id} status="paused" label="Pausa" reasonPlaceholder="Anledning till paus" />
                          <GovernanceActionForm companyId={company.id} status="active" label="Återaktivera" reasonPlaceholder="Anledning, valfritt" />
                          <GovernanceActionForm companyId={company.id} status="suspended" label="Stäng av" reasonPlaceholder="Anledning till avstängning" danger />
                          <GovernanceActionForm companyId={company.id} status="closed" label="Stäng tenant terminalt" reasonPlaceholder="Obligatorisk stängningsorsak" danger />
                          <GovernanceActionForm companyId={company.id} status="archived" label="Arkivera" reasonPlaceholder="Anledning till arkivering" />
                          <form action={requestCompanyDeletionFormAction} className="grid gap-2 rounded-2xl border border-orange-200 bg-orange-50 p-3">
                            <input type="hidden" name="company_id" value={company.id} />
                            <input name="reason" required placeholder="Anledning" className="min-w-0 rounded-xl border border-orange-200 bg-white px-3 py-2 text-xs text-slate-800 outline-none focus:border-orange-500" />
                            <button className="rounded-xl border border-orange-200 bg-white px-3 py-2 text-xs font-semibold text-orange-800 hover:bg-orange-100">Begär radering</button>
                          </form>
                          <form action={deleteTestCompanyFormAction} className="grid gap-2 rounded-2xl border border-red-200 bg-red-50 p-3">
                            <input type="hidden" name="company_id" value={company.id} />
                            <input name="reason" placeholder="Endast test/felregistrering" className="min-w-0 rounded-xl border border-red-200 bg-white px-3 py-2 text-xs text-slate-800 outline-none focus:border-red-500" />
                            <button className="rounded-xl border border-red-200 bg-white px-3 py-2 text-xs font-semibold text-red-800 hover:bg-red-100">Radera testbolag</button>
                          </form>
                        </div>
                      </details>
                    </article>
                  )
                })}
              </div>
            )}
          </div>
        </section>
      </div>
    </div>
  )
}
