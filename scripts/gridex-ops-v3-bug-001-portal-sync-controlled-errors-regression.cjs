/* eslint-disable @typescript-eslint/no-require-imports */
/**
 * GRIDEX-OPS-V3-BUG-001 — controlled 400/413 portal input errors must not become 500.
 *
 * Legacy /api/v1/customer-portal/sync already preserves ApiInputError via the #99
 * inline classifier. This residual closes the same class on nearby parse-outside-try
 * variants: /api/v1/customer/sync and /api/v1/customer/portal-bundle POST.
 */
const fs = require('fs')
const path = require('path')

const root = process.cwd()

function fail(message) {
  console.error(`GRIDEX-OPS-V3-BUG-001 regression failed: ${message}`)
  process.exit(1)
}
function check(condition, message) {
  if (!condition) fail(message)
}

const legacySyncPath = path.join(root, 'app', 'api', 'v1', 'customer-portal', 'sync', 'route.ts')
const canonicalSyncPath = path.join(root, 'app', 'api', 'v1', 'customer', 'sync', 'route.ts')
const portalBundlePath = path.join(root, 'app', 'api', 'v1', 'customer', 'portal-bundle', 'route.ts')
const helperPath = path.join(root, 'lib', 'customer-portal', 'externalApi.ts')

for (const filePath of [legacySyncPath, canonicalSyncPath, portalBundlePath, helperPath]) {
  check(fs.existsSync(filePath), `missing ${path.relative(root, filePath)}`)
}

const legacySync = fs.readFileSync(legacySyncPath, 'utf8')
const canonicalSync = fs.readFileSync(canonicalSyncPath, 'utf8')
const portalBundle = fs.readFileSync(portalBundlePath, 'utf8')
const helper = fs.readFileSync(helperPath, 'utf8')

check(helper.includes('export function handleCustomerPortalRouteError'), 'shared portal error helper missing')
check(helper.includes('input.error instanceof ApiInputError'), 'helper must preserve ApiInputError status/code')

check(legacySync.includes('error instanceof ApiInputError'), 'legacy sync must identify controlled ApiInputError')
check(
  /const status = controlled \? error\.status : 500/.test(legacySync) ||
    /catch\s*\(\s*error\s*\)\s*\{[\s\S]*handleCustomerPortalRouteError\s*\(/.test(legacySync),
  'legacy sync must preserve controlled status via inline classifier or shared helper',
)
check(
  !/statusCode:\s*500,[\s\S]{0,120}errorCode:\s*'Kundlänkning kunde inte behandlas\.'/.test(legacySync),
  'legacy sync must not force every catch path to status 500',
)

check(canonicalSync.includes('handleCustomerPortalRouteError'), 'canonical customer sync must keep shared error helper')
check(
  /try\s*\{[\s\S]*readJsonObject\s*\(\s*request\s*\)[\s\S]*\}\s*catch/.test(canonicalSync),
  'canonical customer sync must parse JSON inside try/catch so ApiInputError is controlled',
)

check(portalBundle.includes('handleCustomerPortalRouteError'), 'portal-bundle must keep shared error helper')
check(
  /export async function POST\([\s\S]*try\s*\{[\s\S]*readJsonObject\s*\(\s*request\s*\)[\s\S]*\}\s*catch/.test(portalBundle),
  'portal-bundle POST must parse JSON inside try/catch so ApiInputError is controlled',
)

console.log('GRIDEX-OPS-V3-BUG-001 static regression passed.')
