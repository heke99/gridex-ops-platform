import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import CustomerPortalApiDocumentationPage from '@/app/developers/customer-portal-api/page'
import { CopyCodeBlock } from '@/components/developers/CopyCodeBlock'

function namedRegions(html: string) {
  return [...html.matchAll(/<(?:pre|div)\b[^>]*role="region"[^>]*>/g)].map(match => match[0])
}

describe('public API documentation keyboard access', () => {
  it('makes an independently rendered code example a named keyboard stop without changing its text', () => {
    const html = renderToStaticMarkup(createElement(CopyCodeBlock, { code: 'GET /example?value=<safe>' }))
    expect(html).toContain('role="region"')
    expect(html).toContain('aria-label="Code example"')
    expect(html).toContain('tabindex="0"')
    expect(html).toContain('GET /example?value=&lt;safe&gt;')
    expect(html).toContain('aria-label="Copy code example"')
  })

  it('gives all endpoint tables and code examples explicit, distinct region names', () => {
    const html = renderToStaticMarkup(createElement(CustomerPortalApiDocumentationPage))
    const regions = namedRegions(html)
    expect(regions).toHaveLength(11)
    const names = regions.map(region => region.match(/aria-label="([^"]+)"/)?.[1])
    expect(names.every(Boolean)).toBe(true)
    expect(new Set(names).size).toBe(11)
    for (const region of regions) expect(region).toContain('tabindex="0"')
    for (const label of ['Customer Portal endpoints', 'Partner API endpoints', 'Website API endpoints']) {
      expect(names).toContain(label)
    }
  })

  it('keeps public documentation content, endpoint data and the production prerequisite warning', () => {
    const html = renderToStaticMarkup(createElement(CustomerPortalApiDocumentationPage))
    expect(html).toContain('Gridex API')
    expect(html).toContain('/customer/powers-of-attorney/evidence/')
    expect(html).toContain('verificationReference')
    expect(html).toContain('Production use requires the deployed API and database prerequisites')
    expect(html).toContain('aria-label="Copy code example"')
  })
})
