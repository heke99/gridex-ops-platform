// lib/ediel/rulebook/fieldMatrix.ts

import type { FieldRequirement } from '@/lib/ediel/rulebook/rulebook'

export type EdielFieldRule = {
  family: 'PRODAT' | 'UTILTS' | 'APERAK' | 'CONTRL' | 'UTILTS_ERR' | 'AI_LIST' | 'BI_LIST'
  code: string
  fieldKey: string
  label: string
  segmentPath: string
  requirement: FieldRequirement
  condition: string | null
  allowedValues?: string[] | null
  errorCodeIfMissing?: string | null
  errorCodeIfInvalid?: string | null
}

export const RULEBOOK_FIELD_MATRIX: readonly EdielFieldRule[] = [
  prodat('Z01', 'application_reference', 'Application Reference', 'UNB/0026', 'required', null, ['23-DDQ-PRODAT']),
  prodat('Z02', 'application_reference', 'Application Reference', 'UNB/0026', 'required', null, ['23-DDQ-PRODAT']),
  prodat('Z03', 'application_reference', 'Application Reference', 'UNB/0026', 'required', null, ['23-DDQ-PRODAT']),
  prodat('Z04', 'application_reference', 'Application Reference', 'UNB/0026', 'required', null, ['23-DDQ-PRODAT']),
  prodat('Z05', 'application_reference', 'Application Reference', 'UNB/0026', 'required', null, ['23-DDQ-PRODAT']),
  prodat('Z06', 'application_reference', 'Application Reference', 'UNB/0026', 'required', null, ['23-DDQ-PRODAT']),
  prodat('Z08', 'application_reference', 'Application Reference', 'UNB/0026', 'required', null, ['23-DDQ-PRODAT']),
  prodat('Z09', 'application_reference', 'Application Reference', 'UNB/0026', 'required', null, ['23-DDQ-PRODAT']),
  prodat('Z10', 'application_reference', 'Application Reference', 'UNB/0026', 'required', null, ['23-DDQ-PRODAT']),
  prodat('Z13', 'application_reference', 'Application Reference', 'UNB/0026', 'required', null, ['23-DGI-PRODAT']),
  prodat('Z14', 'application_reference', 'Application Reference', 'UNB/0026', 'required', null, ['23-DGI-PRODAT']),
  prodat('Z15', 'application_reference', 'Application Reference', 'UNB/0026', 'required', null, ['23-DGI-PRODAT']),
  prodat('Z18', 'application_reference', 'Application Reference', 'UNB/0026', 'required', null, ['23-DGI-PRODAT']),
  prodat('*', 'message_code', 'PRODAT-funktion', 'BGM/1001', 'required', 'BGM ska vara Z01/Z02/Z03 osv. Undertyp får aldrig bakas in i BGM.'),
  prodat('*', 'message_reference', 'Meddelande-id', 'BGM/1004', 'required', null),
  prodat('*', 'case_reference', 'Ärendereferens', 'SG8/RFF+LI', 'required', null),
  prodat('*', 'sender', 'Avsändare', 'NAD+FR', 'required', null),
  prodat('*', 'receiver', 'Mottagare', 'NAD+DO', 'required', null),
  prodat('Z03', 'transaction_type', 'Transaktionstyp', 'SG14/CCI-CAV', 'required', 'Z03L/Z03LK/Z03C anges som transaktionstyp, inte som BGM.'),
  prodat('Z13', 'transaction_type', 'Transaktionstyp', 'SG14/CCI-CAV', 'required', 'Z13V/Z13VH anges som S17/S18.'),
  prodat('Z18', 'transaction_type', 'Transaktionstyp', 'SG14/CCI-CAV', 'required', 'Z18V anges som S17.'),
  prodat('Z13', 'agreement_reference', 'Avtals-/fullmaktsreferens', 'SG8/RFF+ANJ', 'required', 'Z13 kräver avtal/fullmakt med elanvändaren.'),
  prodat('Z13', 'energy_product', 'Energiprodukt', 'SG14/CCI+Z14/CAV', 'required', 'Z13/Z14 ska bära energiprodukt.'),
  prodat('Z13', 'installation_direction', 'Riktning/typ av anläggning', 'SG14/CCI+Z22/CAV', 'required', 'Gäller mätvärdesåtkomst.'),
  utilts('E66', 'registration_timestamp', 'Registreringstidpunkt', 'DTM+597', 'required', 'E66 kvart/tim kräver riktigt datumvärde. Saknas datum ska negativ APERAK 41/512 skapas.'),
  utilts('E31', 'negative_final_share', 'Negativt slutligt andelstal', 'QTY+136', 'forbidden', 'Negativt QTY+136 är anvisningsfel och ska ge negativ APERAK 41/511a.'),
]

function prodat(
  code: string,
  fieldKey: string,
  label: string,
  segmentPath: string,
  requirement: FieldRequirement,
  condition: string | null,
  allowedValues: string[] | null = null
): EdielFieldRule {
  return {
    family: 'PRODAT',
    code,
    fieldKey,
    label,
    segmentPath,
    requirement,
    condition,
    allowedValues,
    errorCodeIfMissing: requirement === 'required' ? '41' : null,
    errorCodeIfInvalid: '40',
  }
}

function utilts(
  code: string,
  fieldKey: string,
  label: string,
  segmentPath: string,
  requirement: FieldRequirement,
  condition: string | null
): EdielFieldRule {
  return {
    family: 'UTILTS',
    code,
    fieldKey,
    label,
    segmentPath,
    requirement,
    condition,
    errorCodeIfMissing: '41',
    errorCodeIfInvalid: '41',
  }
}

export function listFieldRules(params?: {
  family?: string | null
  code?: string | null
}): EdielFieldRule[] {
  const family = params?.family?.trim().toUpperCase() ?? null
  const code = params?.code?.trim().toUpperCase() ?? null
  return RULEBOOK_FIELD_MATRIX.filter((item) => {
    if (family && item.family !== family) return false
    if (code && item.code !== code && item.code !== '*') return false
    return true
  })
}
