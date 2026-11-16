import type { UtiltsRuntimeAckPlan } from '@/lib/ediel/utiltsEngine'

export function shouldBuildUtiltsAperak(plan: UtiltsRuntimeAckPlan): boolean {
  return plan.shouldSendAperak && !plan.shouldSendUtiltsErr
}

export function utiltsAperakBgmCode(plan: UtiltsRuntimeAckPlan): '312' | '313' {
  return plan.aperakOutcome === 'negative' ? '313' : '312'
}
