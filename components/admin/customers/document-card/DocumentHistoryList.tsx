'use client'

import Link from 'next/link'
import {
  archiveCustomerAuthorizationDocumentAction,
  setCustomerAuthorizationDocumentActiveAction,
} from '@/app/admin/customers/[id]/document-actions'
import type { CustomerSiteRow } from '@/lib/masterdata/types'
import type {
  CustomerAuthorizationDocumentRow,
  PowerOfAttorneyRow,
} from '@/lib/operations/types'
import SubmitButton from './SubmitButton'
import {
  buildDocumentFlowSteps,
  buildDocumentTimelineItems,
  buildGridOwnerRequestHref,
  buildOutboundHref,
  documentFlowBadge,
  documentTypeLabel,
  formatDateTime,
  getPowerOfAttorneyForDocument,
  resolveDocumentRelations,
  statusBadgeClass,
} from './helpers'
import type { RelationsResponse } from './types'

export default function DocumentHistoryList({
  customerId,
  sites,
  documentsForRender,
  powersOfAttorney,
  relations,
}: {
  customerId: string
  sites: CustomerSiteRow[]
  documentsForRender: CustomerAuthorizationDocumentRow[]
  powersOfAttorney: PowerOfAttorneyRow[]
  relations: RelationsResponse
}) {
  return (
    <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-base font-semibold text-slate-900 dark:text-white">
            Dokumenthistorik och kopplingar
          </h3>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
            Öppna, ladda ner, sätt aktiv, arkivera och följ hela dokumentkedjan med
            audit/timeline.
          </p>
        </div>
        <div className="rounded-2xl bg-slate-100 px-3 py-1 text-xs font-medium text-slate-600 dark:bg-slate-800 dark:text-slate-300">
          {documentsForRender.length} dokument
        </div>
      </div>

      <div className="mt-6 space-y-4">
        {documentsForRender.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-slate-300 px-4 py-8 text-sm text-slate-500 dark:border-slate-700 dark:text-slate-400">
            Inga uppladdade fullmakter eller kompletta avtal ännu.
          </div>
        ) : (
          documentsForRender.map((documentRow) => {
            const site = sites.find((row) => row.id === documentRow.site_id) ?? null
            const linkedPowerOfAttorney = getPowerOfAttorneyForDocument(
              documentRow,
              powersOfAttorney
            )

            const {
              matchingGridOwnerRequests,
              matchingSwitchRequests,
              matchingOutbounds,
              matchingAuditLogs,
            } = resolveDocumentRelations({
              documentRow,
              relations,
            })

            const timelineItems = buildDocumentTimelineItems({
              customerId,
              documentRow,
              matchingAuditLogs,
              matchingGridOwnerRequests,
              matchingSwitchRequests,
              matchingOutbounds,
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

                  <div className="flex flex-wrap gap-2">
                    <span
                      className={`inline-flex rounded-full px-2.5 py-1 text-xs font-semibold ${statusBadgeClass(documentRow.status)}`}
                    >
                      {documentRow.status}
                    </span>
                    {(() => {
                      const flowBadge = documentFlowBadge(documentRow, documentsForRender)
                      return (
                        <span
                          className={`inline-flex rounded-full px-2.5 py-1 text-xs font-semibold ${flowBadge.className}`}
                        >
                          {flowBadge.label}
                        </span>
                      )
                    })()}
                  </div>
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
                    <span className="font-medium">Checksum:</span> {documentRow.file_checksum ?? '—'}
                  </div>
                  <div>
                    <span className="font-medium">Upload key:</span> {documentRow.upload_idempotency_key ?? '—'}
                  </div>
                  <div>
                    <span className="font-medium">Arkiveringsorsak:</span> {documentRow.archived_reason ?? '—'}
                  </div>
                  <div>
                    <span className="font-medium">Ersätter dokument:</span> {documentRow.replaced_document_id ?? '—'}
                  </div>
                  <div>
                    <span className="font-medium">Kopplad fullmakt:</span>{' '}
                    {linkedPowerOfAttorney
                      ? `${linkedPowerOfAttorney.status} · ${linkedPowerOfAttorney.id}`
                      : '—'}
                  </div>
                </dl>

                <div className="mt-4 rounded-2xl border border-slate-200 bg-slate-50 p-3 dark:border-slate-800 dark:bg-slate-950">
                  <div className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                    Driftkedja
                  </div>
                  <div className="mt-3 grid gap-2 md:grid-cols-5">
                    {buildDocumentFlowSteps({
                      customerId,
                      documentRow,
                      linkedPowerOfAttorney,
                      matchingGridOwnerRequests,
                      matchingSwitchRequests,
                      matchingOutbounds,
                    }).map((step) => {
                      const content = (
                        <div className="rounded-2xl border border-slate-200 bg-white px-3 py-2 dark:border-slate-800 dark:bg-slate-900">
                          <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                            {step.label}
                          </div>
                          <div className={`mt-2 inline-flex rounded-full px-2.5 py-1 text-xs font-semibold ${step.tone}`}>
                            {step.value}
                          </div>
                        </div>
                      )

                      return step.href ? (
                        <Link
                          key={`${documentRow.id}:${step.label}`}
                          href={step.href}
                          className="block transition hover:opacity-90"
                        >
                          {content}
                        </Link>
                      ) : (
                        <div key={`${documentRow.id}:${step.label}`}>{content}</div>
                      )
                    })}
                  </div>
                </div>

                <div className="mt-4 rounded-2xl border border-slate-200 bg-slate-50 p-3 dark:border-slate-800 dark:bg-slate-950">
                  <div className="flex items-center justify-between gap-3">
                    <div className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                      Dokumenttimeline
                    </div>
                    <div className="text-xs text-slate-500 dark:text-slate-400">
                      {timelineItems.length} händelser
                    </div>
                  </div>

                  {timelineItems.length === 0 ? (
                    <p className="mt-3 text-xs text-slate-500 dark:text-slate-400">
                      Inga timeline-händelser ännu.
                    </p>
                  ) : (
                    <div className="mt-3 space-y-3">
                      {timelineItems.map((item) => (
                        <div
                          key={item.id}
                          className="rounded-2xl border border-slate-200 bg-white px-3 py-3 dark:border-slate-800 dark:bg-slate-900"
                        >
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <div className="font-medium text-slate-900 dark:text-white">
                              {item.title}
                            </div>
                            <div className="text-xs text-slate-500 dark:text-slate-400">
                              {formatDateTime(item.occurredAt)}
                            </div>
                          </div>
                          <div className="mt-2">
                            <span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-semibold ${item.tone}`}>
                              Händelse
                            </span>
                          </div>
                          <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">
                            {item.description}
                          </p>
                          {item.links.length ? (
                            <div className="mt-3 flex flex-wrap gap-2">
                              {item.links.map((link, index) =>
                                link.href === '#' ? (
                                  <span
                                    key={`${item.id}:${index}`}
                                    className="inline-flex items-center rounded-2xl bg-slate-100 px-3 py-2 text-xs font-medium text-slate-700 dark:bg-slate-800 dark:text-slate-200"
                                  >
                                    {link.label}
                                  </span>
                                ) : (
                                  <Link
                                    key={`${item.id}:${index}`}
                                    href={link.href}
                                    className="inline-flex items-center rounded-2xl bg-slate-100 px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"
                                  >
                                    {link.label}
                                  </Link>
                                )
                              )}
                            </div>
                          ) : null}
                        </div>
                      ))}
                    </div>
                  )}
                </div>

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

                <div className="mt-4 flex flex-wrap gap-2">
                  {matchingSwitchRequests[0] ? (
                    <Link
                      href={`/admin/operations/switches/${matchingSwitchRequests[0].id}`}
                      className="inline-flex items-center rounded-2xl bg-indigo-50 px-3 py-2 text-xs font-medium text-indigo-700 hover:bg-indigo-100 dark:bg-indigo-500/10 dark:text-indigo-300 dark:hover:bg-indigo-500/20"
                    >
                      Gå till switch-request
                    </Link>
                  ) : null}

                  {matchingOutbounds[0] ? (
                    <Link
                      href={
                        matchingOutbounds.some((row) => row.channel_type === 'unresolved')
                          ? '/admin/outbound/unresolved'
                          : '/admin/outbound'
                      }
                      className="inline-flex items-center rounded-2xl bg-sky-50 px-3 py-2 text-xs font-medium text-sky-700 hover:bg-sky-100 dark:bg-sky-500/10 dark:text-sky-300 dark:hover:bg-sky-500/20"
                    >
                      {matchingOutbounds.some((row) => row.channel_type === 'unresolved')
                        ? 'Gå till outbound unresolved'
                        : 'Gå till outbound'}
                    </Link>
                  ) : null}

                  {matchingGridOwnerRequests[0] ? (
                    <Link
                      href={buildGridOwnerRequestHref(customerId, matchingGridOwnerRequests[0]?.id)}
                      className="inline-flex items-center rounded-2xl bg-amber-50 px-3 py-2 text-xs font-medium text-amber-700 hover:bg-amber-100 dark:bg-amber-500/10 dark:text-amber-300 dark:hover:bg-amber-500/20"
                    >
                      Gå till grid owner request
                    </Link>
                  ) : null}
                </div>

                <div className="mt-5 grid gap-4 lg:grid-cols-3">
                  <div className="rounded-2xl bg-slate-50 p-3 dark:bg-slate-950">
                    <h5 className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                      Grid owner requests
                    </h5>
                    <div className="mt-2 space-y-2">
                      {matchingGridOwnerRequests.length === 0 ? (
                        <p className="text-xs text-slate-500 dark:text-slate-400">
                          Inga kopplade requests.
                        </p>
                      ) : (
                        matchingGridOwnerRequests.map((row) => (
                          <Link
                            key={row.id}
                            href={buildGridOwnerRequestHref(customerId, row.id)}
                            className="block rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs transition hover:bg-slate-50 dark:border-slate-800 dark:bg-slate-900 dark:hover:bg-slate-800"
                          >
                            <div className="font-medium text-slate-900 dark:text-white">
                              {row.request_scope}
                            </div>
                            <div className="mt-1 text-slate-500 dark:text-slate-400">
                              {row.id} · {row.status}
                            </div>
                          </Link>
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
                        <p className="text-xs text-slate-500 dark:text-slate-400">
                          Inga kopplade switchar.
                        </p>
                      ) : (
                        matchingSwitchRequests.map((row) => (
                          <Link
                            key={row.id}
                            href={`/admin/operations/switches/${row.id}`}
                            className="block rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs transition hover:bg-slate-50 dark:border-slate-800 dark:bg-slate-900 dark:hover:bg-slate-800"
                          >
                            <div className="font-medium text-slate-900 dark:text-white">
                              {row.request_type}
                            </div>
                            <div className="mt-1 text-slate-500 dark:text-slate-400">
                              {row.id} · {row.status}
                            </div>
                          </Link>
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
                        <p className="text-xs text-slate-500 dark:text-slate-400">
                          Inga kopplade outbounds.
                        </p>
                      ) : (
                        matchingOutbounds.map((row) => (
                          <Link
                            key={row.id}
                            href={buildOutboundHref(row)}
                            className="block rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs transition hover:bg-slate-50 dark:border-slate-800 dark:bg-slate-900 dark:hover:bg-slate-800"
                          >
                            <div className="font-medium text-slate-900 dark:text-white">
                              {row.request_type}
                            </div>
                            <div className="mt-1 text-slate-500 dark:text-slate-400">
                              {row.id} · {row.status} · {row.channel_type}
                            </div>
                          </Link>
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
  )
}