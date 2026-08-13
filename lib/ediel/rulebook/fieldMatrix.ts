import type { EdielRulebookIssue, EdielRulebookRequirement } from '@/lib/ediel/rulebook/rulebook'

export type RulebookFieldRule = {
  family: string
  code: string
  fieldNumber?: string
  scope?: 'header' | 'transaction' | 'observation'
  fieldKey: string
  label: string
  segmentPath: string | null
  requirement: EdielRulebookRequirement
  condition?: string | null
  allowedValues?: string[]
  errorCodeIfMissing?: string | null
  errorCodeIfInvalid?: string | null
  severity?: 'warning' | 'error'
  dependency?: {
    anySegmentPresent?: string[]
    allSegmentPresent?: string[]
  } | null
  source?: 'static' | 'registry'
}

export type FieldMatrixEvaluationInput = {
  family?: string | null
  code?: string | null
  rawSegments?: readonly string[] | null
  applicationReference?: string | null
  expectedApplicationReference?: string | null
  mode?: 'send' | 'parse' | 'test'
}

function normalize(value: string | null | undefined): string {
  return String(value ?? '').trim().toUpperCase()
}

function tags(rawSegments: readonly string[] | null | undefined): string[] {
  return (rawSegments ?? []).map((segment) => segment.split('+')[0]?.trim().toUpperCase() ?? '')
}

function hasPrefix(rawSegments: readonly string[] | null | undefined, prefix: string): boolean {
  const normalized = prefix.toUpperCase()
  return (rawSegments ?? []).some((segment) => segment.toUpperCase().startsWith(normalized))
}

function hasSegmentTag(rawSegments: readonly string[] | null | undefined, tag: string): boolean {
  const normalized = tag.toUpperCase()
  return (rawSegments ?? []).some((segment) => {
    const upper = segment.toUpperCase()
    return upper === normalized || upper.startsWith(`${normalized}+`)
  })
}

function first(rawSegments: readonly string[] | null | undefined, prefix: string): string | null {
  const normalized = prefix.toUpperCase()
  return (rawSegments ?? []).find((segment) => segment.toUpperCase().startsWith(normalized)) ?? null
}

function element(segment: string | null | undefined, index: number): string | null {
  const value = segment?.split('+')[index]?.trim() ?? ''
  return value.length > 0 ? value : null
}

function components(value: string | null | undefined): string[] {
  return String(value ?? '').split(':').map((part) => part.trim()).filter(Boolean)
}

function bgmCode(rawSegments: readonly string[] | null | undefined): string | null {
  const bgm = first(rawSegments, 'BGM+')
  return components(element(bgm, 1))[0]?.toUpperCase() ?? null
}

function hasCci(rawSegments: readonly string[] | null | undefined, qualifier: string): boolean {
  const expected = `CCI++${qualifier.toUpperCase()}`
  return (rawSegments ?? []).some((segment) => segment.toUpperCase() === expected || segment.toUpperCase().startsWith(`${expected}+`))
}

function hasCciWithFollowingCav(rawSegments: readonly string[] | null | undefined, qualifier: string): boolean {
  const segments = rawSegments ?? []
  const expected = `CCI++${qualifier.toUpperCase()}`
  const index = segments.findIndex((segment) => segment.toUpperCase() === expected || segment.toUpperCase().startsWith(`${expected}+`))
  if (index < 0) return false
  for (let cursor = index + 1; cursor < segments.length; cursor += 1) {
    const upper = segments[cursor]?.toUpperCase() ?? ''
    if (upper.startsWith('CCI+')) return false
    if (upper.startsWith('CAV+') && upper.length > 4) return true
  }
  return false
}

function valueAfterCci(rawSegments: readonly string[] | null | undefined, qualifier: string): string | null {
  const segments = rawSegments ?? []
  const expected = `CCI++${qualifier.toUpperCase()}`
  const index = segments.findIndex((segment) => segment.toUpperCase() === expected || segment.toUpperCase().startsWith(`${expected}+`))
  if (index < 0) return null
  for (let cursor = index + 1; cursor < segments.length; cursor += 1) {
    const upper = segments[cursor]?.toUpperCase() ?? ''
    if (upper.startsWith('CCI+')) return null
    if (upper.startsWith('CAV+')) return components(element(segments[cursor], 1))[0]?.toUpperCase() ?? null
  }
  return null
}

function ftxHasOk(rawSegments: readonly string[] | null | undefined): boolean {
  return (rawSegments ?? []).some((segment) => segment.toUpperCase().startsWith('FTX+') && segment.toUpperCase().includes('OK'))
}

function ercCodes(rawSegments: readonly string[] | null | undefined): string[] {
  return (rawSegments ?? [])
    .filter((segment) => segment.toUpperCase().startsWith('ERC+'))
    .map((segment) => components(element(segment, 1))[0]?.toUpperCase() ?? '')
    .filter(Boolean)
}

function hasAnyNad(rawSegments: readonly string[] | null | undefined, qualifier: string): boolean {
  return hasPrefix(rawSegments, `NAD+${qualifier.toUpperCase()}+`) || hasPrefix(rawSegments, `NAD+${qualifier.toUpperCase()}'`)
}

function issue(input: Omit<EdielRulebookIssue, 'blocking'>): EdielRulebookIssue {
  return { ...input, blocking: input.severity === 'error' }
}

function normalizeSegmentPath(path: string | null | undefined): string {
  return String(path ?? '').trim().toUpperCase()
}

function segmentPathAlternatives(path: string | null | undefined): string[] {
  return normalizeSegmentPath(path)
    .split(/[|,;]/)
    .map((item) => item.trim())
    .filter(Boolean)
}

function pathPresence(rawSegments: readonly string[] | null | undefined, path: string | null | undefined): boolean {
  const alternatives = segmentPathAlternatives(path)
  if (alternatives.length === 0) return false

  return alternatives.some((candidate) => {
    if (candidate.startsWith('CCI++')) {
      const qualifier = candidate.match(/^CCI\+\+([A-Z0-9]+)/)?.[1]
      return qualifier ? hasCci(rawSegments, qualifier) : false
    }

    if (candidate.includes('+')) {
      const prefix = candidate.includes('/') ? candidate.split('/')[0] : candidate
      if (!prefix) return false
      return (rawSegments ?? []).some((segment) => {
        const upper = segment.toUpperCase()
        return upper === prefix || upper.startsWith(`${prefix}+`) || upper.startsWith(`${prefix}:`)
      })
    }

    const tag = candidate.split('/')[0]
    return Boolean(tag && hasSegmentTag(rawSegments, tag))
  })
}

function firstValueForPath(rawSegments: readonly string[] | null | undefined, path: string | null | undefined): string | null {
  const candidate = segmentPathAlternatives(path)[0]
  if (!candidate) return null

  if (candidate.startsWith('CCI++')) {
    const qualifier = candidate.match(/^CCI\+\+([A-Z0-9]+)/)?.[1]
    return qualifier ? valueAfterCci(rawSegments, qualifier) : null
  }

  const prefix = candidate.includes('/') ? candidate.split('/')[0] : candidate
  const segment = first(rawSegments, prefix.includes('+') ? prefix : `${prefix}+`)
  if (!segment) return null
  return components(element(segment, 1))[0]?.toUpperCase() ?? null
}

function fieldValuesForRule(rule: RulebookFieldRule, input: FieldMatrixEvaluationInput): string[] {
  const rawSegments = input.rawSegments ?? []
  const value = (() => {
    switch (rule.fieldKey) {
      case 'application_reference':
        return input.applicationReference ?? null
      case 'message_code':
        return bgmCode(rawSegments)
      case 'association_assigned_code':
        return components(element(first(rawSegments, 'UNH+'), 2))[4] ?? null
      case 'document_identifier':
        return element(first(rawSegments, 'BGM+'), 2)
      case 'message_function':
        return element(first(rawSegments, 'BGM+'), 3)
      case 'request_acknowledgement':
        return element(first(rawSegments, 'BGM+'), 4)
      case 'phase_domain':
        return components(element(first(rawSegments, 'MKS+'), 2))[0] ?? null
      case 'reason_for_transaction':
        return valueAfterCci(rawSegments, 'Z13')
      case 'reporting_frequency':
        return valueAfterCci(rawSegments, 'Z12')
      case 'energy_product':
        return valueAfterCci(rawSegments, 'Z14')
      case 'installation_direction':
        return valueAfterCci(rawSegments, 'Z22')
      case 'permission_purpose':
        return valueAfterCci(rawSegments, 'Z24')
      case 'permission_status':
        return valueAfterCci(rawSegments, 'Z23')
      case 'permission_end_reason':
        return valueAfterCci(rawSegments, 'Z25')
      default:
        return firstValueForPath(rawSegments, rule.segmentPath)
    }
  })()

  return value ? [normalize(value)] : []
}

function dependencyApplies(rule: RulebookFieldRule, input: FieldMatrixEvaluationInput): boolean {
  if (rule.requirement !== 'dependent') return false
  const any = rule.dependency?.anySegmentPresent ?? []
  const all = rule.dependency?.allSegmentPresent ?? []
  if (any.length === 0 && all.length === 0) {
    return rule.source === 'registry' ? false : input.mode === 'send'
  }
  if (any.length > 0 && any.some((path) => pathPresence(input.rawSegments, path))) return true
  if (all.length > 0 && all.every((path) => pathPresence(input.rawSegments, path))) return true
  return false
}

const PRODAT_CODES = ['Z01', 'Z02', 'Z03', 'Z04', 'Z05', 'Z06', 'Z08', 'Z09', 'Z10', 'Z13', 'Z14', 'Z15', 'Z18'] as const
const UTILTS_CODES = ['E30', 'E31', 'E66', 'E72', 'E73', 'E74', 'S01', 'S02', 'S03', 'S04', 'S05', 'S06', 'S07', 'S08', 'ERR'] as const

const PRODAT_COMMON: RulebookFieldRule[] = [
  { family: 'PRODAT', code: '*', fieldKey: 'application_reference', label: 'Application Reference', segmentPath: 'UNB/S005/0026', requirement: 'required', errorCodeIfMissing: 'APPLICATION_REFERENCE_MISSING' },
  { family: 'PRODAT', code: '*', fieldKey: 'message_code', label: 'PRODAT-funktion', segmentPath: 'BGM/C002/1001', requirement: 'required', errorCodeIfMissing: 'BGM_MISSING' },
  { family: 'PRODAT', code: '*', fieldKey: 'sender_ediel_id', label: 'Avsändare Ediel-id', segmentPath: 'UNB/S002', requirement: 'required', errorCodeIfMissing: 'SENDER_MISSING' },
  { family: 'PRODAT', code: '*', fieldKey: 'receiver_ediel_id', label: 'Mottagare Ediel-id', segmentPath: 'UNB/S003', requirement: 'required', errorCodeIfMissing: 'RECEIVER_MISSING' },
  { family: 'PRODAT', code: '*', fieldKey: 'document_date', label: 'Dokumentdatum', segmentPath: 'DTM+137', requirement: 'required', errorCodeIfMissing: 'DOCUMENT_DATE_MISSING' },
  { family: 'PRODAT', code: '*', fieldKey: 'timezone', label: 'Tidszon', segmentPath: 'DTM+ZZZ', requirement: 'required', errorCodeIfMissing: 'TIMEZONE_MISSING' },
  { family: 'PRODAT', code: '*', fieldKey: 'party_fr', label: 'Avsändande part', segmentPath: 'NAD+FR', requirement: 'required', errorCodeIfMissing: 'NAD_FR_MISSING' },
  { family: 'PRODAT', code: '*', fieldKey: 'party_do', label: 'Mottagande part', segmentPath: 'NAD+DO', requirement: 'required', errorCodeIfMissing: 'NAD_DO_MISSING' },
  { family: 'PRODAT', code: '*', fieldKey: 'line_item', label: 'Transaktionsrad/anläggning', segmentPath: 'LIN', requirement: 'required', errorCodeIfMissing: 'LIN_MISSING' },
  { family: 'PRODAT', code: '*', fieldKey: 'line_reference', label: 'Ärende-/transaktionsreferens', segmentPath: 'RFF+LI', requirement: 'required', errorCodeIfMissing: 'RFF_LI_MISSING' },
]

const PRODAT_CODE_SPECIFIC: RulebookFieldRule[] = [
  { family: 'PRODAT', code: 'Z01', fieldKey: 'reason_for_transaction', label: 'Transaktionstyp', segmentPath: 'CCI++Z13/CAV', requirement: 'required', errorCodeIfMissing: 'PRODAT_REASON_MISSING' },
  { family: 'PRODAT', code: 'Z02', fieldKey: 'reason_for_transaction', label: 'Transaktionstyp', segmentPath: 'CCI++Z13/CAV', requirement: 'required', errorCodeIfMissing: 'PRODAT_REASON_MISSING' },
  { family: 'PRODAT', code: 'Z03', fieldKey: 'reason_for_transaction', label: 'Transaktionstyp', segmentPath: 'CCI++Z13/CAV', requirement: 'required', errorCodeIfMissing: 'PRODAT_REASON_MISSING' },
  { family: 'PRODAT', code: 'Z04', fieldKey: 'reason_for_transaction', label: 'Transaktionstyp', segmentPath: 'CCI++Z13/CAV', requirement: 'required', errorCodeIfMissing: 'PRODAT_REASON_MISSING' },
  { family: 'PRODAT', code: 'Z05', fieldKey: 'reason_for_transaction', label: 'Transaktionstyp', segmentPath: 'CCI++Z13/CAV', requirement: 'required', errorCodeIfMissing: 'PRODAT_REASON_MISSING' },
  { family: 'PRODAT', code: 'Z06', fieldKey: 'reason_for_transaction', label: 'Transaktionstyp', segmentPath: 'CCI++Z13/CAV', requirement: 'required', errorCodeIfMissing: 'PRODAT_REASON_MISSING' },
  { family: 'PRODAT', code: 'Z09', fieldKey: 'reason_for_transaction', label: 'Transaktionstyp', segmentPath: 'CCI++Z13/CAV', requirement: 'required', errorCodeIfMissing: 'PRODAT_REASON_MISSING' },
  { family: 'PRODAT', code: 'Z10', fieldKey: 'reason_for_transaction', label: 'Transaktionstyp', segmentPath: 'CCI++Z13/CAV', requirement: 'required', errorCodeIfMissing: 'PRODAT_REASON_MISSING' },
  { family: 'PRODAT', code: 'Z13', fieldKey: 'agreement_reference', label: 'Referens till avtal/fullmakt', segmentPath: 'RFF+ANJ', requirement: 'required', errorCodeIfMissing: 'AGREEMENT_REFERENCE_MISSING' },
  { family: 'PRODAT', code: 'Z13', fieldKey: 'reason_for_transaction', label: 'Tillståndsbegäran/transaktionstyp', segmentPath: 'CCI++Z13/CAV', requirement: 'required', errorCodeIfMissing: 'PRODAT_PERMISSION_REASON_MISSING' },
  { family: 'PRODAT', code: 'Z13', fieldKey: 'reporting_frequency', label: 'Rapporteringsfrekvens', segmentPath: 'CCI++Z12/CAV', requirement: 'required', errorCodeIfMissing: 'REPORTING_FREQUENCY_MISSING' },
  { family: 'PRODAT', code: 'Z13', fieldKey: 'energy_product', label: 'Energiprodukt', segmentPath: 'CCI++Z14/CAV', requirement: 'required', errorCodeIfMissing: 'ENERGY_PRODUCT_MISSING' },
  { family: 'PRODAT', code: 'Z13', fieldKey: 'installation_direction', label: 'Riktning/typ av anläggning', segmentPath: 'CCI++Z22/CAV', requirement: 'required', errorCodeIfMissing: 'INSTALLATION_DIRECTION_MISSING' },
  { family: 'PRODAT', code: 'Z13', fieldKey: 'permission_purpose', label: 'Tillståndets syfte', segmentPath: 'CCI++Z24/CAV', requirement: 'required', errorCodeIfMissing: 'PERMISSION_PURPOSE_MISSING' },
  { family: 'PRODAT', code: 'Z14', fieldKey: 'permission_status', label: 'Tillståndets status', segmentPath: 'CCI++Z23/CAV', requirement: 'required', errorCodeIfMissing: 'PERMISSION_STATUS_MISSING' },
  { family: 'PRODAT', code: 'Z15', fieldKey: 'permission_status', label: 'Tillståndets status', segmentPath: 'CCI++Z23/CAV', requirement: 'required', errorCodeIfMissing: 'PERMISSION_STATUS_MISSING' },
  { family: 'PRODAT', code: 'Z15', fieldKey: 'permission_end_reason', label: 'Orsak till tillståndets upphörande', segmentPath: 'CCI++Z25/CAV', requirement: 'required', errorCodeIfMissing: 'PERMISSION_END_REASON_MISSING' },
  { family: 'PRODAT', code: 'Z18', fieldKey: 'permission_end_reason', label: 'Orsak till rapporteringens avslut', segmentPath: 'CCI++Z25/CAV', requirement: 'dependent', condition: 'Krävs när avslutsorsak finns i affärsflödet', errorCodeIfMissing: 'PERMISSION_END_REASON_MISSING', severity: 'warning' },
]

const UTILTS_COMMON: RulebookFieldRule[] = [
  { family: 'UTILTS', code: '*', fieldNumber: '311', scope: 'header', fieldKey: 'application_reference', label: 'Application Reference', segmentPath: 'UNB/0026', requirement: 'required', errorCodeIfMissing: 'APPLICATION_REFERENCE_MISSING' },
  { family: 'UTILTS', code: '*', fieldNumber: '312', scope: 'header', fieldKey: 'association_assigned_code', label: 'Association assigned code', segmentPath: 'UNH/S009/0057', requirement: 'required', allowedValues: ['E5SE5A'], errorCodeIfMissing: 'UTILTS_ASSOCIATION_MISSING', errorCodeIfInvalid: 'UTILTS_ASSOCIATION_INVALID' },
  { family: 'UTILTS', code: '*', fieldNumber: '202', scope: 'header', fieldKey: 'message_code', label: 'Document name code', segmentPath: 'BGM/C002/1001', requirement: 'required', allowedValues: [...UTILTS_CODES], errorCodeIfMissing: 'BGM_MISSING', errorCodeIfInvalid: 'UTILTS_CODE_NOT_ALLOWED' },
  { family: 'UTILTS', code: '*', fieldNumber: '203', scope: 'header', fieldKey: 'document_identifier', label: 'Document identifier', segmentPath: 'BGM/C106/1004', requirement: 'required', errorCodeIfMissing: 'UTILTS_DOCUMENT_IDENTIFIER_MISSING' },
  { family: 'UTILTS', code: '*', fieldNumber: '204', scope: 'header', fieldKey: 'message_function', label: 'Message function', segmentPath: 'BGM/1225', requirement: 'required', allowedValues: ['5', '9'], errorCodeIfMissing: 'UTILTS_MESSAGE_FUNCTION_MISSING', errorCodeIfInvalid: 'UTILTS_MESSAGE_FUNCTION_INVALID' },
  { family: 'UTILTS', code: '*', fieldNumber: '313', scope: 'header', fieldKey: 'request_acknowledgement', label: 'Request for acknowledgement', segmentPath: 'BGM/4343', requirement: 'required', allowedValues: ['AB', 'NA'], errorCodeIfMissing: 'UTILTS_ACK_REQUEST_MISSING', errorCodeIfInvalid: 'UTILTS_ACK_REQUEST_INVALID' },
  { family: 'UTILTS', code: '*', fieldNumber: '205', scope: 'header', fieldKey: 'document_date', label: 'Message date', segmentPath: 'DTM+137', requirement: 'required', errorCodeIfMissing: 'DOCUMENT_DATE_MISSING' },
  { family: 'UTILTS', code: '*', fieldNumber: '206', scope: 'header', fieldKey: 'timezone', label: 'Time zone', segmentPath: 'DTM+735', requirement: 'required', errorCodeIfMissing: 'TIMEZONE_MISSING' },
  { family: 'UTILTS', code: '*', fieldNumber: '501', scope: 'header', fieldKey: 'market', label: 'Market/Sector Area', segmentPath: 'MKS/7293', requirement: 'required', allowedValues: ['23', '27'], errorCodeIfMissing: 'MKS_MISSING', errorCodeIfInvalid: 'UTILTS_MARKET_INVALID' },
  { family: 'UTILTS', code: '*', fieldNumber: '502', scope: 'header', fieldKey: 'phase_domain', label: 'Phase/Domain', segmentPath: 'MKS/C332/3496', requirement: 'required', allowedValues: ['E02', 'E03', 'E04', 'E05'], errorCodeIfMissing: 'UTILTS_PHASE_MISSING', errorCodeIfInvalid: 'UTILTS_PHASE_INVALID' },
  { family: 'UTILTS', code: '*', fieldNumber: '207', scope: 'header', fieldKey: 'sender_party', label: 'Sender', segmentPath: 'NAD+MS/C082/3039', requirement: 'required', errorCodeIfMissing: 'NAD_MS_MISSING' },
  { family: 'UTILTS', code: '*', fieldNumber: '208', scope: 'header', fieldKey: 'receiver_party', label: 'Recipient', segmentPath: 'NAD+MR/C082/3039', requirement: 'required', errorCodeIfMissing: 'NAD_MR_MISSING' },
  { family: 'UTILTS', code: '*', fieldNumber: '509', scope: 'header', fieldKey: 'ancillary_role', label: 'Ancillary Role', segmentPath: 'NAD+DDQ|NAD+DGI|NAD+PQ', requirement: 'required', errorCodeIfMissing: 'UTILTS_ANCILLARY_ROLE_MISSING' },
]

type PlanningFieldDefinition = {
  fieldNumber: string
  fieldKey: string
  label: string
  segmentPath: string
}

const UTILTS_PLANNING_FIELDS: PlanningFieldDefinition[] = [
  { fieldNumber: '505', fieldKey: 'transaction_identity', label: 'Transaction id', segmentPath: 'IDE+24' },
  { fieldNumber: '209', fieldKey: 'metering_point', label: 'Metering point', segmentPath: 'LOC+172' },
  { fieldNumber: '260a', fieldKey: 'net_area', label: 'Metering grid area', segmentPath: 'LOC+239' },
  { fieldNumber: '262', fieldKey: 'balance_responsible', label: 'Balance responsible', segmentPath: 'NAD+DDK' },
  { fieldNumber: '510', fieldKey: 'balance_supplier', label: 'Balance supplier', segmentPath: 'NAD+DDQ' },
  { fieldNumber: '506', fieldKey: 'product_id', label: 'Product id', segmentPath: 'LIN/C212/7140' },
  { fieldNumber: '511', fieldKey: 'time_series_product', label: 'Time-series product', segmentPath: 'PIA+1' },
  { fieldNumber: '245', fieldKey: 'delivery_period', label: 'Delivery period', segmentPath: 'DTM+324' },
  { fieldNumber: '532', fieldKey: 'latest_update_date', label: 'Latest update date', segmentPath: 'DTM+368' },
  { fieldNumber: '508', fieldKey: 'resolution', label: 'Resolution', segmentPath: 'DTM+354' },
  { fieldNumber: '223', fieldKey: 'reason_for_transaction', label: 'Reason for transaction', segmentPath: 'STS+7' },
  { fieldNumber: '264', fieldKey: 'unit', label: 'Unit', segmentPath: 'MEA+AAZ' },
  { fieldNumber: '226', fieldKey: 'prodat_transaction_reference', label: 'PRODAT transaction reference', segmentPath: 'RFF+LI' },
  { fieldNumber: '254', fieldKey: 'settlement_method', label: 'Settlement method', segmentPath: 'CCI++E02/CAV' },
  { fieldNumber: '513', fieldKey: 'metering_point_type', label: 'Metering point type', segmentPath: 'CCI++E12/CAV' },
  { fieldNumber: '507a', fieldKey: 'default_metering_point_count', label: 'Default metering point count', segmentPath: 'CCI++Z01/CAV' },
  { fieldNumber: '514', fieldKey: 'observation_id', label: 'Observation id', segmentPath: 'SEQ/C286/1050' },
  { fieldNumber: '515', fieldKey: 'planned_periodic_quantity', label: 'Planned periodic quantity', segmentPath: 'QTY+135' },
  { fieldNumber: '520', fieldKey: 'quantity_quality', label: 'Quantity quality', segmentPath: 'STS+8' },
  { fieldNumber: '507b', fieldKey: 'diverging_metering_point_count', label: 'Diverging metering point count', segmentPath: 'CCI++Z01/CAV' },
]

const UTILTS_PLANNING_REQUIREMENTS = {
  S02: ['R', 'R', 'R', 'X', 'X', 'R', 'X', 'R', 'R', 'R', 'R', 'R', 'O', 'X', 'X', 'X', 'R', 'R', 'D', 'X'],
  S03: ['R', 'X', 'R', 'D', 'D', 'R', 'R', 'R', 'R', 'R', 'R', 'R', 'X', 'R', 'R', 'D', 'R', 'R', 'X', 'D'],
  S04: ['R', 'X', 'R', 'D', 'X', 'R', 'R', 'R', 'R', 'R', 'R', 'R', 'X', 'X', 'X', 'X', 'R', 'R', 'X', 'X'],
} as const

function planningRequirement(value: 'R' | 'D' | 'O' | 'X'): EdielRulebookRequirement {
  if (value === 'R') return 'required'
  if (value === 'D') return 'dependent'
  if (value === 'X') return 'forbidden'
  return 'optional'
}

const UTILTS_PLANNING_RULES: RulebookFieldRule[] = Object.entries(UTILTS_PLANNING_REQUIREMENTS).flatMap(([code, requirements]) =>
  UTILTS_PLANNING_FIELDS.map((field, index) => ({
    family: 'UTILTS',
    code,
    fieldNumber: field.fieldNumber,
    scope: 'transaction' as const,
    fieldKey: field.fieldKey,
    label: field.label,
    segmentPath: field.segmentPath,
    requirement: planningRequirement(requirements[index]!),
    condition: requirements[index] === 'D' ? '25-A-3 product-, actor- och transaktionsberoende regel' : null,
    errorCodeIfMissing: `UTILTS_FIELD_${field.fieldNumber.toUpperCase()}_MISSING`,
    errorCodeIfInvalid: requirements[index] === 'X' ? `UTILTS_FIELD_${field.fieldNumber.toUpperCase()}_FORBIDDEN` : null,
  })),
)

const UTILTS_CODE_SPECIFIC: RulebookFieldRule[] = [
  { family: 'UTILTS', code: 'E66', fieldKey: 'transaction_identity', label: 'Transaktionsidentitet', segmentPath: 'IDE+24', requirement: 'required', errorCodeIfMissing: 'IDE_24_MISSING' },
  { family: 'UTILTS', code: 'E66', fieldKey: 'metering_point', label: 'Mätpunkt', segmentPath: 'LOC+172', requirement: 'required', errorCodeIfMissing: 'LOC_172_MISSING' },
  { family: 'UTILTS', code: 'E66', fieldKey: 'net_area', label: 'Nätområde', segmentPath: 'LOC+239', requirement: 'required', errorCodeIfMissing: 'LOC_239_MISSING' },
  { family: 'UTILTS', code: 'E66', fieldKey: 'delivery_period', label: 'Leveransperiod', segmentPath: 'DTM+324', requirement: 'required', errorCodeIfMissing: 'DTM_324_MISSING' },
  { family: 'UTILTS', code: 'E66', fieldKey: 'registration_time', label: 'Registreringstidpunkt', segmentPath: 'DTM+597', requirement: 'dependent', condition: 'Krävs för E66-profiler där registreringstidpunkt ingår, särskilt kvart/tim.', errorCodeIfMissing: 'UTILTS_DTM_597_MISSING' },
  { family: 'UTILTS', code: 'E66', fieldKey: 'resolution', label: 'Tidsupplösning', segmentPath: 'DTM+354', requirement: 'required', errorCodeIfMissing: 'DTM_354_MISSING' },
  { family: 'UTILTS', code: 'E66', fieldKey: 'quantity', label: 'Mätvärde/energi', segmentPath: 'QTY', requirement: 'required', errorCodeIfMissing: 'QTY_MISSING' },
  { family: 'UTILTS', code: 'E31', fieldKey: 'transaction_identity', label: 'Transaktionsidentitet', segmentPath: 'IDE+24', requirement: 'required', errorCodeIfMissing: 'IDE_24_MISSING' },
  { family: 'UTILTS', code: 'E31', fieldKey: 'net_area', label: 'Nätområde', segmentPath: 'LOC+239', requirement: 'required', errorCodeIfMissing: 'LOC_239_MISSING' },
  { family: 'UTILTS', code: 'E31', fieldKey: 'quantity', label: 'Andelstal/aggregerat värde', segmentPath: 'QTY', requirement: 'required', errorCodeIfMissing: 'QTY_MISSING' },
  { family: 'UTILTS', code: 'S02', fieldKey: 'transaction_identity', label: 'Transaktionsidentitet', segmentPath: 'IDE+24', requirement: 'required', errorCodeIfMissing: 'IDE_24_MISSING' },
  { family: 'UTILTS', code: 'S03', fieldKey: 'transaction_identity', label: 'Transaktionsidentitet', segmentPath: 'IDE+24', requirement: 'required', errorCodeIfMissing: 'IDE_24_MISSING' },
  { family: 'UTILTS', code: 'S01', fieldKey: 'quantity', label: 'Avräkningsvärde', segmentPath: 'QTY', requirement: 'required', errorCodeIfMissing: 'QTY_MISSING' },
  { family: 'UTILTS', code: 'S04', fieldKey: 'quantity', label: 'Plan-/andelstal', segmentPath: 'QTY', requirement: 'required', errorCodeIfMissing: 'QTY_MISSING' },
]

const ACK_RULES: RulebookFieldRule[] = [
  { family: 'APERAK', code: 'APERAK', fieldKey: 'application_status', label: 'Applikationsstatus', segmentPath: 'ERC', requirement: 'required', errorCodeIfMissing: 'ERC_MISSING' },
  { family: 'APERAK', code: 'APERAK', fieldKey: 'application_text', label: 'Applikationstext', segmentPath: 'FTX', requirement: 'required', errorCodeIfMissing: 'FTX_MISSING' },
  { family: 'CONTRL', code: 'CONTRL', fieldKey: 'syntax_status', label: 'Syntaxstatus', segmentPath: 'UCI', requirement: 'required', errorCodeIfMissing: 'UCI_MISSING' },
  { family: 'UTILTS_ERR', code: 'UTILTS_ERR', fieldKey: 'error_message', label: 'UTILTS_ERR BGM', segmentPath: 'BGM+ERR', requirement: 'required', errorCodeIfMissing: 'UTILTS_ERR_BGM_MISSING' },
  { family: 'UTILTS_ERR', code: 'UTILTS_ERR', fieldKey: 'functional_status', label: 'Funktionsfel', segmentPath: 'STS+E01', requirement: 'required', errorCodeIfMissing: 'STS_E01_MISSING' },
  { family: 'UTILTS_ERR', code: 'UTILTS_ERR', fieldKey: 'source_reference', label: 'Referens till källmeddelande/transaktion', segmentPath: 'RFF', requirement: 'required', errorCodeIfMissing: 'RFF_MISSING' },
]

export const STATIC_FIELD_RULES: RulebookFieldRule[] = [
  ...PRODAT_COMMON,
  ...PRODAT_CODE_SPECIFIC,
  ...UTILTS_COMMON,
  ...UTILTS_PLANNING_RULES,
  ...UTILTS_CODE_SPECIFIC,
  ...ACK_RULES,
]

export function fieldRulesForMessage(family: string | null | undefined, code: string | null | undefined): RulebookFieldRule[] {
  const f = normalize(family)
  const c = normalize(code)
  return STATIC_FIELD_RULES.filter((rule) => rule.family === f && (rule.code === '*' || rule.code === c))
}

export function fieldRulePresent(rule: RulebookFieldRule, input: FieldMatrixEvaluationInput): boolean {
  const rawSegments = input.rawSegments ?? []
  const applicationReference = input.applicationReference ?? null
  switch (rule.fieldKey) {
    case 'application_reference':
      return Boolean(applicationReference)
    case 'message_code':
      return Boolean(bgmCode(rawSegments))
    case 'association_assigned_code':
      return Boolean(components(element(first(rawSegments, 'UNH+'), 2))[4])
    case 'document_identifier':
      return Boolean(element(first(rawSegments, 'BGM+'), 2))
    case 'message_function':
      return Boolean(element(first(rawSegments, 'BGM+'), 3))
    case 'request_acknowledgement':
      return Boolean(element(first(rawSegments, 'BGM+'), 4))
    case 'phase_domain':
      return Boolean(components(element(first(rawSegments, 'MKS+'), 2))[0])
    case 'sender_ediel_id':
      return Boolean(element(first(rawSegments, 'UNB+'), 2))
    case 'receiver_ediel_id':
      return Boolean(element(first(rawSegments, 'UNB+'), 3))
    case 'document_date':
      return hasPrefix(rawSegments, 'DTM+137:')
    case 'timezone':
      return hasPrefix(rawSegments, 'DTM+ZZZ:') || hasPrefix(rawSegments, 'DTM+735:')
    case 'party_fr':
      return hasAnyNad(rawSegments, 'FR')
    case 'party_do':
      return hasAnyNad(rawSegments, 'DO')
    case 'line_item':
      return hasPrefix(rawSegments, 'LIN+')
    case 'line_reference':
      return hasPrefix(rawSegments, 'RFF+LI:')
    case 'reason_for_transaction':
      return hasCciWithFollowingCav(rawSegments, 'Z13')
    case 'agreement_reference':
      return hasPrefix(rawSegments, 'RFF+ANJ:')
    case 'reporting_frequency':
      return hasCciWithFollowingCav(rawSegments, 'Z12')
    case 'energy_product':
      return hasCciWithFollowingCav(rawSegments, 'Z14')
    case 'installation_direction':
      return hasCciWithFollowingCav(rawSegments, 'Z22')
    case 'permission_purpose':
      return hasCciWithFollowingCav(rawSegments, 'Z24')
    case 'permission_status':
      return hasCciWithFollowingCav(rawSegments, 'Z23')
    case 'permission_end_reason':
      return hasCciWithFollowingCav(rawSegments, 'Z25')
    case 'market':
      return hasPrefix(rawSegments, 'MKS+')
    case 'sender_party':
      return hasAnyNad(rawSegments, 'MS')
    case 'receiver_party':
      return hasAnyNad(rawSegments, 'MR')
    case 'transaction_identity':
      return hasPrefix(rawSegments, 'IDE+24')
    case 'metering_point':
      return hasPrefix(rawSegments, 'LOC+172')
    case 'net_area':
      return hasPrefix(rawSegments, 'LOC+239')
    case 'delivery_period':
      return hasPrefix(rawSegments, 'DTM+324:')
    case 'registration_time':
      return hasPrefix(rawSegments, 'DTM+597:')
    case 'resolution':
      return hasPrefix(rawSegments, 'DTM+354:')
    case 'quantity':
      return hasPrefix(rawSegments, 'QTY+')
    case 'application_status':
      return hasPrefix(rawSegments, 'ERC+')
    case 'application_text':
      return hasPrefix(rawSegments, 'FTX+')
    case 'syntax_status':
      return hasPrefix(rawSegments, 'UCI+')
    case 'error_message':
      return bgmCode(rawSegments) === 'ERR'
    case 'functional_status':
      return hasPrefix(rawSegments, 'STS+E01')
    case 'source_reference':
      return hasPrefix(rawSegments, 'RFF+')
    default:
      return pathPresence(rawSegments, rule.segmentPath)
  }
}

export function validateFieldMatrixPayload(
  input: FieldMatrixEvaluationInput,
  fieldRules?: readonly RulebookFieldRule[] | null
): EdielRulebookIssue[] {
  const family = normalize(input.family)
  const code = normalize(input.code)
  const rawSegments = input.rawSegments ?? []
  const issues: EdielRulebookIssue[] = []
  const rules = fieldRules ?? fieldRulesForMessage(family, code)

  const familyKnown = family === 'PRODAT' || family === 'UTILTS' || family === 'APERAK' || family === 'CONTRL' || family === 'UTILTS_ERR'
  if (!familyKnown) return issues

  if (family === 'PRODAT' && code && !(PRODAT_CODES as readonly string[]).includes(code)) {
    issues.push(issue({ severity: 'error', code: 'PRODAT_CODE_NOT_ALLOWED', title: 'PRODAT-kod saknar fältmatris', description: `${code} finns inte i PRODAT 26A-matrisen.`, fieldPath: 'BGM/C002/1001' }))
  }

  if (family === 'UTILTS' && code && !(UTILTS_CODES as readonly string[]).includes(code)) {
    issues.push(issue({ severity: 'error', code: 'UTILTS_CODE_NOT_ALLOWED', title: 'UTILTS-kod saknar profil', description: `${code} finns inte i UTILTS E5SE5A-profilerna.`, fieldPath: 'BGM/C002/1001' }))
  }

  for (const rule of rules) {
    const present = fieldRulePresent(rule, { ...input, rawSegments })
    if (rule.requirement === 'forbidden' || rule.requirement === 'not_used') {
      if (!present) continue
      issues.push(issue({
        severity: 'error',
        code: rule.errorCodeIfInvalid ?? 'FIELD_MATRIX_FORBIDDEN_FIELD_PRESENT',
        title: `${rule.label} får inte skickas`,
        description: `${rule.segmentPath ?? rule.fieldKey} är markerat som - för ${family} ${code} och blockeras.`,
        fieldPath: rule.segmentPath,
      }))
      continue
    }

    const requiredByDependency = dependencyApplies(rule, { ...input, rawSegments })
    const shouldEvaluate = rule.requirement === 'required' || requiredByDependency
    if (!shouldEvaluate) continue
    if (!present) {
      const severity = rule.severity ?? (requiredByDependency ? 'error' : rule.requirement === 'dependent' ? 'warning' : 'error')
      issues.push(issue({
        severity,
        code: rule.errorCodeIfMissing ?? 'FIELD_MATRIX_REQUIRED_FIELD_MISSING',
        title: `${rule.label} saknas`,
        description: `${rule.segmentPath ?? rule.fieldKey} krävs för ${family} ${code}${rule.condition ? ` (${rule.condition})` : ''}.`,
        fieldPath: rule.segmentPath,
      }))
      continue
    }

    const allowedValues = (rule.allowedValues ?? []).map(normalize).filter(Boolean)
    if (allowedValues.length === 0) continue
    const actualValues = fieldValuesForRule(rule, { ...input, rawSegments })
    if (actualValues.length === 0 || actualValues.some((value) => !allowedValues.includes(value))) {
      issues.push(issue({
        severity: rule.severity ?? 'error',
        code: rule.errorCodeIfInvalid ?? 'FIELD_MATRIX_CODE_LIST_INVALID',
        title: `${rule.label} har otillåtet värde`,
        description: `${rule.segmentPath ?? rule.fieldKey} måste vara ett av ${allowedValues.join(', ')}.`,
        fieldPath: rule.segmentPath,
      }))
    }
  }

  if (family === 'PRODAT') {
    const bgm = bgmCode(rawSegments)
    if (bgm && /^Z\d{2}[A-Z]+$/.test(bgm)) {
      issues.push(issue({ severity: 'error', code: 'PRODAT_COMPOSITE_BGM_CODE', title: 'Fel PRODAT BGM', description: 'BGM ska vara huvudfunktion, t.ex. Z13. Undertyp/status ska ligga i CCI/CAV.', fieldPath: 'BGM/C002/1001' }))
    }
    if (input.expectedApplicationReference && input.applicationReference && normalize(input.expectedApplicationReference) !== normalize(input.applicationReference)) {
      issues.push(issue({ severity: 'error', code: 'APPLICATION_REFERENCE_MISMATCH', title: 'Fel Application Reference', description: `${code} ska använda ${input.expectedApplicationReference}, men payload har ${input.applicationReference}.`, fieldPath: 'UNB/S005/0026' }))
    }
  }

  if (family === 'APERAK') {
    const ercs = ercCodes(rawSegments)
    if (ercs.includes('100') && !ftxHasOk(rawSegments)) {
      issues.push(issue({ severity: 'error', code: 'APERAK_POSITIVE_OK_MISSING', title: 'Positiv APERAK saknar OK', description: 'APERAK med ERC+100 ska ha FTX-text OK.', fieldPath: 'FTX' }))
    }
    if (ercs.some((erc) => erc !== '100') && !hasPrefix(rawSegments, 'FTX+')) {
      issues.push(issue({ severity: 'error', code: 'APERAK_NEGATIVE_FTX_MISSING', title: 'Negativ APERAK saknar FTX', description: 'Varje negativ APERAK måste innehålla kort mottagarvänlig feltext.', fieldPath: 'ERC/FTX' }))
    }
  }

  if (family === 'CONTRL' && hasPrefix(rawSegments, 'BGM+')) {
    issues.push(issue({ severity: 'error', code: 'CONTRL_MUST_NOT_HAVE_BGM', title: 'CONTRL innehåller BGM', description: 'CONTRL är syntaxkvittens och ska inte innehålla BGM.', fieldPath: 'BGM' }))
  }

  if (family === 'UTILTS_ERR' && bgmCode(rawSegments) !== 'ERR') {
    issues.push(issue({ severity: 'error', code: 'UTILTS_ERR_BGM_NOT_ERR', title: 'UTILTS_ERR ska ha BGM+ERR', description: 'Funktionsfel i UTILTS ska byggas som UTILTS med BGM+ERR.', fieldPath: 'BGM' }))
  }

  const tagList = tags(rawSegments)
  if (input.mode === 'send' && tagList.includes('UNB') && tagList.includes('UNH')) {
    const unbIndex = tagList.indexOf('UNB')
    const unhIndex = tagList.indexOf('UNH')
    if (unhIndex < unbIndex) {
      issues.push(issue({ severity: 'error', code: 'SEGMENT_ORDER_UNH_BEFORE_UNB', title: 'Fel segmentordning', description: 'UNB ska komma före UNH.', fieldPath: 'UNB/UNH' }))
    }
  }

  return issues
}
