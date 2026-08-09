import { createHash } from 'node:crypto'
import { publicReference } from '@/lib/integrations/publicReferences'

export const CUSTOMER_LEGAL_DOCUMENT_KINDS = [
  'agreement',
  'power_of_attorney',
  'withdrawal',
] as const

export type CustomerLegalDocumentKind =
  (typeof CUSTOMER_LEGAL_DOCUMENT_KINDS)[number]

export type CustomerLegalModuleVersion = {
  id: string
  module_key: string
  version: string
  title: string
  published_at: string | null
  content_sha256: string | null
  legal_bundle_version_id: string | null
  origin?: string | null
  url?: string | null
}

export type CustomerLegalDocument = {
  requirement_code: CustomerLegalDocumentKind
  document_type: CustomerLegalDocumentKind
  title: string
  description: string
  required: true
  acceptance_mode: 'accept' | 'acknowledge'
  document_reference: string
  document_version: string
  document_hash: string
  document_url: string | null
  legal_bundle_version_id: string
  module_keys: string[]
  source_document_ids: string[]
  primary_document_id: string | null
  sort_order: number
}

const WITHDRAWAL_MODULES = new Set([
  'withdrawal_right',
  'withdrawal_form',
])

const GROUP_METADATA: Record<
  CustomerLegalDocumentKind,
  {
    title: string
    description: string
    acceptanceMode: 'accept' | 'acknowledge'
    sortOrder: number
  }
> = {
  agreement: {
    title: 'Elhandelsavtal och fullständiga villkor',
    description:
      'Kundens elhandelsavtal, pris- och betalningsvillkor samt övriga tillämpliga avtalsvillkor i ett sammanhållet dokument.',
    acceptanceMode: 'accept',
    sortOrder: 10,
  },
  power_of_attorney: {
    title: 'Fullmakt',
    description:
      'Fullmakt för de uttryckligen angivna åtgärderna, bland annat leverantörsbyte och inhämtning av anläggningsuppgifter när dessa scopes har valts.',
    acceptanceMode: 'accept',
    sortOrder: 20,
  },
  withdrawal: {
    title: 'Information om ångerrätt och ångerblankett',
    description:
      'Information om konsumentens ångerrätt tillsammans med ångerblanketten.',
    acceptanceMode: 'acknowledge',
    sortOrder: 30,
  },
}

export function isCustomerLegalDocumentKind(
  value: string,
): value is CustomerLegalDocumentKind {
  return (CUSTOMER_LEGAL_DOCUMENT_KINDS as readonly string[]).includes(value)
}

/**
 * Customer presentation grouping. The canonical module rows remain immutable
 * and continue to be the evidence source of truth; this function only decides
 * which of the three customer-facing documents presents each module.
 */
export function customerLegalDocumentKindForModule(
  moduleKey: string,
): CustomerLegalDocumentKind {
  const normalized = moduleKey.trim().toLowerCase()
  if (normalized === 'power_of_attorney') return 'power_of_attorney'
  if (WITHDRAWAL_MODULES.has(normalized)) return 'withdrawal'
  return 'agreement'
}

export type CustomerLegalAcceptanceCategory =
  | 'terms'
  | 'privacy_policy'
  | 'withdrawal'
  | 'power_of_attorney'
  | 'price_terms'

const WITHDRAWAL_ACCEPTANCE_MODULES = new Set([
  'withdrawal_right',
  'withdrawal_form',
  'distance_contract_information',
  'pre_contract_information',
])

const PRICE_ACCEPTANCE_MODULES = new Set([
  'price_terms',
  'variable_price_terms',
  'hourly_price_terms',
  'quarterly_price_terms',
  'fixed_price_terms',
  'mixed_price_terms',
  'portfolio_terms',
])

/**
 * Maps an immutable canonical module to the historical acceptance category
 * used by customer_legal_acceptances. This is deliberately separate from the
 * three customer-facing presentation documents: one grouped acceptance is
 * expanded back to every exact source module for audit and downstream proof.
 */
export function customerLegalAcceptanceCategoryForModule(
  moduleKey: string,
): CustomerLegalAcceptanceCategory {
  const normalized = moduleKey.trim().toLowerCase()
  if (normalized === 'power_of_attorney') return 'power_of_attorney'
  if (normalized === 'privacy_policy') return 'privacy_policy'
  if (WITHDRAWAL_ACCEPTANCE_MODULES.has(normalized)) return 'withdrawal'
  if (PRICE_ACCEPTANCE_MODULES.has(normalized)) return 'price_terms'
  return 'terms'
}

function requiredText(value: string | null | undefined, label: string): string {
  const normalized = value?.trim() ?? ''
  if (!normalized) throw new Error(`customer_legal_document_${label}_missing`)
  return normalized
}

function packageHash(input: {
  kind: CustomerLegalDocumentKind
  legalBundleVersionId: string
  modules: CustomerLegalModuleVersion[]
}): string {
  const manifest = {
    schema: 'gridex_customer_legal_document_v1',
    document_type: input.kind,
    legal_bundle_version_id: input.legalBundleVersionId,
    modules: input.modules.map((module) => ({
      id: module.id,
      module_key: module.module_key,
      version: module.version,
      content_sha256: requiredText(
        module.content_sha256,
        `${module.module_key}_sha256`,
      ).toLowerCase(),
    })),
  }
  return createHash('sha256').update(JSON.stringify(manifest), 'utf8').digest('hex')
}

export function buildCustomerLegalDocuments(input: {
  companyId: string
  legalBundleVersionId: string
  modules: CustomerLegalModuleVersion[]
  urlForKind?: (kind: CustomerLegalDocumentKind) => string | null
}): CustomerLegalDocument[] {
  const companyId = requiredText(input.companyId, 'company_id')
  const legalBundleVersionId = requiredText(
    input.legalBundleVersionId,
    'bundle_version_id',
  )
  const groups = new Map<
    CustomerLegalDocumentKind,
    CustomerLegalModuleVersion[]
  >()

  for (const legalModule of input.modules) {
    if (
      requiredText(
        legalModule.legal_bundle_version_id,
        'module_bundle_version_id',
      ) !== legalBundleVersionId
    ) {
      throw new Error('customer_legal_document_bundle_mismatch')
    }
    const kind = customerLegalDocumentKindForModule(legalModule.module_key)
    const current = groups.get(kind) ?? []
    current.push(legalModule)
    groups.set(kind, current)
  }

  return CUSTOMER_LEGAL_DOCUMENT_KINDS.flatMap((kind) => {
    const modules = [...(groups.get(kind) ?? [])].sort((left, right) =>
      left.module_key.localeCompare(right.module_key) || left.id.localeCompare(right.id),
    )
    if (modules.length === 0) return []
    const metadata = GROUP_METADATA[kind]
    const documentReference = publicReference(
      'legal_customer_document',
      companyId,
      `${legalBundleVersionId}:${kind}:v1`,
    )
    const documentVersion = publicReference(
      'legal_customer_version',
      companyId,
      `${legalBundleVersionId}:${kind}:v1`,
    )
    if (!documentReference || !documentVersion) {
      throw new Error('customer_legal_document_reference_invalid')
    }
    return [
      {
        requirement_code: kind,
        document_type: kind,
        title: metadata.title,
        description: metadata.description,
        required: true as const,
        acceptance_mode: metadata.acceptanceMode,
        document_reference: documentReference,
        document_version: documentVersion,
        document_hash: packageHash({
          kind,
          legalBundleVersionId,
          modules,
        }),
        document_url: input.urlForKind?.(kind) ?? null,
        legal_bundle_version_id: legalBundleVersionId,
        module_keys: modules.map((module) => module.module_key),
        source_document_ids: modules.map((module) => module.id),
        primary_document_id: modules.length === 1 ? modules[0]!.id : null,
        sort_order: metadata.sortOrder,
      },
    ]
  }).sort((left, right) => left.sort_order - right.sort_order)
}

export function renderCustomerLegalDocumentBody(input: {
  kind: CustomerLegalDocumentKind
  modules: Array<{ title: string; body: string }>
}): string {
  const metadata = GROUP_METADATA[input.kind]
  const introduction =
    input.kind === 'agreement'
      ? 'Detta sammanhållna dokument utgör elhandelsavtalet och de villkor som gäller för det valda erbjudandet. Rubrikerna nedan motsvarar de versionslåsta juridikdelar som ingår i avtalet.'
      : input.kind === 'withdrawal'
        ? 'Detta dokument innehåller informationen om ångerrätt och den ångerblankett som hör till avtalet.'
        : 'Denna fullmakt gäller endast för de åtgärder som kunden uttryckligen väljer och godkänner i anslutning till undertecknandet. Den signerade omfattningen sparas oföränderligt tillsammans med fullmakten.'

  return [
    metadata.title,
    introduction,
    ...input.modules.flatMap((module, index) => [
      `${index + 1}. ${module.title}`,
      module.body,
    ]),
  ]
    .filter(Boolean)
    .join('\n\n')
}
