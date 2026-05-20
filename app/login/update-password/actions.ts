'use server'

import { redirect } from 'next/navigation'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { clearTemporaryPasswordFlags } from '@/lib/auth/directAccountProvisioning'

function normalizeNext(value: string) {
  const trimmed = value.trim()
  if (!trimmed) return '/dashboard'
  if (!trimmed.startsWith('/')) return '/dashboard'
  if (trimmed.startsWith('//')) return '/dashboard'
  return trimmed
}

export async function updatePasswordAction(formData: FormData) {
  const password = String(formData.get('password') ?? '')
  const confirmPassword = String(formData.get('confirmPassword') ?? '')
  const next = normalizeNext(String(formData.get('next') ?? '/dashboard'))

  if (password.length < 8) {
    redirect(
      `/login/update-password?error=${encodeURIComponent(
        'Lösenordet behöver vara minst 8 tecken.'
      )}&next=${encodeURIComponent(next)}`
    )
  }

  if (password !== confirmPassword) {
    redirect(
      `/login/update-password?error=${encodeURIComponent(
        'Lösenorden matchar inte.'
      )}&next=${encodeURIComponent(next)}`
    )
  }

  const supabase = await createSupabaseServerClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user?.id) {
    redirect(
      `/login/update-password?error=${encodeURIComponent(
        'Sessionen saknas. Logga in igen med det temporära lösenordet.'
      )}`
    )
  }

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

  const { error } = await supabase.auth.updateUser({
    password,
    data: nextMetadata,
  })

  if (error) {
    redirect(
      `/login/update-password?error=${encodeURIComponent(
        'Det gick inte att uppdatera lösenordet. Begär en ny återställningslänk och försök igen.'
      )}&next=${encodeURIComponent(next)}`
    )
  }

  try {
    await clearTemporaryPasswordFlags(user.id)
  } catch {
    // Auth-password is already changed. DB sync can be repaired by admin if optional profile columns are missing.
  }

  redirect(`${next}?message=${encodeURIComponent('Lösenordet är uppdaterat.')}`)
}
