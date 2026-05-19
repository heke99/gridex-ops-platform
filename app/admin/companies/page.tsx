import AdminHeader from '@/components/admin/AdminHeader'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { requireAdminPageAccess } from '@/lib/admin/guards'
import { listPlatformCompanies } from '@/lib/tenant/scope'
import { createCompanyAction, inviteCompanyUserAction } from './actions'

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

function statusLabel(value: string | null | undefined) {
 if (value === 'active') return 'Aktivt'
 if (value === 'inactive') return 'Inaktivt'
 if (value === 'suspended') return 'Pausat'
 return 'Ej klassat'
}

export default async function CompaniesPage() {
 const admin = await requireAdminPageAccess({ anyOf: ['tenants.read', 'tenants.write', 'users.read'] })
 const supabase = await createSupabaseServerClient()
 const [companies, { data: auth }] = await Promise.all([
 listPlatformCompanies(),
 supabase.auth.getUser(),
 ])

 return (
 <div className="min-h-screen">
 <AdminHeader
 title="Elhandelsbolag"
 subtitle="Skapa och administrera bolag på plattformen. Kunddata hanteras fortsatt bara inom användarens egna operativa bolagskopplingar."
 userEmail={auth.user?.email ?? admin.email ?? null}
 />

 <div className="grid gap-6 p-8 xl:grid-cols-[460px_minmax(0,1fr)]">
 <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm ">
 <h2 className="text-lg font-semibold text-slate-950 ">Skapa nytt bolag</h2>
 <p className="mt-1 text-sm leading-6 text-slate-700 ">
 Detta skapar ett nytt elhandelsbolag på plattformen. Första bolagsansvarig får egen bolagskoppling och kan därefter bjuda in sitt team.
 </p>

 <form action={createCompanyFormAction} className="mt-6 space-y-4">
 <label className="grid gap-2 text-sm">
 <span className="font-medium text-slate-700 ">Bolagsnamn</span>
 <input name="name" required className="rounded-2xl border border-slate-300 px-4 py-3 " placeholder="Ex. Exempel Energi AB" />
 </label>

 <div className="grid gap-4 md:grid-cols-2">
 <label className="grid gap-2 text-sm">
 <span className="font-medium text-slate-700 ">Organisationsnummer</span>
 <input name="org_number" className="rounded-2xl border border-slate-300 px-4 py-3 " />
 </label>
 <label className="grid gap-2 text-sm">
 <span className="font-medium text-slate-700 ">Kortnamn</span>
 <input name="slug" className="rounded-2xl border border-slate-300 px-4 py-3 " placeholder="Skapas automatiskt om tomt" />
 </label>
 </div>

 <label className="grid gap-2 text-sm">
 <span className="font-medium text-slate-700 ">Kontaktperson</span>
 <input name="primary_contact_name" className="rounded-2xl border border-slate-300 px-4 py-3 " />
 </label>

 <label className="grid gap-2 text-sm">
 <span className="font-medium text-slate-700 ">Kontakt e-post</span>
 <input name="primary_contact_email" type="email" className="rounded-2xl border border-slate-300 px-4 py-3 " />
 </label>

 <div className="grid gap-4 md:grid-cols-2">
 <label className="grid gap-2 text-sm">
 <span className="font-medium text-slate-700 ">Telefon</span>
 <input name="phone" className="rounded-2xl border border-slate-300 px-4 py-3 " />
 </label>
 <label className="grid gap-2 text-sm">
 <span className="font-medium text-slate-700 ">Webbplats</span>
 <input name="website" className="rounded-2xl border border-slate-300 px-4 py-3 " />
 </label>
 </div>

 <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4 ">
 <h3 className="text-sm font-semibold text-slate-900 ">Första bolagsansvarig</h3>
 <p className="mt-1 text-xs leading-5 text-slate-700 ">
 Personen kopplas till bolaget som ägare och får rollen Bolagsansvarig. Lämna tomt om du vill skapa bolaget först och bjuda in senare.
 </p>
 <div className="mt-4 grid gap-4">
 <input name="admin_name" className="rounded-2xl border border-slate-300 px-4 py-3 " placeholder="Namn" />
 <input name="admin_email" type="email" className="rounded-2xl border border-slate-300 px-4 py-3 " placeholder="namn@bolag.se" />
 <label className="flex items-center gap-3 text-sm text-slate-700 ">
 <input type="checkbox" name="send_invite" defaultChecked />
 Skicka inbjudan via e-post
 </label>
 </div>
 </div>

 <button className="w-full rounded-2xl bg-emerald-700 px-4 py-3 text-sm font-semibold text-white hover:bg-emerald-800 ">
 Skapa bolag
 </button>
 </form>
 </section>

 <section className="space-y-6">
 <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm ">
 <div className="flex flex-wrap items-center justify-between gap-4">
 <div>
 <h2 className="text-lg font-semibold text-slate-950 ">Bolag på plattformen</h2>
 <p className="mt-1 text-sm text-slate-700 ">{companies.length} registrerade bolag.</p>
 </div>
 </div>

 <div className="mt-5 divide-y divide-slate-100 ">
 {companies.length === 0 ? (
 <p className="py-8 text-sm text-slate-700 ">Inga bolag är skapade ännu.</p>
 ) : (
 companies.map((company) => (
 <div key={company.id} className="grid gap-4 py-4 lg:grid-cols-[1fr_280px] lg:items-center">
 <div>
 <p className="font-semibold text-slate-950 ">{company.name}</p>
 <p className="mt-1 text-sm text-slate-700 ">{company.org_number ?? 'Organisationsnummer saknas'} · {company.slug ?? 'Kortnamn saknas'}</p>
 </div>
 <div className="flex flex-wrap items-center justify-start gap-2 lg:justify-end">
 <span className="rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-700 ">
 {statusLabel(company.status)}
 </span>
 <form action={inviteCompanyUserFormAction} className="flex flex-wrap gap-2">
 <input type="hidden" name="company_id" value={company.id} />
 <input name="email" type="email" className="h-9 w-44 rounded-xl border border-slate-300 px-3 text-xs " placeholder="bjud in e-post" />
 <input type="hidden" name="membership_role" value="admin" />
 <input type="hidden" name="role_key" value="company_admin" />
 <button className="h-9 rounded-xl border border-slate-300 px-3 text-xs font-semibold text-slate-700 hover:bg-slate-50 ">
 Bjud in
 </button>
 </form>
 </div>
 </div>
 ))
 )}
 </div>
 </div>
 </section>
 </div>
 </div>
 )
}
