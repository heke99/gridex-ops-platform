import type { BusinessProcess, RouteScope, OutboundIntent } from '@/lib/routes/routeDecisionTypes'
import { ackModeForProcess, routeScopeForProcess } from '@/lib/ediel/routeMatrix'
import { resolveProdatApplicationReferenceForProcess } from '@/lib/ediel/core/applicationReferenceResolver'
import { getCanonicalUtiltsProfile } from '@/lib/ediel/rulebook/utiltsRulebook'

export function routeScopeForBusinessProcess(process: BusinessProcess, messageCode?: string | null): RouteScope {
  if (process === 'ediel_ack') return 'customer_masterdata'

  const messageFamily =
    process === 'customer_masterdata' ? 'PRODAT' :
    process === 'supplier_switch' ? 'PRODAT' :
    process === 'metering_access' ? 'PRODAT' :
    process === 'meter_values' ? 'UTILTS' :
    process === 'billing_underlay' ? 'UTILTS' :
    process === 'partner_export' ? 'OTHER' :
    'PRODAT'

  const scope = routeScopeForProcess({
    messageFamily,
    messageCode,
    applicationReference: process === 'billing_underlay' ? 'billing_underlay' : null,
  })
  if (!scope) throw new Error(`route_scope_not_materializable:${process}`)
  return scope as RouteScope
}

export function defaultMessageForProcess(process: BusinessProcess): { family: string; code: string | null; intent: OutboundIntent } {
  if (process === 'customer_masterdata') return { family: 'PRODAT', code: 'Z01', intent: 'customer_masterdata_request' }
  if (process === 'metering_access') return { family: 'PRODAT', code: 'Z13', intent: 'metering_access_request' }
  if (process === 'meter_values') return { family: 'UTILTS', code: null, intent: 'meter_values_request' }
  if (process === 'billing_underlay') return { family: 'UTILTS', code: null, intent: 'billing_underlay_request' }
  if (process === 'partner_export') return { family: 'OTHER', code: null, intent: 'billing_underlay_request' }
  if (process === 'ediel_ack') return { family: 'APERAK', code: null, intent: 'meter_values_request' }
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

/**
 * Compatibility projection for old route callers that only know a DB route
 * scope. Values are delegated to the canonical PRODAT profile authority; no
 * Application Reference literal is owned here.
 */
export function expectedApplicationReference(scope: RouteScope): string | null {
  if (scope === 'metering_access') return resolveProdatApplicationReferenceForProcess('metering_access')
  if (scope === 'supplier_switch') return resolveProdatApplicationReferenceForProcess('supplier_switch')
  if (scope === 'customer_masterdata') return resolveProdatApplicationReferenceForProcess('customer_masterdata')
  return null
}

/**
 * Compatibility projection only. ACK semantics are read from canonical message
 * profiles through ackModeForProcess/getCanonicalUtiltsProfile.
 */
export function buildAckPolicy(params: { family: string; code?: string | null }): Record<string, unknown> {
  const family = params.family.toUpperCase()
  const code = String(params.code ?? '').toUpperCase()
  const mode = ackModeForProcess({ messageFamily: family, messageCode: code || null })
  const requiresContrl = mode === 'contrl_only' || mode === 'contrl_and_aperak'
  const requiresAperak = mode === 'contrl_and_aperak'
  const utiltsProfile = family === 'UTILTS' && code ? getCanonicalUtiltsProfile(code) : null

  return {
    requiresContrl,
    requiresAperak,
    negativeAperakAlwaysOnErrors: requiresAperak,
    utiltsErrForFunctionalUtiltsErrors: utiltsProfile?.functionalErrorResult === 'utilts_err',
    ackDeadlineMinutes: 30,
    messageCode: code || null,
  }
}
