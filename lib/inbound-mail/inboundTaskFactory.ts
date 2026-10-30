import { supabaseService } from '@/lib/supabase/service'

function cleanId(value?: string | null): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

type InboundMailTaskInput = Parameters<typeof createInboundMailTask>[0]

// A held duplicate/identity-conflict reception without a canonical customer is
// queued for operators in the tenant's EDIEL manual review queue instead of
// being dropped. Only references and hashes are copied; no meter values or
// personal data. Idempotent per (ediel_message_id, issue_type); an existing row
// is never overwritten, and a reception from another tenant is refused. The
// creation is audited in audit_logs (tenant-scoped, references only).
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function heldReviewFailure(code: string, companyId: string, detail?: unknown): Error {
  console.error('[inbound-mail] held_response_manual_review_failed', {
    code,
    companyId,
    dbCode: typeof (detail as { code?: unknown } | null)?.code === 'string' ? (detail as { code: string }).code : null,
  })
  return new Error(code)
}

// Failures throw so the inbound job is retried/failed visibly by the poller
// (edielMailboxPoller.part-2.ts per-job catch) instead of being dropped.
async function createHeldResponseManualReview(companyId: string, input: InboundMailTaskInput): Promise<void> {
  const reception = input.metadata?.reception as Record<string, unknown> | undefined
  const edielMessageId = cleanId(typeof reception?.sourceMessageId === 'string' ? reception.sourceMessageId : null)
  if (!reception || reception.companyId !== companyId) {
    throw heldReviewFailure('held_response_review_tenant_mismatch', companyId)
  }
  if (!edielMessageId || !UUID_RE.test(edielMessageId)) {
    throw heldReviewFailure('held_response_review_invalid_source_message_id', companyId)
  }
  const str = (value: unknown) => (typeof value === 'string' ? value : null)
  const issueType = 'inbound_duplicate_response_held'
  const { data, error } = await supabaseService.from('ediel_manual_review_items').upsert({
    company_id: companyId,
    ediel_message_id: edielMessageId,
    issue_type: issueType,
    title: input.title,
    description: input.description ?? input.title,
    status: 'open',
    payload: {
      inboundEmailMessageId: str(reception.inboundEmailMessageId),
      receptionId: str(reception.receptionId),
      parseResultId: str(reception.parseResultId),
      responseRequestId: str(reception.responseRequestId),
      classification: str(reception.classification),
      reason: str(reception.reason),
      protocolResponseFailureCode: str(input.metadata?.protocolResponseFailureCode),
      canonicalPayloadHash: str(reception.canonicalPayloadHash),
      receivedPayloadHash: str(reception.receivedPayloadHash),
    },
  }, { onConflict: 'ediel_message_id,issue_type', ignoreDuplicates: true }).select('id')
  if (error) throw heldReviewFailure('held_response_review_upsert_failed', companyId, error)

  // Audit only the actual creation; a duplicate (ignored) upsert returns no row.
  const created = ((data ?? []) as Array<{ id?: unknown }>)[0]
  if (!created || typeof created.id !== 'string') return
  const actorUserId = cleanId(input.actorUserId)
  const { error: auditError } = await supabaseService.from('audit_logs').insert({
    company_id: companyId,
    actor_user_id: actorUserId,
    entity_type: 'ediel_manual_review_item',
    entity_id: created.id,
    action: 'ediel_manual_review_item_created',
    new_values: { issue_type: issueType, ediel_message_id: edielMessageId, status: 'open' },
    metadata: {
      ...(actorUserId ? {} : { system_actor: 'inbound_mail_processor' }),
      responseRequestId: str(reception.responseRequestId),
      classification: str(reception.classification),
    },
  })
  if (auditError) throw heldReviewFailure('held_response_review_audit_failed', companyId, auditError)
}

export async function createInboundMailTask(input: {
  companyId?: string | null
  customerId?: string | null
  siteId?: string | null
  meteringPointId?: string | null
  title: string
  description?: string | null
  priority?: 'normal' | 'high' | 'urgent'
  taskType?: string | null
  metadata?: Record<string, unknown>
  actorUserId?: string | null
}): Promise<void> {
  const companyId = cleanId(input.companyId)
  if (!companyId) return

  // customer_operation_tasks is intentionally customer-scoped and customer_id
  // is NOT NULL. Unresolved EDIEL/routing issues belong in the EDIEL event and
  // unresolved-item audit streams until a canonical customer has been matched.
  const customerId = cleanId(input.customerId)
  if (!customerId && input.taskType === 'ediel_duplicate_response_held') {
    await createHeldResponseManualReview(companyId, input)
    return
  }
  if (!customerId) {
    console.warn('[inbound-mail] Skipping customer-scoped task because no canonical customer is resolved.', {
      companyId,
      taskType: input.taskType ?? 'inbound_ediel_mail_review',
      sourceId: typeof input.metadata?.sourceId === 'string' ? input.metadata.sourceId : null,
    })
    return
  }

  const taskType = input.taskType ?? 'inbound_ediel_mail_review'
  const sourceId = typeof input.metadata?.sourceId === 'string' ? input.metadata.sourceId : null

  if (sourceId) {
    const { count, error: existingError } = await supabaseService
      .from('customer_operation_tasks')
      .select('id', { count: 'exact', head: true })
      .eq('company_id', companyId)
      .eq('customer_id', customerId)
      .eq('task_type', taskType)
      .eq('status', 'open')
      .contains('metadata', { sourceId })

    if (!existingError && (count ?? 0) > 0) return
  }

  const { error } = await supabaseService.from('customer_operation_tasks').insert({
    company_id: companyId,
    customer_id: customerId,
    site_id: cleanId(input.siteId),
    metering_point_id: cleanId(input.meteringPointId),
    task_type: taskType,
    status: 'open',
    priority: input.priority ?? 'high',
    title: input.title,
    description: input.description ?? input.title,
    metadata: input.metadata ?? {},
    created_by: input.actorUserId ?? null,
    updated_by: input.actorUserId ?? null,
  })

  if (error) console.warn('[inbound-mail] Kunde inte skapa task', error)
}
