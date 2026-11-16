import type { EdielMessageRow } from '@/lib/ediel/types'
import { matchCustomerForAutomation } from '@/lib/ediel/matching/customerMatcher'
import { matchMeteringPointForAutomation } from '@/lib/ediel/matching/meteringPointMatcher'
import { matchPermissionForAutomation } from '@/lib/ediel/matching/permissionMatcher'
import { matchProcessForAutomation } from '@/lib/ediel/matching/processMatcher'
import {
  compactMatchCandidates,
  confidenceFromScore,
  type EdielBusinessMatchResult,
  type EdielMatchCandidate,
} from '@/lib/ediel/matching/matchingTypes'

function firstEntity(candidates: EdielMatchCandidate[], entityType: EdielMatchCandidate['entityType']): EdielMatchCandidate | null {
  return candidates.find((candidate) => candidate.entityType === entityType && Boolean(candidate.entityId)) ?? null
}

function detailString(candidate: EdielMatchCandidate | null, key: string): string | null {
  const value = candidate?.details?.[key]
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

export async function resolveEdielBusinessMatch(params: {
  message: EdielMessageRow
  companyId?: string | null
}): Promise<EdielBusinessMatchResult> {
  const companyId = params.companyId ?? params.message.company_id ?? null
  const [meteringPointCandidates, customerCandidates, permissionCandidates, processCandidates] = await Promise.all([
    matchMeteringPointForAutomation({ message: params.message, companyId }),
    matchCustomerForAutomation({ message: params.message, companyId }),
    matchPermissionForAutomation({ message: params.message, companyId }),
    matchProcessForAutomation({ message: params.message, companyId }),
  ])

  const candidates = compactMatchCandidates([
    ...meteringPointCandidates,
    ...customerCandidates,
    ...permissionCandidates,
    ...processCandidates,
  ])

  const bestScore = candidates[0]?.score ?? 0
  const confidence = confidenceFromScore(bestScore)
  const meteringPoint = firstEntity(candidates, 'metering_point')
  const customer = firstEntity(candidates, 'customer')
  const process = firstEntity(candidates, 'process')
  const permission = firstEntity(candidates, 'permission')

  const customerId =
    detailString(meteringPoint, 'customerId') ??
    detailString(process, 'customerId') ??
    detailString(permission, 'customerId') ??
    customer?.entityId ??
    params.message.customer_id ??
    null

  const siteId =
    detailString(meteringPoint, 'siteId') ??
    detailString(process, 'siteId') ??
    detailString(permission, 'siteId') ??
    params.message.site_id ??
    null

  const meteringPointId =
    meteringPoint?.entityId ??
    detailString(process, 'meteringPointId') ??
    detailString(permission, 'meteringPointId') ??
    params.message.metering_point_id ??
    null

  const processType = detailString(process, 'processType') ?? params.message.process_type ?? null
  const processId = process?.entityId ?? params.message.switch_request_id ?? params.message.grid_owner_data_request_id ?? null
  const permissionId = permission?.entityId ?? null
  const warnings: string[] = []

  if (!companyId) warnings.push('company_id saknas; business match får inte autolänkas till tenant.')
  if (confidence !== 'high') warnings.push('Business match är inte high confidence och ska inte autoskicka business-ACK i produktion.')

  return {
    confidence,
    customerId,
    siteId,
    meteringPointId,
    processId,
    processType,
    permissionId,
    candidates,
    reasons: candidates.slice(0, 5).map((candidate) => `${candidate.reason}:${candidate.score}`),
    warnings,
    manualReviewReason: confidence === 'high' ? null : 'business_match_low_confidence',
  }
}

export type { EdielBusinessMatchResult, EdielMatchCandidate, EdielMatchConfidence } from '@/lib/ediel/matching/matchingTypes'
