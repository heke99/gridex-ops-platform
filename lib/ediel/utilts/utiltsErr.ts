import type { UtiltsRuntimeAckPlan } from '@/lib/ediel/utiltsEngine'

export const SUPPORTED_UTILTS_ERR_CODES = ['E87', 'E10', 'E14', 'E49', 'E50', 'E55', 'E61', 'E19'] as const

export function shouldBuildUtiltsErr(plan: UtiltsRuntimeAckPlan): boolean {
  return plan.shouldSendUtiltsErr && plan.utiltsErrCodes.length > 0
}

export function normalizeUtiltsErrCodes(codes: readonly string[]): string[] {
  return Array.from(new Set(codes.map((code) => code.trim().toUpperCase()).filter(Boolean)))
}
