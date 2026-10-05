import { Suspense, type ReactNode } from 'react'
import { cookies } from 'next/headers'
import { isPlatformAdminContext, requireAdminAccess } from '@/lib/admin/guards'
import { logoutAction } from '@/lib/auth/logoutAction'
import AdminSidebar from '@/components/admin/AdminSidebar'
import { getOperationalCompanyScope, TENANT_COMPANY_REQUIRED_MESSAGE, TenantCompanyRequiredError } from '@/lib/tenant/scope'
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
 let shell: {
 cookieStore: Awaited<ReturnType<typeof cookies>>
 scope: Awaited<ReturnType<typeof getOperationalCompanyScope>>
 liveAccess: Awaited<ReturnType<typeof getTenantLiveAccessForAdmin>>
 }
 try {
 const [cookieStore, scope, liveAccess] = await Promise.all([
 cookies(),
 getOperationalCompanyScope(admin.userId),
 getTenantLiveAccessForAdmin(admin),
 ])
 shell = { cookieStore, scope, liveAccess }
 } catch (error) {
 if (!(error instanceof TenantCompanyRequiredError)) throw error
 // A tenant user without an active company sees no tenant data at all.
 return (
 <div className="flex min-h-screen items-center justify-center bg-[#f7fbf8] p-6 text-slate-900">
 <div className="max-w-md rounded-3xl border border-amber-200 bg-white p-8 shadow-sm">
 <h1 className="text-lg font-black">Inget aktivt bolag</h1>
 <p className="mt-2 text-sm leading-6 text-slate-700">{TENANT_COMPANY_REQUIRED_MESSAGE}</p>
 </div>
 </div>
 )
 }
 const { cookieStore, scope, liveAccess } = shell
 const preferredMode = isPlatformAdmin
 ? normalizeAdminNavigationMode(cookieStore.get(ADMIN_NAVIGATION_MODE_COOKIE)?.value) ?? 'platform_view'
 : 'company_view'
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
 <a href="#admin-main" className="sr-only z-50 rounded-xl bg-white p-3 font-semibold text-emerald-900 focus:not-sr-only focus:absolute focus:left-3 focus:top-3">Hoppa till innehållet</a>
 <div className="grid min-h-screen grid-cols-1 lg:grid-cols-[260px_minmax(0,1fr)]">
 <div className="min-w-0">
 <Suspense fallback={<div className="h-32 border-b border-emerald-100 bg-white lg:h-screen lg:border-b-0 lg:border-r" />}>
 <AdminSidebar
 permissions={admin.permissions}
 roles={admin.roles}
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

 <div className="flex min-h-screen min-w-0 flex-col bg-[radial-gradient(circle_at_top_right,rgba(16,185,129,0.08),transparent_28%),linear-gradient(180deg,#f7fbf8_0%,#ffffff_42%,#f7fbf8_100%)]">
 <main id="admin-main" tabIndex={-1} className="admin-saas-content min-w-0 flex-1">{children}</main>

 <div className="border-t border-emerald-100/80 bg-white/88 px-6 py-4 backdrop-blur-xl">
 <div className="flex flex-col items-start justify-between gap-3 text-sm text-slate-700 sm:flex-row sm:items-center">
 <p>{isPlatformAdmin ? 'Gridex Energy Operations • Platform Control Center' : `${workspaceName} • Bolagsyta`}</p>

 <div className="flex min-w-0 max-w-full flex-wrap items-center gap-3">
 <span className="min-w-0 max-w-full break-all rounded-full border border-emerald-100 bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-800">
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
