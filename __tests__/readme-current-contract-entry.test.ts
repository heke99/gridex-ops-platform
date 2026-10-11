// ops-api-review: F39
import fs from 'node:fs'
import path from 'node:path'
import { expect, it } from 'vitest'

const root = path.resolve(__dirname, '..')
const readme = fs.readFileSync(path.join(root, 'README.md'), 'utf8')
const currentVersion = JSON.parse(fs.readFileSync(path.join(root, 'docs/openapi/website-integration-v1.json'), 'utf8')).info.version as string

it('README is the current contract inventory, not a historical hotfix note', () => {
  expect(readme.split('\n')[0]).not.toMatch(/hotfix/i)
  expect(readme).toContain(`\`${currentVersion}\``)
  expect(readme).toContain('release-manifest.json')
  for (const spec of ['website-integration-v1.json', 'customer-portal-v1.json', 'staff-v1.json', 'staff-onboarding-v1.json']) {
    expect(readme).toContain(`docs/openapi/${spec}`)
    expect(fs.existsSync(path.join(root, 'docs/openapi', spec))).toBe(true)
  }
  expect(fs.existsSync(path.join(root, 'docs/openapi/releases', currentVersion))).toBe(true)
})

it('every relative README link resolves and the dated hotfix is archived', () => {
  const links = [...readme.matchAll(/\]\(([^)#]+)\)/g)].map(match => match[1]).filter(link => !/^https?:/.test(link))
  expect(links.length).toBeGreaterThan(5)
  for (const link of links) expect(fs.existsSync(path.join(root, link)), link).toBe(true)
  expect(readme).toContain('docs/archive/2026-07-22-contract-hotfix-README.md')
})
