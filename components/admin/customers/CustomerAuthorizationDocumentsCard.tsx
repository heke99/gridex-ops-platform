'use client'

import Link from 'next/link'
import { useActionState, useEffect, useMemo, useState } from 'react'
import { useFormStatus } from 'react-dom'
import type { GridOwnerDataRequestRow, OutboundRequestRow } from '@/lib/cis/types'
import type { CustomerSiteRow, MeteringPointRow } from '@/lib/masterdata/types'
import type { AuditLogRow } from '@/lib/masterdata/types'
import type {
  CustomerAuthorizationDocumentRow,
  PowerOfAttorneyRow,
  SupplierSwitchRequestRow,
} from '@/lib/operations/types'
import {
  archiveCustomerAuthorizationDocumentAction,
  initialUploadCustomerAuthorizationDocumentActionState,
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
  return powersOfAttorney.find((row) => row.id === documentRow.power_of_attorney_id) ?? null
}

function getRecordValue(value: unknown, key: string): unknown {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
  return (value as Record<string, unknown>)[key]
}

function getString(value: unknown, key: string): string | null {
  const raw = getRecordValue(value, key)
  return typeof raw === 'string' ? raw : null
}

function getStringArray(value: unknown, key: string): string[] {
  const raw = getRecordValue(value, key)
  return Array.isArray(raw) ? raw.filter((entry): entry is string => typeof entry === 'string') : []
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

function uploadResultClass(status: 'idle' | 'success' | 'duplicate' | 'error') {
  switch (status) {
    case 'success':
      return 'border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-900/60 dark:bg-emerald-500/10 dark:text-emerald-200'
    case 'duplicate':
      return 'border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-900/60 dark:bg-amber-500/10 dark:text-amber-200'
    case 'error':
      return 'border-rose-200 bg-rose-50 text-rose-800 dark:border-rose-900/60 dark:bg-rose-500/10 dark:text-rose-200'
    default:
      return 'border-slate-200 bg-slate-50 text-slate-700 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-300'
  }
}

function documentFlowBadge(
  documentRow: CustomerAuthorizationDocumentRow,
  allDocuments: CustomerAuthorizationDocumentRow[]
): { label: string; className: string } {
  const replacesAnotherDocument = allDocuments.some(
    (row) => row.replaced_document_id === documentRow.id
  )

  if (replacesAnotherDocument) {
    return {
      label: 'Ersättningsdokument',
      className: 'bg-indigo-100 text-indigo-700 dark:bg-indigo-500/10 dark:text-indigo-300',
    }
  }

  if (documentRow.status === 'archived' && documentRow.replaced_document_id) {
    return {
      label: 'Ersatt',
      className: 'bg-slate-200 text-slate-700 dark:bg-slate-800 dark:text-slate-300',
    }
  }

  return {
    label: 'Nytt dokument',
    className: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300',
  }
}

type RelationsResponse = {
  gridOwnerDataRequests: GridOwnerDataRequestRow[]
  outboundRequests: OutboundRequestRow[]
  switchRequests: SupplierSwitchRequestRow[]
  documentAuditLogs: AuditLogRow[]
}

type DocumentFlowStep = {
  label: string
  value: string
  href?: string
  tone: string
}

type TimelineLink = {
  label: string
  href: string
}

type TimelineItem = {
  id: string
  occurredAt: string
  title: string
  description: string
  tone: string
  links: TimelineLink[]
}

function buildGridOwnerRequestHref(customerId: string) {
  return `/admin/customers/${customerId}#billing-metering`
}

function buildOutboundHref(outbound: OutboundRequestRow) {
  return outbound.channel_type === 'unresolved'
    ? '/admin/outbound/unresolved'
    : '/admin/outbound'
}

function buildDocumentFlowSteps(params: {
  customerId: string
  documentRow: CustomerAuthorizationDocumentRow
  linkedPowerOfAttorney: PowerOfAttorneyRow | null
  matchingGridOwnerRequests: GridOwnerDataRequestRow[]
  matchingSwitchRequests: SupplierSwitchRequestRow[]
  matchingOutbounds: OutboundRequestRow[]
}): DocumentFlowStep[] {
  const latestGridOwnerRequest =
    [...params.matchingGridOwnerRequests].sort(
      (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
    )[0] ?? null

  const latestSwitchRequest =
    [...params.matchingSwitchRequests].sort(
      (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
    )[0] ?? null

  const latestOutbound =
    [...params.matchingOutbounds].sort((a, b) => {
      const aTime = new Date(
        a.acknowledged_at ?? a.failed_at ?? a.sent_at ?? a.prepared_at ?? a.queued_at ?? a.created_at
      ).getTime()
      const bTime = new Date(
        b.acknowledged_at ?? b.failed_at ?? b.sent_at ?? b.prepared_at ?? b.queued_at ?? b.created_at
      ).getTime()
      return bTime - aTime
    })[0] ?? null

  const responseValue = latestOutbound
    ? latestOutbound.status === 'acknowledged'
      ? 'Kvittens mottagen'
      : latestOutbound.status === 'sent'
        ? 'Skickad, inväntar svar'
        : latestOutbound.status === 'failed'
          ? 'Svar/försök felade'
          : latestOutbound.status === 'cancelled'
            ? 'Stoppad efter arkivering'
            : 'Ingen slutrespons ännu'
    : latestGridOwnerRequest?.status === 'received'
      ? 'Underlag mottaget'
      : latestSwitchRequest?.status === 'completed'
        ? 'Switch slutförd'
        : 'Ingen respons ännu'

  return [
    {
      label: 'Dokument',
      value: params.documentRow.status,
      tone: statusBadgeClass(params.documentRow.status),
    },
    {
      label: 'Fullmakt',
      value: params.linkedPowerOfAttorney?.status ?? 'saknas',
      tone: statusBadgeClass(params.linkedPowerOfAttorney?.status ?? 'pending'),
    },
    latestSwitchRequest
      ? {
          label: 'Request',
          value: `${latestSwitchRequest.request_type} · ${latestSwitchRequest.status}`,
          href: `/admin/operations/switches/${latestSwitchRequest.id}`,
          tone: statusBadgeClass(latestSwitchRequest.status),
        }
      : latestGridOwnerRequest
        ? {
            label: 'Request',
            value: `${latestGridOwnerRequest.request_scope} · ${latestGridOwnerRequest.status}`,
            href: buildGridOwnerRequestHref(params.customerId),
            tone: statusBadgeClass(latestGridOwnerRequest.status),
          }
        : {
            label: 'Request',
            value: 'ingen',
            tone: statusBadgeClass('pending'),
          },
    latestOutbound
      ? {
          label: 'Outbound',
          value: `${latestOutbound.request_type} · ${latestOutbound.status}`,
          href: buildOutboundHref(latestOutbound),
          tone:
            latestOutbound.channel_type === 'unresolved'
              ? 'bg-amber-100 text-amber-700 dark:bg-amber-500/10 dark:text-amber-300'
              : statusBadgeClass(latestOutbound.status),
        }
      : {
          label: 'Outbound',
          value: 'ingen',
          tone: statusBadgeClass('pending'),
        },
    {
      label: 'Response',
      value: responseValue,
      href: latestSwitchRequest?.id
        ? `/admin/operations/switches/${latestSwitchRequest.id}`
        : latestOutbound
          ? buildOutboundHref(latestOutbound)
          : latestGridOwnerRequest
            ? buildGridOwnerRequestHref(params.customerId)
            : undefined,
      tone:
        responseValue === 'Kvittens mottagen' ||
        responseValue === 'Underlag mottaget' ||
        responseValue === 'Switch slutförd'
          ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300'
          : responseValue.includes('fel') || responseValue.includes('Stoppad')
            ? 'bg-rose-100 text-rose-700 dark:bg-rose-500/10 dark:text-rose-300'
            : 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300',
    },
  ]
}

function buildDocumentTimelineItems(params: {
  customerId: string
  documentRow: CustomerAuthorizationDocumentRow
  matchingAuditLogs: AuditLogRow[]
  matchingGridOwnerRequests: GridOwnerDataRequestRow[]
  matchingSwitchRequests: SupplierSwitchRequestRow[]
  matchingOutbounds: OutboundRequestRow[]
}): TimelineItem[] {
  const items: TimelineItem[] = []
  const sortedLogs = [...params.matchingAuditLogs].sort(
    (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
  )

  const hasUploadAudit = sortedLogs.some(
    (log) => log.action === 'customer_authorization_document_uploaded_v2'
  )

  if (!hasUploadAudit) {
    items.push({
      id: `${params.documentRow.id}:uploaded_fallback`,
      occurredAt: params.documentRow.uploaded_at,
      title: 'Dokument uppladdat',
      description: `${documentTypeLabel(params.documentRow.document_type)} registrerat som ${params.documentRow.status}.`,
      tone: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300',
      links: [],
    })
  }

  for (const log of sortedLogs) {
    if (log.action === 'customer_authorization_document_uploaded_v2') {
      const createdGridOwnerRequestIds = getStringArray(log.metadata, 'createdGridOwnerRequestIds')
      const createdGridOwnerOutboundIds = getStringArray(log.metadata, 'createdGridOwnerOutboundIds')
      const linkedPowerOfAttorneyId = getString(log.metadata, 'linkedPowerOfAttorneyId')
      const switchRequestId = getString(log.metadata, 'switchRequestId')
      const switchOutboundId = getString(log.metadata, 'switchOutboundId')
      const archivedDocumentIds = getStringArray(log.metadata, 'archivedDocumentIds')
      const blockedReasons = getStringArray(log.metadata, 'automationBlockedReasons')
      const warnings = getStringArray(log.metadata, 'automationWarnings')

      const links: TimelineLink[] = []
      if (linkedPowerOfAttorneyId) {
        links.push({
          label: `Fullmakt ${linkedPowerOfAttorneyId}`,
          href: buildGridOwnerRequestHref(params.customerId),
        })
      }
      createdGridOwnerRequestIds.forEach((id) => {
        links.push({
          label: `Request ${id}`,
          href: buildGridOwnerRequestHref(params.customerId),
        })
      })
      createdGridOwnerOutboundIds.forEach((id) => {
        const outbound = params.matchingOutbounds.find((row) => row.id === id)
        links.push({
          label: `Outbound ${id}`,
          href: outbound ? buildOutboundHref(outbound) : '/admin/outbound',
        })
      })
      if (switchRequestId) {
        links.push({
          label: `Switch ${switchRequestId}`,
          href: `/admin/operations/switches/${switchRequestId}`,
        })
      }
      if (switchOutboundId) {
        const outbound = params.matchingOutbounds.find((row) => row.id === switchOutboundId)
        links.push({
          label: `Switch outbound ${switchOutboundId}`,
          href: outbound ? buildOutboundHref(outbound) : '/admin/outbound',
        })
      }

      const descriptionParts = [
        'Upload registrerades och dokumentet sparades.',
        createdGridOwnerRequestIds.length
          ? `Skapade nätägarrequester: ${createdGridOwnerRequestIds.join(', ')}.`
          : null,
        createdGridOwnerOutboundIds.length
          ? `Skapade outbounds: ${createdGridOwnerOutboundIds.join(', ')}.`
          : null,
        switchRequestId ? `Skapade/återanvände switch ${switchRequestId}.` : null,
        switchOutboundId ? `Skapade/återanvände switch-outbound ${switchOutboundId}.` : null,
        archivedDocumentIds.length
          ? `Ersatte/arkiverade äldre dokument: ${archivedDocumentIds.join(', ')}.`
          : null,
        warnings.length ? `Begränsningar: ${warnings.join(' ')}` : null,
        blockedReasons.length ? `Blockeringar: ${blockedReasons.join(' ')}` : null,
      ].filter((value): value is string => Boolean(value))

      items.push({
        id: log.id,
        occurredAt: log.created_at,
        title: 'Upload registrerad',
        description: descriptionParts.join(' '),
        tone: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300',
        links: links.filter(
          (link, index, array) =>
            array.findIndex(
              (item) => item.label === link.label && item.href === link.href
            ) === index
        ),
      })
      continue
    }

    if (log.action === 'customer_authorization_document_set_active') {
      const archivedConflictIds = getStringArray(log.metadata, 'archivedConflictIds')
      const restoredPowerOfAttorneyId = getString(log.metadata, 'restoredPowerOfAttorneyId')
      const links: TimelineLink[] = archivedConflictIds.map((id) => ({
        label: `Tidigare aktivt dokument ${id}`,
        href: '#',
      }))

      if (restoredPowerOfAttorneyId) {
        links.push({
          label: `Återställd fullmakt ${restoredPowerOfAttorneyId}`,
          href: buildGridOwnerRequestHref(params.customerId),
        })
      }

      items.push({
        id: log.id,
        occurredAt: log.created_at,
        title: 'Satt som aktivt dokument',
        description: [
          'Dokumentet sattes som standarddokument för sitt scope.',
          archivedConflictIds.length
            ? `Arkiverade tidigare aktiva dokument: ${archivedConflictIds.join(', ')}.`
            : null,
          restoredPowerOfAttorneyId
            ? `Återställde fullmakt ${restoredPowerOfAttorneyId}.`
            : null,
        ]
          .filter((value): value is string => Boolean(value))
          .join(' '),
        tone: 'bg-indigo-100 text-indigo-700 dark:bg-indigo-500/10 dark:text-indigo-300',
        links,
      })
      continue
    }

    if (log.action === 'customer_authorization_document_archived') {
      const revokedPowerOfAttorneyId = getString(log.metadata, 'revokedPowerOfAttorneyId')
      const archiveImpact = getRecordValue(log.metadata, 'archiveImpact')
      const cancelledGridOwnerRequestIds = getStringArray(
        archiveImpact,
        'cancelledGridOwnerRequestIds'
      )
      const flaggedGridOwnerRequestIds = getStringArray(
        archiveImpact,
        'flaggedGridOwnerRequestIds'
      )
      const cancelledOutboundIds = getStringArray(archiveImpact, 'cancelledOutboundIds')
      const flaggedOutboundIds = getStringArray(archiveImpact, 'flaggedOutboundIds')
      const failedSwitchRequestIds = getStringArray(archiveImpact, 'failedSwitchRequestIds')
      const flaggedSwitchRequestIds = getStringArray(archiveImpact, 'flaggedSwitchRequestIds')

      const links: TimelineLink[] = []
      ;[...cancelledGridOwnerRequestIds, ...flaggedGridOwnerRequestIds].forEach((id) => {
        links.push({
          label: `Request ${id}`,
          href: buildGridOwnerRequestHref(params.customerId),
        })
      })
      ;[...cancelledOutboundIds, ...flaggedOutboundIds].forEach((id) => {
        const outbound = params.matchingOutbounds.find((row) => row.id === id)
        links.push({
          label: `Outbound ${id}`,
          href: outbound ? buildOutboundHref(outbound) : '/admin/outbound',
        })
      })
      ;[...failedSwitchRequestIds, ...flaggedSwitchRequestIds].forEach((id) => {
        links.push({
          label: `Switch ${id}`,
          href: `/admin/operations/switches/${id}`,
        })
      })
      if (revokedPowerOfAttorneyId) {
        links.push({
          label: `Revokerad fullmakt ${revokedPowerOfAttorneyId}`,
          href: buildGridOwnerRequestHref(params.customerId),
        })
      }

      const reason =
        getString(log.new_values, 'archived_reason') ??
        getString(log.old_values, 'archived_reason') ??
        params.documentRow.archived_reason

      items.push({
        id: log.id,
        occurredAt: log.created_at,
        title: 'Dokument arkiverat',
        description: [
          reason ? `Orsak: ${reason}.` : 'Dokumentet arkiverades.',
          cancelledGridOwnerRequestIds.length
            ? `Stoppade requester: ${cancelledGridOwnerRequestIds.join(', ')}.`
            : null,
          flaggedGridOwnerRequestIds.length
            ? `Flaggade requester: ${flaggedGridOwnerRequestIds.join(', ')}.`
            : null,
          cancelledOutboundIds.length
            ? `Stoppade outbounds: ${cancelledOutboundIds.join(', ')}.`
            : null,
          flaggedOutboundIds.length
            ? `Flaggade outbounds: ${flaggedOutboundIds.join(', ')}.`
            : null,
          failedSwitchRequestIds.length
            ? `Stoppade switchar: ${failedSwitchRequestIds.join(', ')}.`
            : null,
          flaggedSwitchRequestIds.length
            ? `Flaggade switchar: ${flaggedSwitchRequestIds.join(', ')}.`
            : null,
          revokedPowerOfAttorneyId
            ? `Revokerade fullmakt ${revokedPowerOfAttorneyId}.`
            : null,
        ]
          .filter((value): value is string => Boolean(value))
          .join(' '),
        tone: 'bg-rose-100 text-rose-700 dark:bg-rose-500/10 dark:text-rose-300',
        links,
      })
      continue
    }

    items.push({
      id: log.id,
      occurredAt: log.created_at,
      title: log.action,
      description: 'Audit-händelse registrerad för dokumentet.',
      tone: 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300',
      links: [],
    })
  }

  if (params.documentRow.replaced_document_id) {
    items.push({
      id: `${params.documentRow.id}:replaced_by`,
      occurredAt: params.documentRow.updated_at,
      title: 'Dokument ersatt',
      description: `Dokumentet ersattes av dokument ${params.documentRow.replaced_document_id}.`,
      tone: 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300',
      links: [],
    })
  }

  return items.sort(
    (a, b) => new Date(b.occurredAt).getTime() - new Date(a.occurredAt).getTime()
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
  const [documentType, setDocumentType] = useState<'power_of_attorney' | 'complete_agreement'>(
    'power_of_attorney'
  )
  const [relations, setRelations] = useState<RelationsResponse>({
    gridOwnerDataRequests: [],
    outboundRequests: [],
    switchRequests: [],
    documentAuditLogs: [],
  })
  const [uploadState, uploadFormAction] = useActionState(
    uploadCustomerAuthorizationDocumentAction,
    initialUploadCustomerAuthorizationDocumentActionState
  )

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
            documentAuditLogs: json.documentAuditLogs ?? [],
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
            Upload kan nu skapa fullmakt, nätägarbegäran, supplier switch och outbound direkt, och blockerar samma fil via checksum/idempotency.
          </p>
        </div>

        {uploadState.status !== 'idle' && uploadState.message ? (
          <div
            className={`mt-6 rounded-2xl border px-4 py-3 text-sm ${uploadResultClass(uploadState.status)}`}
          >
            <div className="font-medium">
              {uploadState.status === 'duplicate'
                ? 'Dubblett blockerad'
                : uploadState.status === 'success'
                  ? 'Upload klar'
                  : 'Något gick fel'}
            </div>
            <div className="mt-1 whitespace-pre-line">{uploadState.message}</div>
          </div>
        ) : null}

        <form action={uploadFormAction} className="mt-6 space-y-4">
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
                Öppna, ladda ner, sätt aktiv, arkivera och följ hela dokumentkedjan med audit/timeline.
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
                const site = sites.find((row) => row.id === documentRow.site_id) ?? null
                const linkedPowerOfAttorney = getPowerOfAttorneyForDocument(
                  documentRow,
                  powersOfAttorney
                )

                const matchingGridOwnerRequests = relations.gridOwnerDataRequests.filter((row) => {
                  const directMatch = row.authorization_document_id === documentRow.id
                  const responseMatch =
                    getString(row.response_payload, 'authorizationDocumentId') === documentRow.id
                  const requestMatch =
                    getString(row.request_payload, 'authorizationDocumentId') === documentRow.id
                  return directMatch || responseMatch || requestMatch
                })

                const matchingSwitchRequests = relations.switchRequests.filter((row) => {
                  const directMatch = row.authorization_document_id === documentRow.id
                  const snapshotMatch =
                    getString(row.validation_snapshot, 'authorizationDocumentId') === documentRow.id ||
                    getString(row.validation_snapshot, 'sourceDocumentId') === documentRow.id

                  const poaMatch =
                    Boolean(documentRow.power_of_attorney_id) &&
                    row.power_of_attorney_id === documentRow.power_of_attorney_id

                  return directMatch || snapshotMatch || poaMatch
                })

                const matchingGridOwnerRequestIds = new Set(
                  matchingGridOwnerRequests.map((row) => row.id)
                )
                const matchingSwitchRequestIds = new Set(
                  matchingSwitchRequests.map((row) => row.id)
                )

                const matchingOutbounds = relations.outboundRequests.filter((row) => {
                  const directMatch = row.authorization_document_id === documentRow.id
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

                  return directMatch || payloadMatch || switchSourceMatch || gridOwnerSourceMatch
                })

                const matchingAuditLogs = relations.documentAuditLogs.filter(
                  (log) => log.entity_id === documentRow.id
                )

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
                          href={buildGridOwnerRequestHref(customerId)}
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
                                href={buildGridOwnerRequestHref(customerId)}
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
      </div>
    </section>
  )
}