/* eslint-disable @typescript-eslint/no-require-imports -- Pure static TypeScript contract parser. */
'use strict'

const ts = require('typescript')

const manualArguments = {
  p_company_id: 'input.companyId',
  p_request_id: 'input.requestId',
  p_actor_user_id: 'input.actorUserId ?? null',
  p_source: 'input.source',
  p_ediel_message_id: 'text(input.edielMessageId)',
  p_facility_id: 'facilityId',
  p_metering_point_external_id: 'meteringPointId',
  p_grid_area_code: 'gridAreaCode',
  p_price_area_code: 'priceAreaCode',
  p_source_party_grid_owner_id: 'text(input.sourcePartyGridOwnerId)',
  p_raw_payload: 'input.rawPayload ?? {}',
  p_note: 'text(input.note)',
}
const automaticArguments = {
  p_company_id: 'input.companyId',
  p_request_id: 'input.requestId',
  p_inbound_id: 'automatic.inboundId',
  p_payload: {
    sourceHash: 'automatic.sourceHash',
    facility_id: 'facilityId',
    metering_point_id: 'meteringPointId',
    grid_area_code: 'gridAreaCode',
    price_area_code: 'priceAreaCode',
    raw_payload: 'input.rawPayload ?? {}',
    extracted: 'asRecord(input.rawPayload?.extracted)',
    facts: 'automatic.facts ?? {}',
  },
}

function unwrap(node, types = false) {
  while (node && (ts.isParenthesizedExpression(node)
    || (types && (ts.isAsExpression(node) || ts.isTypeAssertionExpression(node))))) node = node.expression
  return node
}

function objectFields(node) {
  node = unwrap(node)
  if (!node || !ts.isObjectLiteralExpression(node)) return undefined
  const fields = new Map()
  for (const property of node.properties) {
    if (!ts.isPropertyAssignment(property)
      || !(ts.isIdentifier(property.name) || ts.isStringLiteral(property.name))
      || fields.has(property.name.text)) return undefined
    fields.set(property.name.text, property.initializer)
  }
  return fields
}

// Compare node meaning for this finite argument language. Never strip source
// whitespace inside literals or accept comments/unrelated text as a command.
function expressionKey(node) {
  node = unwrap(node)
  if (!node) return undefined
  if (ts.isIdentifier(node)) return ['identifier', node.text]
  if (ts.isStringLiteral(node)) return ['string', node.text]
  if (node.kind === ts.SyntaxKind.NullKeyword) return ['null']
  if (ts.isPropertyAccessExpression(node)) {
    const target = expressionKey(node.expression)
    return target && ['property', target, node.name.text, Boolean(node.questionDotToken)]
  }
  if (ts.isCallExpression(node) && !node.questionDotToken && !node.typeArguments) {
    const target = expressionKey(node.expression), args = node.arguments.map(expressionKey)
    return target && args.every(Boolean) ? ['call', target, args] : undefined
  }
  if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken) {
    const left = expressionKey(node.left), right = expressionKey(node.right)
    return left && right ? ['nullish', left, right] : undefined
  }
  const fields = objectFields(node)
  if (!fields) return undefined
  const values = [...fields].map(([name, value]) => [name, expressionKey(value)])
  return values.every(([, value]) => value) ? ['object', values.sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)] : undefined
}

const expectedExpressions = new Map()
function sameExpression(node, expected) {
  if (!expectedExpressions.has(expected)) {
    const source = ts.createSourceFile('expected.ts', 'const expected = (' + expected + ')', ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
    expectedExpressions.set(expected, JSON.stringify(expressionKey(source.statements[0].declarationList.declarations[0].initializer)))
  }
  const actual = expressionKey(node)
  return actual !== undefined && JSON.stringify(actual) === expectedExpressions.get(expected)
}

function sameArguments(node, expected) {
  const fields = objectFields(node), names = Object.keys(expected)
  return fields?.size === names.length && names.every(name => fields.has(name)
    && (typeof expected[name] === 'string'
      ? sameExpression(fields.get(name), expected[name])
      : sameArguments(fields.get(name), expected[name])))
}

function namedConst(statements, name) {
  const declarations = statements.filter(ts.isVariableStatement).flatMap(statement => [...statement.declarationList.declarations])
  const found = declarations.filter(declaration => ts.isIdentifier(declaration.name) && declaration.name.text === name)
  return found.length === 1 && (found[0].parent.flags & ts.NodeFlags.Const) ? found[0] : undefined
}

function isRpcCall(node) {
  return ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) && node.expression.name.text === 'rpc'
}

function resultBinding(declaration) {
  return Boolean(declaration.parent.flags & ts.NodeFlags.Const) && ts.isObjectBindingPattern(declaration.name)
    && declaration.name.elements.length === 2
    && ['data', 'error'].every(name => declaration.name.elements.some(element => ts.isIdentifier(element.name)
      && element.name.text === name && !element.dotDotDotToken && !element.initializer
      && (!element.propertyName || (ts.isIdentifier(element.propertyName) && element.propertyName.text === name))))
}

function verifyFacilityCompletionRpcContract(source) {
  const reject = reason => ({ ok: false, reasons: [reason] })
  if (typeof source !== 'string') return reject('source_required')
  const file = ts.createSourceFile('facilityLookupWorkflow.ts', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
  if (file.parseDiagnostics.length) return reject('syntax_invalid')
  const functions = file.statements.filter(node => ts.isFunctionDeclaration(node) && node.name?.text === 'completeFacilityLookup')
  const fn = functions[0]
  if (functions.length !== 1 || !fn.body || !fn.modifiers?.some(node => node.kind === ts.SyntaxKind.ExportKeyword)
    || !fn.modifiers.some(node => node.kind === ts.SyntaxKind.AsyncKeyword)
    || fn.parameters.length !== 1 || !ts.isIdentifier(fn.parameters[0].name) || fn.parameters[0].name.text !== 'input'
    || fn.parameters[0].dotDotDotToken || fn.parameters[0].questionToken || fn.parameters[0].initializer) return reject('entrypoint_invalid')

  const statements = [...fn.body.statements]
  const automatic = namedConst(statements, 'automatic'), client = namedConst(statements, 'rpcClient')
  if (!automatic || !sameExpression(automatic.initializer, 'input.automaticInbound')
    || !client || !sameExpression(unwrap(client.initializer, true), 'supabaseService')) return reject('source_or_client_binding_invalid')

  const calls = []
  function visit(node) {
    if (isRpcCall(node)) calls.push(node)
    ts.forEachChild(node, visit)
  }
  visit(fn.body)
  if (calls.length !== 1) return reject('one_rpc_call_required')
  const call = calls[0]
  const results = statements.filter(ts.isVariableStatement).flatMap(statement => [...statement.declarationList.declarations])
    .filter(declaration => declaration.initializer && ts.isAwaitExpression(unwrap(declaration.initializer))
      && unwrap(unwrap(declaration.initializer).expression) === call)
  if (results.length !== 1 || !resultBinding(results[0]) || call.questionDotToken || call.expression.questionDotToken
    || !sameExpression(call.expression.expression, 'rpcClient') || call.arguments.length !== 2) return reject('awaited_result_call_invalid')

  const target = unwrap(call.arguments[0]), args = unwrap(call.arguments[1])
  if (!ts.isConditionalExpression(target) || !ts.isConditionalExpression(args)
    || !sameExpression(target.condition, 'automatic') || !sameExpression(args.condition, 'automatic')
    || !sameExpression(target.whenTrue, "'gridex_apply_manual_facility_reply_v1'")
    || !sameExpression(target.whenFalse, "'gridex_complete_facility_response'")) return reject('rpc_branches_invalid')
  if (!sameArguments(args.whenTrue, automaticArguments) || !sameArguments(args.whenFalse, manualArguments)) return reject('rpc_arguments_invalid')
  return { ok: true, reasons: [] }
}

module.exports = { verifyFacilityCompletionRpcContract }
