import { describe, expect, it } from 'vitest'
import {
  PUBLIC_CONTRACT_ERROR_CODES,
  PublicContractSerializationError,
  serializePublicContractLegal,
  serializePublicContractPriceOptions,
} from '@/lib/external-contracts/publicContractModel'

const companyId = '00000000-0000-4000-8000-000000000001'
const bundleId = '00000000-0000-4000-8000-000000000002'

function priceOption(overrides: Record<string, unknown> = {}) {
  return {
    id: 'internal-price-option-id',
    price_option_reference: 'variable_standard',
    option_code: 'variable_standard',
    customer_name: 'Standard',
    price_type: 'variable_monthly',
    contract_type: 'variable_monthly',
    customer_type: 'private',
    resolution: 'monthly',
    currency: 'SEK',
    unit: 'ore_per_kwh',
    fixed_price: null,
    markup: 10,
    monthly_fee: 49,
    binding_months: 0,
    notice_months: 1,
    auto_renew_enabled: false,
    renewal_term_months: null,
    is_default: true,
    default: true,
    selection_required: false,
    valid_from: null,
    valid_to: null,
    earliest_start_date: null,
    latest_start_date: null,
    area_prices: [],
    internal_snapshot_id: 'must-not-leak',
    ...overrides,
  }
}

function legal(overrides: Record<string, unknown> = {}) {
  return {
    legal_bundle_version_id: bundleId,
    immutable: true,
    module_versions: [
      {
        id: '00000000-0000-4000-8000-000000000003',
        legal_bundle_version_id: bundleId,
        module_key: 'general_consumer_terms',
        version: '2',
        title: 'Allmänna konsumentvillkor',
        published_at: null,
        content_sha256: null,
        origin: 'canonical_bundle_document',
        internal_audit_id: 'must-not-leak',
      },
      {
        id: '00000000-0000-4000-8000-000000000004',
        legal_bundle_version_id: bundleId,
        module_key: 'price_terms',
        version: '1',
        title: 'Prisvillkor',
        published_at: null,
        content_sha256: null,
        origin: 'canonical_bundle_document',
      },
    ],
    ...overrides,
  }
}

describe('canonical public contract price options', () => {
  it('makes is_default canonical and emits an identical deprecated alias', () => {
    const [option] = serializePublicContractPriceOptions([priceOption()])
    expect(option.is_default).toBe(true)
    expect(option.default).toBe(true)
    expect(option.area_prices).toEqual([])
    expect(JSON.stringify(option)).not.toContain('internal_snapshot_id')
  })

  it('temporarily accepts default-only snapshots but emits is_default', () => {
    const input = priceOption({ is_default: undefined, default: true })
    const [option] = serializePublicContractPriceOptions([input])
    expect(option.is_default).toBe(true)
    expect(option.default).toBe(true)
  })

  it('blocks a mismatch between default and is_default', () => {
    expect(() =>
      serializePublicContractPriceOptions([
        priceOption({ is_default: true, default: false }),
      ]),
    ).toThrowError(
      expect.objectContaining({
        code: PUBLIC_CONTRACT_ERROR_CODES.priceOptionDefaultMismatch,
      }),
    )
  })

  it('keeps a variable contract valid with area_prices: []', () => {
    expect(
      serializePublicContractPriceOptions([
        priceOption({ contract_type: 'variable_monthly', area_prices: [] }),
      ])[0]?.area_prices,
    ).toEqual([])
  })

  it('blocks unknown canonical enums instead of rewriting them silently', () => {
    expect(() =>
      serializePublicContractPriceOptions([
        priceOption({ currency: 'EUR' }),
      ]),
    ).toThrow(PublicContractSerializationError)
  })

  it('requires exactly one default option', () => {
    expect(() =>
      serializePublicContractPriceOptions([
        priceOption({
          price_option_reference: 'option_one',
          option_code: 'option_one',
          is_default: false,
          default: false,
        }),
      ]),
    ).toThrow(PublicContractSerializationError)
  })
})

describe('canonical public contract legal snapshot', () => {
  it('emits the locked bundle id on legal and every module', () => {
    const result = serializePublicContractLegal({
      value: legal(),
      companyId,
    })
    expect(result.legal_bundle_version_id).toBe(bundleId)
    expect(result.immutable).toBe(true)
    expect(result.module_versions).toHaveLength(2)
    expect(
      result.module_versions.every(
        (module) => module.legal_bundle_version_id === bundleId,
      ),
    ).toBe(true)
    expect(JSON.stringify(result)).not.toContain('internal_audit_id')
  })

  it('blocks a module from another bundle version', () => {
    const value = legal()
    const modules = value.module_versions as Array<Record<string, unknown>>
    modules[1] = {
      ...modules[1],
      legal_bundle_version_id:
        '00000000-0000-4000-8000-000000000099',
    }
    expect(() =>
      serializePublicContractLegal({ value, companyId }),
    ).toThrowError(
      expect.objectContaining({
        code: PUBLIC_CONTRACT_ERROR_CODES.legalModuleBundleMismatch,
      }),
    )
  })

  it('blocks duplicate module keys', () => {
    const value = legal()
    const modules = value.module_versions as Array<Record<string, unknown>>
    modules[1] = { ...modules[1], module_key: 'general_consumer_terms' }
    expect(() =>
      serializePublicContractLegal({ value, companyId }),
    ).toThrowError(
      expect.objectContaining({
        code: PUBLIC_CONTRACT_ERROR_CODES.legalModuleVersionInvalid,
      }),
    )
  })

  it('blocks missing bundle version for a new publication', () => {
    expect(() =>
      serializePublicContractLegal({
        value: legal({ legal_bundle_version_id: null }),
        companyId,
      }),
    ).toThrowError(
      expect.objectContaining({
        code: PUBLIC_CONTRACT_ERROR_CODES.legalBundleVersionMissing,
      }),
    )
  })

  it('serializes an explicitly approved historical null without omitting it', () => {
    const value = legal({
      legal_bundle_version_id: null,
      module_versions: [
        {
          id: '00000000-0000-4000-8000-000000000003',
          legal_bundle_version_id: null,
          module_key: 'general_consumer_terms',
          version: 'historical',
          title: 'Historiskt villkor',
          published_at: null,
          content_sha256: null,
          origin: 'historical_snapshot',
        },
      ],
    })
    const result = serializePublicContractLegal({
      value,
      companyId,
      allowHistoricalNull: true,
    })
    expect(result).toHaveProperty('legal_bundle_version_id', null)
    expect(result.module_versions[0]).toHaveProperty(
      'legal_bundle_version_id',
      null,
    )
  })

  it('does not accept a mutable legal snapshot', () => {
    expect(() =>
      serializePublicContractLegal({
        value: legal({ immutable: false }),
        companyId,
      }),
    ).toThrowError(
      expect.objectContaining({
        code: PUBLIC_CONTRACT_ERROR_CODES.legalSnapshotIncomplete,
      }),
    )
  })
})
