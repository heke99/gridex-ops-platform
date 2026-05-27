import Link from 'next/link'
import AdminHeader from '@/components/admin/AdminHeader'
import CompanyUserInviteForm from '@/components/admin/companies/CompanyUserInviteForm'
import { requirePlatformAdminAccess } from '@/lib/admin/guards'
import {
  getCompanyById,
  getCompanyStatusCopy,
  listCompanyUsersForGovernance,
  normalizeCompanyStatus,
  type CompanyOperationalStatus,
} from '@/lib/tenant/governance'
import {
  COMPANY_MEMBERSHIP_ROLE_OPTIONS,
  COMPANY_USER_ROLE_OPTIONS,
  getCompanyMembershipRoleLabel,
  getCompanyUserRoleLabel,
} from '@/lib/tenant/companyUserRoles'
import {
  removeUserFromCompanyAction,
  setCompanyUserRoleAction,
} from '../../actions'

export const dynamic = 'force-dynamic'

const emptyActionState = { ok: false, message: '' }

async function removeUserFromCompanyFormAction(formData: FormData) {
  'use server'
  await removeUserFromCompanyAction(emptyActionState, formData)
}

async function setCompanyUserRoleFormAction(formData: FormData) {
  'use server'
  await setCompanyUserRoleAction(emptyActionState, formData)
}

function formatDate(value: string | null | undefined) {
  if (!value) return '–'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleString('sv-SE')
}

function membershipStatusTone(status: string) {
  if (status === 'active') return 'border-emerald-200 bg-emerald-50 text-emerald-800'
  if (status === 'disabled' || status === 'locked_security') return 'border-red-200 bg-red-50 text-red-800'
  if (status === 'removed_from_company' || status === 'removed') return 'border-slate-200 bg-slate-50 text-slate-700'
  if (status === 'invited' || status === 'pending') return 'border-sky-200 bg-sky-50 text-sky-800'
  return 'border-amber-200 bg-amber-50 text-amber-800'
}

function StatusBadge({ status }: { status: CompanyOperationalStatus }) {
  const copy = getCompanyStatusCopy(status)
  return <span className={`rounded-full border px-3 py-1 text-xs font-semibold ${copy.tone}`}>{copy.label}</span>
}

export default async function CompanyUsersPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const admin = await requirePlatformAdminAccess()
  const { id } = await params
  const company = await getCompanyById(id)

  if (!company) {
    return (
      <div className="space-y-6 p-8">
        <Link href="/admin/companies" className="text-sm font-semibold text-emerald-800 hover:text-emerald-900">
          Tillbaka till bolag
        </Link>
        <div className="rounded-3xl border border-red-200 bg-red-50 p-6 text-red-800">Bolaget hittades inte.</div>
      </div>
    )
  }

  const users = await listCompanyUsersForGovernance(company.id)
  const activeUsers = users.filter((user) => user.status === 'active').length
  const disabledUsers = users.filter((user) => user.status !== 'active').length

  return (
    <div className="min-h-screen">
      <AdminHeader
        title={`Användare · ${company.name}`}
        subtitle="Hantera bolagets användare utan att radera historik. Borttagning från bolag är en avkoppling, inte en hård delete."
        userEmail={admin.email}
      />

      <div className="space-y-6 p-8">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <Link href="/admin/companies" className="rounded-2xl border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50">
            Tillbaka till bolag
          </Link>
          <div className="flex flex-wrap items-center gap-2">
            <StatusBadge status={normalizeCompanyStatus(company.status)} />
            <span className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs font-semibold text-slate-700">
              {company.org_number ?? 'Orgnummer saknas'}
            </span>
          </div>
        </div>

        <section className="grid gap-4 xl:grid-cols-3">
          <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
            <p className="text-sm font-medium text-slate-700">Aktiva användare</p>
            <p className="mt-2 text-3xl font-semibold text-slate-950">{activeUsers}</p>
          </div>
          <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
            <p className="text-sm font-medium text-slate-700">Inaktiva/avkopplade</p>
            <p className="mt-2 text-3xl font-semibold text-slate-950">{disabledUsers}</p>
          </div>
          <div className="rounded-3xl border border-amber-200 bg-amber-50 p-6 shadow-sm">
            <p className="text-sm font-medium text-amber-700">Historik bevaras</p>
            <p className="mt-2 text-sm leading-6 text-amber-800">
              Skapade kunder, avtal, mätvärden och audit logs kopplas inte bort när en användare avaktiveras.
            </p>
          </div>
        </section>

        <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
          <h2 className="text-lg font-semibold text-slate-950">Bjud in användare till bolaget</h2>
          <p className="mt-1 text-sm text-slate-700">
            Skapa eller koppla en användare till bolaget med rätt bolagsroll och systemroll. Resultatet visas direkt i användarlistan.
          </p>
          <CompanyUserInviteForm companyId={company.id} />
        </section>

        <section className="rounded-3xl border border-slate-200 bg-white shadow-sm">
          <div className="border-b border-slate-200 px-6 py-5">
            <h2 className="text-lg font-semibold text-slate-950">Bolagets användare</h2>
            <p className="mt-1 text-sm text-slate-700">{users.length} kopplingar till detta bolag.</p>
          </div>

          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="bg-slate-50">
                <tr className="border-b border-slate-200">
                  <th className="px-6 py-4 text-left font-semibold text-slate-700">Användare</th>
                  <th className="px-6 py-4 text-left font-semibold text-slate-700">Bolagsroll</th>
                  <th className="px-6 py-4 text-left font-semibold text-slate-700">Status</th>
                  <th className="px-6 py-4 text-left font-semibold text-slate-700">Senast</th>
                  <th className="px-6 py-4 text-left font-semibold text-slate-700">Åtgärder</th>
                </tr>
              </thead>
              <tbody>
                {users.map((user) => (
                  <tr key={user.membershipId} className="border-b border-slate-100 align-top">
                    <td className="px-6 py-4">
                      <p className="font-semibold text-slate-950">{user.fullName ?? user.email ?? 'Användare'}</p>
                      <p className="mt-1 text-xs text-slate-700">{user.email ?? user.invitedEmail ?? 'E-post saknas'}</p>
                      <p className="mt-1 text-xs text-slate-500">Auth-ID: {user.userId}</p>
                      <p className="mt-1 text-xs text-slate-400">Koppling-ID: {user.membershipId}</p>
                    </td>
                    <td className="px-6 py-4 text-slate-700">
                      <p className="font-semibold text-slate-900">{getCompanyMembershipRoleLabel(user.membershipRole)}</p>
                      <p className="mt-1 text-xs text-slate-500">{getCompanyUserRoleLabel(user.roleKey)}</p>
                    </td>
                    <td className="px-6 py-4">
                      <span className={`rounded-full border px-3 py-1 text-xs font-semibold ${membershipStatusTone(user.status)}`}>
                        {user.status}
                      </span>
                      {user.userStatus && user.userStatus !== 'active' ? (
                        <p className="mt-2 text-xs text-red-700">Global status: {user.userStatus}</p>
                      ) : null}
                    </td>
                    <td className="px-6 py-4 text-slate-700">
                      <p>Inbjuden: {formatDate(user.invitedAt)}</p>
                      <p>Accepterad: {formatDate(user.acceptedAt)}</p>
                    </td>
                    <td className="space-y-3 px-6 py-4">
                      <form action={setCompanyUserRoleFormAction} className="grid gap-2 rounded-2xl border border-slate-200 bg-slate-50 p-3">
                        <input type="hidden" name="company_id" value={company.id} />
                        <input type="hidden" name="user_id" value={user.userId} />
                        <select name="membership_role" defaultValue={user.membershipRole} className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-xs">
                          {COMPANY_MEMBERSHIP_ROLE_OPTIONS.map((option) => (
                            <option key={option.value} value={option.value}>{option.label}</option>
                          ))}
                        </select>
                        <select name="role_key" defaultValue={user.roleKey ?? 'company_admin'} className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-xs">
                          {COMPANY_USER_ROLE_OPTIONS.map((option) => (
                            <option key={option.value} value={option.value}>{option.label}</option>
                          ))}
                        </select>
                        <button className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-100">
                          Uppdatera roll
                        </button>
                      </form>

                      <form action={removeUserFromCompanyFormAction} className="grid gap-2 rounded-2xl border border-red-200 bg-red-50 p-3">
                        <input type="hidden" name="company_id" value={company.id} />
                        <input type="hidden" name="user_id" value={user.userId} />
                        <input name="reason" required placeholder="Anledning" className="rounded-xl border border-red-200 bg-white px-3 py-2 text-xs" />
                        <button className="rounded-xl border border-red-200 bg-white px-3 py-2 text-xs font-semibold text-red-800 hover:bg-red-100">
                          Ta bort från bolag
                        </button>
                      </form>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </div>
  )
}
