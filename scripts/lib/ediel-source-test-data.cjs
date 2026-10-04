'use strict'
const fs = require('node:fs')
const path = require('node:path')
const { createRequire } = require('node:module')
const { SyntheticModule } = require('node:vm')

// The isolated source tests use the real pure parser/crypto dependencies and
// the same frozen manifest as the guide authority. Database, transport and
// all other data imports remain denied by each test's explicit boundaries.
function loadEdielSourceTestData(specifier, root, modules, context) {
  const manifest = '@/docs/ediel/masterplan-v2/registers/source_manifest.json'
  if (![manifest, 'node:crypto', 'crypto', 'node:util', 'node:fs/promises', 'node:os', 'node:path', 'fast-xml-parser', '@/lib/supabase/service', '@/lib/masterdata/db', '@/lib/cis/db-routes', 'node:child_process', 'dns', 'net'].includes(specifier)) return undefined
  if (!modules.has(specifier)) {
    let exports
    if (specifier === manifest) exports = { default: JSON.parse(fs.readFileSync(path.join(root, specifier.slice(2)), 'utf8')) }
    else if (specifier === 'node:crypto' || specifier === 'crypto') {
      const { createHash, randomUUID, randomBytes, X509Certificate } = require('node:crypto')
      exports = { createHash, randomUUID, randomBytes, X509Certificate }
    } else if (specifier === 'node:util') {
      const { isDeepStrictEqual, promisify } = require('node:util')
      exports = { isDeepStrictEqual, promisify }
    } else if (specifier === 'node:fs/promises') {
      const denied = () => { throw new Error('Unexpected filesystem operation in isolated Ediel source test') }
      exports = { mkdtemp: denied, writeFile: denied, rm: denied }
    } else if (specifier === 'node:os') exports = { tmpdir: require('node:os').tmpdir }
    else if (specifier === 'node:path') exports = { join: require('node:path').join }
    else if (specifier === '@/lib/supabase/service') {
      const denied = () => { throw new Error('Unexpected database operation in isolated Ediel source test') }
      exports = { supabaseService: { from: denied, rpc: denied } }
    } else if (specifier === '@/lib/masterdata/db') {
      const denied = () => { throw new Error('Unexpected masterdata operation in isolated Ediel source test') }
      exports = { getGridOwnerById: denied, getMeteringPointById: denied, getCustomerSiteById: denied }
    } else if (specifier === '@/lib/cis/db-routes') {
      exports = { findBestCommunicationRoute: () => { throw new Error('Unexpected route lookup in isolated Ediel source test') } }
    } else if (specifier === 'node:child_process') {
      exports = { execFile: () => { throw new Error('Unexpected subprocess in isolated Ediel source test') } }
    } else if (specifier === 'dns') {
      const denied = () => { throw new Error('Unexpected DNS operation in isolated Ediel source test') }
      exports = { promises: { resolve: denied, resolveTxt: denied, resolveMx: denied, lookup: denied } }
    } else if (specifier === 'net') exports = { default: { isIP: require('node:net').isIP } }
    else {
      const { XMLParser, XMLValidator } = createRequire(path.join(root, 'package.json'))('fast-xml-parser')
      exports = { XMLParser, XMLValidator }
    }
    modules.set(specifier, new SyntheticModule(Object.keys(exports), function () {
      for (const [name, value] of Object.entries(exports)) this.setExport(name, value)
    }, context ? { context, identifier: specifier } : { identifier: specifier }))
  }
  return modules.get(specifier)
}

module.exports = { loadEdielSourceTestData }
