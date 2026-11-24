import CompanySelect from '@/components/admin/CompanySelect'
import AdminHeader from '@/components/admin/AdminHeader'
import { isPlatformAdminContext, requireAdminPageKeyAccess } from '@/lib/admin/guards'
import { supabaseService } from '@/lib/supabase/service'
import { isMissingRelationError } from '@/lib/tenant/scope'
import { resolveAdminTenantReadScope } from '@/lib/tenant/adminScope'

export const dynamic = 'force-dynamic'

type AuditRow = {
 id: string
 company_id?: string | null
 action?: string | null
 entity_type?: string | null
 entity_id?: string | null
 created_at?: string | null
 action_label?: string | null
 entity_label?: string | null
}

type AuditSearchParams = {
 action?: string
 entity?: string
 company_id?: string
 q?: string
}

function formatDate(value: string | null | undefined) {
 if (!value) return '–'
 const date = new Date(value)
 if (Number.isNaN(date.getTime())) return value
 return date.toLocaleString('sv-SE')
}

function shortId(value: string | null | undefined) {
 if (!value) return '–'
 return value.length > 14 ? `${value.slice(0, 8)}…${value.slice(-4)}` : value
}

function cleanParam(value: string | string[] | undefined): string {
 const raw = Array.isArray(value) ? value[0] : value
 return String(raw ?? '').trim()
}

export default async function AuditPage({
 searchParams,
}: {
 searchParams?: Promise<AuditSearchParams>
}) {
 const context = await requireAdminPageKeyAccess('audit.log')
 const isPlatformAdmin = isPlatformAdminContext(context)
 const scope = await resolveAdminTenantReadScope(context)
 const params = searchParams ? await searchParams : {}
 const actionFilter = cleanParam(params.action)
 const entityFilter = cleanParam(params.entity)
 const companyFilter = isPlatformAdmin ? cleanParam(params.company_id) : ''
 const textFilter = cleanParam(params.q)

 let rows: AuditRow[] = []
 let loadError: string | null = null

 try {
 let query = (isPlatformAdmin
  ? supabaseService.from('audit_logs').select('id, company_id, action, entity_type, entity_id, created_at')
  : supabaseService.from('gridex_audit_business_v').select('id, created_at, action_label, entity_label'))
 .order('created_at', { ascending: false })
 .order('id', { ascending: false })
 .limit(200)

 if (!isPlatformAdmin) {
 if (!scope.companyId) {
 query = query.eq('company_id', '00000000-0000-0000-0000-000000000000')
 } else {
 query = query.eq('company_id', scope.companyId)
 }
 } else if (companyFilter) {
 query = query.eq('company_id', companyFilter)
 }
 if (actionFilter) query = isPlatformAdmin ? query.ilike('action', `%${actionFilter}%`) : query.eq('action_filter', actionFilter)
 if (entityFilter) query = isPlatformAdmin ? query.ilike('entity_type', `%${entityFilter}%`) : query.eq('entity_filter', entityFilter)
 if (textFilter && isPlatformAdmin) query = query.or(`action.ilike.%${textFilter}%,entity_type.ilike.%${textFilter}%,entity_id.ilike.%${textFilter}%`)

 const { data, error } = await query
 if (error) throw error
 rows = (data ?? []) as AuditRow[]
 if (textFilter && !isPlatformAdmin) rows = rows.filter(row => [row.action_label, row.entity_label].some(value => value?.toLocaleLowerCase('sv-SE').includes(textFilter.toLocaleLowerCase('sv-SE'))))
 } catch (error) {
 if (isMissingRelationError(error) || (error as { code?: string } | null)?.code === '42703') {
 loadError = isPlatformAdmin ? 'Audit-tabellen är inte färdigkonfigurerad i databasen ännu.' : 'Ändringshistoriken kunde inte läsas. Försök igen eller kontakta support.'
 } else {
 throw error
 }
 }

 return (
 <div className="min-h-screen">
 <AdminHeader
 title="Revisionslogg"
 subtitle={isPlatformAdmin ? 'Global spårbarhet för plattform, tenants, Ediel, användare och drift.' : `Spårbarhet för ${scope.companyName ?? 'ditt bolag'}. Du ser bara händelser som hör till ditt bolag.`}
 userEmail={context.email}
 workspaceName={isPlatformAdmin ? 'Gridex Platform' : scope.companyName}
 workspaceMode={isPlatformAdmin ? 'platform' : 'tenant'}
 />

 <div className="min-w-0 space-y-6 p-4 lg:p-8">
 {loadError ? (
 <section className="rounded-3xl border border-amber-200 bg-amber-50 p-5 text-sm font-semibold text-amber-900 shadow-sm">
 {loadError}
 </section>
 ) : null}

 <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
 <h2 className="text-lg font-semibold text-slate-950">Filtrera händelser</h2>
 <form className="mt-4 grid gap-4 md:grid-cols-2 xl:grid-cols-5">
 <label className="grid gap-1 text-sm">
 <span className="font-medium text-slate-700">{isPlatformAdmin ? 'Action' : 'Händelse'}</span>
 {isPlatformAdmin ? <input name="action" defaultValue={actionFilter} placeholder="withdrawal, ediel..." className="rounded-2xl border border-slate-300 px-4 py-3" /> : <select name="action" defaultValue={actionFilter} className="rounded-2xl border border-slate-300 px-4 py-3"><option value="">Alla händelser</option><option value="customer_created_from_import">Kund registrerad från import</option><option value="customer_case_registered">Kundärende registrerat</option><option value="withdrawal_registered">Ånger registrerad</option></select>}
 </label>
 <label className="grid gap-1 text-sm">
 <span className="font-medium text-slate-700">{isPlatformAdmin ? 'Entity' : 'Berörd uppgift'}</span>
 {isPlatformAdmin ? <input name="entity" defaultValue={entityFilter} placeholder="customer_case, ediel..." className="rounded-2xl border border-slate-300 px-4 py-3" /> : <select name="entity" defaultValue={entityFilter} className="rounded-2xl border border-slate-300 px-4 py-3"><option value="">Alla uppgifter</option><option value="customer">Kund</option><option value="customer_contract">Kundavtal</option><option value="customer_case">Kundärende</option><option value="customer_site">Anläggning</option></select>}
 </label>
 {isPlatformAdmin ? (
 <label className="grid gap-1 text-sm">
 <span className="font-medium text-slate-700">Bolag</span>
 <CompanySelect defaultValue={companyFilter} emptyLabel="Alla bolag" className="rounded-2xl border border-slate-300 bg-white px-4 py-3" />
 </label>
 ) : null}
 <label className="grid gap-1 text-sm">
 <span className="font-medium text-slate-700">Fritext</span>
 <input name="q" defaultValue={textFilter} placeholder={isPlatformAdmin ? 'sök action/entity/id' : 'Sök bland inlästa händelser'} className="rounded-2xl border border-slate-300 px-4 py-3" />
 </label>
 <div className="flex items-end">
 <button className="rounded-2xl bg-emerald-700 px-4 py-3 text-sm font-semibold text-white hover:bg-emerald-800">Filtrera</button>
 </div>
 </form>
 </section>

 <section className="rounded-3xl border border-slate-200 bg-white shadow-sm">
 <div className="flex flex-wrap items-start justify-between gap-4 border-b border-slate-200 px-6 py-5">
 <div>
 <h2 className="text-lg font-semibold text-slate-950">Senaste händelser</h2>
 <p className="mt-1 text-sm text-slate-700">
 {isPlatformAdmin ? 'Visar upp till 200 globala audit-händelser med aktuella filter.' : 'Visar upp till 200 händelser för bolaget med aktuella filter.'}
 </p>
 </div>
 <span className="rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-xs font-semibold uppercase tracking-[0.14em] text-emerald-800">
 {isPlatformAdmin ? 'Global vy' : "Valt bolag"}
 </span>
 </div>

 <div role="region" tabIndex={0} aria-label="Kundhistorik" className="overflow-x-auto focus-visible:outline focus-visible:outline-2 focus-visible:outline-emerald-700">
 <table className="min-w-full text-sm">
 <thead className="bg-slate-50">
 <tr className="border-b border-slate-200">
 <th className="px-6 py-4 text-left font-semibold text-slate-700">Tid</th>
 <th className="px-6 py-4 text-left font-semibold text-slate-700">{isPlatformAdmin ? 'Action' : 'Händelse'}</th>
 <th className="px-6 py-4 text-left font-semibold text-slate-700">{isPlatformAdmin ? 'Entity' : 'Berörd uppgift'}</th>
 {isPlatformAdmin ? <th className="px-6 py-4 text-left font-semibold text-slate-700">Entity ID</th> : null}
 {isPlatformAdmin ? <th className="px-6 py-4 text-left font-semibold text-slate-700">Company</th> : null}
 </tr>
 </thead>
 <tbody>
 {rows.length === 0 ? (
 <tr>
 <td colSpan={isPlatformAdmin ? 5 : 3} className="px-6 py-10 text-center text-slate-700">
 {loadError ? 'Händelserna kunde inte läsas.' : 'Inga ändringar hittades i det inlästa urvalet.'}
 </td>
 </tr>
 ) : rows.map((row) => (
 <tr key={row.id} className="border-b border-slate-100 transition hover:bg-slate-50">
 <td className="whitespace-nowrap px-6 py-4 text-slate-700">{formatDate(row.created_at)}</td>
 <td className="px-6 py-4 font-medium text-slate-900">{isPlatformAdmin ? row.action ?? '–' : row.action_label ?? 'Händelse registrerad'}</td>
 <td className="px-6 py-4 text-slate-700">{isPlatformAdmin ? row.entity_type ?? '–' : row.entity_label ?? 'Verksamhetsuppgift'}</td>
 {isPlatformAdmin ? <td className="px-6 py-4 text-slate-700">{shortId(row.entity_id)}</td> : null}
 {isPlatformAdmin ? <td className="px-6 py-4 text-slate-700">{shortId(row.company_id)}</td> : null}
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
