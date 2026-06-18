/* Prevent accidental transport of raw provider/SQL errors to API clients. */
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const root = path.resolve(__dirname, '..', 'app', 'api')
const files = []
function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const file = path.join(dir, entry.name)
    if (entry.isDirectory()) walk(file)
    else if (entry.name === 'route.ts') files.push(file)
  }
}
walk(root)
const forbidden = [
  /NextResponse\.json\(\{[^\n]*error:\s*message[^\n]*\}/,
  /customerPortalJson\(\{[^\n]*error:\s*message[^\n]*\}/,
  /error:\s*error instanceof Error \? error\.message/,
]
const violations = []
for (const file of files) {
  const source = fs.readFileSync(file, 'utf8')
  for (const pattern of forbidden) {
    if (pattern.test(source)) violations.push(`${path.relative(process.cwd(), file)} matches ${pattern}`)
  }
}
assert.deepEqual(violations, [], `unsafe API error boundaries:\n${violations.join('\n')}`)
console.log(`API error boundary regression passed (${files.length} routes scanned).`)
