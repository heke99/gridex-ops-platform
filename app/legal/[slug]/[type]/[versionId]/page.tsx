import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { loadPublishedLegalVersion, urlSegmentToLegalType } from '@/lib/legal/publicLegalDocuments'

export const runtime = 'nodejs'
// Published legal versions are immutable, so they may be cached for a while.
export const revalidate = 300

type PageParams = { slug: string; type: string; versionId: string }

const TYPE_LABELS: Record<string, string> = {
  terms: 'Allmänna villkor',
  privacy_policy: 'Integritetspolicy',
  withdrawal: 'Ångerrätt',
  price_terms: 'Prisvillkor',
  power_of_attorney: 'Fullmakt',
}

const POA_SCOPE_LABELS: Record<string, string> = {
  supplier_switch: 'Leverantörsbyte',
  facility_information_lookup: 'Inhämtning av anläggningsuppgifter från nätägare',
  meter_data: 'Inhämtning av mätvärden',
  billing_handoff: 'Överlämning av faktureringsunderlag',
}

function formatDate(value: string | null): string | null {
  if (!value) return null
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return null
  return date.toLocaleDateString('sv-SE', { year: 'numeric', month: 'long', day: 'numeric' })
}

function poaScopes(metadata: Record<string, unknown> | null): string[] {
  const raw = metadata?.scopes
  if (Array.isArray(raw) && raw.length > 0) {
    return raw.map((value) => String(value))
  }
  // Product default: a single power of attorney covers supplier switch and
  // facility information lookup.
  return ['supplier_switch', 'facility_information_lookup']
}

export async function generateMetadata({ params }: { params: Promise<PageParams> }): Promise<Metadata> {
  const { slug, type, versionId } = await params
  const result = await loadPublishedLegalVersion(slug, type, versionId)
  if (!result) return { title: 'Juridiskt dokument' }
  const brand = result.company.brand_name ?? result.company.name ?? 'Elhandelsbolag'
  return {
    title: `${result.version.title} – ${brand}`,
    robots: { index: false, follow: false },
  }
}

export default async function PublicLegalDocumentPage({ params }: { params: Promise<PageParams> }) {
  const { slug, type, versionId } = await params

  if (!urlSegmentToLegalType(type)) notFound()

  const result = await loadPublishedLegalVersion(slug, type, versionId)
  if (!result) notFound()

  const { company, version } = result
  const legalName = company.name ?? company.brand_name ?? 'Elhandelsbolag'
  const typeLabel = TYPE_LABELS[version.type] ?? version.title
  const publishedAt = formatDate(version.published_at)
  const effectiveFrom = formatDate(version.effective_from)
  const isPoa = version.type === 'power_of_attorney'
  const scopes = isPoa ? poaScopes(version.metadata) : []

  const addressLines = [
    company.address_line_1,
    company.address_line_2,
    [company.postal_code, company.city].filter(Boolean).join(' '),
    company.country,
  ].filter((line): line is string => Boolean(line && line.trim()))

  return (
    <main className="min-h-screen bg-slate-100 px-6 py-10 text-slate-950">
      <div className="mx-auto max-w-3xl space-y-6">
        <section className="rounded-[32px] border border-slate-200 bg-white p-8 shadow-sm">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-emerald-800">{typeLabel}</p>
          <h1 className="mt-3 text-3xl font-bold tracking-tight">{version.title}</h1>
          <dl className="mt-5 grid grid-cols-1 gap-3 text-sm text-slate-700 sm:grid-cols-2">
            <div>
              <dt className="font-semibold text-slate-900">Bolag</dt>
              <dd>{legalName}</dd>
            </div>
            {company.org_number ? (
              <div>
                <dt className="font-semibold text-slate-900">Organisationsnummer</dt>
                <dd>{company.org_number}</dd>
              </div>
            ) : null}
            <div>
              <dt className="font-semibold text-slate-900">Version</dt>
              <dd>{version.version}</dd>
            </div>
            {publishedAt ? (
              <div>
                <dt className="font-semibold text-slate-900">Publicerad</dt>
                <dd>{publishedAt}</dd>
              </div>
            ) : null}
            {effectiveFrom ? (
              <div>
                <dt className="font-semibold text-slate-900">Gäller från</dt>
                <dd>{effectiveFrom}</dd>
              </div>
            ) : null}
            {company.support_email ?? company.primary_contact_email ? (
              <div>
                <dt className="font-semibold text-slate-900">Kontakt</dt>
                <dd>{company.support_email ?? company.primary_contact_email}</dd>
              </div>
            ) : null}
            {company.phone ? (
              <div>
                <dt className="font-semibold text-slate-900">Telefon</dt>
                <dd>{company.phone}</dd>
              </div>
            ) : null}
          </dl>
          {addressLines.length > 0 ? (
            <p className="mt-3 text-sm text-slate-600">{addressLines.join(', ')}</p>
          ) : null}
        </section>

        {isPoa ? (
          <section className="rounded-3xl border border-emerald-200 bg-emerald-50 p-6 text-sm leading-6 text-emerald-950">
            <h2 className="text-base font-semibold">Fullmaktens omfattning</h2>
            <ul className="mt-3 list-disc space-y-1 pl-5">
              {scopes.map((scope) => (
                <li key={scope}>{POA_SCOPE_LABELS[scope] ?? scope}</li>
              ))}
            </ul>
          </section>
        ) : null}

        <section className="rounded-[32px] border border-slate-200 bg-white p-8 shadow-sm">
          <article className="whitespace-pre-wrap text-sm leading-6 text-slate-800">{version.body}</article>
        </section>
      </div>
    </main>
  )
}
