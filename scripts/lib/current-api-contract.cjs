const fs = require('node:fs')
const path = require('node:path')

const root = path.resolve(__dirname, '../..')
const runtimeSource = fs.readFileSync(path.join(root, 'lib/integrations/websiteIntegrationContract.ts'), 'utf8')
function resolveVersion(name) {
  const match = runtimeSource.match(new RegExp(`${name}\\s*=\\s*['"]([^'"]+)['"]`))
  if (!match || !/^\d{4}-\d{2}-\d{2}\.\d+$/.test(match[1])) {
    throw new Error(`Could not resolve valid ${name}.`)
  }
  return match[1]
}
const currentDocumentationVersion = resolveVersion('API_DOCUMENTATION_VERSION')
const runtimeContractVersion = resolveVersion('WEBSITE_INTEGRATION_CONTRACT_VERSION')
for (const name of ['website-integration-v1', 'customer-portal-v1', 'staff-v1']) {
  const document = JSON.parse(fs.readFileSync(path.join(root, `docs/openapi/${name}.json`), 'utf8'))
  if (document.info?.version !== currentDocumentationVersion || document['x-contract-schema-version'] !== runtimeContractVersion) {
    throw new Error(`Current API revision drift (${name}): documentation=${document.info?.version}, runtime=${document['x-contract-schema-version']}; expected documentation=${currentDocumentationVersion}, runtime=${runtimeContractVersion}`)
  }
}
function currentReleasePath(fileName) {
  return path.join('docs/openapi/releases', currentDocumentationVersion, fileName)
}
module.exports = {
  // Legacy consumers use this name to locate documents, not business wire metadata.
  currentContractVersion: currentDocumentationVersion,
  currentDocumentationVersion,
  runtimeContractVersion,
  currentReleasePath,
}
