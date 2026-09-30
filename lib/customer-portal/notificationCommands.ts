import 'server-only'
import { ApiInputError } from '@/lib/api/strictRequest'
import { supabaseService } from '@/lib/supabase/service'
import { PlatformSchemaNotReadyError } from '@/lib/platform/schemaReadiness'

/** Private service command. Its actor is supplied only by the verified adapter. */
export async function markCustomerNotificationsRead(input: {
  companyId: string
  customerId: string
  clientId: string
  subject: string
  idempotencyKey: string
  notificationReferences: string[]
}): Promise<{ statusCode: number; body: Record<string, unknown>; replayed: boolean }> {
  const { data, error } = await supabaseService.rpc(
    'gridex_mark_customer_notifications_read_v1',
    { p_command: input },
  )
  if (error) {
    const code = String(error.message ?? '')
    const missingCommand = ['42883', 'PGRST202'].includes(String(error.code)) &&
      /gridex_mark_customer_notifications_read_v1/.test(code)
    const missingReferenceColumn = ['42703', 'PGRST204'].includes(String(error.code)) &&
      /notification_reference/.test(code)
    if (missingCommand || missingReferenceColumn) {
      throw new PlatformSchemaNotReadyError('Notification mark-read command capability is missing.')
    }
    if (code === 'notification_reference_not_found') {
      throw new ApiInputError(
        'En eller flera notisreferenser hittades inte för kunden.', code, 404, 'notification_references',
      )
    }
    if (code === 'idempotency_conflict') {
      throw new ApiInputError('Idempotency-Key har redan använts med annan payload.', code, 409)
    }
    if (code === 'idempotency_previous_attempt_failed') {
      throw new ApiInputError(
        'Ett tidigare anrop med samma Idempotency-Key misslyckades. Kontrollera resursens status innan en ny nyckel används.',
        code, 409,
      )
    }
    if (code === 'idempotency_in_progress') {
      throw new ApiInputError('Ett identiskt anrop behandlas redan.', code, 409)
    }
    if (['notification_service_required', 'notification_delegation_forbidden',
      'notification_customer_unavailable', 'notification_tenant_unavailable'].includes(code)) {
      throw new ApiInputError('Ett giltigt och aktivt kundmandat krävs.', code, 403)
    }
    if (code === 'invalid_notification_command') {
      throw new ApiInputError('Förfrågan för notisläsning är ogiltig.', code, 422)
    }
    throw error
  }
  const result = data as Record<string, unknown> | null
  if (!result || !Number.isSafeInteger(result.statusCode) ||
      Number(result.statusCode) < 200 || Number(result.statusCode) > 599 ||
      !result.body || typeof result.body !== 'object' || Array.isArray(result.body) ||
      typeof result.replayed !== 'boolean') {
    throw new ApiInputError('Resultatet för notisläsning kunde inte verifieras.', 'notification_result_invalid', 503)
  }
  // In particular, preserve the exact body/status stored by completed legacy
  // claims. The RPC rechecks current authority before returning their result.
  return {
    statusCode: result.statusCode as number,
    body: result.body as Record<string, unknown>,
    replayed: result.replayed,
  }
}
