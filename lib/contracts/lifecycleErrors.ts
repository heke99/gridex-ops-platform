export type ContractLifecycleBlocker = {
  code?: string
  field?: string
  message?: string
  resource_type?: string
  count?: number
  reason?: string
}

export type ContractLifecycleRpcResult = {
  ok?: boolean
  changed?: boolean
  deleted?: boolean
  mode?: string
  code?: string
  reason_codes?: string[]
  blocker_codes?: string[]
  blockers?: ContractLifecycleBlocker[]
  lifecycle_status?: string
  readiness?: {
    status?: string
    can_publish?: boolean
    blockers?: string[]
    blocker_details?: ContractLifecycleBlocker[]
    resolution?: string | null
    expected_resolution?: string | null
    energy_direction?: string | null
  }
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
  HAS_RESTRICTING_FOREIGN_KEYS: 'En skyddad databasrelation refererar fortfarande till avtalet. Se blockerande tabell i raderingsanalysen.',
  contract_channel_not_found: 'Försäljningskanalen saknas för avtalet. Canonical backfill behöver repareras.',
  active_publication_version_not_found: 'Kanalen är aktiv men saknar en aktiv publiceringsversion. Canonical backfill behöver repareras.',
  contract_public_offer_still_referenced: 'Avtalet kunde inte raderas eftersom publiceringshistorik fortfarande refererar till det. Avtalsgrafen behöver repareras eller avtalet arkiveras.',
  contract_not_found: 'Avtalet hittades inte för valt bolag.',
  contract_close_reason_required: 'Ange varför avtalet ska stängas.',
  contract_already_closed: 'Avtalet är redan stängt.',
  contract_already_archived: 'Avtalet är redan arkiverat.',
  contract_closed_terminal: 'Ett stängt avtal är terminalt och kan inte raderas eller återpubliceras.',
  contract_closed: 'Avtalet stängdes för all nyförsäljning.',
  contract_already_published: 'Avtalsversionen är redan publicerad.',
  contract_version_not_publishable: 'Avtalsversionen kan inte publiceras förrän blockerarna är åtgärdade.',
  contract_delete_blocked: 'Avtalet kan inte raderas permanent. Se blockerarna och arkivera vid affärshistorik.',
  unused_contract_delete_blocked: 'Avtalet kan inte raderas permanent. Se blockerarna och arkivera vid affärshistorik.',
  lifecycle_status_not_publishable: 'Nuvarande lifecycle-status kan inte publiceras.',
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
  price_areas_missing: 'Minst ett elområde måste anges.',
  duplicate_price_areas: 'Elområdeslistan innehåller dubbletter.',
  resolution_missing: 'Prisupplösning saknas i den immutable snapshoten.',
  resolution_mismatch: 'Prisupplösningen matchar inte avtalsmodellen.',
  tenant_go_live_not_ready: 'Tenantens produktionsrouting eller avsändaridentitet är inte redo.',
  tenant_legal_profile_not_ready: 'Tenantens juridiska profil är inte komplett och granskad.',
  required_legal_modules_missing: 'Obligatoriska juridikmoduler saknar en publicerad låst version.',
}

export function contractLifecycleMessage(
  result: ContractLifecycleRpcResult | null | undefined,
  fallback: string,
): string {
  const detailedMessage =
    result?.blockers?.find((blocker) => blocker.message)?.message ??
    result?.readiness?.blocker_details?.find((blocker) => blocker.message)?.message
  if (detailedMessage) return detailedMessage

  const blockerCode =
    result?.blocker_codes?.find((code) => CONTRACT_LIFECYCLE_REASON_MESSAGES[code]) ??
    result?.readiness?.blockers?.find((code) => CONTRACT_LIFECYCLE_REASON_MESSAGES[code])
  if (blockerCode) return CONTRACT_LIFECYCLE_REASON_MESSAGES[blockerCode]

  const reason = result?.reason_codes?.find((code) => CONTRACT_LIFECYCLE_REASON_MESSAGES[code])
  if (reason) return CONTRACT_LIFECYCLE_REASON_MESSAGES[reason]
  if (result?.code && CONTRACT_LIFECYCLE_REASON_MESSAGES[result.code]) {
    return CONTRACT_LIFECYCLE_REASON_MESSAGES[result.code]
  }
  return fallback
}

export function contractLifecycleError(
  result: ContractLifecycleRpcResult | null | undefined,
  fallback: string,
): Error {
  return new Error(contractLifecycleMessage(result, fallback))
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
  if (code === '23502') return 'Äldre avtalsdata saknar en obligatorisk canonical referens. Den senaste lifecycle-migrationen behöver appliceras.'
  if (code === '23505') return 'Åtgärden skulle skapa en dubblerad avtals- eller publiceringsrad.'
  if (code === '23514') return 'Avtalsgrafen bryter mot en integritetsregel och måste repareras innan åtgärden kan genomföras.'
  if (code === '42501') return 'Du saknar behörighet att genomföra den här avtalsåtgärden.'
  if (code === '55000') return 'Avtalet är låst i sitt nuvarande lifecycle-läge. Välj rätt åtgärd för avpublicering, arkivering eller ny version.'
  if (code === 'P0002') return 'Avtalet eller dess canonical publiceringsrad hittades inte.'
  if (code === 'P0001') return message || 'Avtalsåtgärden blockerades av en domänregel.'
  return null
}
