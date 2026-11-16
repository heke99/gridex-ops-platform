'use server'

import { redirect } from 'next/navigation'
import { clearTemporaryPasswordFlags } from '@/lib/auth/directAccountProvisioning'
import {
  UPDATE_PASSWORD_FAILED_MESSAGE,
  UPDATE_PASSWORD_MISMATCH_MESSAGE,
  UPDATE_PASSWORD_SESSION_MISSING_MESSAGE,
  UPDATE_PASSWORD_SUCCESS_MESSAGE,
  UPDATE_PASSWORD_TOO_SHORT_MESSAGE,
} from '@/lib/auth/loginError'
import { getSafeNextPath } from '@/lib/auth/urls'
import { createSupabaseServerClient } from '@/lib/supabase/server'

export async function updatePasswordAction(formData: FormData) {
  const password = String(formData.get('password') ?? '')
  const confirmPassword = String(formData.get('confirmPassword') ?? '')
  const next = getSafeNextPath(String(formData.get('next') ?? '/dashboard'))

  if (password.length < 8) {
    redirect(
      `/login/update-password?error=${encodeURIComponent(
        UPDATE_PASSWORD_TOO_SHORT_MESSAGE
      )}&next=${encodeURIComponent(next)}`
    )
  }

  if (password !== confirmPassword) {
    redirect(
      `/login/update-password?error=${encodeURIComponent(
        UPDATE_PASSWORD_MISMATCH_MESSAGE
      )}&next=${encodeURIComponent(next)}`
    )
  }

  const authResult = await (async () => {
    try {
      const supabase = await createSupabaseServerClient()
      const {
        data: { user },
      } = await supabase.auth.getUser()
      return { supabase, user }
    } catch {
      return null
    }
  })()

  const user = authResult?.user
  if (!authResult || !user?.id) {
    redirect(
      `/login/update-password?error=${encodeURIComponent(
        UPDATE_PASSWORD_SESSION_MISSING_MESSAGE
      )}`
    )
  }

  const { supabase } = authResult

  const currentMetadata = (user.user_metadata ?? {}) as Record<string, unknown>
  const nextMetadata: Record<string, unknown> = {
    ...currentMetadata,
    must_change_password: false,
    password_changed_at: new Date().toISOString(),
  }

  delete nextMetadata.temporary_password_set_at
  delete nextMetadata.temporary_password_set_by
  delete nextMetadata.temporary_password_company_id
  delete nextMetadata.temporary_password_company_name

  let updateError: unknown = null
  try {
    const result = await supabase.auth.updateUser({
      password,
      data: nextMetadata,
    })
    updateError = result.error
  } catch {
    updateError = new Error('auth_update_unavailable')
  }

  if (updateError) {
    redirect(
      `/login/update-password?error=${encodeURIComponent(
        UPDATE_PASSWORD_FAILED_MESSAGE
      )}&next=${encodeURIComponent(next)}`
    )
  }

  try {
    await clearTemporaryPasswordFlags(user.id)
  } catch {
    // Auth-password is already changed. DB sync can be repaired by admin if optional profile columns are missing.
  }

  const destination = new URL(next, 'http://localhost')
  destination.searchParams.set('message', UPDATE_PASSWORD_SUCCESS_MESSAGE)
  redirect(`${destination.pathname}${destination.search}`)
}
