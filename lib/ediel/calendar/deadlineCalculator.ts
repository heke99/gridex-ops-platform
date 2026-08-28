import { canonicalDeadlineForAction } from '@/lib/ediel/rulebook/canonicalEdielFacade'

export type EdielDeadlineEvaluation = {
  ok: boolean
  actionType: string
  requestedDate: string | null
  earliestAllowedDate: string | null
  latestAllowedDate: string | null
  issues: string[]
}

/**
 * Operational adapter over the source-controlled canonical Ediel timing engine.
 *
 * Normative timing must never be loaded from tenant/database rows. The database
 * may retain historical deadline rows as evidence/projection only.
 */
export async function evaluateEdielDeadline(input: {
  actionType: string
  messageFamily: string
  businessCode?: string | null
  requestedDate?: string | null
  historicalStartDate?: string | null
  historicalEndDate?: string | null
  networkContractStartDate?: string | null
  now?: Date
}): Promise<EdielDeadlineEvaluation> {
  if (String(input.messageFamily ?? '').trim().toUpperCase() !== 'PRODAT') {
    return {
      ok: false,
      actionType: input.actionType,
      requestedDate: input.requestedDate?.slice(0, 10) ?? null,
      earliestAllowedDate: null,
      latestAllowedDate: null,
      issues: [`Canonical Ediel-tidsregel saknas för ${input.messageFamily || 'missing'}:${input.businessCode || input.actionType}.`],
    }
  }

  const result = canonicalDeadlineForAction({
    actionType: input.actionType,
    requestedDate: input.requestedDate,
    historicalStartDate: input.historicalStartDate,
    historicalEndDate: input.historicalEndDate,
    networkContractStartDate: input.networkContractStartDate,
    now: input.now,
  })

  return {
    ok: result.ok,
    actionType: result.actionType,
    requestedDate: result.requestedDate,
    earliestAllowedDate: result.earliestAllowedDate,
    latestAllowedDate: result.latestAllowedDate,
    issues: result.issues,
  }
}
