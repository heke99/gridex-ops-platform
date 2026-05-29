import type { EdielRulebookRequirement } from '@/lib/ediel/rulebook/rulebook'

export type RulebookFieldRule = {
  family: string
  code: string
  fieldKey: string
  label: string
  segmentPath: string
  requirement: EdielRulebookRequirement
  condition?: string | null
  allowedValues?: string[]
  errorCodeIfMissing?: string | null
  errorCodeIfInvalid?: string | null
}

export const STATIC_FIELD_RULES: RulebookFieldRule[] = [
  { family: 'PRODAT', code: '*', fieldKey: 'application_reference', label: 'Application Reference', segmentPath: 'UNB/S005/0026', requirement: 'required', errorCodeIfMissing: 'APPLICATION_REFERENCE_MISSING' },
  { family: 'PRODAT', code: '*', fieldKey: 'message_code', label: 'PRODAT-funktion', segmentPath: 'BGM/C002/1001', requirement: 'required', errorCodeIfMissing: 'BGM_MISSING' },
  { family: 'PRODAT', code: '*', fieldKey: 'sender_ediel_id', label: 'Avsändare Ediel-id', segmentPath: 'UNB/S002', requirement: 'required', errorCodeIfMissing: 'SENDER_MISSING' },
  { family: 'PRODAT', code: '*', fieldKey: 'receiver_ediel_id', label: 'Mottagare Ediel-id', segmentPath: 'UNB/S003', requirement: 'required', errorCodeIfMissing: 'RECEIVER_MISSING' },
  { family: 'PRODAT', code: 'Z03', fieldKey: 'metering_point_id', label: 'Anläggnings-/mätpunkts-id', segmentPath: 'SG5/LIN', requirement: 'required', errorCodeIfMissing: 'METERING_POINT_MISSING' },
  { family: 'PRODAT', code: 'Z13', fieldKey: 'agreement_reference', label: 'Avtals-/fullmaktsreferens', segmentPath: 'SG8/RFF+ANJ', requirement: 'required', errorCodeIfMissing: 'AGREEMENT_REFERENCE_MISSING' },
  { family: 'PRODAT', code: 'Z13', fieldKey: 'energy_product', label: 'Energiprodukt', segmentPath: 'SG14/CCI+Z14', requirement: 'required', errorCodeIfMissing: 'ENERGY_PRODUCT_MISSING' },
  { family: 'PRODAT', code: 'Z13', fieldKey: 'installation_direction', label: 'Riktning/typ av anläggning', segmentPath: 'SG14/CCI+Z22', requirement: 'required', errorCodeIfMissing: 'INSTALLATION_DIRECTION_MISSING' },
  { family: 'UTILTS', code: 'E66', fieldKey: 'registration_time', label: 'Registreringstidpunkt', segmentPath: 'DTM+597', requirement: 'dependent', condition: 'Krävs för kvart/tim E66', errorCodeIfMissing: 'UTILTS_DTM_597_MISSING' },
  { family: 'APERAK', code: 'APERAK', fieldKey: 'application_error', label: 'Applikationsfel', segmentPath: 'ERC/FTX', requirement: 'dependent', condition: 'Krävs vid negativ APERAK', errorCodeIfMissing: 'APERAK_ERROR_MISSING' },
]

export function fieldRulesForMessage(family: string | null | undefined, code: string | null | undefined): RulebookFieldRule[] {
  const f = String(family ?? '').toUpperCase()
  const c = String(code ?? '').toUpperCase()
  return STATIC_FIELD_RULES.filter((rule) => rule.family === f && (rule.code === '*' || rule.code === c))
}
