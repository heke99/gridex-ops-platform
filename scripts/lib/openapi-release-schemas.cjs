// A closed object cannot be extended through allOf: additionalProperties is
// evaluated inside each branch. Flatten only the documented public fields.
function customerSupportCaseDetail(caseSchema) {
  if (caseSchema?.type !== 'object' || caseSchema.additionalProperties !== false) {
    throw new Error('CustomerSupportCase must remain a closed object')
  }
  return {
    type: 'object',
    additionalProperties: false,
    required: [...caseSchema.required, 'messages'],
    properties: {
      ...structuredClone(caseSchema.properties),
      messages: { type: 'array', items: { $ref: '#/components/schemas/CustomerSupportMessage' } },
    },
  }
}

function releaseManifestSchemas(version, minimumVersion, { includeStaff = false, runtimeVersion = version } = {}) {
  const contractVersion = { type: 'string', const: version }
  const dateTime = { type: 'string', format: 'date-time' }
  const compatibility = { type: 'string', enum: ['backward-compatible', 'breaking-client-update-required', 'breaking'] }
  const manifestProperties = {
    release_version: contractVersion,
    website_openapi_version: contractVersion,
    customer_portal_openapi_version: contractVersion,
    ...(includeStaff ? { staff_openapi_version: contractVersion } : {}),
    runtime_contract_version: { type: 'string', const: runtimeVersion },
    guide_version: contractVersion,
    released_at: dateTime,
    generated_at: dateTime,
    build_commit: { type: 'string' },
    compatibility_classification: compatibility,
    deprecated_features: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['feature', 'replacement', 'sunset_at'],
        properties: { feature: { type: 'string' }, replacement: { type: 'string' }, sunset_at: dateTime },
      },
    },
    minimum_tenant_integration_version: { type: 'string', const: minimumVersion },
    specifications: {
      type: 'object',
      additionalProperties: false,
      required: ['website', 'customer_portal', ...(includeStaff ? ['staff'] : [])],
      properties: {
        website: { $ref: '#/components/schemas/OpenApiReleaseSpecification' },
        customer_portal: { $ref: '#/components/schemas/OpenApiReleaseSpecification' },
        ...(includeStaff ? { staff: { $ref: '#/components/schemas/OpenApiReleaseSpecification' } } : {}),
      },
    },
  }
  const specificationProperties = {
    contract_name: { type: 'string' },
    contract_version: contractVersion,
    url: { type: 'string', format: 'uri' },
    immutable_url: { type: 'string', format: 'uri' },
    sha256: { type: 'string', pattern: '^[a-f0-9]{64}$' },
    compatibility,
  }
  return {
    OpenApiReleaseManifest: {
      type: 'object',
      additionalProperties: false,
      required: Object.keys(manifestProperties),
      properties: manifestProperties,
    },
    OpenApiReleaseSpecification: {
      type: 'object',
      additionalProperties: false,
      required: Object.keys(specificationProperties),
      properties: specificationProperties,
    },
  }
}

function documentVersionedOpenApiHeaders(document) {
  for (const [path, item] of Object.entries(document.paths)) {
    const version = /^\/api\/v1\/openapi\/(\d{4}-\d{2}-\d{2}\.\d+)\//.exec(path)?.[1]
    if (!version) continue
    for (const status of ['200', '304']) {
      const response = item.get?.responses?.[status]
      if (!response) continue
      response.headers = response.headers ?? {}
      response.headers['X-Gridex-Contract-Version'] = {
        description: 'Contract version of this immutable OpenAPI document.',
        schema: { type: 'string', const: version },
      }
    }
  }
}

function documentCredentialResponseProfileErrors(document) {
  const codes = document['x-error-codes'] ?? []
  document['x-error-codes'] = [...new Set([...codes, 'api_contract_profile_unavailable'])]
  for (const [path, item] of Object.entries(document.paths ?? {})) {
    if (path.includes('/openapi/')) continue
    for (const [method, operation] of Object.entries(item)) {
      if (!['get', 'post', 'put', 'patch', 'delete'].includes(method)) continue
      operation.responses = operation.responses ?? {}
      operation.responses['503'] = operation.responses['503'] ?? {
        description: 'The required service or configured credential response profile is unavailable. Profile configuration errors require an operator correction.',
        headers: {
          'X-Gridex-Contract-Version': { $ref: '#/components/headers/GridexContractVersion' },
          'X-Request-ID': { $ref: '#/components/headers/RequestId' },
          'X-Gridex-Documentation-Version': { $ref: '#/components/headers/GridexDocumentationVersion' },
        },
        content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorEnvelope' } } },
      }
    }
  }
}

module.exports = { customerSupportCaseDetail, releaseManifestSchemas, documentVersionedOpenApiHeaders, documentCredentialResponseProfileErrors }
