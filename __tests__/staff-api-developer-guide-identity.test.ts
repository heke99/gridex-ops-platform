import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import StaffApiGuide from '@/app/developers/staff-api/page'

const independentReference = 'https://github.com/heke99/gridex-ops-platform/blob/main/docs/staff-api/server-reference-integration.md'

describe('public Staff API identity guidance', () => {
  it('visibly labels the copyable Node.js example as central identity', () => {
    const html = renderToStaticMarkup(createElement(StaffApiGuide))

    expect(html).toContain('>Central Staff identity (Node.js)</span>')
    expect(html).toContain('aria-label="Central Staff identity (Node.js)"')
    expect(html).toContain('aria-label="Copy code example"')
    expect(html).toContain('function staffAssertion(authenticatedStaffGridexUserId)')
  })

  it('links the independent reference from the claims guidance before the central example', () => {
    const html = renderToStaticMarkup(createElement(StaffApiGuide))
    const claims = html.indexOf('Clients registered for an independent staff identity')
    const example = html.indexOf('aria-label="Copy code example"')

    expect(claims).toBeGreaterThan(0)
    expect(example).toBeGreaterThan(claims)
    expect(html.slice(claims, example)).toContain(
      `href="${independentReference}">independent Staff server reference</a>`,
    )
  })
})
