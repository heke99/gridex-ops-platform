import 'server-only'
import type { CustomerSiteRow, MeteringPointRow } from '@/lib/masterdata/types'
import {
  derivePowerOfAttorneyLifecycleStatus, hasExternallySendablePoa, hasLegalPoaAcceptance,
  unknownSitePoaReadiness, type CustomerCardPoaReadiness, type SitePoaReadiness, type SitePoaScope,
} from '@/lib/customers/poaReadiness'
import { selectCustomerCardMeteringPoint } from '@/lib/customers/customerCardSnapshot'
import { manualPoaIsCurrentlyValid, poaScopeAllows } from '@/lib/customer-operations/manualGridOwnerSendGuards'
import { evaluateSiteSwitchReadiness } from '@/lib/operations/readiness'
import type { PowerOfAttorneyRow } from '@/lib/operations/types'

type Row = Record<string, unknown>
export type SitePoaReadContext = {
  companyId: string
  customerId: string
  actor: { id: string; companyId: string | null; isPlatformAdmin: boolean; canOperate: boolean | null }
  asOf: string
  parentCoverage: 'complete' | 'partial' | 'unknown'
  customerIdentity?: string | null
}
const text = (value: unknown): string | null => typeof value === 'string' && value.trim() ? value.trim() : null
const known = (row: Row, field: string): boolean => Object.hasOwn(row, field) && row[field] !== undefined
const validNullableDate = (value: unknown): boolean => value === null
  || (typeof value === 'string' && Number.isFinite(Date.parse(value)))

/** Synchronous composition of the existing send guards; performs no I/O. */
export function buildSitePoaReadiness(input: {
  site: CustomerSiteRow | null
  meteringPoint?: MeteringPointRow | null
  powersOfAttorney: Row[]
  scope: SitePoaScope
  context: SitePoaReadContext
}): SitePoaReadiness {
  const { site, context, scope } = input
  const result = unknownSitePoaReadiness({ scope, companyId: context.companyId, customerId: context.customerId,
    siteId: site?.id, meteringPointId: input.meteringPoint?.id, asOf: context.asOf })
  result.parentCoverage = context.parentCoverage
  result.actorId = text(context.actor?.id)
  const now = new Date(context.asOf)
  if (!Number.isFinite(now.getTime()) || !site || !text(site.id) || !text(context.companyId) || !text(context.customerId)
    || site.company_id !== context.companyId || site.customer_id !== context.customerId) return result
  const actorQualified = Boolean(result.actorId && context.actor && typeof context.actor.canOperate === 'boolean'
    && (context.actor.companyId === context.companyId || context.actor.isPlatformAdmin === true))
  const point = input.meteringPoint
  if (point && (!text(point.id) || point.site_id !== site.id || point.company_id !== context.companyId || point.customer_id !== context.customerId)) return result

  const matching = input.powersOfAttorney.filter(row => row && typeof row === 'object'
    && row.company_id === context.companyId && row.customer_id === context.customerId
    && (text(row.site_id) ?? text(row.customer_site_id)) === site.id)
  const switchSelectionKnown = matching.every(row => typeof row.created_at === 'string' && Number.isFinite(Date.parse(row.created_at)))
  const switchPrerequisite = scope === 'supplier_switch' && switchSelectionKnown
    ? evaluateSiteSwitchReadiness({ site, meteringPoints: point ? [point] : [],
      powersOfAttorney: matching as unknown as PowerOfAttorneyRow[], now }) : null
  for (const row of matching) {
    const poaId = text(row.id)
    if (!poaId) continue
    const legallyAccepted = hasLegalPoaAcceptance(row)
    const evidenceComplete = hasExternallySendablePoa(row, { customerIdentity: context.customerIdentity })
    const lifecycle = derivePowerOfAttorneyLifecycleStatus(row, { now })
    // Unknown omitted columns cannot stand in for explicit nullable facts.
    const complete = ['status', 'scope', 'scope_summary', 'valid_from', 'valid_to', 'valid_until', 'revoked_at', 'expires_at',
      'signed_at', 'accepted_at', 'legal_text_version_id', 'evidence_payload', 'fullmakt_snapshot',
      'signer_name', 'signer_identity_number', 'method', 'document_id', 'document_path', 'source']
      .every(field => known(row, field))
      && ['valid_from', 'valid_to', 'valid_until', 'expires_at', 'revoked_at', 'signed_at', 'accepted_at'].every(field => validNullableDate(row[field]))
      && !(text(row.site_id) && text(row.customer_site_id) && text(row.site_id) !== text(row.customer_site_id))
    const acceptedForOperation = scope === 'supplier_switch' ? row.status === 'signed'
      : ['signed', 'active', 'accepted'].includes(String(row.status))
    const usableNow = complete && actorQualified ? context.actor.canOperate === true && legallyAccepted && evidenceComplete
      && acceptedForOperation && manualPoaIsCurrentlyValid(row, now) && poaScopeAllows(row, scope)
      && (scope !== 'supplier_switch' || Boolean(switchPrerequisite && switchPrerequisite.latestPowerOfAttorneyId === poaId
        && !switchPrerequisite.issues.some(issue => issue.code.startsWith('power_of_attorney_')))) : null
    result.rows.push({ poaId, legallyAccepted, evidenceComplete, lifecycle, usableNow })
  }
  result.legallyAccepted = result.rows.some(row => row.legallyAccepted)
  result.evidenceComplete = result.rows.some(row => row.evidenceComplete)
  const usable = result.rows.find(row => row.usableNow === true)
  if (usable) {
    result.kind = 'ready'; result.usableNow = true; result.powerOfAttorneyId = usable.poaId
    result.explanation = 'Fullmakten är giltig för vald anläggning och åtgärd. Övriga villkor kontrolleras igen när åtgärden körs.'
  } else if (actorQualified && context.actor.canOperate === false) {
    result.kind = 'blocked'; result.usableNow = false
    result.explanation = 'Din aktuella behörighet tillåter inte att starta åtgärden.'
  } else if (actorQualified && context.parentCoverage === 'complete' && result.rows.every(row => row.usableNow !== null)) {
    result.kind = 'blocked'; result.usableNow = false
    result.explanation = 'Giltig fullmakt med komplett underlag för vald anläggning och åtgärd saknas. Granska eller förnya fullmakten.'
  }
  return result
}

/** Fan out already-qualified actor facts; no per-site authority reads or I/O. */
export function buildCustomerCardSitePoaReadiness(input: {
  sites: CustomerSiteRow[]
  meteringPoints: MeteringPointRow[]
  powersOfAttorney: Row[]
  context: SitePoaReadContext
}): Record<string, CustomerCardPoaReadiness> {
  return Object.fromEntries(input.sites.map(site => {
    const shared = { site, meteringPoint: selectCustomerCardMeteringPoint(site, input.meteringPoints),
      powersOfAttorney: input.powersOfAttorney, context: input.context }
    return [site.id, {
      facility: buildSitePoaReadiness({ ...shared, scope: 'facility_information_lookup' }),
      supplierSwitch: buildSitePoaReadiness({ ...shared, scope: 'supplier_switch' }),
    }]
  }))
}
