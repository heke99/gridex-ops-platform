import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import CustomerPortalApiDocumentationPage from '@/app/developers/customer-portal-api/page'
import website from '@/docs/openapi/website-integration-v1.json'
import { websiteSettlementForContract } from '@/lib/pricing/websiteSettlement'
import { normalizeRawApplication } from '@/lib/website/customerApplicationCore'
import {
  ApplicationSchema,
  validateCanonicalApplicationReferencePlacement,
  validateCustomerIdentityNumbers,
  validateNestedPayloadFields,
} from '@/lib/website/customerApplicationSchemas'

const codeBlocks = vi.hoisted(() => new Map<string, string>())
vi.mock('@/components/developers/CopyCodeBlock', () => ({
  CopyCodeBlock: ({ label, code }: { label: string; code: string }) => {
    codeBlocks.set(label, code)
    return null
  },
}))

describe('developer guide checkout request example', () => {
  it('copies a complete canonical request accepted by runtime normalization', () => {
    codeBlocks.clear()
    renderToStaticMarkup(CustomerPortalApiDocumentationPage())
    const request = codeBlocks.get('Checkout request example')
    expect(request).toMatch(/^POST .*\/website\/customer-applications\n/)
    const body = JSON.parse(request!.slice(request!.indexOf('\n\n') + 2))

    const documented = website.components.schemas.CustomerApplicationRequest
    const missingFields = documented.required.filter((key) => !Object.hasOwn(body, key))
    expect(missingFields).toEqual([])
    expect(body).toEqual(JSON.parse(readFileSync('docs/fixtures/website-checkout-application-request.json', 'utf8')))
    expect(body.annual_consumption_kwh).toBeGreaterThan(0)
    expect(validateNestedPayloadFields(body)).toBeNull()
    expect(validateCanonicalApplicationReferencePlacement(body)).toBeNull()
    expect(validateCustomerIdentityNumbers(body)).toBeNull()
    const normalized = ApplicationSchema.parse(normalizeRawApplication(body))
    expect(normalized).toMatchObject({
      resolution_id: body.resolution_id,
      site: { annual_consumption_kwh: body.annual_consumption_kwh },
      settlement: websiteSettlementForContract({ contractType: 'variable_monthly' }),
    })
  })

  it.each(['annual_consumption_kwh', 'resolution_id', 'settlement'])(
    'fails the documentation check when %s is missing',
    (field) => {
      const preload = String.raw`
        import fs from 'node:fs'
        import { resolve } from 'node:path'
        const readFile = fs.readFileSync
        const fixture = resolve('docs/fixtures/website-checkout-application-request.json')
        fs.readFileSync = (file, ...args) => {
          const content = readFile(file, ...args)
          if (typeof file !== 'string' || resolve(file) !== fixture) return content
          const payload = JSON.parse(content)
          delete payload[${JSON.stringify(field)}]
          return JSON.stringify(payload)
        }
      `
      const fixtureOverride = `data:text/javascript;base64,${Buffer.from(preload).toString('base64')}`
      const result = spawnSync(
        process.execPath,
        ['--import', fixtureOverride, 'scripts/check-api-documentation-examples.cjs'],
        { encoding: 'utf8' },
      )

      expect(result.error).toBeUndefined()
      expect(result.status).toBe(1)
      expect(result.stderr).toContain(`Checkout request example missing required field ${field}.`)
    },
  )
})
