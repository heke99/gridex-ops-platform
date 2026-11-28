import 'server-only'

import { requireAdminPageKeyAccess } from '@/lib/admin/guards'
import type { GridOwnerDataRequestRow } from '@/lib/cis/types'
import { UUID_PATTERN } from '@/lib/ediel/matching/postgrestFilter'
import type { EdielMessageRow } from '@/lib/ediel/types'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { supabaseService } from '@/lib/supabase/service'
import { resolveAdminTenantReadScope } from '@/lib/tenant/adminScope'

function getRecordValue(value: unknown, key: string): unknown {
 if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
 return (value as Record<string, unknown>)[key]
}

function getString(value: unknown, key: string): string | null {
 const raw = getRecordValue(value, key)
 return typeof raw === 'string' ? raw : null
}

function getNumber(value: unknown, key: string): number | null {
 const raw = getRecordValue(value, key)
 return typeof raw === 'number' && Number.isFinite(raw) && raw >= 0 ? raw : null
}

function getInstant(value: unknown, key: string): string | null {
 const raw = getString(value, key)
 return raw && Number.isFinite(Date.parse(raw)) ? raw : null
}

function readMeteringResponses(value: unknown, count: number) {
 if (!Array.isArray(value) || value.length !== count) return null
 const responses = []
 const seen = new Set<string>()
 for (const row of value) {
  const sourceId = getString(row, 'sourceMessageId')
  const storedValueCount = getNumber(row, 'storedValueCount')
  const currentValueCount = getNumber(row, 'currentValueCount')
  const historicalOnly = getRecordValue(row, 'historicalOnly') === true
  if (!sourceId || !UUID_PATTERN.test(sourceId) || seen.has(sourceId) ||
    storedValueCount === null || !Number.isSafeInteger(storedValueCount) ||
    currentValueCount === null || !Number.isSafeInteger(currentValueCount) ||
    currentValueCount > storedValueCount || (historicalOnly && storedValueCount !== 0)) return null
  seen.add(sourceId)
  responses.push({ sourceId, reference: getString(row, 'responseReference'),
    observedAt: getInstant(row, 'observedAt'), storedValueCount, currentValueCount, historicalOnly })
 }
 return responses
}

function meteringEnvironment(
 requestId: string,
 messages: EdielMessageRow[],
 companyId: string,
) {
 const environments = new Set(messages
 .filter((message) => message.company_id === companyId &&
   message.grid_owner_data_request_id === requestId && message.direction === 'outbound' &&
   message.message_family === 'UTILTS' && message.message_code === 'E73')
 .map((message) => message.environment))
 if (environments.size !== 1) return null
 const [environment] = environments
 return environment === 'test' || environment === 'production' ? environment : null
}

async function readMeteringHistory(requestId: string, companyId: string, environment: 'test' | 'production') {
 const readHistory = supabaseService.rpc.bind(supabaseService) as unknown as (
  name: 'gridex_read_e66_request_response_history_v1',
  args: { p_company_id: string; p_request_id: string; p_environment: 'test' | 'production' },
 ) => Promise<{ data: unknown; error: unknown }>
 const { data, error } = await readHistory('gridex_read_e66_request_response_history_v1', {
 p_company_id: companyId,
 p_request_id: requestId,
 p_environment: environment,
 })
 if (error || getString(data, 'requestId') !== requestId) return null
 const responseCount = getNumber(data, 'responseCount')
 if (responseCount === null || !Number.isSafeInteger(responseCount)) return null

 const coverage = getRecordValue(data, 'coverage')
 const requestedFrom = getInstant(coverage, 'requestedFrom')
 const requestedUntil = getInstant(coverage, 'requestedUntil')
 const coveredSeconds = getNumber(coverage, 'coveredSeconds')
 const remainingSeconds = getNumber(coverage, 'remainingSeconds')
 const remainingGapCount = getNumber(coverage, 'remainingGapCount')
 const gapRows = getRecordValue(coverage, 'remainingGaps')
 const gaps = Array.isArray(gapRows) ? gapRows.flatMap((gap) => {
 const from = getInstant(gap, 'from')
 const until = getInstant(gap, 'until')
 return from && until && Date.parse(from) < Date.parse(until) ? [{ from, until }] : []
 }) : []

 return {
  responseCount,
  requestReference: getString(data, 'requestReference'),
  responses: readMeteringResponses(getRecordValue(data, 'responses'), responseCount),
  firstObservedAt: getInstant(data, 'firstObservedAt'),
  latestObservedAt: getInstant(data, 'latestObservedAt'),
  coverage: requestedFrom && requestedUntil && Date.parse(requestedFrom) < Date.parse(requestedUntil) &&
    coveredSeconds !== null && remainingSeconds !== null && remainingGapCount === gaps.length &&
    Array.isArray(gapRows) && gaps.length === gapRows.length
    ? { requestedFrom, requestedUntil, coveredSeconds, remainingSeconds, gaps }
    : null,
 }
}

const e66RequestReviewDescriptions: Readonly<Record<string,string>> = {
 missing_reference: 'Svaret saknar en hänvisning till en begäran.',
 ambiguous_reference: 'Referensen ger flera möjliga begäranden.',
 unknown_reference: 'Referensen motsvarar ingen begäran i bolaget.',
 point_mismatch: 'Mätpunkten eller kundkopplingen avviker från begäran.',
 inactive_request: 'Begäran är ännu inte sänd eller har avslutats.',
 disjoint_period: 'Svarstiden ligger utanför den utsända perioden.',
 unverified_period: 'Den utsända perioden kan inte styrkas.',
}

async function readE66RequestReviews(requestId: string,companyId: string,environment: 'test' | 'production' | null,actorUserId: string) {
 const {data,error} = await supabaseService.rpc('gridex_read_e66_request_correlation_reviews_v1', {
  p_request_id:requestId,p_company_id:companyId,p_environment:environment,p_actor_user_id:actorUserId,
 })
 if (error || !Array.isArray(data) || data.length>20) return []
 return data.flatMap(row=>{
  const sourceId=getString(row,'sourceId'), reason=getString(row,'reason'), environment=getString(row,'environment')
  if (!sourceId || !UUID_PATTERN.test(sourceId) || !reason || !Object.hasOwn(e66RequestReviewDescriptions,reason) || (environment!=='test' && environment!=='production')) return []
  return [{sourceId,description:e66RequestReviewDescriptions[reason],receivedAt:getInstant(row,'receivedAt'),environment,periodFrom:getInstant(row,'periodFrom'),periodUntil:getInstant(row,'periodUntil'),
    responseReference:getString(row,'responseReference'),requestReference:getString(row,'requestReference'),
    pointReference:getString(row,'pointReference')}]
 })
}

export async function loadGridOwnerRequestForAdmin(inputId: string) {
 const access = await requireAdminPageKeyAccess('operations.grid_owner_request_detail')
 const tenantScope = await resolveAdminTenantReadScope(access)
 if (!UUID_PATTERN.test(inputId)) return null
 const id = inputId.toLowerCase()

 const supabase = await createSupabaseServerClient()
 const { data: { user } } = await supabase.auth.getUser()
 let requestQuery = supabase.from('grid_owner_data_requests').select('*').eq('id', id)
 if (!tenantScope.isPlatformAdmin) {
  if (!tenantScope.companyId || !UUID_PATTERN.test(tenantScope.companyId)) return null
  requestQuery = requestQuery.eq('company_id', tenantScope.companyId)
 }
 const { data, error } = await requestQuery.maybeSingle()
 if (error) throw error
 const request = data as GridOwnerDataRequestRow | null
 if (!request || request.id !== id) return null
 const companyId = typeof request.company_id === 'string' ? request.company_id : null
 if (!tenantScope.isPlatformAdmin && companyId !== tenantScope.companyId) return null

 async function readMessages() {
  const { data, error } = await supabase.from('ediel_messages').select('*')
   .eq('grid_owner_data_request_id', id).order('created_at', { ascending: false })
  if (error) throw error
  const rows = (data as EdielMessageRow[] | null) ?? []
  return { rows, environment: companyId ? meteringEnvironment(id, rows, companyId) : null }
 }
 const meteringRequest = request.request_scope === 'meter_values' || request.request_scope === 'billing_underlay'
 const matchedActor = user?.id === access.userId
 let messages: ReturnType<typeof readMessages> | undefined
 const loadMessages = () => messages ??= readMessages()
 const readRequestMessages = async () => (await loadMessages()).rows
 async function readRequestMeteringHistory() {
  if (!meteringRequest || !companyId || !UUID_PATTERN.test(companyId) || !matchedActor) return null
  const { environment } = await loadMessages()
  return environment ? readMeteringHistory(id, companyId, environment) : null
 }

 async function readRequestCorrelationReviews() {
  if (!meteringRequest || !companyId || !matchedActor) return []
  const {environment} = await loadMessages()
  return readE66RequestReviews(id,companyId,environment,access.userId)
 }

 return { access, tenantScope, user, supabase, request, requestCompanyId: companyId, readRequestMessages,
  readRequestMeteringHistory,readRequestCorrelationReviews }
}
