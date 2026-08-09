#!/usr/bin/env node
// Regression: customer portal sync controlled input errors must not become 500s.

const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const routePath = path.join(
  process.cwd(),
  'app',
  'api',
  'v1',
  'customer-portal',
  'sync',
  'route.ts',
)
const source = fs.readFileSync(routePath, 'utf8')

assert.match(
  source,
  /import\s*\{[^}]*ApiInputError[^}]*readJsonObject[^}]*\}\s*from\s*['"]@\/lib\/api\/strictRequest['"]/s,
  'portal sync must import ApiInputError with readJsonObject',
)
assert.match(
  source,
  /const controlled = error instanceof ApiInputError/,
  'portal sync catch must identify controlled input errors',
)
assert.match(
  source,
  /const status = controlled \? error\.status : 500/,
  'portal sync must preserve controlled HTTP status',
)
assert.match(
  source,
  /const errorCode = controlled \? error\.code : ['"]portal_sync_failed['"]/,
  'portal sync must preserve controlled error code and use a stable unexpected-failure code',
)
assert.match(
  source,
  /statusCode:\s*status/,
  'integration request logging must use the actual response status',
)
assert.match(
  source,
  /\{ status \}\)/,
  'portal response must use the computed status',
)
assert.match(
  source,
  /controlled && error\.field \? \{ field: error\.field \} : \{\}/,
  'controlled field attribution must be preserved',
)
assert.doesNotMatch(
  source,
  /clientMessage\s*=\s*error instanceof Error \? error\.message/,
  'unexpected internal error messages must not be returned to clients',
)

console.log('Customer portal sync error-contract regression passed.')
