import type { ReactNode } from 'react'
import { requireAdminAccess } from '@/lib/admin/guards'
import { logoutAction } from '@/lib/auth/logoutAction'
import AdminSidebar from '@/components/admin/AdminSidebar'

export const dynamic = 'force-dynamic'

export default async function AdminLayout({
  children,
}: {
  children: ReactNode
}) {
  const admin = await requireAdminAccess()

  return (
    <div className="min-h-screen bg-[#f7fbf8] text-slate-900">
      <div className="grid min-h-screen grid-cols-1 lg:grid-cols-[300px_1fr]">
        <div className="hidden lg:block">
          <AdminSidebar permissions={admin.permissions} />
        </div>

        <div className="flex min-h-screen flex-col">
          <div className="border-b border-emerald-100 bg-white lg:hidden">
            <div className="flex items-center justify-between px-5 py-4">
              <div>
                <p className="text-sm font-semibold text-slate-950">Gridex Operations</p>
                <p className="text-xs text-slate-500">Admin Console</p>
              </div>

              <form action={logoutAction}>
                <button className="rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm font-semibold text-emerald-800 hover:bg-emerald-100">
                  Logga ut
                </button>
              </form>
            </div>
          </div>

          <div className="flex-1">{children}</div>

          <div className="border-t border-emerald-100 bg-white/85 px-6 py-4">
            <div className="flex flex-col items-start justify-between gap-3 text-sm text-slate-500 sm:flex-row sm:items-center">
              <p>Gridex Energy Operations • SaaS Control Center</p>

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
