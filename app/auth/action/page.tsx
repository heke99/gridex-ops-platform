import Link from 'next/link'
import {
  getDefaultNextPathForAuthType,
  getSafeNextPath,
  normalizeAuthEmailType,
} from '@/lib/auth/authEmailFlow'
import { verifyAuthEmailAction } from './actions'

export const dynamic = 'force-dynamic'

type AuthActionPageProps = {
  searchParams: Promise<{
    token_hash?: string
    type?: string
    next?: string
    error?: string
  }>
}

function getCopy(type: string | null) {
  if (type === 'recovery') {
    return {
      eyebrow: 'Återställ lösenord',
      title: 'Bekräfta återställningen',
      body: 'Tryck på knappen nedan för att aktivera länken och välja ett nytt lösenord.',
      button: 'Fortsätt till nytt lösenord',
    }
  }

  if (type === 'invite') {
    return {
      eyebrow: 'Inbjudan',
      title: 'Acceptera din inbjudan',
      body: 'Tryck på knappen nedan för att acceptera inbjudan och skapa ditt lösenord.',
      button: 'Acceptera inbjudan',
    }
  }

  if (type === 'magiclink') {
    return {
      eyebrow: 'Säker inloggning',
      title: 'Logga in med engångslänk',
      body: 'Tryck på knappen nedan för att logga in säkert.',
      button: 'Logga in',
    }
  }

  if (type === 'email_change') {
    return {
      eyebrow: 'Bekräfta e-post',
      title: 'Bekräfta ny e-postadress',
      body: 'Tryck på knappen nedan för att bekräfta ändringen av e-postadress.',
      button: 'Bekräfta e-postadress',
    }
  }

  return {
    eyebrow: 'Bekräfta konto',
    title: 'Bekräfta din e-postadress',
    body: 'Tryck på knappen nedan för att bekräfta kontot och fortsätta.',
    button: 'Bekräfta konto',
  }
}

export default async function AuthActionPage({ searchParams }: AuthActionPageProps) {
  const params = await searchParams
  const type = normalizeAuthEmailType(params.type ?? null)
  const tokenHash = String(params.token_hash ?? '').trim()
  const nextPath = getSafeNextPath(params.next, getDefaultNextPathForAuthType(type))
  const copy = getCopy(type)

  const error = params.error
  const hasLinkData = Boolean(tokenHash && type)

  return (
    <main className="flex min-h-screen items-center justify-center bg-gradient-to-br from-white via-slate-50 to-slate-100 p-6">
      <section className="w-full max-w-lg rounded-[2rem] border border-slate-200 bg-white p-8 shadow-xl shadow-slate-200/60">
        <div className="mb-6 inline-flex rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs font-semibold uppercase tracking-[0.18em] text-slate-600">
          {copy.eyebrow}
        </div>

        <h1 className="text-2xl font-bold tracking-tight text-slate-950">{copy.title}</h1>
        <p className="mt-3 text-sm leading-6 text-slate-700">{copy.body}</p>

        <div className="mt-6 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm leading-6 text-amber-900">
          Av säkerhetsskäl verifieras länken först när du trycker på knappen. Det skyddar mot att mobilappar eller e-postskydd förbrukar länken i bakgrunden.
        </div>

        {error ? (
          <div className="mt-6 rounded-2xl border border-red-200 bg-red-50 p-4 text-sm leading-6 text-red-700">
            {error}
          </div>
        ) : null}

        {hasLinkData ? (
          <form action={verifyAuthEmailAction} className="mt-8">
            <input type="hidden" name="token_hash" value={tokenHash} />
            <input type="hidden" name="type" value={type ?? ''} />
            <input type="hidden" name="next" value={nextPath} />
            <button className="inline-flex w-full items-center justify-center rounded-2xl bg-slate-950 px-5 py-3 text-sm font-semibold text-white transition hover:bg-black focus:outline-none focus:ring-4 focus:ring-slate-300">
              {copy.button}
            </button>
          </form>
        ) : (
          <div className="mt-8 rounded-2xl border border-red-200 bg-red-50 p-4 text-sm leading-6 text-red-700">
            Länken saknar giltig verifieringsinformation. Begär en ny länk och försök igen.
          </div>
        )}

        <div className="mt-6 border-t border-slate-200 pt-6">
          <Link href="/login" className="text-sm font-medium text-slate-700 underline-offset-4 hover:underline">
            Tillbaka till inloggning
          </Link>
        </div>
      </section>
    </main>
  )
}
