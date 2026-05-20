import Link from 'next/link'
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
  inviteCompanyUserAction,
  requestCompanyDeletionAction,
  setCompanyOperationalStatusAction,
} from './actions'

export const dynamic = 'force-dynamic'

const emptyCompanyActionState = { ok: false, message: '' }

async function createCompanyFormAction(formData: FormData) {
  'use server'
  await createCompanyAction(emptyCompanyActionState, formData)
}

async function inviteCompanyUserFormAction(formData: FormData) {
  'use server'
  await inviteCompanyUserAction(emptyCompanyActionState, formData)
}

async function setCompanyStatusFormAction(formData: FormData) {
  'use server'
  await setCompanyOperationalStatusAction(emptyCompanyActionState, formData)
}

async function requestCompanyDeletionFormAction(formData: FormData) {
  'use server'
  await requestCompanyDeletionAction(emptyCompanyActionState, formData)
}

async function deleteTestCompanyFormAction(formData: FormData) {
  'use server'
  await deleteTestCompanyAction(emptyCompanyActionState, formData)
}

function formatDate(value: string | null | undefined) {
  if (!value) return '–'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleString('sv-SE')
}

function StatusBadge({ status }: { status: CompanyOperationalStatus }) {
  const copy = getCompanyStatusCopy(status)
  return (
    <span className={`rounded-full border px-3 py-1 text-xs font-semibold ${copy.tone}`}>
      {copy.label}
    </span>
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
    <form action={setCompanyStatusFormAction} className="grid gap-2 rounded-2xl border border-slate-200 bg-slate-50 p-3">
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
            : 'rounded-xl border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-100'
        }
      >
        {label}
      </button>
    </form>
  )
}

export default async function CompaniesPage() {
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
        title="Elhandelsbolag"
        subtitle="Superadmin-yta för bolag, driftstatus, användare och säker radering. Paus och avstängning stoppar ny drift men bevarar historik."
        userEmail={auth.user?.email ?? admin.email ?? null}
      />

      <div className="space-y-6 p-8">
        <section className="grid gap-4 xl:grid-cols-4">
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

        <div className="grid gap-6 xl:grid-cols-[460px_minmax(0,1fr)]">
          <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
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
                  <input name="temporary_password" type="text" minLength={8} className="rounded-2xl border border-slate-300 px-4 py-3" placeholder="Temporärt lösenord, minst 8 tecken" />
                  <p className="text-xs leading-5 text-slate-600">Användaren skapas direkt i Supabase Auth och loggar in med det temporära lösenordet. Vid första inloggning måste lösenordet bytas.</p>
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

              <div className="mt-5 space-y-4">
                {companies.length === 0 ? (
                  <p className="py-8 text-sm text-slate-700">Inga bolag är skapade ännu.</p>
                ) : (
                  companies.map((company) => {
                    const copy = getCompanyStatusCopy(company.status)
                    const hasOperationalBlockers = company.missingEdielProfile || company.blockedBillingUnderlays > 0

                    return (
                      <article key={company.id} className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
                        <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
                          <div className="min-w-0">
                            <div className="flex flex-wrap items-center gap-3">
                              <h3 className="text-lg font-semibold text-slate-950">{company.name}</h3>
                              <StatusBadge status={company.status} />
                              {hasOperationalBlockers ? (
                                <span className="rounded-full border border-orange-200 bg-orange-50 px-3 py-1 text-xs font-semibold text-orange-800">
                                  Kräver kontroll
                                </span>
                              ) : null}
                            </div>
                            <p className="mt-1 text-sm text-slate-700">
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
                            <Link href={`/admin/companies/${company.id}`} className="rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs font-semibold text-emerald-800 hover:bg-emerald-100">
                              Bolagsvy & statistik
                            </Link>
                            <Link href={`/admin/companies/${company.id}/users`} className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50">
                              Användare
                            </Link>
                            <Link href="/admin/ediel/settings" className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50">
                              Ediel-profil
                            </Link>
                            <Link href="/admin/audit" className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50">
                              Audit log
                            </Link>
                          </div>
                        </div>

                        <div className="mt-5 grid gap-3 md:grid-cols-2 xl:grid-cols-6">
                          <div className="rounded-2xl border border-slate-200 bg-slate-50 p-3">
                            <p className="text-xs text-slate-700">Användare</p>
                            <p className="mt-1 text-xl font-semibold text-slate-950">{company.activeUsers}</p>
                          </div>
                          <div className="rounded-2xl border border-slate-200 bg-slate-50 p-3">
                            <p className="text-xs text-slate-700">Kunder</p>
                            <p className="mt-1 text-xl font-semibold text-slate-950">{company.customers}</p>
                          </div>
                          <div className="rounded-2xl border border-slate-200 bg-slate-50 p-3">
                            <p className="text-xs text-slate-700">Ediel</p>
                            <p className="mt-1 text-xl font-semibold text-slate-950">{company.edielMessages}</p>
                          </div>
                          <div className="rounded-2xl border border-slate-200 bg-slate-50 p-3">
                            <p className="text-xs text-slate-700">Mätvärden</p>
                            <p className="mt-1 text-xl font-semibold text-slate-950">{company.meteringValues}</p>
                          </div>
                          <div className="rounded-2xl border border-slate-200 bg-slate-50 p-3">
                            <p className="text-xs text-slate-700">Exporter</p>
                            <p className="mt-1 text-xl font-semibold text-slate-950">{company.partnerExports}</p>
                          </div>
                          <div className="rounded-2xl border border-slate-200 bg-slate-50 p-3">
                            <p className="text-xs text-slate-700">Senaste aktivitet</p>
                            <p className="mt-1 text-xs font-semibold text-slate-950">{formatDate(company.latestAuditAt ?? company.latestEdielAt)}</p>
                          </div>
                        </div>

                        {hasOperationalBlockers || company.deleteBlockers.length > 0 ? (
                          <div className="mt-4 grid gap-3 lg:grid-cols-2">
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
                              <p className="mt-2 text-sm text-slate-700">
                                {company.canHardDelete
                                  ? 'Bolaget saknar historiska kopplingar och kan raderas som test-/felregistrering.'
                                  : company.deleteBlockers.map((blocker) => `${blocker.label}: ${blocker.count}`).join(' · ')}
                              </p>
                            </div>
                          </div>
                        ) : null}

                        <div className="mt-5 grid gap-3 xl:grid-cols-5">
                          <GovernanceActionForm companyId={company.id} status="paused" label="Pausa bolag" reasonPlaceholder="Anledning till paus" />
                          <GovernanceActionForm companyId={company.id} status="active" label="Återaktivera" reasonPlaceholder="Anledning, valfritt" />
                          <GovernanceActionForm companyId={company.id} status="suspended" label="Stäng av" reasonPlaceholder="Anledning till avstängning" danger />
                          <GovernanceActionForm companyId={company.id} status="archived" label="Arkivera" reasonPlaceholder="Anledning till arkivering" />
                          <form action={requestCompanyDeletionFormAction} className="grid gap-2 rounded-2xl border border-orange-200 bg-orange-50 p-3">
                            <input type="hidden" name="company_id" value={company.id} />
                            <input name="reason" required placeholder="Anledning till raderingsbegäran" className="rounded-xl border border-orange-200 bg-white px-3 py-2 text-xs text-slate-800 outline-none focus:border-orange-500" />
                            <button className="rounded-xl border border-orange-200 bg-white px-3 py-2 text-xs font-semibold text-orange-800 hover:bg-orange-100">
                              Begär radering
                            </button>
                          </form>
                        </div>

                        <div className="mt-5 grid gap-3 lg:grid-cols-[minmax(0,1fr)_260px]">
                          <form action={inviteCompanyUserFormAction} className="grid gap-2 rounded-2xl border border-slate-200 bg-slate-50 p-3 md:grid-cols-2 xl:grid-cols-[1fr_1fr_190px_150px_140px]">
                            <input type="hidden" name="company_id" value={company.id} />
                            <input name="email" type="email" className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-xs" placeholder="bjud in e-post" />
                            <input name="full_name" className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-xs" placeholder="namn" />
                            <input name="temporary_password" type="text" minLength={8} required className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-xs" placeholder="temporärt lösenord" />
                            <select name="membership_role" defaultValue="admin" className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-xs">
                              <option value="owner">Ägare</option>
                              <option value="admin">Admin</option>
                              <option value="operations">Operations</option>
                              <option value="support">Support</option>
                              <option value="viewer">Viewer</option>
                            </select>
                            <input type="hidden" name="role_key" value="company_admin" />
                            <button className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-100">
                              Lägg till
                            </button>
                          </form>

                          <form action={deleteTestCompanyFormAction} className="grid gap-2 rounded-2xl border border-red-200 bg-red-50 p-3">
                            <input type="hidden" name="company_id" value={company.id} />
                            <input name="reason" placeholder="Endast test/felregistrering" className="rounded-xl border border-red-200 bg-white px-3 py-2 text-xs text-slate-800 outline-none focus:border-red-500" />
                            <button className="rounded-xl border border-red-200 bg-white px-3 py-2 text-xs font-semibold text-red-800 hover:bg-red-100">
                              Radera testbolag
                            </button>
                          </form>
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
