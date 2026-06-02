import { supabaseService } from '@/lib/supabase/service'
import type { ParsedEdifactEnvelope } from '@/lib/inbound-mail/edielEmailParser'

export type InboundTenantResolution = {
  status: 'resolved' | 'unassigned' | 'ambiguous'
  companyId: string | null
  reasons: string[]
  candidates: string[]
}

type TenantCandidateEvidence = {
  companyId: string
  source: 'ediel_actor_settings' | 'ediel_route_profiles'
  score: number
  details: Record<string, unknown>
}

function unique(values: Array<string | null | undefined>): string[] {
  return Array.from(new Set(values.filter((value): value is string => typeof value === 'string' && value.trim().length > 0)))
}

function clean(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null
}

function upper(value: unknown): string {
  return String(value ?? '').trim().toUpperCase()
}

function configuredValueMatches(configured: unknown, observed: unknown): boolean {
  const configuredValue = upper(configured)
  if (!configuredValue) return true
  const observedValue = upper(observed)
  if (!observedValue) return true
  return configuredValue === observedValue
}

function configuredSubaddressMatches(params: {
  configured: unknown
  observed: unknown
  required?: unknown
}): boolean {
  const configuredValue = upper(params.configured)
  const observedValue = upper(params.observed)
  const required = params.required === true

  if (required && !observedValue) return false
  if (!configuredValue || !observedValue) return true
  return configuredValue === observedValue
}

function bestCandidateEvidence(evidence: TenantCandidateEvidence[]): TenantCandidateEvidence[] {
  const byCompany = new Map<string, TenantCandidateEvidence>()

  for (const item of evidence) {
    const current = byCompany.get(item.companyId)
    if (!current || item.score > current.score) byCompany.set(item.companyId, item)
  }

  return [...byCompany.values()].sort((a, b) => b.score - a.score)
}

async function actorSettingEvidence(input: {
  receiver: string
  receiverSubAddress?: string | null
  applicationReference?: string | null
  environment: string
}): Promise<TenantCandidateEvidence[]> {
  const { data, error } = await supabaseService
    .from('ediel_actor_settings')
    .select('id,company_id,ediel_id,actor_ediel_id,receiver_subaddress,receiver_sub_address,sender_subaddress,sender_sub_address,receiver_message_subaddress,subaddress_required,application_reference,default_application_reference,is_active')
    .eq('environment', input.environment)
    .limit(1000)

  if (error) throw error

  const receiver = upper(input.receiver)
  const receiverSubAddress = upper(input.receiverSubAddress)
  const applicationReference = upper(input.applicationReference)

  return ((data ?? []) as Array<Record<string, unknown>>).flatMap((row) => {
    const companyId = clean(row.company_id)
    if (!companyId || row.is_active === false) return []

    const actorIds = [row.ediel_id, row.actor_ediel_id].map(upper).filter(Boolean)
    if (!actorIds.includes(receiver)) return []

    const actorSubAddress =
      row.receiver_message_subaddress ??
      row.receiver_subaddress ??
      row.receiver_sub_address ??
      row.sender_subaddress ??
      row.sender_sub_address
    const actorApplicationReference = row.application_reference ?? row.default_application_reference
    if (!configuredSubaddressMatches({
      configured: actorSubAddress,
      observed: receiverSubAddress,
      required: row.subaddress_required,
    })) return []
    if (!configuredValueMatches(actorApplicationReference, applicationReference)) return []

    let score = 70
    if (upper(actorSubAddress) && receiverSubAddress) score += 20
    if (upper(actorApplicationReference) && applicationReference) score += 10

    return [{
      companyId,
      source: 'ediel_actor_settings',
      score,
      details: {
        actorSettingId: row.id,
        environment: input.environment,
        receiverEdielId: input.receiver,
        receiverSubAddress: input.receiverSubAddress ?? null,
        applicationReference: input.applicationReference ?? null,
      },
    }]
  })
}

async function routeProfileEvidence(input: {
  receiver: string
  receiverSubAddress?: string | null
  applicationReference?: string | null
  messageFamily?: string | null
  messageCode?: string | null
  environment: string
}): Promise<TenantCandidateEvidence[]> {
  const { data, error } = await supabaseService
    .from('ediel_route_profiles')
    .select('id,company_id,own_ediel_id,own_subaddress,receiver_ediel_id,receiver_sub_address,receiver_subaddress,receiver_message_subaddress,subaddress_required,application_reference,message_family,message_code,is_active,is_enabled')
    .eq('environment', input.environment)
    .limit(1000)

  if (error) throw error

  const receiver = upper(input.receiver)
  const receiverSubAddress = upper(input.receiverSubAddress)
  const applicationReference = upper(input.applicationReference)
  const messageFamily = upper(input.messageFamily)
  const messageCode = upper(input.messageCode)

  return ((data ?? []) as Array<Record<string, unknown>>).flatMap((row) => {
    const companyId = clean(row.company_id)
    if (!companyId || row.is_active === false || row.is_enabled === false) return []

    const ownEdielId = upper(row.own_ediel_id)
    const legacyReceiverEdielId = upper(row.receiver_ediel_id)
    const matchedProfileKey = ownEdielId === receiver
      ? 'own_ediel_id'
      : legacyReceiverEdielId === receiver
        ? 'receiver_ediel_id'
        : null
    if (!matchedProfileKey) return []

    const profileSubAddress = matchedProfileKey === 'own_ediel_id'
      ? row.own_subaddress ?? row.receiver_message_subaddress
      : row.receiver_message_subaddress ?? row.receiver_sub_address ?? row.receiver_subaddress
    if (!configuredSubaddressMatches({
      configured: profileSubAddress,
      observed: receiverSubAddress,
      required: row.subaddress_required,
    })) return []
    if (!configuredValueMatches(row.application_reference, applicationReference)) return []
    if (!configuredValueMatches(row.message_family, messageFamily)) return []
    if (!configuredValueMatches(row.message_code, messageCode)) return []

    let score = 100
    if (upper(profileSubAddress) && receiverSubAddress) score += 40
    if (upper(row.application_reference) && applicationReference) score += 35
    if (upper(row.message_family) && messageFamily) score += 15
    if (upper(row.message_code) && messageCode) score += 10

    return [{
      companyId,
      source: 'ediel_route_profiles',
      score,
      details: {
        routeProfileId: row.id,
        matchedProfileKey,
        environment: input.environment,
        receiverEdielId: input.receiver,
        receiverSubAddress: input.receiverSubAddress ?? null,
        applicationReference: input.applicationReference ?? null,
        messageFamily: input.messageFamily ?? null,
        messageCode: input.messageCode ?? null,
      },
    }]
  })
}

export async function resolveTenantForInboundEdiel(input: {
  mailboxCompanyId?: string | null
  environment?: string | null
  parsed: ParsedEdifactEnvelope
}): Promise<InboundTenantResolution> {
  // Mailbox is only transport. Tenant identity must come from the EDIFACT UNB
  // receiver matched against configured ediel_actor_settings for the same
  // environment. A company_id on the mailbox is treated as weak evidence only,
  // never as an automatic tenant assignment.
  const mailboxCompanyId = clean(input.mailboxCompanyId)
  const receiver = input.parsed.receiverEdielId
  const environment = clean(input.environment)
  if (!receiver) {
    return {
      status: 'unassigned',
      companyId: null,
      reasons: ['UNB receiver Ediel-id saknas.'],
      candidates: [],
    }
  }
  if (!environment) {
    return {
      status: 'unassigned',
      companyId: null,
      reasons: ['Mailbox-miljö saknas. Tenant-matchning utan miljö blockeras.'],
      candidates: [],
    }
  }

  const evidence = bestCandidateEvidence([
    ...(await actorSettingEvidence({
      receiver,
      receiverSubAddress: input.parsed.receiverSubAddress,
      applicationReference: input.parsed.applicationReference,
      environment,
    })),
    ...(await routeProfileEvidence({
      receiver,
      receiverSubAddress: input.parsed.receiverSubAddress,
      applicationReference: input.parsed.applicationReference,
      messageFamily: input.parsed.messageFamily,
      messageCode: input.parsed.messageCode,
      environment,
    })),
  ])
  const topScore = evidence[0]?.score ?? 0
  const topCandidates = evidence.filter((item) => item.score === topScore)
  const candidates = unique(evidence.map((item) => item.companyId))

  if (topCandidates.length === 1) {
    const resolvedCompanyId = topCandidates[0].companyId

    if (mailboxCompanyId && mailboxCompanyId !== resolvedCompanyId) {
      return {
        status: 'ambiguous',
        companyId: null,
        reasons: [
          `Mailboxen är kopplad till ${mailboxCompanyId}, men UNB receiver ${receiver} matchade ${resolvedCompanyId} i ${environment}. Mailbox får inte override:a EDIFACT-tenant.`,
        ],
        candidates: unique([mailboxCompanyId, ...candidates]),
      }
    }

    return {
      status: 'resolved',
      companyId: resolvedCompanyId,
      reasons: [
        `UNB receiver ${receiver} matchade tenant i ${environment} via ${topCandidates[0].source}.`,
      ],
      candidates: unique([mailboxCompanyId, ...candidates]),
    }
  }

  if (topCandidates.length > 1) {
    return {
      status: 'ambiguous',
      companyId: null,
      reasons: [`UNB receiver ${receiver} matchade flera bolag i ${environment} med samma routingstyrka. Ingen automatisk uppdatering görs.`],
      candidates,
    }
  }

  return {
    status: 'unassigned',
    companyId: null,
    reasons: [
      `UNB receiver ${receiver} kunde inte matchas till bolag i ${environment}.`,
      ...(mailboxCompanyId ? ['Mailboxens company_id används inte som fallback utan verifierad UNB-match.'] : []),
    ],
    candidates: mailboxCompanyId ? [mailboxCompanyId] : [],
  }
}
