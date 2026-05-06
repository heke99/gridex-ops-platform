// lib/ediel/prodat/render/validate.ts

import type { ProdatEngineProductionContext, ProdatEngineValidationIssue } from '@/lib/ediel/prodat/types'
import { compactProdatReference, sanitizeProdatText } from '@/lib/ediel/prodat/render/segments'

export function validateProdatContext(context: ProdatEngineProductionContext): ProdatEngineValidationIssue[] {
  const issues: ProdatEngineValidationIssue[] = []
  if (!sanitizeProdatText(context.senderEdielId)) {
    issues.push({
      severity: 'error',
      code: 'prodat_engine_sender_missing',
      title: 'Avsändare saknas',
      description: 'PRODAT engine kräver senderEdielId innan EDIFACT kan renderas.',
    })
  }
  if (!sanitizeProdatText(context.receiverEdielId)) {
    issues.push({
      severity: 'error',
      code: 'prodat_engine_receiver_missing',
      title: 'Mottagare saknas',
      description: 'PRODAT engine kräver receiverEdielId innan EDIFACT kan renderas.',
    })
  }
  if (!sanitizeProdatText(context.meterPointId)) {
    issues.push({
      severity: 'error',
      code: 'prodat_engine_metering_point_missing',
      title: 'Anläggnings-id saknas',
      description: 'PRODAT engine kräver mätpunkt/anläggnings-id till LIN.',
    })
  }
  if (!compactProdatReference(context.bgmReference, 35)) {
    issues.push({
      severity: 'error',
      code: 'prodat_engine_bgm_reference_missing',
      title: 'Meddelande-id saknas',
      description: 'PRODAT engine kräver BGM/1004.',
    })
  }
  if (!compactProdatReference(context.transactionReference, 35)) {
    issues.push({
      severity: 'error',
      code: 'prodat_engine_case_reference_missing',
      title: 'Ärendereferens saknas',
      description: 'PRODAT engine kräver RFF+LI för PRODAT-ärendet.',
    })
  }
  return issues
}
