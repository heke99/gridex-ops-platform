import { supabaseService } from '@/lib/supabase/service'
import { listCustomerCases } from '@/lib/customer-cases/db'
import type { CustomerCaseListRow, CustomerCasePriority, CustomerCaseRow } from '@/lib/customer-cases/types'
import type { SupportActor } from '@/lib/customer-operations/supportCommand'

type SupportChannel = 'api' | 'customer_portal' | 'admin' | 'operations_automation'

export type TenantSupportCustomerOption = { id: string; label: string }
export type TenantSupportMessage = { id: string; body: string; visibility: 'customer' | 'internal'; author_kind: 'customer' | 'staff'; actor_user_id: string | null; channel: 'ops' | 'phone' | 'portal' | 'api'; caller_verification: 'unverified' | 'not_applicable'; revision: number; created_at: string }

export async function listTenantSupportMessages(input: { companyId: string; customerId: string; caseId: string; offset?: number; limit?: number }) {
  const limit = Math.min(Math.max(input.limit ?? 25, 1), 100)
  const offset = Math.max(0, input.offset ?? 0)
  const { data, error } = await supabaseService.from('customer_support_messages')
    .select('id,body,visibility,author_kind,actor_user_id,channel,caller_verification,revision,created_at')
    .eq('company_id', input.companyId).eq('customer_id', input.customerId).eq('customer_case_id', input.caseId)
    .order('created_at', { ascending: false }).order('id', { ascending: false }).range(offset, offset + limit)
  if (error) throw error
  return { items: ((data ?? []) as TenantSupportMessage[]).slice(0, limit), hasMore: (data?.length ?? 0) > limit }
}

type CreateTenantSupportCaseInput = {
  companyId: string
  customerId: string
  siteId?: string | null
  meteringPointId?: string | null
  title: string
  description?: string | null
  category?: string | null
  priority?: CustomerCasePriority
  channel: SupportChannel
  idempotencyKey?: string | null
  actorUserId?: string | null
  metadata?: Record<string, unknown>
  actor?: SupportActor
  interactionChannel?: 'ops' | 'phone'
}

export async function listTenantSupportCustomerOptions(companyId: string, selectedCustomerId?: string | null): Promise<TenantSupportCustomerOption[]> {
  const { data, error } = await supabaseService
    .from('customers')
    .select('id,customer_number,full_name,first_name,last_name,company_name')
    .eq('company_id', companyId)
    .order('created_at', { ascending: false })
    .limit(200)
  if (error) throw error
  const rows = [...(data ?? [])]
  // A customer-card/search link may target an older customer outside the first
  // option page. Resolve only that exact customer within this tenant.
  if (selectedCustomerId && !rows.some(row => row.id === selectedCustomerId)) {
    const selected = await supabaseService.from('customers')
      .select('id,customer_number,full_name,first_name,last_name,company_name')
      .eq('company_id', companyId).eq('id', selectedCustomerId).maybeSingle()
    if (selected.error) throw selected.error
    if (selected.data) rows.push(selected.data)
  }
  return rows.map((row) => {
    const person = [row.first_name, row.last_name].filter(Boolean).join(' ').trim()
    const name = row.full_name ?? (person || row.company_name || row.customer_number || row.id)
    return { id: String(row.id), label: `${name}${row.customer_number ? ` · ${row.customer_number}` : ''}` }
  })
}

export async function createTenantSupportCase(input: CreateTenantSupportCaseInput): Promise<{ case: CustomerCaseRow; reused: boolean }> {
  const { executeSupportCommand, SupportCommandError } = await import('@/lib/customer-operations/supportCommand')
  if (!input.actor || input.channel === 'operations_automation' ||
      (input.channel === 'admin' && input.actor.kind !== 'ops') ||
      (input.channel === 'customer_portal' && input.actor.kind !== 'portal') ||
      (input.channel === 'api' && input.actor.kind !== 'api') ||
      (input.actorUserId && (input.actor.kind === 'api' || input.actorUserId !== input.actor.userId))) {
    throw new SupportCommandError('support_actor_forbidden', 403)
  }
  if (input.metadata) throw new SupportCommandError('invalid_support_command', 422)
  const result = await executeSupportCommand({ companyId: input.companyId, customerId: input.customerId,
    ...(input.siteId ? { siteId: input.siteId } : {}), ...(input.meteringPointId ? { meteringPointId: input.meteringPointId } : {}),
    ...(input.interactionChannel ? { interactionChannel: input.interactionChannel } : {}),
    actor: input.actor, operation: 'create', expectedRevision: 0,
    idempotencyKey: input.idempotencyKey ?? '',
    payload: { title: input.title, body: input.description?.trim() || 'Ingen ytterligare beskrivning lämnad.',
      ...(input.actor.kind === 'ops' ? { priority: input.priority ?? 'normal', category: input.category?.trim() || 'support' } : {}) } })
  const { data, error } = await supabaseService.from('customer_cases').select('*')
    .eq('id', result.caseId).eq('company_id', input.companyId).eq('customer_id', input.customerId).single()
  if (error) throw error
  return { case: data as CustomerCaseRow, reused: result.replayed }
}

/** Legacy website events are machine intake, never customer authorization.
 * New support writes use the exact-action customer cases routes. */
export async function createSupportCaseFromCustomerEvent(input: {
  companyId: string
  customerId: string
  eventType: string
  eventReference: string
  data: Record<string, unknown>
  idempotencyKey: string
  channel?: SupportChannel
  apiClientId?: string | null
}) {
  const { SupportCommandError } = await import('@/lib/customer-operations/supportCommand')
  void input
  throw new SupportCommandError('support_event_delegation_required', 403)
}

export async function listTenantSupportCases(input: {
  companyId: string
  customerId?: string | null
  status?: string | null
  limit?: number
  offset?: number
  query?: string | null
  caseId?: string | null
}): Promise<CustomerCaseListRow[]> {
  const rows = await listCustomerCases({
    companyId: input.companyId,
    customerId: input.customerId ?? null,
    status: input.status ?? null,
    limit: Math.min(Math.max(input.limit ?? 100, 1), 200),
    offset: Math.max(0, Math.floor(input.offset ?? 0)),
    supportOnly: true,
    query: input.query ?? null,
    caseId: input.caseId ?? null,
  })
  // Keep this guard even when the database filter is in place; only the exact
  // support predicate is permitted to leave this service boundary.
  return rows.filter((row) => row.metadata?.support_case === true || String(row.source ?? '').startsWith('tenant_support_'))
}
