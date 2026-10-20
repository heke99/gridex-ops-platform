// The tenant's balance responsible party (BRP) as chosen by Gridex staff at
// onboarding. It is picked from the imported Ediel actor registry, never typed
// as free text, and every change is a new dated version: earlier versions are
// closed, not overwritten, because Z03 field 262 binds the version that was
// valid on the supply start (FINDINGS F44).
import { verifyElRegistryActor } from '@/lib/actor-registry/registryMarketSource'
import { logAdminActionAndUsage } from '@/lib/audit/actionLogger'
import { recalculateCompanyOnboardingReadiness } from '@/lib/onboarding/companyReadiness'
import { supabaseService } from '@/lib/supabase/service'

export type RegistryBalanceResponsibleActor = {
  actorId: string
  name: string
  edielId: string
  verified: boolean
}

export type TenantBrpVersion = {
  id: string
  brpEdielId: string
  brpName: string
  validFrom: string | null
  validTo: string | null
  isDefault: boolean
  isActive: boolean
  platformActorId: string | null
}

export type SaveTenantBrpResult = { status: 'saved' | 'unchanged'; settingId: string; brpEdielId: string; validFrom: string }

type Row = Record<string, unknown>

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const DATE = /^\d{4}-\d{2}-\d{2}$/

function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function isEdielIdentifier(row: Row): boolean {
  return ['edielid', 'ediel_id'].includes(String(row.identifier_type ?? '').toLowerCase())
}

function validOn(row: Row, day: string): boolean {
  const from = text(row.valid_from)?.slice(0, 10) ?? null
  const to = text(row.valid_to)?.slice(0, 10) ?? null
  return (!from || from <= day) && (!to || to >= day)
}

function dayBefore(day: string): string {
  const date = new Date(`${day}T00:00:00Z`)
  date.setUTCDate(date.getUTCDate() - 1)
  return date.toISOString().slice(0, 10)
}

async function balanceResponsibleActors(actorIds: string[] | null, day: string): Promise<RegistryBalanceResponsibleActor[]> {
  let roles = supabaseService.from('platform_actor_roles').select('actor_id').eq('actor_role', 'balance_responsible').eq('is_active', true)
  if (actorIds) roles = roles.in('actor_id', actorIds)
  const roleRows = await roles.limit(1000)
  if (roleRows.error) throw roleRows.error
  const ids = [...new Set(((roleRows.data ?? []) as Row[]).map(row => String(row.actor_id)))]
  if (ids.length === 0) return []
  const [actors, identifiers] = await Promise.all([
    supabaseService.from('platform_market_actors').select('id,name,status,match_status').in('id', ids).eq('status', 'active'),
    supabaseService.from('platform_actor_identifiers').select('actor_id,identifier_type,identifier_value,is_verified,valid_from,valid_to').in('actor_id', ids),
  ])
  if (actors.error) throw actors.error
  if (identifiers.error) throw identifiers.error
  const ediel = ((identifiers.data ?? []) as Row[]).filter(row => isEdielIdentifier(row) && row.is_verified === true && validOn(row, day))
  // An Ediel ID shared by several registry actors, of any role, identifies none of them.
  const values = [...new Set(ediel.map(row => String(row.identifier_value)))]
  const sharing = values.length === 0 ? { data: [], error: null } : await supabaseService
    .from('platform_actor_identifiers').select('actor_id,identifier_type,identifier_value,is_verified,valid_from,valid_to').in('identifier_value', values)
  if (sharing.error) throw sharing.error
  const holders = new Map<string, Set<string>>()
  for (const row of ((sharing.data ?? []) as Row[]).filter(row => isEdielIdentifier(row) && row.is_verified === true && validOn(row, day))) {
    const value = String(row.identifier_value)
    holders.set(value, (holders.get(value) ?? new Set()).add(String(row.actor_id)))
  }
  const result: RegistryBalanceResponsibleActor[] = []
  for (const actor of (actors.data ?? []) as Row[]) {
    const own = [...new Set(ediel.filter(row => row.actor_id === actor.id).map(row => String(row.identifier_value)))]
    if (own.length !== 1 || holders.get(own[0])?.size !== 1) continue
    result.push({ actorId: String(actor.id), name: String(actor.name), edielId: own[0], verified: actor.match_status === 'verified' })
  }
  return result.sort((a, b) => a.name.localeCompare(b.name, 'sv'))
}

/** Balance responsible parties in the imported Ediel registry that can be chosen today. */
export async function listRegistryBalanceResponsibleActors(today = new Date().toISOString().slice(0, 10)) {
  return balanceResponsibleActors(null, today)
}

export async function listTenantBrpVersions(companyId: string, environment: 'test' | 'production' = 'production'): Promise<TenantBrpVersion[]> {
  const { data, error } = await supabaseService
    .from('ediel_brp_settings')
    .select('id,brp_ediel_id,brp_name,valid_from,valid_to,is_default,is_active,metadata')
    .eq('company_id', companyId)
    .eq('environment', environment)
    .order('valid_from', { ascending: false, nullsFirst: false })
    .limit(50)
  if (error) throw error
  return ((data ?? []) as Row[]).map(row => ({
    id: String(row.id),
    brpEdielId: String(row.brp_ediel_id),
    brpName: String(row.brp_name),
    validFrom: text(row.valid_from),
    validTo: text(row.valid_to),
    isDefault: row.is_default === true,
    isActive: row.is_active !== false,
    platformActorId: text((row.metadata as Row | null)?.platformActorId),
  }))
}

export async function saveTenantProductionBrp(input: { companyId: string; actorId: string; validFrom: string; actorUserId: string }): Promise<SaveTenantBrpResult> {
  if (!UUID.test(input.companyId)) throw new Error('Bolag saknas.')
  if (!UUID.test(input.actorId)) throw new Error('Välj balansansvarig ur Ediels aktörsregister.')
  if (!DATE.test(input.validFrom) || Number.isNaN(Date.parse(`${input.validFrom}T00:00:00Z`))) throw new Error('Ange från vilket datum BRP gäller (ÅÅÅÅ-MM-DD).')

  const company = await supabaseService.from('companies').select('id').eq('id', input.companyId).maybeSingle()
  if (company.error) throw company.error
  if (!company.data) throw new Error('Bolaget hittades inte.')

  const [actor] = await balanceResponsibleActors([input.actorId], input.validFrom)
  if (!actor) throw new Error('Aktören är inte en aktiv balansansvarig med ett entydigt verifierat Ediel-ID i aktörsregistret på valt datum.')
  if (!actor.verified) {
    try {
      await verifyElRegistryActor({ actorUserId: input.actorUserId, actorId: actor.actorId })
    } catch {
      throw new Error(`${actor.name} (${actor.edielId}) kunde inte verifieras automatiskt. Verifiera aktören i Ediel-aktörsregistret och välj den igen.`)
    }
  }

  const versions = (await listTenantBrpVersions(input.companyId)).filter(version => version.isActive)
  const current = versions.find(version => version.validTo === null && (!version.validFrom || version.validFrom <= input.validFrom))
  const laterVersion = versions.some(version => version.validFrom !== null && version.validFrom > input.validFrom)
  if (current && current.brpEdielId === actor.edielId && !laterVersion) {
    if (!current.isDefault) {
      const { error } = await supabaseService.from('ediel_brp_settings').update({ is_default: true, updated_by: input.actorUserId, updated_at: new Date().toISOString() }).eq('id', current.id)
      if (error) throw error
    }
    return { status: 'unchanged', settingId: current.id, brpEdielId: current.brpEdielId, validFrom: current.validFrom ?? input.validFrom }
  }
  const latestStart = versions.map(version => version.validFrom).filter((value): value is string => Boolean(value)).sort().at(-1)
  if (latestStart && latestStart >= input.validFrom) {
    throw new Error(`En BRP-version gäller redan från ${latestStart}. En ny version måste gälla från ett senare datum; historiken skrivs inte om.`)
  }

  const now = new Date().toISOString()
  const open = versions.filter(version => !version.validTo || version.validTo >= input.validFrom)
  if (open.length > 0) {
    const { error } = await supabaseService
      .from('ediel_brp_settings')
      .update({ valid_to: dayBefore(input.validFrom), is_default: false, updated_by: input.actorUserId, updated_at: now })
      .in('id', open.map(version => version.id))
    if (error) throw error
  }
  const { error: defaultError } = await supabaseService
    .from('ediel_brp_settings')
    .update({ is_default: false, updated_by: input.actorUserId, updated_at: now })
    .eq('company_id', input.companyId)
    .eq('environment', 'production')
    .eq('is_default', true)
  if (defaultError) throw defaultError

  const payload = {
    company_id: input.companyId,
    environment: 'production',
    brp_ediel_id: actor.edielId,
    brp_name: actor.name,
    is_default: true,
    is_active: true,
    valid_from: input.validFrom,
    valid_to: null,
    metadata: { source: 'actor_registry', platformActorId: actor.actorId, managedFrom: 'platform_go_live_brp_step' },
    created_by: input.actorUserId,
    updated_by: input.actorUserId,
  }
  const { data, error } = await supabaseService.from('ediel_brp_settings').insert(payload).select('id').single()
  if (error) throw error
  const settingId = String((data as Row).id)

  await logAdminActionAndUsage({
    companyId: input.companyId,
    actorUserId: input.actorUserId,
    entityType: 'ediel_brp_settings',
    entityId: settingId,
    action: 'tenant_brp_version_saved',
    label: 'Balansansvarig vald vid onboarding',
    oldValues: open.map(version => ({ id: version.id, brpEdielId: version.brpEdielId, validFrom: version.validFrom })),
    newValues: { brpEdielId: actor.edielId, brpName: actor.name, validFrom: input.validFrom, platformActorId: actor.actorId },
  })
  await recalculateCompanyOnboardingReadiness(input.companyId).catch(error =>
    console.warn('Company onboarding readiness recalculation failed', error),
  )
  return { status: 'saved', settingId, brpEdielId: actor.edielId, validFrom: input.validFrom }
}
