#!/usr/bin/env node
const fs = require('node:fs')
const {
  validateResponse,
} = require('./lib/openapi-schema-validator.cjs')

const version = '2026-08-04.3'
const specification = JSON.parse(
  fs.readFileSync('docs/openapi/website-integration-v1.json', 'utf8'),
)
const fixture = JSON.parse(
  fs.readFileSync(
    'docs/fixtures/public-contracts-response-2026-08-04.3.json',
    'utf8',
  ),
)
const failures = validateResponse(
  specification,
  '/api/v1/website/public-contracts',
  fixture,
)

if (specification.info?.version !== version) {
  failures.push(`Website OpenAPI info.version must be ${version}.`)
}
if (fixture.meta?.contract_schema_version !== version) {
  failures.push(`Fixture contract_schema_version must be ${version}.`)
}
if (JSON.stringify(fixture.data) !== JSON.stringify(fixture.contracts)) {
  failures.push('contracts must be an exact compatibility alias for data.')
}
for (const [contractIndex, contract] of (fixture.data ?? []).entries()) {
  for (const [optionIndex, option] of (contract.price_options ?? []).entries()) {
    if (typeof option.is_default !== 'boolean') {
      failures.push(`data[${contractIndex}].price_options[${optionIndex}].is_default is missing.`)
    }
    if (option.default !== option.is_default) {
      failures.push(`data[${contractIndex}].price_options[${optionIndex}] default alias differs from is_default.`)
    }
    if (
      option.contract_type === 'variable_monthly' &&
      !Array.isArray(option.area_prices)
    ) {
      failures.push(`Variable option ${option.price_option_reference} must expose area_prices as an array.`)
    }
  }
  const bundleId = contract.legal?.legal_bundle_version_id
  if (!bundleId) {
    failures.push(`data[${contractIndex}].legal.legal_bundle_version_id is missing.`)
  }
  for (const [moduleIndex, module] of (
    contract.legal?.module_versions ?? []
  ).entries()) {
    if (module.legal_bundle_version_id !== bundleId) {
      failures.push(
        `data[${contractIndex}].legal.module_versions[${moduleIndex}] belongs to another bundle.`,
      )
    }
  }
}


const withUnknownRuntimeField = structuredClone(fixture)
withUnknownRuntimeField.data[0].price_options[0].internal_snapshot_id = 'must-fail'
withUnknownRuntimeField.contracts = structuredClone(withUnknownRuntimeField.data)
if (
  validateResponse(
    specification,
    '/api/v1/website/public-contracts',
    withUnknownRuntimeField,
  ).length === 0
) {
  failures.push('Published OpenAPI must reject an undocumented runtime field.')
}
const withMissingRequiredField = structuredClone(fixture)
delete withMissingRequiredField.data[0].legal.legal_bundle_version_id
withMissingRequiredField.contracts = structuredClone(withMissingRequiredField.data)
if (
  validateResponse(
    specification,
    '/api/v1/website/public-contracts',
    withMissingRequiredField,
  ).length === 0
) {
  failures.push('Published OpenAPI must reject a missing legal bundle version id.')
}

const priceOption = specification.components?.schemas?.ContractPriceOption
if (!priceOption?.properties?.is_default) {
  failures.push('ContractPriceOption.is_default is missing from OpenAPI.')
}
if (priceOption?.properties?.default?.deprecated !== true) {
  failures.push('ContractPriceOption.default must be deprecated.')
}
for (const field of ['is_default', 'default']) {
  if (!priceOption?.required?.includes(field)) {
    failures.push(`ContractPriceOption.${field} must be required.`)
  }
}
const legal = specification.components?.schemas?.WebsiteLegalBlock
if (!legal?.required?.includes('legal_bundle_version_id')) {
  failures.push('WebsiteLegalBlock.legal_bundle_version_id must be required.')
}
const legalModule = specification.components?.schemas?.LegalBundleDocument
if (!legalModule?.required?.includes('legal_bundle_version_id')) {
  failures.push('LegalBundleDocument.legal_bundle_version_id must be required.')
}

for (const sourcePath of [
  'app/api/v1/website/public-contracts/route.ts',
  'app/api/v1/contracts/route.ts',
]) {
  const source = fs.readFileSync(sourcePath, 'utf8')
  if (!source.includes('mapContractPublicationToPublicDto')) {
    failures.push(`${sourcePath} bypasses the canonical public DTO mapper.`)
  }
  if (!source.includes('X-Gridex-Contract-Version')) {
    failures.push(`${sourcePath} does not publish the contract version header.`)
  }
}
const mapper = fs.readFileSync(
  'lib/external-contracts/publicationDto.ts',
  'utf8',
)
for (const requiredSource of [
  'serializePublicContractPriceOptions',
  'serializePublicContractLegal',
  'API_CONTRACT_RESPONSE_SCHEMA_VERSION',
]) {
  if (!mapper.includes(requiredSource)) {
    failures.push(`Canonical mapper is missing ${requiredSource}.`)
  }
}

if (failures.length) {
  console.error(failures.map((failure) => `- ${failure}`).join('\n'))
  process.exit(1)
}
console.log(
  `Public contracts fixture/runtime boundary validates against published OpenAPI ${version}.`,
)
