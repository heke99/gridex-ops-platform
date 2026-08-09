const fs = require('node:fs')
const path = require('node:path')

const root = path.resolve(__dirname, '../..')
const websitePath = path.join(root, 'docs/openapi/website-integration-v1.json')
const portalPath = path.join(root, 'docs/openapi/customer-portal-v1.json')
const apiContractPath = path.join(root, 'lib/integrations/apiContract.ts')
const websiteContractPath = path.join(
  root,
  'lib/integrations/websiteIntegrationContract.ts',
)

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'))
}

const website = readJson(websitePath)
const portal = readJson(portalPath)
const apiContractSource = fs.readFileSync(apiContractPath, 'utf8')
const websiteContractSource = fs.readFileSync(websiteContractPath, 'utf8')

const canonicalVersionMatch = apiContractSource.match(
  /CURRENT_API_CONTRACT\s*=\s*\{[\s\S]*?version:\s*['"]([^'"]+)['"]/,
)

if (!canonicalVersionMatch) {
  throw new Error('Could not resolve CURRENT_API_CONTRACT.version.')
}

if (
  !/WEBSITE_INTEGRATION_CONTRACT_VERSION\s*=\s*CURRENT_API_CONTRACT\.version/.test(
    websiteContractSource,
  )
) {
  throw new Error(
    'WEBSITE_INTEGRATION_CONTRACT_VERSION must derive from CURRENT_API_CONTRACT.version.',
  )
}

const currentContractVersion = canonicalVersionMatch[1]
if (
  website.info?.version !== currentContractVersion ||
  portal.info?.version !== currentContractVersion ||
  website['x-contract-schema-version'] !== currentContractVersion ||
  portal['x-contract-schema-version'] !== currentContractVersion
) {
  throw new Error(
    `Current API contract version drift: website=${website.info?.version}, portal=${portal.info?.version}, canonical=${currentContractVersion}`,
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
