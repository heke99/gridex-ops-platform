import { supabaseService } from '@/lib/supabase/service'

export type LaunchSeverity = 'info' | 'warning' | 'critical'

export type LaunchSafeCountFilter = {
  column: string
  operator?: 'eq' | 'in' | 'is'
  value: unknown
}

const MISSING_SCHEMA_CODES = new Set(['42P01', '42703', 'PGRST205'])

export function isMissingSchemaError(error: unknown): boolean {
  const code = (error as { code?: string } | null)?.code ?? ''
  const message = (error as { message?: string } | null)?.message ?? ''
  return MISSING_SCHEMA_CODES.has(code) || /schema cache|does not exist|column .* does not exist/i.test(message)
}

export function humanizeLaunchError(value: string | null | undefined): string {
  const key = String(value ?? '').trim()
  if (!key) return 'Okänd avvikelse behöver granskas.'

  const normalized = key.toLowerCase()
  if (normalized.includes('object_not_identified')) return 'Anläggningen kunde inte identifieras av nätägaren.'
  if (normalized.includes('negative_aperak')) return 'Nätägaren har skickat negativ APERAK och ärendet är stoppat tills orsaken är löst.'
  if (normalized.includes('missing_route')) return 'Route saknas eller behöver verifieras av superadmin.'
  if (normalized.includes('rate_limited')) return 'Extern tjänst svarar långsamt. Försök igen senare eller hantera manuellt.'
  if (normalized.includes('facility')) return 'Anläggningsuppgifter behöver kompletteras eller verifieras.'
  if (normalized.includes('price_area')) return 'SE-område saknas eller är inte verifierat.'
  if (normalized.includes('grid_owner')) return 'Nätägare saknas eller behöver verifieras.'
  if (normalized.includes('poa')) return 'Fullmakt saknas eller behöver verifieras.'
  if (key.length > 160) return `${key.slice(0, 160)}…`
  return key.replace(/_/g, ' ')
}

export function severityFromEdielBusinessError(input: {
  business_error?: string | null
  status?: string | null
  retry_allowed?: boolean | null
  recommended_action?: string | null
  metadata?: Record<string, unknown> | null
}): LaunchSeverity {
  const status = String(input.status ?? 'open').toLowerCase()
  const businessError = String(input.business_error ?? '').toLowerCase()
  const action = String(input.recommended_action ?? '').toLowerCase()
  if (status === 'resolved' || status === 'ignored') return 'info'
  if (input.retry_allowed === false && status === 'open') return 'critical'
  if (['object_not_identified', 'facility_rejected', 'negative_aperak', 'z02_rejected', 'protected_identity'].some((key) => businessError.includes(key))) return 'critical'
  if (action.includes('stoppa') || action.includes('blockera')) return 'critical'
  if (status.includes('waiting')) return 'warning'
  return 'warning'
}

export type RouteReadinessStatus =
  | 'critical_missing_route'
  | 'recommended_missing_route'
  | 'optional_missing_route'
  | 'not_required'
  | 'needs_review'
  | 'not_sendable'
  | 'ready_verified_manual_send'
  | 'ready_auto_send_allowed'

export function classifyRouteReadiness(input: {
  actorRole?: string | null
  messageFamily?: string | null
  status?: string | null
  isVerified?: boolean | null
  autoSendAllowed?: boolean | null
  communicationAddress?: string | null
  hasRoute: boolean
}): RouteReadinessStatus {
  const role = String(input.actorRole ?? '').toLowerCase()
  const family = String(input.messageFamily ?? '').toUpperCase()
  const status = String(input.status ?? '').toLowerCase()

  if (!input.hasRoute) {
    if (role === 'grid_owner' && family === 'PRODAT') return 'critical_missing_route'
    if (role === 'grid_owner' && family === 'UTILTS') return 'recommended_missing_route'
    if (role === 'system_supplier') return 'not_required'
    return 'optional_missing_route'
  }

  if (!input.communicationAddress?.trim()) return 'not_sendable'
  if (status !== 'active' || input.isVerified !== true) return 'needs_review'
  if (input.autoSendAllowed === true) return 'ready_auto_send_allowed'
  return 'ready_verified_manual_send'
}

export function routeReadinessLabel(status: RouteReadinessStatus): string {
  switch (status) {
    case 'critical_missing_route': return 'Kritisk route saknas'
    case 'recommended_missing_route': return 'Rekommenderad route saknas'
    case 'optional_missing_route': return 'Valfri route/kontakt saknas'
    case 'not_required': return 'Route krävs inte'
    case 'needs_review': return 'Behöver verifieras'
    case 'not_sendable': return 'Ej sändbar'
    case 'ready_verified_manual_send': return 'Verifierad – manuell sändning'
    case 'ready_auto_send_allowed': return 'Verifierad – autosändning tillåten'
  }
}

export function routeReadinessNextStep(status: RouteReadinessStatus): string {
  switch (status) {
    case 'critical_missing_route': return 'Lägg in och verifiera PRODAT-route innan leverantörsbyte/anläggningsdata skickas.'
    case 'recommended_missing_route': return 'Komplettera UTILTS-route innan automatiserade mätvärdesflöden används.'
    case 'optional_missing_route': return 'Skapa kontaktväg eller markera aktören som contact-only/not required.'
    case 'not_required': return 'Ingen teknisk route krävs för aktören just nu.'
    case 'needs_review': return 'Verifiera actor och route. Autosändning ska fortfarande vara av tills separat readiness är klar.'
    case 'not_sendable': return 'Komplettera kommunikationsadress, subadress och transportinställningar.'
    case 'ready_verified_manual_send': return 'Route är verifierad men autosändning är av. Detta är rätt läge före full produktionsreadiness.'
    case 'ready_auto_send_allowed': return 'Autosändning är tillåten. Kontrollera att detta är avsiktligt och audit-loggat.'
  }
}

export async function safeCount(
  table: string,
  companyId?: string | null,
  filters: LaunchSafeCountFilter[] = []
): Promise<number> {
  let query = supabaseService.from(table).select('id', { count: 'exact', head: true })
  if (companyId) query = query.eq('company_id', companyId)

  for (const filter of filters) {
    const operator = filter.operator ?? 'eq'
    if (operator === 'eq') query = query.eq(filter.column, filter.value as string)
    if (operator === 'in') query = query.in(filter.column, filter.value as string[])
    if (operator === 'is') query = query.is(filter.column, filter.value as null)
  }

  const { count, error } = await query
  if (error && isMissingSchemaError(error)) return 0
  if (error) throw error
  return count ?? 0
}

export function startOfTodayIso() {
  const date = new Date()
  date.setHours(0, 0, 0, 0)
  return date.toISOString()
}

export function startOfMonthIso() {
  const date = new Date()
  date.setDate(1)
  date.setHours(0, 0, 0, 0)
  return date.toISOString()
}

export function sevenDaysAgoIso() {
  const date = new Date()
  date.setDate(date.getDate() - 7)
  return date.toISOString()
}
