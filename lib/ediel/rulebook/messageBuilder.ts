// lib/ediel/rulebook/messageBuilder.ts

import { renderProdat } from '@/lib/ediel/prodat/engine'
import type { ProdatEngineInput, ProdatEngineRenderResult } from '@/lib/ediel/prodat/types'
import { validateProdatRulebookInput } from '@/lib/ediel/rulebook/validator'

export type RulebookBuildResult = ProdatEngineRenderResult & {
  rulebookStatus: 'ok' | 'warning' | 'failed'
}

export function buildRulebookProdatMessage(input: ProdatEngineInput): RulebookBuildResult {
  const rulebookValidation = validateProdatRulebookInput(input)
  const rendered = renderProdat(input)
  const convertedIssues = rulebookValidation.issues.map((item) => ({
    severity: item.severity === 'error' ? 'error' as const : 'warning' as const,
    code: item.code,
    title: item.title,
    description: item.description,
  }))

  return {
    ...rendered,
    issues: [...convertedIssues, ...rendered.issues],
    rulebookStatus: rulebookValidation.status,
  }
}
