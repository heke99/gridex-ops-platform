#!/usr/bin/env node
/* eslint-disable @typescript-eslint/no-require-imports */
const fs = require('node:fs')

const file = '__tests__/api-canonical-release.test.ts'
let source = fs.readFileSync(file, 'utf8')

source = source.replace(
  "it('aligns legacy Website API OpenAPI, runtime and database on mandatory pre-authentication', () => {",
  "it('aligns the public Website API guide, runtime and database on mandatory pre-authentication', () => {",
)
source = source.replace(
  "expect(legacyGuide).toContain('Frontend får aldrig anropa OPS direkt med API-nyckel')",
  "expect(legacyGuide).toContain('The canonical human-readable documentation is served at')",
)
source = source.replace(
  "expect(legacyGuide).toContain('API-nyckeln avgör tenant, bolag och scopes')",
  "expect(legacyGuide).toContain('The API credential determines the organization and permissions.')\n    expect(legacyGuide).toContain('**Gridex platform** owns published electricity offers')\n    expect(legacyGuide).toContain('**Your integration** owns the customer experience')\n    expect(legacyGuide).not.toMatch(/\\btenant\\b/i)\n    expect(legacyGuide).not.toMatch(/\\bOPS\\b/)\n    expect(legacyGuide).not.toContain('company_id')",
)

for (const legacy of [
  'Frontend får aldrig anropa OPS direkt med API-nyckel',
  'API-nyckeln avgör tenant, bolag och scopes',
]) {
  if (source.includes(legacy)) throw new Error(`Legacy developer-guide assertion remains: ${legacy}`)
}

fs.writeFileSync(file, source)
console.log(`${file}: synchronized with the professional public API boundary`)
