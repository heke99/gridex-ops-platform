#!/usr/bin/env node
// Batch 2 regression: Z01 / facility lookup no-placeholder hardening.
// Verifies UNKNOWN/placeholder identifiers can never be rendered/sent, and that a
// missing or invalid Z01 facility identity is held before rendering.
const fs = require('fs')
const path = require('path')
const root = process.cwd()
// TypeScript sources are formatter-dependent (single vs double quotes); the
// static assertions below are structural, so quotes are normalized for
// .ts/.tsx haystacks to keep the checks meaningful across formatter runs.
function read(file) {
  const source = fs.readFileSync(path.join(root, file), 'utf8')
  return /\.(ts|tsx)$/.test(file) ? source.replace(/"/g, "'") : source
}
function assert(ok, msg) { if (!ok) { console.error(`\u2717 ${msg}`); process.exitCode = 1 } else console.log(`\u2713 ${msg}`) }

const guard = read('lib/ediel/intent/noPlaceholderGuard.ts')
// The generic builder was renamed to the profile-driven renderer.
const generic = read('lib/ediel/prodat/builders/profileRenderer.ts')
const prodat = read('lib/ediel/prodat.ts')
const dispatch = read('lib/customer-operations/facilityLookupEdifactDispatch.ts')
const renderer = read('lib/ediel/intent/renderers/facilityLookupZ01.ts')
const engine = read('lib/ediel/intent/intentEngine.ts')

// No-placeholder guard
for (const token of ['UNKNOWN', 'MISSING', 'PLACEHOLDER']) {
  assert(guard.includes(`'${token}'`), `no-placeholder guard forbids ${token}`)
}
assert(guard.includes("'N/A'"), 'no-placeholder guard forbids N/A')
assert(guard.includes('export function collectPlaceholderViolations'), 'guard exposes collectPlaceholderViolations')
assert(guard.includes('export function isPlaceholderIdentifier'), 'guard exposes isPlaceholderIdentifier')

// The generic PRODAT builder no longer fabricates UNKNOWN and omits LIN when no id
assert(!/\|\|\s*'UNKNOWN'/.test(generic), "generic PRODAT builder no longer falls back to 'UNKNOWN'")
assert(generic.includes('hasObjectIdentifier') && generic.includes('if (hasObjectIdentifier)'), 'generic builder only emits LIN object id when a real id exists')
assert(generic.includes('objectIdentifierMissing'), 'generic builder reports objectIdentifierMissing diagnostic')

// Installation NAD output must retain address-only behavior without inventing
// identity/agency. Run the real helper AND the profile builder, including
// positive identity/agency/escaping controls, instead of matching source text.
require('node:child_process').execFileSync(process.execPath, [
  'node_modules/vitest/vitest.mjs', 'run', '__tests__/ediel-release-rendering-regression.test.ts',
  '-t', 'installation identity release rendering contract',
], { cwd: root, stdio: 'inherit' })

// Switch render path no longer fabricates UNKNOWN
assert(!/\|\|\s*'UNKNOWN'/.test(prodat), "prodat.ts switch render no longer falls back to 'UNKNOWN'")

// Facility lookup dispatcher no longer uses the UNKNOWN placeholder
assert(!dispatch.includes("meterPointPlaceholder = 'UNKNOWN'"), 'facility dispatch no longer sets meterPointPlaceholder = UNKNOWN')
assert(!dispatch.includes("'UNKNOWN'"), 'facility dispatch contains no UNKNOWN literal')

// Z01 requires a real ObjectId/LIN. Inspect the named renderer's executable
// statements with the existing TypeScript parser; comments cannot satisfy holds.
const ts = require('typescript')
const z01File = ts.createSourceFile('facilityLookupZ01.ts', fs.readFileSync(path.join(root, 'lib/ediel/intent/renderers/facilityLookupZ01.ts'), 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
const z01Printer = ts.createPrinter({ removeComments: true })
const z01Text = node => node ? z01Printer.printNode(ts.EmitHint.Unspecified, node, z01File).replace(/"/g, "'").replace(/\s+/g, '') : ''
const z01Functions = z01File.statements.filter(node => ts.isFunctionDeclaration(node) && node.name?.text === 'buildFacilityLookupZ01Draft')
const z01Statements = z01Functions.length === 1 ? z01Functions[0].body?.statements ?? [] : []
const z01Const = (statements, name) => {
  const declarations = statements.flatMap(statement => ts.isVariableStatement(statement) && (statement.declarationList.flags & ts.NodeFlags.Const) ? [...statement.declarationList.declarations] : [])
  const matches = declarations.filter(declaration => ts.isIdentifier(declaration.name) && declaration.name.text === name)
  return matches.length === 1 ? matches[0] : undefined
}
const z01Property = (object, name) => {
  if (!object || !ts.isObjectLiteralExpression(object)) return undefined
  const matches = object.properties.filter(property => ts.isPropertyAssignment(property) && ts.isIdentifier(property.name) && property.name.text === name)
  return matches.length === 1 ? matches[0] : undefined
}
const z01NamedCall = (node, name) => node && ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === name
const z01StatementIndex = declaration => declaration ? z01Statements.findIndex(statement => ts.isVariableStatement(statement) && statement.declarationList.declarations.includes(declaration)) : -1
const z01AllowedFlag = z01Const(z01File.statements, 'Z01_FACILITY_LOOKUP_ALLOWS_MISSING_IDENTIFIER')
const z01AllowedMissing = z01Const(z01Statements, 'allowedMissing')
const z01Rendered = z01Const(z01Statements, 'rendered')
const z01Envelope = z01Const(z01Statements, 'envelope')
const z01Context = z01Property(z01Rendered?.initializer?.arguments?.[0], 'context')
const z01MeterPointId = z01Property(z01Context?.initializer, 'meterPointId')
const z01IdentityHoldOffset = z01Statements.findIndex(statement =>
  ts.isIfStatement(statement) &&
  z01Text(statement.expression) === '!resolvedFacilityIdentifier||!/^\\d{18}$/.test(resolvedFacilityIdentifier)' &&
  ts.isThrowStatement(statement.thenStatement) &&
  z01Text(statement.thenStatement.expression) === "newError('facility_lookup_verified_object_identity_required')" &&
  !statement.elseStatement,
)
const z01RenderOffset = z01StatementIndex(z01Rendered)
const z01EnvelopeOffset = z01StatementIndex(z01Envelope)
assert(
  z01File.parseDiagnostics.length === 0 &&
  z01AllowedFlag?.parent.parent.modifiers?.some(modifier => modifier.kind === ts.SyntaxKind.ExportKeyword) &&
  z01AllowedFlag.initializer?.kind === ts.SyntaxKind.FalseKeyword &&
  z01AllowedMissing?.initializer && ts.isArrayLiteralExpression(z01AllowedMissing.initializer) && z01AllowedMissing.initializer.elements.length === 0 &&
  z01NamedCall(z01Rendered?.initializer, 'renderProdat26A') &&
  z01NamedCall(z01Envelope?.initializer, 'buildEdifactEnvelope') &&
  z01IdentityHoldOffset >= 0 && z01IdentityHoldOffset < z01RenderOffset &&
  z01RenderOffset < z01EnvelopeOffset &&
  z01MeterPointId?.initializer && ts.isIdentifier(z01MeterPointId.initializer) && z01MeterPointId.initializer.text === 'resolvedFacilityIdentifier',
  'facility renderer holds missing/invalid Z01 identity before rendering and passes the real identifier directly',
)
assert(renderer.includes('Z01_FACILITY_LOOKUP_ALLOWS_MISSING_IDENTIFIER'), 'facility renderer documents the allowed-missing rule for Z01')

// Intent validation runs the no-placeholder guard
assert(engine.includes('collectPlaceholderViolations'), 'intent validation gate runs the no-placeholder guard')

// waiting_response only after outbox queue (queued dispatch_status path)
assert(dispatch.includes("status: 'waiting_response'") && dispatch.includes("dispatch_status: 'queued'"), 'request becomes waiting_response with queued dispatch only after outbox queue')

// Tenant sees plain Swedish (technical detail kept for superadmin only)
const translator = read('lib/ediel/intent/tenantStatusTranslator.ts')
assert(translator.includes('translateBlockingReasonsForTenant') && translator.includes('Vi väntar på svar från nätägaren'), 'tenant status translator produces plain Swedish')
assert(dispatch.includes('translateBlockingReasonsForTenant') && dispatch.includes('technicalMessage'), 'blocked dispatch shows tenant Swedish and keeps technical message for superadmin')

if (process.exitCode) process.exit(process.exitCode)
console.log('\nBatch 2 Z01 no-placeholder regression passed.')
