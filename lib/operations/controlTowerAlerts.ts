import type {
  BillingUnderlayRow,
  OutboundRequestRow,
  PartnerExportRow,
} from '@/lib/cis/types'
import type {
  CustomerOperationTaskRow,
  SupplierSwitchRequestRow,
  SwitchReadinessResult,
} from '@/lib/operations/types'
import {
  getBillingExportReadiness,
  getSwitchLifecycle,
  summarizeReadinessIssues,
} from '@/lib/operations/controlTower'

export type OperationsAlertSeverity = 'critical' | 'high' | 'medium' | 'low'

export type OperationsAlert = {
  id: string
  severity: OperationsAlertSeverity
  title: string
  description: string
  href: string
  category:
    | 'task'
    | 'switch'
    | 'outbound'
    | 'billing_export'
    | 'readiness'
  customerId?: string | null
  siteId?: string | null
  meteringPointId?: string | null
}

function severityRank(value: OperationsAlertSeverity): number {
  switch (value) {
    case 'critical':
      return 4
    case 'high':
      return 3
    case 'medium':
      return 2
    default:
      return 1
  }
}

export function buildOperationsAlerts(params: {
  tasks: CustomerOperationTaskRow[]
  switchRequests: SupplierSwitchRequestRow[]
  readinessResults: SwitchReadinessResult[]
  outboundRequests: OutboundRequestRow[]
  billingUnderlays: BillingUnderlayRow[]
  partnerExports: PartnerExportRow[]
}): OperationsAlert[] {
  const alerts: OperationsAlert[] = []

  for (const task of params.tasks) {
    if (!['open', 'in_progress', 'blocked'].includes(task.status)) continue

    const severity: OperationsAlertSeverity =
      task.priority === 'critical'
        ? 'critical'
        : task.priority === 'high'
          ? 'high'
          : task.priority === 'normal'
            ? 'medium'
            : 'low'

    alerts.push({
      id: `task:${task.id}`,
      severity,
      title: task.title,
      description:
        task.description ??
        `Task ${task.task_type} kräver handläggning för kund ${task.customer_id}.`,
      href: `/admin/customers/${task.customer_id}`,
      category: 'task',
      customerId: task.customer_id,
      siteId: task.site_id,
      meteringPointId: task.metering_point_id,
    })
  }

  for (const request of params.outboundRequests) {
    if (request.channel_type === 'unresolved') {
      alerts.push({
        id: `outbound-unresolved:${request.id}`,
        severity: 'high',
        title: 'Outbound saknar route',
        description: `${request.request_type} för kund ${request.customer_id} kan inte dispatchas eftersom route/kanal inte kunde lösas.`,
        href: '/admin/outbound/unresolved',
        category: 'outbound',
        customerId: request.customer_id,
        siteId: request.site_id,
        meteringPointId: request.metering_point_id,
      })
    }

    if (request.status === 'sent') {
      alerts.push({
        id: `outbound-waiting:${request.id}`,
        severity: 'medium',
        title: 'Outbound väntar på svar',
        description: `${request.request_type} för kund ${request.customer_id} är skickad men ännu inte kvitterad.`,
        href: '/admin/outbound',
        category: 'outbound',
        customerId: request.customer_id,
        siteId: request.site_id,
        meteringPointId: request.metering_point_id,
      })
    }

    if (request.status === 'failed') {
      alerts.push({
        id: `outbound-failed:${request.id}`,
        severity: 'high',
        title: 'Outbound har misslyckats',
        description:
          request.failure_reason ??
          `${request.request_type} för kund ${request.customer_id} misslyckades.`,
        href: '/admin/outbound',
        category: 'outbound',
        customerId: request.customer_id,
        siteId: request.site_id,
        meteringPointId: request.metering_point_id,
      })
    }
  }

  for (const readiness of params.readinessResults) {
    if (readiness.isReady) continue

    alerts.push({
      id: `readiness:${readiness.siteId}`,
      severity: 'high',
      title: `Switch blockerad för ${readiness.siteName}`,
      description: summarizeReadinessIssues(readiness),
      href: `/admin/customers/${readiness.customerId}`,
      category: 'readiness',
      customerId: readiness.customerId,
      siteId: readiness.siteId,
      meteringPointId: readiness.candidateMeteringPointId,
    })
  }

  for (const request of params.switchRequests) {
    const readiness = params.readinessResults.find(
      (row) => row.siteId === request.site_id
    )
    const outbound = params.outboundRequests.find(
      (row) =>
        row.source_type === 'supplier_switch_request' &&
        row.source_id === request.id
    )

    const lifecycle = getSwitchLifecycle({
      request,
      readiness,
      outboundRequest: outbound ?? null,
    })

    if (lifecycle.stage === 'queued_for_outbound') {
      alerts.push({
        id: `switch-missing-outbound:${request.id}`,
        severity: 'high',
        title: 'Redo switch saknar outbound',
        description: `${request.request_type} för kund ${request.customer_id} är redo men ingen outbound-request finns ännu.`,
        href: '/admin/operations/switches',
        category: 'switch',
        customerId: request.customer_id,
        siteId: request.site_id,
        meteringPointId: request.metering_point_id,
      })
    }

    if (lifecycle.stage === 'failed') {
      alerts.push({
        id: `switch-failed:${request.id}`,
        severity: 'high',
        title: 'Switch har felstatus',
        description: lifecycle.reason,
        href: '/admin/operations/switches',
        category: 'switch',
        customerId: request.customer_id,
        siteId: request.site_id,
        meteringPointId: request.metering_point_id,
      })
    }
  }

  const exportMap = new Map(
    params.partnerExports
      .filter((row) => row.billing_underlay_id)
      .map((row) => [row.billing_underlay_id as string, row])
  )

  for (const underlay of params.billingUnderlays) {
    const readiness = getBillingExportReadiness({
      underlay,
      existingExport: exportMap.get(underlay.id) ?? null,
    })

    if (!readiness.isReady) continue

    alerts.push({
      id: `billing-export-ready:${underlay.id}`,
      severity: 'medium',
      title: 'Billing-underlag redo för export',
      description: `Underlag ${underlay.underlay_year ?? '—'}-${String(
        underlay.underlay_month ?? ''
      ).padStart(2, '0')} för kund ${underlay.customer_id} saknar aktiv partnerexport.`,
      href: '/admin/partner-exports',
      category: 'billing_export',
      customerId: underlay.customer_id,
      siteId: underlay.site_id,
      meteringPointId: underlay.metering_point_id,
    })
  }

  return alerts.sort((a, b) => severityRank(b.severity) - severityRank(a.severity))
}