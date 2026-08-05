const fs = require('node:fs')
const path = require('node:path')

const root = path.resolve(__dirname, '../..')
const websitePath = path.join(root, 'docs/openapi/website-integration-v1.json')
const portalPath = path.join(root, 'docs/openapi/customer-portal-v1.json')
const runtimePath = path.join(
  root,
  'lib/integrations/websiteIntegrationContract.ts',
)

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'))
}

const website = readJson(websitePath)
const portal = readJson(portalPath)
const runtimeSource = fs.readFileSync(runtimePath, 'utf8')
const runtimeMatch = runtimeSource.match(
  /WEBSITE_INTEGRATION_CONTRACT_VERSION\s*=\s*['"]([^'"]+)['"]/,
)

if (!runtimeMatch) {
  throw new Error('Could not resolve WEBSITE_INTEGRATION_CONTRACT_VERSION.')
}

const currentContractVersion = website.info?.version
if (
  typeof currentContractVersion !== 'string' ||
  portal.info?.version !== currentContractVersion ||
  website['x-contract-schema-version'] !== currentContractVersion ||
  portal['x-contract-schema-version'] !== currentContractVersion ||
  runtimeMatch[1] !== currentContractVersion
) {
  throw new Error(
    `Current API contract version drift: website=${website.info?.version}, portal=${portal.info?.version}, runtime=${runtimeMatch[1]}`,
  )
}

function currentReleasePath(fileName) {
  return path.join(
    'docs/openapi/releases',
    currentContractVersion,
    fileName,
  )
}

module.exports = {
  currentContractVersion,
  currentReleasePath,
}
