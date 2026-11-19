import { spawnSync } from 'node:child_process'
import { describe, expect, it } from 'vitest'

const notificationsPath = '/api/v1/customer/notifications'

function runCompatibilityCheck(
  scenario: 'current' | 'additive' | 'removed-operation' | 'missing-predecessor',
) {
  const preload = String.raw`
    import fs from 'node:fs'
    import { basename, resolve, sep } from 'node:path'

    const scenario = ${JSON.stringify(scenario)}
    const portalPath = resolve('docs/openapi/customer-portal-v1.json')
    const readFile = fs.readFileSync
    if (scenario === 'missing-predecessor') {
      const exists = fs.existsSync
      const releases = resolve('docs/openapi/releases') + sep
      let masked = false
      fs.existsSync = (file) => {
        if (!masked && typeof file === 'string'
          && resolve(file).startsWith(releases) && basename(file) === 'customer-portal-v1.json') {
          masked = true
          return false
        }
        return exists(file)
      }
    }
    fs.readFileSync = (file, ...args) => {
      if (typeof file !== 'string') return readFile(file, ...args)
      const absolute = resolve(file)
      const content = readFile(file, ...args)
      if (absolute !== portalPath || scenario === 'current' || scenario === 'missing-predecessor') {
        return content
      }
      const document = JSON.parse(content)
      if (scenario === 'removed-operation') {
        delete document.paths[${JSON.stringify(notificationsPath)}].get
      } else {
        document.paths['/api/v1/customer/additive-fixture'] = {
          get: { responses: { '200': { description: 'Synthetic additional operation' } } },
        }
      }
      return JSON.stringify(document)
    }
  `
  const importUrl = `data:text/javascript;base64,${Buffer.from(preload).toString('base64')}`
  const result = spawnSync(
    process.execPath,
    ['--import', importUrl, 'scripts/check-api-compatibility.cjs'],
    { encoding: 'utf8' },
  )
  expect(result.error).toBeUndefined()
  return result
}

describe('published API operation compatibility', () => {
  it('accepts the current API contracts', () => {
    const result = runCompatibilityCheck('current')
    expect(result.status, result.stderr).toBe(0)
  })

  it('accepts a new operation alongside the published operations', () => {
    const result = runCompatibilityCheck('additive')
    expect(result.status, result.stderr).toBe(0)
  })

  it('rejects removal of a published HTTP method', () => {
    const result = runCompatibilityCheck('removed-operation')
    expect(result.status).toBe(1)
    expect(result.stderr).toContain(`removed published operation GET ${notificationsPath}`)
  })

  it('fails when the declared previous artifact is missing', () => {
    const result = runCompatibilityCheck('missing-predecessor')
    expect(result.status).toBe(1)
    expect(result.stderr).toContain('customer portal: missing previous published artifact')
  })
})
