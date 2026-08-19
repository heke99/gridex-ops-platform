import type { Metadata } from 'next'
import {
  frozenPriceSummary,
  loadOnlineSignatureReceipt,
} from '@/lib/customer-contracts/onlineSigning'
import { signContractAction } from './actions'

export const dynamic = 'force-dynamic'
export const revalidate = 0

export const metadata: Metadata = {
  title: 'Signera elavtal',
  robots: { index: false, follow: false },
}

function dateTime(value: string | null | undefined) {
  if (!value) return '—'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return new Intl.DateTimeFormat('sv-SE', {
    dateStyle: 'long',
    timeStyle: 'short',
    timeZone: 'Europe/Stockholm',
  }).format(date)
}

function dateOnly(value: string | null | undefined) {
  if (!value) return '—'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return new Intl.DateTimeFormat('sv-SE', {
    dateStyle: 'long',
    timeZone: 'Europe/Stockholm',
  }).format(date)
}

function stringValue(value: unknown) {
  return typeof value === 'string' ? value : ''
}

export default async function ContractSigningPage({
  params,
}: {
  params: Promise<{ token: string }>
}) {
  const { token } = await params

  let receipt: Awaited<ReturnType<typeof loadOnlineSignatureReceipt>> | null = null
  try {
    receipt = await loadOnlineSignatureReceipt(token)
  } catch {
    return (
      <main className="min-h-screen bg-slate-50 px-4 py-12 text-slate-950">
        <div className="mx-auto max-w-2xl rounded-3xl border border-slate-200 bg-white p-8 shadow-sm">
          <h1 className="text-2xl font-semibold">Signeringslänken kan inte användas</h1>
          <p className="mt-3 text-sm leading-6 text-slate-700">
            Länken är ogiltig, har löpt ut eller har ersatts av en ny signeringslänk. Kontakta din elhandlare om du behöver en ny länk.
          </p>
        </div>
      </main>
    )
  }

  const signed = Boolean(receipt.signed_at)
  const legalVersions = receipt.legal_versions

  return (
    <main className="min-h-screen bg-slate-50 px-4 py-8 text-slate-950 sm:py-12">
      <div className="mx-auto max-w-3xl space-y-5">
        <header className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8">
          <div className="text-sm font-medium text-slate-600">{receipt.company_name}</div>
          <h1 className="mt-2 text-2xl font-semibold sm:text-3xl">
            {signed ? 'Avtalet är signerat' : 'Granska och signera ditt elavtal'}
          </h1>
          <p className="mt-3 text-sm leading-6 text-slate-700">
            {signed
              ? `Signeringen registrerades ${dateTime(receipt.signed_at)}.`
              : 'Uppgifterna nedan är den frysta avtals-, pris- och villkorsversion som blir bindande när du trycker på Signera avtal.'}
          </p>
        </header>

        <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
          <h2 className="text-lg font-semibold">Avtal</h2>
          <dl className="mt-4 grid gap-4 text-sm sm:grid-cols-2">
            <div>
              <dt className="text-slate-500">Kund</dt>
              <dd className="mt-1 font-medium">{receipt.customer_name}</dd>
            </div>
            <div>
              <dt className="text-slate-500">Kundnummer</dt>
              <dd className="mt-1 font-medium">{receipt.customer_number ?? '—'}</dd>
            </div>
            <div>
              <dt className="text-slate-500">Avtal</dt>
              <dd className="mt-1 font-medium">{receipt.contract_name}</dd>
            </div>
            <div>
              <dt className="text-slate-500">Avtalsnummer</dt>
              <dd className="mt-1 font-medium">{receipt.contract_number ?? '—'}</dd>
            </div>
            <div>
              <dt className="text-slate-500">Avtalstyp</dt>
              <dd className="mt-1 font-medium">{receipt.contract_type}</dd>
            </div>
            <div>
              <dt className="text-slate-500">Elområde</dt>
              <dd className="mt-1 font-medium">{receipt.price_area ?? '—'}</dd>
            </div>
            <div>
              <dt className="text-slate-500">Planerad leveransstart</dt>
              <dd className="mt-1 font-medium">{dateOnly(receipt.starts_at)}</dd>
            </div>
            <div>
              <dt className="text-slate-500">Signeringslänk giltig till</dt>
              <dd className="mt-1 font-medium">{dateTime(receipt.expires_at)}</dd>
            </div>
          </dl>
        </section>

        <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
          <h2 className="text-lg font-semibold">Pris som gäller för avtalet</h2>
          <p className="mt-3 text-sm leading-6 text-slate-800">
            {frozenPriceSummary(receipt.pricing_snapshot)}
          </p>
          <p className="mt-3 break-all text-xs text-slate-500">
            Prissnapshot SHA-256: {receipt.pricing_snapshot_sha256}
          </p>
        </section>

        <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
          <h2 className="text-lg font-semibold">Villkor och juridiska dokument</h2>
          <p className="mt-2 text-sm leading-6 text-slate-700">
            Följande exakta dokumentversioner hör till avtalet.
          </p>
          <div className="mt-4 space-y-3">
            {legalVersions.map((version, index) => {
              const id = stringValue(
                version.id ?? version.legal_bundle_version_document_id,
              )
              const title = stringValue(version.title ?? version.module_key) || `Dokument ${index + 1}`
              const body = stringValue(version.body ?? version.rendered_body)
              const hash = stringValue(version.document_sha256 ?? version.body_sha256)
              return (
                <details key={id || `${title}-${index}`} className="rounded-2xl border border-slate-200 p-4">
                  <summary className="cursor-pointer font-medium">{title}</summary>
                  {body ? (
                    <div className="mt-3 whitespace-pre-wrap text-sm leading-6 text-slate-700">
                      {body}
                    </div>
                  ) : null}
                  {hash ? (
                    <div className="mt-3 break-all text-xs text-slate-500">SHA-256: {hash}</div>
                  ) : null}
                </details>
              )
            })}
          </div>
        </section>

        {signed ? (
          <section className="rounded-3xl border border-emerald-200 bg-emerald-50 p-6">
            <h2 className="text-lg font-semibold text-emerald-950">Signeringen är registrerad</h2>
            <p className="mt-2 text-sm leading-6 text-emerald-900">
              Avtalet, prisversionen och de juridiska dokumenten är nu versionslåsta. Avtalsbekräftelsen skickas till din e-postadress.
            </p>
            {receipt.signature_snapshot_sha256 ? (
              <p className="mt-3 break-all text-xs text-emerald-800">
                Signaturbevis SHA-256: {receipt.signature_snapshot_sha256}
              </p>
            ) : null}
          </section>
        ) : (
          <section className="rounded-3xl border border-slate-900 bg-slate-950 p-6 text-white shadow-sm">
            <p className="text-sm leading-6 text-slate-200">
              När du trycker på knappen accepterar du avtalet och de exakta pris- och villkorsversioner som visas ovan. Signeringstid och tekniskt signaturbevis registreras av systemet.
            </p>
            <form action={signContractAction} className="mt-5">
              <input type="hidden" name="token" value={token} />
              <button
                type="submit"
                className="w-full rounded-2xl bg-white px-5 py-4 text-base font-semibold text-slate-950 hover:bg-slate-100"
              >
                Signera avtal
              </button>
            </form>
          </section>
        )}
      </div>
    </main>
  )
}
