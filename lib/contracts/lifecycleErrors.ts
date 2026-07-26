export type ContractLifecycleBlocker = {
  code?: string
  field?: string
  message?: string
  resource_type?: string
  resource_id?: string
  count?: number
  reason?: string
  current_value?: unknown
  metadata?: Record<string, unknown>
}

export type ContractReadinessResult = {
  ok?: boolean
  status?: string
  can_execute?: boolean
  can_publish?: boolean
  operation?: string
  channel?: string | null
  code?: string
  blockers?: ContractLifecycleBlocker[] | string[]
  blocker_details?: ContractLifecycleBlocker[]
  lifecycle_status?: string
  resolution?: string | null
  expected_resolution?: string | null
  energy_direction?: string | null
}

export type ContractLifecycleRpcResult = {
  ok?: boolean
  changed?: boolean
  deleted?: boolean
  mode?: string
  code?: string
  reason_codes?: string[]
  blocker_codes?: string[]
  blockers?: ContractLifecycleBlocker[] | string[]
  lifecycle_status?: string
  readiness?: ContractReadinessResult
  recommended_action?: string
  already_unpublished?: boolean
  affected_channels?: number
  delete_preview?: {
    code?: string
    reason_codes?: string[]
    blockers?: ContractLifecycleBlocker[]
    lifecycle_status?: string
    recommended_action?: string
    foreign_key_blockers?: {
      count?: number
      items?: Array<{
        constraint?: string
        relation?: string
        referenced_columns?: string[]
        rows?: number
      }>
    }
  }
}

export const CONTRACT_LIFECYCLE_REASON_MESSAGES: Readonly<Record<string, string>> = {
  HAS_CUSTOMER_CONTRACTS: 'Avtalet används av ett eller flera kundavtal och kan därför endast arkiveras.',
  HAS_ACCEPTED_APPLICATIONS: 'Avtalet används av en kundansökan och kan därför endast arkiveras.',
  HAS_EXTERNAL_INTAKES: 'Avtalet används av ett externt kundintag och kan därför endast arkiveras.',
  HAS_BINDING_PRICE_SNAPSHOTS: 'Avtalet har bindande kundprissnapshots och kan därför endast arkiveras.',
  HAS_INVOICES: 'Avtalet har fakturahistorik och kan därför endast arkiveras.',
  HAS_BILLING_HISTORY: 'Avtalet används i faktureringsunderlag och kan därför endast arkiveras.',
  HAS_CHARGE_LEDGER: 'Avtalet används i avgiftsliggaren och kan därför endast arkiveras.',
  HAS_LEGAL_ACCEPTANCES: 'Avtalet har juridiska accepter och kan därför endast arkiveras.',
  HAS_WEBSITE_QUOTES: 'Avtalet har utfärdade offerter. Arkivera avtalet så att offert- och prishistoriken bevaras.',
  HAS_SUCCESSOR_VERSION: 'Avtalsversionen har en efterföljande version och kan inte raderas separat.',
  HAS_SHARED_CANONICAL_VERSION: 'Den canonical avtalsversionen delas av annan data och kan inte raderas automatiskt.',
  HAS_SHARED_LEGAL_VERSION: 'Juridikversionen delas av annan data och kan inte raderas automatiskt.',
  INCOMPLETE_CANONICAL_MAPPING: 'Avtalet har ofullständig äldre systemdata. Reparera canonical backfill innan åtgärden genomförs.',
  ACTIVE_PUBLICATION_REQUIRES_UNPUBLISH: 'Avtalet är fortfarande publicerat. Avpublicera samtliga aktiva kanaler innan permanent radering.',
  HAS_LEGACY_PUBLICATION_REFERENCES: 'Avtalet har äldre publiceringsreferenser som måste repareras innan permanent radering.',
  PUBLICATION_GRAPH_INCONSISTENT: 'Avtalsgrafen är inkonsekvent. Reparera publiceringsgrafen eller arkivera avtalet.',
  PUBLICATION_COMPANY_MISMATCH: 'Publiceringsgrafen innehåller data från fel tenant och måste granskas manuellt.',
  PUBLICATION_CHANNEL_MISMATCH: 'Publiceringsgrafens kanalbindning är inkonsekvent och måste repareras.',
  PUBLICATION_VERSION_LINK_MISMATCH: 'Avtalets framåt- och bakåtlänk pekar på olika publiceringsversioner.',
  SOURCE_OFFER_MISMATCH: 'Publiceringen pekar på fel internt avtal och måste repareras.',
  PRODUCT_VERSION_MISMATCH: 'Publiceringen pekar på fel avtalsversion och måste repareras.',
  PERMANENT_DELETE_REQUIRES_DRAFT: 'Permanent radering är endast tillåten för oanvända utkast eller redo-versioner. Avpublicera eller arkivera avtalet först.',
  permanent_delete_requires_draft: 'Permanent radering är endast tillåten för oanvända draft- eller ready-versioner.',
  HAS_RESTRICTING_FOREIGN_KEYS: 'En skyddad databasrelation refererar fortfarande till avtalet. Se blockerande tabell i raderingsanalysen.',
  contract_channel_not_found: 'Försäljningskanalen saknas för avtalet. Canonical backfill behöver repareras.',
  active_publication_version_not_found: 'Kanalen är aktiv men saknar en aktiv publiceringsversion. Canonical backfill behöver repareras.',
  contract_public_offer_still_referenced: 'Avtalet kunde inte raderas eftersom publiceringshistorik fortfarande refererar till det. Avtalsgrafen behöver repareras eller avtalet arkiveras.',
  contract_not_found: 'Avtalet hittades inte för valt bolag.',
  contract_offer_not_found: 'Avtalsversionen hittades inte för valt bolag.',
  contract_close_reason_required: 'Ange varför avtalet ska stängas.',
  contract_already_closed: 'Avtalet är redan stängt.',
  contract_already_archived: 'Avtalet är redan arkiverat.',
  contract_archived: 'Avtalet arkiverades.',
  contract_already_deleted: 'Avtalet var redan permanent raderat.',
  contract_closed_terminal: 'Ett stängt avtal är terminalt och kan inte raderas eller återpubliceras.',
  contract_closed: 'Avtalet stängdes för all nyförsäljning.',
  contract_already_published: 'Avtalsversionen är redan publicerad.',
  contract_channel_already_active: 'Kanalen är redan aktiv för exakt samma avtalsversion.',
  contract_channel_not_ready: 'Kanalen kan inte aktiveras förrän blockerarna är åtgärdade.',
  contract_version_not_publishable: 'Avtalsversionen kan inte publiceras förrän blockerarna är åtgärdade.',
  contract_version_not_locked: 'Canonical avtalsversion måste vara godkänd och låst.',
  contract_delete_blocked: 'Avtalet kan inte raderas permanent. Se blockerarna och arkivera vid affärshistorik.',
  unused_contract_delete_blocked: 'Avtalet kan inte raderas permanent. Se blockerarna och arkivera vid affärshistorik.',
  lifecycle_status_not_publishable: 'Nuvarande lifecycle-status kan inte publiceras.',
  lifecycle_status_not_channel_activatable: 'Nuvarande lifecycle-status kan inte aktiveras på en försäljningskanal.',
  lifecycle_status_not_archivable: 'Publicerade avtal måste först pausas eller stängas innan arkivering.',
  lifecycle_status_not_closeable: 'Endast draft, ready, published eller paused kan stängas.',
  invalid_contract_transition: 'Den begärda statusövergången är inte tillåten från avtalets nuvarande lifecycle-läge.',
  canonical_product_missing: 'Canonical avtalsprodukt saknas.',
  canonical_product_version_missing: 'Canonical immutable avtalsversion saknas.',
  canonical_product_version_mismatch: 'Canonical avtalsversion tillhör inte vald produkt.',
  tenant_assignment_missing: 'Aktiv tenanttilldelning saknas för avtalsversionen.',
  internal_channel_missing: 'Intern försäljningskanal saknas för avtalsversionen.',
  price_plan_missing: 'Prisplan saknas.',
  price_plan_version_missing: 'Låst prisversion saknas.',
  price_book_missing: 'Prisbok eller prissnapshot saknas.',
  invoice_fee_missing: 'Fakturaavgiften måste vara explicit angiven, även när den är 0.',
  invoice_fee_invalid: 'Fakturaavgiften får inte vara negativ.',
  vat_rate_invalid: 'Momsinställningen är ogiltig.',
  fixed_price_missing: 'Fastprisavtalet saknar ett positivt pris per kWh.',
  fixed_price_area_missing: 'Fastpris saknas för ett obligatoriskt elområde.',
  price_areas_missing: 'Minst ett elområde måste anges.',
  duplicate_price_areas: 'Elområdeslistan innehåller dubbletter.',
  price_area_invalid: 'Ett ogiltigt elområde har angetts.',
  resolution_missing: 'Prisupplösning saknas i den immutable snapshoten.',
  resolution_mismatch: 'Prisupplösningen matchar inte avtalsmodellen.',
  production_settlement_mode_missing: 'Produktionsavtalet saknar avräkningsmodell.',
  production_compensation_missing: 'Produktionsavtalet saknar en positiv ersättningsnivå.',
  energy_direction_invalid: 'Avtalsriktningen måste vara consumption eller production.',
  production_direction_mismatch: 'Produktionsersättning är aktiverad men avtalsriktningen är inte production.',
  production_configuration_missing: 'Avtalsriktningen är production men produktionskonfigurationen saknas.',
  contract_pricing_identity_changed_during_publish: 'Den immutable prisidentiteten ändrades under publicering. Skapa en ny version i stället.',
  legal_bundle_version_missing: 'Låst juridikversion saknas. Publicera avtalsversionen internt först.',
  legal_bundle_version_not_ready: 'Juridikversionen är inte publicerad, låst och komplett.',
  tenant_go_live_not_ready: 'Tenantens produktionsrouting eller avsändaridentitet är inte redo.',
  tenant_legal_profile_not_ready: 'Tenantens juridiska profil är inte komplett och granskad.',
  legal_bundle_missing: 'Juridiskt paket saknas för avtalsversionen.',
  legal_bundle_not_published: 'Juridiskt paket är inte publicerat för bolaget.',
  required_legal_modules_missing: 'Obligatoriska juridikmoduler saknar en publicerad låst version.',
  required_legal_module_missing: 'En obligatorisk juridikmodul saknas i avtalsversionens juridikpaket.',
  unresolved_legal_variables: 'Juridikpaketet innehåller olösta mallvariabler.',
}

function isBlocker(value: unknown): value is ContractLifecycleBlocker {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function objectBlockers(value: unknown): ContractLifecycleBlocker[] {
  return Array.isArray(value) ? value.filter(isBlocker) : []
}

function stringCodes(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string' && item.length > 0)
    : []
}

export function contractLifecycleBlockers(
  result: ContractLifecycleRpcResult | ContractReadinessResult | null | undefined,
): ContractLifecycleBlocker[] {
  if (!result) return []

  const direct = objectBlockers(result.blockers)
  if (direct.length > 0) return direct

  if ('readiness' in result && result.readiness) {
    const nested = objectBlockers(result.readiness.blockers)
    if (nested.length > 0) return nested
    const legacyNested = objectBlockers(result.readiness.blocker_details)
    if (legacyNested.length > 0) return legacyNested
  }

  if ('blocker_details' in result) {
    const legacy = objectBlockers(result.blocker_details)
    if (legacy.length > 0) return legacy
  }

  return []
}

export function contractLifecycleCodes(
  result: ContractLifecycleRpcResult | ContractReadinessResult | null | undefined,
): string[] {
  if (!result) return []
  const codes = contractLifecycleBlockers(result)
    .map((blocker) => blocker.code ?? blocker.reason)
    .filter((code): code is string => Boolean(code))
  if (codes.length > 0) return codes

  const direct = stringCodes(result.blockers)
  if (direct.length > 0) return direct

  if ('blocker_codes' in result) {
    const explicit = stringCodes(result.blocker_codes)
    if (explicit.length > 0) return explicit
  }
  if ('reason_codes' in result) {
    const reasons = stringCodes(result.reason_codes)
    if (reasons.length > 0) return reasons
  }
  if ('readiness' in result && result.readiness) {
    const nested = stringCodes(result.readiness.blockers)
    if (nested.length > 0) return nested
  }
  return []
}

export function contractLifecycleMessage(
  result: ContractLifecycleRpcResult | null | undefined,
  fallback: string,
): string {
  const blockerMessages = contractLifecycleBlockers(result)
    .map((blocker) =>
      blocker.message ??
      (blocker.code ? CONTRACT_LIFECYCLE_REASON_MESSAGES[blocker.code] : undefined) ??
      blocker.code ??
      blocker.reason,
    )
    .filter((message): message is string => Boolean(message?.trim()))
    .filter((message, index, all) => all.indexOf(message) === index)

  if (blockerMessages.length > 0) {
    const visible = blockerMessages.slice(0, 8)
    const remaining = blockerMessages.length - visible.length
    return `${visible.join(' · ')}${remaining > 0 ? ` · samt ${remaining} ytterligare blockerare` : ''}`
  }

  const blockerCode = contractLifecycleCodes(result)
    .find((code) => CONTRACT_LIFECYCLE_REASON_MESSAGES[code])
  if (blockerCode) return CONTRACT_LIFECYCLE_REASON_MESSAGES[blockerCode]

  if (result?.code && CONTRACT_LIFECYCLE_REASON_MESSAGES[result.code]) {
    return CONTRACT_LIFECYCLE_REASON_MESSAGES[result.code]
  }
  return fallback
}

export class ContractLifecycleActionError extends Error {
  readonly code: string | undefined
  readonly blockers: ContractLifecycleBlocker[]
  readonly result: ContractLifecycleRpcResult | null

  constructor(result: ContractLifecycleRpcResult | null | undefined, fallback: string) {
    super(contractLifecycleMessage(result, fallback))
    this.name = 'ContractLifecycleActionError'
    this.code = result?.code
    this.blockers = contractLifecycleBlockers(result)
    this.result = result ?? null
  }
}

export function contractLifecycleError(
  result: ContractLifecycleRpcResult | null | undefined,
  fallback: string,
): ContractLifecycleActionError {
  return new ContractLifecycleActionError(result, fallback)
}

export function contractDatabaseErrorMessage(error: unknown): string | null {
  const record = error && typeof error === 'object' ? error as { code?: unknown; message?: unknown; details?: unknown } : {}
  const code = typeof record.code === 'string' ? record.code : ''
  const message = typeof record.message === 'string' ? record.message : error instanceof Error ? error.message : ''
  const details = typeof record.details === 'string' ? record.details : ''
  const combined = `${message} ${details}`

  for (const [reason, userMessage] of Object.entries(CONTRACT_LIFECYCLE_REASON_MESSAGES)) {
    if (combined.includes(reason)) return userMessage
  }
  if (code === '23503') {
    return 'Avtalet kunde inte raderas eftersom annan avtals- eller publiceringshistorik fortfarande refererar till det. Reparera grafen eller arkivera avtalet.'
  }
  if (code === '42702') {
    return 'Databasfunktionen innehåller en tvetydig kolumnreferens. Applicera den senaste avtalsmigrationen innan åtgärden körs igen.'
  }
  if (code === '42703') {
    return 'Databasfunktionen refererar till en kolumn eller variabel som saknas. Applicera den senaste avtalsmigrationen innan åtgärden körs igen.'
  }
  if (code === '23502') return 'Äldre avtalsdata saknar en obligatorisk canonical referens. Den senaste lifecycle-migrationen behöver appliceras.'
  if (code === '23505') return 'Åtgärden skulle skapa en dubblerad avtals- eller publiceringsrad.'
  if (code === '23514') return 'Avtalsgrafen bryter mot en integritetsregel och måste repareras innan åtgärden kan genomföras.'
  if (code === '42501') return 'Du saknar behörighet att genomföra den här avtalsåtgärden.'
  if (code === '55000') return 'Avtalet är låst i sitt nuvarande lifecycle-läge. Välj rätt åtgärd för avpublicering, arkivering eller ny version.'
  if (code === 'P0002') return 'Avtalet eller dess canonical publiceringsrad hittades inte.'
  if (code === 'P0001') return message || 'Avtalsåtgärden blockerades av en domänregel.'
  return null
}
