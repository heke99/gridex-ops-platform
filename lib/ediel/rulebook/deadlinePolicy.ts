export type CanonicalEdielDeadlineUnit =
  | 'minutes'
  | 'calendar_days'
  | 'calendar_months'
  | 'business_days'
  | 'years'

export type CanonicalEdielDeadlineConstraintKind =
  | 'not_before'
  | 'not_after'
  | 'within_after'
  | 'same_day'
  | 'as_soon_as_known'
  | 'as_soon_as_possible'
  | 'in_connection_with'

export type CanonicalEdielDeadlineConstraint = {
  kind: CanonicalEdielDeadlineConstraintKind
  anchor: string
  offset?: number
  unit?: CanonicalEdielDeadlineUnit
  condition?: string | null
  hard: boolean
  note?: string | null
}

export type CanonicalEdielDeadlineRule = {
  family: 'PRODAT' | 'UTILTS' | 'CONTRL' | 'APERAK' | 'UTILTS_ERR'
  code: string
  subtype: string | null
  direction: 'inbound' | 'outbound' | 'both'
  constraints: readonly CanonicalEdielDeadlineConstraint[]
  summary: string
  source: {
    document: 'Svensk Elmarknadshandbok'
    edition: '26A'
    effectiveFrom: '2026-04-01'
    section: string
    pages: string
  }
}

const source = (section: string, pages: string): CanonicalEdielDeadlineRule['source'] => ({
  document: 'Svensk Elmarknadshandbok',
  edition: '26A',
  effectiveFrom: '2026-04-01',
  section,
  pages,
})

const c = (
  kind: CanonicalEdielDeadlineConstraintKind,
  anchor: string,
  offset?: number,
  unit?: CanonicalEdielDeadlineUnit,
  condition?: string | null,
  note?: string | null,
): CanonicalEdielDeadlineConstraint => ({
  kind,
  anchor,
  ...(offset === undefined ? {} : { offset }),
  ...(unit === undefined ? {} : { unit }),
  condition: condition ?? null,
  hard: true,
  note: note ?? null,
})

/**
 * Sole source-controlled timing catalogue for Swedish Ediel business messages.
 *
 * The catalogue models the deadlines in Elmarknadshandbok 26A chapter 10.2.1
 * and the Z13/Z14 data-access limits in chapter 11.3. Runtime code must consume
 * these rules through canonicalEdielFacade. Database deadline/process-policy
 * rows are historical evidence/projections only and may never redefine them.
 */
export const CANONICAL_EDIEL_DEADLINE_RULES: readonly CanonicalEdielDeadlineRule[] = [
  { family: 'PRODAT', code: 'Z02', subtype: 'L', direction: 'inbound', constraints: [c('within_after', 'received_PRODAT_Z01_L', 30, 'minutes')], summary: 'Z02L ska skickas inom 30 minuter efter mottagen Z01L.', source: source('10.2.1', '197') },
  { family: 'PRODAT', code: 'Z02', subtype: 'LK', direction: 'inbound', constraints: [c('within_after', 'received_PRODAT_Z01_LK', 30, 'minutes')], summary: 'Z02LK ska skickas inom 30 minuter efter mottagen Z01LK.', source: source('10.2.1', '197') },

  { family: 'PRODAT', code: 'Z03', subtype: 'L', direction: 'outbound', constraints: [
    c('not_before', 'delivery_start', -14, 'calendar_months'),
    c('not_after', 'delivery_start', -14, 'calendar_days'),
  ], summary: 'Z03L får skickas tidigast 14 månader och senast 14 kalenderdagar före leveransstart.', source: source('10.2.1', '197') },
  { family: 'PRODAT', code: 'Z03', subtype: 'LK', direction: 'outbound', constraints: [
    c('not_before', 'delivery_start', -14, 'calendar_months'),
    c('not_after', 'move_in_date', 0, 'calendar_days'),
  ], summary: 'Z03LK får skickas tidigast 14 månader före leveransstart och senast på inflyttningsdagen.', source: source('10.2.1', '197') },
  { family: 'PRODAT', code: 'Z03', subtype: 'C', direction: 'outbound', constraints: [
    c('not_after', 'delivery_start', -4, 'calendar_days', 'cancels_Z03_L'),
    c('not_after', 'move_in_date', 0, 'calendar_days', 'cancels_Z03_LK'),
  ], summary: 'Z03C ska vid återtagande av Z03L skickas senast fyra dagar före leveransstart; för Z03LK senast inflyttningsdagen.', source: source('10.2.1', '197') },

  { family: 'PRODAT', code: 'Z04', subtype: 'A', direction: 'inbound', constraints: [
    c('not_before', 'move_in_date', 1, 'calendar_days'),
    c('not_after', 'move_in_date', 3, 'calendar_days'),
  ], summary: 'Z04A skickas dag 1–3 efter inflyttning.', source: source('10.2.1', '197') },
  { family: 'PRODAT', code: 'Z04', subtype: 'D', direction: 'inbound', constraints: [
    c('not_before', 'production_receipt_obligation_effective', -3, 'calendar_days'),
    c('not_after', 'production_receipt_obligation_effective', 3, 'calendar_days'),
  ], summary: 'Z04D skickas från tre dagar före till tre dagar efter att mottagningsplikten träder i kraft.', source: source('10.2.1', '197') },
  { family: 'PRODAT', code: 'Z04', subtype: 'L', direction: 'inbound', constraints: [c('within_after', 'received_PRODAT_Z03_L', 3, 'calendar_days')], summary: 'Z04L ska skickas senast tre dagar efter mottagen Z03L.', source: source('10.2.1', '197') },
  { family: 'PRODAT', code: 'Z04', subtype: 'LK', direction: 'inbound', constraints: [c('within_after', 'received_PRODAT_Z03_LK', 3, 'calendar_days'), c('as_soon_as_possible', 'approved_monitored_Z03_LK', undefined, undefined, 'alternative_monitored_process')], summary: 'Z04LK ska normalt skickas senast tre dagar efter Z03LK; övervakad alternativprocess hanteras snarast efter godkännande.', source: source('10.2.1', '197') },
  { family: 'PRODAT', code: 'Z04', subtype: 'C', direction: 'inbound', constraints: [c('within_after', 'received_PRODAT_Z03_C', 3, 'calendar_days'), c('as_soon_as_possible', 'changed_or_incorrect_move_in_information', undefined, undefined, 'alternative_move_in_correction')], summary: 'Z04C ska normalt skickas senast tre dagar efter Z03C; korrigeringsfall hanteras snarast.', source: source('10.2.1', '197') },

  { family: 'PRODAT', code: 'Z05', subtype: 'L', direction: 'inbound', constraints: [
    c('within_after', 'received_PRODAT_Z03_L', 3, 'calendar_days', 'supplier_switch'),
    c('same_day', 'sent_PRODAT_Z04_A', 0, 'calendar_days', 'assigned_supply'),
    c('within_after', 'received_PRODAT_Z08_H', 3, 'calendar_days', 'rescission'),
  ], summary: 'Z05L följer Z03L inom tre dagar, skickas samtidigt med Z04A i anvisningsfall eller inom tre dagar efter Z08H.', source: source('10.2.1', '198') },
  { family: 'PRODAT', code: 'Z05', subtype: 'LK', direction: 'inbound', constraints: [c('as_soon_as_known', 'customer_change_information')], summary: 'Z05LK skickas så snart informationen är känd.', source: source('10.2.1', '198') },
  { family: 'PRODAT', code: 'Z05', subtype: 'C', direction: 'inbound', constraints: [c('as_soon_as_possible', 'cancellation_information'), c('not_after', 'original_supply_end', 0, 'calendar_days', null, 'Bör skickas före ursprungligt slutdatum.')], summary: 'Z05C skickas snarast och bör nå mottagaren före ursprungligt slutdatum.', source: source('10.2.1', '198') },

  { family: 'PRODAT', code: 'Z06', subtype: 'E', direction: 'inbound', constraints: [c('as_soon_as_known', 'customer_masterdata_change')], summary: 'Z06E skickas så snart uppgiften är känd.', source: source('10.2.1', '198') },
  { family: 'PRODAT', code: 'Z06', subtype: 'F', direction: 'inbound', constraints: [
    c('within_after', 'metering_change', 10, 'calendar_days', 'normal_change'),
    c('same_day', 'registration', 0, 'calendar_days', 'connection_or_disconnection'),
    c('within_after', 'validity_date_from_Z09_F_or_G', 40, 'calendar_days', 'metering_method_change'),
  ], summary: 'Z06F skickas normalt inom tio dagar; särskilda anslutnings- och mätmetodsfall har egna tidsgränser.', source: source('10.2.1', '198') },
  { family: 'PRODAT', code: 'Z06', subtype: 'G', direction: 'inbound', constraints: [c('within_after', 'metering_point_masterdata_change', 10, 'calendar_days')], summary: 'Z06G skickas senast tio dagar efter förändringen.', source: source('10.2.1', '198') },

  { family: 'PRODAT', code: 'Z08', subtype: 'H', direction: 'outbound', constraints: [c('not_after', 'rescission_effective_date', 0, 'calendar_days')], summary: 'Z08H ska skickas senast den dag hävningen träder i kraft.', source: source('10.2.1', '198') },

  { family: 'PRODAT', code: 'Z09', subtype: 'B', direction: 'outbound', constraints: [c('not_after', 'balance_responsible_change', -1, 'calendar_months')], summary: 'Z09B ska skickas senast en månad före byte av balansansvarig.', source: source('10.2.1', '198') },
  { family: 'PRODAT', code: 'Z09', subtype: 'D', direction: 'outbound', constraints: [c('not_after', 'production_purchase_contract_start_or_end', 0, 'calendar_days')], summary: 'Z09D skickas senast avtalsstart-/slutdagen.', source: source('10.2.1', '198') },
  { family: 'PRODAT', code: 'Z09', subtype: 'E', direction: 'outbound', constraints: [c('as_soon_as_known', 'customer_masterdata_change')], summary: 'Z09E skickas så snart uppgiften är känd.', source: source('10.2.1', '198') },
  { family: 'PRODAT', code: 'Z09', subtype: 'F', direction: 'outbound', constraints: [c('in_connection_with', 'contract_start_or_end'), c('not_after', 'contract_start_or_end', 0, 'calendar_days')], summary: 'Z09F skickas i samband med och senast på avtalsstart-/slutdagen.', source: source('10.2.1', '198') },
  { family: 'PRODAT', code: 'Z09', subtype: 'G', direction: 'outbound', constraints: [c('in_connection_with', 'contract_start_or_end'), c('not_after', 'contract_start_or_end', 0, 'calendar_days')], summary: 'Z09G skickas i samband med och senast på avtalsstart-/slutdagen.', source: source('10.2.1', '198') },

  { family: 'PRODAT', code: 'Z10', subtype: 'M', direction: 'inbound', constraints: [c('within_after', 'meter_replacement', 10, 'business_days')], summary: 'Z10M skickas senast tio vardagar efter mätarbyte.', source: source('10.2.1', '198') },

  { family: 'PRODAT', code: 'Z13', subtype: 'V', direction: 'outbound', constraints: [
    c('not_before', 'today', -3, 'years', null, 'Önskat startdatum får inte ligga mer än tre år bakåt; nätavtalets start begränsar ytterligare om det är kortare.'),
    c('not_after', 'today', 0, 'calendar_days'),
  ], summary: 'Z13V önskat startdatum får ligga högst tre år bakåt och senast idag; nätavtalets start kan begränsa perioden ytterligare.', source: source('11.3', '206-207') },
  { family: 'PRODAT', code: 'Z13', subtype: 'VH', direction: 'outbound', constraints: [
    c('not_before', 'today', -3, 'years', null, 'Historik får inte gå längre tillbaka än nätavtalets start om den är senare.'),
    c('not_after', 'yesterday', 0, 'calendar_days'),
    c('not_after', 'historical_end', 0, 'calendar_days', null, 'Slutdatum är obligatoriskt och ska vara historiskt.'),
  ], summary: 'Z13VH kräver historisk period: start högst tre år bakåt och senast igår, slutdatum obligatoriskt och historiskt.', source: source('11.3', '206-207') },
  { family: 'PRODAT', code: 'Z14', subtype: 'V', direction: 'inbound', constraints: [c('within_after', 'received_data_access_request', 21, 'calendar_days')], summary: 'Z14V ska hanteras inom 21 dagar.', source: source('11.3', '207') },
  { family: 'PRODAT', code: 'Z14', subtype: 'VH', direction: 'inbound', constraints: [c('within_after', 'received_historical_data_access_request', 21, 'calendar_days')], summary: 'Z14VH ska hanteras inom 21 dagar.', source: source('11.3', '207') },
  { family: 'PRODAT', code: 'Z14', subtype: 'N', direction: 'inbound', constraints: [c('within_after', 'received_data_access_request', 21, 'calendar_days')], summary: 'Z14N ska hanteras inom 21 dagar.', source: source('11.3', '207') },
  { family: 'PRODAT', code: 'Z15', subtype: 'V', direction: 'inbound', constraints: [c('as_soon_as_possible', 'metering_reporting_ended')], summary: 'Z15V skickas snarast efter att rapporteringen upphört.', source: source('10.2.1', '199') },
  { family: 'PRODAT', code: 'Z15', subtype: 'VH', direction: 'inbound', constraints: [c('as_soon_as_possible', 'historical_metering_reporting_ended')], summary: 'Z15VH skickas snarast efter att rapporteringen upphört.', source: source('10.2.1', '199') },
  { family: 'PRODAT', code: 'Z15', subtype: 'C', direction: 'inbound', constraints: [c('in_connection_with', 'reversed_reporting_end')], summary: 'Z15C skickas i samband med att avslut återtas.', source: source('10.2.1', '199') },
  { family: 'PRODAT', code: 'Z18', subtype: 'V', direction: 'outbound', constraints: [c('as_soon_as_possible', 'metering_agreement_ended')], summary: 'Z18V skickas så snart avtalet om rapportering har upphört.', source: source('10.2.1', '199') },
] as const

function normalize(value: unknown): string {
  return String(value ?? '').trim().toUpperCase()
}

export function canonicalDeadlineRuleForMessage(input: {
  family: string
  code: string
  subtype?: string | null
}): CanonicalEdielDeadlineRule | null {
  const family = normalize(input.family)
  const code = normalize(input.code)
  const subtype = normalize(input.subtype) || null
  return CANONICAL_EDIEL_DEADLINE_RULES.find((rule) =>
    rule.family === family && rule.code === code && rule.subtype === subtype,
  ) ?? null
}

export function canonicalDeadlineCatalog(): readonly CanonicalEdielDeadlineRule[] {
  return CANONICAL_EDIEL_DEADLINE_RULES
}

function constraint(rule: CanonicalEdielDeadlineRule, kind: CanonicalEdielDeadlineConstraintKind, anchor: string, condition?: string): CanonicalEdielDeadlineConstraint {
  const matches = rule.constraints.filter((candidate) =>
    candidate.kind === kind && candidate.anchor === anchor && (!condition || candidate.condition === condition),
  )
  if (matches.length !== 1) throw new Error(`ediel_deadline_constraint_missing_or_ambiguous:${rule.family}:${rule.code}:${rule.subtype ?? '-'}:${kind}:${anchor}`)
  return matches[0]
}

function strictDateOnly(value: string | null | undefined, name: string): string {
  const text = String(value ?? '').trim().slice(0, 10)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) throw new Error(`invalid_ediel_deadline_date:${name}`)
  const [year, month, day] = text.split('-').map(Number)
  const date = new Date(Date.UTC(year, month - 1, day))
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) {
    throw new Error(`invalid_ediel_deadline_date:${name}`)
  }
  return text
}

function utcParts(value: string): { year: number; month: number; day: number } {
  const [year, month, day] = value.split('-').map(Number)
  return { year, month, day }
}

function formatDate(year: number, month: number, day: number): string {
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate()
}

export function addCanonicalCalendarDays(value: string, days: number): string {
  const input = strictDateOnly(value, 'calendar_days')
  const { year, month, day } = utcParts(input)
  const date = new Date(Date.UTC(year, month - 1, day + days))
  return formatDate(date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate())
}

export function addCanonicalCalendarMonths(value: string, months: number): string {
  const input = strictDateOnly(value, 'calendar_months')
  const { year, month, day } = utcParts(input)
  const zeroBased = year * 12 + (month - 1) + months
  const targetYear = Math.floor(zeroBased / 12)
  const targetMonthIndex = ((zeroBased % 12) + 12) % 12
  const targetMonth = targetMonthIndex + 1
  return formatDate(targetYear, targetMonth, Math.min(day, daysInMonth(targetYear, targetMonth)))
}

export function addCanonicalYears(value: string, years: number): string {
  return addCanonicalCalendarMonths(value, years * 12)
}

export function stockholmDateOnly(now = new Date()): string {
  return new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'Europe/Stockholm',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now)
}

export type CanonicalSupplierSwitchSendPolicy = {
  version: 'handbook-26A-2026-04-01'
  subtype: 'L' | 'LK' | 'C'
  maxAdvanceMonths: number | null
  minimumLeadCalendarDays: number | null
  latestRelativeToStartDays: number
  calendar: 'Europe/Stockholm'
  source: CanonicalEdielDeadlineRule['source']
}

export function canonicalSupplierSwitchSendPolicy(input: {
  subtype?: 'L' | 'LK' | 'C' | null
  cancellationOfSubtype?: 'L' | 'LK' | null
} = {}): CanonicalSupplierSwitchSendPolicy {
  const subtype = input.subtype ?? 'L'
  const rule = canonicalDeadlineRuleForMessage({ family: 'PRODAT', code: 'Z03', subtype })
  if (!rule) throw new Error(`canonical_supplier_switch_deadline_missing:${subtype}`)

  if (subtype === 'L') {
    const notBefore = constraint(rule, 'not_before', 'delivery_start')
    const notAfter = constraint(rule, 'not_after', 'delivery_start')
    if (notBefore.unit !== 'calendar_months' || notAfter.unit !== 'calendar_days') throw new Error('canonical_supplier_switch_deadline_unit_invalid:L')
    return {
      version: 'handbook-26A-2026-04-01',
      subtype,
      maxAdvanceMonths: Math.abs(notBefore.offset ?? 0),
      minimumLeadCalendarDays: Math.abs(notAfter.offset ?? 0),
      latestRelativeToStartDays: notAfter.offset ?? 0,
      calendar: 'Europe/Stockholm',
      source: rule.source,
    }
  }

  if (subtype === 'LK') {
    const notBefore = constraint(rule, 'not_before', 'delivery_start')
    const notAfter = constraint(rule, 'not_after', 'move_in_date')
    return {
      version: 'handbook-26A-2026-04-01',
      subtype,
      maxAdvanceMonths: Math.abs(notBefore.offset ?? 0),
      minimumLeadCalendarDays: 0,
      latestRelativeToStartDays: notAfter.offset ?? 0,
      calendar: 'Europe/Stockholm',
      source: rule.source,
    }
  }

  const cancellationOfSubtype = input.cancellationOfSubtype
  if (!cancellationOfSubtype) throw new Error('canonical_supplier_switch_cancellation_context_required')
  const notAfter = cancellationOfSubtype === 'L'
    ? constraint(rule, 'not_after', 'delivery_start', 'cancels_Z03_L')
    : constraint(rule, 'not_after', 'move_in_date', 'cancels_Z03_LK')
  return {
    version: 'handbook-26A-2026-04-01',
    subtype,
    maxAdvanceMonths: null,
    minimumLeadCalendarDays: cancellationOfSubtype === 'L' ? Math.abs(notAfter.offset ?? 0) : 0,
    latestRelativeToStartDays: notAfter.offset ?? 0,
    calendar: 'Europe/Stockholm',
    source: rule.source,
  }
}

export type CanonicalDeadlineEvaluation = {
  ok: boolean
  actionType: string
  requestedDate: string | null
  earliestAllowedDate: string | null
  latestAllowedDate: string | null
  issues: string[]
  policy: CanonicalEdielDeadlineRule | null
}

function laterDate(a: string, b: string | null | undefined): string {
  if (!b) return a
  const normalized = strictDateOnly(b, 'network_contract_start_date')
  return normalized > a ? normalized : a
}

export function evaluateCanonicalEdielActionDeadline(input: {
  actionType: string
  requestedDate?: string | null
  historicalStartDate?: string | null
  historicalEndDate?: string | null
  networkContractStartDate?: string | null
  now?: Date
}): CanonicalDeadlineEvaluation {
  const actionType = String(input.actionType ?? '').trim()
  const today = stockholmDateOnly(input.now)
  const yesterday = addCanonicalCalendarDays(today, -1)
  const issues: string[] = []

  if (actionType === 'start_supplier_switch') {
    const policy = canonicalDeadlineRuleForMessage({ family: 'PRODAT', code: 'Z03', subtype: 'L' })
    const requestedDate = input.requestedDate ? strictDateOnly(input.requestedDate, 'requested_date') : null
    const sendPolicy = canonicalSupplierSwitchSendPolicy({ subtype: 'L' })
    const earliest = addCanonicalCalendarDays(today, sendPolicy.minimumLeadCalendarDays ?? 0)
    const latest = addCanonicalCalendarMonths(today, sendPolicy.maxAdvanceMonths ?? 0)
    if (requestedDate && requestedDate < earliest) issues.push(`Leveransstart för Z03L måste ligga minst ${sendPolicy.minimumLeadCalendarDays} kalenderdagar framåt (${earliest} eller senare).`)
    if (requestedDate && requestedDate > latest) issues.push(`Leveransstart för Z03L får ligga högst ${sendPolicy.maxAdvanceMonths} månader framåt (${latest} eller tidigare).`)
    return { ok: issues.length === 0, actionType, requestedDate, earliestAllowedDate: earliest, latestAllowedDate: latest, issues, policy }
  }

  if (actionType === 'request_historical_metering_access') {
    const policy = canonicalDeadlineRuleForMessage({ family: 'PRODAT', code: 'Z13', subtype: 'VH' })
    const threeYearsBack = addCanonicalYears(today, -3)
    const earliest = laterDate(threeYearsBack, input.networkContractStartDate)
    const start = input.historicalStartDate ? strictDateOnly(input.historicalStartDate, 'historical_start_date') : null
    const end = input.historicalEndDate ? strictDateOnly(input.historicalEndDate, 'historical_end_date') : null
    if (!start || !end) issues.push('Historisk Z13VH-begäran kräver start- och slutdatum.')
    if (start && start < earliest) issues.push(`Historisk Z13VH-period får inte börja före ${earliest}.`)
    if (start && start > yesterday) issues.push('Historisk Z13VH-period måste börja senast igår.')
    if (end && end > yesterday) issues.push('Historisk Z13VH-period måste sluta senast igår.')
    if (start && end && end < start) issues.push('Historisk Z13VH-period har slutdatum före startdatum.')
    return { ok: issues.length === 0, actionType, requestedDate: null, earliestAllowedDate: earliest, latestAllowedDate: yesterday, issues, policy }
  }

  if (actionType === 'request_metering_access') {
    const policy = canonicalDeadlineRuleForMessage({ family: 'PRODAT', code: 'Z13', subtype: 'V' })
    const earliest = laterDate(addCanonicalYears(today, -3), input.networkContractStartDate)
    const requestedDate = input.requestedDate ? strictDateOnly(input.requestedDate, 'requested_date') : null
    if (requestedDate && requestedDate < earliest) issues.push(`Z13V startdatum får inte ligga före ${earliest}.`)
    if (requestedDate && requestedDate > today) issues.push('Z13V startdatum får inte ligga efter idag.')
    return { ok: issues.length === 0, actionType, requestedDate, earliestAllowedDate: earliest, latestAllowedDate: today, issues, policy }
  }

  if (actionType === 'terminate_metering_access') {
    const policy = canonicalDeadlineRuleForMessage({ family: 'PRODAT', code: 'Z18', subtype: 'V' })
    return { ok: true, actionType, requestedDate: input.requestedDate ? strictDateOnly(input.requestedDate, 'requested_date') : null, earliestAllowedDate: null, latestAllowedDate: null, issues, policy }
  }

  return {
    ok: false,
    actionType,
    requestedDate: input.requestedDate ? strictDateOnly(input.requestedDate, 'requested_date') : null,
    earliestAllowedDate: null,
    latestAllowedDate: null,
    issues: [`Canonical Ediel-tidsregel saknas för action ${actionType || 'missing'}.`],
    policy: null,
  }
}

export function assertCanonicalDeadlineCatalogConsistency(): void {
  const keys = new Set<string>()
  for (const rule of CANONICAL_EDIEL_DEADLINE_RULES) {
    const key = `${rule.family}:${rule.code}:${rule.subtype ?? '-'}`
    if (keys.has(key)) throw new Error(`ediel_deadline_duplicate:${key}`)
    keys.add(key)
    if (!rule.constraints.length) throw new Error(`ediel_deadline_constraints_missing:${key}`)
    if (rule.source.document !== 'Svensk Elmarknadshandbok' || rule.source.edition !== '26A' || !rule.source.section || !rule.source.pages) {
      throw new Error(`ediel_deadline_source_missing:${key}`)
    }
  }
  canonicalSupplierSwitchSendPolicy({ subtype: 'L' })
  canonicalSupplierSwitchSendPolicy({ subtype: 'LK' })
  canonicalSupplierSwitchSendPolicy({ subtype: 'C', cancellationOfSubtype: 'L' })
  canonicalSupplierSwitchSendPolicy({ subtype: 'C', cancellationOfSubtype: 'LK' })
}
