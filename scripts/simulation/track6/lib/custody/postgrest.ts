// Tenantanvändare (authenticated) och direkta PostgREST-anrop (REST DELETE/PATCH) för skrivskyddsproven.
// Användarskapandet följer scripts/helpers/ediel-customer-record-retention-native-fixture.ts user() (GoTrue admin + medlemskap + explicita user_permissions).
import { randomUUID } from 'node:crypto'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { adminClient, lit, sql } from '../seed.mjs'
import { env } from './base'

export type TenantUser = { id: string; email: string; client: SupabaseClient; accessToken: string }

export async function createTenantUser(companyId: string, permissions: string[], membershipRole = 'member'): Promise<TenantUser> {
  const email = `${randomUUID()}@custody.t6.sim.invalid`, password = `${randomUUID()}Aa1!`
  const created = await adminClient().auth.admin.createUser({ email, password, email_confirm: true })
  if (created.error) throw created.error
  const id = created.data.user!.id
  sql(`INSERT INTO public.user_profiles(id,email,full_name,user_status) VALUES(${lit(id)},${lit(email)},'T6SIM custody actor (syntetisk)','active') ON CONFLICT(id) DO UPDATE SET user_status='active'`)
  sql(`INSERT INTO public.company_memberships(company_id,user_id,membership_role,status,accepted_at,metadata,role,is_active,joined_at,role_key) VALUES(${lit(companyId)},${lit(id)},${lit(membershipRole)},'active',now(),'{}','member',true,now(),'member')`)
  if (permissions.length) {
    sql(`INSERT INTO public.user_permissions(user_id,company_id,permission_id,permission_key) SELECT ${lit(id)},${lit(companyId)},id,key FROM public.permissions WHERE key=ANY(ARRAY[${permissions.map(lit).join(',')}]::text[])`)
  }
  const client = createClient(env('NEXT_PUBLIC_SUPABASE_URL'), env('NEXT_PUBLIC_SUPABASE_ANON_KEY'), { auth: { persistSession: false, autoRefreshToken: false } })
  const signed = await client.auth.signInWithPassword({ email, password })
  if (signed.error || !signed.data.session) throw signed.error ?? new Error('inloggning misslyckades')
  return { id, email, client, accessToken: signed.data.session.access_token }
}

export type RestResult = { status: number; rows: unknown[] | null; code: string | null; message: string | null; text: string }
/** PostgREST-anrop med given bearer. Prefer: return=representation visar vilka rader som faktiskt berördes. */
export async function rest(method: 'GET' | 'DELETE' | 'PATCH', table: string, filter: string, bearer: string, body?: unknown, schemaHeader?: string): Promise<RestResult> {
  const r = await fetch(`${env('NEXT_PUBLIC_SUPABASE_URL')}/rest/v1/${table}?${filter}`, {
    method,
    headers: {
      apikey: env('NEXT_PUBLIC_SUPABASE_ANON_KEY'), authorization: `Bearer ${bearer}`, prefer: 'return=representation', 'content-type': 'application/json',
      ...(schemaHeader ? { 'accept-profile': schemaHeader, 'content-profile': schemaHeader } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(60_000),
  })
  const text = await r.text()
  let parsed: unknown = null
  try { parsed = JSON.parse(text) } catch { /* ej JSON */ }
  const obj = parsed && !Array.isArray(parsed) && typeof parsed === 'object' ? (parsed as { code?: string; message?: string }) : null
  return { status: r.status, rows: Array.isArray(parsed) ? parsed : null, code: obj?.code ?? null, message: obj?.message ?? null, text: text.slice(0, 1000) }
}
