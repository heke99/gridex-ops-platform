import type { Metadata } from 'next'
import {
  frozenPriceSummary,
  loadOnlineSignatureReceipt,
  loadOnlineSignaturePoaTerms,
  ONLINE_POA_TERMS_VERSION,
} from '@/lib/customer-contracts/onlineSigning'
import { loadContractConfirmationState } from '@/lib/customer-contracts/confirmationDelivery'
import { isRejectedSignatureLink } from '@/lib/customer-contracts/signatureReceiptReadError'
import { signContractAction } from './actions'
import SignSubmitButton from './SignSubmitButton'

const CONFIRMATION_TEXT = {
  queued: 'Avtalsbekräftelsen är köad för utskick till din e-postadress.',
  pending: 'Avtalsbekräftelsen förbereds och skickas till din e-postadress så snart den är klar. Signeringen är giltig.',
  failed: 'Avtalsbekräftelsen kunde inte skickas automatiskt. Signeringen är giltig. Kontakta din elhandlare om du inte får bekräftelsen.',
  unknown: 'Avtalsbekräftelsen skickas till din e-postadress.',
} as const

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

const CONTRACT_TYPE_LABELS: Record<string, string> = {
  fixed: 'Fast pris',
  variable: 'Rörligt pris',
  spot: 'Timpris (spot)',
  hourly: 'Timpris',
  mixed: 'Mixat pris',
  portfolio: 'Portföljpris',
}

function stringValue(value: unknown) {
  return typeof value === 'string' ? value : ''
}

export default async function ContractSigningPage({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>
  searchParams?: Promise<{ error?: string }>
}) {
  const { token } = await params
  const signError = (searchParams ? await searchParams : {}).error === 'not_signed'

  let receipt: Awaited<ReturnType<typeof loadOnlineSignatureReceipt>> | null = null
  try {
    receipt = await loadOnlineSignatureReceipt(token)
  } catch (error) {
    const rejectedLink = isRejectedSignatureLink(error)
    return (
      <main className="min-h-screen bg-slate-50 px-4 py-12 text-slate-950">
        <div className="mx-auto max-w-2xl rounded-3xl border border-slate-200 bg-white p-8 shadow-sm">
          <h1 className="text-2xl font-semibold">
            {rejectedLink ? 'Signeringslänken kan inte användas' : 'Avtalet kunde inte hämtas just nu'}
          </h1>
          <p className="mt-3 text-sm leading-6 text-slate-700">
            {rejectedLink
              ? 'Länken är ogiltig, har löpt ut eller har ersatts av en ny signeringslänk. Kontakta din elhandlare om du behöver en ny länk.'
              : 'Vi kunde inte kontrollera avtalet. Försök igen med samma länk. Kontakta din elhandlare om problemet kvarstår.'}
          </p>
          {!rejectedLink && (
            <a className="mt-5 inline-block font-semibold text-slate-900 underline" href={`/sign/contract/${encodeURIComponent(token)}`}>
              Försök igen med samma länk
            </a>
          )}
        </div>
      </main>
    )
  }

  const signed = Boolean(receipt.signed_at)
  const confirmationState = signed
    ? await loadContractConfirmationState({
        companyId: receipt.company_id,
        signatureRequestId: receipt.request_id,
      }).catch(() => null)
    : null
  const legalVersions = receipt.legal_versions
  const poaTerms = signed ? null : await loadOnlineSignaturePoaTerms(receipt).catch(() => null)

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
              : 'Här ser du avtalet, priset och villkoren som gäller när du trycker på Signera avtal.'}
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
              <dd className="mt-1 font-medium">{CONTRACT_TYPE_LABELS[receipt.contract_type] ?? receipt.contract_type}</dd>
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
        </section>

        <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
          <h2 className="text-lg font-semibold">Villkor och juridiska dokument</h2>
          <p className="mt-2 text-sm leading-6 text-slate-700">
            Det här är villkoren som hör till ditt avtal.
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
                    <div className="mt-3 break-all text-xs text-slate-500">Kontrollkod: {hash}</div>
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
              Avtalet, priset och villkoren är nu sparade. {CONFIRMATION_TEXT[confirmationState ?? 'unknown']}
            </p>
            {receipt.signature_snapshot_sha256 ? (
              <p className="mt-3 break-all text-xs text-emerald-800">
                Kontrollkod för signeringen: {receipt.signature_snapshot_sha256}
              </p>
            ) : null}
          </section>
        ) : (
          <section className="rounded-3xl border border-slate-900 bg-slate-950 p-6 text-white shadow-sm">
            <p className="text-sm leading-6 text-slate-200">
              När du trycker på knappen godkänner du avtalet med det pris och de villkor som visas ovan. Vi sparar signeringens tidpunkt, IP-adress, webbläsaruppgifter och kontrollkoder som bevis.
            </p>
            {signError ? (
              <p role="alert" className="mt-4 rounded-2xl bg-red-100 p-3 text-sm text-red-900">
                Avtalet kunde inte signeras. Försök igen, eller kontakta din elhandlare om felet kvarstår. Du behöver inte begära en ny länk för ett tillfälligt fel.
              </p>
            ) : null}
            <form action={signContractAction} className="mt-5">
              <input type="hidden" name="token" value={token} />
              <input type="hidden" name="power_of_attorney_terms_version" value={ONLINE_POA_TERMS_VERSION} />
              {poaTerms?.siteAddress ? (
                <p className="mb-4 text-sm leading-6">Anläggning: {poaTerms.siteAddress}. {poaTerms.facilityId ? `Anläggnings-ID: ${poaTerms.facilityId}.` : 'Anläggnings-ID hämtas från nätägaren med din fullmakt.'}</p>
              ) : null}
              {poaTerms?.available ? (
                <label className="mb-5 flex items-start gap-3 text-sm leading-6">
                  <input type="checkbox" name="power_of_attorney_accepted" value="yes" required={poaTerms.required}
                    className="mt-1 size-4 shrink-0" />
                  <span>Jag ger {receipt.company_name} fullmakt för anläggningen som hör till detta avtal att hämta anläggnings-, mät- och avtalsuppgifter från nätägare och nuvarande elhandlare samt genomföra leverantörsbytet enligt avtalet och fullmaktstexten ovan. Fullmakten gäller från signeringsdagen till och med dagen före motsvarande datum om tolv månader och kan återkallas. {poaTerms.required ? 'Fullmakt krävs för detta avtal.' : 'Fullmakten är valfri; du kan signera avtalet utan att markera rutan.'}</span>
                </label>
              ) : null}
              {!poaTerms || (poaTerms.required && !poaTerms.available) ? (
                <p role="alert">Fullmaktsvillkoren kunde inte verifieras. Försök ladda om sidan eller kontakta din elhandlare.</p>
              ) : <SignSubmitButton />}
            </form>
          </section>
        )}
      </div>
    </main>
  )
}
