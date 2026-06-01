import { Suspense, type ReactNode } from 'react'
import { cookies } from 'next/headers'
import { isPlatformAdminContext, requireAdminAccess } from '@/lib/admin/guards'
import { logoutAction } from '@/lib/auth/logoutAction'
import AdminSidebar from '@/components/admin/AdminSidebar'
import { getOperationalCompanyScope } from '@/lib/tenant/scope'
import { getTenantLiveAccessForAdmin } from '@/lib/tenant/liveAccess'
import {
 ADMIN_NAVIGATION_MODE_COOKIE,
 normalizeAdminNavigationMode,
} from '@/lib/admin/navigationPreferences'

export const dynamic = 'force-dynamic'

export default async function AdminLayout({
 children,
}: {
 children: ReactNode
}) {
 const admin = await requireAdminAccess()
 const isPlatformAdmin = isPlatformAdminContext(admin)
 const cookieStore = await cookies()
 const preferredMode = isPlatformAdmin
 ? normalizeAdminNavigationMode(cookieStore.get(ADMIN_NAVIGATION_MODE_COOKIE)?.value) ?? 'platform_view'
 : 'company_view'
 const scope = await getOperationalCompanyScope(admin.userId)
 const liveAccess = await getTenantLiveAccessForAdmin(admin)
 const selectedCompanyId = isPlatformAdmin && preferredMode === 'company_view' ? scope.companyId : null
 const companyOptions = isPlatformAdmin && preferredMode === 'company_view'
 ? scope.memberships.map((membership) => ({
   id: membership.companyId,
   name: membership.companyName,
   status: membership.status,
 }))
 : []
 const workspaceName = isPlatformAdmin && preferredMode === 'company_view'
 ? scope.companyName ?? 'Välj bolag'
 : isPlatformAdmin ? 'Gridex Platform' : scope.companyName ?? 'Bolagsyta saknas'
 const workspaceSubtitle = isPlatformAdmin && preferredMode === 'company_view'
 ? 'Superadmin bolagsvy'
 : isPlatformAdmin ? 'SaaS-plattform' : 'Bolagsyta'

 return (
 <div className="admin-saas-shell min-h-screen bg-[#f7fbf8] text-slate-900">
 <div className="grid min-h-screen grid-cols-1 lg:grid-cols-[300px_1fr]">
 <div className="hidden lg:block">
 <Suspense fallback={<div className="h-screen border-r border-emerald-100 bg-white" />}>
 <AdminSidebar
 permissions={admin.permissions}
 isPlatformAdmin={isPlatformAdmin}
 workspaceName={workspaceName}
 workspaceSubtitle={workspaceSubtitle}
 isCompanyLiveEnabled={isPlatformAdmin || liveAccess.canUseLiveEdiel}
preferredMode={preferredMode}
selectedCompanyId={selectedCompanyId}
companyOptions={companyOptions}
 />
 </Suspense>
 </div>

 <div className="flex min-h-screen flex-col bg-[radial-gradient(circle_at_top_right,rgba(16,185,129,0.08),transparent_28%),linear-gradient(180deg,#f7fbf8_0%,#ffffff_42%,#f7fbf8_100%)]">
 <div className="border-b border-emerald-100/80 bg-white/92 backdrop-blur-xl lg:hidden">
 <div className="flex items-center justify-between px-5 py-4">
 <div className="min-w-0">
 <p className="truncate text-sm font-semibold text-slate-950">{workspaceName}</p>
 <p className="text-xs text-slate-700">{isPlatformAdmin ? 'Plattform' : 'Bolagsyta'}</p>
 </div>

 <form action={logoutAction}>
 <button className="rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm font-semibold text-emerald-800 hover:bg-emerald-100">
 Logga ut
 </button>
 </form>
 </div>
 </div>

 <main className="admin-saas-content flex-1">{children}</main>

 <div className="border-t border-emerald-100/80 bg-white/88 px-6 py-4 backdrop-blur-xl">
 <div className="flex flex-col items-start justify-between gap-3 text-sm text-slate-700 sm:flex-row sm:items-center">
 <p>{isPlatformAdmin ? 'Gridex Energy Operations • Platform Control Center' : `${workspaceName} • Bolagsyta`}</p>

 <div className="flex items-center gap-3">
 <span className="rounded-full border border-emerald-100 bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-800">
 {admin.email ?? 'Användare'}
 </span>

 <form action={logoutAction}>
 <button className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50">
 Logga ut
 </button>
 </form>
 </div>
 </div>
 </div>
 </div>
 </div>
 </div>
 )
}
