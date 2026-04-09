import type { ReactNode } from 'react'
import Link from 'next/link'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { logoutAction } from '@/lib/auth/logoutAction'

export const dynamic = 'force-dynamic'

export default async function DashboardLayout({
  children,
}: {
  children: ReactNode
}) {
  const supabase = await createSupabaseServerClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()

  return (
    <div className="min-h-screen bg-slate-100 text-slate-900">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-6 px-6 py-5 sm:px-8">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
              Gridex CIS
            </p>
            <h1 className="mt-1 text-xl font-semibold tracking-tight text-slate-950">
              Intern dashboard
            </h1>
          </div>

          <div className="flex items-center gap-3">
            <nav className="hidden items-center gap-2 md:flex">
              <Link
                href="/dashboard"
                className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-100"
              >
                Dashboard
              </Link>
              <Link
                href="/admin"
                className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-100"
              >
                Admin
              </Link>
              <Link
                href="/admin/operations"
                className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-100"
              >
                Operations
              </Link>
              <Link
                href="/admin/customers"
                className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-100"
              >
                Kunder
              </Link>
            </nav>

            <div className="hidden rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-right sm:block">
              <p className="text-xs font-medium uppercase tracking-[0.16em] text-slate-500">
                Inloggad som
              </p>
              <p className="mt-1 text-sm font-medium text-slate-800">
                {user?.email ?? 'Okänd användare'}
              </p>
            </div>

            <form action={logoutAction}>
              <button className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-50">
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