import type { Metadata } from 'next'
import { loadIdentityChangeForApproval } from '@/lib/customer-service/identityChange'
import { decideIdentityChangeAction } from './actions'

export const dynamic = 'force-dynamic'
export const revalidate = 0

export const metadata: Metadata = {
  title: 'Godkänn ändring',
  robots: { index: false, follow: false },
  referrer: 'no-referrer',
}

const RESULT_MESSAGES: Record<string, { title: string; body: string }> = {
  applied: { title: 'Tack! Ändringen är godkänd', body: 'Numret är nu ändrat på ditt kundkonto och dina avtal.' },
  rejected: { title: 'Ändringen är nekad', body: 'Ingenting har ändrats. Kontakta din elhandlare om du har frågor.' },
  expired: { title: 'Länken har gått ut', body: 'Ingenting har ändrats. Kontakta din elhandlare om ändringen ska göras.' },
  identity_change_not_pending: { title: 'Ändringen är redan avgjord', body: 'Länken kan bara användas en gång.' },
  identity_change_stale: { title: 'Ändringen kan inte genomföras', body: 'Uppgiften har ändrats sedan mejlet skickades. Ingenting har ändrats. Kontakta din elhandlare.' },
  identity_change_link_invalid: { title: 'Länken kan inte användas', body: 'Länken är ogiltig. Kontakta din elhandlare.' },
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <main className="min-h-screen bg-slate-50 px-4 py-12 text-slate-950">
      <div className="mx-auto max-w-xl rounded-3xl border border-slate-200 bg-white p-8 shadow-sm">{children}</div>
    </main>
  )
}

export default async function IdentityChangeApprovalPage({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>
  searchParams: Promise<{ result?: string }>
}) {
  const { token } = await params
  const { result } = await searchParams
  if (result) {
    const message = RESULT_MESSAGES[result] ?? RESULT_MESSAGES.identity_change_link_invalid
    return (
      <Shell>
        <h1 className="text-2xl font-semibold">{message.title}</h1>
        <p className="mt-3 text-sm leading-6 text-slate-700">{message.body}</p>
      </Shell>
    )
  }

  let view: Awaited<ReturnType<typeof loadIdentityChangeForApproval>> | null = null
  try {
    view = await loadIdentityChangeForApproval(token)
  } catch {
    view = null
  }
  if (!view || view.status !== 'pending') {
    const message = !view
      ? RESULT_MESSAGES.identity_change_link_invalid
      : view.status === 'expired'
        ? RESULT_MESSAGES.expired
        : RESULT_MESSAGES.identity_change_not_pending
    return (
      <Shell>
        <h1 className="text-2xl font-semibold">{message.title}</h1>
        <p className="mt-3 text-sm leading-6 text-slate-700">{message.body}</p>
      </Shell>
    )
  }

  const label = view.field === 'personal_number' ? 'personnummer' : 'organisationsnummer'
  return (
    <Shell>
      <p className="text-sm font-medium text-slate-500">{view.companyName}</p>
      <h1 className="mt-1 text-2xl font-semibold">Godkänn ändring av {label}</h1>
      <dl className="mt-5 grid grid-cols-2 gap-3 rounded-2xl border border-slate-200 p-4 text-sm">
        <dt className="text-slate-600">Nuvarande</dt>
        <dd className="font-semibold">{view.previousMasked ?? 'saknas'}</dd>
        <dt className="text-slate-600">Nytt</dt>
        <dd className="font-semibold">{view.newMasked}</dd>
        <dt className="text-slate-600">Berörda avtal</dt>
        <dd className="font-semibold">{view.contractCount}</dd>
      </dl>
      <p className="mt-4 text-sm leading-6 text-slate-700">
        Godkänner du ändras {label} på ditt kundkonto och dina avtal. Redan signerade avtalsdokument sparas oförändrade. Känner du inte igen ändringen, välj Neka.
      </p>
      <form action={decideIdentityChangeAction} className="mt-6 flex flex-wrap gap-3">
        <input type="hidden" name="token" value={token} />
        <button type="submit" name="decision" value="approve" className="rounded-xl bg-slate-950 px-4 py-2.5 text-sm font-semibold text-white">
          Godkänn ändringen
        </button>
        <button type="submit" name="decision" value="reject" className="rounded-xl border border-slate-300 px-4 py-2.5 text-sm font-semibold text-slate-900">
          Neka
        </button>
      </form>
    </Shell>
  )
}
