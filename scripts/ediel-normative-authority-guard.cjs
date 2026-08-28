#!/usr/bin/env node
'use strict'

const fs = require('node:fs')
const path = require('node:path')

const DEAD_PROFILE_FILES = [
  'lib/ediel/core/messageBuilder/profiles/prodat26A.ts',
  'lib/ediel/core/messageBuilder/profiles/utiltsE5SE5A.ts',
  'lib/ediel/core/messageBuilder/profiles/utiltsErrE5SE5A.ts',
  'lib/ediel/core/messageBuilder/profiles/aperakProfiles.ts',
  'lib/ediel/core/messageBuilder/profiles/contrlEdiel2.ts',
]

// Files that are allowed to OWN hand-maintained normative Ediel matrices.
// Projections may consume these registries, but must not recreate their rows.
const MATRIX_AUTHORITY_ALLOWLIST = new Set([
  'lib/ediel/ack/canonicalAckEngine.ts',
  'lib/ediel/prodat/prodat26AFieldMatrix.ts',
  'lib/ediel/rulebook/codeRules.ts',
  'lib/ediel/rulebook/fieldMatrix.ts',
  'lib/ediel/rulebook/guideRegistry.ts',
  'lib/ediel/rulebook/prodatApplicationReference.ts',
  'lib/ediel/rulebook/prodatRulebook.ts',
  'lib/ediel/rulebook/prodatSubtypeRegistry.ts',
  'lib/ediel/rulebook/utilts25A4.ts',
  'lib/ediel/rulebook/utiltsApplicationReference.ts',
  'lib/ediel/rulebook/utiltsFieldMatrix.ts',
  'lib/ediel/rulebook/utiltsRulebook.ts',
])

// Exact protocol identifiers may appear in canonical authorities and in the
// small set of codecs/parsers that must recognize or serialize those tokens.
// Adding a new file here is an architecture decision and should be reviewed.
const NORMATIVE_LITERAL_ALLOWLIST = new Set([
  ...MATRIX_AUTHORITY_ALLOWLIST,
  'lib/ediel/ack/inboundAckOutcome.ts',
  'lib/ediel/ack.ts',
  'lib/ediel/core/ackPreflight.ts',
  'lib/ediel/core/messageBuilder/payloadPreflight.ts',
  'lib/ediel/core/messageBuilder/segmentSchema.ts',
  'lib/ediel/specRegistry.ts',
  'lib/ediel/transport/index.part-2.ts',
  'lib/ediel/utilts.ts',
  'lib/ediel/utiltsEngine.part-1.ts',
  'lib/ediel/verification/rulePackVerification.ts',
])

// Effective dates / guide identifiers have exactly these source-controlled
// owners. A projection must read them from a profile/guide, never repeat them.
const VALIDITY_AUTHORITY_ALLOWLIST = new Set([
  'lib/ediel/rulebook/guideRegistry.ts',
  'lib/ediel/rulebook/prodatRulebook.ts',
  'lib/ediel/rulebook/prodatSubtypeRegistry.ts',
  'lib/ediel/rulebook/utilts25A4.ts',
  'lib/ediel/rulebook/utiltsRulebook.ts',
])

// These modules expose narrowed TypeScript shapes or compatibility views whose
// values are populated from canonical profiles. They may repeat a literal in a
// TYPE position but are forbidden from becoming independent matrix owners.
const VALIDITY_PROJECTION_ALLOWLIST = new Set([
  'lib/ediel/rulebook/prodatRuntimeProfileRegistry.ts',
])

function normalize(file) {
  return file.replaceAll('\\', '/')
}

function runtimeFiles(root) {
  const roots = ['lib', 'app', 'components']
    .map((relative) => path.join(root, relative))
    .filter((absolute) => fs.existsSync(absolute))
  const files = []
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) {
        if (['node_modules', '.next', '__tests__', 'testing'].includes(entry.name)) continue
        walk(full)
        continue
      }
      if (!/\.(?:ts|tsx|js|jsx)$/.test(entry.name)) continue
      if (/\.(?:test|spec)\./.test(entry.name)) continue
      files.push(full)
    }
  }
  for (const rootDir of roots) walk(rootDir)
  return files
}

function literalCodeCount(source, family) {
  const regex = family === 'PRODAT'
    ? /['"]Z\d{2}[A-Z]*['"]/g
    : /['"](?:S\d{2}|E\d{2}|ERR)['"]/g
  return (source.match(regex) ?? []).length
}

function scanNormativeAuthority(root = process.cwd()) {
  const violations = []
  const exists = (relative) => fs.existsSync(path.join(root, relative))
  const read = (relative) => fs.readFileSync(path.join(root, relative), 'utf8')

  for (const file of DEAD_PROFILE_FILES) {
    if (exists(file)) violations.push(`${file}: dead legacy profile must stay deleted`)
  }

  const routeMatrixPath = 'lib/ediel/routeMatrix.ts'
  if (exists(routeMatrixPath)) {
    const routeMatrix = read(routeMatrixPath)
    for (const forbidden of [
      'ackModeForProcess',
      'applicationReferenceForProcess',
      'resolveApplicationReference',
      'canonicalAckRequirements',
      'getCanonicalUtiltsProfile',
    ]) {
      if (routeMatrix.includes(forbidden)) {
        violations.push(`${routeMatrixPath}: transport layer must not own ${forbidden}`)
      }
    }
  }

  const specRegistryPath = 'lib/ediel/specRegistry.ts'
  if (exists(specRegistryPath)) {
    const registry = read(specRegistryPath)
    if (registry.includes('LEGACY_EDIEL_INSTRUCTION_SPECS')) {
      violations.push(`${specRegistryPath}: legacy PRODAT/UTILTS instruction matrix must not return`)
    }
    if (!registry.includes('currentVersion: profile.guideVersion')) {
      violations.push(`${specRegistryPath}: PRODAT version must project profile.guideVersion`)
    }
    if (!registry.includes('validFrom: profile.effectiveFrom')) {
      violations.push(`${specRegistryPath}: validity must project profile.effectiveFrom`)
    }
    if (!registry.includes("...canonicalAckFields('PRODAT', profile.messageCode)")) {
      violations.push(`${specRegistryPath}: PRODAT ACK fields must project canonical ACK authority`)
    }
    if (!registry.includes("...canonicalAckFields('UTILTS', profile.messageCode)")) {
      violations.push(`${specRegistryPath}: UTILTS ACK fields must project canonical ACK authority`)
    }
  }

  for (const absolute of runtimeFiles(root)) {
    const relative = normalize(path.relative(root, absolute))
    const source = fs.readFileSync(absolute, 'utf8')

    // Old route compatibility APIs are forbidden everywhere in production
    // runtime. Longer canonical function names do not match these word-boundary
    // patterns.
    if (/\backModeForProcess\b/.test(source)) {
      violations.push(`${relative}: legacy ackModeForProcess compatibility API is forbidden`)
    }
    if (/\bapplicationReferenceForProcess\b/.test(source)) {
      violations.push(`${relative}: legacy applicationReferenceForProcess compatibility API is forbidden`)
    }

    // Direct association-assigned-code CONSTANTS are a common way a parallel
    // rule source reappears. Exact codecs/parsers are explicitly allowlisted.
    const ownsAssociationLiteral = /(?:export\s+)?const\s+[A-Za-z0-9_]*(?:UNH|VERSION|ASSOCIATION|GUIDE)[A-Za-z0-9_]*\s*(?::[^=]+)?=\s*['"][^'"]*(?:E2SE6A|E5SE5A)[^'"]*['"]/i.test(source)
    if (ownsAssociationLiteral && !NORMATIVE_LITERAL_ALLOWLIST.has(relative)) {
      violations.push(`${relative}: owns E2SE6A/E5SE5A literal outside explicit allowlist`)
    }

    // Detect only literal array/object matrix ownership. Derived projections
    // such as `const utiltsProfiles = UTILTS_CANONICAL_PROFILES.map(...)` are
    // consumers, not parallel authorities, and deliberately do not trigger.
    const matrixDeclaration = /(?:export\s+)?const\s+[A-Za-z0-9_]*(?:PRODAT|UTILTS)[A-Za-z0-9_]*(?:CODES?|MATRIX|PROFILES?|RULES?)[A-Za-z0-9_]*\s*(?::[^=]+)?=\s*[\[{]/i.test(source)
    if (matrixDeclaration && !MATRIX_AUTHORITY_ALLOWLIST.has(relative)) {
      const prodatCodes = literalCodeCount(source, 'PRODAT')
      const utiltsCodes = literalCodeCount(source, 'UTILTS')
      if (prodatCodes >= 4 || utiltsCodes >= 4) {
        violations.push(`${relative}: hand-maintained Ediel code/profile matrix outside canonical allowlist (PRODAT=${prodatCodes}, UTILTS=${utiltsCodes})`)
      }
    }

    // Guide validity must never be repeated by ordinary runtime modules. A
    // separately reviewed projection allowlist covers narrowed TS compatibility
    // shapes whose actual runtime values are read from canonical profiles.
    const ownsValidityLiteral = /(?:guideVersion|guideRevision|associationAssignedCode|effectiveFrom|effectiveTo)\s*:\s*['"][^'"]+['"]/g.test(source)
    if (
      ownsValidityLiteral &&
      !VALIDITY_AUTHORITY_ALLOWLIST.has(relative) &&
      !VALIDITY_PROJECTION_ALLOWLIST.has(relative)
    ) {
      violations.push(`${relative}: owns guide/version/effective-date literal outside validity authority/projection allowlist`)
    }
  }

  return [...new Set(violations)].sort()
}

module.exports = { scanNormativeAuthority }

if (require.main === module) {
  const violations = scanNormativeAuthority(process.cwd())
  if (violations.length) {
    console.error(`Ediel normative authority guard failed (${violations.length})`)
    for (const violation of violations) console.error(`- ${violation}`)
    process.exit(1)
  }
  console.log('Ediel normative authority guard passed.')
}
