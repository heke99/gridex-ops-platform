import AdminHeader from '@/components/admin/AdminHeader'
import { isPlatformAdminContext, requireAdminPageKeyAccess } from '@/lib/admin/guards'
import { supabaseService } from '@/lib/supabase/service'
import { getOperationalCompanyScope, isMissingRelationError } from '@/lib/tenant/scope'

export const dynamic = 'force-dynamic'

type AuditRow = {
 id: string
 company_id?: string | null
 action?: string | null
 entity_type?: string | null
 entity_id?: string | null
 actor_user_id?: string | null
 created_at?: string | null
 new_values?: unknown
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

export default async function AuditPage() {
 const context = await requireAdminPageKeyAccess('audit.log')
 const isPlatformAdmin = isPlatformAdminContext(context)
 const scope = await getOperationalCompanyScope(context.userId)

 let rows: AuditRow[] = []
 let loadError: string | null = null

 try {
 let query = supabaseService
 .from('audit_logs')
 .select('id, company_id, actor_user_id, action, entity_type, entity_id, created_at, new_values')
 .order('created_at', { ascending: false })
 .limit(100)

 if (!isPlatformAdmin) {
 if (!scope.companyId) {
 query = query.eq('company_id', '00000000-0000-0000-0000-000000000000')
 } else {
 query = query.eq('company_id', scope.companyId)
 }
 }

 const { data, error } = await query
 if (error) throw error
 rows = (data ?? []) as AuditRow[]
 } catch (error) {
 if (isMissingRelationError(error) || (error as { code?: string } | null)?.code === '42703') {
 loadError = 'Audit-tabellen är inte färdigkonfigurerad i databasen ännu.'
 } else {
 throw error
 }
 }

 return (
 <div className="min-h-screen">
 <AdminHeader
 title="Revisionslogg"
 subtitle={isPlatformAdmin ? 'Global spårbarhet för plattform, tenants, Ediel, användare och drift.' : `Spårbarhet för ${scope.companyName ?? 'ditt bolag'}. Du ser bara händelser som hör till din tenant.`}
 userEmail={context.email}
 workspaceName={isPlatformAdmin ? 'Gridex Platform' : scope.companyName}
 workspaceMode={isPlatformAdmin ? 'platform' : 'tenant'}
 />

 <div className="space-y-6 p-8">
 {scope.message && !isPlatformAdmin ? (
 <section className="rounded-3xl border border-amber-200 bg-amber-50 p-5 text-sm font-semibold text-amber-900 shadow-sm">
 {scope.message}
 </section>
 ) : null}

 {loadError ? (
 <section className="rounded-3xl border border-amber-200 bg-amber-50 p-5 text-sm font-semibold text-amber-900 shadow-sm">
 {loadError}
 </section>
 ) : null}

 <section className="rounded-3xl border border-slate-200 bg-white shadow-sm">
 <div className="flex flex-wrap items-start justify-between gap-4 border-b border-slate-200 px-6 py-5">
 <div>
 <h2 className="text-lg font-semibold text-slate-950">Senaste händelser</h2>
 <p className="mt-1 text-sm text-slate-700">
 {isPlatformAdmin ? 'Visar de 100 senaste globala audit-händelserna.' : 'Visar de 100 senaste händelserna för bolaget.'}
 </p>
 </div>
 <span className="rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-xs font-semibold uppercase tracking-[0.14em] text-emerald-800">
 {isPlatformAdmin ? 'Global vy' : 'Tenant-skopad'}
 </span>
 </div>

 <div className="overflow-x-auto">
 <table className="min-w-full text-sm">
 <thead className="bg-slate-50">
 <tr className="border-b border-slate-200">
 <th className="px-6 py-4 text-left font-semibold text-slate-700">Tid</th>
 <th className="px-6 py-4 text-left font-semibold text-slate-700">Action</th>
 <th className="px-6 py-4 text-left font-semibold text-slate-700">Entity</th>
 <th className="px-6 py-4 text-left font-semibold text-slate-700">Entity ID</th>
 {isPlatformAdmin ? <th className="px-6 py-4 text-left font-semibold text-slate-700">Company</th> : null}
 </tr>
 </thead>
 <tbody>
 {rows.length === 0 ? (
 <tr>
 <td colSpan={isPlatformAdmin ? 5 : 4} className="px-6 py-10 text-center text-slate-700">
 Inga audit-händelser hittades för aktuellt scope.
 </td>
 </tr>
 ) : rows.map((row) => (
 <tr key={row.id} className="border-b border-slate-100 transition hover:bg-slate-50">
 <td className="whitespace-nowrap px-6 py-4 text-slate-700">{formatDate(row.created_at)}</td>
 <td className="px-6 py-4 font-medium text-slate-900">{row.action ?? '–'}</td>
 <td className="px-6 py-4 text-slate-700">{row.entity_type ?? '–'}</td>
 <td className="px-6 py-4 text-slate-700">{shortId(row.entity_id)}</td>
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
