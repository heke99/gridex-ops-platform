// components/admin/customers/CustomerAuthorizationDocumentsCard.tsx
'use client'

import { useMemo, useState } from 'react'
import { useFormStatus } from 'react-dom'
import type { CustomerSiteRow, MeteringPointRow } from '@/lib/masterdata/types'
import type {
  CustomerAuthorizationDocumentRow,
  PowerOfAttorneyRow,
} from '@/lib/operations/types'
import {
  createAuthorizationRequestPackageAction,
  uploadCustomerAuthorizationDocumentAction,
} from '@/app/admin/customers/[id]/actions'

function SubmitButton({
  idleLabel,
  pendingLabel,
}: {
  idleLabel: string
  pendingLabel: string
}) {
  const { pending } = useFormStatus()

  return (
    <button
      type="submit"
      disabled={pending}
      className="inline-flex items-center justify-center rounded-2xl bg-slate-950 px-4 py-2.5 text-sm font-semibold text-white transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60 dark:bg-white dark:text-slate-950"
    >
      {pending ? pendingLabel : idleLabel}
    </button>
  )
}

function formatDateTime(value: string | null): string {
  if (!value) return '—'
  return new Date(value).toLocaleString('sv-SE')
}

function documentTypeLabel(value: CustomerAuthorizationDocumentRow['document_type']) {
  return value === 'power_of_attorney' ? 'Fullmakt' : 'Komplett avtal'
}

function getPowerOfAttorneyForDocument(
  documentRow: CustomerAuthorizationDocumentRow,
  powersOfAttorney: PowerOfAttorneyRow[]
): PowerOfAttorneyRow | null {
  if (!documentRow.power_of_attorney_id) return null
  return (
    powersOfAttorney.find((row) => row.id === documentRow.power_of_attorney_id) ?? null
  )
}

export default function CustomerAuthorizationDocumentsCard({
  customerId,
  sites,
  meteringPoints,
  documents,
  powersOfAttorney,
}: {
  customerId: string
  sites: CustomerSiteRow[]
  meteringPoints: MeteringPointRow[]
  documents: CustomerAuthorizationDocumentRow[]
  powersOfAttorney: PowerOfAttorneyRow[]
}) {
  const [selectedSiteId, setSelectedSiteId] = useState<string>(sites[0]?.id ?? '')
  const [packageSiteId, setPackageSiteId] = useState<string>(sites[0]?.id ?? '')
  const [documentType, setDocumentType] = useState<'power_of_attorney' | 'complete_agreement'>('power_of_attorney')

  const documentsForSelectedSite = useMemo(() => {
    return documents.filter(
      (row) => row.site_id === packageSiteId || row.site_id === null
    )
  }, [documents, packageSiteId])

  return (
    <section className="grid gap-6 xl:grid-cols-[minmax(0,0.95fr)_minmax(0,1.05fr)]">
      <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900">
        <div>
          <h2 className="text-lg font-semibold text-slate-900 dark:text-white">
            Fullmakt / komplett avtal
          </h2>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
            Ladda upp dokument till kundkortet och koppla det direkt till switch/fullmakt.
          </p>
        </div>

        <form action={uploadCustomerAuthorizationDocumentAction} className="mt-6 space-y-4">
          <input type="hidden" name="customer_id" value={customerId} />

          <div className="grid gap-4 md:grid-cols-2">
            <label className="space-y-1 text-sm text-slate-600 dark:text-slate-300">
              <span className="font-medium">Dokumenttyp</span>
              <select
                name="document_type"
                value={documentType}
                onChange={(event) =>
                  setDocumentType(
                    event.target.value as 'power_of_attorney' | 'complete_agreement'
                  )
                }
                className="w-full rounded-2xl border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-900 outline-none ring-0 focus:border-slate-500 dark:border-slate-700 dark:bg-slate-950 dark:text-white"
              >
                <option value="power_of_attorney">Fullmakt</option>
                <option value="complete_agreement">Komplett avtal</option>
              </select>
            </label>

            <label className="space-y-1 text-sm text-slate-600 dark:text-slate-300">
              <span className="font-medium">Anläggning</span>
              <select
                name="site_id"
                value={selectedSiteId}
                onChange={(event) => setSelectedSiteId(event.target.value)}
                className="w-full rounded-2xl border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-900 outline-none ring-0 focus:border-slate-500 dark:border-slate-700 dark:bg-slate-950 dark:text-white"
              >
                {sites.map((site) => (
                  <option key={site.id} value={site.id}>
                    {site.site_name}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <label className="space-y-1 text-sm text-slate-600 dark:text-slate-300">
              <span className="font-medium">Titel</span>
              <input
                name="title"
                placeholder="Ex. Fullmakt signerad 2026-04-17"
                className="w-full rounded-2xl border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-900 outline-none ring-0 focus:border-slate-500 dark:border-slate-700 dark:bg-slate-950 dark:text-white"
              />
            </label>

            <label className="space-y-1 text-sm text-slate-600 dark:text-slate-300">
              <span className="font-medium">Referens</span>
              <input
                name="reference"
                placeholder="Internt ID / signeringsreferens"
                className="w-full rounded-2xl border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-900 outline-none ring-0 focus:border-slate-500 dark:border-slate-700 dark:bg-slate-950 dark:text-white"
              />
            </label>
          </div>

          <label className="space-y-1 text-sm text-slate-600 dark:text-slate-300">
            <span className="font-medium">Fil</span>
            <input
              name="document_file"
              type="file"
              accept=".pdf,.png,.jpg,.jpeg,.webp"
              className="block w-full rounded-2xl border border-dashed border-slate-300 bg-slate-50 px-3 py-3 text-sm text-slate-700 file:mr-4 file:rounded-xl file:border-0 file:bg-slate-900 file:px-3 file:py-2 file:text-sm file:font-semibold file:text-white dark:border-slate-700 dark:bg-slate-950 dark:text-slate-200 dark:file:bg-white dark:file:text-slate-950"
            />
          </label>

          <div className="grid gap-4 md:grid-cols-2">
            <label className="space-y-1 text-sm text-slate-600 dark:text-slate-300">
              <span className="font-medium">Giltig från</span>
              <input
                name="valid_from"
                type="date"
                className="w-full rounded-2xl border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-900 outline-none ring-0 focus:border-slate-500 dark:border-slate-700 dark:bg-slate-950 dark:text-white"
              />
            </label>

            <label className="space-y-1 text-sm text-slate-600 dark:text-slate-300">
              <span className="font-medium">Giltig till</span>
              <input
                name="valid_to"
                type="date"
                className="w-full rounded-2xl border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-900 outline-none ring-0 focus:border-slate-500 dark:border-slate-700 dark:bg-slate-950 dark:text-white"
              />
            </label>
          </div>

          <label className="space-y-1 text-sm text-slate-600 dark:text-slate-300">
            <span className="font-medium">Anteckning</span>
            <textarea
              name="notes"
              rows={4}
              placeholder="Vad dokumentet ska användas till, signeringsinfo, specialinstruktioner."
              className="w-full rounded-2xl border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-900 outline-none ring-0 focus:border-slate-500 dark:border-slate-700 dark:bg-slate-950 dark:text-white"
            />
          </label>

          <div className="grid gap-3 rounded-2xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-700 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-300">
            <label className="flex items-start gap-3">
              <input name="mark_as_signed" type="checkbox" defaultChecked className="mt-1" />
              <span>
                Markera dokumentet som signerat direkt. För fullmakt krävs signerat dokument för att readiness ska bli OK.
              </span>
            </label>
            <label className="flex items-start gap-3">
              <input
                name="sync_to_power_of_attorney"
                type="checkbox"
                defaultChecked={documentType === 'power_of_attorney'}
                className="mt-1"
              />
              <span>
                Skapa eller uppdatera fullmaktspost samtidigt så att dokumentet kan användas vidare i switchflödet.
              </span>
            </label>
          </div>

          <SubmitButton idleLabel="Ladda upp dokument" pendingLabel="Laddar upp..." />
        </form>
      </div>

      <div className="space-y-6">
        <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h3 className="text-base font-semibold text-slate-900 dark:text-white">
                Skapa request-paket med bilaga
              </h3>
              <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
                Köar nätägarbegäran och en manuell outbound mot nuvarande leverantör med vald fullmakt eller avtal i payloaden.
              </p>
            </div>
            <div className="rounded-2xl bg-slate-50 px-4 py-3 text-sm dark:bg-slate-950">
              <div className="text-slate-500 dark:text-slate-400">Mätpunkter</div>
              <div className="mt-1 font-semibold text-slate-950 dark:text-white">{meteringPoints.length}</div>
            </div>
          </div>

          <form action={createAuthorizationRequestPackageAction} className="mt-6 space-y-4">
            <input type="hidden" name="customer_id" value={customerId} />

            <div className="grid gap-4 md:grid-cols-2">
              <label className="space-y-1 text-sm text-slate-600 dark:text-slate-300">
                <span className="font-medium">Anläggning</span>
                <select
                  name="site_id"
                  value={packageSiteId}
                  onChange={(event) => setPackageSiteId(event.target.value)}
                  className="w-full rounded-2xl border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-900 outline-none ring-0 focus:border-slate-500 dark:border-slate-700 dark:bg-slate-950 dark:text-white"
                >
                  {sites.map((site) => (
                    <option key={site.id} value={site.id}>
                      {site.site_name}
                    </option>
                  ))}
                </select>
              </label>

              <label className="space-y-1 text-sm text-slate-600 dark:text-slate-300">
                <span className="font-medium">Dokument att skicka med</span>
                <select
                  name="authorization_document_id"
                  className="w-full rounded-2xl border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-900 outline-none ring-0 focus:border-slate-500 dark:border-slate-700 dark:bg-slate-950 dark:text-white"
                >
                  {documentsForSelectedSite.map((row) => (
                    <option key={row.id} value={row.id}>
                      {documentTypeLabel(row.document_type)} · {row.title ?? row.file_name ?? row.id}
                    </option>
                  ))}
                </select>
              </label>
            </div>

            <div className="grid gap-3 rounded-2xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-700 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-300">
              <label className="flex items-start gap-3">
                <input name="include_customer_masterdata" type="checkbox" defaultChecked className="mt-1" />
                <span>Begär masterdata/anläggningsuppgifter från nätägaren.</span>
              </label>
              <label className="flex items-start gap-3">
                <input name="include_meter_values" type="checkbox" defaultChecked className="mt-1" />
                <span>Begär mätvärden från nätägaren.</span>
              </label>
              <label className="flex items-start gap-3">
                <input name="include_billing_underlay" type="checkbox" defaultChecked className="mt-1" />
                <span>Begär billingunderlag från nätägaren.</span>
              </label>
              <label className="flex items-start gap-3">
                <input name="include_current_supplier_request" type="checkbox" defaultChecked className="mt-1" />
                <span>
                  Skapa även manuell outbound till nuvarande leverantör så att fullmakten/avtalet följer med direkt.
                </span>
              </label>
            </div>

            <div className="grid gap-4 md:grid-cols-3">
              <label className="space-y-1 text-sm text-slate-600 dark:text-slate-300">
                <span className="font-medium">Period från</span>
                <input name="requested_period_start" type="date" className="w-full rounded-2xl border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-900 outline-none ring-0 focus:border-slate-500 dark:border-slate-700 dark:bg-slate-950 dark:text-white" />
              </label>
              <label className="space-y-1 text-sm text-slate-600 dark:text-slate-300">
                <span className="font-medium">Period till</span>
                <input name="requested_period_end" type="date" className="w-full rounded-2xl border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-900 outline-none ring-0 focus:border-slate-500 dark:border-slate-700 dark:bg-slate-950 dark:text-white" />
              </label>
              <label className="space-y-1 text-sm text-slate-600 dark:text-slate-300">
                <span className="font-medium">Extern referens</span>
                <input name="external_reference" className="w-full rounded-2xl border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-900 outline-none ring-0 focus:border-slate-500 dark:border-slate-700 dark:bg-slate-950 dark:text-white" />
              </label>
            </div>

            <label className="space-y-1 text-sm text-slate-600 dark:text-slate-300">
              <span className="font-medium">Anteckning till request-paketet</span>
              <textarea
                name="notes"
                rows={4}
                placeholder="T.ex. begär komplett anläggningsunderlag inför flytt/switch. Dokumentbilaga ska vidare till både nätägare och nuvarande leverantör."
                className="w-full rounded-2xl border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-900 outline-none ring-0 focus:border-slate-500 dark:border-slate-700 dark:bg-slate-950 dark:text-white"
              />
            </label>

            <SubmitButton idleLabel="Skapa request-paket" pendingLabel="Köar paket..." />
          </form>
        </div>

        <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900">
          <div>
            <h3 className="text-base font-semibold text-slate-900 dark:text-white">
              Registrerade dokument
            </h3>
            <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
              Dokumenten är sparade på kundkortet och kan återanvändas i nya request-paket.
            </p>
          </div>

          <div className="mt-4 space-y-3">
            {documents.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-slate-300 px-4 py-8 text-center text-sm text-slate-500 dark:border-slate-700 dark:text-slate-400">
                Inga uppladdade fullmakter eller kompletta avtal ännu.
              </div>
            ) : (
              documents.map((documentRow) => {
                const site =
                  sites.find((row) => row.id === documentRow.site_id) ?? null
                const linkedPowerOfAttorney = getPowerOfAttorneyForDocument(
                  documentRow,
                  powersOfAttorney
                )

                return (
                  <article
                    key={documentRow.id}
                    className="rounded-2xl border border-slate-200 p-4 dark:border-slate-800"
                  >
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <div className="text-sm font-semibold text-slate-900 dark:text-white">
                          {documentTypeLabel(documentRow.document_type)} ·{' '}
                          {documentRow.title ?? documentRow.file_name ?? documentRow.id}
                        </div>
                        <div className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                          {site?.site_name ?? 'Kundnivå'} · uppladdad {formatDateTime(documentRow.uploaded_at)}
                        </div>
                      </div>
                      <div className="rounded-full bg-slate-100 px-3 py-1 text-xs font-medium text-slate-700 dark:bg-slate-800 dark:text-slate-300">
                        {documentRow.status}
                      </div>
                    </div>

                    <div className="mt-3 grid gap-3 text-sm text-slate-600 dark:text-slate-300 md:grid-cols-2">
                      <div>
                        <span className="font-medium">Fil:</span> {documentRow.file_name ?? '—'}
                      </div>
                      <div>
                        <span className="font-medium">Storage path:</span> {documentRow.file_path}
                      </div>
                      <div>
                        <span className="font-medium">Referens:</span> {documentRow.reference ?? '—'}
                      </div>
                      <div>
                        <span className="font-medium">Kopplad fullmakt:</span>{' '}
                        {linkedPowerOfAttorney
                          ? `${linkedPowerOfAttorney.status} (${linkedPowerOfAttorney.id})`
                          : 'ingen'}
                      </div>
                    </div>

                    {documentRow.notes ? (
                      <div className="mt-3 rounded-2xl bg-slate-50 px-4 py-3 text-sm text-slate-600 dark:bg-slate-950 dark:text-slate-300">
                        {documentRow.notes}
                      </div>
                    ) : null}
                  </article>
                )
              })
            )}
          </div>
        </div>
      </div>
    </section>
  )
}