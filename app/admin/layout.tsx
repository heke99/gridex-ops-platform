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
    <div className="min-h-screen bg-slate-100 text-slate-900 dark:bg-slate-950 dark:text-white">
      <div className="grid min-h-screen grid-cols-1 lg:grid-cols-[320px_1fr]">
        <div className="hidden lg:block">
          <AdminSidebar />
        </div>

        <div className="flex min-h-screen flex-col">
          <div className="border-b border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900 lg:hidden">
            <div className="flex items-center justify-between px-5 py-4">
              <div>
                <p className="text-sm font-semibold text-slate-900 dark:text-white">
                  Gridex Ops
                </p>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  Admin Console
                </p>
              </div>

              <form action={logoutAction}>
                <button className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800">
                  Logga ut
                </button>
              </form>
            </div>
          </div>

          <div className="flex-1">{children}</div>

          <div className="border-t border-slate-200 bg-white px-6 py-4 dark:border-slate-800 dark:bg-slate-900">
            <div className="flex flex-col items-start justify-between gap-3 text-sm text-slate-500 dark:text-slate-400 sm:flex-row sm:items-center">
              <p>Gridex Ops • Admin Foundation</p>

              <div className="flex items-center gap-3">
                <span className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs font-medium text-slate-600 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300">
                  {admin.email ?? 'Ingen e-post'}
                </span>

                <form action={logoutAction}>
                  <button className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800">
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