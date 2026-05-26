import { listActorTestingSummaries, type ActorTestingSummary } from '@/lib/ediel/actorTesting'
import { listTenantUsageStats, type TenantUsageStatsRow } from '@/lib/tenant/usageStats'

export type PlatformWorkQueueType =
  | 'setup'
  | 'actor_testing'
  | 'go_live'
  | 'usage'
  | 'billing'
  | 'tenant_status'

export type PlatformWorkQueueItem = {
  id: string
  type: PlatformWorkQueueType
  companyId: string
  companyName: string
  title: string
  description: string
  status: 'critical' | 'warning' | 'ready' | 'info'
  nextAction: string
  href: string
  updatedAt: string | null
  metric?: number
}

const PAUSED_COMPANY_STATUSES = new Set(['paused', 'suspended', 'archived', 'pending_deletion', 'deleted_test_only'])

function statusWeight(status: PlatformWorkQueueItem['status']): number {
  if (status === 'critical') return 4
  if (status === 'warning') return 3
  if (status === 'ready') return 2
  return 1
}

function latestDate(values: Array<string | null | undefined>): string | null {
  const dates = values
    .filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
    .map((value) => ({ value, time: Date.parse(value) }))
    .filter((item) => !Number.isNaN(item.time))
    .sort((a, b) => b.time - a.time)

  return dates[0]?.value ?? null
}

function actorTestingItems(summary: ActorTestingSummary): PlatformWorkQueueItem[] {
  const company = summary.company
  const items: PlatformWorkQueueItem[] = []
  const companyName = company.name ?? 'Bolag utan namn'
  const updatedAt = latestDate([summary.latestRunAt, company.updated_at, company.created_at])

  if (PAUSED_COMPANY_STATUSES.has(String(company.status ?? '').toLowerCase())) {
    items.push({
      id: `tenant-status-${company.id}`,
      type: 'tenant_status',
      companyId: company.id,
      companyName,
      title: 'Bolaget är pausat eller blockerat',
      description: `Nuvarande status: ${company.status ?? 'okänd'}. Liveflöden ska inte köras förrän status är kontrollerad.`,
      status: 'critical',
      nextAction: 'Öppna bolaget och kontrollera status innan fler tester körs.',
      href: `/admin/companies/${company.id}`,
      updatedAt,
    })
  }

  if (summary.missingSetup.length > 0) {
    items.push({
      id: `setup-${company.id}`,
      type: 'setup',
      companyId: company.id,
      companyName,
      title: 'Aktörsprofil saknar uppgifter',
      description: summary.missingSetup.slice(0, 4).join(' · '),
      status: 'warning',
      nextAction: 'Komplettera aktörsprofilen och spara så test- och runtimevärden synkas.',
      href: `/admin/platform/actor-testing/${company.id}`,
      updatedAt,
      metric: summary.missingSetup.length,
    })
  }

  if (summary.blockedTests > 0 || summary.actorTestStatus === 'blocked') {
    items.push({
      id: `actor-blocked-${company.id}`,
      type: 'actor_testing',
      companyId: company.id,
      companyName,
      title: 'Aktörstest är blockerat eller nekat',
      description: `${summary.blockedTests} test behöver åtgärdas. Kontrollera portalstatus, payload och bevispaket.`,
      status: 'critical',
      nextAction: 'Öppna aktörstestflödet och uppdatera blockerade testresultat.',
      href: `/admin/platform/actor-testing/${company.id}`,
      updatedAt,
      metric: summary.blockedTests,
    })
  }

  if (summary.actorTestStatus === 'ready_for_tests') {
    items.push({
      id: `actor-ready-${company.id}`,
      type: 'actor_testing',
      companyId: company.id,
      companyName,
      title: 'Aktörstest är redo att startas',
      description: 'Bolaget har grunduppgifter för test. Nästa steg är att köra PRODAT/UTILTS-testflöden.',
      status: 'ready',
      nextAction: 'Öppna aktörstester och kör första testpaketet.',
      href: `/admin/platform/actor-testing/${company.id}`,
      updatedAt,
    })
  }

  if (summary.goLiveBlockers.length > 0) {
    items.push({
      id: `go-live-blockers-${company.id}`,
      type: 'go_live',
      companyId: company.id,
      companyName,
      title: 'Go-live är blockerad',
      description: summary.goLiveBlockers.slice(0, 4).join(' · '),
      status: 'warning',
      nextAction: 'Öppna produktionssättning och åtgärda blockerarna.',
      href: `/admin/platform/go-live/${company.id}`,
      updatedAt,
      metric: summary.goLiveBlockers.length,
    })
  } else if (summary.productionReadiness === 'ready') {
    items.push({
      id: `go-live-ready-${company.id}`,
      type: 'go_live',
      companyId: company.id,
      companyName,
      title: 'Redo för live-kontroll',
      description: 'Aktörstester och produktionskrav är gröna. Superadmin behöver göra sista livekontrollen.',
      status: 'ready',
      nextAction: 'Öppna go-live och gör slutlig kontroll.',
      href: `/admin/platform/go-live/${company.id}`,
      updatedAt,
    })
  }

  return items
}

function usageItems(row: TenantUsageStatsRow): PlatformWorkQueueItem[] {
  const items: PlatformWorkQueueItem[] = []
  const companyName = row.companyName
  const updatedAt = row.lastActivityAt ?? null

  if (row.customerBlockers > 0) {
    items.push({
      id: `usage-blockers-${row.companyId}`,
      type: 'usage',
      companyId: row.companyId,
      companyName,
      title: 'Bolaget har blockerare i kundflödet',
      description: `${row.customerBlockers} öppna blockerare kan påverka onboarding, switch, fakturering eller export.`,
      status: row.customerBlockers > 10 ? 'critical' : 'warning',
      nextAction: 'Öppna bolaget och följ upp arbetskön eller kundblockerare.',
      href: `/admin/companies/${row.companyId}`,
      updatedAt,
      metric: row.customerBlockers,
    })
  }

  if (row.waitingInfoRequests > 0) {
    items.push({
      id: `usage-info-requests-${row.companyId}`,
      type: 'usage',
      companyId: row.companyId,
      companyName,
      title: 'Uppgiftsbegäran väntar på svar',
      description: `${row.waitingInfoRequests} begäran väntar på nätägare, leverantör eller manuell uppföljning.`,
      status: 'warning',
      nextAction: 'Kontrollera kundernas uppgiftsbegäran och nästa åtgärd.',
      href: `/admin/companies/${row.companyId}`,
      updatedAt,
      metric: row.waitingInfoRequests,
    })
  }

  if (row.blockedBillingRows > 0) {
    items.push({
      id: `usage-billing-blocked-${row.companyId}`,
      type: 'billing',
      companyId: row.companyId,
      companyName,
      title: 'Fakturering har blockerade rader',
      description: `${row.blockedBillingRows} fakturerings-/exportrader kräver åtgärd innan de kan skickas vidare.`,
      status: 'warning',
      nextAction: 'Öppna billing/exportstatus för bolaget och kontrollera radfel.',
      href: `/admin/companies/${row.companyId}`,
      updatedAt,
      metric: row.blockedBillingRows,
    })
  }

  return items
}

export async function listPlatformWorkQueueItems(): Promise<PlatformWorkQueueItem[]> {
  const [summaries, usageRows] = await Promise.all([
    listActorTestingSummaries({ scope: 'platform' }),
    listTenantUsageStats(),
  ])

  const items = [
    ...summaries.flatMap(actorTestingItems),
    ...usageRows.flatMap(usageItems),
  ]

  return items.sort((a, b) => {
    const statusDiff = statusWeight(b.status) - statusWeight(a.status)
    if (statusDiff !== 0) return statusDiff
    const aTime = a.updatedAt ? Date.parse(a.updatedAt) : 0
    const bTime = b.updatedAt ? Date.parse(b.updatedAt) : 0
    return bTime - aTime
  })
}

export function getPlatformWorkQueueTypeLabel(type: PlatformWorkQueueType): string {
  const labels: Record<PlatformWorkQueueType, string> = {
    setup: 'Aktörsprofil',
    actor_testing: 'Aktörstest',
    go_live: 'Go-live',
    usage: 'Usage',
    billing: 'Fakturering',
    tenant_status: 'Tenantstatus',
  }
  return labels[type]
}

export function getPlatformWorkQueueStatusLabel(status: PlatformWorkQueueItem['status']): string {
  const labels: Record<PlatformWorkQueueItem['status'], string> = {
    critical: 'Kritisk',
    warning: 'Kräver åtgärd',
    ready: 'Redo',
    info: 'Info',
  }
  return labels[status]
}
