import { createHash } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { NextRequest } from 'next/server'
import { buildStaffOpenApiReleaseManifest, staffReleaseManifestResponse } from '@/lib/staff-api/openApiReleaseManifest'
import { GET as currentDocument } from '@/app/api/v1/openapi/staff-support-v1.json/route'
import { GET as immutableDocument } from '@/app/api/v1/openapi/2026-10-03.1/staff-support-v1.json/route'

const digest = (value: string) => createHash('sha256').update(value).digest('hex')

describe('independent staff OpenAPI release', () => {
  it('pins exactly the bytes actually served by current and immutable document routes', async () => {
    const request = new NextRequest('https://app.gridex.se/api/v1/openapi/staff-support-v1.json')
    const current = await currentDocument(request)
    const immutable = await immutableDocument(request)
    const body = await current.text()
    expect(await immutable.text()).toBe(body)
    expect(current.headers.get('X-Gridex-Contract-Version')).toBe('2026-10-03.1')
    expect(immutable.headers.get('Cache-Control')).toContain('immutable')
    const manifest = buildStaffOpenApiReleaseManifest()
    expect(manifest.specification.sha256).toBe(digest(body))
    expect(JSON.parse(body).info.version).toBe(manifest.contract_version)
    expect(manifest.minimum_staff_integration_version).toBe('2026-10-03.1')
  })

  it('serves protocol metadata without tenant or actor grants and preserves version on conditional reads', async () => {
    const first = staffReleaseManifestResponse(new NextRequest('https://app.gridex.se/api/v1/openapi/staff-release-manifest.json'))
    const payload = await first.json()
    expect(payload.contract_name).toBe('staff-support-v1')
    expect(payload).not.toHaveProperty('permissions')
    expect(payload).not.toHaveProperty('staff_reference')
    expect(payload).not.toHaveProperty('organization_reference')
    const conditional = staffReleaseManifestResponse(new NextRequest('https://app.gridex.se/api/v1/openapi/staff-release-manifest.json', { headers: { 'If-None-Match': first.headers.get('ETag')! } }))
    expect(conditional.status).toBe(304)
    expect(await conditional.text()).toBe('')
    expect(conditional.headers.get('X-Gridex-Contract-Version')).toBe('2026-10-03.1')
  })

  it('retains the existing Website and Customer Portal .4 document fingerprints', () => {
    for (const [name, expected] of [
      ['website-integration-v1', '10fb2f3051f112990fe4ef63ffa18b24ee5d9b5203b1f4429a2a3d88675c43be'],
      ['customer-portal-v1', '442ee521e2286a3364de082cce50b68be3085db7855caf151a8999005b790503'],
    ]) {
      const current = fs.readFileSync(path.join(process.cwd(), 'docs/openapi', `${name}.json`), 'utf8')
      const archived = fs.readFileSync(path.join(process.cwd(), 'docs/openapi/releases/2026-10-02.4', `${name}.json`), 'utf8')
      expect(digest(current)).toBe(expected)
      expect(archived).toBe(current)
    }
  })
})
