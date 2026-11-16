// lib/ediel/prodatPortalReadiness.ts

import type { EdielMessageRow } from '@/lib/ediel/types'

export type ProdatPortalReadinessSeverity = 'info' | 'warning' | 'error'

export type ProdatPortalReadinessIssue = {
  code: string
  severity: ProdatPortalReadinessSeverity
  title: string
  description: string
}

export type ProdatPortalReadinessResult = {
  checked: boolean
  readyForInternalFileTest: boolean
  readyForPortalTrial: boolean
  issues: ProdatPortalReadinessIssue[]
  formattedPayload: string | null
  segmentCount: number
}

function addIssue(
  issues: ProdatPortalReadinessIssue[],
  issue: ProdatPortalReadinessIssue
) {
  issues.push(issue)
}

export function formatEdifactForDisplay(rawPayload: string | null | undefined): string | null {
  if (!rawPayload) return null

  const normalized = rawPayload
    .replace(/\\r\\n/g, '\n')
    .replace(/\\n/g, '\n')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .trim()

  if (!normalized) return null

  if (normalized.includes("'\n")) return normalized

  return normalized
    .split("'")
    .map((segment) => segment.trim())
    .filter(Boolean)
    .map((segment) => `${segment}'`)
    .join('\n')
}

function segmentLines(rawPayload: string | null | undefined): string[] {
  const formatted = formatEdifactForDisplay(rawPayload)
  if (!formatted) return []
  return formatted
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
}

function hasSegment(lines: string[], segment: string): boolean {
  return lines.some((line) => line.startsWith(`${segment}+`) || line === `${segment}'`)
}

function countSegments(lines: string[], segment: string): number {
  return lines.filter((line) => line.startsWith(`${segment}+`) || line === `${segment}'`).length
}

export function evaluateProdatPortalReadiness(
  message: EdielMessageRow
): ProdatPortalReadinessResult {
  const issues: ProdatPortalReadinessIssue[] = []
  const formattedPayload = formatEdifactForDisplay(message.raw_payload)
  const lines = segmentLines(message.raw_payload)

  if (message.message_family !== 'PRODAT') {
    return {
      checked: false,
      readyForInternalFileTest: false,
      readyForPortalTrial: false,
      issues: [
        {
          code: 'not_prodat',
          severity: 'info',
          title: 'Inte PRODAT',
          description: 'Portal-readiness-panelen gäller bara PRODAT-meddelanden.',
        },
      ],
      formattedPayload,
      segmentCount: lines.length,
    }
  }

  if (!formattedPayload || lines.length === 0) {
    addIssue(issues, {
      code: 'missing_raw_payload',
      severity: 'error',
      title: 'Saknar EDIFACT-innehåll',
      description: 'Meddelandet saknar raw_payload och kan inte exporteras/testas.',
    })
  }

  for (const segment of ['UNB', 'UNH', 'BGM', 'DTM', 'RFF', 'NAD', 'UNT', 'UNZ']) {
    if (!hasSegment(lines, segment)) {
      addIssue(issues, {
        code: `missing_${segment.toLowerCase()}`,
        severity: 'error',
        title: `Saknar ${segment}`,
        description: `PRODAT-utkastet saknar obligatoriskt ${segment}-segment i intern portal-check.`,
      })
    }
  }

  if (countSegments(lines, 'NAD') < 2) {
    addIssue(issues, {
      code: 'too_few_parties',
      severity: 'warning',
      title: 'Få NAD-parter',
      description: 'PRODAT brukar behöva tydliga parter. Kontrollera att nätägare/leverantör/kundroller är korrekt modellerade.',
    })
  }

  const ddqCount = lines.filter((line) => line.startsWith('NAD+DDQ')).length
  if (ddqCount > 1) {
    addIssue(issues, {
      code: 'duplicate_ddq_party_role',
      severity: 'warning',
      title: 'Flera NAD+DDQ',
      description: 'Filen innehåller fler än en DDQ-part. Kontrollera rollkoderna mot Edielportalens felrapport innan slutgodkännande.',
    })
  }

  if (message.message_code === 'Z03') {
    if (formattedPayload?.includes('1234')) {
      addIssue(issues, {
        code: 'possible_placeholder_1234',
        severity: 'warning',
        title: 'Möjligt placeholder-värde 1234',
        description: 'Filen innehåller 1234. Kontrollera att anläggnings-, nätområdes- och mätpunktsvärden kommer från rätt testdata eller masterdata.',
      })
    }

    if (!message.application_reference) {
      addIssue(issues, {
        code: 'missing_application_reference',
        severity: 'error',
        title: 'Application Reference saknas',
        description: 'PRODAT-test mot Edielportalen kräver rätt application reference.',
      })
    }

    if (!message.sender_ediel_id) {
      addIssue(issues, {
        code: 'missing_sender_ediel_id',
        severity: 'error',
        title: 'Sender Ediel-ID saknas',
        description: 'Filen måste ha avsändarens Ediel-ID.',
      })
    }

    if (!message.receiver_ediel_id) {
      addIssue(issues, {
        code: 'missing_receiver_ediel_id',
        severity: 'error',
        title: 'Receiver Ediel-ID saknas',
        description: 'Filen måste ha mottagarens Ediel-ID.',
      })
    }
  }

  if (lines.length > 0 && !formattedPayload?.includes('\n')) {
    addIssue(issues, {
      code: 'single_line_payload',
      severity: 'info',
      title: 'Filen är enradig',
      description: 'EDIFACT kan vara enradig, men Gridex visar en rad per segment i export-/granskningsvyn för enklare felsökning.',
    })
  }

  const hasErrors = issues.some((issue) => issue.severity === 'error')
  const hasWarnings = issues.some((issue) => issue.severity === 'warning')

  return {
    checked: true,
    readyForInternalFileTest: !hasErrors,
    readyForPortalTrial: !hasErrors && !hasWarnings,
    issues,
    formattedPayload,
    segmentCount: lines.length,
  }
}
