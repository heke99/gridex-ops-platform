import AdminHeader from '@/components/admin/AdminHeader'
import { requirePlatformAdminAccess } from '@/lib/admin/guards'
import { createSupabaseServerClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

type RouteRow = {
  id: string
  company_id: string | null
  route_scope: string | null
  route_type: string | null
  is_active: boolean | null
  target_system: string | null
  target_email: string | null
}

export default async function PlatformEdielRoutesPage() {
  const admin = await requirePlatformAdminAccess()
  const supabase = await createSupabaseServerClient()
  const { data, error } = await supabase
    .from('communication_routes')
    .select('id,company_id,route_scope,route_type,is_active,target_system,target_email')
    .order('updated_at', { ascending: false })
    .limit(200)

  if (error) throw error
  const routes = (data ?? []) as RouteRow[]

  return (
    <div className="min-h-screen">
      <AdminHeader title="Platform Ediel routes" subtitle="Global route-governance för Ediel och kommunikation. Company admins använder sin tenant-scopade route-yta." userEmail={admin.email} />
      <div className="grid gap-4 p-4 sm:p-6 xl:grid-cols-2 xl:p-8">
        {routes.map((route) => (
          <article key={route.id} className="min-w-0 rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="flex flex-wrap items-center gap-2">
              <span className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs font-semibold text-slate-700">{route.route_scope ?? 'scope saknas'}</span>
              <span className="rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-semibold text-slate-700">{route.route_type ?? 'type saknas'}</span>
              <span className={`rounded-full border px-3 py-1 text-xs font-semibold ${route.is_active ? 'border-emerald-200 bg-emerald-50 text-emerald-800' : 'border-slate-200 bg-slate-50 text-slate-700'}`}>{route.is_active ? 'Aktiv' : 'Inaktiv'}</span>
            </div>
            <p className="mt-4 break-all text-sm text-slate-700">Company: {route.company_id ?? 'global/okopplad'}</p>
            <p className="mt-2 break-words text-sm font-semibold text-slate-950">{route.target_system ?? route.target_email ?? 'Target saknas'}</p>
          </article>
        ))}
      </div>
    </div>
  )
}
