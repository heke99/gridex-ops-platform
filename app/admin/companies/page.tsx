import Link from 'next/link'
import AdminHeader from '@/components/admin/AdminHeader'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { requireAdminPageAccess } from '@/lib/admin/guards'
import {
  getCompanyStatusCopy,
  listCompanyGovernanceSummaries,
  type CompanyOperationalStatus,
} from '@/lib/tenant/governance'
import {
  anonymizeCompanyContactDetailsAction,
  createCompanyAction,
  deleteTestCompanyAction,
  inviteCompanyUserAction,
  requestCompanyDeletionAction,
  setCompanyOperationalStatusAction,
} from './actions'

export const dynamic = 'force-dynamic'

const emptyCompanyActionState = { ok: false, message: '' }

async function anonymizeCompanyContactDetailsFormAction(formData: FormData) {
  'use server'
  await anonymizeCompanyContactDetailsAction(emptyCompanyActionState, formData)
}

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
    <span className={`whitespace-nowrap rounded-full border px-3 py-1 text-xs font-semibold ${copy.tone}`}>
      {copy.label}
    </span>
  )
}

function TextInput({
  name,
  label,
  placeholder,
  type = 'text',
  required = false,
}: {
  name: string
  label: string
  placeholder?: string
  type?: string
  required?: boolean
}) {
  return (
    <label className="grid min-w-0 gap-2 text-sm">
      <span className="font-medium text-slate-700">{label}</span>
      <input
        name={name}
        type={type}
        required={required}
        placeholder={placeholder}
        className="min-w-0 rounded-2xl border border-slate-300 bg-white px-4 py-3 text-sm text-slate-900 outline-none transition focus:border-emerald-700 focus:ring-2 focus:ring-emerald-100"
      />
    </label>
  )
}

function StatCard({
  label,
  value,
  description,
  tone = 'slate',
}: {
  label: string
  value: number | string
  description: string
  tone?: 'slate' | 'emerald' | 'amber' | 'orange'
}) {
  const toneClass = {
    slate: 'border-slate-200 bg-white text-slate-950',
    emerald: 'border-emerald-200 bg-emerald-50 text-emerald-950',
    amber: 'border-amber-200 bg-amber-50 text-amber-950',
    orange: 'border-orange-200 bg-orange-50 text-orange-950',
  }[tone]

  return (
    <div className={`min-w-0 rounded-3xl border p-5 shadow-sm ${toneClass}`}>
      <p className="text-sm font-medium opacity-80">{label}</p>
      <p className="mt-2 text-3xl font-semibold">{value}</p>
      <p className="mt-2 text-sm leading-6 opacity-80">{description}</p>
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
      <input
        name="reason"
        required={status !== 'active'}
        placeholder={reasonPlaceholder}
        className="min-w-0 rounded-xl border border-slate-300 bg-white px-3 py-2 text-xs text-slate-800 outline-none focus:border-emerald-700"
      />
      <button
        className={
          danger
            ? 'w-full rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs font-semibold text-red-800 hover:bg-red-100'
            : 'w-full rounded-xl border border-slate-300 bg-slate-50 px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-100'
        }
      >
        {label}
      </button>
    </form>
  )
}

function SectionTitle({ title, description }: { title: string; description: string }) {
  return (
    <div className="min-w-0">
      <h3 className="text-sm font-semibold text-slate-950">{title}</h3>
      <p className="mt-1 text-xs leading-5 text-slate-600">{description}</p>
    </div>
  )
}

export default async function CompaniesPage() {
  const admin = await requireAdminPageAccess({ anyOf: ['tenants.read', 'tenants.write', 'users.read'] })
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
    <div className="min-h-screen bg-slate-50/60">
      <AdminHeader
        title="Elhandelsbolag"
        subtitle="Superadmin-yta för bolag, driftstatus, användare och säker radering. Paus och avstängning stoppar ny drift men bevarar historik."
        userEmail={auth.user?.email ?? admin.email ?? null}
      />

      <main className="mx-auto w-full max-w-[1600px] space-y-6 px-4 py-6 sm:px-6 lg:px-8">
        <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <StatCard label="Bolag" value={companies.length} description="Registrerade tenants i plattformen." />
          <StatCard label="Aktiva/onboarding" value={activeCount} description="Kan skapa kunder, Ediel, switchar och exporter." tone="emerald" />
          <StatCard label="Pausade" value={pausedCount} description="Ny drift är stoppad men historik bevaras." tone="amber" />
          <StatCard label="Blockerare" value={blockedCount} description="Saknad Ediel-profil, exportblockerare eller raderingshistorik." tone="orange" />
        </section>

        <section className="grid gap-6 xl:grid-cols-[minmax(360px,460px)_minmax(0,1fr)]">
          <aside className="h-fit rounded-3xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
            <h2 className="text-lg font-semibold text-slate-950">Skapa nytt bolag</h2>
            <p className="mt-1 text-sm leading-6 text-slate-700">
              Skapa en tenant och koppla första bolagsansvarig. Personen får temporärt lösenord via e-post och måste byta lösenord vid första inloggning.
            </p>

            <form action={createCompanyFormAction} className="mt-6 space-y-5">
              <TextInput name="name" label="Bolagsnamn" placeholder="Ex. Exempel Energi AB" required />

              <div className="grid gap-4 md:grid-cols-2">
                <TextInput name="org_number" label="Organisationsnummer" placeholder="559000-0000" />
                <TextInput name="slug" label="Kortnamn" placeholder="Skapas automatiskt" />
              </div>

              <TextInput name="primary_contact_name" label="Kontaktperson" placeholder="Namn" />
              <TextInput name="primary_contact_email" label="Kontakt e-post" type="email" placeholder="kontakt@bolag.se" />

              <div className="grid gap-4 md:grid-cols-2">
                <TextInput name="phone" label="Telefon" placeholder="08-..." />
                <TextInput name="website" label="Webbplats" placeholder="https://..." />
              </div>

              <div className="rounded-2xl border border-emerald-100 bg-emerald-50/70 p-4">
                <SectionTitle
                  title="Första bolagsansvarig"
                  description="Ägaren får korrekt bolagsroll och inloggning med temporärt lösenord. Lösenordsbyte krävs vid första inloggning."
                />
                <div className="mt-4 grid gap-4">
                  <input
                    name="admin_name"
                    className="min-w-0 rounded-2xl border border-emerald-200 bg-white px-4 py-3 text-sm outline-none focus:border-emerald-700"
                    placeholder="Namn"
                  />
                  <input
                    name="admin_email"
                    type="email"
                    className="min-w-0 rounded-2xl border border-emerald-200 bg-white px-4 py-3 text-sm outline-none focus:border-emerald-700"
                    placeholder="namn@bolag.se"
                  />
                  <label className="flex min-w-0 items-start gap-3 rounded-2xl border border-emerald-100 bg-white px-4 py-3 text-sm text-slate-700">
                    <input type="checkbox" name="send_invite" defaultChecked className="mt-1" />
                    <span>Skicka inbjudan med temporärt lösenord.</span>
                  </label>
                </div>
              </div>

              <button className="w-full rounded-2xl bg-emerald-700 px-4 py-3 text-sm font-semibold text-white shadow-sm hover:bg-emerald-800">
                Skapa bolag
              </button>
            </form>
          </aside>

          <section className="min-w-0 space-y-5">
            <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div className="min-w-0">
                  <h2 className="text-lg font-semibold text-slate-950">Bolag på plattformen</h2>
                  <p className="mt-1 text-sm text-slate-700">{companies.length} registrerade bolag med tenant-governance.</p>
                </div>
              </div>
            </div>

            {companies.length === 0 ? (
              <div className="rounded-3xl border border-slate-200 bg-white p-8 text-sm text-slate-700 shadow-sm">
                Inga bolag är skapade ännu.
              </div>
            ) : (
              companies.map((company) => {
                const copy = getCompanyStatusCopy(company.status)
                const hasOperationalBlockers = company.missingEdielProfile || company.blockedBillingUnderlays > 0

                return (
                  <article key={company.id} className="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm">
                    <div className="border-b border-slate-100 p-5 sm:p-6">
                      <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-3">
                            <h3 className="min-w-0 break-words text-lg font-semibold text-slate-950">{company.name}</h3>
                            <StatusBadge status={company.status} />
                            {hasOperationalBlockers ? (
                              <span className="whitespace-nowrap rounded-full border border-orange-200 bg-orange-50 px-3 py-1 text-xs font-semibold text-orange-800">
                                Kräver kontroll
                              </span>
                            ) : null}
                          </div>
                          <p className="mt-1 break-all text-sm text-slate-700">
                            {company.org_number ?? 'Organisationsnummer saknas'} · {company.slug ?? 'Kortnamn saknas'} · {company.id}
                          </p>
                          <p className="mt-2 max-w-4xl text-sm leading-6 text-slate-700">{copy.description}</p>
                          {company.status_reason ? (
                            <p className="mt-3 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-2 text-sm text-slate-700">
                              Senaste anledning: {company.status_reason}
                            </p>
                          ) : null}
                        </div>

                        <div className="grid shrink-0 gap-2 sm:grid-cols-3 xl:w-[360px]">
                          <Link href={`/admin/companies/${company.id}/users`} className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-center text-xs font-semibold text-slate-700 hover:bg-slate-50">
                            Användare
                          </Link>
                          <Link href="/admin/ediel/settings" className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-center text-xs font-semibold text-slate-700 hover:bg-slate-50">
                            Ediel-profil
                          </Link>
                          <Link href="/admin/audit" className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-center text-xs font-semibold text-slate-700 hover:bg-slate-50">
                            Audit log
                          </Link>
                        </div>
                      </div>

                      <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-6">
                        <StatMini label="Användare" value={company.activeUsers} />
                        <StatMini label="Kunder" value={company.customers} />
                        <StatMini label="Ediel" value={company.edielMessages} />
                        <StatMini label="Mätvärden" value={company.meteringValues} />
                        <StatMini label="Exporter" value={company.partnerExports} />
                        <StatMini label="Senaste aktivitet" value={formatDate(company.latestAuditAt ?? company.latestEdielAt)} />
                      </div>
                    </div>

                    {hasOperationalBlockers || company.deleteBlockers.length > 0 ? (
                      <div className="grid gap-4 border-b border-slate-100 bg-orange-50/40 p-5 sm:p-6 lg:grid-cols-2">
                        <div className="rounded-2xl border border-orange-200 bg-orange-50 p-4">
                          <h4 className="text-sm font-semibold text-orange-950">Öppna blockerare</h4>
                          <ul className="mt-2 space-y-1 text-sm text-orange-800">
                            {company.missingEdielProfile ? <li>Saknar aktiv Ediel-aktörsprofil.</li> : null}
                            {company.blockedBillingUnderlays > 0 ? <li>{company.blockedBillingUnderlays} faktureringsunderlag kräver kontroll.</li> : null}
                            {company.deleteBlockers.length > 0 ? <li>Hård radering blockeras av historiska kopplingar.</li> : null}
                          </ul>
                        </div>
                        <div className="rounded-2xl border border-slate-200 bg-white p-4">
                          <h4 className="text-sm font-semibold text-slate-950">Raderingskontroll</h4>
                          <p className="mt-2 break-words text-sm leading-6 text-slate-700">
                            {company.canHardDelete
                              ? 'Bolaget saknar historiska kopplingar och kan raderas som test-/felregistrering.'
                              : company.deleteBlockers.map((blocker) => `${blocker.label}: ${blocker.count}`).join(' · ')}
                          </p>
                        </div>
                      </div>
                    ) : null}

                    <div className="grid gap-5 p-5 sm:p-6 2xl:grid-cols-[minmax(0,1fr)_minmax(360px,420px)]">
                      <div className="min-w-0 space-y-5">
                        <div className="rounded-3xl border border-slate-200 bg-slate-50 p-4">
                          <SectionTitle
                            title="Driftstatus"
                            description="Pausa eller stäng av drift utan att radera historik. Återaktivering öppnar för ny drift igen."
                          />
                          <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                            <GovernanceActionForm companyId={company.id} status="paused" label="Pausa bolag" reasonPlaceholder="Anledning till paus" />
                            <GovernanceActionForm companyId={company.id} status="active" label="Återaktivera" reasonPlaceholder="Anledning, valfritt" />
                            <GovernanceActionForm companyId={company.id} status="suspended" label="Stäng av" reasonPlaceholder="Anledning till avstängning" danger />
                            <GovernanceActionForm companyId={company.id} status="archived" label="Arkivera" reasonPlaceholder="Anledning till arkivering" />
                          </div>
                        </div>

                        <div className="rounded-3xl border border-slate-200 bg-slate-50 p-4">
                          <SectionTitle
                            title="Bjud in användare"
                            description="Inbjudan skapar/kopplar användaren, skickar temporärt lösenord och kräver lösenordsbyte vid första inloggning."
                          />
                          <form action={inviteCompanyUserFormAction} className="mt-4 grid gap-3 lg:grid-cols-[minmax(180px,1fr)_minmax(160px,1fr)_150px_160px_110px]">
                            <input type="hidden" name="company_id" value={company.id} />
                            <input name="email" type="email" className="min-w-0 rounded-xl border border-slate-300 bg-white px-3 py-2 text-xs" placeholder="bjud in e-post" required />
                            <input name="full_name" className="min-w-0 rounded-xl border border-slate-300 bg-white px-3 py-2 text-xs" placeholder="namn" />
                            <select name="membership_role" defaultValue="admin" className="min-w-0 rounded-xl border border-slate-300 bg-white px-3 py-2 text-xs">
                              <option value="owner">Ägare</option>
                              <option value="admin">Admin</option>
                              <option value="operations">Operations</option>
                              <option value="support">Support</option>
                              <option value="viewer">Viewer</option>
                            </select>
                            <select name="role_key" defaultValue="company_admin" className="min-w-0 rounded-xl border border-slate-300 bg-white px-3 py-2 text-xs">
                              <option value="company_admin">Company admin</option>
                              <option value="operations">Operations</option>
                              <option value="support">Support</option>
                              <option value="viewer">Viewer</option>
                            </select>
                            <button className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-100">
                              Bjud in
                            </button>
                          </form>
                        </div>
                      </div>

                      <div className="min-w-0 space-y-5">
                        <div className="rounded-3xl border border-orange-200 bg-orange-50 p-4">
                          <SectionTitle
                            title="Raderingsbegäran"
                            description="Markerar bolaget för radering men behåller historik tills kontrollerna är klara."
                          />
                          <form action={requestCompanyDeletionFormAction} className="mt-4 grid gap-3">
                            <input type="hidden" name="company_id" value={company.id} />
                            <input name="reason" required placeholder="Anledning till raderingsbegäran" className="min-w-0 rounded-xl border border-orange-200 bg-white px-3 py-2 text-xs text-slate-800 outline-none focus:border-orange-500" />
                            <button className="rounded-xl border border-orange-200 bg-white px-3 py-2 text-xs font-semibold text-orange-800 hover:bg-orange-100">
                              Begär radering
                            </button>
                          </form>
                        </div>

                        <div className="rounded-3xl border border-slate-200 bg-slate-50 p-4">
                          <SectionTitle
                            title="Anonymisera kontakt"
                            description="Tar bort kontaktuppgifter och återkallar öppna inbjudningar utan att förstöra historik."
                          />
                          <form action={anonymizeCompanyContactDetailsFormAction} className="mt-4 grid gap-3">
                            <input type="hidden" name="company_id" value={company.id} />
                            <input name="reason" required placeholder="Anledning till anonymisering" className="min-w-0 rounded-xl border border-slate-300 bg-white px-3 py-2 text-xs text-slate-800 outline-none focus:border-slate-500" />
                            <button className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-100">
                              Anonymisera kontakt
                            </button>
                          </form>
                        </div>

                        <div className="rounded-3xl border border-red-200 bg-red-50 p-4">
                          <SectionTitle
                            title="Radera testbolag"
                            description="Endast för test/felregistrering utan historik. Systemet nekar radering om blockerare finns."
                          />
                          <form action={deleteTestCompanyFormAction} className="mt-4 grid gap-3">
                            <input type="hidden" name="company_id" value={company.id} />
                            <input name="reason" placeholder="Endast test/felregistrering" className="min-w-0 rounded-xl border border-red-200 bg-white px-3 py-2 text-xs text-slate-800 outline-none focus:border-red-500" />
                            <button className="rounded-xl border border-red-200 bg-white px-3 py-2 text-xs font-semibold text-red-800 hover:bg-red-100">
                              Radera testbolag
                            </button>
                          </form>
                        </div>
                      </div>
                    </div>
                  </article>
                )
              })
            )}
          </section>
        </section>
      </main>
    </div>
  )
}

function StatMini({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="min-w-0 rounded-2xl border border-slate-200 bg-slate-50 p-3">
      <p className="truncate text-xs text-slate-700">{label}</p>
      <p className="mt-1 truncate text-xl font-semibold text-slate-950">{value}</p>
    </div>
  )
}
