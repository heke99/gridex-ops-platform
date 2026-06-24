import { evaluateRouteProfileProductionReadiness } from '@/lib/ediel/routeProfileProductionReadiness'
import { evaluateGridOwnerBusinessApproval } from '@/lib/ediel/gridOwnerBusinessApproval'
import { emitCustomerProcessEvent } from '@/lib/customer-operations/customerProcessEvents'

type Process = 'facility_lookup' | 'grid_owner_information_request' | 'z01_customer_masterdata' | 'supplier_switch'

type JsonRecord = Record<string, unknown>

export type CustomerProcessRouteReadinessResult = {
  process: Process
  ready: boolean
  blockers: Array<{ code: string; message: string; source: string; metadata?: JsonRecord }>
  warnings: Array<{ code: string; message: string; source: string; metadata?: JsonRecord }>
  routeProfileId: string | null
  communicationRouteId: string | null
  family: string
  code: string | null
}

function messageConfig(process: Process): { family: string; code: string | null; needsOutboundSendReadiness: boolean } {
  if (process === 'supplier_switch') return { family: 'PRODAT', code: 'Z03', needsOutboundSendReadiness: true }
  if (process === 'z01_customer_masterdata' || process === 'facility_lookup' || process === 'grid_owner_information_request') return { family: 'PRODAT', code: 'Z01', needsOutboundSendReadiness: true }
  return { family: 'PRODAT', code: 'Z01', needsOutboundSendReadiness: true }
}

function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null
}

export async function evaluateCustomerProcessRouteReadiness(input: {
  companyId: string
  customerId?: string | null
  siteId?: string | null
  gridOwnerId?: string | null
  process: Process
  actorUserId?: string | null
  emitEvents?: boolean
}): Promise<CustomerProcessRouteReadinessResult> {
  const config = messageConfig(input.process)
  const blockers: CustomerProcessRouteReadinessResult['blockers'] = []
  const warnings: CustomerProcessRouteReadinessResult['warnings'] = []

  if (!input.gridOwnerId) {
    blockers.push({ code: 'grid_owner_missing', message: 'Nätägare saknas för kundprocessen.', source: 'customer_process_route_readiness' })
    return {
      process: input.process,
      ready: false,
      blockers,
      warnings,
      routeProfileId: null,
      communicationRouteId: null,
      family: config.family,
      code: config.code,
    }
  }

  // Uppgiftsbegäran är Ediel-first i produktion. Manuell hantering får
  // finnas som fallback i UI, men readiness ska fortfarande utvärdera PRODAT Z01
  // så tenant inte får en falsk känsla av att automatisering är klar.

  const businessApproval = await evaluateGridOwnerBusinessApproval({
    companyId: input.companyId,
    gridOwnerId: input.gridOwnerId,
    process: input.process,
    environment: 'production',
  })
  const readiness = businessApproval.routeReadiness

  for (const blocker of businessApproval.blockers) {
    blockers.push({
      code: blocker.code,
      message: blocker.message,
      source: blocker.source,
      metadata: blocker.metadata,
    })
  }
  for (const warning of businessApproval.warnings) {
    warnings.push({
      code: warning.code,
      message: warning.message,
      source: warning.source,
      metadata: warning.metadata,
    })
  }

  if (readiness?.ediel_route_profile_id && businessApproval.processRelevant) {
    const profile = await evaluateRouteProfileProductionReadiness({
      routeProfileId: readiness.ediel_route_profile_id,
      actorUserId: input.actorUserId ?? null,
      applyFixes: true,
    })
    for (const issue of profile.blockers) {
      blockers.push({
        code: issue.code,
        message: issue.message,
        source: 'route_profile_production_readiness',
        metadata: issue.metadata,
      })
    }
    for (const issue of profile.warnings) {
      warnings.push({
        code: issue.code,
        message: issue.message,
        source: 'route_profile_production_readiness',
        metadata: issue.metadata,
      })
    }
  }

  const ready = blockers.length === 0

  if (!ready && input.emitEvents !== false && input.customerId) {
    await emitCustomerProcessEvent({
      companyId: input.companyId,
      customerId: input.customerId,
      customerSiteId: input.siteId ?? null,
      eventType: 'supplier_switch.blocked',
      title: 'Route blockerar nästa steg',
      message: blockers[0]?.message ?? 'Nödvändig produktionsroute är inte klar.',
      actorUserId: input.actorUserId ?? null,
      status: 'blocked',
      severity: 'error',
      actionRequired: true,
      source: 'customer_process_route_readiness',
      payload: { process: input.process, blockers, warnings },
      idempotencyKey: `route_readiness.blocked:${input.companyId}:${input.siteId ?? input.customerId}:${input.process}:${blockers.map((b) => b.code).join('|')}`,
    })
  }

  return {
    process: input.process,
    ready,
    blockers,
    warnings,
    routeProfileId: readiness?.ediel_route_profile_id ?? null,
    communicationRouteId: readiness?.communication_route_id ?? null,
    family: config.family,
    code: config.code,
  }
}

export function routeReadinessSummary(result: CustomerProcessRouteReadinessResult): string {
  if (result.ready) return 'Alla nödvändiga routes är produktionsklara för nästa steg.'
  return result.blockers.map((item) => text(item.message) ?? item.code).join(', ')
}
