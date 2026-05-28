import { createClient, type User } from '@supabase/supabase-js'
import { supabaseService } from '@/lib/supabase/service'

export type ProvisionDirectTemporaryPasswordUserInput = {
  email: string
  fullName: string | null
  temporaryPassword: string
  companyId?: string | null
  companyName?: string | null
  actorUserId?: string | null
}

export type ProvisionDirectTemporaryPasswordUserResult = {
  userId: string
  email: string
  createdAuthUser: boolean
  passwordVerified: boolean
}

function normalizeEmail(value: string) {
  return value.trim().toLowerCase()
}

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

function assertTemporaryPassword(password: string) {
  if (!password || password.length < 8) {
    throw new Error('Temporärt lösenord krävs och måste vara minst 8 tecken.')
  }
}

export async function findAuthUserByEmail(email: string): Promise<User | null> {
  const normalized = normalizeEmail(email)

  for (let page = 1; page <= 20; page += 1) {
    const { data, error } = await supabaseService.auth.admin.listUsers({ page, perPage: 1000 })
    if (error) throw new Error(`Kunde inte läsa Supabase Auth-users: ${normalizeErrorMessage(error)}`)

    const user = (data.users ?? []).find((row) => (row.email ?? '').trim().toLowerCase() === normalized)
    if (user) return user
    if ((data.users ?? []).length < 1000) return null
  }

  throw new Error('Kunde inte hitta användaren eftersom Supabase Auth innehåller fler än 20 000 users. Lägg till en mer specifik lookup innan fler users skapas.')
}

function buildUserMetadata(input: ProvisionDirectTemporaryPasswordUserInput, existing?: User | null) {
  const current = (existing?.user_metadata ?? {}) as Record<string, unknown>
  const now = new Date().toISOString()

  return {
    ...current,
    ...(input.fullName ? { full_name: input.fullName } : {}),
    must_change_password: true,
    temporary_password_set_at: now,
    temporary_password_set_by: input.actorUserId ?? null,
    temporary_password_company_id: input.companyId ?? null,
    temporary_password_company_name: input.companyName ?? null,
    provisioned_by_gridex_admin: true,
  }
}

async function verifyPasswordWorks(email: string, password: string) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

  if (!supabaseUrl || !anonKey) {
    throw new Error('Supabase URL eller anon key saknas. Kan inte verifiera temporärt lösenord.')
  }

  const verifier = createClient(supabaseUrl, anonKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  })

  const { error } = await verifier.auth.signInWithPassword({ email, password })
  if (error) {
    throw new Error(`Supabase Auth-kontot skapades/uppdaterades, men det temporära lösenordet kunde inte verifieras: ${error.message}`)
  }

  await verifier.auth.signOut()
}

async function upsertUserProfile(input: {
  userId: string
  email: string
  fullName: string | null
  companyId?: string | null
}) {
  const now = new Date().toISOString()
  const fullPayload = {
    id: input.userId,
    email: input.email,
    full_name: input.fullName,
    user_status: 'active',
    active_company_id: input.companyId ?? null,
    must_change_password: true,
    temporary_password_set_at: now,
  }

  const minimalPayload = {
    id: input.userId,
    email: input.email,
    full_name: input.fullName,
  }

  const first = await supabaseService.from('user_profiles').upsert(fullPayload, { onConflict: 'id' })
  if (!first.error) return

  const firstMessage = normalizeErrorMessage(first.error)
  const shouldRetryMinimal =
    first.error.code === '42703' ||
    first.error.code === '23514' ||
    /must_change_password|temporary_password_set_at|active_company_id|user_status|last_auth_email_action|check constraint/i.test(firstMessage)

  if (!shouldRetryMinimal && !['42P01', 'PGRST205'].includes(first.error.code ?? '')) {
    throw new Error(`Kunde inte synka user_profiles: ${firstMessage}`)
  }

  const second = await supabaseService.from('user_profiles').upsert(minimalPayload, { onConflict: 'id' })
  if (second.error && !['42P01', 'PGRST205'].includes(second.error.code ?? '')) {
    throw new Error(`Kunde inte synka user_profiles: ${normalizeErrorMessage(second.error)}`)
  }
}

export async function provisionDirectTemporaryPasswordUser(
  input: ProvisionDirectTemporaryPasswordUserInput
): Promise<ProvisionDirectTemporaryPasswordUserResult> {
  const email = normalizeEmail(input.email)
  const temporaryPassword = String(input.temporaryPassword ?? '')
  assertTemporaryPassword(temporaryPassword)

  let existing = await findAuthUserByEmail(email)
  let createdAuthUser = false
  const metadata = buildUserMetadata({ ...input, email }, existing)

  if (!existing) {
    const { data, error } = await supabaseService.auth.admin.createUser({
      email,
      password: temporaryPassword,
      email_confirm: true,
      user_metadata: metadata,
    })

    if (error) {
      if (/already|registered|exists/i.test(error.message ?? '')) {
        existing = await findAuthUserByEmail(email)
      } else {
        throw new Error(`Kunde inte skapa Supabase Auth-konto: ${normalizeErrorMessage(error)}`)
      }
    } else if (data.user?.id) {
      existing = data.user
      createdAuthUser = true
    }
  }

  if (!existing?.id) {
    throw new Error(`Supabase Auth-konto kunde inte skapas eller hittas för ${email}.`)
  }

  let passwordVerified = false

  if (createdAuthUser) {
    const update = await supabaseService.auth.admin.updateUserById(existing.id, {
      password: temporaryPassword,
      email_confirm: true,
      user_metadata: buildUserMetadata({ ...input, email }, existing),
    })

    if (update.error) {
      throw new Error(`Kunde inte sätta temporärt lösenord i Supabase Auth: ${normalizeErrorMessage(update.error)}`)
    }

    await verifyPasswordWorks(email, temporaryPassword)
    passwordVerified = true
  } else {
    const update = await supabaseService.auth.admin.updateUserById(existing.id, {
      user_metadata: buildUserMetadata({ ...input, email }, existing),
    })

    if (update.error) {
      throw new Error(`Kunde inte uppdatera befintlig Supabase Auth-användare: ${normalizeErrorMessage(update.error)}`)
    }
  }

  await upsertUserProfile({
    userId: existing.id,
    email,
    fullName: input.fullName,
    companyId: input.companyId ?? null,
  })

  return {
    userId: existing.id,
    email,
    createdAuthUser,
    passwordVerified,
  }
}

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
    throw new Error(`Kunde inte rensa temporärt lösenordsflagga: ${normalizeErrorMessage(update.error)}`)
  }

  const profileUpdate = await supabaseService
    .from('user_profiles')
    .update({
      must_change_password: false,
      password_changed_at: new Date().toISOString(),
    })
    .eq('id', userId)

  if (profileUpdate.error && !['42P01', 'PGRST205', '42703'].includes(profileUpdate.error.code ?? '')) {
    throw new Error(`Kunde inte uppdatera user_profiles efter lösenordsbyte: ${normalizeErrorMessage(profileUpdate.error)}`)
  }
}
