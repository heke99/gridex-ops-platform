import { spawnSync } from 'node:child_process'
import { describe, expect, it } from 'vitest'
import {
  API_DOCUMENTATION_VERSION,
  WEBSITE_INTEGRATION_CONTRACT_VERSION,
} from '@/lib/integrations/websiteIntegrationContract'

const targetOrigin = 'https://release-check.example.invalid'
const expectedCommit = 'a'.repeat(40)
const websitePath = '/api/v1/openapi/website-integration-v1.json'
const immutableWebsitePath =
  `/api/v1/openapi/${API_DOCUMENTATION_VERSION}/website-integration-v1.json`

function verifyRelease(
  scenario: 'healthy' | 'other-build' | 'immutable-bytes' | 'immutable-url' | 'immutable-origin'
    | 'other-commit' | 'missing-commit' | 'manifest-redirect' | 'spec-redirect',
  options: { baseUrl?: string; args?: string[] } = {},
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
      ...(scenario === 'missing-commit' ? {} : {
        build_commit: scenario === 'other-commit' ? 'b'.repeat(40) : ${JSON.stringify(expectedCommit)},
      }),
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
    globalThis.fetch = async (input, options) => {
      const url = new URL(input)
      if (options?.redirect !== 'error') throw new Error('Verifier must reject redirects')
      console.log('Fetched ' + url.origin + url.pathname)
      if ((scenario === 'manifest-redirect' && url.pathname.endsWith('/release-manifest.json')) ||
          (scenario === 'spec-redirect' && url.pathname === ${JSON.stringify(websitePath)})) {
        return Response.redirect('https://other-release.example.invalid' + url.pathname)
      }
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
    ['--import', importUrl, 'scripts/verify-openapi-release.cjs', ...(options.args ?? [])],
    {
      encoding: 'utf8',
      timeout: 10_000,
      env: { ...process.env, GRIDEX_API_BASE_URL: options.baseUrl ?? targetOrigin },
    },
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


describe('OpenAPI deployment proof', () => {
  const args = ['--deploy-proof', expectedCommit]

  it('verifies the expected commit and all seven routes on the selected HTTPS origin', () => {
    const result = verifyRelease('healthy', { args })
    expect(result.status, result.stderr).toBe(0)
    expect(result.stdout).toContain(`commit ${expectedCommit} verified.`)
    const requests = result.stdout.split('\n').filter(line => line.startsWith('Fetched '))
    expect(requests).toHaveLength(7)
    expect(requests.every(line => line.startsWith(`Fetched ${targetOrigin}/api/v1/openapi/`))).toBe(true)
  })

  it.each(['other-commit', 'missing-commit'] as const)(
    'rejects %s before reading specifications from a build with the same OpenAPI bytes',
    scenario => {
      const result = verifyRelease(scenario, { args })
      expect(result.status).toBe(1)
      expect(result.stderr).toContain('deployed manifest build commit mismatch')
      expect(result.stdout.match(/Fetched /g)).toHaveLength(1)
    },
  )

  it.each([['--deploy-proof'], ['--deploy-proof', 'abc123'], ['--deploy-proof', expectedCommit, 'extra']])(
    'requires one full expected commit with proof arguments %j',
    (...args) => {
      const result = verifyRelease('healthy', { args })
      expect(result.status).toBe(1)
      expect(result.stderr).toContain('a full 40-character Git commit SHA')
      expect(result.stdout).not.toContain('Fetched ')
    },
  )

  it.each([
    '', 'http://release-check.example.invalid', targetOrigin + '/api', targetOrigin + '//',
    targetOrigin + '?other=true', targetOrigin + '?', targetOrigin + '#fragment',
  ])(
    'rejects missing or non-origin HTTPS input %s before making a request',
    baseUrl => {
      const result = verifyRelease('healthy', { args, baseUrl })
      expect(result.status).toBe(1)
      expect(result.stderr).toContain('GRIDEX_API_BASE_URL must be an HTTPS origin')
      expect(result.stdout).not.toContain('Fetched ')
    },
  )

  it.each(['manifest-redirect', 'spec-redirect'] as const)(
    'rejects %s without fetching the redirected location',
    scenario => {
      const result = verifyRelease(scenario, { args })
      expect(result.status).toBe(1)
      expect(result.stderr).toContain('unavailable')
      expect(result.stdout).not.toContain('Fetched https://other-release.example.invalid')
    },
  )

  it('preserves static verification with no deployment origin', () => {
    const result = verifyRelease('missing-commit', { baseUrl: '' })
    expect(result.status, result.stderr).toBe(0)
    expect(result.stdout).toContain('Local release artifacts verified')
    expect(result.stdout).not.toContain('Fetched ')
  })

  it('preserves the legacy deployed byte checks without a manifest commit', () => {
    const result = verifyRelease('missing-commit')
    expect(result.status, result.stderr).toBe(0)
    expect(result.stdout.match(/Fetched /g)).toHaveLength(7)
  })
})
