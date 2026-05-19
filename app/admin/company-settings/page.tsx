import AdminHeader from '@/components/admin/AdminHeader'
import { requireAdminPageAccess } from '@/lib/admin/guards'
import { getOperationalCompanyScope } from '@/lib/tenant/scope'
import { getCompanyById, listCompanyUsersForGovernance } from '@/lib/tenant/governance'
import { updateCompanyResponsibleUserAction, updateCompanySettingsAction } from './actions'

export const dynamic = 'force-dynamic'

const emptyState = { ok: false, message: '' }

async function updateCompanySettingsFormAction(formData: FormData) {
  'use server'
  await updateCompanySettingsAction(emptyState, formData)
}

async function updateResponsibleUserFormAction(formData: FormData) {
  'use server'
  await updateCompanyResponsibleUserAction(emptyState, formData)
}

function roleLabel(value: string) {
  const labels: Record<string, string> = {
    owner: 'Ägare',
    admin: 'Admin',
    company_admin: 'Bolagsansvarig',
    operations: 'Operations',
    support: 'Support',
    viewer: 'Viewer',
  }
  return labels[value] ?? value
}

export default async function CompanySettingsPage() {
  const context = await requireAdminPageAccess({ anyOf: ['users.read', 'tenants.read', 'tenants.invite'] })
  const scope = await getOperationalCompanyScope(context.userId)
  const companyId = scope.companyId
  const company = companyId ? await getCompanyById(companyId) : null
  const users = companyId ? await listCompanyUsersForGovernance(companyId) : []
  const responsibleUsers = users.filter((user) => ['owner', 'admin', 'company_admin'].includes(user.membershipRole))

  return (
    <div className="min-h-screen">
      <AdminHeader
        title="Bolagsinställningar"
        subtitle="Uppdatera bolagets kontaktuppgifter, bolagsansvariga och inloggningsuppgifter inom ditt bolag."
        userEmail={context.email}
      />

      <div className="space-y-6 p-8">
        {!company || !companyId ? (
          <section className="rounded-3xl border border-amber-200 bg-amber-50 p-6 text-sm text-amber-800 shadow-sm">
            Kontot saknar aktiv bolagskoppling. Koppla användaren till ett bolag innan bolagsinställningar kan ändras.
          </section>
        ) : (
          <>
            <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
              <h2 className="text-lg font-semibold text-slate-950">Bolagsuppgifter</h2>
              <p className="mt-1 text-sm text-slate-700">Dessa uppgifter används i adminytan, onboarding och kommunikation.</p>

              <form action={updateCompanySettingsFormAction} className="mt-5 grid gap-4 lg:grid-cols-2">
                <input type="hidden" name="company_id" value={companyId} />
                <label className="grid gap-2 text-sm">
                  <span className="font-medium text-slate-700">Bolagsnamn</span>
                  <input name="name" required defaultValue={company.name} className="rounded-2xl border border-slate-300 px-4 py-3" />
                </label>
                <label className="grid gap-2 text-sm">
                  <span className="font-medium text-slate-700">Organisationsnummer</span>
                  <input name="org_number" defaultValue={company.org_number ?? ''} className="rounded-2xl border border-slate-300 px-4 py-3" />
                </label>
                <label className="grid gap-2 text-sm">
                  <span className="font-medium text-slate-700">Kontaktperson</span>
                  <input name="primary_contact_name" defaultValue={company.primary_contact_name ?? ''} className="rounded-2xl border border-slate-300 px-4 py-3" />
                </label>
                <label className="grid gap-2 text-sm">
                  <span className="font-medium text-slate-700">Kontakt e-post</span>
                  <input name="primary_contact_email" type="email" defaultValue={company.primary_contact_email ?? ''} className="rounded-2xl border border-slate-300 px-4 py-3" />
                </label>
                <label className="grid gap-2 text-sm">
                  <span className="font-medium text-slate-700">Telefon</span>
                  <input name="phone" defaultValue={company.phone ?? ''} className="rounded-2xl border border-slate-300 px-4 py-3" />
                </label>
                <label className="grid gap-2 text-sm">
                  <span className="font-medium text-slate-700">Webbplats</span>
                  <input name="website" defaultValue={company.website ?? ''} className="rounded-2xl border border-slate-300 px-4 py-3" />
                </label>
                <div className="lg:col-span-2 flex justify-end">
                  <button className="rounded-2xl bg-emerald-700 px-5 py-3 text-sm font-semibold text-white hover:bg-emerald-800">
                    Spara bolagsuppgifter
                  </button>
                </div>
              </form>
            </section>

            <section className="rounded-3xl border border-slate-200 bg-white shadow-sm">
              <div className="border-b border-slate-200 px-6 py-5">
                <h2 className="text-lg font-semibold text-slate-950">Bolagsansvariga och roller</h2>
                <p className="mt-1 text-sm text-slate-700">Ändra namn, telefon, login-e-post och bolagsroll för ägare/admin.</p>
              </div>

              <div className="divide-y divide-slate-100">
                {responsibleUsers.length === 0 ? (
                  <p className="px-6 py-8 text-sm text-slate-700">Ingen ägare eller bolagsansvarig hittades.</p>
                ) : (
                  responsibleUsers.map((user) => (
                    <form key={user.membershipId} action={updateResponsibleUserFormAction} className="grid gap-4 px-6 py-6 xl:grid-cols-[1fr_1fr_150px_160px_160px]">
                      <input type="hidden" name="company_id" value={companyId} />
                      <input type="hidden" name="user_id" value={user.userId} />
                      <label className="grid gap-2 text-sm">
                        <span className="font-medium text-slate-700">Namn</span>
                        <input name="full_name" defaultValue={user.fullName ?? ''} className="rounded-2xl border border-slate-300 px-4 py-3" />
                      </label>
                      <label className="grid gap-2 text-sm">
                        <span className="font-medium text-slate-700">Login e-post</span>
                        <input name="email" type="email" required defaultValue={user.email ?? user.invitedEmail ?? ''} className="rounded-2xl border border-slate-300 px-4 py-3" />
                      </label>
                      <label className="grid gap-2 text-sm">
                        <span className="font-medium text-slate-700">Telefon</span>
                        <input name="phone" className="rounded-2xl border border-slate-300 px-4 py-3" />
                      </label>
                      <label className="grid gap-2 text-sm">
                        <span className="font-medium text-slate-700">Bolagsroll</span>
                        <select name="membership_role" defaultValue={user.membershipRole} className="rounded-2xl border border-slate-300 px-4 py-3">
                          <option value="owner">Ägare</option>
                          <option value="admin">Admin</option>
                          <option value="operations">Operations</option>
                          <option value="support">Support</option>
                          <option value="viewer">Viewer</option>
                        </select>
                      </label>
                      <label className="grid gap-2 text-sm">
                        <span className="font-medium text-slate-700">Systemroll</span>
                        <select name="role_key" defaultValue="company_admin" className="rounded-2xl border border-slate-300 px-4 py-3">
                          <option value="company_admin">Bolagsansvarig</option>
                          <option value="operations_manager">Operationsansvarig</option>
                          <option value="operations_agent">Operations</option>
                          <option value="customer_service_agent">Kundtjänst</option>
                          <option value="finance_readonly">Ekonomi läs</option>
                          <option value="executive_readonly">Ledning läs</option>
                        </select>
                      </label>
                      <div className="xl:col-span-5 flex items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-700">
                        <span>{roleLabel(user.membershipRole)} · {user.email ?? user.userId}</span>
                        <button className="rounded-2xl bg-slate-950 px-5 py-3 text-sm font-semibold text-white hover:bg-black">
                          Uppdatera ansvarig
                        </button>
                      </div>
                    </form>
                  ))
                )}
              </div>
            </section>
          </>
        )}
      </div>
    </div>
  )
}
