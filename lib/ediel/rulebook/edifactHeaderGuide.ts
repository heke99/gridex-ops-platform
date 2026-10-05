import { EDIFACT_UNUSED_HEADER_CONSTRAINTS, edifactUnusedHeaderObservations } from '@/lib/ediel/core/edifactHeaderConstraints'
import { DEFAULT_UNA, serializeUna, type EdifactServiceStringAdvice } from '@/lib/ediel/core/una'
import type { EdielRulebookIssue } from './rulebook'

export function validateEdifactHeaderGuide(input: {
  direction: 'inbound' | 'outbound'
  rawPayload?: string | null
  rawSegments?: readonly string[] | null
  una?: EdifactServiceStringAdvice
}): EdielRulebookIssue[] {
  if (!input.rawPayload && !input.rawSegments?.length) return []
  const una = input.una ?? DEFAULT_UNA
  const raw = input.rawPayload ?? serializeUna(una) + (input.rawSegments ?? []).join(una.segmentTerminator) + una.segmentTerminator
  return edifactUnusedHeaderObservations(raw, input.direction).map(observation => ({
    code: EDIFACT_UNUSED_HEADER_CONSTRAINTS.diagnosticCode,
    severity: observation.ignored ? 'warning' : 'error',
    blocking: !observation.ignored,
    title: 'Nationell UNH-anvisning',
    description: observation.ignored
      ? `Extra ${observation.field} bevaras i originalet och ignoreras enligt P119.`
      : `${observation.field} är markerat X (används ej) i den egna nationella UNH-profilen.`,
    fieldPath: observation.fieldPath,
  }))
}
