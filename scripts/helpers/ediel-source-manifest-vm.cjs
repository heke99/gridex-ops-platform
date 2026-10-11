'use strict'

const fs = require('node:fs')
const path = require('node:path')
const assert = require('node:assert/strict')
const { SyntheticModule } = require('node:vm')
const deniedAttempts = []

const specifier = '@/docs/ediel/masterplan-v2/registers/source_manifest.json'
const file = path.resolve(__dirname, '../../docs/ediel/masterplan-v2/registers/source_manifest.json')

// Load the same committed source authority as the real guide registry. Only
// these exact committed JSON dependencies are allowed; unrelated imports keep their existing
// fail-closed loader checks. Use the caller's VM context and per-run cache.
function sourceManifestModule(request, modules, parent) {
  const grammarFile = path.resolve(__dirname, '../../lib/ediel/core/unsmGrammar.generated.json')
  const requestedGrammar = request === '@/lib/ediel/core/unsmGrammar.generated.json'
    || request === './unsmGrammar.generated.json' && parent.identifier === path.resolve(__dirname, '../../lib/ediel/core/unsmGrammar.ts')
  if (request !== specifier && !requestedGrammar) return null
  const sourceFile = requestedGrammar ? grammarFile : file
  if (!modules.has(sourceFile)) {
    const value = JSON.parse(fs.readFileSync(sourceFile, 'utf8'))
    modules.set(sourceFile, new SyntheticModule(['default'], function () {
      this.setExport('default', value)
    }, { identifier: sourceFile, context: parent.context }))
  }
  return modules.get(sourceFile)
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
    'node:async_hooks': {AsyncLocalStorage: require('node:async_hooks').AsyncLocalStorage},
    // routeRegistry uses the installed pure RFC address parser. This bridge
    // permits its actual parsing while all provider and I/O ports stay denied.
    'nodemailer/lib/addressparser': {default: require('nodemailer/lib/addressparser')},
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
    '@/lib/supabase/service': { supabaseService: { from: deny, rpc: deny, schema: deny } },
    '@/lib/supabase/tenantQuery': { tenantSelect: deny },
    '@/lib/masterdata/db': { getGridOwnerById: deny, getCustomerSiteById: deny, getMeteringPointById: deny },
    '@/lib/cis/db': { cancelSupplierSwitchOutboundAttemptsForReplacement: deny, createOutboundRequest: deny, findOpenOutboundBySource: deny, repairOutboundRequestCommunicationRoute: deny, updateOutboundRequestStatus: deny },
    '@/lib/cis/db-routes': { findBestCommunicationRoute: deny },
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
