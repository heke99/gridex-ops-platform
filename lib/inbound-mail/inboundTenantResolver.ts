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

  const { data, error } = await supabaseService
    .from('ediel_actor_settings')
    .select('company_id')
    .eq('actor_ediel_id', receiver)
    .eq('is_active', true)
    .limit(5)

  if (error) throw error

  const candidates = unique((data ?? []).map((row: { company_id?: string | null }) => row.company_id))

  if (candidates.length === 1) {
    return {
      status: 'resolved',
      companyId: candidates[0],
      reasons: [`UNB receiver ${receiver} matchade aktiv aktörsinställning.`],
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
