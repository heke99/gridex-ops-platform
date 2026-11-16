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
  identity_change_takeover_acceptance_required: { title: 'Godkännandet är inte klart', body: 'Alla tre punkterna måste bekräftas för att ta över avtalen. Öppna länken i mejlet igen och bekräfta alla punkter. Ingenting har ändrats.' },
  identity_change_takeover_changed: { title: 'Avtalsunderlaget har ändrats', body: 'Ingenting har ändrats. Kontakta din elhandlare för en ny länk.' },
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
  const takeover = view.takeover
  return (
    <Shell>
      <p className="text-sm font-medium text-slate-500">{view.companyName}</p>
      <h1 className="mt-1 text-2xl font-semibold">Godkänn ändring av {label}</h1>
      <dl className="mt-5 grid grid-cols-2 gap-3 rounded-2xl border border-slate-200 p-4 text-sm">
        <dt className="text-slate-600">Nuvarande</dt>
        <dd className="font-semibold">{view.previousMasked ?? 'saknas'}</dd>
        <dt className="text-slate-600">Nytt</dt>
        <dd className="font-semibold">{view.newValue}</dd>
        <dt className="text-slate-600">Berörda avtal</dt>
        <dd className="font-semibold">{view.contractCount}</dd>
      </dl>
      <p className="mt-4 text-sm leading-6 text-slate-700">
        Kontrollera att det nya numret stämmer. Godkänner du ändras {label} på kundkontot och avtalen. Redan signerade avtalsdokument sparas oförändrade. Känner du inte igen ändringen, välj Neka.
      </p>

      <form action={decideIdentityChangeAction} className="mt-6 grid gap-4">
        <input type="hidden" name="token" value={token} />
        {takeover ? (
          <section aria-labelledby="takeover-heading" className="grid gap-4 rounded-2xl border border-amber-300 bg-amber-50 p-4">
            <h2 id="takeover-heading" className="text-lg font-semibold text-amber-950">Övertagande av avtal</h2>
            <p className="text-sm leading-6 text-amber-950">
              Avtalen nedan har bindningstid eller uppsägningstid. Ändringen innebär att de förs över till innehavaren av {label} {view.newValue}, som tar över alla rättigheter och skyldigheter. Ändringen görs bara om alla tre punkterna bekräftas.
            </p>
            <ul className="grid gap-2 text-sm">
              {takeover.contracts.map((contract) => (
                <li key={contract.contract_id} className="rounded-xl border border-amber-200 bg-white p-3">
                  <span className="font-semibold">Avtal {contract.contract_number ?? contract.contract_id}</span>
                  {contract.binding_ends_on ? <span> · bindningstid till {contract.binding_ends_on}</span> : null}
                  {contract.notice_months ? <span> · uppsägningstid {contract.notice_months} mån</span> : null}
                  {contract.termination_pending ? <span> · uppsägning pågår</span> : null}
                </li>
              ))}
            </ul>
            {takeover.terms.length > 0 ? (
              <div className="grid gap-2">
                <h3 className="text-sm font-semibold text-amber-950">Villkor</h3>
                {takeover.terms.map((term) => (
                  <details key={term.contentSha256} className="rounded-xl border border-amber-200 bg-white p-3 text-sm">
                    <summary className="cursor-pointer font-medium">{term.title}</summary>
                    {term.body ? <div className="mt-2 max-h-80 overflow-auto whitespace-pre-wrap text-slate-700">{term.body}</div> : <p className="mt-2 text-slate-600">Texten kan inte visas just nu. Kontakta {view.companyName} innan du godkänner.</p>}
                    <p className="mt-2 text-xs text-slate-500">Version {term.contentSha256.slice(0, 12)}</p>
                  </details>
                ))}
              </div>
            ) : null}
            <input type="hidden" name="snapshot_sha256" value={takeover.snapshotSha256} />
            <label className="flex gap-3 text-sm text-amber-950">
              <input type="checkbox" name="confirm_identity" value="yes" required className="mt-1" />
              <span>Jag är innehavare av {label} {view.newValue} och den nya avtalsparten.</span>
            </label>
            <label className="flex gap-3 text-sm text-amber-950">
              <input type="checkbox" name="confirm_contracts" value="yes" required className="mt-1" />
              <span>Jag tar över avtalen ovan med alla rättigheter och skyldigheter, inklusive kvarvarande bindningstid och uppsägningstid.</span>
            </label>
            <label className="flex gap-3 text-sm text-amber-950">
              <input type="checkbox" name="confirm_terms" value="yes" required className="mt-1" />
              <span>Jag har läst och godkänner villkoren ovan.</span>
            </label>
          </section>
        ) : null}
        <div className="flex flex-wrap gap-3">
          <button type="submit" name="decision" value="approve" className="rounded-xl bg-slate-950 px-4 py-2.5 text-sm font-semibold text-white">
            {takeover ? 'Godkänn och ta över avtalen' : 'Godkänn ändringen'}
          </button>
          <button type="submit" name="decision" value="reject" formNoValidate className="rounded-xl border border-slate-300 px-4 py-2.5 text-sm font-semibold text-slate-900">
            Neka
          </button>
        </div>
      </form>
    </Shell>
  )
}
