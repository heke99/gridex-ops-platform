import AdminHeader from '@/components/admin/AdminHeader'
import { requireAdminPageAccess } from '@/lib/admin/guards'
import { createSupabaseServerClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

type SecurityReportRow = {
 table_name: string
 rls_enabled: boolean
 policy_count: number
 policies: string[] | null
}

type Batch3RoleActionRow = {
 role_key: string
 test_area: string
 expected_control: string
 must_pass: boolean
}

type Batch4CRoleActionRow = Batch3RoleActionRow

const ROLE_TESTS = [
 {
 role: 'Superadmin',
 mustAllow: ['Se Bolag A och Bolag B', 'Skapa/pausa bolag', 'Felsöka imports, kunder, ärenden och fakturering över alla tenants'],
 mustBlock: ['Oavsiktlig ändring utan audit log'],
 },
 {
 role: 'Bolagsadmin A',
 mustAllow: ['Skapa kunder i Bolag A', 'Importera kunder till Bolag A', 'Skapa avtal/kampanj i Bolag A', 'Bjuda in användare till Bolag A'],
 mustBlock: ['Läsa Bolag B', 'Skapa kunder i Bolag B via manipulerad company_id', 'Se Bolag B:s importkö eller kundärenden'],
 },
 {
 role: 'Bolagsadmin B',
 mustAllow: ['Samma rättigheter som Bolagsadmin A men endast för Bolag B'],
 mustBlock: ['Läsa eller ändra Bolag A'],
 },
 {
 role: 'Kundservice A',
 mustAllow: ['Se kunder i Bolag A', 'Skapa uppgiftsbegäran', 'Lägga intern kommentar', 'Markera komplettering mottagen'],
 mustBlock: ['Ändra prismotor/kampanj', 'Aktivera live', 'Ändra Ediel-inställningar', 'Se Bolag B'],
 },
 {
 role: 'Ekonomi A',
 mustAllow: ['Se faktureringsunderlag i Bolag A', 'Se blockerade rader', 'Se kund/avtal för fakturafrågor'],
 mustBlock: ['Ändra aktörsprofil', 'Skapa production routes', 'Se Bolag B', 'Ändra kunddata utanför faktureringsbehov'],
 },
]

function statusTone(ok: boolean): string {
 return ok ? 'border-emerald-200 bg-emerald-50 text-emerald-800 ' : 'border-red-200 bg-red-50 text-red-800 '
}

export default async function CustomerTenantTestPage() {
 const access = await requireAdminPageAccess({ anyOf: ['customers.read', 'customers.write', 'platform.security'] })
 const supabase = await createSupabaseServerClient()
 const { data: authResult } = await supabase.auth.getUser()

 const [
 { data, error },
 { data: batch3Data, error: batch3Error },
 { data: batch4cData, error: batch4cError },
 ] = await Promise.all([
 supabase
 .from('gridex_customer_intake_security_report_v')
 .select('*')
 .order('table_name'),
 supabase
 .from('gridex_batch3_role_action_security_v')
 .select('*')
 .order('role_key'),
 supabase
 .from('gridex_batch4c_role_action_security_v')
 .select('*')
 .order('role_key'),
 ])

 const rows = error ? [] : ((data ?? []) as SecurityReportRow[])
 const batch3Rows = batch3Error ? [] : ((batch3Data ?? []) as Batch3RoleActionRow[])
 const batch4cRows = batch4cError ? [] : ((batch4cData ?? []) as Batch4CRoleActionRow[])
 const missingOrWeak = rows.filter((row) => !row.rls_enabled || Number(row.policy_count ?? 0) === 0)

 return (
 <div className="min-h-screen">
 <AdminHeader
 title="Tenant- och rolltest för kundintag"
 subtitle="Kontrollerar RLS/policyrapport och visar exakt testmatris för Bolag A/B, superadmin, bolagsadmin, kundservice och ekonomi."
 userEmail={authResult.user?.email ?? null}
 />

 <div className="space-y-6 p-8">
 {error ? (
 <section className="rounded-3xl border border-amber-200 bg-amber-50 p-6 text-sm text-amber-900 ">
 Kör migrationen för Batch 1/2 först. Säkerhetsvyn kunde inte läsas: {error.message}
 </section>
 ) : null}

 <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm ">
 <div className="flex flex-wrap items-start justify-between gap-3">
 <div>
 <h2 className="text-lg font-semibold text-slate-950 ">Policyrapport</h2>
 <p className="mt-1 text-sm text-slate-700 ">Alla kundintagskritiska tabeller ska ha RLS och minst en policy/service-roll-policy innan systemet räknas tenant-säkert.</p>
 </div>
 <span className={`rounded-full border px-3 py-1 text-xs font-semibold ${statusTone(missingOrWeak.length === 0 && rows.length > 0)}`}>
 {missingOrWeak.length === 0 && rows.length > 0 ? 'RLS-rapport grön' : `${missingOrWeak.length || 'Okänd'} risker`}
 </span>
 </div>

 <div className="mt-5 overflow-hidden rounded-2xl border border-slate-200 ">
 <table className="min-w-full text-sm">
 <thead className="bg-slate-50 text-left text-slate-700 ">
 <tr>
 <th className="px-4 py-3 font-semibold">Tabell</th>
 <th className="px-4 py-3 font-semibold">RLS</th>
 <th className="px-4 py-3 font-semibold">Policies</th>
 <th className="px-4 py-3 font-semibold">Status</th>
 </tr>
 </thead>
 <tbody className="divide-y divide-slate-200 ">
 {rows.map((row) => {
 const ok = row.rls_enabled && Number(row.policy_count ?? 0) > 0
 return (
 <tr key={row.table_name}>
 <td className="px-4 py-3 font-medium text-slate-950 ">{row.table_name}</td>
 <td className="px-4 py-3 text-slate-700 ">{row.rls_enabled ? 'Aktiv' : 'Saknas'}</td>
 <td className="px-4 py-3 text-slate-700 ">{row.policy_count}</td>
 <td className="px-4 py-3"><span className={`rounded-full border px-3 py-1 text-xs font-semibold ${statusTone(ok)}`}>{ok ? 'OK' : 'Risk'}</span></td>
 </tr>
 )
 })}
 </tbody>
 </table>
 </div>
 </section>



 <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm ">
 <h2 className="text-lg font-semibold text-slate-950 ">Batch 3 server-action kontroll</h2>
 <p className="mt-1 text-sm text-slate-700 ">Denna rapport visar vilka roll-/server-action-kontroller som ska verifieras efter Batch 3: prismotor, fakturering, import, audit och bolagsscope.</p>
 {batch3Error ? <p className="mt-3 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900 ">Kör Batch 3-migrationen för att visa roll/action-rapporten: {batch3Error.message}</p> : null}
 <div className="mt-5 grid gap-3 lg:grid-cols-2">
 {batch3Rows.map((row) => (
 <article key={`${row.role_key}-${row.test_area}`} className="rounded-2xl border border-slate-200 bg-slate-50 p-4 ">
 <div className="flex items-center justify-between gap-3">
 <h3 className="text-sm font-semibold text-slate-950 ">{row.role_key}</h3>
 <span className={`rounded-full border px-3 py-1 text-xs font-semibold ${statusTone(Boolean(row.must_pass))}`}>{row.must_pass ? 'Måste passera' : 'Info'}</span>
 </div>
 <p className="mt-2 text-xs font-semibold uppercase tracking-[0.14em] text-slate-500 ">{row.test_area}</p>
 <p className="mt-2 text-sm leading-6 text-slate-700 ">{row.expected_control}</p>
 </article>
 ))}
 </div>
 </section>

 <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm ">
 <h2 className="text-lg font-semibold text-slate-950 ">Batch 4C roll- och exportkontroller</h2>
 <p className="mt-1 text-sm text-slate-700 ">Kontrollerar att fakturering, partnerexport, audit och server actions har rätt bolags- och rollgränser.</p>
 {batch4cError ? <p className="mt-3 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900 ">Kör Batch 4C-migrationen för att visa rapporten: {batch4cError.message}</p> : null}
 <div className="mt-5 grid gap-3 lg:grid-cols-2">
 {batch4cRows.map((row) => (
 <article key={`${row.role_key}-${row.test_area}`} className="rounded-2xl border border-slate-200 bg-slate-50 p-4 ">
 <div className="flex items-center justify-between gap-3">
 <h3 className="text-sm font-semibold text-slate-950 ">{row.role_key}</h3>
 <span className={`rounded-full border px-3 py-1 text-xs font-semibold ${statusTone(Boolean(row.must_pass))}`}>{row.must_pass ? 'Måste passera' : 'Info'}</span>
 </div>
 <p className="mt-2 text-xs font-semibold uppercase tracking-[0.14em] text-slate-500 ">{row.test_area}</p>
 <p className="mt-2 text-sm leading-6 text-slate-700 ">{row.expected_control}</p>
 </article>
 ))}
 </div>
 </section>

 <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm ">
 <h2 className="text-lg font-semibold text-slate-950 ">Rollmatris att köra i UI</h2>
 <p className="mt-1 text-sm text-slate-700 ">Skapa Bolag A och Bolag B, logga in med respektive roll och kör allow/block-listan. Server actions ska blockera även om någon manipulerar formulärdata.</p>
 <div className="mt-5 grid gap-4 xl:grid-cols-2">
 {ROLE_TESTS.map((test) => (
 <article key={test.role} className="rounded-2xl border border-slate-200 bg-slate-50 p-5 ">
 <h3 className="font-semibold text-slate-950 ">{test.role}</h3>
 <div className="mt-4 grid gap-4 md:grid-cols-2">
 <div>
 <div className="text-sm font-semibold text-emerald-800 ">Ska tillåtas</div>
 <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-slate-700 ">
 {test.mustAllow.map((item) => <li key={item}>{item}</li>)}
 </ul>
 </div>
 <div>
 <div className="text-sm font-semibold text-red-800 ">Ska blockeras</div>
 <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-slate-700 ">
 {test.mustBlock.map((item) => <li key={item}>{item}</li>)}
 </ul>
 </div>
 </div>
 </article>
 ))}
 </div>
 </section>
 </div>
 </div>
 )
}
