import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { createRequire } from 'node:module'
import { NextRequest } from 'next/server'
import { describe, expect, it } from 'vitest'
import { PUBLIC_API_ENDPOINT_ROWS, publicRouteContract } from '@/lib/api/publicRouteRegistry'
import { canonicalApiError } from '@/lib/api/apiError'
import { API_CONTRACT_PROFILE_REGISTRY } from '@/lib/integrations/apiContractCompatibility'
import { bindAuthenticatedApiResponseProfile, withApiContractRepresentation } from '@/lib/integrations/apiResponseProfile'
import { tenantApiAccessError, type IntegrationApiClient } from '@/lib/integrations/apiAuth'
import { GET as currentDocument } from '@/app/api/v1/openapi/poa-archive-v1.json/route'
import { GET as pinnedDocument } from '@/app/api/v1/openapi/2026-10-19.1/poa-archive-v1.json/route'

type Operation = {
  operationId: string
  'x-required-scopes': string[]
  'x-scope-mode': string
  'x-cache-policy': string
  'x-customer-assertion-required'?: boolean
  parameters?: Array<{ name?: string; required?: boolean }>
  responses: Record<string, unknown>
}
type Document = {
  openapi: string
  info: { version: string }
  'x-independent-contract': boolean
  'x-contract-schema-version': string
  paths: Record<string, { get: Operation }>
  components: Record<string, Record<string, unknown>>
}

const documentPath = new URL('../docs/openapi/poa-archive-v1.json', import.meta.url)
const pinnedPath = new URL('../docs/openapi/releases/2026-10-19.1/poa-archive-v1.json', import.meta.url)
const listPath = '/api/v1/customer/powers-of-attorney/evidence'
const detailPath = `${listPath}/{verificationReference}`
const currentPath = '/api/v1/openapi/poa-archive-v1.json'
const immutablePath = '/api/v1/openapi/2026-10-19.1/poa-archive-v1.json'
function document(): Document { return JSON.parse(readFileSync(documentPath, 'utf8')) }
function dereference(proposed: Document, value: unknown): Record<string, unknown> {
  let result = value as Record<string, unknown>
  for (let depth = 0; typeof result?.$ref === 'string'; depth++) {
    if (depth >= 32 || !result.$ref.startsWith('#/')) throw new Error('Invalid local contract reference')
    result = result.$ref.slice(2).split('/').reduce<unknown>((node, key) =>
      (node as Record<string, unknown>)?.[key.replaceAll('~1', '/').replaceAll('~0', '~')], proposed) as Record<string, unknown>
  }
  return result
}
const { validateResponse, validateSchema } = createRequire(import.meta.url)('../scripts/lib/openapi-schema-validator.cjs') as {
  validateResponse: (document: unknown, path: string, value: unknown, method?: string, status?: string) => string[]
  validateSchema: (document: unknown, value: unknown, schema: unknown) => string[]
}

describe('independent customer POA archive publication', () => {
  it.each([listPath, detailPath])('registers %s with both read scopes, bounded read cost and no cache', path => {
    const concretePath = path.replace('{verificationReference}', 'poa_verification_synthetic-reference-12345678')
    const contract = publicRouteContract('GET', concretePath)
    expect(contract).not.toBeNull()
    expect(contract?.scopes).toEqual(['customer_power_of_attorney.read', 'customer_documents.read'])
    expect(contract?.scopeMode).toBe('all')
    expect(contract?.rateLimitClass).toBe('read')
    expect(contract?.cachePolicy).toBe('no-store')
    expect(contract?.publicIdPolicy).toBe('opaque-references')
    const publicTemplate = path.replace('{verificationReference}', '[verificationReference]')
    expect(PUBLIC_API_ENDPOINT_ROWS.find(row => row[0] === 'GET' && row[1] === publicTemplate)?.[2])
      .toBe('customer_power_of_attorney.read AND customer_documents.read')
  })

  it('publishes an independent version with byte-identical pinned document and unchanged shared envelope version', () => {
    const proposed = document()
    const existing = JSON.parse(readFileSync(new URL('../docs/openapi/customer-portal-v1.json', import.meta.url), 'utf8'))
    expect(proposed.info.version).toBe('2026-10-19.1')
    expect(proposed['x-independent-contract']).toBe(true)
    expect(proposed['x-contract-schema-version']).toBe(existing['x-contract-schema-version'])
    expect(readFileSync(documentPath, 'utf8')).toBe(readFileSync(pinnedPath, 'utf8'))
  })

  it('resolves every local reference in the standalone document', () => {
    const proposed = document()
    let refs = 0
    function inspect(value: unknown) {
      if (!value || typeof value !== 'object') return
      const obj = value as Record<string, unknown>
      if (typeof obj.$ref === 'string') {
        refs++
        expect(obj.$ref.startsWith('#/')).toBe(true)
        let target: unknown = proposed
        for (const part of obj.$ref.slice(2).split('/')) {
          target = (target as Record<string, unknown>)?.[part.replaceAll('~1', '/').replaceAll('~0', '~')]
        }
        expect(target, obj.$ref).toBeDefined()
      }
      Object.values(obj).forEach(inspect)
    }
    inspect(proposed)
    expect(refs).toBeGreaterThan(20)
  })

  it.each([listPath, detailPath, currentPath, immutablePath])('matches real registry metadata for GET %s', path => {
    const operation = document().paths[path].get
    const contract = publicRouteContract('GET', path.replace('{verificationReference}', 'poa_verification_synthetic-reference-12345678'))
    expect(contract).not.toBeNull()
    expect(operation.operationId).toBe(contract?.operationId)
    expect(operation['x-required-scopes']).toEqual(contract?.scopes)
    expect(operation['x-scope-mode']).toBe(contract?.scopeMode)
    expect(operation['x-cache-policy']).toBe(contract?.cachePolicy)
  })

  it.each([listPath, detailPath])('requires fresh assertion and documents optional alternative linked subjects for %s', path => {
    const operation = document().paths[path].get
    expect(operation['x-customer-assertion-required']).toBe(true)
    expect(operation.parameters?.find(p => p.name === 'x-gridex-customer-assertion')?.required).toBe(true)
    for (const name of ['x-gridex-auth-user-id', 'x-gridex-customer-portal-user-id']) {
      expect(operation.parameters?.find(p => p.name === name)?.required).toBe(false)
    }
  })

  it.each([
    [currentPath, currentDocument, 'public, max-age=300'],
    [immutablePath, pinnedDocument, 'public, max-age=31536000, immutable'],
  ] as const)('serves actual GET and conditional GET for %s with digest/cache/version agreement', async (path, get, cache) => {
    const response = await get(new NextRequest(`https://synthetic.invalid${path}`))
    const body = await response.text()
    expect(response.status).toBe(200)
    expect(body).toBe(readFileSync(documentPath, 'utf8'))
    expect(response.headers.get('Cache-Control')).toBe(cache)
    expect(response.headers.get('X-Gridex-Contract-Version')).toBe('2026-10-19.1')
    const etag = `"${createHash('sha256').update(body).digest('base64url')}"`
    expect(response.headers.get('ETag')).toBe(etag)
    const conditional = await get(new NextRequest(`https://synthetic.invalid${path}`, { headers: { 'If-None-Match': etag } }))
    expect(conditional.status).toBe(304)
    expect(await conditional.text()).toBe('')
    expect(conditional.headers.get('ETag')).toBe(etag)
    expect(conditional.headers.get('Cache-Control')).toBe(cache)
  })

  it.each(API_CONTRACT_PROFILE_REGISTRY.filter(profile => profile.surface === 'customer').map(profile => profile.revision))(
    'validates the actual common representation for supported customer profile %s', async revision => {
      const proposed = document()
      const handler = withApiContractRepresentation('customer', async () => {
        bindAuthenticatedApiResponseProfile({ metadata: { api_contract_profiles: { customer: revision } } } as unknown as IntegrationApiClient)
        return Response.json({ data: [], page: { limit: 50, offset: 0, returned: 0, has_more: false, next_cursor: null }, request_id: 'synthetic-request', contract_schema_version: proposed['x-contract-schema-version'] })
      })
      const response = await handler(new NextRequest(`https://synthetic.invalid${listPath}`))
      const body = await response.json()
      expect(response.headers.get('X-Gridex-Contract-Version')).toBe(revision)
      expect(body.contract_schema_version).toBe(revision)
      expect(validateResponse(proposed, listPath, body)).toEqual([])
      expect(validateResponse(proposed, listPath, { ...body, storage_path: 'private-path-must-be-rejected' })).not.toEqual([])
      const denial = withApiContractRepresentation('customer', async () => {
        bindAuthenticatedApiResponseProfile({ metadata: { api_contract_profiles: { customer: revision } } } as unknown as IntegrationApiClient)
        return Response.json({ error: { code: 'scope_missing', message: 'Synthetic refusal', retryable: false, field: null, blockers: [] }, request_id: 'synthetic-request', correlation_id: 'synthetic-request', contract_schema_version: proposed['x-contract-schema-version'] }, { status: 403 })
      })
      const denied = await denial(new NextRequest(`https://synthetic.invalid${listPath}`))
      expect(denied.status).toBe(403)
      // This project's small validator resolves schema refs, not response refs.
      expect(validateSchema(proposed, await denied.json(), { $ref: '#/components/schemas/ErrorEnvelope' })).toEqual([])
    },
  )

  it.each(API_CONTRACT_PROFILE_REGISTRY.filter(profile => profile.surface === 'customer').map(profile => profile.revision))(
    'validates every actual operation/status error response for supported profile %s', async revision => {
      const proposed = document()
      let checked = 0
      for (const path of [listPath, detailPath]) {
        for (const [status, raw] of Object.entries(proposed.paths[path].get.responses)) {
          if (!/^[45]\d\d$/.test(status)) continue
          const response = dereference(proposed, raw) as { content: Record<string, { schema: unknown }> }
          const schema = response.content['application/json'].schema
          const handler = withApiContractRepresentation('customer', async () => {
            bindAuthenticatedApiResponseProfile({ metadata: { api_contract_profiles: { customer: revision } } } as unknown as IntegrationApiClient)
            return Response.json(canonicalApiError({ code: 'synthetic_failure', message: 'Synthetic refusal', requestId: 'synthetic-request', field: 'input', retryable: true }), { status: Number(status) })
          })
          const actualPath = path.replace('{verificationReference}', 'poa_verification_synthetic-reference-12345678')
          const actual = await handler(new NextRequest(`https://synthetic.invalid${actualPath}`))
          const body = await actual.json()
          expect(actual.status).toBe(Number(status))
          expect(validateSchema(proposed, body, schema), `${path} ${status} ${revision}`).toEqual([])
          expect(validateSchema(proposed, { ...body, code: 'undeclared-alias', message: 'undeclared-alias' }, schema)).not.toEqual([])
          checked++
        }
      }
      expect(checked).toBe(22)
    },
  )

  it.each(API_CONTRACT_PROFILE_REGISTRY.filter(profile => profile.surface === 'customer').map(profile => profile.revision))(
    'documents actual organization lifecycle refusals for supported profile %s', async revision => {
      const proposed = document()
      expect(tenantApiAccessError('active')).toBeNull()
      const states = ['onboarding', 'paused', 'closed', 'suspended', 'archived', 'pending_deletion', 'deleted_test_only', undefined]
      let checked = 0
      for (const state of states) {
        const refused = tenantApiAccessError(state)!
        for (const path of [listPath, detailPath]) {
          const raw = proposed.paths[path].get.responses[String(refused.status)]
          expect(raw, `${path} ${state} ${refused.status}`).toBeDefined()
          const response = dereference(proposed, raw) as { content: Record<string, { schema: unknown }> }
          const handler = withApiContractRepresentation('customer', async () => {
            bindAuthenticatedApiResponseProfile({ metadata: { api_contract_profiles: { customer: revision } } } as unknown as IntegrationApiClient)
            return Response.json(canonicalApiError({ code: refused.code, message: refused.message, requestId: 'synthetic-request' }), { status: refused.status })
          })
          const actual = await handler(new NextRequest(`https://synthetic.invalid${path.replace('{verificationReference}', 'poa_verification_synthetic-reference-12345678')}`))
          expect(actual.status).toBe(refused.status)
          const body = await actual.json()
          expect(body.error.code).toBe(refused.code)
          expect(validateSchema(proposed, body, response.content['application/json'].schema)).toEqual([])
          checked++
        }
      }
      expect(checked).toBe(16)
    },
  )
})
