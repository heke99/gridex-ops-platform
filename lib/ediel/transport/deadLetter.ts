import { supabaseService } from '@/lib/supabase/service'

function isSchemaCompatibilityError(error: unknown): boolean {
  const maybe = error as { code?: string; message?: string } | null
  return (
    maybe?.code === '42P01' ||
    maybe?.code === '42703' ||
    maybe?.code === 'PGRST204' ||
    maybe?.code === 'PGRST205' ||
    /does not exist|schema cache|column/i.test(maybe?.message ?? '')
  )
}

export async function createEdielDeadLetterItem(input: {
  companyId?: string | null
  environmentType?: string | null
  source: 'inbound_mail' | 'outbound_send' | 'parser' | 'decrypt' | 'tenant_resolver' | 'ack_engine' | string
  sourceTable?: string | null
  sourceId?: string | null
  edielMessageId?: string | null
  outboundQueueId?: string | null
  rawPayloadRef?: string | null
  errorCode: string
  errorMessage: string
  retryable?: boolean
  replayRequiresApproval?: boolean
  metadata?: Record<string, unknown>
  actorUserId?: string | null
}) {
  const { data, error } = await supabaseService
    .from('ediel_dead_letter_items')
    .insert({
      company_id: input.companyId ?? null,
      environment_type: input.environmentType ?? null,
      source: input.source,
      source_table: input.sourceTable ?? null,
      source_id: input.sourceId ?? null,
      ediel_message_id: input.edielMessageId ?? null,
      outbound_queue_id: input.outboundQueueId ?? null,
      raw_payload_ref: input.rawPayloadRef ?? null,
      error_code: input.errorCode,
      error_message: input.errorMessage,
      retryable: input.retryable ?? false,
      replay_requires_approval: input.replayRequiresApproval ?? false,
      status: 'open',
      metadata: input.metadata ?? {},
      created_by: input.actorUserId ?? null,
    })
    .select('*')
    .single()

  if (error) {
    if (isSchemaCompatibilityError(error)) return null
    throw error
  }

  return data
}

export async function markEdielDeadLetterResolved(input: {
  itemId: string
  actorUserId: string
  resolutionNotes?: string | null
}) {
  const { error } = await supabaseService
    .from('ediel_dead_letter_items')
    .update({
      status: 'resolved',
      resolved_by: input.actorUserId,
      resolved_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      metadata: {
        resolutionNotes: input.resolutionNotes ?? null,
      },
    })
    .eq('id', input.itemId)

  if (error && !isSchemaCompatibilityError(error)) throw error
}
