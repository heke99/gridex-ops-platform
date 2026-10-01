'use strict'
/* eslint-disable @typescript-eslint/no-require-imports */

const ts = require('typescript')

function descendants(node, predicate) {
  const result = []
  function visit(current) {
    if (predicate(current)) result.push(current)
    ts.forEachChild(current, visit)
  }
  visit(node)
  return result
}

const only = (items) => items.length === 1 ? items[0] : null
const identifier = (node, name) => Boolean(node && ts.isIdentifier(node) && node.text === name)
const literal = (node, value) => Boolean(node && ts.isStringLiteral(node) && node.text === value)
const expressionText = (node, source) => node?.getText(source).replace(/\s/g, '')
const unwrapped = (node) => ts.isParenthesizedExpression(node) ? unwrapped(node.expression) : node
const binary = (node, kind) => Boolean(node && ts.isBinaryExpression(unwrapped(node)) && unwrapped(node).operatorToken.kind === kind)
const outcomeEquals = (node, outcome) => binary(node, ts.SyntaxKind.EqualsEqualsEqualsToken)
  && identifier(unwrapped(node).left, 'outcome') && literal(unwrapped(node).right, outcome)

function parse(source) {
  return ts.createSourceFile('source.ts', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
}

function exportedFunction(source, name) {
  return only(descendants(source, (node) => ts.isFunctionDeclaration(node) && identifier(node.name, name)
    && node.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword)))
}

function importedName(source, modulePath, exportName) {
  const bindings = []
  for (const node of source.statements) {
    if (!ts.isImportDeclaration(node) || !literal(node.moduleSpecifier, modulePath)) continue
    const named = node.importClause?.namedBindings
    if (!named || !ts.isNamedImports(named)) continue
    for (const binding of named.elements) {
      if (!binding.isTypeOnly && (binding.propertyName ?? binding.name).text === exportName) bindings.push(binding.name.text)
    }
  }
  return only(bindings)
}

function awaitedVariable(owner, callee) {
  return only(descendants(owner, (node) => ts.isVariableDeclaration(node) && node.initializer
    && ts.isAwaitExpression(node.initializer) && ts.isCallExpression(node.initializer.expression)
    && identifier(node.initializer.expression.expression, callee)))
}

function objectField(call, field, expected, source) {
  const object = call.arguments[0]
  return Boolean(object && ts.isObjectLiteralExpression(object) && object.properties.some((property) =>
    ts.isPropertyAssignment(property) && expressionText(property.name, source) === field
      && expressionText(property.initializer, source) === expected))
}

function typeScriptChain({ facade, legacy, adapter, worker }) {
  const facadeSource = parse(facade), legacySource = parse(legacy), adapterSource = parse(adapter), workerSource = parse(worker)
  const facadeOwner = exportedFunction(facadeSource, 'applyInboundBusinessStateMachine')
  const legacyName = importedName(facadeSource, './inboundBusinessStateMachineLegacy', 'applyInboundBusinessStateMachine')
  if (!facadeOwner || !legacyName || !awaitedVariable(facadeOwner, legacyName)) return false

  const legacyOwner = exportedFunction(legacySource, 'applyInboundBusinessStateMachine')
  const atomicName = importedName(legacySource, './inboundSwitchLifecycleAtomic', 'applyInboundSwitchLifecycleAtomically')
  if (!legacyOwner || !atomicName) return false
  const receipt = awaitedVariable(legacyOwner, atomicName)
  if (!receipt || !ts.isIdentifier(receipt.name)) return false
  const receiptCall = receipt.initializer.expression
  if (!objectField(receiptCall, 'sourceMessageId', 'input.message.id', legacySource)
    || !objectField(receiptCall, 'actorUserId', 'input.actorUserId', legacySource)) return false
  const branch = descendants(legacyOwner, (node) => ts.isIfStatement(node)
    && descendants(node.thenStatement, (item) => item === receipt).length === 1
    && descendants(node.thenStatement, (item) => ts.isReturnStatement(item) && identifier(item.expression, receipt.name.text)).length === 1)
  const atomicBranch = only(branch)
  if (!atomicBranch) return false
  const storedSourceName = importedName(legacySource, './inboundSwitchLifecycleAtomic', 'hasStoredInboundSupplierSwitchSource')
  const condition = unwrapped(atomicBranch.expression)
  if (!storedSourceName || !binary(condition, ts.SyntaxKind.BarBarToken)
    || !outcomeEquals(condition.left, 'supplier_switch_accepted')
    || !binary(condition.right, ts.SyntaxKind.AmpersandAmpersandToken)) return false
  const rejection = unwrapped(condition.right)
  if (!binary(rejection.left, ts.SyntaxKind.BarBarToken)
    || !outcomeEquals(unwrapped(rejection.left).left, 'business_rejection')
    || !outcomeEquals(unwrapped(rejection.left).right, 'technical_rejection')) return false
  const storedSource = unwrapped(rejection.right)
  if (!ts.isAwaitExpression(storedSource) || !ts.isCallExpression(storedSource.expression)
    || !identifier(storedSource.expression.expression, storedSourceName)
    || expressionText(storedSource.expression.arguments[0], legacySource) !== 'input.message.id') return false

  const adapterOwner = exportedFunction(adapterSource, 'applyInboundSwitchLifecycleAtomically')
  const serviceName = importedName(adapterSource, '@/lib/supabase/service', 'supabaseService')
  if (!adapterOwner || !serviceName) return false
  const rpc = only(descendants(adapterOwner, (node) => ts.isAwaitExpression(node) && ts.isCallExpression(node.expression)
    && ts.isPropertyAccessExpression(node.expression.expression)
    && identifier(node.expression.expression.expression, serviceName)
    && identifier(node.expression.expression.name, 'rpc')
    && literal(node.expression.arguments[0], 'gridex_apply_inbound_switch_lifecycle_v1')))
  if (!rpc) return false
  const args = rpc.expression.arguments[1]
  if (!args || !ts.isObjectLiteralExpression(args)
    || !args.properties.some((node) => ts.isPropertyAssignment(node) && identifier(node.name, 'p_source_message_id')
      && expressionText(node.initializer, adapterSource) === 'input.sourceMessageId')
    || !args.properties.some((node) => ts.isPropertyAssignment(node) && identifier(node.name, 'p_actor_user_id')
      && expressionText(node.initializer, adapterSource) === 'input.actorUserId')) return false
  if (!descendants(adapterOwner, (node) => ts.isIfStatement(node) && identifier(node.expression, 'error')
    && ts.isThrowStatement(node.thenStatement) && identifier(node.thenStatement.expression, 'error')).length) return false

  const workerOwner = exportedFunction(workerSource, 'processJob')
  if (!workerOwner) return false
  const dispatch = only(descendants(workerOwner, (node) => ts.isCaseClause(node) && literal(node.expression, 'dispatch_lifecycle_notification')))
  if (!dispatch) return false
  const dispatcherImport = only(descendants(dispatch, (node) => ts.isVariableDeclaration(node) && node.initializer
    && ts.isAwaitExpression(node.initializer) && ts.isCallExpression(node.initializer.expression)
    && node.initializer.expression.expression.kind === ts.SyntaxKind.ImportKeyword
    && literal(node.initializer.expression.arguments[0], '@/lib/customer-notifications/notificationOrchestrator')))
  if (!dispatcherImport || !ts.isObjectBindingPattern(dispatcherImport.name)) return false
  const notificationName = only(dispatcherImport.name.elements.filter((node) =>
    (node.propertyName ?? node.name).getText(workerSource) === 'notifyCustomerForLifecycleEvent').map((node) => node.name.text))
  const notification = notificationName && awaitedVariable(dispatch, notificationName)
  return Boolean(notification && objectField(notification.initializer.expression, 'companyId', 'job.company_id', workerSource)
    && objectField(notification.initializer.expression, 'customerId', 'job.customer_id', workerSource))
}

// Strip comments without treating quoted SQL literals as comments. This is a
// bounded source gate, not a SQL executor or general PL/pgSQL correctness proof.
function uncommentSql(source) {
  const parts = []
  let index = 0, depth = 0, start = 0
  while (index < source.length) {
    if (source[index] === "'") {
      index++
      while (index < source.length) {
        const character = source[index++]
        if (character === "'") {
          if (source[index] !== "'") break
          index++
        }
      }
    } else if (source[index] === '-' && source[index + 1] === '-') {
      parts.push(source.slice(start, index))
      index = source.indexOf('\n', index)
      if (index < 0) return parts.join('')
      start = index
    } else if (source[index] === '/' && source[index + 1] === '*') {
      parts.push(source.slice(start, index), ' ')
      index += 2; depth = 1
      while (index < source.length && depth) {
        if (source.slice(index, index + 2) === '/*') { depth++; index += 2 }
        else if (source.slice(index, index + 2) === '*/') { depth--; index += 2 }
        else index++
      }
      start = index
    } else index++
  }
  parts.push(source.slice(start))
  return parts.join('')
}

function functionBody(source, qualifiedName) {
  const active = uncommentSql(source)
  const escaped = qualifiedName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const definitions = [...active.matchAll(new RegExp(`\\bcreate\\s+(?:or\\s+replace\\s+)?function\\s+${escaped}\\s*\\(`, 'gi'))]
  const definition = only(definitions)
  if (!definition) return null
  const tail = active.slice(definition.index + definition[0].length)
  const start = /\bas\s+(\$[a-zA-Z_0-9]*\$)/i.exec(tail)
  if (!start) return null
  const bodyStart = start.index + start[0].length
  const bodyEnd = tail.indexOf(start[1], bodyStart)
  return bodyEnd < 0 ? null : tail.slice(bodyStart, bodyEnd)
}

function sqlTokens(source) {
  return uncommentSql(source).match(/'(?:''|[^'])*'|[a-zA-Z_][a-zA-Z_0-9]*|\d+|:=|<>|->>|->|\|\||[^\s]/g)?.map((token) =>
    token.startsWith("'") ? token : token.toLowerCase()) ?? []
}

const normalized = (source) => ` ${sqlTokens(source).join(' ')} `
const contains = (source, required) => normalized(source).includes(normalized(required))

function sqlChain({ schema, inbound, lifecycle }) {
  const wrapper = functionBody(schema, 'public.gridex_apply_inbound_switch_lifecycle_v1')
  const inboundOwner = functionBody(inbound, 'private.gridex_apply_inbound_switch_lifecycle_v1')
  const intentOwner = functionBody(lifecycle, 'private.gridex_record_customer_operation_event_v1')
  if (!wrapper || !inboundOwner || !intentOwner || contains(inboundOwner, 'exception when')) return false
  if (normalized(wrapper) !== normalized('select private.gridex_apply_inbound_switch_lifecycle_v1(p_source_message_id,p_actor_user_id);')) return false
  if (!contains(inboundOwner, "v_code:=case when v_outcome='supplier_switch_accepted' then 'supplier_switch.accepted' else 'supplier_switch.rejected' end;")
    || !contains(inboundOwner, "v_template:=case when v_outcome='supplier_switch_accepted' then 'switch.confirmed' else 'switch.action_required' end;")
    || !contains(inboundOwner, "if v_outcome<>'ignored' then v_lifecycle:=private.gridex_record_customer_operation_event_v1(jsonb_build_object(")) return false
  const lifecycleStart = normalized(inboundOwner).indexOf(normalized('v_lifecycle:=private.gridex_record_customer_operation_event_v1(').trim())
  const lifecycleCall = normalized(inboundOwner).slice(lifecycleStart).split(' end if ; ')[0]
  if (!contains(lifecycleCall, "'event_code',v_code") || !contains(lifecycleCall, "'notification_template',v_template")
    || !contains(inboundOwner, "'lifecycleReceipt',v_lifecycle")) return false
  if (!contains(intentOwner, "when 'supplier_switch.accepted' then 'switch.confirmed'")
    || !contains(intentOwner, "when 'supplier_switch.rejected' then 'switch.action_required'")
    || !contains(intentOwner, "v_template is distinct from p_event->>'notification_template'")
    || contains(intentOwner, 'exception when')) return false
  return contains(intentOwner, `v_job_id:=v_job.id; else
    insert into public.customer_operation_jobs(company_id,customer_id,customer_site_id,metering_point_id,job_type,status,priority,
    idempotency_key,payload,request_snapshot,run_after)
    values(v_company,v_customer,v_site,v_point,'dispatch_lifecycle_notification','queued',40,v_notification_key,
      v_intent_payload,v_payload,clock_timestamp()) returning id into v_job_id;
    end if; return jsonb_build_object('operationEventId',v_timeline_id,'domainEventId',v_domain_id,'notificationJobId',v_job_id,`)
    && contains(intentOwner, "'notificationJobId',v_job_id")
}

function hasCanonicalInboundLifecycleNotificationChain(sources) {
  return typeScriptChain(sources) && sqlChain(sources)
}

module.exports = { hasCanonicalInboundLifecycleNotificationChain }
