import { publicReference } from '@/lib/integrations/publicReferences'
import {
  buildCustomerLegalDocuments,
  type CustomerLegalDocument,
  type CustomerLegalModuleVersion,
} from '@/lib/legal/customerDocumentPackage'

export const PUBLIC_CONTRACT_ERROR_CODES = {
  legalBundleVersionMissing: 'PUBLICATION_LEGAL_BUNDLE_VERSION_MISSING',
  legalModuleBundleMismatch: 'PUBLICATION_LEGAL_MODULE_BUNDLE_MISMATCH',
  legalSnapshotIncomplete: 'PUBLICATION_LEGAL_SNAPSHOT_INCOMPLETE',
  legalModuleVersionInvalid: 'PUBLICATION_LEGAL_MODULE_VERSION_INVALID',
  priceOptionDefaultMismatch: 'PUBLICATION_PRICE_OPTION_DEFAULT_MISMATCH',
  runtimeSchemaMismatch: 'PUBLICATION_RUNTIME_SCHEMA_MISMATCH',
  contractVersionMismatch: 'PUBLICATION_CONTRACT_VERSION_MISMATCH',
  openApiChecksumMismatch: 'PUBLICATION_OPENAPI_CHECKSUM_MISMATCH',
} as const

export type PublicContractErrorCode =
  (typeof PUBLIC_CONTRACT_ERROR_CODES)[keyof typeof PUBLIC_CONTRACT_ERROR_CODES]

export class PublicContractSerializationError extends Error {
  readonly code: PublicContractErrorCode
  readonly path: string

  constructor(code: PublicContractErrorCode, path: string, message?: string) {
    super(message ?? `${code} at ${path}`)
    this.name = 'PublicContractSerializationError'
    this.code = code
    this.path = path
  }
}

export type PublicContractType =
  | 'fixed'
  | 'variable_monthly'
  | 'variable_hourly'
  | 'variable_quarterly'
  | 'portfolio'
  | 'mixed'

export type PublicContractPriceOptionAreaPrice = {
  area_price_reference: string
  price_area: 'SE1' | 'SE2' | 'SE3' | 'SE4'
  energy_price_ore_per_kwh: number
  unit: 'ore_per_kwh'
  valid_from: string | null
  valid_to: string | null
}

export type PublicContractPriceOption = {
  price_option_reference: string
  option_code: string
  customer_name: string
  price_type: PublicContractType
  contract_type: PublicContractType
  customer_type: 'private' | 'business' | 'both'
  resolution: 'monthly' | 'hourly' | 'quarterly'
  currency: 'SEK'
  unit: 'ore_per_kwh'
  fixed_price: number | null
  markup: number | null
  monthly_fee: number | null
  binding_months: number
  notice_months: number
  auto_renew_enabled: boolean
  renewal_term_months: number | null
  is_default: boolean
  /** @deprecated Compatibility alias for is_default. */
  default: boolean
  selection_required: boolean
  valid_from: string | null
  valid_to: string | null
  earliest_start_date: string | null
  latest_start_date: string | null
  area_prices: PublicContractPriceOptionAreaPrice[]
}

export type PublicContractLegalModuleVersion = {
  id: string
  legal_bundle_version_id: string | null
  document_reference: string
  module_key: string
  version: string
  title: string
  published_at: string | null
  content_sha256: string | null
  origin: string
  url: string | null
}

export type PublicContractLegal = {
  legal_bundle_reference: string | null
  legal_bundle_version_id: string | null
  immutable: true
  required_modules: string[]
  module_versions: PublicContractLegalModuleVersion[]
  customer_documents: CustomerLegalDocument[]
  terms_version?: unknown
  privacy_policy_version?: unknown
  withdrawal_version?: unknown
  power_of_attorney_version?: unknown
  power_of_attorney_version_id: string | null
  price_terms_version?: unknown
  terms_required?: unknown
  privacy_policy_required?: unknown
  withdrawal_required?: unknown
  price_terms_required?: unknown
  power_of_attorney_required?: unknown
  terms_document_reference?: unknown
  privacy_policy_document_reference?: unknown
  withdrawal_document_reference?: unknown
  price_terms_document_reference?: unknown
  power_of_attorney_document_reference?: unknown
  terms_url?: unknown
  privacy_policy_url?: unknown
  withdrawal_url?: unknown
  price_terms_url?: unknown
  power_of_attorney_url?: unknown
}

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const SHA256_PATTERN = /^[a-f0-9]{64}$/i
const CONTRACT_TYPES = new Set<PublicContractType>([
  'fixed',
  'variable_monthly',
  'variable_hourly',
  'variable_quarterly',
  'portfolio',
  'mixed',
])
const CUSTOMER_TYPES = new Set<PublicContractPriceOption['customer_type']>([
  'private',
  'business',
  'both',
])
const RESOLUTIONS = new Set<PublicContractPriceOption['resolution']>([
  'monthly',
  'hourly',
  'quarterly',
])

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}
}

function requiredText(value: unknown, path: string): string {
  if (typeof value === 'string' && value.trim()) return value.trim()
  throw new PublicContractSerializationError(
    PUBLIC_CONTRACT_ERROR_CODES.runtimeSchemaMismatch,
    path,
  )
}

function nullableText(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function nullableLegalDocumentUrl(value: unknown, path: string): string | null {
  const url = nullableText(value)
  if (url === null) return null
  if (url.startsWith('/legal/')) return url
  try {
    const parsed = new URL(url)
    if (
      (parsed.protocol === 'https:' || parsed.protocol === 'http:') &&
      parsed.pathname.startsWith('/legal/')
    ) {
      return url
    }
  } catch {
    // Rejected below with the same fail-closed schema error as other DTO fields.
  }
  throw new PublicContractSerializationError(
    PUBLIC_CONTRACT_ERROR_CODES.runtimeSchemaMismatch,
    path,
    `${path} must point to a legal document route`,
  )
}

function requiredUuid(value: unknown, path: string): string {
  const uuid = requiredText(value, path)
  if (UUID_PATTERN.test(uuid)) return uuid
  throw new PublicContractSerializationError(
    PUBLIC_CONTRACT_ERROR_CODES.runtimeSchemaMismatch,
    path,
    `${path} must be a UUID`,
  )
}

function nullableUuid(value: unknown, path: string): string | null {
  if (value === null || value === undefined || value === '') return null
  return requiredUuid(value, path)
}

function nullableSha256(value: unknown, path: string): string | null {
  const hash = nullableText(value)
  if (hash === null || SHA256_PATTERN.test(hash)) return hash
  throw new PublicContractSerializationError(
    PUBLIC_CONTRACT_ERROR_CODES.runtimeSchemaMismatch,
    path,
    `${path} must be a SHA-256 hex digest`,
  )
}

function requiredNumber(value: unknown, path: string): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  throw new PublicContractSerializationError(
    PUBLIC_CONTRACT_ERROR_CODES.runtimeSchemaMismatch,
    path,
  )
}

function nullableNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function requiredBoolean(value: unknown, path: string): boolean {
  if (typeof value === 'boolean') return value
  throw new PublicContractSerializationError(
    PUBLIC_CONTRACT_ERROR_CODES.runtimeSchemaMismatch,
    path,
  )
}

function requiredInteger(value: unknown, path: string): number {
  if (typeof value === 'number' && Number.isInteger(value) && value >= 0) {
    return value
  }
  throw new PublicContractSerializationError(
    PUBLIC_CONTRACT_ERROR_CODES.runtimeSchemaMismatch,
    path,
  )
}

function nullablePositiveInteger(value: unknown, path: string): number | null {
  if (value === null || value === undefined) return null
  if (typeof value === 'number' && Number.isInteger(value) && value >= 1) {
    return value
  }
  throw new PublicContractSerializationError(
    PUBLIC_CONTRACT_ERROR_CODES.runtimeSchemaMismatch,
    path,
  )
}

function enumValue<T extends string>(
  value: unknown,
  allowed: Set<T>,
  path: string,
): T {
  const normalized = requiredText(value, path) as T
  if (allowed.has(normalized)) return normalized
  throw new PublicContractSerializationError(
    PUBLIC_CONTRACT_ERROR_CODES.runtimeSchemaMismatch,
    path,
  )
}

export function serializePublicContractPriceOptions(
  value: unknown,
): PublicContractPriceOption[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new PublicContractSerializationError(
      PUBLIC_CONTRACT_ERROR_CODES.runtimeSchemaMismatch,
      'price_options',
    )
  }

  const seenReferences = new Set<string>()
  const options = value.map((item, index) => {
    const option = record(item)
    const path = `price_options[${index}]`
    const canonical = option.is_default
    const alias = option.default
    if (typeof canonical !== 'boolean' && typeof alias !== 'boolean') {
      throw new PublicContractSerializationError(
        PUBLIC_CONTRACT_ERROR_CODES.runtimeSchemaMismatch,
        `${path}.is_default`,
      )
    }
    if (
      typeof canonical === 'boolean' &&
      typeof alias === 'boolean' &&
      canonical !== alias
    ) {
      throw new PublicContractSerializationError(
        PUBLIC_CONTRACT_ERROR_CODES.priceOptionDefaultMismatch,
        path,
      )
    }
    const isDefault =
      typeof canonical === 'boolean' ? canonical : (alias as boolean)

    const reference = requiredText(
      option.price_option_reference,
      `${path}.price_option_reference`,
    )
    if (seenReferences.has(reference)) {
      throw new PublicContractSerializationError(
        PUBLIC_CONTRACT_ERROR_CODES.runtimeSchemaMismatch,
        `${path}.price_option_reference`,
      )
    }
    seenReferences.add(reference)

    const areaPrices = Array.isArray(option.area_prices)
      ? option.area_prices.map((areaItem, areaIndex) => {
          const area = record(areaItem)
          const areaPath = `${path}.area_prices[${areaIndex}]`
          const priceArea = requiredText(area.price_area, `${areaPath}.price_area`)
          if (!['SE1', 'SE2', 'SE3', 'SE4'].includes(priceArea)) {
            throw new PublicContractSerializationError(
              PUBLIC_CONTRACT_ERROR_CODES.runtimeSchemaMismatch,
              `${areaPath}.price_area`,
            )
          }
          const amount = requiredNumber(
            area.energy_price_ore_per_kwh,
            `${areaPath}.energy_price_ore_per_kwh`,
          )
          if (amount <= 0 || area.unit !== 'ore_per_kwh') {
            throw new PublicContractSerializationError(
              PUBLIC_CONTRACT_ERROR_CODES.runtimeSchemaMismatch,
              `${areaPath}.${amount <= 0 ? 'energy_price_ore_per_kwh' : 'unit'}`,
            )
          }
          return {
            area_price_reference: requiredText(
              area.area_price_reference,
              `${areaPath}.area_price_reference`,
            ),
            price_area:
              priceArea as PublicContractPriceOptionAreaPrice['price_area'],
            energy_price_ore_per_kwh: amount,
            unit: 'ore_per_kwh' as const,
            valid_from: nullableText(area.valid_from),
            valid_to: nullableText(area.valid_to),
          }
        })
      : []

    if (option.currency !== 'SEK') {
      throw new PublicContractSerializationError(
        PUBLIC_CONTRACT_ERROR_CODES.runtimeSchemaMismatch,
        `${path}.currency`,
      )
    }
    if (option.unit !== 'ore_per_kwh') {
      throw new PublicContractSerializationError(
        PUBLIC_CONTRACT_ERROR_CODES.runtimeSchemaMismatch,
        `${path}.unit`,
      )
    }

    return {
      price_option_reference: reference,
      option_code: requiredText(option.option_code, `${path}.option_code`),
      customer_name: requiredText(
        option.customer_name,
        `${path}.customer_name`,
      ),
      price_type: enumValue(
        option.price_type,
        CONTRACT_TYPES,
        `${path}.price_type`,
      ),
      contract_type: enumValue(
        option.contract_type,
        CONTRACT_TYPES,
        `${path}.contract_type`,
      ),
      customer_type: enumValue(
        option.customer_type,
        CUSTOMER_TYPES,
        `${path}.customer_type`,
      ),
      resolution: enumValue(
        option.resolution,
        RESOLUTIONS,
        `${path}.resolution`,
      ),
      currency: 'SEK' as const,
      unit: 'ore_per_kwh' as const,
      fixed_price: nullableNumber(option.fixed_price),
      markup: nullableNumber(option.markup),
      monthly_fee: nullableNumber(option.monthly_fee),
      binding_months: requiredInteger(
        option.binding_months,
        `${path}.binding_months`,
      ),
      notice_months: requiredInteger(
        option.notice_months,
        `${path}.notice_months`,
      ),
      auto_renew_enabled: requiredBoolean(
        option.auto_renew_enabled,
        `${path}.auto_renew_enabled`,
      ),
      renewal_term_months: nullablePositiveInteger(
        option.renewal_term_months,
        `${path}.renewal_term_months`,
      ),
      is_default: isDefault,
      default: isDefault,
      selection_required: requiredBoolean(
        option.selection_required,
        `${path}.selection_required`,
      ),
      valid_from: nullableText(option.valid_from),
      valid_to: nullableText(option.valid_to),
      earliest_start_date: nullableText(option.earliest_start_date),
      latest_start_date: nullableText(option.latest_start_date),
      area_prices: areaPrices,
    }
  })

  if (options.filter((option) => option.is_default).length !== 1) {
    throw new PublicContractSerializationError(
      PUBLIC_CONTRACT_ERROR_CODES.runtimeSchemaMismatch,
      'price_options.is_default',
      'Exactly one published price option must be the default',
    )
  }

  return options
}

const LEGAL_COMPATIBILITY_FIELDS = [
  'terms_version',
  'privacy_policy_version',
  'withdrawal_version',
  'power_of_attorney_version',
  'price_terms_version',
  'terms_required',
  'privacy_policy_required',
  'withdrawal_required',
  'price_terms_required',
  'power_of_attorney_required',
  'terms_document_reference',
  'privacy_policy_document_reference',
  'withdrawal_document_reference',
  'price_terms_document_reference',
  'power_of_attorney_document_reference',
  'terms_url',
  'privacy_policy_url',
  'withdrawal_url',
  'price_terms_url',
  'power_of_attorney_url',
] as const

export function serializePublicContractLegal(input: {
  value: unknown
  companyId: string
  allowHistoricalNull?: boolean
}): PublicContractLegal {
  const legal = record(input.value)
  const rawModules = Array.isArray(legal.module_versions)
    ? legal.module_versions
    : Array.isArray(legal.documents)
      ? legal.documents
      : []
  const bundleId = nullableUuid(
    legal.legal_bundle_version_id,
    'legal.legal_bundle_version_id',
  )
  if (!bundleId && !input.allowHistoricalNull) {
    throw new PublicContractSerializationError(
      PUBLIC_CONTRACT_ERROR_CODES.legalBundleVersionMissing,
      'legal.legal_bundle_version_id',
    )
  }
  if (legal.immutable !== true) {
    throw new PublicContractSerializationError(
      PUBLIC_CONTRACT_ERROR_CODES.legalSnapshotIncomplete,
      'legal.immutable',
      'Published legal snapshots must be immutable',
    )
  }

  const seenModuleKeys = new Set<string>()
  const modules = rawModules.map((item, index) => {
    const moduleVersion = record(item)
    const path = `legal.module_versions[${index}]`
    const moduleBundleId = nullableUuid(
      moduleVersion.legal_bundle_version_id,
      `${path}.legal_bundle_version_id`,
    )
    if (moduleBundleId !== bundleId) {
      throw new PublicContractSerializationError(
        PUBLIC_CONTRACT_ERROR_CODES.legalModuleBundleMismatch,
        `${path}.legal_bundle_version_id`,
      )
    }
    const moduleKey = requiredText(moduleVersion.module_key, `${path}.module_key`)
    if (seenModuleKeys.has(moduleKey)) {
      throw new PublicContractSerializationError(
        PUBLIC_CONTRACT_ERROR_CODES.legalModuleVersionInvalid,
        `${path}.module_key`,
      )
    }
    seenModuleKeys.add(moduleKey)
    const id = requiredUuid(moduleVersion.id, `${path}.id`)
    const documentReference =
      nullableText(moduleVersion.document_reference) ??
      publicReference('legal_document', input.companyId, id)
    if (!documentReference) {
      throw new PublicContractSerializationError(
        PUBLIC_CONTRACT_ERROR_CODES.legalModuleVersionInvalid,
        `${path}.document_reference`,
      )
    }
    return {
      id,
      legal_bundle_version_id: moduleBundleId,
      document_reference: documentReference,
      module_key: moduleKey,
      version:
        nullableText(moduleVersion.version) ??
        nullableText(moduleVersion.template_version) ??
        requiredText(moduleVersion.created_at, `${path}.version`),
      title: requiredText(moduleVersion.title, `${path}.title`),
      published_at: nullableText(moduleVersion.published_at),
      content_sha256: nullableSha256(
        moduleVersion.content_sha256,
        `${path}.content_sha256`,
      ),
      origin: nullableText(moduleVersion.origin) ?? 'canonical_bundle_document',
      url: nullableText(moduleVersion.url),
    }
  })

  if (modules.length === 0) {
    throw new PublicContractSerializationError(
      PUBLIC_CONTRACT_ERROR_CODES.legalSnapshotIncomplete,
      'legal.module_versions',
    )
  }

  const powerOfAttorneyModule = modules.find(
    (moduleItem) => moduleItem.module_key === 'power_of_attorney',
  )
  const suppliedPowerOfAttorneyVersionId = nullableUuid(
    legal.power_of_attorney_version_id,
    'legal.power_of_attorney_version_id',
  )
  if (
    suppliedPowerOfAttorneyVersionId &&
    suppliedPowerOfAttorneyVersionId !== powerOfAttorneyModule?.id
  ) {
    throw new PublicContractSerializationError(
      PUBLIC_CONTRACT_ERROR_CODES.legalModuleVersionInvalid,
      'legal.power_of_attorney_version_id',
      'Power-of-attorney version id must reference the canonical module-version row',
    )
  }
  if (legal.power_of_attorney_required === true && !powerOfAttorneyModule) {
    throw new PublicContractSerializationError(
      PUBLIC_CONTRACT_ERROR_CODES.legalModuleVersionInvalid,
      'legal.power_of_attorney_version_id',
      'A required power of attorney must have a canonical module version',
    )
  }

  const suppliedCustomerDocuments = Array.isArray(legal.customer_documents)
    ? legal.customer_documents.map(record)
    : []
  const customerDocuments = bundleId
    ? buildCustomerLegalDocuments({
        companyId: input.companyId,
        legalBundleVersionId: bundleId,
        modules: modules as CustomerLegalModuleVersion[],
      }).map((document) => {
        const supplied = suppliedCustomerDocuments.find(
          (candidate) =>
            nullableText(candidate.requirement_code) ===
              document.requirement_code &&
            nullableText(candidate.document_reference) ===
              document.document_reference &&
            nullableText(candidate.document_version) ===
              document.document_version &&
            nullableText(candidate.document_hash)?.toLowerCase() ===
              document.document_hash.toLowerCase() &&
            nullableText(candidate.legal_bundle_version_id) === bundleId,
        )
        return {
          ...document,
          // The URL is presentation-only. It is retained only after the complete
          // immutable grouped-document identity has matched the rebuilt DTO.
          document_url: supplied
            ? nullableLegalDocumentUrl(
                supplied.document_url,
                `legal.customer_documents.${document.requirement_code}.document_url`,
              )
            : null,
        }
      })
    : []

  const result: PublicContractLegal = {
    legal_bundle_reference:
      nullableText(legal.legal_bundle_reference) ??
      (bundleId
        ? publicReference('legal_bundle', input.companyId, bundleId)
        : null),
    legal_bundle_version_id: bundleId,
    immutable: true,
    required_modules: modules.map((moduleItem) => moduleItem.module_key),
    module_versions: modules,
    customer_documents: customerDocuments,
    power_of_attorney_version_id: powerOfAttorneyModule?.id ?? null,
  }
  for (const field of LEGAL_COMPATIBILITY_FIELDS) {
    if (Object.prototype.hasOwnProperty.call(legal, field)) {
      result[field] = legal[field]
    }
  }
  return result
}
