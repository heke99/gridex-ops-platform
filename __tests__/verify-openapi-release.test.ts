import { spawnSync } from 'node:child_process'
import { describe, expect, it } from 'vitest'
import {
  API_DOCUMENTATION_VERSION,
  WEBSITE_INTEGRATION_CONTRACT_VERSION,
} from '@/lib/integrations/websiteIntegrationContract'

const targetOrigin = 'https://release-check.example.invalid'
const websitePath = '/api/v1/openapi/website-integration-v1.json'
const immutableWebsitePath =
  `/api/v1/openapi/${API_DOCUMENTATION_VERSION}/website-integration-v1.json`

function verifyRelease(
  scenario: 'healthy' | 'other-build' | 'immutable-bytes' | 'immutable-url' | 'immutable-origin',
) {
  const preload = String.raw`
    import { createHash } from 'node:crypto'
    import { readFileSync } from 'node:fs'

    const version = ${JSON.stringify(API_DOCUMENTATION_VERSION)}
    const scenario = ${JSON.stringify(scenario)}
    const specifications = {
      website: 'website-integration-v1',
      customer_portal: 'customer-portal-v1',
      staff: 'staff-v1',
    }
    const manifest = {
      release_version: version,
      guide_version: version,
      runtime_contract_version: ${JSON.stringify(WEBSITE_INTEGRATION_CONTRACT_VERSION)},
      specifications: {},
    }
    const responses = new Map()
    for (const [key, name] of Object.entries(specifications)) {
      const current = '/api/v1/openapi/' + name + '.json'
      const immutable = '/api/v1/openapi/' + version + '/' + name + '.json'
      const document = JSON.parse(readFileSync('docs/openapi/' + name + '.json', 'utf8'))
      const modifiedBody = JSON.stringify({ ...document, 'x-fixture-build': 'different' }, null, 2) + '\n'
      const body = key === 'website' && scenario === 'other-build'
        ? modifiedBody
        : JSON.stringify(document, null, 2) + '\n'
      manifest.specifications[key] = {
        contract_name: name,
        contract_version: version,
        url: 'https://app.gridex.se' + current,
        immutable_url: (key === 'website' && scenario === 'immutable-origin'
          ? 'https://other-release.example.invalid'
          : 'https://app.gridex.se') + (key === 'website' && scenario === 'immutable-url'
            ? '/api/v1/openapi/other-revision/' + name + '.json'
            : immutable),
        sha256: createHash('sha256').update(body).digest('hex'),
      }
      responses.set(current, body)
      responses.set(immutable, key === 'website' && scenario === 'immutable-bytes' ? modifiedBody : body)
    }
    responses.set('/api/v1/openapi/release-manifest.json', JSON.stringify(manifest))

    // URL.parse is unavailable at the supported Node 22.0.0 floor.
    URL.parse = undefined
    globalThis.fetch = async (input) => {
      const url = new URL(input)
      console.log('Fetched ' + url.origin + url.pathname)
      const body = responses.get(url.pathname)
      return new Response(body, {
        status: body === undefined ? 404 : 200,
        headers: { 'content-type': 'application/json' },
      })
    }
  `
  const importUrl = `data:text/javascript;base64,${Buffer.from(preload).toString('base64')}`
  const result = spawnSync(
    process.execPath,
    ['--import', importUrl, 'scripts/verify-openapi-release.cjs'],
    { encoding: 'utf8', env: { ...process.env, GRIDEX_API_BASE_URL: targetOrigin } },
  )
  expect(result.error).toBeUndefined()
  return result
}

describe('OpenAPI release verification', () => {
  it('verifies both routes for every contract on the configured deployment', () => {
    const result = verifyRelease('healthy')
    expect(result.status, result.stderr).toBe(0)
    expect(result.stdout).toContain(`Fetched ${targetOrigin}${websitePath}`)
    expect(result.stdout).toContain(`Fetched ${targetOrigin}${immutableWebsitePath}`)
    expect(result.stdout.match(new RegExp(`Fetched ${targetOrigin}/api/v1/openapi/`, 'g'))).toHaveLength(7)
    expect(result.stdout).not.toContain('Fetched https://app.gridex.se')
  })

  it('rejects a deployed manifest and documents that agree on a different build', () => {
    const result = verifyRelease('other-build')
    expect(result.status).toBe(1)
    expect(result.stderr).toContain('website: deployed manifest sha256 mismatch')
  })

  it('rejects different bytes from the versioned route', () => {
    const result = verifyRelease('immutable-bytes')
    expect(result.status).toBe(1)
    expect(result.stderr).toContain('website: deployed immutable sha256 mismatch')
  })

  it('rejects a versioned manifest link to a different revision', () => {
    const result = verifyRelease('immutable-url')
    expect(result.status).toBe(1)
    expect(result.stderr).toContain('website: deployed immutable_url mismatch')
  })

  it('rejects a versioned manifest link on an unrelated origin', () => {
    const result = verifyRelease('immutable-origin')
    expect(result.status).toBe(1)
    expect(result.stderr).toContain('website: deployed immutable_url mismatch')
  })
})
