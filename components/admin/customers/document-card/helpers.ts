import type { GridOwnerDataRequestRow, OutboundRequestRow } from '@/lib/cis/types'
import type { AuditLogRow } from '@/lib/masterdata/types'
import type {
  CustomerAuthorizationDocumentRow,
  PowerOfAttorneyRow,
  SupplierSwitchRequestRow,
} from '@/lib/operations/types'
import type {
  DocumentFlowStep,
  DocumentRelationsBundle,
  TimelineItem,
  TimelineLink,
} from './types'

export function formatDateTime(value: string | null): string {
  if (!value) return '—'
  return new Date(value).toLocaleString('sv-SE')
}

export function documentTypeLabel(value: CustomerAuthorizationDocumentRow['document_type']) {
  return value === 'power_of_attorney' ? 'Fullmakt' : 'Komplett avtal'
}

export function getPowerOfAttorneyForDocument(
  documentRow: CustomerAuthorizationDocumentRow,
  powersOfAttorney: PowerOfAttorneyRow[]
): PowerOfAttorneyRow | null {
  if (!documentRow.power_of_attorney_id) return null
  return powersOfAttorney.find((row) => row.id === documentRow.power_of_attorney_id) ?? null
}

export function getRecordValue(value: unknown, key: string): unknown {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
  return (value as Record<string, unknown>)[key]
}

export function getString(value: unknown, key: string): string | null {
  const raw = getRecordValue(value, key)
  return typeof raw === 'string' ? raw : null
}

export function getStringArray(value: unknown, key: string): string[] {
  const raw = getRecordValue(value, key)
  return Array.isArray(raw) ? raw.filter((entry): entry is string => typeof entry === 'string') : []
}

export function statusBadgeClass(status: string) {
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

export function uploadResultClass(status: 'idle' | 'success' | 'duplicate' | 'error') {
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

export function documentFlowBadge(
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

export function buildGridOwnerRequestHref(customerId: string, requestId?: string | null) {
  if (requestId) return `/admin/operations/grid-owner-requests/${requestId}`
  return `/admin/customers/${customerId}#billing-metering`
}

export function buildOutboundHref(outbound: OutboundRequestRow) {
  return outbound.channel_type === 'unresolved'
    ? '/admin/outbound/unresolved'
    : '/admin/outbound'
}

export function sortOutboundByLatestActivity(
  rows: OutboundRequestRow[]
): OutboundRequestRow[] {
  return [...rows].sort((a, b) => {
    const aTime = new Date(
      a.acknowledged_at ?? a.failed_at ?? a.sent_at ?? a.prepared_at ?? a.queued_at ?? a.created_at
    ).getTime()
    const bTime = new Date(
      b.acknowledged_at ?? b.failed_at ?? b.sent_at ?? b.prepared_at ?? b.queued_at ?? b.created_at
    ).getTime()
    return bTime - aTime
  })
}

export function buildDocumentFlowSteps(params: {
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

  const latestOutbound = sortOutboundByLatestActivity(params.matchingOutbounds)[0] ?? null

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
            href: buildGridOwnerRequestHref(params.customerId, latestGridOwnerRequest.id),
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
            ? buildGridOwnerRequestHref(params.customerId, latestGridOwnerRequest.id)
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

export function buildDocumentTimelineItems(params: {
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
          href: buildGridOwnerRequestHref(params.customerId, id),
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
          href: buildGridOwnerRequestHref(params.customerId, id),
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

export function resolveDocumentRelations(params: {
  documentRow: CustomerAuthorizationDocumentRow
  relations: {
    gridOwnerDataRequests: GridOwnerDataRequestRow[]
    outboundRequests: OutboundRequestRow[]
    switchRequests: SupplierSwitchRequestRow[]
    documentAuditLogs: AuditLogRow[]
  }
}): DocumentRelationsBundle {
  const { documentRow, relations } = params

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

  return {
    matchingGridOwnerRequests,
    matchingSwitchRequests,
    matchingOutbounds,
    matchingAuditLogs,
  }
}