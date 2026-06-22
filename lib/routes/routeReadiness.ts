import type { BusinessProcess, RouteScope, OutboundIntent } from '@/lib/routes/routeDecisionTypes'
import { routeScopeForProcess } from '@/lib/ediel/routeMatrix'

export function routeScopeForBusinessProcess(process: BusinessProcess, messageCode?: string | null): RouteScope {
  // CONTRL/APERAK/ediel_ack reuse the source message route; they have no own
  // communication_routes DB row with a dedicated scope.
  if (process === 'ediel_ack') return 'customer_masterdata'

  // Delegate to the central route matrix for all other processes.
  const messageFamily =
    process === 'customer_masterdata' ? 'PRODAT' :
    process === 'supplier_switch' ? 'PRODAT' :
    process === 'metering_access' ? 'PRODAT' :
    process === 'meter_values' ? 'UTILTS' :
    process === 'billing_underlay' ? 'UTILTS' :
    process === 'partner_export' ? 'OTHER' :
    'PRODAT'

  const scope = routeScopeForProcess({ messageFamily, messageCode })
  // routeScopeForProcess returns null only for CONTRL/APERAK; for all other
  // processes it always returns a DB-valid scope.
  if (!scope) return 'customer_masterdata'
  return scope as RouteScope
}

export function defaultMessageForProcess(process: BusinessProcess): { family: string; code: string | null; intent: OutboundIntent } {
  if (process === 'customer_masterdata') {
    return { family: 'PRODAT', code: 'Z01', intent: 'customer_masterdata_request' }
  }
  if (process === 'metering_access') {
    return { family: 'PRODAT', code: 'Z13', intent: 'metering_access_request' }
  }
  if (process === 'meter_values') {
    return { family: 'UTILTS', code: null, intent: 'meter_values_request' }
  }
  if (process === 'billing_underlay') {
    return { family: 'UTILTS', code: null, intent: 'billing_underlay_request' }
  }
  if (process === 'partner_export') {
    return { family: 'OTHER', code: null, intent: 'billing_underlay_request' }
  }
  if (process === 'ediel_ack') {
    return { family: 'APERAK', code: null, intent: 'meter_values_request' }
  }
  return { family: 'PRODAT', code: 'Z03', intent: 'supplier_switch' }
}

export function supplierSwitchSubtype(params: {
  cancellationRequested?: boolean | null
  customerChange?: boolean | null
  moveIn?: boolean | null
}): 'Z03L' | 'Z03LK' | 'Z03C' {
  if (params.cancellationRequested) return 'Z03C'
  if (params.customerChange || params.moveIn) return 'Z03LK'
  return 'Z03L'
}

export function requiresGridOwnerAgreement(process: BusinessProcess, messageCode?: string | null): boolean {
  if (process === 'metering_access') return true
  return ['Z13', 'Z18'].includes(String(messageCode ?? '').toUpperCase())
}

export function expectedApplicationReference(scope: RouteScope): string | null {
  if (scope === 'metering_access') return '23-DGI-PRODAT'
  if (scope === 'supplier_switch' || scope === 'customer_masterdata') return '23-DDQ-PRODAT'
  return null
}

export function buildAckPolicy(params: { family: string; code?: string | null }): Record<string, unknown> {
  const family = params.family.toUpperCase()
  const code = String(params.code ?? '').toUpperCase()

  return {
    requiresContrl: family !== 'CONTRL',
    requiresAperak: family === 'PRODAT' || family === 'UTILTS',
    negativeAperakAlwaysOnErrors: true,
    utiltsErrForFunctionalUtiltsErrors: family === 'UTILTS',
    ackDeadlineMinutes: 30,
    messageCode: code || null,
  }
}
