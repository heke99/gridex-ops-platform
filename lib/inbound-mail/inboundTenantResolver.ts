import { supabaseService } from '@/lib/supabase/service'
import type { ParsedEdifactEnvelope } from '@/lib/inbound-mail/edielEmailParser'

export type InboundTenantResolution = {
  status: 'resolved' | 'unassigned' | 'ambiguous'
  companyId: string | null
  reasons: string[]
  candidates: string[]
}

function unique(values: Array<string | null | undefined>): string[] {
  return Array.from(new Set(values.filter((value): value is string => typeof value === 'string' && value.trim().length > 0)))
}

function pushUnique(target: string[], values: Array<string | null | undefined>) {
  for (const value of values) {
    if (typeof value !== 'string' || value.trim().length === 0) continue
    if (!target.includes(value)) target.push(value)
  }
}

async function actorSettingCandidates(receiver: string): Promise<string[]> {
  const candidates: string[] = []
  const legacy = await supabaseService
    .from('ediel_actor_settings')
    .select('company_id')
    .eq('actor_ediel_id', receiver)
    .eq('is_active', true)
    .limit(10)

  if (legacy.error) throw legacy.error
  pushUnique(candidates, (legacy.data ?? []).map((row: { company_id?: string | null }) => row.company_id))

  const canonical = await supabaseService
    .from('ediel_actor_settings')
    .select('company_id')
    .eq('ediel_id', receiver)
    .eq('is_active', true)
    .limit(10)

  if (canonical.error) throw canonical.error
  pushUnique(candidates, (canonical.data ?? []).map((row: { company_id?: string | null }) => row.company_id))
  return candidates
}

async function routeProfileCandidates(input: {
  receiver: string
  receiverSubAddress?: string | null
  applicationReference?: string | null
}): Promise<string[]> {
  const candidates: string[] = []
  const queries = [
    {
      subAddressColumn: 'own_subaddress',
      query: supabaseService
        .from('ediel_route_profiles')
        .select('company_id')
        .eq('own_ediel_id', input.receiver)
        .eq('is_enabled', true)
        .limit(10),
    },
    {
      subAddressColumn: 'receiver_sub_address',
      query: supabaseService
        .from('ediel_route_profiles')
        .select('company_id')
        .eq('receiver_ediel_id', input.receiver)
        .eq('is_enabled', true)
        .limit(10),
    },
  ]

  for (const item of queries) {
    if (input.receiverSubAddress) item.query.eq(item.subAddressColumn, input.receiverSubAddress)
    if (input.applicationReference) item.query.eq('application_reference', input.applicationReference)
    const { data, error } = await item.query
    if (error) throw error
    pushUnique(candidates, (data ?? []).map((row: { company_id?: string | null }) => row.company_id))
  }

  return candidates
}

export async function resolveTenantForInboundEdiel(input: {
  mailboxCompanyId?: string | null
  parsed: ParsedEdifactEnvelope
}): Promise<InboundTenantResolution> {
  if (input.mailboxCompanyId) {
    return {
      status: 'resolved',
      companyId: input.mailboxCompanyId,
      reasons: ['Mailbox är tenant-kopplad och vinner över svagare signaler.'],
      candidates: [input.mailboxCompanyId],
    }
  }

  const receiver = input.parsed.receiverEdielId
  if (!receiver) {
    return {
      status: 'unassigned',
      companyId: null,
      reasons: ['UNB receiver Ediel-id saknas.'],
      candidates: [],
    }
  }

  const candidates = unique([
    ...(await actorSettingCandidates(receiver)),
    ...(await routeProfileCandidates({
      receiver,
      receiverSubAddress: input.parsed.receiverSubAddress,
      applicationReference: input.parsed.applicationReference,
    })),
  ])

  if (candidates.length === 1) {
    return {
      status: 'resolved',
      companyId: candidates[0],
      reasons: [`UNB receiver ${receiver} matchade en aktiv tenant via aktörsinställning eller route-profil.`],
      candidates,
    }
  }

  if (candidates.length > 1) {
    return {
      status: 'ambiguous',
      companyId: null,
      reasons: [`UNB receiver ${receiver} matchade flera bolag. Ingen automatisk uppdatering görs.`],
      candidates,
    }
  }

  return {
    status: 'unassigned',
    companyId: null,
    reasons: [`UNB receiver ${receiver} kunde inte matchas till bolag.`],
    candidates: [],
  }
}
