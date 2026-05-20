import Link from 'next/link'
import { redirect } from 'next/navigation'
import AdminHeader from '@/components/admin/AdminHeader'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { requireAdminPageAccess } from '@/lib/admin/guards'
import {
  getCompanyStatusCopy,
  listCompanyGovernanceSummaries,
  type CompanyOperationalStatus,
} from '@/lib/tenant/governance'
import {
  createCompanyAction,
  deleteTestCompanyAction,
  inviteCompanyUserAction,
  requestCompanyDeletionAction,
  setCompanyOperationalStatusAction,
  type CompanyActionState,
} from './actions'

export const dynamic = 'force-dynamic'

const emptyCompanyActionState: CompanyActionState = { ok: false, message: '' }

type SearchParamsValue = string | string[] | undefined
type CompaniesPageProps = {
  searchParams?: Promise<Record<string, SearchParamsValue>> | Record<string, SearchParamsValue>
}

function firstParam(value: SearchParamsValue): string | null {
  if (Array.isArray(value)) return value[0] ?? null
  return value ?? null
}

function redirectWithResult(result: CompanyActionState) {
  const params = new URLSearchParams()
  params.set(result.ok ? 'success' : 'error', result.message || (result.ok ? 'Åtgärden genomfördes.' : 'Åtgärden misslyckades.'))
  redirect(`/admin/companies?${params.toString()}`)
}

async function createCompanyFormAction(formData: FormData) {
  'use server'
  redirectWithResult(await createCompanyAction(emptyCompanyActionState, formData))
}

async function inviteCompanyUserFormAction(formData: FormData) {
  'use server'
  redirectWithResult(await inviteCompanyUserAction(emptyCompanyActionState, formData))
}

async function setCompanyStatusFormAction(formData: FormData) {
  'use server'
  redirectWithResult(await setCompanyOperationalStatusAction(emptyCompanyActionState, formData))
}

async function requestCompanyDeletionFormAction(formData: FormData) {
  'use server'
  redirectWithResult(await requestCompanyDeletionAction(emptyCompanyActionState, formData))
}

async function deleteTestCompanyFormAction(formData: FormData) {
  'use server'
  redirectWithResult(await deleteTestCompanyAction(emptyCompanyActionState, formData))
}

function formatDate(value: string | null | undefined) {
  if (!value) return '–'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleString('sv-SE')
}

function StatusBadge({ status }: { status: CompanyOperationalStatus }) {
  const copy = getCompanyStatusCopy(status)
  return <span className={`whitespace-nowrap rounded-full border px-3 py-1 text-xs font-semibold ${copy.tone}`}>{copy.label}</span>
}

function FlashMessage({ success, error }: { success: string | null; error: string | null }) {
  if (!success && !error) return null

  return (
    <div
      className={
        success
          ? 'rounded-3xl border border-emerald-200 bg-emerald-50 px-5 py-4 text-sm font-medium text-emerald-900 shadow-sm'
          : 'rounded-3xl border border-red-200 bg-red-50 px-5 py-4 text-sm font-medium text-red-900 shadow-sm'
      }
    >
      {success ?? error}
    </div>
  )
}

function GovernanceActionForm({
  companyId,
  status,
  label,
  reasonLabel,
  reasonPlaceholder,
  danger = false,
}: {
  companyId: string
  status: CompanyOperationalStatus
  label: string
  reasonLabel: string
  reasonPlaceholder: string
  danger?: boolean
}) {
  return (
    <form
      action={setCompanyStatusFormAction}
      className="grid gap-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm md:grid-cols-[minmax(0,1fr)_170px] md:items-end"
    >
      <input type="hidden" name="company_id" value={companyId} />
      <input type="hidden" name="next_status" value={status} />
      <label className="grid min-w-0 gap-2 text-xs font-medium text-slate-700">
        <span>{reasonLabel}</span>
        <input
          name="reason"
          required={status !== 'active'}
          placeholder={reasonPlaceholder}
          className="min-w-0 rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-900 outline-none focus:border-emerald-700 focus:ring-2 focus:ring-emerald-100"
        />
      </label>
      <button
        type="submit"
        className={
          danger
            ? 'h-11 w-full rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm font-semibold text-red-800 hover:bg-red-100'
            : 'h-11 w-full rounded-xl border border-slate-300 bg-slate-50 px-3 py-2 text-sm font-semibold text-slate-800 hover:bg-slate-100'
        }
      >
        {label}
      </button>
    </form>
  )
}

function MetricCard({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-slate-50 p-3">
      <p className="text-xs text-slate-700">{label}</p>
      <p className="mt-1 truncate text-xl font-semibold text-slate-950">{value}</p>
    </div>
  )
}

export default async function CompaniesPage({ searchParams }: CompaniesPageProps) {
  const params = searchParams ? await Promise.resolve(searchParams) : {}
  const success = firstParam(params.success)
  const error = firstParam(params.error)

  const admin = await requireAdminPageAccess({ anyOf: ['tenants.read', 'tenants.write', 'users.read'] })
  const supabase = await createSupabaseServerClient()
  const [companies, { data: auth }] = await Promise.all([listCompanyGovernanceSummaries(), supabase.auth.getUser()])

  const pausedCount = companies.filter((company) => company.status === 'paused').length
  const blockedCount = companies.filter(
    (company) => !company.canHardDelete || company.missingEdielProfile || company.blockedBillingUnderlays > 0
  ).length
  const activeCount = companies.filter((company) => company.status === 'active' || company.status === 'onboarding').length

  return (
    <div className="min-h-screen">
      <AdminHeader
        title="Elhandelsbolag"
        subtitle="Superadmin-yta för bolag, driftstatus, användare och säker radering. Paus och avstängning stoppar ny drift men bevarar historik."
        userEmail={auth.user?.email ?? admin.email ?? null}
      />

      <div className="mx-auto max-w-[1800px] space-y-6 p-4 sm:p-6 lg:p-8">
        <FlashMessage success={success} error={error} />

        <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
            <p className="text-sm font-medium text-slate-700">Bolag</p>
            <p className="mt-2 text-3xl font-semibold text-slate-950">{companies.length}</p>
            <p className="mt-2 text-sm text-slate-700">Registrerade tenants i plattformen.</p>
          </div>
          <div className="rounded-3xl border border-emerald-200 bg-emerald-50 p-6 shadow-sm">
            <p className="text-sm font-medium text-emerald-700">Aktiva/onboarding</p>
            <p className="mt-2 text-3xl font-semibold text-emerald-950">{activeCount}</p>
            <p className="mt-2 text-sm text-emerald-800">Kan skapa kunder, Ediel, switchar och exporter.</p>
          </div>
          <div className="rounded-3xl border border-amber-200 bg-amber-50 p-6 shadow-sm">
            <p className="text-sm font-medium text-amber-700">Pausade</p>
            <p className="mt-2 text-3xl font-semibold text-amber-950">{pausedCount}</p>
            <p className="mt-2 text-sm text-amber-800">Ny drift är stoppad men historik bevaras.</p>
          </div>
          <div className="rounded-3xl border border-orange-200 bg-orange-50 p-6 shadow-sm">
            <p className="text-sm font-medium text-orange-700">Blockerare</p>
            <p className="mt-2 text-3xl font-semibold text-orange-950">{blockedCount}</p>
            <p className="mt-2 text-sm text-orange-800">Saknad Ediel-profil, exportblockerare eller historik som stoppar hård radering.</p>
          </div>
        </section>

        <div className="grid gap-6 2xl:grid-cols-[460px_minmax(0,1fr)]">
          <section className="h-fit rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
            <h2 className="text-lg font-semibold text-slate-950">Skapa nytt bolag</h2>
            <p className="mt-1 text-sm leading-6 text-slate-700">
              Detta skapar ett nytt elhandelsbolag på plattformen. Första bolagsansvarig kopplas som ägare och kan därefter bjuda in sitt team.
            </p>

            <form action={createCompanyFormAction} className="mt-6 space-y-4">
              <label className="grid gap-2 text-sm">
                <span className="font-medium text-slate-700">Bolagsnamn</span>
                <input name="name" required className="rounded-2xl border border-slate-300 px-4 py-3" placeholder="Ex. Exempel Energi AB" />
              </label>

              <div className="grid gap-4 md:grid-cols-2">
                <label className="grid gap-2 text-sm">
                  <span className="font-medium text-slate-700">Organisationsnummer</span>
                  <input name="org_number" className="rounded-2xl border border-slate-300 px-4 py-3" />
                </label>
                <label className="grid gap-2 text-sm">
                  <span className="font-medium text-slate-700">Kortnamn</span>
                  <input name="slug" className="rounded-2xl border border-slate-300 px-4 py-3" placeholder="Skapas automatiskt om tomt" />
                </label>
              </div>

              <label className="grid gap-2 text-sm">
                <span className="font-medium text-slate-700">Kontaktperson</span>
                <input name="primary_contact_name" className="rounded-2xl border border-slate-300 px-4 py-3" />
              </label>

              <label className="grid gap-2 text-sm">
                <span className="font-medium text-slate-700">Kontakt e-post</span>
                <input name="primary_contact_email" type="email" className="rounded-2xl border border-slate-300 px-4 py-3" />
              </label>

              <div className="grid gap-4 md:grid-cols-2">
                <label className="grid gap-2 text-sm">
                  <span className="font-medium text-slate-700">Telefon</span>
                  <input name="phone" className="rounded-2xl border border-slate-300 px-4 py-3" />
                </label>
                <label className="grid gap-2 text-sm">
                  <span className="font-medium text-slate-700">Webbplats</span>
                  <input name="website" className="rounded-2xl border border-slate-300 px-4 py-3" />
                </label>
              </div>

              <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                <h3 className="text-sm font-semibold text-slate-900">Första bolagsansvarig</h3>
                <p className="mt-1 text-xs leading-5 text-slate-700">
                  Personen får bolagskoppling och rollen Bolagsansvarig. Lämna tomt om du vill skapa bolaget först.
                </p>
                <div className="mt-4 grid gap-4">
                  <input name="admin_name" className="rounded-2xl border border-slate-300 px-4 py-3" placeholder="Namn" />
                  <input name="admin_email" type="email" className="rounded-2xl border border-slate-300 px-4 py-3" placeholder="namn@bolag.se" />
                  <label className="flex items-center gap-3 text-sm text-slate-700">
                    <input type="checkbox" name="send_invite" defaultChecked />
                    Skicka inbjudan via e-post
                  </label>
                </div>
              </div>

              <button className="w-full rounded-2xl bg-emerald-700 px-4 py-3 text-sm font-semibold text-white hover:bg-emerald-800">
                Skapa bolag
              </button>
            </form>
          </section>

          <section className="space-y-6">
            <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
              <div className="flex flex-wrap items-center justify-between gap-4">
                <div>
                  <h2 className="text-lg font-semibold text-slate-950">Bolag på plattformen</h2>
                  <p className="mt-1 text-sm text-slate-700">{companies.length} registrerade bolag med tenant-governance.</p>
                </div>
              </div>

              <div className="mt-5 space-y-5">
                {companies.length === 0 ? (
                  <p className="py-8 text-sm text-slate-700">Inga bolag är skapade ännu.</p>
                ) : (
                  companies.map((company) => {
                    const copy = getCompanyStatusCopy(company.status)
                    const hasOperationalBlockers = company.missingEdielProfile || company.blockedBillingUnderlays > 0

                    return (
                      <article key={company.id} className="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm">
                        <div className="space-y-5 p-5 lg:p-6">
                          <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
                            <div className="min-w-0">
                              <div className="flex flex-wrap items-center gap-3">
                                <h3 className="break-words text-lg font-semibold text-slate-950">{company.name}</h3>
                                <StatusBadge status={company.status} />
                                {hasOperationalBlockers ? (
                                  <span className="rounded-full border border-orange-200 bg-orange-50 px-3 py-1 text-xs font-semibold text-orange-800">
                                    Kräver kontroll
                                  </span>
                                ) : null}
                              </div>
                              <p className="mt-1 break-all text-sm text-slate-700">
                                {company.org_number ?? 'Organisationsnummer saknas'} · {company.slug ?? 'Kortnamn saknas'} · {company.id}
                              </p>
                              <p className="mt-2 max-w-4xl text-sm leading-6 text-slate-700">{copy.description}</p>
                              {company.status_reason ? (
                                <p className="mt-2 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-2 text-sm text-slate-700">
                                  Senaste anledning: {company.status_reason}
                                </p>
                              ) : null}
                            </div>

                            <div className="flex flex-wrap gap-2">
                              <Link
                                href={`/admin/companies/${company.id}/users`}
                                className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                              >
                                Användare
                              </Link>
                              <Link
                                href="/admin/ediel/settings"
                                className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                              >
                                Ediel-profil
                              </Link>
                              <Link href="/admin/audit" className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50">
                                Audit log
                              </Link>
                            </div>
                          </div>

                          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-6">
                            <MetricCard label="Användare" value={company.activeUsers} />
                            <MetricCard label="Kunder" value={company.customers} />
                            <MetricCard label="Ediel" value={company.edielMessages} />
                            <MetricCard label="Mätvärden" value={company.meteringValues} />
                            <MetricCard label="Exporter" value={company.partnerExports} />
                            <MetricCard label="Senaste aktivitet" value={formatDate(company.latestAuditAt ?? company.latestEdielAt)} />
                          </div>

                          {hasOperationalBlockers || company.deleteBlockers.length > 0 ? (
                            <div className="grid gap-3 lg:grid-cols-2">
                              <div className="rounded-2xl border border-orange-200 bg-orange-50 p-4">
                                <h4 className="text-sm font-semibold text-orange-950">Öppna blockerare</h4>
                                <ul className="mt-2 space-y-1 text-sm text-orange-800">
                                  {company.missingEdielProfile ? <li>Saknar aktiv Ediel-aktörsprofil.</li> : null}
                                  {company.blockedBillingUnderlays > 0 ? <li>{company.blockedBillingUnderlays} faktureringsunderlag kräver kontroll.</li> : null}
                                  {company.deleteBlockers.length > 0 ? <li>Hård radering blockeras av historiska kopplingar.</li> : null}
                                </ul>
                              </div>
                              <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                                <h4 className="text-sm font-semibold text-slate-950">Raderingskontroll</h4>
                                <p className="mt-2 text-sm leading-6 text-slate-700">
                                  {company.canHardDelete
                                    ? 'Bolaget saknar historiska kopplingar och kan raderas som test-/felregistrering.'
                                    : company.deleteBlockers.map((blocker) => `${blocker.label}: ${blocker.count}`).join(' · ')}
                                </p>
                              </div>
                            </div>
                          ) : null}

                          <section className="rounded-3xl border border-slate-200 bg-slate-50 p-4">
                            <div className="max-w-3xl">
                              <h4 className="text-sm font-semibold text-slate-950">Driftstatus</h4>
                              <p className="mt-1 text-sm leading-6 text-slate-700">
                                Pausa eller stäng av drift utan att radera historik. Återaktivering öppnar för ny drift igen.
                              </p>
                            </div>
                            <div className="mt-4 grid gap-3">
                              <GovernanceActionForm
                                companyId={company.id}
                                status="paused"
                                label="Pausa bolag"
                                reasonLabel="Anledning till paus"
                                reasonPlaceholder="Ex. saknad onboarding, kreditkontroll eller driftstopp"
                              />
                              <GovernanceActionForm
                                companyId={company.id}
                                status="active"
                                label="Återaktivera"
                                reasonLabel="Anledning, valfritt"
                                reasonPlaceholder="Ex. blockerare åtgärdad"
                              />
                              <GovernanceActionForm
                                companyId={company.id}
                                status="suspended"
                                label="Stäng av"
                                reasonLabel="Anledning till avstängning"
                                reasonPlaceholder="Ex. avtalsbrott eller permanent stopp"
                                danger
                              />
                              <GovernanceActionForm
                                companyId={company.id}
                                status="archived"
                                label="Arkivera"
                                reasonLabel="Anledning till arkivering"
                                reasonPlaceholder="Ex. avslutad kund eller historisk tenant"
                              />
                            </div>
                          </section>

                          <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
                            <section className="rounded-3xl border border-slate-200 bg-slate-50 p-4">
                              <h4 className="text-sm font-semibold text-slate-950">Bjud in användare</h4>
                              <form action={inviteCompanyUserFormAction} className="mt-3 grid gap-3 md:grid-cols-2 xl:grid-cols-[minmax(180px,1fr)_minmax(160px,1fr)_150px_150px_120px]">
                                <input type="hidden" name="company_id" value={company.id} />
                                <input name="email" type="email" className="min-w-0 rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm" placeholder="bjud in e-post" />
                                <input name="full_name" className="min-w-0 rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm" placeholder="namn" />
                                <select name="membership_role" defaultValue="admin" className="min-w-0 rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm">
                                  <option value="owner">Ägare</option>
                                  <option value="admin">Admin</option>
                                  <option value="operations">Operations</option>
                                  <option value="support">Support</option>
                                  <option value="viewer">Viewer</option>
                                </select>
                                <select name="role_key" defaultValue="company_admin" className="min-w-0 rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm">
                                  <option value="company_admin">Bolagsadmin</option>
                                  <option value="operations">Operations</option>
                                  <option value="support">Support</option>
                                  <option value="viewer">Viewer</option>
                                </select>
                                <button className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-100">Bjud in</button>
                              </form>
                            </section>

                            <section className="rounded-3xl border border-red-200 bg-red-50 p-4">
                              <h4 className="text-sm font-semibold text-red-950">Radera testbolag</h4>
                              <p className="mt-1 text-sm leading-6 text-red-800">
                                Hård radering används bara för test-/felregistrering utan operativ historik. Metadata som inbjudningar och governance-loggar rensas automatiskt.
                              </p>
                              <form action={deleteTestCompanyFormAction} className="mt-3 grid gap-3">
                                <input type="hidden" name="company_id" value={company.id} />
                                <input
                                  name="reason"
                                  placeholder="Ex. testbolag skapat fel"
                                  className="rounded-xl border border-red-200 bg-white px-3 py-2 text-sm text-slate-800 outline-none focus:border-red-500"
                                />
                                <button className="rounded-xl border border-red-200 bg-white px-3 py-2 text-sm font-semibold text-red-800 hover:bg-red-100">
                                  Radera testbolag
                                </button>
                              </form>
                            </section>
                          </div>

                          <section className="rounded-3xl border border-orange-200 bg-orange-50 p-4">
                            <h4 className="text-sm font-semibold text-orange-950">Begär radering</h4>
                            <p className="mt-1 text-sm leading-6 text-orange-800">Använd detta när bolaget har historik och ska gå igenom kontrollerad raderings-/arkiveringsprocess.</p>
                            <form action={requestCompanyDeletionFormAction} className="mt-3 grid gap-3 md:grid-cols-[minmax(0,1fr)_180px] md:items-end">
                              <input type="hidden" name="company_id" value={company.id} />
                              <label className="grid gap-2 text-xs font-medium text-orange-900">
                                <span>Anledning till raderingsbegäran</span>
                                <input
                                  name="reason"
                                  required
                                  placeholder="Ex. kunden avslutad, begäran från bolag eller felregistrering med historik"
                                  className="min-w-0 rounded-xl border border-orange-200 bg-white px-3 py-2.5 text-sm text-slate-800 outline-none focus:border-orange-500"
                                />
                              </label>
                              <button className="h-11 rounded-xl border border-orange-200 bg-white px-3 py-2 text-sm font-semibold text-orange-800 hover:bg-orange-100">
                                Begär radering
                              </button>
                            </form>
                          </section>
                        </div>
                      </article>
                    )
                  })
                )}
              </div>
            </div>
          </section>
        </div>
      </div>
    </div>
  )
}
