import { getCompanyGridOwnerRouteReadiness, type CompanyRouteReadinessRow } from '@/lib/ediel/companyRouteReadiness'

export type GridOwnerActorScope =
  | 'electricity_grid_owner'
  | 'gas'
  | 'system_actor'
  | 'industrial'
  | 'dummy'
  | 'unknown'

export type GridOwnerCustomerProcess =
  | 'facility_lookup'
  | 'grid_owner_information_request'
  | 'z01_customer_masterdata'
  | 'supplier_switch'
  | 'metering_values'
  | 'billing_underlay'

export type GridOwnerBusinessApproval = {
  process: GridOwnerCustomerProcess
  actorScope: GridOwnerActorScope
  technicalSendReady: boolean
  businessProductionApproved: boolean
  excludedFromCustomerFlows: boolean
  processRelevant: boolean
  messageFamily: string
  messageCode: string | null
  routeReadiness: CompanyRouteReadinessRow | null
  communicationRouteId: string | null
  edielRouteProfileId: string | null
  blockers: Array<{ code: string; message: string; source: string; metadata?: Record<string, unknown> }>
  warnings: Array<{ code: string; message: string; source: string; metadata?: Record<string, unknown> }>
}

function clean(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function lower(value: unknown): string {
  return clean(value)?.toLocaleLowerCase('sv-SE') ?? ''
}

export function classifyGridOwnerActorScope(input: {
  gridOwnerName?: string | null
  edielId?: string | null
}): GridOwnerActorScope {
  const name = lower(input.gridOwnerName)
  const edielId = clean(input.edielId)

  if (!name && !edielId) return 'unknown'
  if (name.includes('dummy') || name.includes('test')) return 'dummy'
  if (name.includes('systemleverantör')) return 'dummy'
  if (name.includes('svenska kraftnät') || edielId === '10000') return 'system_actor'
  if (name.includes('gas') || name.includes('swedegas') || name.includes('weum')) return 'gas'
  if (
    name.includes('billerud') ||
    name.includes('ovako') ||
    name.includes('industri') ||
    name.includes('bruk')
  ) return 'industrial'
  return 'electricity_grid_owner'
}

export function messageConfigForGridOwnerProcess(process: GridOwnerCustomerProcess): {
  family: string
  code: string | null
} {
  switch (process) {
    case 'metering_values':
    case 'billing_underlay':
      return { family: 'UTILTS', code: null }
    case 'supplier_switch':
      return { family: 'PRODAT', code: 'Z03' }
    case 'facility_lookup':
    case 'grid_owner_information_request':
    case 'z01_customer_masterdata':
    default:
      return { family: 'PRODAT', code: 'Z01' }
  }
}

function processRelevantForScope(scope: GridOwnerActorScope, process: GridOwnerCustomerProcess): boolean {
  if (scope === 'dummy') return false
  if (scope === 'system_actor') return process === 'metering_values' || process === 'billing_underlay'
  if (scope === 'gas') return false
  if (scope === 'industrial') return process === 'metering_values' || process === 'billing_underlay'
  return true
}

export async function evaluateGridOwnerBusinessApproval(input: {
  companyId: string
  gridOwnerId?: string | null
  process: GridOwnerCustomerProcess
  environment?: 'production' | 'test' | string | null
}): Promise<GridOwnerBusinessApproval> {
  const config = messageConfigForGridOwnerProcess(input.process)
  const blockers: GridOwnerBusinessApproval['blockers'] = []
  const warnings: GridOwnerBusinessApproval['warnings'] = []

  if (!input.gridOwnerId) {
    blockers.push({
      code: 'grid_owner_missing',
      message: 'Nätägare saknas för kundprocessen.',
      source: 'grid_owner_business_approval',
    })
    return {
      process: input.process,
      actorScope: 'unknown',
      technicalSendReady: false,
      businessProductionApproved: false,
      excludedFromCustomerFlows: false,
      processRelevant: false,
      messageFamily: config.family,
      messageCode: config.code,
      routeReadiness: null,
      communicationRouteId: null,
      edielRouteProfileId: null,
      blockers,
      warnings,
    }
  }

  const readiness = await getCompanyGridOwnerRouteReadiness({
    companyId: input.companyId,
    gridOwnerId: input.gridOwnerId,
    messageFamily: config.family,
    messageCode: config.code,
    environment: input.environment ?? 'production',
  })

  const actorScope = classifyGridOwnerActorScope({
    gridOwnerName: readiness?.grid_owner_name,
    edielId: readiness?.grid_owner_ediel_id,
  })
  const processRelevant = processRelevantForScope(actorScope, input.process)
  const excludedFromCustomerFlows = !processRelevant
  const technicalSendReady = readiness?.send_ready === true

  if (!readiness) {
    blockers.push({
      code: 'route_readiness_missing',
      message: 'Produktionsroute saknas eller kunde inte kontrolleras för nästa steg.',
      source: 'gridex_company_route_readiness_v',
      metadata: { process: input.process, family: config.family, code: config.code },
    })
  } else {
    if (readiness.blocker_code) {
      blockers.push({
        code: readiness.blocker_code,
        message: readiness.readiness_message ?? 'Route readiness blockerar nästa steg.',
        source: 'gridex_company_route_readiness_v',
        metadata: readiness as unknown as Record<string, unknown>,
      })
    }
    if (!technicalSendReady) {
      blockers.push({
        code: 'route_not_send_ready',
        message: 'Route är inte tekniskt redo för produktionsutskick.',
        source: 'gridex_company_route_readiness_v',
        metadata: readiness as unknown as Record<string, unknown>,
      })
    }
  }

  if (actorScope === 'dummy') {
    blockers.push({
      code: 'actor_scope_not_production_customer_flow',
      message: 'Aktören är dummy/test/systemleverantör och får inte användas för vanliga kundflöden utan explicit override.',
      source: 'grid_owner_business_approval',
      metadata: { actorScope },
    })
  } else if (excludedFromCustomerFlows) {
    warnings.push({
      code: 'process_not_relevant_for_actor_scope',
      message: 'Aktören är inte relevant för detta kundflöde och ska inte räknas som blockerad för elhandel.',
      source: 'grid_owner_business_approval',
      metadata: { actorScope, process: input.process },
    })
  }

  const businessProductionApproved = technicalSendReady && processRelevant && blockers.length === 0

  return {
    process: input.process,
    actorScope,
    technicalSendReady,
    businessProductionApproved,
    excludedFromCustomerFlows,
    processRelevant,
    messageFamily: config.family,
    messageCode: config.code,
    routeReadiness: readiness,
    communicationRouteId: readiness?.communication_route_id ?? null,
    edielRouteProfileId: readiness?.ediel_route_profile_id ?? null,
    blockers,
    warnings,
  }
}
