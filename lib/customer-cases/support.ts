import { supabaseService } from '@/lib/supabase/service'
import { createCustomerCase, listCustomerCases } from '@/lib/customer-cases/db'
import type { CustomerCaseListRow, CustomerCasePriority, CustomerCaseRow } from '@/lib/customer-cases/types'

type SupportChannel = 'api' | 'customer_portal' | 'admin' | 'operations_automation'

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
}

function text(value: unknown, maxLength = 4_000): string | null {
  if (typeof value !== 'string') return null
  const normalized = value.trim()
  return normalized ? normalized.slice(0, maxLength) : null
}

async function assertCustomerScope(input: { companyId: string; customerId: string }) {
  const { data, error } = await supabaseService
    .from('customers')
    .select('id,company_id')
    .eq('id', input.customerId)
    .eq('company_id', input.companyId)
    .maybeSingle()
  if (error) throw error
  if (!data?.id) throw new Error('support_customer_not_found_in_tenant')
}

async function findIdempotentSupportCase(input: {
  companyId: string
  customerId: string
  idempotencyKey: string
}): Promise<CustomerCaseRow | null> {
  const { data, error } = await supabaseService
    .from('customer_cases')
    .select('*')
    .eq('company_id', input.companyId)
    .eq('customer_id', input.customerId)
    .contains('metadata', { support_idempotency_key: input.idempotencyKey })
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (error) throw error
  return (data as CustomerCaseRow | null) ?? null
}

export async function createTenantSupportCase(input: CreateTenantSupportCaseInput): Promise<{ case: CustomerCaseRow; reused: boolean }> {
  const title = text(input.title, 180)
  if (!title) throw new Error('support_title_required')
  const description = text(input.description, 8_000)
  const category = text(input.category, 120) ?? 'support'
  const idempotencyKey = text(input.idempotencyKey, 200)

  await assertCustomerScope({ companyId: input.companyId, customerId: input.customerId })

  if (idempotencyKey) {
    const existing = await findIdempotentSupportCase({
      companyId: input.companyId,
      customerId: input.customerId,
      idempotencyKey,
    })
    if (existing) return { case: existing, reused: true }
  }

  const row = await createCustomerCase({
    companyId: input.companyId,
    customerId: input.customerId,
    siteId: input.siteId ?? null,
    meteringPointId: input.meteringPointId ?? null,
    caseType: 'other',
    priority: input.priority ?? 'normal',
    title,
    description,
    reasonCategory: category,
    source: `tenant_support_${input.channel}`,
    nextAction: 'Supportärendet ska triageras inom tenantens ordinarie ärendeflöde.',
    actorUserId: input.actorUserId ?? null,
    metadata: {
      support_case: true,
      support_channel: input.channel,
      support_idempotency_key: idempotencyKey,
      ...(input.metadata ?? {}),
    },
  })

  return { case: row, reused: false }
}

export async function listTenantSupportCases(input: {
  companyId: string
  customerId?: string | null
  status?: string | null
  limit?: number
}): Promise<CustomerCaseListRow[]> {
  const rows = await listCustomerCases({
    companyId: input.companyId,
    customerId: input.customerId ?? null,
    status: input.status ?? null,
    limit: Math.min(Math.max(input.limit ?? 100, 1), 200),
  })
  return rows.filter((row) => row.metadata?.support_case === true || String(row.source ?? '').startsWith('tenant_support_'))
}

export function publicSupportCase(row: CustomerCaseRow | CustomerCaseListRow) {
  return {
    id: row.id,
    status: row.status,
    priority: row.priority,
    title: row.title,
    description: row.description,
    category: row.reason_category,
    next_action: row.next_action,
    created_at: row.created_at,
    updated_at: row.updated_at,
    resolved_at: row.resolved_at,
    closed_at: row.closed_at,
  }
}
