#!/usr/bin/env node
'use strict'

const fs = require('node:fs')
const path = require('node:path')

const REQUIRED_CONTRACTS = [
  {
    file: 'lib/ediel/core/edifactSegments.ts',
    mustContain: ['parseCanonicalEdifactAst', 'tokenizeEdifact'],
    forbidden: [
      ['duplicate service-character reader', /function\s+readServiceChars\b/],
      ['duplicate segment splitter', /function\s+splitSegments\b/],
      ['duplicate release-character splitter', /function\s+splitReleased\b/],
    ],
  },
  {
    file: 'lib/ediel/rulebook/ruleProfileSelector.ts',
    mustContain: ['canonicalMessageFacts'],
    forbidden: [
      ['apostrophe raw-segment splitting', /\.split\(\s*["']'["']\s*\)/],
      ['plus raw-element splitting', /\.split\(\s*["']\+["']\s*\)/],
      ['raw DTM signature matching', /raw(?:Payload)?\.includes\(\s*["']DTM\+/],
      ['raw BGM signature matching', /raw(?:Payload)?\.includes\(\s*["']BGM\+/],
    ],
  },
  {
    file: 'lib/ediel/classify.ts',
    mustContain: ['parseCanonicalEdifactAst', 'extractCanonicalEdifactPayload'],
    forbidden: [
      ['legacy EDIFACT token matcher', /function\s+matchEdifactToken\b/],
      ['BGM regex parser', /BGM\\\+/],
      ['hard-coded UNZ apostrophe extractor', /UNZ\\\+\[\^'\]/],
    ],
  },
  {
    file: 'lib/inbound-mail/edielEmailParser.ts',
    mustContain: ['parseCanonicalEdifactAst', 'extractCanonicalEdifactPayload'],
    forbidden: [
      ['duplicate MIME EDIFACT extractor', /function\s+edifactStartIndex\b/],
      ['duplicate segment-terminator reader', /function\s+segmentTerminatorForPayload\b/],
    ],
  },
  {
    file: 'lib/ediel/inbound/productionInboundDecisionEngine.ts',
    mustContain: ['canonicalMessageFacts', 'applicationReference: facts.applicationReference'],
    forbidden: [
      ['raw PRODAT application-reference sniffing', /rawPayload\?\.includes\(\s*["']23-DGI-PRODAT["']/],
    ],
  },
]

function scanParserAuthority(root = process.cwd()) {
  const violations = []

  for (const contract of REQUIRED_CONTRACTS) {
    const absolute = path.join(root, contract.file)
    if (!fs.existsSync(absolute)) {
      violations.push(`${contract.file}: required canonical parser consumer is missing`)
      continue
    }
    const source = fs.readFileSync(absolute, 'utf8')
    for (const token of contract.mustContain) {
      if (!source.includes(token)) {
        violations.push(`${contract.file}: must consume ${token}`)
      }
    }
    for (const [label, pattern] of contract.forbidden) {
      if (pattern.test(source)) {
        violations.push(`${contract.file}: ${label} is forbidden; consume canonicalEdifactAst/edifactTokenizer instead`)
      }
    }
  }

  return [...new Set(violations)].sort()
}

module.exports = { scanParserAuthority }

if (require.main === module) {
  const violations = scanParserAuthority(process.cwd())
  if (violations.length) {
    console.error(`Ediel parser authority guard failed (${violations.length})`)
    for (const violation of violations) console.error(`- ${violation}`)
    process.exit(1)
  }
  console.log('Ediel parser authority guard passed.')
}
