'use strict'

const fs = require('node:fs')
const path = require('node:path')
const assert = require('node:assert/strict')
const { SyntheticModule } = require('node:vm')
const deniedAttempts = []

const specifier = '@/docs/ediel/masterplan-v2/registers/source_manifest.json'
const file = path.resolve(__dirname, '../../docs/ediel/masterplan-v2/registers/source_manifest.json')

// Load the same committed source authority as the real guide registry. Only
// this exact JSON dependency is allowed; unrelated imports keep their existing
// fail-closed loader checks. Use the caller's VM context and per-run cache.
function sourceManifestModule(request, modules, parent) {
  if (request !== specifier) return null
  if (!modules.has(file)) {
    const value = JSON.parse(fs.readFileSync(file, 'utf8'))
    modules.set(file, new SyntheticModule(['default'], function () {
      this.setExport('default', value)
    }, { identifier: file, context: parent.context }))
  }
  return modules.get(file)
}

function sourceRuntimeBoundary(request, modules, parent) {
  const manifest = sourceManifestModule(request, modules, parent)
  if (manifest) return manifest
  const deny = () => {
    deniedAttempts.push(request)
    throw new Error(`Unexpected external operation in source-only test: ${request}`)
  }
  // Public crypto and pure standard-library operations remain authentic.
  // Process, filesystem and customer-data I/O are explicitly denied, even
  // though current Ediel modules statically import their server adapters.
  const exports = {
    'fast-xml-parser': {
      XMLParser: require('fast-xml-parser').XMLParser,
      XMLValidator: require('fast-xml-parser').XMLValidator,
    },
    crypto: {
      createHash: require('node:crypto').createHash,
      randomUUID: require('node:crypto').randomUUID,
      randomBytes: require('node:crypto').randomBytes,
      X509Certificate: require('node:crypto').X509Certificate,
    },
    '@/lib/ediel/mailReadiness': {assertEdielSmtpReadiness:deny,edielSmtpConfig:deny,resendEventsConfig:deny,getMailReadiness:deny,STRATO_EDIEL_DNS_RECORDS:[],RESEND_EVENTS_DNS_GUIDANCE:[]},
    'node:child_process': { execFile: deny },
    'node:fs/promises': { mkdtemp: deny, writeFile: deny, rm: deny },
    'node:os': { tmpdir: require('node:os').tmpdir },
    'node:path': { join: require('node:path').join },
    'node:util': {
      promisify: require('node:util').promisify,
      isDeepStrictEqual: require('node:util').isDeepStrictEqual,
    },
    '@/lib/cis/db-shared': { getCustomerExportContext: deny, requireContextCompanyId: deny },
  }
  const key = request === 'node:crypto' ? 'crypto' : request
  if (!Object.hasOwn(exports, key)) return null
  const cacheKey = `source-only-boundary:${key}`
  if (!modules.has(cacheKey)) {
    const values = exports[key]
    modules.set(cacheKey, new SyntheticModule(Object.keys(values), function () {
      for (const [name, value] of Object.entries(values)) this.setExport(name, value)
    }, { identifier: cacheKey, context: parent.context }))
  }
  return modules.get(cacheKey)
}

function assertNoSourceBoundaryAttempts() {
  // A product catch must not hide an attempted subprocess, file or CIS access.
  assert.deepEqual(deniedAttempts, [], 'Source-only test attempted external I/O')
}

module.exports = { sourceManifestModule, sourceRuntimeBoundary, assertNoSourceBoundaryAttempts }
