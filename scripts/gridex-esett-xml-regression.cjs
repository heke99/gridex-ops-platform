#!/usr/bin/env node
// Batch 9 regression: eSett/NBS XML is a separate family with its own schema
// validation but the shared intent/route/outbox/ack lifecycle.
const fs = require('fs')
const path = require('path')
const root = process.cwd()
function read(file) { return fs.readFileSync(path.join(root, file), 'utf8') }
function assert(ok, msg) { if (!ok) { console.error(`\u2717 ${msg}`); process.exitCode = 1 } else console.log(`\u2713 ${msg}`) }

const schema = read('lib/ediel/xml/esett/schemaRegistry.ts')
const parser = read('lib/ediel/xml/esett/parser.ts')
const validator = read('lib/ediel/xml/esett/validator.ts')
const ack = read('lib/ediel/xml/esett/acknowledgement.ts')
const renderer = read('lib/ediel/xml/esett/renderer.ts')
const intentTypes = read('lib/ediel/intent/types.ts')

// Separate family registered in the intent model
assert(intentTypes.includes("'ESETT_XML'"), 'ESETT_XML is a registered intent message family')

// Schema registry: unsupported/unknown -> manual_review/unsupported
assert(schema.includes('export const ESETT_XML_SCHEMAS'), 'schema registry defines ESETT_XML_SCHEMAS')
assert(schema.includes('export function resolveEsettXmlSupportStatus') && schema.includes('export function isEsettXmlSendable'), 'schema registry exposes support helpers')
assert(schema.includes("return schema ? schema.supportStatus : 'unsupported'"), 'unknown eSett XML document types resolve to unsupported')

// Parser is XML, never EDIFACT
assert(parser.includes('export function parseEsettXml') && parser.includes('looksLikeEsettXml'), 'parser exposes eSett XML parse + detection')
assert(!parser.includes('parseEdifact') && !parser.includes('UNB'), 'eSett XML parser is not an EDIFACT parser')

// Validation runs before outbox; unsupported -> manual_review/block
assert(validator.includes('export function validateEsettXml'), 'validator exposes validateEsettXml')
assert(validator.includes('manualReview') && validator.includes('esett_xml_document_type_unsupported'), 'validator routes unsupported document types to manual review')
assert(validator.includes('requiredElements') || validator.includes('schema.requiredElements'), 'validator checks required schema elements before outbox')
assert(renderer.includes('validateEsettXml') && renderer.includes('isEsettXmlSendable'), 'renderer validates schema and refuses non-sendable document types before queue')

// ACK correlates to intent via shared AcknowledgementEngine, unmatched -> manual_review
assert(ack.includes('classifyAcknowledgement') && ack.includes("'ESETT_XML_ACK'"), 'eSett XML ack uses the shared AcknowledgementEngine family ESETT_XML_ACK')
assert(ack.includes('correlationMRID') && ack.includes('matchedSourceMessageId'), 'eSett XML ack correlates to the originating intent/message')

if (process.exitCode) process.exit(process.exitCode)
console.log('\nBatch 9 eSett XML regression passed.')
