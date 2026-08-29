import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const sourcePath = path.join(process.cwd(), 'lib/admin/websiteIntegrationOps.ts')
const source = fs.readFileSync(sourcePath, 'utf8')

const ambiguousEmbed = 'customers(full_name,company_name,email,phone)'
const tenantSafeEmbed = 'customers!website_customer_applications_company_customer_fkey(full_name,company_name,email,phone)'

describe('website application customer relationship', () => {
  it('never uses the ambiguous customer relationship for website applications', () => {
    expect(source).not.toContain(ambiguousEmbed)
  })

  it('uses the company + customer composite relationship for both website application reads', () => {
    expect(source.split(tenantSafeEmbed)).toHaveLength(3)
  })
})
