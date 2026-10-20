import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/supabase/database.types'

// Review queries need three generated table contracts and the caller's RLS
// client. Comparing the complete generated RPC schema at every page boundary
// needlessly expands unrelated function types during the production build.
type ReviewDatabase = {
  public: {
    Tables: Pick<Database['public']['Tables'], 'manual_inbound_messages' | 'companies' | 'customers'>
    Views: Record<never, never>
    Functions: Record<never, never>
  }
}
type ReviewDb = Pick<SupabaseClient<ReviewDatabase>, 'from'>

type Params = Record<string, string | string[] | undefined>
export type ManualMailReviewFilters = { tenant?: string; customer?: string; from?: string; to?: string; page: number }
export const object = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
const uuid = /^[a-f\d]{8}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{12}$/i
const text = (value: unknown): string | undefined => typeof value === 'string' && value.trim() ? value.trim() : undefined
const columns = 'id,company_id,customer_id,request_id,customer_site_id,resolution_status,processing_state,from_email,to_email,subject,received_at,extracted_payload'
export type ManualMailReviewRow = Pick<Database['public']['Tables']['manual_inbound_messages']['Row'], 'id' | 'company_id' | 'customer_id' | 'request_id' | 'customer_site_id' | 'resolution_status' | 'processing_state' | 'from_email' | 'to_email' | 'subject' | 'received_at' | 'extracted_payload'>

export function normalizeManualMailReviewFilters(params: Params): ManualMailReviewFilters {
  const result: ManualMailReviewFilters = { page: 1 }
  for (const key of ['tenant', 'customer'] as const) {
    if (Array.isArray(params[key])) throw new Error('Ange ett sökvärde per fält.')
    const value = text(params[key])
    if (value && (value.length > 120 || /[\u0000-\u001f\u007f]/.test(value))) throw new Error('Ange ett giltigt tenantnamn, kundnamn eller kundnummer.')
    if (value) result[key] = value
  }
  for (const key of ['from', 'to'] as const) {
    const value = text(params[key])
    if (value && (!/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString().slice(0, 10) !== value)) throw new Error('Ange ett giltigt datum.')
    if (value) result[key] = value
  }
  if (result.from && result.to && result.from > result.to) throw new Error('Fråndatum måste ligga före tilldatum.')
  const page = text(params.page)
  if (page && (!/^\d+$/.test(page) || Number(page) < 1 || Number(page) > 1000000)) throw new Error('Ogiltig sida.')
  if (page) result.page = Number(page)
  return result
}

// All filters use the same Swedish calendar day shown in the interface.
function stockholmMidnight(day: string, nextDay = false): string {
  const timestamp = Date.parse(`${day}T00:00:00Z`) + (nextDay ? 86400000 : 0)
  const hour = Number(new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Stockholm', hour: '2-digit', hourCycle: 'h23' }).format(new Date(timestamp)))
  return new Date(timestamp - hour * 3600000).toISOString()
}
export function formatManualMailTime(value: string | null | undefined): string {
  if (!value || !Number.isFinite(Date.parse(value))) return '—'
  return new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Stockholm', dateStyle: 'short', timeStyle: 'short' }).format(new Date(value))
}

export function manualMailReviewReasons(row: { resolution_status?: string; processing_state?: string; extracted_payload?: unknown }): string[] {
  const payload = object(row.extracted_payload), automation = object(payload.manual_automation), multi = object(automation.multi_site)
  const reasons: string[] = []
  if (row.resolution_status !== 'matched') reasons.push(row.resolution_status === 'ambiguous' ? 'Kund eller tenant är tvetydig' : 'Kund eller tenant saknar säker matchning')
  if (Number.isInteger(multi.reviewCount) && Number(multi.reviewCount) > 0) reasons.push(`${multi.reviewCount} anläggningar behöver granskas`)
  if (object(automation.continuation).status === 'failed') reasons.push('Fortsatt handläggning kunde inte slutföras')
  if (object(automation.documentReading).status === 'failed') reasons.push('Bilagan kunde inte läsas säkert')
  if (object(payload.ai_read_only).status === 'failed') reasons.push('AI-läsningen kunde inte slutföras')
  if (!reasons.length) reasons.push('Uppgifter eller fortsatt handläggning behöver granskas')
  return reasons
}

/** Caller must pass the authenticated, platform-admin server client. No service-role bypass. */
export async function getManualMailReviewQueue(db: ReviewDb, params: Params, now = new Date()) {
  const filters = normalizeManualMailReviewFilters(params)
  const stale = new Date(now.getTime() - 15 * 60000).toISOString()
  let query = db.from('manual_inbound_messages').select(columns, { count: 'exact' }).or([
    'resolution_status.in.(unmatched,ambiguous)',
    'processing_state.in.(needs_review,failed,error,extraction_failed,ai_failed)',
    'extracted_payload->manual_automation->>state.in.(needs_review,failed)',
    'extracted_payload->manual_automation->multi_site->>reviewCount.gt.0',
    'extracted_payload->manual_automation->continuation->>status.eq.failed',
    'extracted_payload->manual_automation->documentReading->>status.eq.failed',
    'extracted_payload->ai_read_only->>status.eq.failed',
    `and(extracted_payload->ai_read_only->>status.eq.processing,extracted_payload->ai_read_only->>started_at.lt.${stale})`,
    'and(extracted_payload->ai_read_only->>status.eq.processing,extracted_payload->ai_read_only->>started_at.is.null)',
    `and(extracted_payload->manual_automation->documentReading->>status.eq.processing,extracted_payload->manual_automation->documentReading->>started_at.lt.${stale})`,
    'and(extracted_payload->manual_automation->documentReading->>status.eq.processing,extracted_payload->manual_automation->documentReading->>started_at.is.null)',
    `and(processing_state.in.(received,normalized,matched,processing,ai_processing,document_processing),received_at.lt.${stale})`,
  ].join(','))
  const pattern = (value: string) => `%${value.replace(/[\\%_]/g, character => `\\${character}`)}%`
  let companyIds: string[] | undefined
  let customerIds: string[] | undefined
  if (filters.tenant) {
    if (uuid.test(filters.tenant)) query = query.eq('company_id', filters.tenant)
    else {
      const { data, error } = await db.from('companies').select('id').ilike('name', pattern(filters.tenant)).limit(51)
      if (error) throw new Error('Tenantnamnet kunde inte sökas.')
      if ((data?.length ?? 0) > 50) throw new Error('Flera tenants matchar. Ange ett mer precist namn.')
      companyIds = (data ?? []).map(row => row.id)
      if (companyIds.length) query = query.in('company_id', companyIds)
    }
  }
  if (filters.customer) {
    if (uuid.test(filters.customer)) query = query.eq('customer_id', filters.customer)
    else if (companyIds?.length !== 0) {
      const quoted = JSON.stringify(pattern(filters.customer))
      let lookup = db.from('customers').select('id').or(['full_name','company_name','customer_number'].map(field => `${field}.ilike.${quoted}`).join(',')).limit(51)
      if (companyIds) lookup = lookup.in('company_id', companyIds)
      else if (filters.tenant && uuid.test(filters.tenant)) lookup = lookup.eq('company_id', filters.tenant)
      const { data, error } = await lookup
      if (error) throw new Error('Kunden kunde inte sökas.')
      if ((data?.length ?? 0) > 50) throw new Error('Flera kunder matchar. Ange tenant eller ett mer precist kundnamn eller kundnummer.')
      customerIds = (data ?? []).map(row => row.id)
      if (customerIds.length) query = query.in('customer_id', customerIds)
    }
  }
  if (companyIds?.length === 0 || customerIds?.length === 0) return { rows: [] as ManualMailReviewRow[], filters, page: filters.page, total: 0, hasMore: false }
  if (filters.from) query = query.gte('received_at', stockholmMidnight(filters.from))
  if (filters.to) query = query.lt('received_at', stockholmMidnight(filters.to, true))
  const offset = (filters.page - 1) * 25
  const { data, error, count } = await query.order('received_at', { ascending: false }).order('id', { ascending: false }).range(offset, offset + 24)
  if (error) throw new Error('Granskningskön kunde inte hämtas.')
  return { rows: (data ?? []) as ManualMailReviewRow[], filters, page: filters.page, total: count ?? 0, hasMore: offset + 25 < (count ?? 0) }
}

export async function getManualMailReviewDetail(db: ReviewDb, id: string) {
  if (!uuid.test(id)) return null
  const { data, error } = await db.from('manual_inbound_messages').select(`${columns},body_text,normalized_text,correlation_evidence,attachments,provider_message_id,in_reply_to`).eq('id', id).maybeSingle()
  if (error) throw new Error('Mejlet kunde inte hämtas.')
  if (!data) return null
  const { attachments, ...safe } = data
  const attachmentDescriptors = (Array.isArray(attachments) ? attachments : []).map(value => {
    const a = object(value)
    return { mimePart: typeof a.mimePart === 'number' ? a.mimePart : null, filename: text(a.filename) ?? 'Bilaga', contentType: text(a.contentType) ?? 'application/octet-stream', sizeBytes: typeof a.sizeBytes === 'number' ? a.sizeBytes : null, sha256: text(a.sha256) ?? null, capturedIssue: text(a.capturedIssue) ?? null, downloadable: typeof a.contentBase64 === 'string' && a.contentBase64.length > 0 && typeof a.mimePart === 'number' }
  })
  return { ...safe, attachmentDescriptors }
}


/** Display names come only from the already assigned canonical foreign keys. */
export async function getManualMailReviewNames(db: ReviewDb, rows: Array<{ company_id: string | null; customer_id: string | null }>) {
  const companyIds = [...new Set(rows.flatMap(row => row.company_id ? [row.company_id] : []))]
  const customerIds = [...new Set(rows.flatMap(row => row.customer_id ? [row.customer_id] : []))]
  const [companies, customers] = await Promise.all([
    companyIds.length ? db.from('companies').select('id,name,legal_name').in('id', companyIds) : Promise.resolve({ data: [], error: null }),
    customerIds.length ? db.from('customers').select('id,company_id,full_name,company_name,customer_number').in('id', customerIds) : Promise.resolve({ data: [], error: null }),
  ])
  if (companies.error || customers.error) throw new Error('Tenant- och kundnamn kunde inte hämtas.')
  const companyNames = new Map((companies.data ?? []).map(row => [row.id, row.legal_name || row.name || row.id]))
  const customerNames = new Map((customers.data ?? []).filter(customer => rows.some(row => row.customer_id === customer.id && row.company_id === customer.company_id))
    .map(row => [row.id, [row.company_name || row.full_name, row.customer_number].filter(Boolean).join(' · ') || row.id]))
  return { companies: companyNames, customers: customerNames }
}
