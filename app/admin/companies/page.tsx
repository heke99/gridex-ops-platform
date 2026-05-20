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
  return <span className={`inline-flex rounded-full border px-3 py-1 text-xs font-semibold ${copy.tone}`}>{copy.label}</span>
}

function inputClassName(extra = '') {
  return `min-w-0 rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-emerald-700 ${extra}`
}

function ActionLink({ href, children, primary = false }: { href: string; children: React.ReactNode; primary?: boolean }) {
  return (
    <Link
      href={href}
      className={
        primary
          ? 'inline-flex justify-center rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs font-semibold text-emerald-800 hover:bg-emerald-100'
          : 'inline-flex justify-center rounded-xl border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50'
      }
    >
      {children}
    </Link>
  )
}

function StatTile({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="min-w-0 rounded-2xl border border-slate-200 bg-slate-50 p-3">
      <p className="truncate text-xs font-medium text-slate-700">{label}</p>
      <p className="mt-1 break-words text-xl font-semibold text-slate-950">{value}</p>
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
    <form action={setCompanyStatusFormAction} className="grid min-w-0 gap-2 rounded-2xl border border-slate-200 bg-white p-3">
      <input type="hidden" name="company_id" value={companyId} />
      <input type="hidden" name="next_status" value={status} />
      <input name="reason" required={status !== 'active'} placeholder={reasonPlaceholder} className={inputClassName('text-xs')} />
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

export default async function CompaniesPage() {
  const admin = await requirePlatformAdminAccess()
  const supabase = await createSupabaseServerClient()
  const [companies, { data: auth }] = await Promise.all([
    listCompanyGovernanceSummaries(),
    supabase.auth.getUser(),
  ])

  const pausedCount = companies.filter((company) => company.status === 'paused').length
  const blockedCount = companies.filter(
    (company) => !company.canHardDelete || company.missingEdielProfile || company.blockedBillingUnderlays > 0
  ).length
  const activeCount = companies.filter((company) => company.status === 'active' || company.status === 'onboarding').length

  return (
    <div className="min-h-screen">
      <AdminHeader
        title="Elhandelsbolag"
        subtitle="Superadmin-yta för bolag, driftstatus, användare och säker radering. Layouten är byggd för långa namn, orgnummer och många actions utan att korten spricker."
        userEmail={auth.user?.email ?? admin.email ?? null}
      />

      <div className="space-y-6 p-4 sm:p-6 xl:p-8">
        <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <StatTile label="Bolag" value={companies.length} />
          <StatTile label="Aktiva/onboarding" value={activeCount} />
          <StatTile label="Pausade" value={pausedCount} />
          <StatTile label="Blockerare" value={blockedCount} />
        </section>

        <details className="rounded-3xl border border-slate-200 bg-white shadow-sm">
          <summary className="cursor-pointer list-none px-6 py-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="text-lg font-semibold text-slate-950">Skapa nytt bolag</h2>
                <p className="mt-1 text-sm leading-6 text-slate-700">Öppna formuläret när du vill lägga upp ett nytt tenant-bolag.</p>
              </div>
              <span className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-2 text-sm font-semibold text-emerald-800">Öppna/stäng</span>
            </div>
          </summary>

          <form action={createCompanyFormAction} className="grid gap-4 border-t border-slate-100 px-6 pb-6 pt-5 lg:grid-cols-2">
            <label className="grid gap-2 text-sm">
              <span className="font-medium text-slate-700">Bolagsnamn</span>
              <input name="name" required className={inputClassName('px-4 py-3')} placeholder="Ex. Exempel Energi AB" />
            </label>
            <label className="grid gap-2 text-sm">
              <span className="font-medium text-slate-700">Organisationsnummer</span>
              <input name="org_number" className={inputClassName('px-4 py-3')} />
            </label>
            <label className="grid gap-2 text-sm">
              <span className="font-medium text-slate-700">Kortnamn</span>
              <input name="slug" className={inputClassName('px-4 py-3')} placeholder="Skapas automatiskt om tomt" />
            </label>
            <label className="grid gap-2 text-sm">
              <span className="font-medium text-slate-700">Kontaktperson</span>
              <input name="primary_contact_name" className={inputClassName('px-4 py-3')} />
            </label>
            <label className="grid gap-2 text-sm">
              <span className="font-medium text-slate-700">Kontakt e-post</span>
              <input name="primary_contact_email" type="email" className={inputClassName('px-4 py-3')} />
            </label>
            <label className="grid gap-2 text-sm">
              <span className="font-medium text-slate-700">Telefon</span>
              <input name="phone" className={inputClassName('px-4 py-3')} />
            </label>
            <label className="grid gap-2 text-sm">
              <span className="font-medium text-slate-700">Webbplats</span>
              <input name="website" className={inputClassName('px-4 py-3')} />
            </label>
            <div className="grid gap-3 rounded-2xl border border-slate-200 bg-slate-50 p-4 lg:col-span-2 lg:grid-cols-3">
              <div className="lg:col-span-3">
                <h3 className="text-sm font-semibold text-slate-900">Första bolagsansvarig</h3>
                <p className="mt-1 text-xs leading-5 text-slate-700">Skapas direkt i Supabase Auth med temporärt lösenord.</p>
              </div>
              <input name="admin_name" className={inputClassName()} placeholder="Namn" />
              <input name="admin_email" type="email" className={inputClassName()} placeholder="namn@bolag.se" />
              <input name="temporary_password" type="text" minLength={8} className={inputClassName()} placeholder="Temporärt lösenord" />
            </div>
            <div className="flex justify-end lg:col-span-2">
              <button className="rounded-2xl bg-emerald-700 px-5 py-3 text-sm font-semibold text-white hover:bg-emerald-800">Skapa bolag</button>
            </div>
          </form>
        </details>

        <section className="rounded-3xl border border-slate-200 bg-white shadow-sm">
          <div className="border-b border-slate-100 px-6 py-5">
            <h2 className="text-lg font-semibold text-slate-950">Bolag på plattformen</h2>
            <p className="mt-1 text-sm text-slate-700">{companies.length} registrerade bolag med tenant-governance.</p>
          </div>

          <div className="grid gap-4 p-4 xl:grid-cols-2 2xl:grid-cols-3">
            {companies.length === 0 ? (
              <p className="rounded-2xl border border-dashed border-slate-300 p-8 text-sm text-slate-700 xl:col-span-2 2xl:col-span-3">Inga bolag är skapade ännu.</p>
            ) : (
              companies.map((company) => {
                const copy = getCompanyStatusCopy(company.status)
                const hasOperationalBlockers = company.missingEdielProfile || company.blockedBillingUnderlays > 0

                return (
                  <article key={company.id} className="flex min-w-0 flex-col overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm">
                    <div className="min-w-0 space-y-4 p-5">
                      <div className="flex min-w-0 flex-col gap-3">
                        <div className="flex min-w-0 flex-wrap items-center gap-2">
                          <h3 className="min-w-0 break-words text-lg font-semibold text-slate-950">{company.name}</h3>
                          <StatusBadge status={company.status} />
                          {hasOperationalBlockers ? (
                            <span className="rounded-full border border-orange-200 bg-orange-50 px-3 py-1 text-xs font-semibold text-orange-800">Kräver kontroll</span>
                          ) : null}
                        </div>
                        <p className="break-all text-xs leading-5 text-slate-600">
                          {company.org_number ?? 'Organisationsnummer saknas'} · {company.slug ?? 'Kortnamn saknas'} · {company.id}
                        </p>
                        <p className="text-sm leading-6 text-slate-700">{copy.description}</p>
                        {company.status_reason ? (
                          <p className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-2 text-sm leading-6 text-slate-700">Senaste anledning: {company.status_reason}</p>
                        ) : null}
                      </div>

                      <div className="grid gap-2 sm:grid-cols-2">
                        <ActionLink href={`/admin/companies/${company.id}`} primary>Bolagsvy & statistik</ActionLink>
                        <ActionLink href={`/admin/companies/${company.id}/users`}>Användare</ActionLink>
                        <ActionLink href="/admin/ediel/settings">Ediel-profil</ActionLink>
                        <ActionLink href="/admin/audit">Audit log</ActionLink>
                      </div>

                      <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
                        <StatTile label="Användare" value={company.activeUsers} />
                        <StatTile label="Kunder" value={company.customers} />
                        <StatTile label="Ediel" value={company.edielMessages} />
                        <StatTile label="Mätvärden" value={company.meteringValues} />
                        <StatTile label="Exporter" value={company.partnerExports} />
                        <StatTile label="Senaste aktivitet" value={formatDate(company.latestAuditAt ?? company.latestEdielAt)} />
                      </div>

                      {(hasOperationalBlockers || company.deleteBlockers.length > 0) ? (
                        <div className="grid gap-3">
                          <div className="rounded-2xl border border-orange-200 bg-orange-50 p-4">
                            <h4 className="text-sm font-semibold text-orange-950">Öppna blockerare</h4>
                            <ul className="mt-2 space-y-1 text-sm leading-6 text-orange-800">
                              {company.missingEdielProfile ? <li>Saknar aktiv Ediel-aktörsprofil.</li> : null}
                              {company.blockedBillingUnderlays > 0 ? <li>{company.blockedBillingUnderlays} faktureringsunderlag kräver kontroll.</li> : null}
                              {company.deleteBlockers.length > 0 ? <li>Hård radering blockeras av historiska kopplingar.</li> : null}
                            </ul>
                          </div>
                          <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                            <h4 className="text-sm font-semibold text-slate-950">Raderingskontroll</h4>
                            <p className="mt-2 break-words text-sm leading-6 text-slate-700">
                              {company.canHardDelete
                                ? 'Bolaget saknar historiska kopplingar och kan raderas som test-/felregistrering.'
                                : company.deleteBlockers.map((blocker) => `${blocker.label}: ${blocker.count}`).join(' · ')}
                            </p>
                          </div>
                        </div>
                      ) : null}
                    </div>

                    <div className="mt-auto space-y-3 border-t border-slate-100 bg-slate-50 p-4">
                      <details className="rounded-2xl border border-slate-200 bg-white">
                        <summary className="cursor-pointer px-4 py-3 text-sm font-semibold text-slate-800">Driftåtgärder</summary>
                        <div className="grid gap-3 border-t border-slate-100 p-3 sm:grid-cols-2">
                          <GovernanceActionForm companyId={company.id} status="paused" label="Pausa bolag" reasonPlaceholder="Anledning till paus" />
                          <GovernanceActionForm companyId={company.id} status="active" label="Återaktivera" reasonPlaceholder="Anledning, valfritt" />
                          <GovernanceActionForm companyId={company.id} status="suspended" label="Stäng av" reasonPlaceholder="Anledning till avstängning" danger />
                          <GovernanceActionForm companyId={company.id} status="archived" label="Arkivera" reasonPlaceholder="Anledning till arkivering" />
                          <form action={requestCompanyDeletionFormAction} className="grid gap-2 rounded-2xl border border-orange-200 bg-orange-50 p-3 sm:col-span-2">
                            <input type="hidden" name="company_id" value={company.id} />
                            <input name="reason" required placeholder="Anledning till raderingsbegäran" className={inputClassName('text-xs')} />
                            <button className="rounded-xl border border-orange-200 bg-white px-3 py-2 text-xs font-semibold text-orange-800 hover:bg-orange-100">Begär radering</button>
                          </form>
                        </div>
                      </details>

                      <details className="rounded-2xl border border-slate-200 bg-white">
                        <summary className="cursor-pointer px-4 py-3 text-sm font-semibold text-slate-800">Lägg till användare / test-radera</summary>
                        <div className="grid gap-3 border-t border-slate-100 p-3">
                          <form action={inviteCompanyUserFormAction} className="grid min-w-0 gap-2 md:grid-cols-2">
                            <input type="hidden" name="company_id" value={company.id} />
                            <input name="email" type="email" className={inputClassName('text-xs')} placeholder="bjud in e-post" />
                            <input name="full_name" className={inputClassName('text-xs')} placeholder="namn" />
                            <input name="temporary_password" type="text" minLength={8} required className={inputClassName('text-xs')} placeholder="temporärt lösenord" />
                            <select name="membership_role" defaultValue="admin" className={inputClassName('text-xs')}>
                              <option value="owner">Ägare</option>
                              <option value="admin">Admin</option>
                              <option value="operations">Operations</option>
                              <option value="support">Support</option>
                              <option value="viewer">Viewer</option>
                            </select>
                            <input type="hidden" name="role_key" value="company_admin" />
                            <button className="rounded-xl border border-slate-300 bg-slate-50 px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-100 md:col-span-2">Lägg till användare</button>
                          </form>

                          <form action={deleteTestCompanyFormAction} className="grid gap-2 rounded-2xl border border-red-200 bg-red-50 p-3">
                            <input type="hidden" name="company_id" value={company.id} />
                            <input name="reason" placeholder="Endast test/felregistrering" className={inputClassName('text-xs')} />
                            <button className="rounded-xl border border-red-200 bg-white px-3 py-2 text-xs font-semibold text-red-800 hover:bg-red-100">Radera testbolag</button>
                          </form>
                        </div>
                      </details>
                    </div>
                  </article>
                )
              })
            )}
          </div>
        </section>
      </div>
    </div>
  )
}
