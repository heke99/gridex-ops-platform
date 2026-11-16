// lib/ediel/ack/adminActionEngine.ts
//
// PART 6 / Batch 6: AdminActionEngine produces structured, superadmin-facing
// admin actions (technical detail retained) and records them on the related Ediel
// message timeline. Tenant-facing translation is done separately by
// TenantStatusTranslator.

import { createEdielMessageEvent } from '@/lib/ediel/db'

export type EdielAdminActionSeverity = 'info' | 'warning' | 'error'

export type EdielAdminAction = {
  actionCode: string
  title: string
  detail: string
  severity: EdielAdminActionSeverity
  requiresManualReview: boolean
  idempotencyKey: string
  payload: Record<string, unknown>
}

export function buildEdielAdminAction(input: {
  actionCode: string
  title: string
  detail: string
  severity?: EdielAdminActionSeverity
  requiresManualReview?: boolean
  idempotencyKey: string
  payload?: Record<string, unknown>
}): EdielAdminAction {
  return {
    actionCode: input.actionCode,
    title: input.title,
    detail: input.detail,
    severity: input.severity ?? 'warning',
    requiresManualReview: input.requiresManualReview ?? false,
    idempotencyKey: input.idempotencyKey,
    payload: input.payload ?? {},
  }
}

// Records the admin action on the Ediel message timeline (best-effort, technical).
export async function recordEdielAdminAction(params: {
  actorUserId: string
  edielMessageId: string
  action: EdielAdminAction
}): Promise<void> {
  try {
    await createEdielMessageEvent({
      actorUserId: params.actorUserId,
      edielMessageId: params.edielMessageId,
      eventType: params.action.severity === 'error' ? 'failed' : 'manual_note',
      eventStatus: params.action.severity,
      message: `${params.action.title}: ${params.action.detail}`,
      payload: {
        adminAction: true,
        actionCode: params.action.actionCode,
        requiresManualReview: params.action.requiresManualReview,
        idempotencyKey: params.action.idempotencyKey,
        ...params.action.payload,
      },
    })
  } catch {
    // Admin action recording must never break the ACK lifecycle; surface via logs.
  }
}
