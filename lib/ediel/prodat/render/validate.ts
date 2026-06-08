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

  if (context.code === 'Z13') {
    const reason = sanitizeProdatText(context.reasonForTransaction).toUpperCase()
    const isHistoricalRequest = reason === 'S18' || reason === 'VH' || reason === 'Z13VH'
    const hasEndUserIdentity = Boolean(sanitizeProdatText(context.customerId) && sanitizeProdatText(context.customerName))

    if (!hasEndUserIdentity) {
      issues.push({
        severity: 'error',
        code: 'prodat_z13_end_user_missing',
        title: 'Slutkund saknas för Z13',
        description: 'PRODAT Z13 ska innehålla SG17 NAD+UD med både kund-id och namn. Systemet ska inte skicka historisk eller löpande mätvärdesbegäran utan identifierbar kund.',
      })
    }

    if (isHistoricalRequest && !sanitizeProdatText(context.startDate)) {
      issues.push({
        severity: 'error',
        code: 'prodat_z13vh_report_start_missing',
        title: 'Rapportstart saknas för Z13VH',
        description: 'PRODAT Z13VH ska innehålla DTM+90 med historiskt rapportstartdatum.',
      })
    }

    if (isHistoricalRequest && !sanitizeProdatText(context.permissionEndDate)) {
      issues.push({
        severity: 'error',
        code: 'prodat_z13vh_report_end_missing',
        title: 'Rapportslut saknas för Z13VH',
        description: 'PRODAT Z13VH ska innehålla DTM+91 med historiskt rapportslutdatum.',
      })
    }
  }

  if (context.code === 'Z18') {
    const hasEndUserIdentity = Boolean(sanitizeProdatText(context.customerId) || sanitizeProdatText(context.customerName))
    const hasPermissionId = Boolean(sanitizeProdatText(context.permissionId) || sanitizeProdatText(context.powerOfAttorneyReference))
    const hasEndReason = Boolean(sanitizeProdatText(context.permissionEndReason))
    const hasEndDate = Boolean(sanitizeProdatText(context.permissionEndDate) || sanitizeProdatText(context.startDate))

    if (!hasEndUserIdentity) {
      issues.push({
        severity: 'error',
        code: 'prodat_z18_end_user_missing',
        title: 'Slutkund saknas för Z18',
        description: 'PRODAT Z18 ska innehålla SG17 NAD+UD. I produktion måste slutkund kopplas från aktivt tillstånd/kund innan avslutsbegäran skickas.',
      })
    }

    if (!hasPermissionId) {
      issues.push({
        severity: 'error',
        code: 'prodat_z18_permission_id_missing',
        title: 'Tillståndets id saknas för Z18',
        description: 'PRODAT Z18 ska innehålla RFF+Z09 med tillståndets id. Systemet ska inte gissa detta i produktion.',
      })
    }

    if (!hasEndReason) {
      issues.push({
        severity: 'error',
        code: 'prodat_z18_end_reason_missing',
        title: 'Avslutsorsak saknas för Z18',
        description: 'PRODAT Z18 ska innehålla CCI++Z25/CAV med orsak till att tillståndet upphör.',
      })
    }

    if (!hasEndDate) {
      issues.push({
        severity: 'error',
        code: 'prodat_z18_end_date_missing',
        title: 'Sluttid saknas för Z18',
        description: 'PRODAT Z18 ska innehålla DTM+164 med tidpunkt då tjänsten/rapporteringen upphör.',
      })
    }
  }
  return issues
}
