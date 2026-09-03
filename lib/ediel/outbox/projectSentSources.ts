import type { EdielMessageRow } from '@/lib/ediel/types'
import { tenantDb } from '@/lib/supabase/tenantDb'

function clean(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function upper(value: unknown): string | null {
  const cleaned = clean(value)
  return cleaned ? cleaned.toUpperCase() : null
}

type DbError = { message?: string; code?: string } | null

type FilterQuery<T> = {
  eq: (column: string, value: unknown) => FilterQuery<T>
  limit: (count: number) => FilterQuery<T>
  select: (columns?: string) => FilterQuery<T>
  maybeSingle: () => PromiseLike<{ data: T | null; error: DbError }>
  then: PromiseLike<{ data: T[] | null; error: DbError }>['then']
}

function asFilterQuery<T>(value: unknown): FilterQuery<T> {
  return value as FilterQuery<T>
}

export type CustomerInfoPostSendStatus =
  | 'waiting_for_contrl'
  | 'waiting_for_aperak'
  | 'waiting_for_z02'

export function customerInfoPostSendStatus(
  message: Pick<EdielMessageRow, 'requires_contrl' | 'contrl_status' | 'requires_aperak' | 'aperak_status'>,
): CustomerInfoPostSendStatus {
  if (message.requires_contrl === true && message.contrl_status !== 'received') return 'waiting_for_contrl'
  if (message.requires_aperak === true && message.aperak_status !== 'received') return 'waiting_for_aperak'
  return 'waiting_for_z02'
}

function nextActionForCustomerInfo(status: CustomerInfoPostSendStatus): string {
  if (status === 'waiting_for_contrl') {
    return 'Invänta CONTRL för skickad Z01. Efter positiv teknisk kvittens inväntas Z02.'
  }
  if (status === 'waiting_for_aperak') {
    return 'Invänta APERAK för skickad Z01. Efter positiv funktionell kvittens inväntas Z02.'
  }
  return 'Invänta Z02 från nätägaren.'
}

async function projectOutboundRequest(params: {
  companyId: string
  outboundRequestId: string
  sentAt: string
  actorUserId: string
}): Promise<void> {
  const db = tenantDb(params.companyId)
  const readQuery = asFilterQuery<{ id: string; status: string | null; sent_at: string | null }>(
    db.from('outbound_requests').select('id,status,sent_at'),
  )
  const { data: row, error: readError } = await readQuery
    .eq('id', params.outboundRequestId)
    .maybeSingle()
  if (readError) throw readError
  if (!row) throw new Error('ediel_post_send_outbound_request_missing_or_cross_tenant')

  const status = clean(row.status)
  const alreadySentAt = clean(row.sent_at)
  if (status === 'failed' || status === 'cancelled') {
    throw new Error(`ediel_post_send_outbound_request_terminal_${status}`)
  }
  if (!['queued', 'prepared', 'sent', 'acknowledged'].includes(String(status))) {
    throw new Error(`ediel_post_send_outbound_request_unexpected_${status ?? 'null'}`)
  }
  if (alreadySentAt && ['sent', 'acknowledged'].includes(String(status))) return

  const nextStatus = status === 'acknowledged' ? 'acknowledged' : 'sent'
  const updateQuery = asFilterQuery<{ id: string }>(
    db.from('outbound_requests').update({
      status: nextStatus,
      sent_at: alreadySentAt ?? params.sentAt,
      failure_reason: null,
      updated_by: params.actorUserId,
      updated_at: new Date().toISOString(),
    }),
  )
  const { data, error } = await updateQuery
    .eq('id', params.outboundRequestId)
    .select('id')
    .maybeSingle()
  if (error) throw error
  if (!data) throw new Error('ediel_post_send_outbound_request_projection_lost')
}

async function projectGridOwnerDataRequest(params: {
  companyId: string
  gridOwnerDataRequestId: string
  sentAt: string
  actorUserId: string
}): Promise<void> {
  const db = tenantDb(params.companyId)
  const readQuery = asFilterQuery<{ id: string; status: string | null; sent_at: string | null }>(
    db.from('grid_owner_data_requests').select('id,status,sent_at'),
  )
  const { data: row, error: readError } = await readQuery
    .eq('id', params.gridOwnerDataRequestId)
    .maybeSingle()
  if (readError) throw readError
  if (!row) throw new Error('ediel_post_send_grid_owner_data_request_missing_or_cross_tenant')

  const status = clean(row.status)
  const alreadySentAt = clean(row.sent_at)
  if (status === 'failed' || status === 'cancelled') {
    throw new Error(`ediel_post_send_grid_owner_data_request_terminal_${status}`)
  }
  if (!['pending', 'sent', 'received'].includes(String(status))) {
    throw new Error(`ediel_post_send_grid_owner_data_request_unexpected_${status ?? 'null'}`)
  }
  if (alreadySentAt && ['sent', 'received'].includes(String(status))) return

  const nextStatus = status === 'received' ? 'received' : 'sent'
  const updateQuery = asFilterQuery<{ id: string }>(
    db.from('grid_owner_data_requests').update({
      status: nextStatus,
      sent_at: alreadySentAt ?? params.sentAt,
      failed_at: null,
      failure_reason: null,
      updated_by: params.actorUserId,
      updated_at: new Date().toISOString(),
    }),
  )
  const { data, error } = await updateQuery
    .eq('id', params.gridOwnerDataRequestId)
    .select('id')
    .maybeSingle()
  if (error) throw error
  if (!data) throw new Error('ediel_post_send_grid_owner_data_request_projection_lost')
}

async function projectCustomerInfoRequest(params: {
  message: EdielMessageRow
  companyId: string
  sentAt: string
  actorUserId: string
}): Promise<void> {
  if (upper(params.message.message_family) !== 'PRODAT' || upper(params.message.message_code) !== 'Z01') return

  const db = tenantDb(params.companyId)
  const readQuery = asFilterQuery<{ id: string; status: string | null; sent_at: string | null }>(
    db.from('customer_info_requests').select('id,status,sent_at'),
  )
  const { data: rows, error: readError } = await readQuery
    .eq('ediel_message_id', params.message.id)
    .limit(2)
  if (readError) throw readError
  const matches = Array.isArray(rows) ? rows : []
  if (matches.length === 0) return
  if (matches.length > 1) throw new Error('ediel_post_send_customer_info_request_not_unique')

  const row = matches[0]
  const status = clean(row.status)
  const alreadySentAt = clean(row.sent_at)
  const preSendStatuses = new Set(['ready_to_send', 'z01_prepared', 'sent_to_grid_owner', 'sent', 'waiting_response'])
  const progressedStatuses = new Set([
    'waiting_for_contrl', 'waiting_for_aperak', 'waiting_for_z02', 'z02_received',
    'ready_for_switch', 'completed', 'negative_aperak', 'manual_review_required',
    'failed', 'cancelled', 'rejected',
  ])

  if (progressedStatuses.has(String(status))) {
    if (alreadySentAt) return
    const updateQuery = asFilterQuery<{ id: string }>(
      db.from('customer_info_requests').update({
        sent_at: params.sentAt,
        updated_by: params.actorUserId,
        updated_at: new Date().toISOString(),
      }),
    )
    const { data, error } = await updateQuery
      .eq('id', row.id)
      .select('id')
      .maybeSingle()
    if (error) throw error
    if (!data) throw new Error('ediel_post_send_customer_info_sent_at_projection_lost')
    return
  }

  if (!preSendStatuses.has(String(status))) {
    throw new Error(`ediel_post_send_customer_info_request_unexpected_${status ?? 'null'}`)
  }

  const nextStatus = customerInfoPostSendStatus(params.message)
  const updateQuery = asFilterQuery<{ id: string }>(
    db.from('customer_info_requests').update({
      status: nextStatus,
      sent_at: alreadySentAt ?? params.sentAt,
      blocker_code: null,
      blocker_reason: null,
      blocker_details: null,
      next_required_action: nextActionForCustomerInfo(nextStatus),
      updated_by: params.actorUserId,
      updated_at: new Date().toISOString(),
    }),
  )
  const { data, error } = await updateQuery
    .eq('id', row.id)
    .select('id')
    .maybeSingle()
  if (error) throw error
  if (!data) throw new Error('ediel_post_send_customer_info_projection_lost')
}

export async function projectSentEdielSourceState(params: {
  message: EdielMessageRow
  sentAt?: string | null
  actorUserId: string
}): Promise<void> {
  const companyId = clean(params.message.company_id)
  if (!companyId) throw new Error('ediel_post_send_company_scope_required')
  const sentAt = clean(params.sentAt) ?? clean(params.message.message_sent_at)
  if (!sentAt) throw new Error('ediel_post_send_timestamp_required')

  const outboundRequestId = clean(params.message.outbound_request_id)
  if (outboundRequestId) {
    await projectOutboundRequest({ companyId, outboundRequestId, sentAt, actorUserId: params.actorUserId })
  }

  const gridOwnerDataRequestId = clean(params.message.grid_owner_data_request_id)
  if (gridOwnerDataRequestId) {
    await projectGridOwnerDataRequest({ companyId, gridOwnerDataRequestId, sentAt, actorUserId: params.actorUserId })
  }

  await projectCustomerInfoRequest({
    message: params.message,
    companyId,
    sentAt,
    actorUserId: params.actorUserId,
  })
}
