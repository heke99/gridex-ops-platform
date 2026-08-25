import type { ReactNode } from 'react'
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { getVerifiedAuthUser } from '@/lib/auth/currentUser'
import { logoutAction } from '@/lib/auth/logoutAction'

export const dynamic = 'force-dynamic'

export default async function DashboardLayout({
  children,
}: {
  children: ReactNode
}) {
  const user = await getVerifiedAuthUser()
  if (!user) redirect('/login')

  return (
    <div className="min-h-screen bg-[#f6faf7] text-slate-900">
      <header className="border-b border-emerald-100 bg-white/90 backdrop-blur-xl">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-6 px-6 py-5 sm:px-8">
          <Link href="/dashboard" className="flex items-center gap-3">
            <span className="flex h-10 w-10 items-center justify-center rounded-2xl bg-emerald-700 text-sm font-bold text-white">
              G
            </span>
            <span>
              <span className="block text-xs font-semibold uppercase tracking-[0.18em] text-emerald-700">
                Gridex
              </span>
              <span className="block text-sm font-semibold text-slate-950">Operations</span>
            </span>
          </Link>

          <div className="flex items-center gap-3">
            <nav className="hidden items-center gap-2 md:flex">
              {[
                ['Dashboard', '/dashboard'],
                ['Admin', '/admin'],
                ['Operations', '/admin/operations'],
                ['Kunder', '/admin/customers'],
              ].map(([label, href]) => (
                <Link
                  key={href}
                  href={href}
                  className="rounded-xl border border-emerald-100 bg-emerald-50/70 px-4 py-2 text-sm font-semibold text-emerald-800 transition hover:bg-emerald-100"
                >
                  {label}
                </Link>
              ))}
            </nav>

            <div className="hidden rounded-2xl border border-slate-200 bg-white px-4 py-3 text-right sm:block">
              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">
                Inloggad
              </p>
              <p className="mt-1 max-w-[220px] truncate text-sm font-semibold text-slate-800">
                {user.email ?? 'Användare'}
              </p>
            </div>

            <form action={logoutAction}>
              <button className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-50">
                Logga ut
              </button>
            </form>
          </div>
        </div>
      </header>

      <div className="mx-auto max-w-7xl px-6 py-8 sm:px-8">{children}</div>
    </div>
  )
}
