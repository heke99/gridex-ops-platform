import { supabaseService } from '@/lib/supabase/service'
import { isMissingRelationError } from '@/lib/tenant/scope'

export type EdielConfigRow = Record<string, unknown> & { id: string }

export type DuplicateActorSettingGroup = {
  environment: string
  role: string
  edielId: string | null
  actorSettingIds: string[]
}

export type CompanyActorConfiguration = {
  actors: EdielConfigRow[]
  brpSettings: EdielConfigRow[]
  routeProfiles: EdielConfigRow[]
  mailboxes: EdielConfigRow[]
  counterparties: EdielConfigRow[]
  messageRules: EdielConfigRow[]
  latestInboundAt: string | null
  latestOutboundAt: string | null
  unresolvedInboundCount: number
  // Admin-safe diagnostic: more than one ACTIVE actor setting for the same
  // company + environment + role (+ Ediel-ID). This is exactly what makes the
  // route decision engine fail closed with `ambiguous_sender_settings`.
  duplicateActiveActorSettings: DuplicateActorSettingGroup[]
}

/**
 * Detect duplicate ACTIVE actor settings per company+environment+role(+ediel id).
 * Pure function over already-fetched actor rows so it is cheap and testable.
 */
export function detectDuplicateActiveActorSettings(
  actors: EdielConfigRow[],
): DuplicateActorSettingGroup[] {
  const groups = new Map<string, DuplicateActorSettingGroup>()
  for (const row of actors) {
    if (row.is_active !== true) continue
    const environment = String(row.environment ?? '').trim().toLowerCase()
    const role = String(row.actor_role ?? row.role ?? '').trim().toLowerCase()
    const edielId = stringValue(row, 'ediel_id') ?? stringValue(row, 'actor_ediel_id')
    const key = `${environment}|${role}`
    const existing = groups.get(key)
    if (existing) {
      existing.actorSettingIds.push(row.id)
    } else {
      groups.set(key, { environment, role, edielId, actorSettingIds: [row.id] })
    }
  }
  return [...groups.values()].filter((group) => group.actorSettingIds.length > 1)
}

function stringValue(row: Record<string, unknown>, key: string): string | null {
  const value = row[key]
  return typeof value === 'string' && value.trim().length > 0 ? value : null
}

async function safeList(
  table: string,
  companyId: string,
  orderColumn = 'updated_at'
): Promise<EdielConfigRow[]> {
  try {
    let query = supabaseService
      .from(table)
      .select('*')
      .eq('company_id', companyId)
      .limit(50)

    query = query.order(orderColumn, { ascending: false })
    const { data, error } = await query
    if (error) {
      if (isMissingRelationError(error) || error.code === '42703') return []
      throw error
    }

    return ((data ?? []) as EdielConfigRow[])
  } catch (error) {
    if (isMissingRelationError(error)) return []
    throw error
  }
}

async function safeSharedMailboxes(): Promise<EdielConfigRow[]> {
  try {
    const { data, error } = await supabaseService
      .from('ediel_mailboxes')
      .select('*')
      .is('company_id', null)
      .eq('is_active', true)
      .limit(20)

    if (error) {
      if (isMissingRelationError(error) || error.code === '42703') return []
      throw error
    }

    return ((data ?? []) as EdielConfigRow[]).filter((row) => {
      const metadata = row.metadata
      if (!metadata || typeof metadata !== 'object') return true
      return (metadata as Record<string, unknown>).scope === 'platform_shared'
    })
  } catch (error) {
    if (isMissingRelationError(error)) return []
    throw error
  }
}

async function latestMessageAt(companyId: string, direction: 'inbound' | 'outbound'): Promise<string | null> {
  try {
    const { data, error } = await supabaseService
      .from('ediel_messages')
      .select('created_at,message_received_at,message_sent_at')
      .eq('company_id', companyId)
      .eq('direction', direction)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()

    if (error || !data) return null
    const row = data as Record<string, unknown>
    return stringValue(row, direction === 'inbound' ? 'message_received_at' : 'message_sent_at') ?? stringValue(row, 'created_at')
  } catch {
    return null
  }
}

async function unresolvedInboundCount(companyId: string): Promise<number> {
  try {
    const { count, error } = await supabaseService
      .from('ediel_unresolved_items')
      .select('id', { count: 'exact', head: true })
      .or(`company_id.eq.${companyId},company_id.is.null`)
      .in('status', ['open', 'manual_review'])

    if (error) return 0
    return count ?? 0
  } catch {
    return 0
  }
}

export async function getCompanyActorConfiguration(companyId: string): Promise<CompanyActorConfiguration> {
  const [actors, brpSettings, routeProfiles, sharedMailboxes, companyMailboxes, counterparties, messageRules, latestInbound, latestOutbound, unresolved] = await Promise.all([
    safeList('ediel_actor_settings', companyId),
    safeList('ediel_brp_settings', companyId),
    safeList('ediel_route_profiles', companyId),
    safeSharedMailboxes(),
    safeList('ediel_mailboxes', companyId),
    safeList('ediel_counterparties', companyId, 'created_at'),
    safeList('ediel_message_rules', companyId),
    latestMessageAt(companyId, 'inbound'),
    latestMessageAt(companyId, 'outbound'),
    unresolvedInboundCount(companyId),
  ])

  return {
    actors,
    brpSettings,
    routeProfiles,
    mailboxes: [...sharedMailboxes, ...companyMailboxes],
    counterparties,
    messageRules,
    latestInboundAt: latestInbound,
    latestOutboundAt: latestOutbound,
    unresolvedInboundCount: unresolved,
    duplicateActiveActorSettings: detectDuplicateActiveActorSettings(actors),
  }
}
