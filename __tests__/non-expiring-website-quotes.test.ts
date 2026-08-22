import { readFileSync, readdirSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const read = (path: string) => readFileSync(path, 'utf8')

describe('non-expiring customer website quotes', () => {
  it('keeps V1 valid_until as compatibility metadata without elapsed-time rejection', () => {
    const quotes = read('lib/pricing/websiteQuotes.ts')
    const resolution = read('lib/energy/resolutionBinding.ts')
    const route = read('app/api/v1/website/quote/validate/route.ts')
    const template = read('app/developers/customer-portal-api/template.tsx')
    const migration = readdirSync('supabase/migrations')
      .filter((name) => /_non_expiring_website_quotes\.sql$/.test(name))
      .sort()
      .at(-1)
    expect(migration).toBeTruthy()
    const sql = read(`supabase/migrations/${migration}`)

    expect(quotes).toContain("NON_EXPIRING_WEBSITE_QUOTE_VALID_UNTIL = '9999-12-31T23:59:59.999Z'")
    expect(quotes).not.toContain('WEBSITE_QUOTE_VALIDITY_MINUTES')
    expect(quotes).not.toContain("code: 'quote_expired'")
    expect(quotes).toContain("if (quote.status === 'expired')")
    expect(quotes).toContain('allowExpired: true')
    expect(resolution).toContain('allowExpired?: boolean')
    expect(route).toContain('valid_until: quote.valid_until')
    expect(template).toContain('customer-price expiry')
    expect(template).toContain('not rejected because that timestamp passes')
    expect(sql).toContain("message = 'website_quote_expired'")
    expect(sql).toContain("execute replace(v_definition, v_expiry_block, '')")
    expect(sql).toContain("where status = 'expired'")
  })
})
