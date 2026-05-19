import Link from 'next/link'
import AdminHeader from '@/components/admin/AdminHeader'
import { requireAdminPageKeyAccess } from '@/lib/admin/guards'
import {
  COMPANY_USER_ROLE_OPTIONS,
  getTenantCompanyPageData,
  userIsPlatformAdmin,
} from '@/lib/tenant/companies'
import {
  createCompanyAction,
  inviteCompanyUserAction,
  updateCompanyStatusAction,
} from './actions'

export const dynamic = 'force-dynamic'

function formatDate(value: string | null | undefined) {
  if (!value) return '—'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleDateString('sv-SE')
}

function statusLabel(status: string | null | undefined) {
  if (status === 'active') return 'Aktiv'
  if (status === 'onboarding') return 'Onboarding'
  if (status === 'suspended') return 'Pausad'
  return 'Ej angiven'
}

function statusClass(status: string | null | undefined) {
  if (status === 'active') return 'border-emerald-200 bg-emerald-50 text-emerald-800'
  if (status === 'onboarding') return 'border-sky-200 bg-sky-50 text-sky-800'
  if (status === 'suspended') return 'border-amber-200 bg-amber-50 text-amber-800'
  return 'border-slate-200 bg-slate-50 text-slate-600'
}

export default async function CompaniesPage() {
  const admin = await requireAdminPageKeyAccess('companies.manage')
  const data = await getTenantCompanyPageData({
    userId: admin.userId,
    roles: admin.roles,
    permissions: admin.permissions,
  })

  const canCreateCompanies = userIsPlatformAdmin(admin.roles, admin.permissions)
  const canInvite = admin.permissions.includes('tenants.invite')
  const activeCompanies = data.companies.filter((company) => company.status === 'active').length
  const activeMemberships = data.companies.reduce(
    (sum, company) => sum + company.active_memberships,
    0
  )
  const pendingInvitations = data.companies.reduce(
    (sum, company) => sum + company.pending_invitations,
    0
  )

  async function createCompanyFormAction(formData: FormData) {
    'use server'
    await createCompanyAction({} as Parameters<typeof createCompanyAction>[0], formData)
  }

  async function inviteCompanyUserFormAction(formData: FormData) {
    'use server'
    await inviteCompanyUserAction({} as Parameters<typeof inviteCompanyUserAction>[0], formData)
  }

  async function updateCompanyStatusFormAction(formData: FormData) {
    'use server'
    await updateCompanyStatusAction({} as Parameters<typeof updateCompanyStatusAction>[0], formData)
  }

  return (
    <div className="min-h-screen">
      <AdminHeader
        title="Företag"
        subtitle="Skapa bolagskonton, bjud in ansvariga och håll användare kopplade till rätt företag."
        userEmail={admin.email}
      />

      <div className="space-y-8 p-8">
        <section className="grid gap-4 xl:grid-cols-4">
          <div className="rounded-[2rem] border border-emerald-100 bg-white p-6 shadow-sm shadow-emerald-950/5">
            <p className="text-sm font-medium text-slate-500">Företag</p>
            <p className="mt-2 text-3xl font-semibold text-slate-950">{data.companies.length}</p>
            <p className="mt-2 text-sm text-slate-500">Bolag du kan administrera.</p>
          </div>
          <div className="rounded-[2rem] border border-emerald-100 bg-emerald-50 p-6 shadow-sm shadow-emerald-950/5">
            <p className="text-sm font-medium text-emerald-700">Aktiva företag</p>
            <p className="mt-2 text-3xl font-semibold text-emerald-950">{activeCompanies}</p>
            <p className="mt-2 text-sm text-emerald-800/75">Bolag med aktiv driftstatus.</p>
          </div>
          <div className="rounded-[2rem] border border-slate-200 bg-white p-6 shadow-sm">
            <p className="text-sm font-medium text-slate-500">Användarkopplingar</p>
            <p className="mt-2 text-3xl font-semibold text-slate-950">{activeMemberships}</p>
            <p className="mt-2 text-sm text-slate-500">Aktiva kopplingar mellan användare och bolag.</p>
          </div>
          <div className="rounded-[2rem] border border-sky-200 bg-sky-50 p-6 shadow-sm">
            <p className="text-sm font-medium text-sky-700">Väntande inbjudningar</p>
            <p className="mt-2 text-3xl font-semibold text-sky-950">{pendingInvitations}</p>
            <p className="mt-2 text-sm text-sky-800/75">Inbjudningar som ännu inte är slutförda.</p>
          </div>
        </section>

        <section className="grid gap-6 xl:grid-cols-[1.05fr_0.95fr]">
          {canCreateCompanies ? (
            <section className="rounded-[2rem] border border-emerald-100 bg-white shadow-sm shadow-emerald-950/5">
              <div className="border-b border-emerald-100 px-6 py-5">
                <h2 className="text-lg font-semibold text-slate-950">Skapa nytt företag</h2>
                <p className="mt-1 text-sm leading-6 text-slate-500">
                  Skapa ett bolagskonto och bjud in första bolagsansvarig i samma steg.
                </p>
              </div>

              <form action={createCompanyFormAction} className="grid gap-4 px-6 py-6 md:grid-cols-2">
                <label className="grid gap-2 md:col-span-2">
                  <span className="text-sm font-semibold text-slate-700">Företagsnamn</span>
                  <input name="name" required placeholder="Exempel Energi AB" className="rounded-2xl border border-slate-300 px-4 py-3 text-sm outline-none transition focus:border-emerald-700 focus:ring-4 focus:ring-emerald-100" />
                </label>

                <label className="grid gap-2">
                  <span className="text-sm font-semibold text-slate-700">Organisationsnummer</span>
                  <input name="org_number" placeholder="559000-0000" className="rounded-2xl border border-slate-300 px-4 py-3 text-sm outline-none transition focus:border-emerald-700 focus:ring-4 focus:ring-emerald-100" />
                </label>

                <label className="grid gap-2">
                  <span className="text-sm font-semibold text-slate-700">Telefon</span>
                  <input name="phone" placeholder="08-000 00 00" className="rounded-2xl border border-slate-300 px-4 py-3 text-sm outline-none transition focus:border-emerald-700 focus:ring-4 focus:ring-emerald-100" />
                </label>

                <label className="grid gap-2">
                  <span className="text-sm font-semibold text-slate-700">Bolagsansvarig</span>
                  <input name="primary_contact_name" placeholder="För- och efternamn" className="rounded-2xl border border-slate-300 px-4 py-3 text-sm outline-none transition focus:border-emerald-700 focus:ring-4 focus:ring-emerald-100" />
                </label>

                <label className="grid gap-2">
                  <span className="text-sm font-semibold text-slate-700">E-post till bolagsansvarig</span>
                  <input name="primary_contact_email" type="email" required placeholder="admin@bolag.se" className="rounded-2xl border border-slate-300 px-4 py-3 text-sm outline-none transition focus:border-emerald-700 focus:ring-4 focus:ring-emerald-100" />
                </label>

                <label className="grid gap-2 md:col-span-2">
                  <span className="text-sm font-semibold text-slate-700">Webbplats</span>
                  <input name="website" placeholder="https://bolag.se" className="rounded-2xl border border-slate-300 px-4 py-3 text-sm outline-none transition focus:border-emerald-700 focus:ring-4 focus:ring-emerald-100" />
                </label>

                <div className="md:col-span-2 flex flex-col gap-3 rounded-2xl border border-emerald-100 bg-emerald-50 p-4 sm:flex-row sm:items-center sm:justify-between">
                  <p className="text-sm leading-6 text-emerald-900">
                    Den ansvariga användaren får rollen Bolagsansvarig och kopplas direkt till företaget.
                  </p>
                  <button className="rounded-2xl bg-emerald-700 px-5 py-3 text-sm font-semibold text-white shadow-sm shadow-emerald-700/20 transition hover:bg-emerald-800">
                    Skapa företag
                  </button>
                </div>
              </form>
            </section>
          ) : null}

          {canInvite ? (
            <section className="rounded-[2rem] border border-emerald-100 bg-white shadow-sm shadow-emerald-950/5">
              <div className="border-b border-emerald-100 px-6 py-5">
                <h2 className="text-lg font-semibold text-slate-950">Bjud in användare</h2>
                <p className="mt-1 text-sm leading-6 text-slate-500">
                  Bjud in teammedlemmar till ett företag och välj roll för deras arbetsyta.
                </p>
              </div>

              <form action={inviteCompanyUserFormAction} className="grid gap-4 px-6 py-6">
                <label className="grid gap-2">
                  <span className="text-sm font-semibold text-slate-700">Företag</span>
                  <select name="company_id" required className="rounded-2xl border border-slate-300 px-4 py-3 text-sm outline-none transition focus:border-emerald-700 focus:ring-4 focus:ring-emerald-100">
                    <option value="">Välj företag</option>
                    {data.companies.map((company) => (
                      <option key={company.id} value={company.id}>{company.name}</option>
                    ))}
                  </select>
                </label>

                <label className="grid gap-2">
                  <span className="text-sm font-semibold text-slate-700">Namn</span>
                  <input name="full_name" placeholder="För- och efternamn" className="rounded-2xl border border-slate-300 px-4 py-3 text-sm outline-none transition focus:border-emerald-700 focus:ring-4 focus:ring-emerald-100" />
                </label>

                <label className="grid gap-2">
                  <span className="text-sm font-semibold text-slate-700">E-post</span>
                  <input name="email" type="email" required placeholder="namn@bolag.se" className="rounded-2xl border border-slate-300 px-4 py-3 text-sm outline-none transition focus:border-emerald-700 focus:ring-4 focus:ring-emerald-100" />
                </label>

                <label className="grid gap-2">
                  <span className="text-sm font-semibold text-slate-700">Roll</span>
                  <select name="role_key" defaultValue="customer_service_agent" className="rounded-2xl border border-slate-300 px-4 py-3 text-sm outline-none transition focus:border-emerald-700 focus:ring-4 focus:ring-emerald-100">
                    {COMPANY_USER_ROLE_OPTIONS.map((role) => (
                      <option key={role.value} value={role.value}>{role.label}</option>
                    ))}
                  </select>
                </label>

                <button className="rounded-2xl bg-slate-950 px-5 py-3 text-sm font-semibold text-white transition hover:bg-slate-800">
                  Skicka inbjudan
                </button>
              </form>
            </section>
          ) : null}
        </section>

        <section className="rounded-[2rem] border border-emerald-100 bg-white shadow-sm shadow-emerald-950/5">
          <div className="flex flex-col gap-3 border-b border-emerald-100 px-6 py-5 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <h2 className="text-lg font-semibold text-slate-950">Bolagskonton</h2>
              <p className="mt-1 text-sm text-slate-500">
                Varje företag ska ha egen användarstyrning, egen kunddata och egna operationsflöden.
              </p>
            </div>
            <Link href="/admin/users" className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-2.5 text-sm font-semibold text-emerald-800 transition hover:bg-emerald-100">
              Visa användare
            </Link>
          </div>

          <div className="divide-y divide-slate-100">
            {data.companies.length === 0 ? (
              <div className="px-6 py-8 text-sm text-slate-500">
                Inga företag finns tillgängliga för din användare.
              </div>
            ) : (
              data.companies.map((company) => (
                <div key={company.id} className="grid gap-5 px-6 py-5 xl:grid-cols-[1fr_0.85fr_auto] xl:items-center">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="text-lg font-semibold text-slate-950">{company.name}</h3>
                      <span className={`rounded-full border px-3 py-1 text-xs font-semibold ${statusClass(company.status)}`}>
                        {statusLabel(company.status)}
                      </span>
                    </div>
                    <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-sm text-slate-500">
                      <span>Org.nr: {company.org_number || '—'}</span>
                      <span>Skapat: {formatDate(company.created_at)}</span>
                      <span>Slug: {company.slug || '—'}</span>
                    </div>
                  </div>

                  <div className="grid gap-3 sm:grid-cols-3">
                    <div className="rounded-2xl border border-slate-200 bg-slate-50 p-3">
                      <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">Användare</p>
                      <p className="mt-1 text-xl font-semibold text-slate-950">{company.active_memberships}</p>
                    </div>
                    <div className="rounded-2xl border border-slate-200 bg-slate-50 p-3">
                      <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">Inbjudningar</p>
                      <p className="mt-1 text-xl font-semibold text-slate-950">{company.pending_invitations}</p>
                    </div>
                    <div className="rounded-2xl border border-slate-200 bg-slate-50 p-3">
                      <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">Kontakt</p>
                      <p className="mt-1 truncate text-sm font-semibold text-slate-950">{company.primary_contact_email || '—'}</p>
                    </div>
                  </div>

                  {canCreateCompanies ? (
                    <form action={updateCompanyStatusFormAction} className="flex gap-2">
                      <input type="hidden" name="company_id" value={company.id} />
                      <select name="status" defaultValue={company.status ?? 'active'} className="rounded-2xl border border-slate-300 px-3 py-2 text-sm outline-none focus:border-emerald-700">
                        <option value="active">Aktiv</option>
                        <option value="onboarding">Onboarding</option>
                        <option value="suspended">Pausad</option>
                      </select>
                      <button className="rounded-2xl bg-slate-950 px-4 py-2 text-sm font-semibold text-white">
                        Spara
                      </button>
                    </form>
                  ) : null}
                </div>
              ))
            )}
          </div>
        </section>

        <section className="rounded-[2rem] border border-slate-200 bg-white shadow-sm">
          <div className="border-b border-slate-200 px-6 py-5">
            <h2 className="text-lg font-semibold text-slate-950">Senaste inbjudningar</h2>
            <p className="mt-1 text-sm text-slate-500">
              Spårning av nya användare som kopplats till bolagskonton.
            </p>
          </div>

          <div className="divide-y divide-slate-100">
            {data.recentInvitations.length === 0 ? (
              <p className="px-6 py-6 text-sm text-slate-500">Inga inbjudningar att visa.</p>
            ) : (
              data.recentInvitations.map((invitation) => {
                const company = data.companies.find((item) => item.id === invitation.company_id)
                return (
                  <div key={invitation.id} className="grid gap-2 px-6 py-4 md:grid-cols-[1fr_auto] md:items-center">
                    <div>
                      <p className="font-semibold text-slate-950">{invitation.email}</p>
                      <p className="mt-1 text-sm text-slate-500">
                        {company?.name ?? 'Företag'} • {invitation.role_key ?? invitation.membership_role} • {formatDate(invitation.created_at)}
                      </p>
                    </div>
                    <span className={`inline-flex rounded-full border px-3 py-1 text-xs font-semibold ${invitation.status === 'pending' ? 'border-sky-200 bg-sky-50 text-sky-800' : 'border-emerald-200 bg-emerald-50 text-emerald-800'}`}>
                      {invitation.status === 'pending' ? 'Väntar' : 'Aktiv'}
                    </span>
                  </div>
                )
              })
            )}
          </div>
        </section>
      </div>
    </div>
  )
}
