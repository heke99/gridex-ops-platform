import { supabaseService } from '@/lib/supabase/service'

type AuthEmailAction =
  | 'invite_sent'
  | 'password_reset_sent'
  | 'confirmation_sent'
  | 'email_confirmed'
  | 'password_updated'
  | 'auth_callback_completed'
  | 'auth_callback_failed'

type OptionalDbError = {
  code?: string | null
  message?: string | null
}

const OPTIONAL_DB_ERROR_CODES = new Set(['42P01', '42703', 'PGRST200', 'PGRST204', 'PGRST205'])

function isOptionalDbError(error: OptionalDbError | null | undefined): boolean {
  if (!error) return false
  if (error.code && OPTIONAL_DB_ERROR_CODES.has(error.code)) return true
  const message = error.message ?? ''
  return /does not exist|Could not find|schema cache|column .* does not exist/i.test(message)
}

function metadataFullName(value: unknown): string | null {
  if (!value || typeof value !== 'object') return null
  const metadata = value as Record<string, unknown>
  const direct = metadata.full_name ?? metadata.name
  return typeof direct === 'string' && direct.trim() ? direct.trim() : null
}

export async function syncAuthUserToProfile(userId: string): Promise<void> {
  const { data, error } = await supabaseService.auth.admin.getUserById(userId)
  if (error || !data.user) return

  const user = data.user
  const now = new Date().toISOString()
  const emailConfirmedAt = user.email_confirmed_at ?? user.confirmed_at ?? null
  const fullName = metadataFullName(user.user_metadata)

  const payload = {
    id: user.id,
    email: user.email ?? null,
    full_name: fullName,
    auth_email_confirmed_at: emailConfirmedAt,
    auth_last_sign_in_at: user.last_sign_in_at ?? null,
    auth_last_synced_at: now,
    updated_at: now,
  }

  const full = await supabaseService
    .from('user_profiles')
    .upsert(payload, { onConflict: 'id' })

  if (!full.error) return
  if (!isOptionalDbError(full.error)) throw full.error

  const fallbackPayload = {
    id: user.id,
    email: user.email ?? null,
    full_name: fullName,
  }

  const fallback = await supabaseService
    .from('user_profiles')
    .upsert(fallbackPayload, { onConflict: 'id' })

  if (fallback.error && !isOptionalDbError(fallback.error)) {
    throw fallback.error
  }
}

export async function recordAuthEmailEvent(input: {
  userId?: string | null
  email?: string | null
  action: AuthEmailAction
  status?: 'sent' | 'completed' | 'failed'
  actorUserId?: string | null
  message?: string | null
  metadata?: Record<string, unknown>
}): Promise<void> {
  const now = new Date().toISOString()
  const status = input.status ?? 'sent'
  const userId = input.userId ?? null
  const email = input.email?.trim().toLowerCase() || null

  const insertEvent = await supabaseService.from('auth_email_events').insert({
    user_id: userId,
    email,
    action: input.action,
    status,
    actor_user_id: input.actorUserId ?? null,
    message: input.message ?? null,
    metadata: input.metadata ?? {},
  })

  if (insertEvent.error && !isOptionalDbError(insertEvent.error)) {
    throw insertEvent.error
  }

  if (!userId) return

  const profilePatch: Record<string, unknown> = {
    last_auth_email_action: input.action,
    last_auth_email_action_at: now,
    last_auth_email_action_by: input.actorUserId ?? null,
    last_auth_email_message: input.message ?? null,
    auth_last_synced_at: now,
    updated_at: now,
  }

  if (input.action === 'invite_sent') profilePatch.last_invite_sent_at = now
  if (input.action === 'password_reset_sent') profilePatch.last_password_reset_sent_at = now
  if (input.action === 'confirmation_sent') profilePatch.last_confirmation_email_sent_at = now
  if (input.action === 'email_confirmed') profilePatch.auth_email_confirmed_at = now

  const profileUpdate = await supabaseService
    .from('user_profiles')
    .update(profilePatch)
    .eq('id', userId)

  if (profileUpdate.error && !isOptionalDbError(profileUpdate.error)) {
    throw profileUpdate.error
  }
}
