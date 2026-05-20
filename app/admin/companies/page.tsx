import Link from 'next/link'
import { redirect } from 'next/navigation'
import type { InputHTMLAttributes, ReactNode, SelectHTMLAttributes } from 'react'
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

function redirectWithCompanyActionResult(result: { ok: boolean; message: string }, companyId?: string | null): never {
  const params = new URLSearchParams()
  if (companyId) params.set('company', companyId)
  params.set(result.ok ? 'message' : 'error', result.message)
  redirect(`/admin/companies?${params.toString()}`)
}

type SearchParams = {
  company?: string | string[]
  status?: string | string[]
  message?: string | string[]
  error?: string | string[]
}

type CompaniesPageProps = {
  searchParams?: Promise<SearchParams>
}

async function anonymizeCompanyContactDetailsFormAction(formData: FormData) {
  'use server'
  const result = await anonymizeCompanyContactDetailsAction(emptyCompanyActionState, formData)
  redirectWithCompanyActionResult(result, String(formData.get('company_id') ?? ''))
}

async function createCompanyFormAction(formData: FormData) {
  'use server'
  const result = await createCompanyAction(emptyCompanyActionState, formData)
  redirectWithCompanyActionResult(result)
}

async function inviteCompanyUserFormAction(formData: FormData) {
  'use server'
  const result = await inviteCompanyUserAction(emptyCompanyActionState, formData)
  redirectWithCompanyActionResult(result, String(formData.get('company_id') ?? ''))
}

async function setCompanyStatusFormAction(formData: FormData) {
  'use server'
  const result = await setCompanyOperationalStatusAction(emptyCompanyActionState, formData)
  redirectWithCompanyActionResult(result, String(formData.get('company_id') ?? ''))
}

async function requestCompanyDeletionFormAction(formData: FormData) {
  'use server'
  const result = await requestCompanyDeletionAction(emptyCompanyActionState, formData)
  redirectWithCompanyActionResult(result, String(formData.get('company_id') ?? ''))
}

async function deleteTestCompanyFormAction(formData: FormData) {
  'use server'
  const result = await deleteTestCompanyAction(emptyCompanyActionState, formData)
  redirectWithCompanyActionResult(result, result.ok ? null : String(formData.get('company_id') ?? ''))
}

function firstParam(value: string | string[] | undefined) {
  if (Array.isArray(value)) return value[0] ?? ''
  return value ?? ''
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
    <span className={`inline-flex items-center whitespace-nowrap rounded-full border px-3 py-1 text-xs font-semibold ${copy.tone}`}>
      {copy.label}
    </span>
  )
}

function SectionTitle({ title, description }: { title: string; description: string }) {
  return (
    <div className="min-w-0">
      <h4 className="text-sm font-semibold text-slate-950">{title}</h4>
      <p className="mt-1 text-sm leading-6 text-slate-700">{description}</p>
    </div>
  )
}

function Input({ className = '', ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      {...props}
      className={`min-w-0 rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-800 outline-none focus:border-emerald-700 ${className}`}
    />
  )
}

function Select({ className = '', ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      {...props}
      className={`min-w-0 rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-800 outline-none focus:border-emerald-700 ${className}`}
    />
  )
}

function Button({
  children,
  tone = 'neutral',
  className = '',
}: {
  children: ReactNode
  tone?: 'neutral' | 'success' | 'warning' | 'danger'
  className?: string
}) {
  const toneClass = {
    neutral: 'border-slate-300 bg-white text-slate-700 hover:bg-slate-100',
    success: 'border-emerald-700 bg-emerald-700 text-white hover:bg-emerald-800',
    warning: 'border-orange-200 bg-white text-orange-800 hover:bg-orange-100',
    danger: 'border-red-200 bg-white text-red-800 hover:bg-red-100',
  }[tone]

  return (
    <button className={`w-full rounded-xl border px-3 py-2.5 text-sm font-semibold ${toneClass} ${className}`}>
      {children}
    </button>
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
    <form action={setCompanyStatusFormAction} className="grid min-w-0 gap-3 rounded-2xl border border-slate-200 bg-white p-4">
      <input type="hidden" name="company_id" value={companyId} />
      <input type="hidden" name="next_status" value={status} />
      <Input name="reason" required={status !== 'active'} placeholder={reasonPlaceholder} />
      <Button tone={danger ? 'danger' : status === 'active' ? 'success' : 'neutral'}>{label}</Button>
    </form>
  )
}

export default async function CompaniesPage({ searchParams }: CompaniesPageProps) {
  const resolvedSearchParams = searchParams ? await searchParams : {}
  const selectedCompanyId = firstParam(resolvedSearchParams.company)
  const statusMessage = firstParam(resolvedSearchParams.message)
  const errorMessage = firstParam(resolvedSearchParams.error)

  const admin = await requireAdminPageAccess({ anyOf: ['tenants.read', 'tenants.write', 'users.read'] })
  const supabase = await createSupabaseServerClient()
  const [companies, { data: auth }] = await Promise.all([
    listCompanyGovernanceSummaries(),
    supabase.auth.getUser(),
  ])

  const visibleCompanies = selectedCompanyId
    ? companies.filter((company) => company.id === selectedCompanyId)
    : companies

  const pausedCount = companies.filter((company) => company.status === 'paused').length
  const blockedCount = companies.filter(
    (company) => !company.canHardDelete || company.missingEdielProfile || company.blockedBillingUnderlays > 0,
  ).length
  const activeCount = companies.filter((company) => company.status === 'active' || company.status === 'onboarding').length

  return (
    <div className="min-h-screen bg-slate-50">
      <AdminHeader
        title="Elhandelsbolag"
        subtitle="Superadmin-yta för bolag, driftstatus, användare och säker radering. Paus och avstängning stoppar ny drift men bevarar historik."
        userEmail={auth.user?.email ?? admin.email ?? null}
      />

      <main className="mx-auto w-full max-w-[1800px] space-y-8 p-4 sm:p-6 lg:p-8">
        {statusMessage ? (
          <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-5 py-4 text-sm font-medium text-emerald-900">
            {statusMessage}
          </div>
        ) : null}

        {errorMessage ? (
          <div className="rounded-2xl border border-red-200 bg-red-50 px-5 py-4 text-sm font-medium text-red-900">
            {errorMessage}
          </div>
        ) : null}

        <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
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

        <section className="grid items-start gap-8 2xl:grid-cols-[440px_minmax(0,1fr)]">
          <aside className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6 2xl:sticky 2xl:top-6">
            <h2 className="text-lg font-semibold text-slate-950">Skapa nytt bolag</h2>
            <p className="mt-1 text-sm leading-6 text-slate-700">
              Skapa ett nytt elhandelsbolag och koppla första bolagsansvarig direkt. Den ansvariga kan senare bjuda in sitt team.
            </p>

            <form action={createCompanyFormAction} className="mt-6 grid gap-4">
              <label className="grid gap-2 text-sm">
                <span className="font-medium text-slate-700">Bolagsnamn</span>
                <Input name="name" required placeholder="Ex. Exempel Energi AB" className="rounded-2xl px-4 py-3" />
              </label>

              <div className="grid gap-4 md:grid-cols-2 2xl:grid-cols-1">
                <label className="grid gap-2 text-sm">
                  <span className="font-medium text-slate-700">Organisationsnummer</span>
                  <Input name="org_number" className="rounded-2xl px-4 py-3" />
                </label>
                <label className="grid gap-2 text-sm">
                  <span className="font-medium text-slate-700">Kortnamn</span>
                  <Input name="slug" className="rounded-2xl px-4 py-3" placeholder="Skapas automatiskt om tomt" />
                </label>
              </div>

              <label className="grid gap-2 text-sm">
                <span className="font-medium text-slate-700">Kontaktperson</span>
                <Input name="primary_contact_name" className="rounded-2xl px-4 py-3" />
              </label>

              <label className="grid gap-2 text-sm">
                <span className="font-medium text-slate-700">Kontakt e-post</span>
                <Input name="primary_contact_email" type="email" className="rounded-2xl px-4 py-3" />
              </label>

              <div className="grid gap-4 md:grid-cols-2 2xl:grid-cols-1">
                <label className="grid gap-2 text-sm">
                  <span className="font-medium text-slate-700">Telefon</span>
                  <Input name="phone" className="rounded-2xl px-4 py-3" />
                </label>
                <label className="grid gap-2 text-sm">
                  <span className="font-medium text-slate-700">Webbplats</span>
                  <Input name="website" className="rounded-2xl px-4 py-3" />
                </label>
              </div>

              <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                <h3 className="text-sm font-semibold text-slate-900">Första bolagsansvarig</h3>
                <p className="mt-1 text-xs leading-5 text-slate-700">
                  Personen får bolagskoppling och rollen Bolagsansvarig. Lämna tomt om du vill skapa bolaget först.
                </p>
                <div className="mt-4 grid gap-3">
                  <Input name="admin_name" className="rounded-2xl px-4 py-3" placeholder="Namn" />
                  <Input name="admin_email" type="email" className="rounded-2xl px-4 py-3" placeholder="namn@bolag.se" />
                  <Input name="admin_temporary_password" type="text" minLength={8} className="rounded-2xl px-4 py-3" placeholder="Temporärt lösenord, minst 8 tecken" />
                  <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs leading-5 text-emerald-900">
                    Kontot skapas direkt med det temporära lösenordet. Personen kan logga in direkt och måste byta lösenord vid första inloggning. Mail skickas om SMTP fungerar men blockerar inte skapandet.
                  </div>
                </div>
              </div>

              <Button tone="success" className="rounded-2xl py-3">Skapa bolag</Button>
            </form>
          </aside>

          <section className="min-w-0 space-y-6">
            <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
              <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(280px,420px)] xl:items-end">
                <div className="min-w-0">
                  <h2 className="text-lg font-semibold text-slate-950">Bolag på plattformen</h2>
                  <p className="mt-1 text-sm leading-6 text-slate-700">
                    {companies.length} registrerade bolag med tenant-governance. Välj ett bolag i listan om du vill arbeta fokuserat.
                  </p>
                </div>

                {companies.length > 1 ? (
                  <form className="grid min-w-0 gap-2" action="/admin/companies">
                    <label htmlFor="company-filter" className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                      Välj bolag
                    </label>
                    <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto]">
                      <Select id="company-filter" name="company" defaultValue={selectedCompanyId}>
                        <option value="">Visa alla bolag</option>
                        {companies.map((company) => (
                          <option key={company.id} value={company.id}>
                            {company.name}
                          </option>
                        ))}
                      </Select>
                      <Button className="sm:w-auto">Visa</Button>
                    </div>
                  </form>
                ) : null}
              </div>
            </div>

            {visibleCompanies.length === 0 ? (
              <div className="rounded-3xl border border-slate-200 bg-white p-10 text-center text-sm text-slate-700 shadow-sm">
                Inga bolag matchar filtret.
              </div>
            ) : (
              <div className="grid gap-6">
                {visibleCompanies.map((company) => {
                  const copy = getCompanyStatusCopy(company.status)
                  const hasOperationalBlockers = company.missingEdielProfile || company.blockedBillingUnderlays > 0

                  return (
                    <article key={company.id} className="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm">
                      <div className="grid gap-5 border-b border-slate-200 p-5 sm:p-6 xl:grid-cols-[minmax(0,1fr)_auto] xl:items-start">
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-3">
                            <h3 className="min-w-0 text-lg font-semibold text-slate-950">{company.name}</h3>
                            <StatusBadge status={company.status} />
                            {hasOperationalBlockers ? (
                              <span className="inline-flex items-center whitespace-nowrap rounded-full border border-orange-200 bg-orange-50 px-3 py-1 text-xs font-semibold text-orange-800">
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

                        <div className="flex flex-wrap gap-2 xl:justify-end">
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

                      <div className="grid gap-4 p-5 sm:p-6">
                        <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-6">
                          <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                            <p className="text-xs text-slate-700">Användare</p>
                            <p className="mt-1 text-xl font-semibold text-slate-950">{company.activeUsers}</p>
                          </div>
                          <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                            <p className="text-xs text-slate-700">Kunder</p>
                            <p className="mt-1 text-xl font-semibold text-slate-950">{company.customers}</p>
                          </div>
                          <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                            <p className="text-xs text-slate-700">Ediel</p>
                            <p className="mt-1 text-xl font-semibold text-slate-950">{company.edielMessages}</p>
                          </div>
                          <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                            <p className="text-xs text-slate-700">Mätvärden</p>
                            <p className="mt-1 text-xl font-semibold text-slate-950">{company.meteringValues}</p>
                          </div>
                          <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                            <p className="text-xs text-slate-700">Exporter</p>
                            <p className="mt-1 text-xl font-semibold text-slate-950">{company.partnerExports}</p>
                          </div>
                          <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                            <p className="text-xs text-slate-700">Senaste aktivitet</p>
                            <p className="mt-1 break-words text-xs font-semibold text-slate-950">{formatDate(company.latestAuditAt ?? company.latestEdielAt)}</p>
                          </div>
                        </section>

                        {hasOperationalBlockers || company.deleteBlockers.length > 0 ? (
                          <section className="grid gap-4 lg:grid-cols-2">
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
                          </section>
                        ) : null}

                        <section className="rounded-3xl border border-slate-200 bg-slate-50 p-4 sm:p-5">
                          <SectionTitle
                            title="Driftstatus"
                            description="Pausa eller stäng av drift utan att radera historik. Återaktivering öppnar för ny drift igen."
                          />
                          <div className="mt-4 grid gap-3 md:grid-cols-2 2xl:grid-cols-4">
                            <GovernanceActionForm companyId={company.id} status="paused" label="Pausa bolag" reasonPlaceholder="Anledning till paus" />
                            <GovernanceActionForm companyId={company.id} status="active" label="Återaktivera" reasonPlaceholder="Anledning, valfritt" />
                            <GovernanceActionForm companyId={company.id} status="suspended" label="Stäng av" reasonPlaceholder="Anledning till avstängning" danger />
                            <GovernanceActionForm companyId={company.id} status="archived" label="Arkivera" reasonPlaceholder="Anledning till arkivering" />
                          </div>
                        </section>

                        <section className="rounded-3xl border border-slate-200 bg-slate-50 p-4 sm:p-5">
                          <SectionTitle
                            title="Bjud in användare"
                            description="Skicka en inbjudan till bolaget. Personen får konto och bolagskoppling direkt. Ange ett temporärt lösenord som personen byter vid första inloggning."
                          />
                          <form action={inviteCompanyUserFormAction} className="mt-4 grid gap-3">
                            <input type="hidden" name="company_id" value={company.id} />
                            <div className="grid gap-3 xl:grid-cols-[minmax(220px,1.2fr)_minmax(180px,1fr)_minmax(170px,220px)_minmax(150px,180px)_minmax(150px,180px)]">
                              <Input name="email" type="email" required placeholder="bjud in e-post" />
                              <Input name="full_name" placeholder="namn" />
                              <Input name="temporary_password" type="text" minLength={8} required placeholder="temporärt lösenord" />
                              <Select name="membership_role" defaultValue="admin">
                                <option value="owner">Ägare</option>
                                <option value="admin">Admin</option>
                                <option value="operations">Operations</option>
                                <option value="support">Support</option>
                                <option value="viewer">Viewer</option>
                              </Select>
                              <Select name="role_key" defaultValue="company_admin">
                                <option value="company_admin">Bolagsadmin</option>
                                <option value="operations">Operations</option>
                                <option value="support">Support</option>
                                <option value="viewer">Viewer</option>
                              </Select>
                            </div>
                            <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_180px] sm:items-center">
                              <p className="text-xs leading-5 text-slate-600">
                                Tips: dela det temporära lösenordet säkert. Använd Bolagsadmin för bolagsansvarig. Viewer ska bara kunna läsa historik och status.
                              </p>
                              <Button>Bjud in användare</Button>
                            </div>
                          </form>
                        </section>

                        <section className="grid gap-4 xl:grid-cols-3">
                          <div className="rounded-3xl border border-orange-200 bg-orange-50 p-4 sm:p-5">
                            <SectionTitle
                              title="Begär radering"
                              description="Markerar bolaget för radering men bevarar historik tills blockerare är hanterade."
                            />
                            <form action={requestCompanyDeletionFormAction} className="mt-4 grid gap-3">
                              <input type="hidden" name="company_id" value={company.id} />
                              <Input name="reason" required placeholder="Anledning till raderingsbegäran" className="border-orange-200 focus:border-orange-500" />
                              <Button tone="warning">Begär radering</Button>
                            </form>
                          </div>

                          <div className="rounded-3xl border border-slate-200 bg-slate-50 p-4 sm:p-5">
                            <SectionTitle
                              title="Anonymisera kontakt"
                              description="Tar bort kontaktuppgifter och återkallar öppna inbjudningar utan att förstöra historik."
                            />
                            <form action={anonymizeCompanyContactDetailsFormAction} className="mt-4 grid gap-3">
                              <input type="hidden" name="company_id" value={company.id} />
                              <Input name="reason" required placeholder="Anledning till anonymisering" />
                              <Button>Anonymisera kontakt</Button>
                            </form>
                          </div>

                          <div className="rounded-3xl border border-red-200 bg-red-50 p-4 sm:p-5">
                            <SectionTitle
                              title="Radera testbolag"
                              description="Hård radering används bara för test-/felregistrering utan operativ historik. Metadata som inbjudningar och governance-loggar rensas automatiskt."
                            />
                            <form action={deleteTestCompanyFormAction} className="mt-4 grid gap-3">
                              <input type="hidden" name="company_id" value={company.id} />
                              <Input name="reason" placeholder="Endast test/felregistrering" className="border-red-200 focus:border-red-500" />
                              <Button tone="danger">Radera testbolag</Button>
                            </form>
                          </div>
                        </section>
                      </div>
                    </article>
                  )
                })}
              </div>
            )}
          </section>
        </section>
      </main>
    </div>
  )
}
