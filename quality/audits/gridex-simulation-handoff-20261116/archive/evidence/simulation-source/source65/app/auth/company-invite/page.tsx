import Link from 'next/link'
import { getCompanyInvitationByToken } from '@/lib/auth/companyInvitationFlow'
import { sanitizeCompanyInviteErrorFlash } from '@/lib/auth/loginError'
import { acceptCompanyInvitationAction } from './actions'

export const dynamic = 'force-dynamic'

type CompanyInvitePageProps = {
  searchParams: Promise<{
    token?: string
    error?: string
  }>
}

function formatExpiry(value: string | null | undefined) {
  if (!value) return '–'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleString('sv-SE')
}

function companyName(invitation: Awaited<ReturnType<typeof getCompanyInvitationByToken>>) {
  return invitation?.company_name ?? 'Gridex'
}

export default async function CompanyInvitePage({ searchParams }: CompanyInvitePageProps) {
  const params = await searchParams
  const token = String(params.token ?? '').trim()
  const error = sanitizeCompanyInviteErrorFlash(params.error)
  const invitation = token ? await getCompanyInvitationByToken(token) : null
  const isPending = invitation?.status === 'pending'

  return (
    <main className="flex min-h-screen items-center justify-center bg-gradient-to-br from-white via-slate-50 to-slate-100 p-6">
      <section className="w-full max-w-lg rounded-[2rem] border border-slate-200 bg-white p-8 shadow-xl shadow-slate-200/60">
        <div className="mb-6 inline-flex rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-xs font-semibold uppercase tracking-[0.18em] text-emerald-800">
          Gridex-inbjudan
        </div>

        <h1 className="text-2xl font-bold tracking-tight text-slate-950">Acceptera företagsinbjudan</h1>
        <p className="mt-3 text-sm leading-6 text-slate-700">
          Av säkerhetsskäl accepteras inbjudan först när du trycker på knappen. Det gör att mobilappar och e-postskydd inte kan förbruka länken i bakgrunden.
        </p>

        {error ? (
          <div className="mt-6 rounded-2xl border border-red-200 bg-red-50 p-4 text-sm leading-6 text-red-700">
            {error}
          </div>
        ) : null}

        {!token ? (
          <div className="mt-6 rounded-2xl border border-red-200 bg-red-50 p-4 text-sm leading-6 text-red-700">
            Inbjudningslänken saknar token. Be administratören skicka en ny inbjudan.
          </div>
        ) : null}

        {token && !invitation ? (
          <div className="mt-6 rounded-2xl border border-red-200 bg-red-50 p-4 text-sm leading-6 text-red-700">
            Inbjudan hittades inte eller är inte längre giltig.
          </div>
        ) : null}

        {invitation ? (
          <div className="mt-6 rounded-2xl border border-slate-200 bg-slate-50 p-4 text-sm leading-6 text-slate-700">
            <p><strong>Bolag:</strong> {companyName(invitation)}</p>
            <p><strong>E-post:</strong> {invitation.email}</p>
            <p><strong>Roll:</strong> {invitation.membership_role ?? 'member'}</p>
            <p><strong>Status:</strong> {invitation.status ?? 'pending'}</p>
            <p><strong>Gäller till:</strong> {formatExpiry(invitation.expires_at)}</p>
          </div>
        ) : null}

        {isPending ? (
          <form action={acceptCompanyInvitationAction} className="mt-8">
            <input type="hidden" name="token" value={token} />
            <button className="inline-flex w-full items-center justify-center rounded-2xl bg-emerald-700 px-5 py-3 text-sm font-semibold text-white transition hover:bg-emerald-800 focus:outline-none focus:ring-4 focus:ring-emerald-200">
              Acceptera inbjudan
            </button>
          </form>
        ) : invitation ? (
          <div className="mt-6 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm leading-6 text-amber-800">
            Inbjudan är inte längre pending. Den kan vara accepterad, återkallad eller utgången.
          </div>
        ) : null}

        <div className="mt-6 border-t border-slate-200 pt-6">
          <Link href="/login" className="text-sm font-medium text-slate-700 underline-offset-4 hover:underline">
            Gå till inloggning
          </Link>
        </div>
      </section>
    </main>
  )
}
