import { supabaseService } from '@/lib/supabase/service'

function normalizeErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message
  if (typeof error === 'string') return error
  if (error && typeof error === 'object') {
    const record = error as Record<string, unknown>
    const message = record.message ?? record.error_description ?? record.error
    const code = record.code ? ` · kod: ${String(record.code)}` : ''
    if (typeof message === 'string') return `${message}${code}`
  }
  return 'Okänt fel.'
}

/**
 * Compatibility cleanup for accounts created by the retired temporary-password
 * flow. New accounts are provisioned exclusively through verified Auth links.
 */
export async function clearTemporaryPasswordFlags(userId: string) {
  const { data, error } = await supabaseService.auth.admin.getUserById(userId)
  if (error) throw new Error(`Kunde inte läsa användare efter lösenordsbyte: ${normalizeErrorMessage(error)}`)

  const current = (data.user?.user_metadata ?? {}) as Record<string, unknown>
  const nextMetadata: Record<string, unknown> = {
    ...current,
    must_change_password: false,
    password_changed_at: new Date().toISOString(),
  }

  delete nextMetadata.temporary_password_set_at
  delete nextMetadata.temporary_password_set_by
  delete nextMetadata.temporary_password_company_id
  delete nextMetadata.temporary_password_company_name

  const update = await supabaseService.auth.admin.updateUserById(userId, {
    user_metadata: nextMetadata,
  })
  if (update.error) {
    throw new Error(`Kunde inte rensa äldre lösenordsflagga: ${normalizeErrorMessage(update.error)}`)
  }

  const profileUpdate = await supabaseService
    .from('user_profiles')
    .update({ must_change_password: false, password_changed_at: new Date().toISOString() })
    .eq('id', userId)
  if (profileUpdate.error && !['42P01', 'PGRST205', '42703'].includes(profileUpdate.error.code ?? '')) {
    throw new Error(`Kunde inte uppdatera user_profiles efter lösenordsbyte: ${normalizeErrorMessage(profileUpdate.error)}`)
  }
}
