'use client'

import { useEffect, useMemo, useState } from 'react'
import { useFormStatus } from 'react-dom'
import type { CustomerSiteRow, MeteringPointRow } from '@/lib/masterdata/types'
import type {
  CustomerAuthorizationDocumentRow,
  PowerOfAttorneyRow,
  SupplierSwitchRequestRow,
} from '@/lib/operations/types'
import type {
  GridOwnerDataRequestRow,
  OutboundRequestRow,
} from '@/lib/cis/types'
import {
  archiveCustomerAuthorizationDocumentAction,
  setCustomerAuthorizationDocumentActiveAction,
  uploadCustomerAuthorizationDocumentAction,
} from '@/app/admin/customers/[id]/document-actions'

function SubmitButton({
  idleLabel,
  pendingLabel,
  tone = 'primary',
}: {
  idleLabel: string
  pendingLabel: string
  tone?: 'primary' | 'secondary' | 'danger'
}) {
  const { pending } = useFormStatus()

  const toneClass =
    tone === 'danger'
      ? 'bg-rose-600 text-white hover:bg-rose-700'
      : tone === 'secondary'
        ? 'bg-white text-slate-900 ring-1 ring-slate-300 hover:bg-slate-50 dark:bg-slate-950 dark:text-white dark:ring-slate-700 dark:hover:bg-slate-900'
        : 'bg-slate-950 text-white hover:opacity-90 dark:bg-white dark:text-slate-950'

  return (
    <button
      type="submit"
      disabled={pending}
      className={`inline-flex items-center justify-center rounded-2xl px-4 py-2.5 text-sm font-semibold transition disabled:cursor-not-allowed disabled:opacity-60 ${toneClass}`}
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

function getRecordValue(
  value: unknown,
  key: string
): unknown {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
  return (value as Record<string, unknown>)[key]
}

function getString(
  value: unknown,
  key: string
): string | null {
  const raw = getRecordValue(value, key)
  return typeof raw === 'string' ? raw : null
}

function statusBadgeClass(status: string) {
  switch (status) {
    case 'active':
    case 'signed':
    case 'received':
    case 'completed':
    case 'acknowledged':
      return 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300'
    case 'archived':
    case 'revoked':
    case 'cancelled':
      return 'bg-slate-200 text-slate-700 dark:bg-slate-800 dark:text-slate-300'
    case 'failed':
    case 'rejected':
      return 'bg-rose-100 text-rose-700 dark:bg-rose-500/10 dark:text-rose-300'
    default:
      return 'bg-amber-100 text-amber-700 dark:bg-amber-500/10 dark:text-amber-300'
  }
}

type RelationsResponse = {
  gridOwnerDataRequests: GridOwnerDataRequestRow[]
  outboundRequests: OutboundRequestRow[]
  switchRequests: SupplierSwitchRequestRow[]
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
  const [documentType, setDocumentType] = useState<'power_of_attorney' | 'complete_agreement'>(
    'power_of_attorney'
  )
  const [relations, setRelations] = useState<RelationsResponse>({
    gridOwnerDataRequests: [],
    outboundRequests: [],
    switchRequests: [],
  })

  useEffect(() => {
    let cancelled = false

    async function loadRelations() {
      try {
        const response = await fetch(
          `/api/admin/customer-documents/relations?customerId=${encodeURIComponent(customerId)}`,
          {
            method: 'GET',
            cache: 'no-store',
          }
        )

        if (!response.ok) return

        const json = (await response.json()) as RelationsResponse
        if (!cancelled) {
          setRelations({
            gridOwnerDataRequests: json.gridOwnerDataRequests ?? [],
            outboundRequests: json.outboundRequests ?? [],
            switchRequests: json.switchRequests ?? [],
          })
        }
      } catch {
        // tyst fallback
      }
    }

    loadRelations()

    return () => {
      cancelled = true
    }
  }, [customerId])

  const replaceableDocuments = useMemo(() => {
    return documents.filter((row) => {
      const sameType = row.document_type === documentType
      const sameScope =
        (selectedSiteId ? row.site_id === selectedSiteId : row.site_id === null) ||
        row.site_id === null

      return sameType && sameScope && row.status !== 'archived'
    })
  }, [documents, documentType, selectedSiteId])

  const documentsForRender = useMemo(() => {
    return [...documents].sort((a, b) => {
      if (a.status === 'active' && b.status !== 'active') return -1
      if (a.status !== 'active' && b.status === 'active') return 1
      return new Date(b.uploaded_at).getTime() - new Date(a.uploaded_at).getTime()
    })
  }, [documents])

  return (
    <section className="grid gap-6 xl:grid-cols-[minmax(0,0.95fr)_minmax(0,1.05fr)]">
      <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900">
        <div>
          <h2 className="text-lg font-semibold text-slate-900 dark:text-white">
            Fullmakt / komplett avtal
          </h2>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
            Upload kan nu skapa fullmakt, nätägarbegäran, supplier switch och outbound direkt.
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
                className="w-full rounded-2xl border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-900 outline-none focus:border-slate-500 dark:border-slate-700 dark:bg-slate-950 dark:text-white"
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
                className="w-full rounded-2xl border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-900 outline-none focus:border-slate-500 dark:border-slate-700 dark:bg-slate-950 dark:text-white"
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
                className="w-full rounded-2xl border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-900 outline-none focus:border-slate-500 dark:border-slate-700 dark:bg-slate-950 dark:text-white"
              />
            </label>

            <label className="space-y-1 text-sm text-slate-600 dark:text-slate-300">
              <span className="font-medium">Referens</span>
              <input
                name="reference"
                placeholder="Internt ID / signeringsreferens"
                className="w-full rounded-2xl border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-900 outline-none focus:border-slate-500 dark:border-slate-700 dark:bg-slate-950 dark:text-white"
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

          <div className="grid gap-4 md:grid-cols-3">
            <label className="space-y-1 text-sm text-slate-600 dark:text-slate-300">
              <span className="font-medium">Giltig från</span>
              <input
                name="valid_from"
                type="date"
                className="w-full rounded-2xl border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-900 outline-none focus:border-slate-500 dark:border-slate-700 dark:bg-slate-950 dark:text-white"
              />
            </label>

            <label className="space-y-1 text-sm text-slate-600 dark:text-slate-300">
              <span className="font-medium">Giltig till</span>
              <input
                name="valid_to"
                type="date"
                className="w-full rounded-2xl border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-900 outline-none focus:border-slate-500 dark:border-slate-700 dark:bg-slate-950 dark:text-white"
              />
            </label>

            <label className="space-y-1 text-sm text-slate-600 dark:text-slate-300">
              <span className="font-medium">Switch startdatum</span>
              <input
                name="requested_start_date"
                type="date"
                className="w-full rounded-2xl border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-900 outline-none focus:border-slate-500 dark:border-slate-700 dark:bg-slate-950 dark:text-white"
              />
            </label>
          </div>

          <div className="grid gap-4 md:grid-cols-3">
            <label className="space-y-1 text-sm text-slate-600 dark:text-slate-300">
              <span className="font-medium">Begär period från</span>
              <input
                name="requested_period_start"
                type="date"
                className="w-full rounded-2xl border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-900 outline-none focus:border-slate-500 dark:border-slate-700 dark:bg-slate-950 dark:text-white"
              />
            </label>

            <label className="space-y-1 text-sm text-slate-600 dark:text-slate-300">
              <span className="font-medium">Begär period till</span>
              <input
                name="requested_period_end"
                type="date"
                className="w-full rounded-2xl border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-900 outline-none focus:border-slate-500 dark:border-slate-700 dark:bg-slate-950 dark:text-white"
              />
            </label>

            <label className="space-y-1 text-sm text-slate-600 dark:text-slate-300">
              <span className="font-medium">Switchtyp</span>
              <select
                name="request_type"
                className="w-full rounded-2xl border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-900 outline-none focus:border-slate-500 dark:border-slate-700 dark:bg-slate-950 dark:text-white"
                defaultValue="switch"
              >
                <option value="switch">Switch</option>
                <option value="move_in">Inflytt</option>
                <option value="move_out_takeover">Övertag</option>
              </select>
            </label>
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <label className="space-y-1 text-sm text-slate-600 dark:text-slate-300">
              <span className="font-medium">Extern referens</span>
              <input
                name="external_reference"
                placeholder="Extern referens / korrelation"
                className="w-full rounded-2xl border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-900 outline-none focus:border-slate-500 dark:border-slate-700 dark:bg-slate-950 dark:text-white"
              />
            </label>

            <label className="space-y-1 text-sm text-slate-600 dark:text-slate-300">
              <span className="font-medium">Ersätt tidigare dokument</span>
              <select
                name="replace_document_id"
                defaultValue=""
                className="w-full rounded-2xl border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-900 outline-none focus:border-slate-500 dark:border-slate-700 dark:bg-slate-950 dark:text-white"
              >
                <option value="">Ingen ersättning</option>
                {replaceableDocuments.map((row) => (
                  <option key={row.id} value={row.id}>
                    {documentTypeLabel(row.document_type)} · {row.title ?? row.file_name ?? row.id}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <label className="space-y-1 text-sm text-slate-600 dark:text-slate-300">
            <span className="font-medium">Anteckning</span>
            <textarea
              name="notes"
              rows={4}
              placeholder="Vad dokumentet ska användas till, signeringsinfo, specialinstruktioner."
              className="w-full rounded-2xl border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-900 outline-none focus:border-slate-500 dark:border-slate-700 dark:bg-slate-950 dark:text-white"
            />
          </label>

          <div className="grid gap-3 rounded-2xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-700 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-300">
            <label className="flex items-start gap-3">
              <input name="mark_as_signed" type="checkbox" defaultChecked className="mt-1" />
              <span>Markera dokumentet som signerat direkt.</span>
            </label>

            <label className="flex items-start gap-3">
              <input
                name="sync_to_power_of_attorney"
                type="checkbox"
                defaultChecked={documentType === 'power_of_attorney'}
                className="mt-1"
              />
              <span>Skapa/koppla fullmaktspost samtidigt.</span>
            </label>

            <label className="flex items-start gap-3">
              <input name="set_as_active" type="checkbox" defaultChecked className="mt-1" />
              <span>Sätt dokumentet som aktivt standarddokument.</span>
            </label>

            <label className="flex items-start gap-3">
              <input
                name="archive_previous_active"
                type="checkbox"
                defaultChecked
                className="mt-1"
              />
              <span>Arkivera äldre aktiva standarddokument för samma scope/typ.</span>
            </label>
          </div>

          <div className="grid gap-3 rounded-2xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-700 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-300">
            <label className="flex items-start gap-3">
              <input
                name="auto_create_grid_owner_requests"
                type="checkbox"
                defaultChecked
                className="mt-1"
              />
              <span>Skapa nätägarbegäran direkt från upload.</span>
            </label>

            <div className="grid gap-2 pl-6">
              <label className="flex items-start gap-3">
                <input
                  name="include_customer_masterdata"
                  type="checkbox"
                  defaultChecked
                  className="mt-1"
                />
                <span>Inkludera kund/masterdata-begäran.</span>
              </label>
              <label className="flex items-start gap-3">
                <input name="include_meter_values" type="checkbox" defaultChecked className="mt-1" />
                <span>Inkludera mätvärdesbegäran.</span>
              </label>
              <label className="flex items-start gap-3">
                <input
                  name="include_billing_underlay"
                  type="checkbox"
                  defaultChecked
                  className="mt-1"
                />
                <span>Inkludera billing-underlay-begäran.</span>
              </label>
            </div>

            <label className="flex items-start gap-3">
              <input
                name="auto_create_switch_request"
                type="checkbox"
                defaultChecked
                className="mt-1"
              />
              <span>Skapa supplier switch request direkt om readiness är OK.</span>
            </label>

            <label className="flex items-start gap-3">
              <input
                name="auto_queue_switch_outbound"
                type="checkbox"
                defaultChecked
                className="mt-1"
              />
              <span>Köa supplier-switch outbound direkt från upload.</span>
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
                Dokumenthistorik och kopplingar
              </h3>
              <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
                Öppna, ladda ner, sätt aktiv, arkivera och följ vilka requests/outbounds som kom från dokumentet.
              </p>
            </div>
            <div className="rounded-2xl bg-slate-100 px-3 py-1 text-xs font-medium text-slate-600 dark:bg-slate-800 dark:text-slate-300">
              {documents.length} dokument
            </div>
          </div>

          <div className="mt-6 space-y-4">
            {documentsForRender.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-slate-300 px-4 py-8 text-sm text-slate-500 dark:border-slate-700 dark:text-slate-400">
                Inga uppladdade fullmakter eller kompletta avtal ännu.
              </div>
            ) : (
              documentsForRender.map((documentRow) => {
                const site =
                  sites.find((row) => row.id === documentRow.site_id) ?? null
                const linkedPowerOfAttorney = getPowerOfAttorneyForDocument(
                  documentRow,
                  powersOfAttorney
                )

                const matchingGridOwnerRequests = relations.gridOwnerDataRequests.filter((row) => {
                  const responseMatch =
                    getString(row.response_payload, 'authorizationDocumentId') ===
                    documentRow.id
                  const requestMatch =
                    getString(row.request_payload, 'authorizationDocumentId') ===
                    documentRow.id
                  return responseMatch || requestMatch
                })

                const matchingSwitchRequests = relations.switchRequests.filter((row) => {
                  const snapshotMatch =
                    getString(row.validation_snapshot, 'authorizationDocumentId') ===
                      documentRow.id ||
                    getString(row.validation_snapshot, 'sourceDocumentId') ===
                      documentRow.id

                  const poaMatch =
                    Boolean(documentRow.power_of_attorney_id) &&
                    row.power_of_attorney_id === documentRow.power_of_attorney_id

                  return snapshotMatch || poaMatch
                })

                const matchingGridOwnerRequestIds = new Set(
                  matchingGridOwnerRequests.map((row) => row.id)
                )
                const matchingSwitchRequestIds = new Set(
                  matchingSwitchRequests.map((row) => row.id)
                )

                const matchingOutbounds = relations.outboundRequests.filter((row) => {
                  const payloadMatch =
                    getString(row.payload, 'authorizationDocumentId') === documentRow.id ||
                    getString(row.response_payload, 'authorizationDocumentId') === documentRow.id

                  const switchSourceMatch =
                    row.source_type === 'supplier_switch_request' &&
                    typeof row.source_id === 'string' &&
                    matchingSwitchRequestIds.has(row.source_id)

                  const gridOwnerSourceMatch =
                    row.source_type === 'grid_owner_data_request' &&
                    typeof row.source_id === 'string' &&
                    matchingGridOwnerRequestIds.has(row.source_id)

                  return payloadMatch || switchSourceMatch || gridOwnerSourceMatch
                })

                return (
                  <article
                    key={documentRow.id}
                    className="rounded-2xl border border-slate-200 p-4 dark:border-slate-800"
                  >
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <h4 className="text-sm font-semibold text-slate-900 dark:text-white">
                          {documentTypeLabel(documentRow.document_type)} ·{' '}
                          {documentRow.title ?? documentRow.file_name ?? documentRow.id}
                        </h4>
                        <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                          {site?.site_name ?? 'Kundnivå'} · uppladdad {formatDateTime(documentRow.uploaded_at)}
                        </p>
                      </div>

                      <span
                        className={`inline-flex rounded-full px-2.5 py-1 text-xs font-semibold ${statusBadgeClass(documentRow.status)}`}
                      >
                        {documentRow.status}
                      </span>
                    </div>

                    <dl className="mt-4 grid gap-2 text-sm text-slate-600 dark:text-slate-300">
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
                          ? `${linkedPowerOfAttorney.status} · ${linkedPowerOfAttorney.id}`
                          : '—'}
                      </div>
                    </dl>

                    {documentRow.notes ? (
                      <div className="mt-3 rounded-2xl bg-slate-50 px-3 py-2 text-sm text-slate-600 dark:bg-slate-950 dark:text-slate-300">
                        {documentRow.notes}
                      </div>
                    ) : null}

                    <div className="mt-4 flex flex-wrap gap-2">
                      <a
                        href={`/api/admin/customer-documents/${documentRow.id}?mode=open`}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center rounded-2xl bg-slate-100 px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"
                      >
                        Öppna
                      </a>

                      <a
                        href={`/api/admin/customer-documents/${documentRow.id}?mode=download`}
                        className="inline-flex items-center rounded-2xl bg-slate-100 px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"
                      >
                        Ladda ner
                      </a>

                      {documentRow.status !== 'active' ? (
                        <form action={setCustomerAuthorizationDocumentActiveAction}>
                          <input type="hidden" name="customer_id" value={customerId} />
                          <input type="hidden" name="document_id" value={documentRow.id} />
                          <SubmitButton
                            idleLabel="Sätt som aktiv"
                            pendingLabel="Sätter aktiv..."
                            tone="secondary"
                          />
                        </form>
                      ) : null}

                      {documentRow.status !== 'archived' ? (
                        <form action={archiveCustomerAuthorizationDocumentAction}>
                          <input type="hidden" name="customer_id" value={customerId} />
                          <input type="hidden" name="document_id" value={documentRow.id} />
                          <input
                            type="hidden"
                            name="archive_reason"
                            value="Arkiverad manuellt från dokumentkortet."
                          />
                          <SubmitButton
                            idleLabel="Arkivera"
                            pendingLabel="Arkiverar..."
                            tone="danger"
                          />
                        </form>
                      ) : null}
                    </div>

                    <div className="mt-5 grid gap-4 lg:grid-cols-3">
                      <div className="rounded-2xl bg-slate-50 p-3 dark:bg-slate-950">
                        <h5 className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                          Grid owner requests
                        </h5>
                        <div className="mt-2 space-y-2">
                          {matchingGridOwnerRequests.length === 0 ? (
                            <p className="text-xs text-slate-500 dark:text-slate-400">Inga kopplade requests.</p>
                          ) : (
                            matchingGridOwnerRequests.map((row) => (
                              <div
                                key={row.id}
                                className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs dark:border-slate-800 dark:bg-slate-900"
                              >
                                <div className="font-medium text-slate-900 dark:text-white">
                                  {row.request_scope}
                                </div>
                                <div className="mt-1 text-slate-500 dark:text-slate-400">
                                  {row.id} · {row.status}
                                </div>
                              </div>
                            ))
                          )}
                        </div>
                      </div>

                      <div className="rounded-2xl bg-slate-50 p-3 dark:bg-slate-950">
                        <h5 className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                          Switch requests
                        </h5>
                        <div className="mt-2 space-y-2">
                          {matchingSwitchRequests.length === 0 ? (
                            <p className="text-xs text-slate-500 dark:text-slate-400">Inga kopplade switchar.</p>
                          ) : (
                            matchingSwitchRequests.map((row) => (
                              <div
                                key={row.id}
                                className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs dark:border-slate-800 dark:bg-slate-900"
                              >
                                <div className="font-medium text-slate-900 dark:text-white">
                                  {row.request_type}
                                </div>
                                <div className="mt-1 text-slate-500 dark:text-slate-400">
                                  {row.id} · {row.status}
                                </div>
                              </div>
                            ))
                          )}
                        </div>
                      </div>

                      <div className="rounded-2xl bg-slate-50 p-3 dark:bg-slate-950">
                        <h5 className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                          Outbound
                        </h5>
                        <div className="mt-2 space-y-2">
                          {matchingOutbounds.length === 0 ? (
                            <p className="text-xs text-slate-500 dark:text-slate-400">Inga kopplade outbounds.</p>
                          ) : (
                            matchingOutbounds.map((row) => (
                              <div
                                key={row.id}
                                className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs dark:border-slate-800 dark:bg-slate-900"
                              >
                                <div className="font-medium text-slate-900 dark:text-white">
                                  {row.request_type}
                                </div>
                                <div className="mt-1 text-slate-500 dark:text-slate-400">
                                  {row.id} · {row.status} · {row.channel_type}
                                </div>
                              </div>
                            ))
                          )}
                        </div>
                      </div>
                    </div>
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