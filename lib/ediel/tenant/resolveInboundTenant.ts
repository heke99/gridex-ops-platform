import { supabaseService } from '@/lib/supabase/service'

export type InboundTenantResolutionStatus = 'resolved' | 'ambiguous' | 'unresolved'

export type InboundTenantResolutionSource =
  | 'existing_message_company_id'
  | 'ediel_actor_settings'
  | 'ediel_route_profiles'
  | 'transport_route'
  | 'ediel_business_references'
  | 'manual'

export type InboundTenantEvidence = {
  companyId: string
  source: InboundTenantResolutionSource
  score: number
  details: Record<string, unknown>
}

export type InboundTenantResolution = {
  status: InboundTenantResolutionStatus
  companyId: string | null
  transportEdielId: string | null
  marketActorEdielId: string | null
  receiverEdielId: string | null
  receiverSubaddress: string | null
  source: InboundTenantResolutionSource | null
  confidence: number
  evidence: InboundTenantEvidence[]
  reasons: string[]
  candidateCompanyIds: string[]
  warnings: string[]
}

export type ResolveInboundTenantInput = {
  existingCompanyId?: string | null
  mailboxCompanyId?: string | null
  communicationRouteId?: string | null
  environment?: string | null
  senderEdielId?: string | null
  senderSubaddress?: string | null
  receiverEdielId?: string | null
  receiverSubaddress?: string | null
  marketActorEdielId?: string | null
  applicationReference?: string | null
  messageFamily?: string | null
  messageCode?: string | null
  mailboxId?: string | null
  mailbox?: string | null
  referenceCandidates?: string[]
}

function clean(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

function upper(value: unknown): string {
  return String(value ?? '').trim().toUpperCase()
}

function unique(values: Array<string | null | undefined>): string[] {
  return Array.from(new Set(values.filter((value): value is string => Boolean(clean(value)))))
}

function configuredMatches(configured: unknown, observed: unknown): boolean {
  const configuredValue = upper(configured)
  const observedValue = upper(observed)
  if (!configuredValue || !observedValue) return true
  return configuredValue === observedValue
}

function subaddressMatches(params: {
  configured: unknown
  observed: unknown
  required?: unknown
}): boolean {
  const configured = upper(params.configured)
  const observed = upper(params.observed)
  const required = params.required === true

  if (required && !observed) return false
  if (!configured || !observed) return true
  return configured === observed
}

function firstParty(rawPayload: string | null | undefined, qualifier: string): string | null {
  const raw = String(rawPayload ?? '')
  const escaped = qualifier.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const regex = new RegExp(`(?:^|')NAD\\+${escaped}\\+([^:+']+)`, 'i')
  return clean(raw.match(regex)?.[1] ?? null)
}

export function extractMarketActorEdielIdFromRawPayload(rawPayload: string | null | undefined): string | null {
  return (
    firstParty(rawPayload, 'DO') ??
    firstParty(rawPayload, 'DDQ') ??
    firstParty(rawPayload, 'MR') ??
    firstParty(rawPayload, 'MS') ??
    null
  )
}

function normalizeInput(input: ResolveInboundTenantInput) {
  const receiverEdielId = clean(input.receiverEdielId)
  const marketActorEdielId = clean(input.marketActorEdielId) ?? receiverEdielId
  return {
    existingCompanyId: clean(input.existingCompanyId),
    mailboxCompanyId: clean(input.mailboxCompanyId),
    communicationRouteId: clean(input.communicationRouteId),
    environment: clean(input.environment),
    senderEdielId: clean(input.senderEdielId),
    senderSubaddress: clean(input.senderSubaddress),
    receiverEdielId,
    receiverSubaddress: clean(input.receiverSubaddress),
    transportEdielId: receiverEdielId,
    marketActorEdielId,
    applicationReference: clean(input.applicationReference),
    messageFamily: clean(input.messageFamily),
    messageCode: clean(input.messageCode),
    mailboxId: clean(input.mailboxId),
    mailbox: clean(input.mailbox),
    referenceCandidates: unique(input.referenceCandidates ?? []),
  }
}

async function evidenceFromCommunicationRoute(input: ReturnType<typeof normalizeInput>): Promise<InboundTenantEvidence[]> {
  if (!input.communicationRouteId) return []

  const { data, error } = await supabaseService
    .from('communication_routes')
    .select('id,company_id,route_name,route_scope')
    .eq('id', input.communicationRouteId)
    .maybeSingle()

  if (error) throw error
  const row = data as Record<string, unknown> | null
  const companyId = clean(row?.company_id)
  if (!companyId) return []

  return [{
    companyId,
    source: 'transport_route',
    score: 200,
    details: {
      communicationRouteId: input.communicationRouteId,
      routeName: row?.route_name ?? null,
      routeScope: row?.route_scope ?? null,
    },
  }]
}

async function evidenceFromActorSettings(input: ReturnType<typeof normalizeInput>): Promise<InboundTenantEvidence[]> {
  if (!input.environment || (!input.receiverEdielId && !input.marketActorEdielId)) return []

  const { data, error } = await supabaseService
    .from('ediel_actor_settings')
    .select('id,company_id,ediel_id,actor_ediel_id,receiver_subaddress,receiver_sub_address,sender_subaddress,sender_sub_address,receiver_message_subaddress,subaddress_required,application_reference,default_application_reference,is_active,environment')
    .eq('environment', input.environment)
    .limit(1000)

  if (error) throw error

  const receiver = upper(input.receiverEdielId)
  const marketActor = upper(input.marketActorEdielId)
  const receiverSub = upper(input.receiverSubaddress)
  const applicationReference = upper(input.applicationReference)

  return ((data ?? []) as Array<Record<string, unknown>>).flatMap((row) => {
    const companyId = clean(row.company_id)
    if (!companyId || row.is_active === false) return []

    const actorIds = [row.ediel_id, row.actor_ediel_id].map(upper).filter(Boolean)
    const matchedTransport = Boolean(receiver && actorIds.includes(receiver))
    const matchedMarketActor = Boolean(marketActor && actorIds.includes(marketActor))
    if (!matchedTransport && !matchedMarketActor) return []

    const configuredSubaddress =
      row.receiver_message_subaddress ??
      row.receiver_subaddress ??
      row.receiver_sub_address ??
      row.sender_subaddress ??
      row.sender_sub_address

    if (!subaddressMatches({
      configured: configuredSubaddress,
      observed: input.receiverSubaddress,
      required: row.subaddress_required,
    })) return []

    const configuredApplicationReference = row.application_reference ?? row.default_application_reference
    if (!configuredMatches(configuredApplicationReference, applicationReference)) return []

    let score = matchedMarketActor ? 120 : 80
    if (matchedTransport) score += 20
    if (upper(configuredSubaddress) && receiverSub) score += 20
    if (upper(configuredApplicationReference) && applicationReference) score += 10

    return [{
      companyId,
      source: 'ediel_actor_settings',
      score,
      details: {
        actorSettingId: row.id,
        matchedTransport,
        matchedMarketActor,
        subaddressRequired: row.subaddress_required === true,
        transportEdielId: input.transportEdielId,
        marketActorEdielId: input.marketActorEdielId,
        receiverEdielId: input.receiverEdielId,
        receiverSubaddress: input.receiverSubaddress,
        applicationReference: input.applicationReference,
      },
    }]
  })
}

async function evidenceFromRouteProfiles(input: ReturnType<typeof normalizeInput>): Promise<InboundTenantEvidence[]> {
  if (!input.environment || (!input.receiverEdielId && !input.marketActorEdielId)) return []

  let query = supabaseService
    .from('ediel_route_profiles')
    .select('id,company_id,mailbox_id,mailbox,own_ediel_id,own_subaddress,counterparty_ediel_id,counterparty_subaddress,sender_ediel_id,sender_subaddress,sender_sub_address,receiver_ediel_id,receiver_subaddress,receiver_sub_address,receiver_message_subaddress,subaddress_required,application_reference,message_family,message_code,business_code,is_active,is_enabled,environment')
    .eq('environment', input.environment)

  if (input.mailboxId) query = query.eq('mailbox_id', input.mailboxId)

  const { data, error } = await query.limit(1000)
  if (error) throw error

  const receiver = upper(input.receiverEdielId)
  const marketActor = upper(input.marketActorEdielId)
  const sender = upper(input.senderEdielId)
  const receiverSub = upper(input.receiverSubaddress)
  const senderSub = upper(input.senderSubaddress)
  const applicationReference = upper(input.applicationReference)
  const messageFamily = upper(input.messageFamily)
  const messageCode = upper(input.messageCode)

  return ((data ?? []) as Array<Record<string, unknown>>).flatMap((row) => {
    const companyId = clean(row.company_id)
    if (!companyId || row.is_active === false || row.is_enabled === false) return []

    const ownIds = [row.own_ediel_id, row.receiver_ediel_id].map(upper).filter(Boolean)
    const matchedTransport = Boolean(receiver && ownIds.includes(receiver))
    const matchedMarketActor = Boolean(marketActor && ownIds.includes(marketActor))
    if (!matchedTransport && !matchedMarketActor) return []

    const counterpartyIds = [row.counterparty_ediel_id, row.sender_ediel_id].map(upper).filter(Boolean)
    if (counterpartyIds.length > 0 && sender && !counterpartyIds.includes(sender)) return []

    const configuredReceiverSub = matchedMarketActor
      ? row.own_subaddress ?? row.receiver_message_subaddress ?? row.receiver_subaddress ?? row.receiver_sub_address
      : row.receiver_message_subaddress ?? row.own_subaddress ?? row.receiver_subaddress ?? row.receiver_sub_address
    if (!subaddressMatches({
      configured: configuredReceiverSub,
      observed: input.receiverSubaddress,
      required: row.subaddress_required,
    })) return []

    const configuredSenderSub = row.counterparty_subaddress ?? row.sender_subaddress ?? row.sender_sub_address
    if (!subaddressMatches({
      configured: configuredSenderSub,
      observed: input.senderSubaddress,
      required: false,
    })) return []

    if (!configuredMatches(row.application_reference, applicationReference)) return []
    if (!configuredMatches(row.message_family, messageFamily)) return []
    if (!configuredMatches(row.business_code ?? row.message_code, messageCode)) return []

    let score = matchedMarketActor ? 140 : 100
    if (matchedTransport) score += 20
    if (upper(configuredReceiverSub) && receiverSub) score += 40
    if (upper(configuredSenderSub) && senderSub) score += 15
    if (upper(row.application_reference) && applicationReference) score += 35
    if (upper(row.message_family) && messageFamily) score += 15
    if (upper(row.business_code ?? row.message_code) && messageCode) score += 10
    if (input.mailbox && clean(row.mailbox) === input.mailbox) score += 20

    return [{
      companyId,
      source: 'ediel_route_profiles',
      score,
      details: {
        routeProfileId: row.id,
        matchedTransport,
        matchedMarketActor,
        subaddressRequired: row.subaddress_required === true,
        transportEdielId: input.transportEdielId,
        marketActorEdielId: input.marketActorEdielId,
        receiverEdielId: input.receiverEdielId,
        receiverSubaddress: input.receiverSubaddress,
        applicationReference: input.applicationReference,
        messageFamily: input.messageFamily,
        messageCode: input.messageCode,
      },
    }]
  })
}

function compactEvidence(evidence: InboundTenantEvidence[]): InboundTenantEvidence[] {
  const byKey = new Map<string, InboundTenantEvidence>()

  for (const item of evidence) {
    const key = `${item.companyId}:${item.source}:${JSON.stringify(item.details)}`
    const current = byKey.get(key)
    if (!current || item.score > current.score) byKey.set(key, item)
  }

  return [...byKey.values()].sort((a, b) => b.score - a.score)
}

function resolutionFromEvidence(params: {
  input: ReturnType<typeof normalizeInput>
  evidence: InboundTenantEvidence[]
}): InboundTenantResolution {
  const evidence = compactEvidence(params.evidence)
  const topScore = evidence[0]?.score ?? 0
  const top = evidence.filter((item) => item.score === topScore)
  const topCompanyIds = unique(top.map((item) => item.companyId))
  const candidateCompanyIds = unique(evidence.map((item) => item.companyId))
  const warnings: string[] = []

  if (top.length > 1 && topCompanyIds.length === 1) {
    warnings.push('Flera tenant-träffar hittades med samma bolag. Systemet valde deterministiskt starkaste aktiva match och loggar detta som varning, inte som stopp.')
  }

  if (topCompanyIds.length === 1) {
    const companyId = topCompanyIds[0]
    if (params.input.mailboxCompanyId && params.input.mailboxCompanyId !== companyId) {
      return {
        status: 'ambiguous',
        companyId: null,
        transportEdielId: params.input.transportEdielId,
        marketActorEdielId: params.input.marketActorEdielId,
        receiverEdielId: params.input.receiverEdielId,
        receiverSubaddress: params.input.receiverSubaddress,
        source: top[0]?.source ?? null,
        confidence: topScore,
        evidence,
        reasons: [
          `Mailboxen är kopplad till ${params.input.mailboxCompanyId}, men EDIFACT-routing matchade ${companyId}. Mailboxen får inte override:a EDIFACT-tenant.`,
        ],
        candidateCompanyIds: unique([params.input.mailboxCompanyId, ...candidateCompanyIds]),
        warnings,
      }
    }

    return {
      status: 'resolved',
      companyId,
      transportEdielId: params.input.transportEdielId,
      marketActorEdielId: params.input.marketActorEdielId,
      receiverEdielId: params.input.receiverEdielId,
      receiverSubaddress: params.input.receiverSubaddress,
      source: top[0]?.source ?? null,
      confidence: topScore,
      evidence,
      reasons: [`Inbound tenant löstes via ${top[0]?.source ?? 'routing'} för receiver ${params.input.receiverEdielId ?? '—'}.`],
      candidateCompanyIds,
      warnings,
    }
  }

  if (topCompanyIds.length > 1) {
    return {
      status: 'ambiguous',
      companyId: null,
      transportEdielId: params.input.transportEdielId,
      marketActorEdielId: params.input.marketActorEdielId,
      receiverEdielId: params.input.receiverEdielId,
      receiverSubaddress: params.input.receiverSubaddress,
      source: top[0]?.source ?? null,
      confidence: topScore,
      evidence,
      reasons: [`Receiver ${params.input.receiverEdielId ?? '—'} matchade flera bolag med samma routingstyrka. Ingen automatisk tenant väljs.`],
      candidateCompanyIds,
      warnings,
    }
  }

  return {
    status: 'unresolved',
    companyId: null,
    transportEdielId: params.input.transportEdielId,
    marketActorEdielId: params.input.marketActorEdielId,
    receiverEdielId: params.input.receiverEdielId,
    receiverSubaddress: params.input.receiverSubaddress,
    source: null,
    confidence: 0,
    evidence,
    reasons: [
      params.input.receiverEdielId
        ? `UNB receiver ${params.input.receiverEdielId} kunde inte matchas säkert till tenant i ${params.input.environment ?? 'okänd miljö'}.`
        : 'UNB receiver Ediel-id saknas.',
    ],
    candidateCompanyIds: params.input.mailboxCompanyId ? [params.input.mailboxCompanyId] : [],
    warnings,
  }
}

export async function resolveInboundTenantFromIdentifiers(input: ResolveInboundTenantInput): Promise<InboundTenantResolution> {
  const normalized = normalizeInput(input)

  if (normalized.existingCompanyId) {
    return {
      status: 'resolved',
      companyId: normalized.existingCompanyId,
      transportEdielId: normalized.transportEdielId,
      marketActorEdielId: normalized.marketActorEdielId,
      receiverEdielId: normalized.receiverEdielId,
      receiverSubaddress: normalized.receiverSubaddress,
      source: 'existing_message_company_id',
      confidence: 300,
      evidence: [{
        companyId: normalized.existingCompanyId,
        source: 'existing_message_company_id',
        score: 300,
        details: {
          messageCompanyId: normalized.existingCompanyId,
          transportEdielId: normalized.transportEdielId,
          marketActorEdielId: normalized.marketActorEdielId,
        },
      }],
      reasons: ['Meddelandet hade redan company_id och runtime använder den persistade tenant-kopplingen.'],
      candidateCompanyIds: [normalized.existingCompanyId],
      warnings: [],
    }
  }

  if (!normalized.environment) {
    return {
      status: 'unresolved',
      companyId: null,
      transportEdielId: normalized.transportEdielId,
      marketActorEdielId: normalized.marketActorEdielId,
      receiverEdielId: normalized.receiverEdielId,
      receiverSubaddress: normalized.receiverSubaddress,
      source: null,
      confidence: 0,
      evidence: [],
      reasons: ['Miljö saknas. Tenant-routing utan test/production blockeras.'],
      candidateCompanyIds: [],
      warnings: [],
    }
  }

  const evidence = [
    ...(await evidenceFromCommunicationRoute(normalized)),
    ...(await evidenceFromActorSettings(normalized)),
    ...(await evidenceFromRouteProfiles(normalized)),
  ]

  return resolutionFromEvidence({ input: normalized, evidence })
}

export function tenantResolutionForStorage(resolution: InboundTenantResolution): Record<string, unknown> {
  return {
    status: resolution.status,
    companyId: resolution.companyId,
    transportEdielId: resolution.transportEdielId,
    marketActorEdielId: resolution.marketActorEdielId,
    receiverEdielId: resolution.receiverEdielId,
    receiverSubaddress: resolution.receiverSubaddress,
    source: resolution.source,
    confidence: resolution.confidence,
    reasons: resolution.reasons,
    warnings: resolution.warnings,
    candidateCompanyIds: resolution.candidateCompanyIds,
    evidence: resolution.evidence,
  }
}
