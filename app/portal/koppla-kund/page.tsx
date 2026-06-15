import Link from 'next/link'
import { redirect } from 'next/navigation'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import ClaimCustomerForm from './ClaimCustomerForm'

export const dynamic = 'force-dynamic'

export default async function PortalClaimCustomerPage() {
  const supabase = await createSupabaseServerClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) redirect('/login')

  return (
    <div className="space-y-6">
      <section className="rounded-[32px] border border-slate-200 bg-white p-8 shadow-sm">
        <div className="inline-flex rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-xs font-semibold uppercase tracking-[0.18em] text-emerald-700">
          Kundportal
        </div>
        <h1 className="mt-4 text-3xl font-bold tracking-tight text-slate-950">
          Säker koppling till Mina sidor
        </h1>
        <p className="mt-4 max-w-3xl text-sm leading-6 text-slate-600">
          När kopplingen är godkänd visas dina fakturor, anläggningar och din
          förbrukning här i kundportalen. Fakturor visas först när din faktura
          har skapats och bekräftats.
        </p>
        <div className="mt-5">
          <Link href="/portal" className="text-sm font-semibold text-slate-700 underline-offset-4 hover:underline">
            Tillbaka till översikten
          </Link>
        </div>
      </section>

      <ClaimCustomerForm userEmail={user.email ?? null} />
    </div>
  )
}
